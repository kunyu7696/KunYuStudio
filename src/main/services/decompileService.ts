/**
 * 反编译工作区服务（Vineflower）。
 *
 * 链路：
 * 1. ensureVineflower：vineflower.jar 缺失时按网络镜像设置从 Maven Central / 阿里云镜像
 *    下载到 userData/tools/（运行时按需，不打进安装包；版本经 maven-metadata.xml 解析，
 *    失败回退固定版本），落盘后校验 ZIP 魔数（PK）。
 * 2. startDecompile：复用 jdkService.detectJdk 选 Java 11+ 运行时，spawn
 *    `java -jar vineflower.jar <源jar> <输出目录>`，stdout/stderr 行经事件回调节流推送。
 * 3. 产物浏览：readDirIn / readFileIn / searchIn / deleteWorkspace 全部经
 *    assertWithinDecompileRoot 守卫（自管安全根，realpath 防 Junction 穿越）。
 *
 * 与项目 fsService 隔离：反编译产物不在任何项目根下，绝不注册进 allowedRoots。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  closeSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { app } from 'electron'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  DecompileFileContent,
  DecompileResult,
  DecompileToolStatus,
  DecompileWorkspaceInfo
} from '../../shared/types/decompile'
import type { FileNode } from '../../shared/types/fs'
import { detectJdk } from './jdkService'
import { getSection } from './settingsService'
import { httpDownload, httpGetText, fetchSha256Sidecar } from './httpUtil'
import { openZip, sha256Hex } from './performance/jarReader'

const VINEFLOWER_BASE = 'org/vineflower/vineflower'
const MAVEN_CENTRAL = 'https://repo1.maven.org/maven2'
const ALIYUN_PUBLIC = 'https://maven.aliyun.com/repository/public'
/** maven-metadata 解析失败时的固定兜底版本 */
export const VINEFLOWER_PINNED_VERSION = '1.11.1'
/** Vineflower 运行时最低 Java 版本 */
const MIN_JAVA_MAJOR = 11
/** 单文件读取上限（2MB，超出截断） */
export const DECOMPILE_READ_MAX_BYTES = 2 * 1024 * 1024
/** 类搜索上限 */
export const DECOMPILE_SEARCH_MAX = 200
/** 日志推送节流（ms） */
const LOG_THROTTLE_MS = 200

export function toolsRoot(): string {
  return join(app.getPath('userData'), 'tools')
}

export function decompileRoot(): string {
  return join(app.getPath('userData'), 'decompiled')
}

export function vineflowerJarPath(version: string = VINEFLOWER_PINNED_VERSION): string {
  return join(toolsRoot(), `vineflower-${version}.jar`)
}

/**
 * 按镜像偏好给出候选下载地址（按优先级排序）：
 * china → 阿里云镜像优先、Maven Central 兜底；official → 仅官方源在前（仍附镜像兜底）。
 */
export function buildVineflowerUrls(version: string, mirror: 'china' | 'official'): string[] {
  const path = `${VINEFLOWER_BASE}/vineflower-${version}.jar`
  const central = `${MAVEN_CENTRAL}/${path}`
  const aliyun = `${ALIYUN_PUBLIC}/${path}`
  return mirror === 'china' ? [aliyun, central] : [central, aliyun]
}

/** 从 maven-metadata.xml 解析最新 release 版本；解析失败返回 null */
export function parseMavenMetadataVersion(xml: string): string | null {
  const release = xml.match(/<release>([^<]+)<\/release>/)?.[1]?.trim()
  if (release) return release
  const latest = xml.match(/<latest>([^<]+)<\/latest>/)?.[1]?.trim()
  return latest || null
}

/** 工作区目录名：jar 基名净化（仅留安全字符）+ 源路径短哈希（同名不同源不冲突） */
export function workspaceNameFor(jarPath: string): string {
  const base = basename(jarPath, extname(jarPath))
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'jar'
  const hash = createHash('sha1').update(resolve(jarPath)).digest('hex').slice(0, 8)
  return `${base}-${hash}`
}

/**
 * 解析真实位置：存在则 realpath；不存在则回退到最近存在祖先再拼回尾段。
 * macOS 的 tmpdir（/var/folders/…）本身是 /private/var/… 的符号链接，
 * 目标与根必须走同一套解析，否则真实化后的目标会与词法根对不上而被误判越界。
 */
function realish(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    let probe = dirname(abs)
    for (let i = 0; i < 32 && probe !== dirname(probe); i++) {
      try {
        return join(realpathSync(probe), abs.slice(probe.length))
      } catch {
        probe = dirname(probe)
      }
    }
    return abs
  }
}

/**
 * 校验 target 落在某个反编译工作区根内（或就是 decompileRoot 一级子目录本身）。
 * realpath 还原符号链接，防 Windows Junction / macOS symlink 穿越到树外。
 */
export function assertWithinDecompileRoot(target: string): void {
  const real = realish(target)
  const root = decompileRoot()
  for (const r of new Set([root, realish(root)])) {
    const rel = relative(r, real)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return
  }
  throw new Error(`路径越界，禁止访问: ${target}`)
}

/** ZIP/JAR 魔数校验：仅接受 zip 本地文件头（PK\x03\x04）或空归档 EOCD（PK\x05\x06） */
export function isJarBytes(head: Buffer): boolean {
  if (head.length < 4 || head[0] !== 0x50 || head[1] !== 0x4b) return false
  const magic = head.readUInt32LE(0)
  return magic === 0x04034b50 || magic === 0x06054b50
}

/**
 * jar 结构校验：魔数正确 + 能被 ZIP 读取器解析出中央目录 + 含 META-INF/MANIFEST.MF。
 * 仅验 PK 两字节时，任意以 "PK" 开头的垃圾文件都会通过；这里进一步确认它确实是一个
 * 可执行的合法 jar，供 `java -jar` 前把关。
 */
function jarStructureOk(path: string): boolean {
  try {
    const reader = openZip(path)
    return reader.has('META-INF/MANIFEST.MF')
  } catch {
    return false
  }
}

/** 校验磁盘上的 jar：魔数 + 结构（损坏/HTML 错误页/伪造魔数一律判未安装） */
function jarMagicOk(path: string): boolean {
  try {
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.alloc(4)
      const n = readSync(fd, buf, 0, 4, 0)
      if (n < 4 || !isJarBytes(buf.subarray(0, n))) return false
    } finally {
      closeSync(fd)
    }
    return jarStructureOk(path)
  } catch {
    return false
  }
}

/** 读取 jar 旁的 `.sha256` sidecar（下载时落盘），返回小写哈希或 null */
function readJarSidecarHash(path: string): string | null {
  try {
    const m = readFileSync(`${path}.sha256`, 'utf-8').match(/\b([0-9a-fA-F]{64})\b/)
    return m ? m[1]!.toLowerCase() : null
  } catch {
    return null
  }
}

/** 工具状态（不触发下载）。已安装版本从文件名解析，未知回退固定版本。 */
export function toolStatus(): DecompileToolStatus {
  const dir = toolsRoot()
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const m = name.match(/^vineflower-(.+)\.jar$/)
      if (!m) continue
      const p = join(dir, name)
      if (!jarMagicOk(p)) continue
      // 有 sidecar 时必须与磁盘内容一致：哈希不符视为被篡改/损坏，跳过该 jar
      const sidecar = readJarSidecarHash(p)
      if (sidecar && sha256Hex(p) !== sidecar) continue
      return {
        installed: true,
        path: p,
        version: m[1]!,
        integrity: sidecar ? 'sha256-verified' : 'unverified'
      }
    }
  }
  return {
    installed: false,
    path: vineflowerJarPath(),
    version: VINEFLOWER_PINNED_VERSION,
    integrity: 'unverified'
  }
}

/** 解析要下载的 Vineflower 版本：maven-metadata 优先，失败回退固定版本 */
async function resolveVineflowerVersion(mirror: 'china' | 'official'): Promise<string> {
  const metaPath = `${VINEFLOWER_BASE}/maven-metadata.xml`
  const candidates =
    mirror === 'china'
      ? [`${ALIYUN_PUBLIC}/${metaPath}`, `${MAVEN_CENTRAL}/${metaPath}`]
      : [`${MAVEN_CENTRAL}/${metaPath}`]
  for (const url of candidates) {
    try {
      const res = await httpGetText(url, { maxBytes: 64 * 1024 })
      if (res.status === 200) {
        const v = parseMavenMetadataVersion(res.text)
        if (v) return v
      }
    } catch {
      /* 元数据不可达时走固定版本 */
    }
  }
  return VINEFLOWER_PINNED_VERSION
}

/**
 * 确保 vineflower.jar 就绪：已安装直接返回；否则按镜像偏好逐个候选地址下载。
 * 下载前必须取得官方 SHA-256（Maven sidecar），取不到即拒绝下载（fail-closed，
 * 不落盘未校验的可执行 jar）；落盘后再校验哈希 + ZIP 结构，通过后记录 sidecar。
 */
export async function ensureVineflower(
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<DecompileToolStatus> {
  const current = toolStatus()
  if (current.installed) return current
  const mirror = getSection('network').mirror
  const version = await resolveVineflowerVersion(mirror)
  const urls = buildVineflowerUrls(version, mirror)
  let expected: string | null = null
  for (const url of urls) {
    expected = await fetchSha256Sidecar(url)
    if (expected) break
  }
  if (!expected) {
    throw new Error(
      'Vineflower 官方 SHA-256 校验值不可达，已拒绝下载未经校验的可执行 jar；请检查网络后重试'
    )
  }
  const dest = vineflowerJarPath(version)
  const errors: string[] = []
  for (const url of urls) {
    try {
      await httpDownload(url, dest, { onProgress, expected: { sha256: expected } })
      if (!jarMagicOk(dest)) {
        rmSync(dest, { force: true })
        errors.push(`${url}：下载内容不是结构合法的 jar`)
        continue
      }
      writeFileSync(`${dest}.sha256`, `${expected}\n`, 'utf-8')
      return { installed: true, path: dest, version, integrity: 'sha256-verified' }
    } catch (err) {
      rmSync(dest, { force: true })
      errors.push(`${url}：${(err as Error).message}`)
    }
  }
  throw new Error(`Vineflower 下载失败：${errors.join('；')}`)
}

/** 选 Java 11+ 运行时：优先 candidates 中最高主版本，兜底 detectJdk 选中项 */
async function pickJavaForVineflower(): Promise<string> {
  const result = await detectJdk()
  const eligible = result.candidates
    .filter((j) => j.major >= MIN_JAVA_MAJOR)
    .sort((a, b) => b.major - a.major)
  const picked = eligible[0] ?? (result.jdk && result.jdk.major >= MIN_JAVA_MAJOR ? result.jdk : null)
  if (!picked) {
    throw new Error(`未找到 Java ${MIN_JAVA_MAJOR}+ 运行时（可在设置页配置 JDK 或用应用内下载）`)
  }
  return picked.javaPath
}

/** 统计目录下 .java 文件数（限深防爆） */
function countJavaFiles(dir: string, depth = 0): number {
  if (depth > 24) return 0
  let count = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) count += countJavaFiles(abs, depth + 1)
    else if (e.name.endsWith('.java')) count++
  }
  return count
}

/**
 * 启动反编译任务。
 * @param jarPath 用户经文件对话框选中的源 jar 绝对路径
 * @param onEvent 进度回调（工具下载 / 日志行 / 完成 / 失败）
 * @returns 输出目录与产物统计
 */
export async function startDecompile(
  jarPath: string,
  onEvent?: (phase: 'tool-download' | 'running' | 'done' | 'error', message: string) => void
): Promise<DecompileResult> {
  if (!existsSync(jarPath) || !statSync(jarPath).isFile()) {
    throw new Error(`源 jar 不存在: ${jarPath}`)
  }
  const outDir = join(decompileRoot(), workspaceNameFor(jarPath))
  mkdirSync(outDir, { recursive: true })
  onEvent?.('tool-download', '检查反编译工具…')
  const tool = await ensureVineflower()
  // 执行前再验一次：无论 jar 来自下载还是本地既有文件，都必须是结构合法的 jar
  if (!jarMagicOk(tool.path)) {
    throw new Error(`反编译工具校验失败（jar 损坏或不是合法 ZIP/JAR）：${tool.path}`)
  }
  if (tool.integrity !== 'sha256-verified') {
    onEvent?.(
      'tool-download',
      '注意：本地既有 Vineflower jar 没有官方 SHA-256 校验记录，将以未校验状态继续执行'
    )
  }
  const javaPath = await pickJavaForVineflower()
  onEvent?.('running', `使用 ${javaPath} 启动 Vineflower ${tool.version}`)

  const logTail: string[] = []
  let logBytes = 0
  let lastPush = 0
  const pushLog = (line: string, force = false): void => {
    const trimmed = line.trim()
    if (!trimmed) return
    logTail.push(trimmed)
    logBytes += trimmed.length
    while (logBytes > 8192 && logTail.length > 1) {
      logBytes -= logTail[0]!.length
      logTail.shift()
    }
    const now = Date.now()
    if (force || now - lastPush >= LOG_THROTTLE_MS) {
      lastPush = now
      onEvent?.('running', trimmed.slice(0, 300))
    }
  }

  await new Promise<void>((resolvePromise, rejectPromise) => {
    // Vineflower CLI：java -jar vineflower.jar [选项] <源> <目标目录>
    // 目标为目录时按包结构输出 .java 树
    const child = spawn(javaPath, ['-jar', tool.path, jarPath, outDir], {
      windowsHide: true
    })
    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split(/\r?\n/)) pushLog(line)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split(/\r?\n/)) pushLog(line)
    })
    child.on('error', (err) => rejectPromise(new Error(`无法启动 Java：${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`Vineflower 退出码 ${code}：${logTail.slice(-5).join(' / ')}`))
    })
  })

  const fileCount = countJavaFiles(outDir)
  onEvent?.('done', `完成：${fileCount} 个类`)
  return { outDir, fileCount, logTail: logTail.join('\n') }
}

/** 列出全部反编译工作区（按 mtime 倒序） */
export function listWorkspaces(): DecompileWorkspaceInfo[] {
  const root = decompileRoot()
  if (!existsSync(root)) return []
  const result: DecompileWorkspaceInfo[] = []
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const abs = join(root, e.name)
    try {
      result.push({ root: abs, name: e.name, mtime: statSync(abs).mtimeMs })
    } catch {
      /* 跳过异常项 */
    }
  }
  return result.sort((a, b) => b.mtime - a.mtime)
}

/** 解析工作区内相对路径并做安全校验 */
function resolveInWorkspace(root: string, rel: string): string {
  assertWithinDecompileRoot(root)
  // root 必须就是 decompileRoot 的一级子目录，防止拿 decompileRoot 本身当工作区
  const rootAbs = resolve(root)
  // 根与 decompileRoot 两侧同样真实化，macOS 符号链接 tmpdir 下才能正确判定一级子目录
  const parent = relative(realish(decompileRoot()), realish(rootAbs))
  if (parent === '' || parent.startsWith('..') || isAbsolute(parent) || parent.includes(sep)) {
    throw new Error(`非法工作区根: ${root}`)
  }
  const clean = rel.replace(/^[\\/]+/, '')
  const target = resolve(rootAbs, clean)
  const relToRoot = relative(rootAbs, target)
  if (relToRoot.startsWith('..') || isAbsolute(relToRoot)) {
    throw new Error(`路径越出工作区: ${rel}`)
  }
  assertWithinDecompileRoot(target)
  return target
}

function toFileNode(absPath: string): FileNode {
  const st = statSync(absPath)
  const name = basename(absPath)
  const ext = extname(absPath).slice(1).toLowerCase()
  return {
    path: absPath,
    name,
    kind: st.isDirectory() ? 'directory' : 'file',
    ext,
    size: st.isDirectory() ? 0 : st.size,
    mtime: st.mtimeMs
  }
}

/** 读工作区内目录子节点（目录在前按名称排序） */
export function readDirIn(root: string, relDir: string): FileNode[] {
  const dir = resolveInWorkspace(root, relDir)
  const entries = readdirSync(dir, { withFileTypes: true })
  const dirs: FileNode[] = []
  const files: FileNode[] = []
  for (const entry of entries) {
    try {
      const node = toFileNode(join(dir, entry.name))
      if (node.kind === 'directory') dirs.push(node)
      else files.push(node)
    } catch {
      /* 跳过无权限项 */
    }
  }
  const byName = (a: FileNode, b: FileNode): number => a.name.localeCompare(b.name)
  return [...dirs.sort(byName), ...files.sort(byName)]
}

/** 读工作区内文本文件（utf-8，超 2MB 截断） */
export async function readFileIn(root: string, relPath: string): Promise<DecompileFileContent> {
  const target = resolveInWorkspace(root, relPath)
  const st = statSync(target)
  if (st.isDirectory()) throw new Error(`目标是目录: ${relPath}`)
  const truncated = st.size > DECOMPILE_READ_MAX_BYTES
  const buf = await readFile(target)
  const slice = truncated ? buf.subarray(0, DECOMPILE_READ_MAX_BYTES) : buf
  return {
    path: target,
    relPath,
    content: slice.toString('utf-8'),
    truncated
  }
}

/** 按文件名模糊搜索工作区内 .java（大小写不敏感子串，上限 200） */
export function searchIn(root: string, query: string): FileNode[] {
  const dir = resolveInWorkspace(root, '')
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: FileNode[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }]
  while (stack.length > 0 && hits.length < DECOMPILE_SEARCH_MAX) {
    const { dir: cur, depth } = stack.pop()!
    if (depth > 24) continue
    let entries
    try {
      entries = readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const abs = join(cur, entry.name)
      try {
        if (entry.isDirectory()) stack.push({ dir: abs, depth: depth + 1 })
        else if (entry.name.endsWith('.java') && entry.name.toLowerCase().includes(q)) {
          hits.push(toFileNode(abs))
        }
      } catch {
        /* 跳过异常项 */
      }
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path))
}

/** 删除整个工作区目录 */
export function deleteWorkspace(root: string): boolean {
  resolveInWorkspace(root, '')
  if (!existsSync(root)) return false
  rmSync(root, { recursive: true, force: true })
  return true
}
