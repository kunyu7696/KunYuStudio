/**
 * 零配置运行环境 3b：MC 实例管理与运行时资产置备。
 *
 * 本机没有游戏本体时，由首启向导/实例面板触发：从版本清单解析目标版本，
 * 联网下载单版本 JSON（校验 sha1）、客户端 jar、依赖库（含 natives）、
 * 资产索引与资产对象，全部落在 userData/mcinstances/<id> 下，以便后续直接启动。
 *
 * 授权/边界：安装包不捆绑 MC 本体与资产（Mojang EULA 禁止再分发），一律联网下载；
 * 中国网络下默认走 BMCLAPI 等国内镜像，镜像地址可在设置中配置，不锁死第三方 ID。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, promises as fsp, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  McAssetIndex,
  McInstance,
  McProvisionInput,
  McProvisionProgress,
  McProvisionResult,
  McVersionDetail,
  McVersionManifest,
  McVersionSummary
} from '../../shared/types/mcRuntime'
import { getSection } from './settingsService'
import { httpDownload, httpGetJson, httpGetText } from './httpUtil'
import {
  libraryArtifactDownload,
  libraryPath,
  manifestUrl,
  nativeDownload,
  OFFICIAL_MANIFEST_URL,
  platformMcArch,
  platformOsName,
  resolveMcMirrorBase,
  rewriteMcUrl,
  type McRuleContext
} from './mcLaunchSpec'
import {
  managedMcInstancesRoot,
  mcAssetIndexFile,
  mcAssetObjectFile,
  mcInstanceDir,
  mcInstanceMetaFile,
  mcLibrariesDir,
  mcVersionDir
} from './mcPaths'

/** 资产对象并发下载数（文件小、数量多，适度并发；不触 API 限速） */
const ASSET_CONCURRENCY = 12
/** 逐块进度节流间隔（ms） */
const PROGRESS_THROTTLE_MS = 200
/** 大文件下载超时（客户端 jar / 库，10 分钟） */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

/** 解析本次置备使用的镜像基地址（覆盖值优先，其次按网络设置） */
export function resolveMirror(override?: string | null): string {
  if (typeof override === 'string') {
    return (override ?? '').trim().replace(/\/+$/, '')
  }
  const net = getSection('network')
  return resolveMcMirrorBase(net.mirror, net.mcMirror)
}

/** 拉取版本清单（按镜像重写） */
async function fetchVersionManifest(mirror: string): Promise<McVersionManifest> {
  const url = manifestUrl(mirror)
  const { data } = await httpGetJson<McVersionManifest>(url, {
    timeoutMs: 30_000,
    headers: { 'User-Agent': 'KunYu-Studio/0.1 (mc-provision)' }
  })
  return { latest: data.latest, versions: Array.isArray(data.versions) ? data.versions : [] }
}

/** 清单获取结果：base 为空串表示官方直连（后续所有 URL 不做镜像重写） */
export interface McManifestFetch {
  manifest: McVersionManifest
  base: string
}

/**
 * 拉取版本清单并给出本次置备实际生效的源：
 * 镜像清单重试一次，仍失败则整体回退官方源直连（下载慢但可用），避免镜像偶发故障阻塞置备。
 */
export async function fetchManifestWithFallback(mirror: string): Promise<McManifestFetch> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { manifest: await fetchVersionManifest(mirror), base: mirror }
    } catch (err) {
      lastErr = err
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  console.warn(`[mcRuntime] 镜像清单不可用（${(lastErr as Error).message}），回退官方源直连`)
  const { data } = await httpGetJson<McVersionManifest>(OFFICIAL_MANIFEST_URL, {
    timeoutMs: 30_000,
    headers: { 'User-Agent': 'KunYu-Studio/0.1 (mc-provision)' }
  })
  return {
    manifest: { latest: data.latest, versions: Array.isArray(data.versions) ? data.versions : [] },
    base: ''
  }
}

/** 在清单中查找目标版本；不存在返回 null */
export function findVersion(
  manifest: McVersionManifest,
  mcVersion: string
): McVersionSummary | null {
  return manifest.versions.find((v) => v.id === mcVersion) ?? null
}

/** 下载并解析单版本 JSON（校验清单给出的 sha1；v2 清单含 sha1 时严格校验） */
export async function fetchVersionDetail(
  summary: McVersionSummary,
  mirror: string
): Promise<McVersionDetail> {
  const url = rewriteMcUrl(summary.url, mirror)
  const { status, text } = await httpGetText(url, { timeoutMs: 30_000 })
  if (status >= 400) throw new Error(`单版本 JSON 下载失败 HTTP ${status}`)
  if (summary.sha1) {
    const actual = createHash('sha1').update(text, 'utf8').digest('hex')
    if (actual !== summary.sha1.toLowerCase()) {
      throw new Error('单版本 JSON 校验失败（sha1 不符），镜像可能返回了非预期内容，请更换镜像重试')
    }
  }
  return JSON.parse(text) as McVersionDetail
}

/** 判断已存在且大小匹配的文件可跳过下载 */
function upToDate(path: string, size?: number): boolean {
  if (!existsSync(path)) return false
  if (!size || size <= 0) return false
  try {
    return statSync(path).size === size
  } catch {
    return false
  }
}

/** 简单的并发池：按 limit 并发执行 worker，每完成一项回调 */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  onTick?: (done: number, total: number) => void
): Promise<void> {
  const total = items.length
  let done = 0
  let cursor = 0
  const n = Math.min(Math.max(1, limit), Math.max(1, total))
  const runners = Array.from({ length: n }, async () => {
    while (cursor < total) {
      const index = cursor++
      await worker(items[index], index)
      done++
      onTick?.(done, total)
    }
  })
  await Promise.all(runners)
}

/** 读实例元数据；缺失返回 null */
export async function readMcInstance(root: string, id: string): Promise<McInstance | null> {
  try {
    const text = await fsp.readFile(mcInstanceMetaFile(root, id), 'utf-8')
    const parsed = JSON.parse(text) as McInstance
    if (!parsed || typeof parsed.id !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

/** 列出托管实例（按最近使用倒序，无实例时返回空数组） */
export async function listMcInstances(rootOverride?: string | null): Promise<McInstance[]> {
  const root = managedMcInstancesRoot(rootOverride)
  let ids: string[]
  try {
    ids = await fsp.readdir(root)
  } catch {
    return []
  }
  const list: McInstance[] = []
  for (const id of ids) {
    const meta = await readMcInstance(root, id)
    if (meta) list.push(meta)
  }
  return list.sort((a, b) => (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt))
}

/** 删除托管实例（连带其版本/库/资产目录） */
export async function deleteMcInstance(
  id: string,
  rootOverride?: string | null
): Promise<boolean> {
  if (!id || /[\\/]|\.\./.test(id)) return false
  const root = managedMcInstancesRoot(rootOverride)
  try {
    await fsp.rm(mcInstanceDir(root, id), { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** 实例 id 合法化：只保留字母数字与 . _ - */
function safeInstanceId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64)
}

/**
 * 网络抖动兜底：httpDownload 仅对 429 退避重试，超时/连接重置等瞬时故障直接抛错。
 * 资产文件数量大（数千个小文件），单个文件抖动不应让整次置备失败，这里按文件短等待重试。
 * 失败时半成品文件由 upToDate 的大小校验兜底，重试/重跑会自动重新下载。
 */
async function downloadWithRetry(
  url: string,
  destPath: string,
  opts?: Parameters<typeof httpDownload>[2],
  attempts = 3
): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await httpDownload(url, destPath, opts)
      return
    } catch (err) {
      lastErr = err
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 1000))
    }
  }
  throw lastErr
}

/**
 * 置备一个托管实例的完整运行时。失败统一返回人类可读中文，不抛异常（IPC handler 直接转发）。
 * 已存在且大小匹配的文件会跳过，重复执行可断点续备。
 */
export async function provisionMcRuntime(
  input: McProvisionInput,
  onProgress?: (p: McProvisionProgress) => void
): Promise<McProvisionResult> {
  const mcVersion = (input.mcVersion ?? '').trim()
  if (!mcVersion) return { ok: false, errorMessage: '缺少目标 MC 版本号' }
  const mirror = resolveMirror(input.mirror)
  const root = managedMcInstancesRoot(input.instancesRoot)
  const id = safeInstanceId(input.instanceId?.trim() || mcVersion)
  const emit = (p: McProvisionProgress): void => onProgress?.(p)

  // 1) 解析版本清单与单版本 JSON（镜像重试 → 官方源整体回退）
  emit({ phase: 'resolve', progress: 1, message: '正在获取版本清单…' })
  let detail: McVersionDetail
  let base = ''
  try {
    const res = await fetchManifestWithFallback(mirror)
    base = res.base
    if (base !== mirror) {
      emit({ phase: 'resolve', progress: 2, message: '镜像清单不可用，已回退官方源继续置备' })
    }
    const summary = findVersion(res.manifest, mcVersion)
    if (!summary) return { ok: false, errorMessage: `版本清单中未找到 ${mcVersion}` }
    emit({ phase: 'version', progress: 3, message: `正在获取 ${mcVersion} 版本信息…` })
    detail = await fetchVersionDetail(summary, base)
  } catch (err) {
    return { ok: false, errorMessage: `解析版本信息失败：${(err as Error).message}` }
  }

  const versionDir = mcVersionDir(root, id, mcVersion)
  const librariesDir = mcLibrariesDir(root, id)
  mkdirSync(versionDir, { recursive: true })

  // 写版本 JSON（供启动与校验）
  writeFileSync(join(versionDir, `${mcVersion}.json`), JSON.stringify(detail, null, 2), 'utf-8')

  // 2) 客户端 jar
  const client = detail.downloads?.client
  if (!client?.url) return { ok: false, errorMessage: '版本信息缺少客户端下载地址' }
  const clientJar = join(versionDir, `${mcVersion}.jar`)
  emit({ phase: 'client', progress: 5, message: '正在下载客户端…' })
  try {
    if (!upToDate(clientJar, client.size)) {
      let last = 0
      await httpDownload(rewriteMcUrl(client.url, base), clientJar, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        expected: { sha1: client.sha1, size: client.size },
        headers: { 'User-Agent': 'KunYu-Studio/0.1 (mc-provision)' },
        onProgress: (loaded, total) => {
          const now = Date.now()
          if (now - last < PROGRESS_THROTTLE_MS && loaded !== total) return
          last = now
          emit({
            phase: 'client',
            progress: total > 0 ? 5 + Math.round((loaded / total) * 20) : 5,
            loadedBytes: loaded,
            totalBytes: total
          })
        }
      })
    }
  } catch (err) {
    return { ok: false, errorMessage: `下载客户端失败：${(err as Error).message}` }
  }
  emit({ phase: 'client', progress: 25, message: '客户端下载完成' })

  // 3) 依赖库（普通制品 + 平台 natives）
  const ctx: McRuleContext = {
    os: platformOsName(),
    arch: platformMcArch(),
    features: {}
  }
  const libJobs: Array<{ rel: string; url: string; sha1?: string; size?: number }> = []
  for (const lib of detail.libraries ?? []) {
    const art = libraryArtifactDownload(lib, ctx)
    if (art) {
      const rel = libraryPath(art, lib)
      if (rel) libJobs.push({ rel, url: rewriteMcUrl(art.url, base), sha1: art.sha1, size: art.size })
    }
    const nat = nativeDownload(lib, ctx)
    if (nat) {
      const rel = libraryPath(nat.download, lib)
      if (rel) {
        libJobs.push({
          rel,
          url: rewriteMcUrl(nat.download.url, base),
          sha1: nat.download.sha1,
          size: nat.download.size
        })
      }
    }
  }
  emit({ phase: 'libraries', progress: 26, total: libJobs.length, message: `正在置备 ${libJobs.length} 个依赖库…` })
  try {
    await runPool(libJobs, 8, async (job) => {
      const dest = join(librariesDir, job.rel)
      if (upToDate(dest, job.size)) return
      await httpDownload(job.url, dest, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        expected: { sha1: job.sha1, size: job.size },
        headers: { 'User-Agent': 'KunYu-Studio/0.1 (mc-provision)' }
      })
    }, (done, total) => {
      emit({
        phase: 'libraries',
        progress: 26 + (total > 0 ? Math.round((done / total) * 18) : 18),
        current: done,
        total
      })
    })
  } catch (err) {
    return { ok: false, errorMessage: `置备依赖库失败：${(err as Error).message}` }
  }
  emit({ phase: 'libraries', progress: 44, current: libJobs.length, total: libJobs.length })

  // 4) 资产索引与资产对象
  const indexRef = detail.assetIndex
  const indexFile = mcAssetIndexFile(root, id, indexRef.id)
  try {
    if (!upToDate(indexFile, indexRef.size)) {
      await downloadWithRetry(rewriteMcUrl(indexRef.url, base), indexFile, {
        timeoutMs: 60_000,
        expected: { sha1: indexRef.sha1, size: indexRef.size },
        headers: { 'User-Agent': 'KunYu-Studio/0.1 (mc-provision)' }
      })
    }
  } catch (err) {
    return { ok: false, errorMessage: `下载资产索引失败：${(err as Error).message}` }
  }

  let assetTotal = 0
  if (input.downloadAssets !== false) {
    let index: McAssetIndex
    try {
      index = JSON.parse(await fsp.readFile(indexFile, 'utf-8')) as McAssetIndex
    } catch (err) {
      return { ok: false, errorMessage: `解析资产索引失败：${(err as Error).message}` }
    }
    const objects = Object.values(index.objects ?? {})
    assetTotal = objects.length
    emit({ phase: 'assets', progress: 45, total: assetTotal, message: `正在下载 ${assetTotal} 个资产文件…` })
    // 去重（同一 hash 可能被多个资源引用）
    const unique = new Map<string, number>()
    for (const obj of objects) if (!unique.has(obj.hash)) unique.set(obj.hash, obj.size)
    const jobs = [...unique.entries()].map(([hash, size]) => ({ hash, size }))
    try {
      await runPool(jobs, ASSET_CONCURRENCY, async (job) => {
        const dest = mcAssetObjectFile(root, id, job.hash)
        if (upToDate(dest, job.size)) return
        // 网络抖动兜底：单文件超时/连接重置等瞬时故障短等待重试，避免整次置备失败
        await downloadWithRetry(
          rewriteMcUrl(`https://resources.download.minecraft.net/${job.hash.slice(0, 2)}/${job.hash}`, base),
          dest,
          {
            timeoutMs: 60_000,
            expected: { sha1: job.hash, size: job.size },
            headers: { 'User-Agent': 'KunYu-Studio/0.1 (mc-provision)' }
          }
        )
      }, (done, total) => {
        emit({
          phase: 'assets',
          progress: 45 + (total > 0 ? Math.round((done / total) * 55) : 55),
          current: done,
          total
        })
      })
    } catch (err) {
      return { ok: false, errorMessage: `下载资产失败：${(err as Error).message}` }
    }
  }

  // 5) 写实例元数据
  const now = new Date().toISOString()
  const existing = await readMcInstance(root, id)
  const instance: McInstance = {
    id,
    name: input.name?.trim() || existing?.name || mcVersion,
    mcVersion,
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: now
  }
  try {
    mkdirSync(dirname(mcInstanceMetaFile(root, id)), { recursive: true })
    await fsp.writeFile(mcInstanceMetaFile(root, id), JSON.stringify(instance, null, 2), 'utf-8')
  } catch (err) {
    return { ok: false, errorMessage: `写入实例信息失败：${(err as Error).message}` }
  }

  emit({ phase: 'done', progress: 100, message: `已准备 ${mcVersion}（实例 ${instance.name}）` })
  return {
    ok: true,
    instance,
    info: {
      instanceId: id,
      mcVersion,
      mainClass: detail.mainClass,
      assets: detail.assets,
      assetIndexId: indexRef.id,
      javaMajor: detail.javaVersion?.majorVersion ?? null
    }
  }
}
