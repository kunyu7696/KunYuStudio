/**
 * 零配置运行环境 3a：JDK 自动置备。
 *
 * 本机没有任何兼容 JDK 时，用户可在设置页一键下载：解析 Adoptium（Eclipse Temurin）
 * 官方 API 得到下载链接与 sha256，按设置把地址重写到国内镜像（默认清华 TUNA），
 * 校验后解包到 userData/jdks/<vendor>-<major>，随后被 detectJdk 以 source='managed' 发现。
 *
 * 授权/边界：安装包不捆绑任何 JDK（Mojang EULA 同理，Oracle/Adoptium 亦不宜再分发），
 * JDK 一律由用户显式触发、首启联网从官方/镜像下载。
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  JdkProvisionInput,
  JdkProvisionProgress,
  JdkProvisionResult
} from '../../shared/types/build'
import { getSection } from './settingsService'
import { managedJdkRoot } from './jdkPaths'
import { probeHome } from './jdkService'
import { ensureExecutable, extractArchiveToDir } from './archiveExtract'
import { httpDownload, httpGetJson } from './httpUtil'

const ADOPTIUM_API = 'https://api.adoptium.net/v3/assets/latest'
/** 逐块进度节流间隔（ms）：180MB 下载避免每块都经 IPC 推送 */
const PROGRESS_THROTTLE_MS = 250

export type JdkPlatform = 'windows' | 'linux' | 'mac'
export interface JdkTarget {
  major: number
  os: JdkPlatform
  arch: 'x64' | 'aarch64'
}

/** 当前进程平台的 Adoptium os 参数 */
export function platformOs(): JdkPlatform {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

/** 当前进程架构的 Adoptium architecture 参数 */
export function platformArch(): 'x64' | 'aarch64' {
  return process.arch === 'arm64' ? 'aarch64' : 'x64'
}

interface AdoptiumPackage {
  name: string
  link: string
  checksum: string
  size: number
}

/** 从 Adoptium 资产 JSON（数组）中抽取首个可用包与版本号；无可用包返回 null */
export function parseAdoptiumAsset(raw: unknown): { pkg: AdoptiumPackage; version: string } | null {
  const list = Array.isArray(raw) ? raw : []
  for (const item of list) {
    const asset = item as {
      binary?: { package?: Record<string, unknown> }
      version?: Record<string, unknown>
    }
    const p = asset?.binary?.package
    if (!p) continue
    const link = typeof p['link'] === 'string' ? p['link'] : ''
    const checksum = typeof p['checksum'] === 'string' ? p['checksum'] : ''
    if (!link || !checksum) continue
    return {
      pkg: {
        name: typeof p['name'] === 'string' ? p['name'] : '',
        link,
        checksum,
        size: typeof p['size'] === 'number' ? p['size'] : 0
      },
      version: typeof asset.version?.['semver'] === 'string' ? asset.version['semver'] : ''
    }
  }
  return null
}

/** 取 URL 路径末段作为文件名（不解码，保持镜像路径原样） */
export function fileNameOf(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''
  } catch {
    return url.split('/').filter(Boolean).pop() ?? ''
  }
}

/**
 * 按设置把官方下载链接重写为 TUNA 风格 Adoptium 镜像路径：
 *   <mirror>/<major>/jdk/<arch>/<os>/<filename>
 * mirror 为空时原样返回官方链接。
 */
export function rewriteToMirror(
  officialUrl: string,
  mirror: string | undefined,
  target: JdkTarget
): string {
  const base = (mirror ?? '').trim().replace(/\/+$/, '')
  if (!base) return officialUrl
  const filename = fileNameOf(officialUrl)
  if (!filename) return officialUrl
  return `${base}/${target.major}/jdk/${target.arch}/${target.os}/${filename}`
}

export interface ResolvedJdkDownload {
  url: string
  sha256: string
  size: number
  version: string
  filename: string
}

/** 解析 JDK 下载地址与权威校验和（Adoptium API + 可选镜像重写） */
export async function resolveJdkDownload(
  target: JdkTarget,
  mirror: string | undefined
): Promise<ResolvedJdkDownload> {
  const apiUrl =
    `${ADOPTIUM_API}/${target.major}/hotspot` +
    `?os=${target.os}&architecture=${target.arch}&image_type=jdk&vendor=eclipse`
  const { data } = await httpGetJson<unknown>(apiUrl, {
    headers: { 'User-Agent': 'KunYu-Studio/0.1 (jdk-provision)' }
  })
  const picked = parseAdoptiumAsset(data)
  if (!picked) throw new Error(`Adoptium 未返回 JDK ${target.major} 的可用包`)
  const url = rewriteToMirror(picked.pkg.link, mirror, target)
  return {
    url,
    sha256: picked.pkg.checksum,
    size: picked.pkg.size,
    version: picked.version,
    filename: fileNameOf(url)
  }
}

/** 按归档扩展名取后缀（.tar.gz 视为整体后缀） */
function archiveExt(filename: string): string {
  if (filename.toLowerCase().endsWith('.tar.gz')) return '.tar.gz'
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx) : '.zip'
}

/**
 * 下载并安装托管 JDK。失败统一返回人类可读中文，不抛异常（IPC handler 直接转发）。
 * 进程内不做并发保护：由 UI 按钮的 loading 态避免并发触发。
 */
export async function provisionJdk(
  input: JdkProvisionInput,
  onProgress?: (p: JdkProvisionProgress) => void
): Promise<JdkProvisionResult> {
  const major = Math.trunc(Number(input.major))
  if (!Number.isFinite(major) || major < 8 || major > 30) {
    return { ok: false, errorMessage: `不支持的 JDK 主版本：${String(input.major)}` }
  }
  const javaSettings = getSection('java')
  const mirror = input.mirror ?? javaSettings.jdkMirror
  const root = input.managedRoot ?? managedJdkRoot(javaSettings.managedJdkDir)
  const target: JdkTarget = { major, os: platformOs(), arch: platformArch() }
  const emit = (p: JdkProvisionProgress): void => onProgress?.(p)

  emit({ phase: 'resolve', progress: 0, message: '正在解析 JDK 下载地址…' })
  let resolved: ResolvedJdkDownload
  try {
    resolved = await resolveJdkDownload(target, mirror)
  } catch (err) {
    return { ok: false, errorMessage: `解析 JDK 下载地址失败：${(err as Error).message}` }
  }

  const ext = archiveExt(resolved.filename)
  const instanceName = `temurin-${major}`
  const home = join(root, instanceName)
  const archivePath = join(root, `${instanceName}${ext}.part`)
  mkdirSync(root, { recursive: true })

  emit({
    phase: 'download',
    progress: 0,
    totalBytes: resolved.size,
    message: `正在下载 JDK ${major}（${resolved.filename}）…`
  })
  let lastEmit = 0
  try {
    await httpDownload(resolved.url, archivePath, {
      // JDK 归档近 200MB，给足 10 分钟；超时可重试
      timeoutMs: 10 * 60 * 1000,
      expected: { sha256: resolved.sha256, size: resolved.size },
      headers: { 'User-Agent': 'KunYu-Studio/0.1 (jdk-provision)' },
      onProgress: (loaded, total) => {
        const now = Date.now()
        if (now - lastEmit < PROGRESS_THROTTLE_MS && loaded !== total) return
        lastEmit = now
        emit({
          phase: 'download',
          progress: total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
          loadedBytes: loaded,
          totalBytes: total
        })
      }
    })
  } catch (err) {
    rmSync(archivePath, { force: true })
    return {
      ok: false,
      errorMessage: `下载 JDK 失败：${(err as Error).message}。可检查网络或在设置中更换镜像地址。`
    }
  }
  emit({
    phase: 'download',
    progress: 100,
    loadedBytes: resolved.size,
    totalBytes: resolved.size
  })

  // 重复置备时先清理旧实例
  rmSync(home, { recursive: true, force: true })
  try {
    emit({ phase: 'extract', progress: 30, message: '正在解包 JDK…' })
    const archive = readFileSync(archivePath)
    const written = extractArchiveToDir(archive, home, ext, { stripComponents: 1 })
    ensureExecutable(written, home)
  } catch (err) {
    rmSync(archivePath, { force: true })
    rmSync(home, { recursive: true, force: true })
    return { ok: false, errorMessage: `解包 JDK 失败：${(err as Error).message}` }
  }
  rmSync(archivePath, { force: true })
  emit({ phase: 'extract', progress: 100, message: '正在校验 JDK…' })

  if (!existsSync(join(home, 'bin'))) {
    rmSync(home, { recursive: true, force: true })
    return { ok: false, errorMessage: '解包结果缺少 bin 目录，镜像可能返回了非预期内容，请更换镜像重试' }
  }
  const jdk = await probeHome(home, 'managed')
  if (!jdk) {
    rmSync(home, { recursive: true, force: true })
    return { ok: false, errorMessage: '已下载并解包，但无法运行 bin/java 识别版本，请更换镜像重试' }
  }
  emit({ phase: 'done', progress: 100, message: `已安装 JDK ${jdk.version}（${home}）` })
  return { ok: true, jdk, home }
}
