/**
 * 整合包真实组装器（IO 层）。
 * 扫描 run/mods → 归类 → 构建双清单 → 写入 dist/<项目名>-modpack.zip。
 *
 * 元数据走 pack.toml 中间表示层（packTomlIo）：pack.toml 是人可读 IR（缺失时自愈、
 * 绝不回写），导出时描述字段覆写双清单骨架；index.toml 是组装后的文件清单快照。
 *
 * 打包为白名单模式：包内只出现双清单、README、overrides/（含 config 与随包 mods）。
 * pack.toml/index.toml 不进 zip（保证 CurseForge/Modrinth 格式纯净）。
 * 依 EULA 绝不打包 Minecraft 本体；构建产物/源码/Gradle 工程一律不进包。
 */
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join, posix } from 'node:path'
import type { ModLoader } from '../../../shared/types/project'
import type { ModSourceEntry, ModpackAssembleResult, ModpackPlatform, ModpackPlan } from '../../../shared/types/modpack'
import type { IndexTomlFile, PackTomlIr } from '../../../shared/types/packToml'
import { zipEntries, type ZipEntry } from '../ai/zipUtil'
import { openZip } from '../performance/jarReader'
import type { JarEnv } from '../../../shared/types/modpack'
import { fileHashes, type FileHashes } from './hashUtil'
import { readSources } from './provenance'
import { scanEnabledPackInputs } from './contentPackIo'
import { planModpack, type ModpackZipSource, type PlannerResult } from './modpackPlanner'
import {
  ensurePackToml,
  packTomlVersionWarnings,
  readPackToml,
  sha256File,
  writeIndexSnapshot
} from './packTomlIo'
import {
  buildCurseForgeManifest,
  buildModpackReadme,
  buildModrinthIndex,
  type JsonObject
} from './manifestBuilder'
import type { JarCandidate } from './classify'

/** 项目组装所需元数据 */
export interface ModpackMeta {
  name: string
  mcVersion: string
  loader: ModLoader
  loaderVersion: string | null
}

/** 项目内 jar 落点：`run/mods` 优先，其次历史遗留的 `mods/` */
const MOD_DIR_CANDIDATES = [posix.join('run', 'mods'), 'mods']

/** 读取文件前 4 字节（判断 zip/jar 魔数 PK\x03\x04） */
function readMagic(absPath: string): Buffer {
  const buf = Buffer.alloc(4)
  const fd = openSync(absPath, 'r')
  try {
    readSync(fd, buf, 0, 4, 0)
  } finally {
    closeSync(fd)
  }
  return buf
}

function isZipMagic(buf: Buffer): boolean {
  return buf.length === 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
}

/**
 * 从 jar 内元数据探测侧别（无信号返回 null，保守按双 required）：
 * - fabric.mod.json environment="client" → 客户端专用（server: unsupported）
 * - mods.toml/neoforge.mods.toml 的 side 声明全部为 CLIENT 时才采信（默认 BOTH，弱信号）
 */
function detectJarEnv(absPath: string): JarEnv | null {
  try {
    const zip = openZip(absPath)
    if (zip.has('fabric.mod.json')) {
      const parsed = JSON.parse(zip.read('fabric.mod.json').toString('utf8')) as { environment?: string }
      if (parsed.environment === 'client') {
        return { client: 'required', server: 'unsupported' }
      }
    }
    for (const name of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
      if (!zip.has(name)) continue
      const text = zip.read(name).toString('utf8')
      const sides = [...text.matchAll(/^\s*side\s*=\s*"([A-Z]+)"/gm)].map((m) => m[1])
      if (sides.length > 0 && sides.every((s) => s === 'CLIENT')) {
        return { client: 'required', server: 'unsupported' }
      }
    }
  } catch {
    // 元数据读不到（损坏/非标准 jar）按无信号处理
  }
  return null
}

/** 递归列目录，返回相对 base 的 POSIX 路径 */
function listFilesRel(base: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const childRel = rel ? posix.join(rel, name) : name
      if (statSync(abs).isDirectory()) walk(abs, childRel)
      else out.push(childRel)
    }
  }
  if (existsSync(base)) walk(base, '')
  return out
}

/** 扫描待打包模组 jar（`run/mods` 优先，同名以 `run/mods` 为准） */
export function scanModCandidates(projectRoot: string): JarCandidate[] {
  const seen = new Set<string>()
  const out: JarCandidate[] = []
  for (const rel of MOD_DIR_CANDIDATES) {
    const dir = join(projectRoot, ...rel.split('/'))
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.jar')) continue
      if (seen.has(name)) continue
      const abs = join(dir, name)
      if (!statSync(abs).isFile()) continue
      seen.add(name)
      const validZip = isZipMagic(readMagic(abs))
      out.push({
        fileName: name,
        absPath: abs,
        sourceRel: posix.join(rel, name),
        size: statSync(abs).size,
        validZip,
        // 合法 jar 才探测内嵌元数据（损坏 jar 后续直接进 exclusions）
        env: validZip ? detectJarEnv(abs) : null
      })
    }
  }
  return out
}

/** 项目根 `overrides/` 下已存在的文件（相对 overrides/） */
export function scanOverrideFiles(projectRoot: string): string[] {
  return listFilesRel(join(projectRoot, 'overrides'))
}

/** 项目根 `config/` 下的文件（相对 config/，映射到包内 overrides/config/） */
export function scanConfigFiles(projectRoot: string): string[] {
  return listFilesRel(join(projectRoot, 'config'))
}

/** 读取清单骨架；返回 json 与是否成功读取（缺失/损坏时 ok=false，调用方应告警） */
function readSkeleton(projectRoot: string, fileName: string): { json: JsonObject; ok: boolean } {
  const abs = join(projectRoot, fileName)
  if (!existsSync(abs)) return { json: {}, ok: false }
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { json: parsed as JsonObject, ok: true }
  } catch {
    // 骨架损坏时按空对象重建（manifestBuilder 会补最小合法骨架）
  }
  return { json: {}, ok: false }
}

/** 生成包内文件名安全串（Windows 保留字符全部替换） */
export function sanitizePackName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return cleaned || 'modpack'
}

function timestampSuffix(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 汇总候选哈希（仅 Modrinth 清单需要，读不到则缺省，由 planner 降级） */
function collectHashes(candidates: JarCandidate[]): Map<string, FileHashes> {
  const map = new Map<string, FileHashes>()
  for (const c of candidates) {
    if (!c.validZip) continue
    const h = fileHashes(c.absPath)
    if (h) map.set(c.fileName, h)
  }
  return map
}

function buildPlan(projectRoot: string, meta: ModpackMeta, platform?: ModpackPlatform): PlannerResult {
  const candidates = scanModCandidates(projectRoot)
  return planModpack({
    name: meta.name,
    mcVersion: meta.mcVersion,
    loader: meta.loader,
    loaderVersion: meta.loaderVersion,
    overrideFiles: scanOverrideFiles(projectRoot),
    configFiles: scanConfigFiles(projectRoot),
    candidates,
    sources: readSources(projectRoot),
    hashes: collectHashes(candidates),
    packs: scanEnabledPackInputs(projectRoot),
    platform
  })
}

/** 干跑预览：不落盘，只回计划与告警。pack.toml 只读解析（坏 TOML 同样 fail-fast） */
export function previewModpack(projectRoot: string, meta: ModpackMeta): PlannerResult {
  const pack = readPackToml(projectRoot)
  if (pack.exists && !pack.ok) {
    return { ok: false, error: pack.error }
  }
  const result = buildPlan(projectRoot, meta)
  if (result.ok && result.plan) {
    result.plan.warnings.push(...pack.warnings, ...packTomlVersionWarnings(pack.ir, meta))
  }
  return result
}

/** 把计划条目转换为 zip 条目（generated 条目由本函数现场生成内容） */
function toZipEntries(
  projectRoot: string,
  plan: ModpackPlan,
  items: ModpackZipSource[],
  sources: Map<string, ModSourceEntry>,
  ir: PackTomlIr | null,
  platform: ModpackPlatform
): ZipEntry[] {
  const cfSkel = readSkeleton(projectRoot, 'manifest.json')
  const mrSkel = readSkeleton(projectRoot, 'modrinth.index.json')
  const cfBase = cfSkel.json
  const mrBase = mrSkel.json
  // P-01：骨架缺失/损坏时告警（manifestBuilder 已回落最小合法骨架，包仍可装）
  if (!cfSkel.ok) plan.warnings.push('manifest.json 骨架缺失或损坏，已用最小合法骨架回落并补全必需字段')
  if (!mrSkel.ok) plan.warnings.push('modrinth.index.json 骨架缺失或损坏，已用最小合法骨架回落并补全必需字段')
  // IR 描述字段权威：非空时覆写清单骨架；版本字段以 DB 项目设置为准（不覆写）
  if (ir) {
    if (ir.name.trim()) {
      cfBase.name = ir.name
      mrBase.name = ir.name
    }
    if (ir.version.trim()) {
      cfBase.version = ir.version
      mrBase.versionId = ir.version
    }
    if (ir.author.trim()) cfBase.author = ir.author
    if (ir.description.trim()) mrBase.summary = ir.description
  }
  const { index } = buildModrinthIndex(mrBase, plan.loader, plan.loaderVersion, plan.mcVersion, plan.modrinthFiles)
  const readme = buildModpackReadme(
    plan.name,
    plan.mcVersion,
    plan.loader,
    plan.loaderVersion,
    plan.jars,
    sources
  )
  const generated: Record<string, string> = {
    'manifest.json': JSON.stringify(
      buildCurseForgeManifest(cfBase, plan.curseforgeFiles, {
        mcVersion: plan.mcVersion,
        loader: plan.loader,
        loaderVersion: plan.loaderVersion
      }),
      null,
      2
    ),
    'modrinth.index.json': JSON.stringify(index, null, 2),
    'README.md': readme
  }

  const entries: ZipEntry[] = []
  for (const item of items) {
    if (item.from === 'generated') {
      // P-02：.mrpack 规范只允许 modrinth.index.json + overrides/（client/server），
      // CurseForge 的 manifest.json 与 README.md 不得混入 .mrpack（启动器可能判非法）。
      // P-02 对称裁剪：.mrpack 不含 CF 的 manifest.json/README.md；CF zip 不含 mrpack 的 modrinth.index.json
      if (
        (platform === 'modrinth' && (item.name === 'manifest.json' || item.name === 'README.md')) ||
        (platform === 'curseforge' && item.name === 'modrinth.index.json')
      ) {
        continue
      }
      entries.push({ name: item.name, from: 'data', data: generated[item.name] ?? '' })
    } else {
      entries.push({
        name: item.name,
        from: 'file',
        absPath: join(projectRoot, ...item.sourceRel.split('/'))
      })
    }
  }
  return entries
}

/**
 * 汇总 index.toml 快照条目。
 * mods 按源路径登记（run/mods/<file>，附 .kunyu/modpack.json 来源 meta）；
 * 其余取 zip 白名单中的 file 条目（overrides/、overrides/config/），跳过 mods 的 overrides 副本。
 */
function buildIndexFiles(
  projectRoot: string,
  plan: ModpackPlan,
  items: ModpackZipSource[],
  sources: Map<string, ModSourceEntry>
): { files: IndexTomlFile[]; warnings: string[] } {
  const warnings: string[] = []
  const files: IndexTomlFile[] = []
  const candidates = scanModCandidates(projectRoot)
  const relByFileName = new Map(candidates.map((c) => [c.fileName, c.sourceRel]))
  const sizeByFileName = new Map(candidates.map((c) => [c.fileName, c.size]))

  for (const jar of plan.jars) {
    const rel = relByFileName.get(jar.fileName)
    if (!rel) continue
    const hash = sha256File(join(projectRoot, ...rel.split('/')))
    if (!hash) {
      warnings.push(`index.toml 快照跳过 ${rel}：文件无法读取。`)
      continue
    }
    const src = sources.get(jar.fileName)
    files.push({
      file: rel,
      hash,
      size: sizeByFileName.get(jar.fileName) ?? 0,
      platform: src?.platform,
      slug: src?.slug || undefined,
      versionId: src?.versionId || undefined
    })
  }

  for (const item of items) {
    if (item.from !== 'file') continue
    // mods 副本（含分侧目录）已在上面 jar 循环登记，跳过
    if (/^(overrides|client-overrides|server-overrides)\/mods\//.test(item.name)) continue
    const abs = join(projectRoot, ...item.sourceRel.split('/'))
    const hash = sha256File(abs)
    if (!hash) {
      warnings.push(`index.toml 快照跳过 ${item.sourceRel}：文件无法读取。`)
      continue
    }
    // 内容包贡献的条目带 pack 归属键（sourceRel 形如 content-packs/<packId>/overrides/<rel>）
    const packMatch = /^content-packs\/([^/]+)\//.exec(item.sourceRel)
    files.push({ file: item.name, hash, size: statSync(abs).size, ...(packMatch ? { pack: packMatch[1] } : {}) })
  }
  return { files, warnings }
}

/**
 * 写入单个 zip 产物（先写临时文件再原子改名）。
 * 目标被占用时回退 `-<时间戳>` 名。返回产物路径与告警，或错误。
 */
function writeZip(
  entries: ZipEntry[],
  distDir: string,
  base: string,
  ext: string
): { path: string; warnings: string[] } | { error: string } {
  const target = join(distDir, `${base}.${ext}`)
  const tmp = join(distDir, `${base}.${ext}.tmp`)
  const warnings: string[] = []
  try {
    zipEntries(entries, tmp)
  } catch (err) {
    return { error: `整合包写入失败：${(err as Error).message}` }
  }
  let path = target
  try {
    renameSync(tmp, target)
  } catch {
    const suffix = timestampSuffix()
    const alt = join(distDir, `${base}-${suffix}.${ext}`)
    try {
      renameSync(tmp, alt)
      path = alt
      warnings.push(`目标文件被占用，产物已改名为 ${base}-${suffix}.${ext}。`)
    } catch (err) {
      try {
        unlinkSync(tmp)
      } catch {
        /* 临时文件清理失败可忽略 */
      }
      return { error: `整合包重命名失败：${(err as Error).message}` }
    }
  }
  return { path, warnings }
}

/**
 * 组装并导出整合包（P1-4：分平台出包）。
 * 产物为两份：
 * - `dist/<项目名>-modpack.mrpack`：Modrinth 格式，client-only 模组落 client-overrides/mods
 * - `dist/<项目名>-modpack-cf.zip`：CurseForge 格式，所有模组落 overrides/mods（CF 不认 client-overrides）
 * pack.toml 缺失时自愈生成，坏 TOML 直接 fail-fast；成功后把 index.toml 快照落项目根。
 */
export function assembleModpack(projectRoot: string, meta: ModpackMeta): ModpackAssembleResult {
  const pack = ensurePackToml(projectRoot, meta)
  if (!pack.ok) {
    return { ok: false, error: pack.error }
  }

  // MR 计划（client-only → client-overrides/mods）
  const mrResult = buildPlan(projectRoot, meta, 'modrinth')
  if (!mrResult.ok || !mrResult.plan || !mrResult.zipItems) {
    return { ok: false, error: mrResult.error ?? '组装计划生成失败' }
  }
  // CF 计划（所有模组 → overrides/mods）
  const cfResult = buildPlan(projectRoot, meta, 'curseforge')
  if (!cfResult.ok || !cfResult.plan || !cfResult.zipItems) {
    return { ok: false, error: cfResult.error ?? '组装计划生成失败' }
  }

  const mrPlan = mrResult.plan
  mrPlan.warnings.push(...pack.warnings, ...packTomlVersionWarnings(pack.ir, meta))
  const sources = readSources(projectRoot)
  const distDir = join(projectRoot, 'dist')
  const base = `${sanitizePackName(meta.name)}-modpack`
  mkdirSync(distDir, { recursive: true })

  // P-01：不从 mrPlan.warnings 快照——toZipEntries 会 push 骨架告警到 mrPlan.warnings，旧快照会覆盖丢弃
  const warnings: string[] = []

  // MR zip（.mrpack）
  const mrEntries = toZipEntries(projectRoot, mrPlan, mrResult.zipItems, sources, pack.ir, 'modrinth')
  const mrZip = writeZip(mrEntries, distDir, base, 'mrpack')
  if ('error' in mrZip) {
    return { ok: false, plan: mrPlan, error: mrZip.error }
  }
  warnings.push(...mrZip.warnings)

  // CF zip（.zip）
  const cfEntries = toZipEntries(projectRoot, cfResult.plan, cfResult.zipItems, sources, pack.ir, 'curseforge')
  const cfZip = writeZip(cfEntries, distDir, `${base}-cf`, 'zip')
  if ('error' in cfZip) {
    return { ok: false, plan: mrPlan, error: cfZip.error }
  }
  warnings.push(...cfZip.warnings)

  // index.toml 快照（以 MR 计划为基准；mods 副本路径不影响快照）
  const snapshot = buildIndexFiles(projectRoot, mrPlan, mrResult.zipItems, sources)
  writeIndexSnapshot(projectRoot, snapshot.files)
  mrPlan.warnings = [...mrPlan.warnings, ...warnings, ...snapshot.warnings]
  return { ok: true, zipPath: mrZip.path, cfZipPath: cfZip.path, plan: mrPlan, entryCount: mrEntries.length }
}

/** dist/ 内按平台分拣的产物（发布预检与上传共用，P0-6：预检与上传对齐同一文件） */
export interface DistArtifacts {
  /** Modrinth 产物（dist/*.mrpack 中最新） */
  mrpackPath: string
  mrpackMtime: number
  /** CurseForge 产物（dist/*.zip 中最新，.mrpack 不以 .zip 结尾故天然互斥） */
  cfZipPath: string
  cfZipMtime: number
}

/**
 * 扫描 dist/ 找各平台最新产物。目录缺失/为空时对应字段为空串（不抛错），
 * 由调用方决定缺失时的降级语义（预检展示 / 发布按平台报错）。
 */
export function findLatestDistArtifacts(distDir: string): DistArtifacts {
  const out: DistArtifacts = { mrpackPath: '', mrpackMtime: 0, cfZipPath: '', cfZipMtime: 0 }
  try {
    for (const f of readdirSync(distDir)) {
      const abs = join(distDir, f)
      let st
      try {
        st = statSync(abs)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      if (f.endsWith('.mrpack') && st.mtimeMs > out.mrpackMtime) {
        out.mrpackMtime = st.mtimeMs
        out.mrpackPath = abs
      } else if (f.endsWith('.zip') && st.mtimeMs > out.cfZipMtime) {
        out.cfZipMtime = st.mtimeMs
        out.cfZipPath = abs
      }
    }
  } catch {
    // dist 目录可能不存在
  }
  return out
}