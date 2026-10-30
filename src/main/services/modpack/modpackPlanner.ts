/**
 * 整合包组装计划（纯函数，零 IO）。
 * 输入已读好的项目元数据、overrides/config 文件清单、run/mods 候选与安装记录，
 * 输出双平台清单 files[]、zip 条目映射与告警，供干跑预览与实跑打包共用。
 */
import { posix } from 'node:path'
import type { ModLoader } from '../../../shared/types/project'
import type { ContentPackInput, ContentPackSummary } from '../../../shared/types/contentPack'
import type {
  CurseForgeFileEntry,
  ModSourceEntry,
  ModpackPlatform,
  ModpackPlan,
  ModrinthFileEntry
} from '../../../shared/types/modpack'
import { classifyJars, type JarCandidate } from './classify'
import { auditDependencies, buildDependencyGraph, extractJarDeps } from './dependencyAudit'
import type { FileHashes } from './hashUtil'

/** 包内条目来源：generated 由组装器现场生成，file 直接从项目内取 */
export type ModpackZipSource =
  | { name: string; from: 'generated' }
  | { name: string; from: 'file'; sourceRel: string }

export interface PlannerInput {
  name: string
  mcVersion: string
  loader: ModLoader
  loaderVersion: string | null
  /** 项目根 `overrides/` 下已存在的文件（相对 overrides/ 的 POSIX 路径） */
  overrideFiles: string[]
  /** 项目根 `config/` 下的文件（相对 config/ 的 POSIX 路径） */
  configFiles: string[]
  /** 候选模组 jar（已扫描 run/mods） */
  candidates: JarCandidate[]
  /** 文件名 → 安装来源记录 */
  sources: Map<string, ModSourceEntry>
  /** 文件名 → 现算双哈希（仅进 Modrinth 清单的 jar 需要） */
  hashes: ReadonlyMap<string, FileHashes>
  /** 已扫描的内容包（planner 按 enabled 决定合并，概要进 plan.packs） */
  packs?: ContentPackInput[]
  /** 只进单一清单的 jar 是否额外随包到 overrides/mods，默认 true */
  bundleUncoveredJars?: boolean
  /** 目标平台：curseforge 时客户端专用模组落 overrides/mods（CF 不认 client-overrides） */
  platform?: ModpackPlatform
}

export interface PlannerResult {
  ok: boolean
  /** 失败原因（中文，直接可展示） */
  error?: string
  plan?: ModpackPlan
  /** 实际打包映射（assembler 据此写 zip） */
  zipItems?: ModpackZipSource[]
}

/** 项目根 overrides/ 下不参与打包的占位文件 */
const OVERRIDE_SKIP = new Set(['.gitkeep'])

/**
 * 生成组装计划。
 * 拒绝条件：MC 版本为空、无任何可打包模组。
 */
export function planModpack(input: PlannerInput): PlannerResult {
  if (!input.mcVersion.trim()) {
    return {
      ok: false,
      error: '项目缺少 Minecraft 版本元数据，请先在项目设置中补全后再组装（清单缺版本会导致启动器无法安装）。'
    }
  }

  const { jars, exclusions, warnings } = classifyJars(input.candidates, input.sources, {
    bundleUncoveredJars: input.bundleUncoveredJars,
    hashes: input.hashes
  })

  if (jars.length === 0) {
    return {
      ok: false,
      error: 'run/mods 下没有可打包的模组 jar：请先在市场安装模组，或把 jar 放入项目的 run/mods 目录。'
    }
  }

  // P3-1b：依赖缺席审计——缺必需前置/可选联动/冲突共存前置到打包阶段提示，
  // 不再等游戏启动崩溃才发现（单个 jar 元数据损坏跳过，不拖垮审计）。
  // decls 同时喂 P3-2 依赖关系图（depGraph），jar 元数据只解析一次。
  const decls = input.candidates.filter((c) => c.validZip).map((c) => extractJarDeps(c.absPath, c.fileName))
  const audit = auditDependencies(decls)
  if (audit.missingRequired.length > 0 || audit.conflicts.length > 0) {
    warnings.push(
      `依赖审计发现 ${audit.missingRequired.length} 个缺必需前置、${audit.conflicts.length} 组冲突共存（详见下）：`
    )
    warnings.push(...audit.missingRequired, ...audit.conflicts)
  }
  if (audit.missingOptional.length > 0) {
    warnings.push(...audit.missingOptional)
  }

  const curseforgeFiles: CurseForgeFileEntry[] = []
  const modrinthFiles: ModrinthFileEntry[] = []

  for (const jar of jars) {
    if (jar.disposition === 'curseforge-files') {
      const src = input.sources.get(jar.fileName)
      if (!src) continue
      curseforgeFiles.push({
        projectID: Number(src.modId),
        fileID: Number(src.versionId),
        required: true
      })
    } else if (jar.disposition === 'modrinth-files') {
      const src = input.sources.get(jar.fileName)
      const hashes = input.hashes.get(jar.fileName)
      if (!src?.downloadUrl || !hashes) {
        // 兜底：缺直链或读不到文件时降级随包，避免写入必然校验失败的条目
        jar.disposition = 'overrides'
        jar.bundledInOverrides = true
        jar.reason = '缺少下载直链或文件哈希，改随包分发'
        continue
      }
      modrinthFiles.push({
        path: posix.join('mods', jar.fileName),
        hashes: { sha1: hashes.sha1, sha512: hashes.sha512 },
        fileSize: hashes.size,
        downloads: [src.downloadUrl],
        env: jar.env
      })
    }
  }

  const zipItems: ModpackZipSource[] = []
  const usedNames = new Map<string, string>()
  const push = (item: ModpackZipSource, owner = '项目内容'): void => {
    const prev = usedNames.get(item.name)
    if (prev !== undefined) {
      if (prev !== owner) {
        warnings.push(`条目 ${item.name} 同时由 ${prev} 与 ${owner} 声明，先到先得，后者已忽略。`)
      }
      return
    }
    usedNames.set(item.name, owner)
    zipItems.push(item)
  }

  push({ name: 'manifest.json', from: 'generated' })
  push({ name: 'modrinth.index.json', from: 'generated' })
  push({ name: 'README.md', from: 'generated' })

  for (const rel of input.overrideFiles) {
    if (OVERRIDE_SKIP.has(rel)) continue
    push({ name: posix.join('overrides', rel), from: 'file', sourceRel: posix.join('overrides', rel) })
  }
  for (const rel of input.configFiles) {
    push({
      name: posix.join('overrides/config', rel),
      from: 'file',
      sourceRel: posix.join('config', rel)
    })
  }
  // 改写为 overrides/mods 下的 jar：名字变了，靠显式清单 API 实现「改名映射」
  // 源路径取候选自己的落点（run/mods 或历史遗留 mods/），不能硬编码，否则旧布局会取不到文件
  const sourceRelByFileName = new Map(input.candidates.map((c) => [c.fileName, c.sourceRel]))
  for (const jar of jars) {
    if (!jar.bundledInOverrides) continue
    const sourceRel = sourceRelByFileName.get(jar.fileName)
    if (!sourceRel) continue
    // 分侧落点（P1-4 平台感知）：
    // - curseforge：所有模组统一 overrides/mods（CF 启动器不认 client-overrides/server-overrides）
    // - modrinth：client-only → client-overrides/mods，server-only → server-overrides/mods，通用 → overrides/mods
    const modsDir = input.platform === 'curseforge'
      ? 'overrides/mods'
      : jar.env.server === 'unsupported'
        ? 'client-overrides/mods'
        : jar.env.client === 'unsupported'
          ? 'server-overrides/mods'
          : 'overrides/mods'
    push({
      name: posix.join(modsDir, jar.fileName),
      from: 'file',
      sourceRel
    })
  }

  const bundled = jars.filter((j) => j.bundledInOverrides).length
  if (bundled > 0) {
    warnings.push(
      `有 ${bundled} 个模组随包分发（按侧别落入 overrides/mods、client-overrides/mods 或 server-overrides/mods）：第三方模组版权归各自作者，二次分发前请确认其许可协议。`
    )
  }

  // 内容包合并：按 packId 字典序（先到先得的优先序），仅 enabled 包产生条目与清单引用
  const packSummaries: ContentPackSummary[] = []
  const packs = [...(input.packs ?? [])].sort((a, b) => a.packId.localeCompare(b.packId))
  for (const pack of packs) {
    if (pack.enabled) {
      const owner = `内容包 ${pack.packId}`
      for (const rel of pack.overrideFiles) {
        push(
          {
            name: posix.join('overrides', rel),
            from: 'file',
            sourceRel: posix.join('content-packs', pack.packId, 'overrides', rel)
          },
          owner
        )
      }
      for (const jar of pack.jarFiles) {
        push({ name: posix.join('overrides/mods', jar.fileName), from: 'file', sourceRel: jar.sourceRel }, owner)
      }
      curseforgeFiles.push(...pack.curseforgeFiles)
      modrinthFiles.push(...pack.modrinthFiles)
    }
    packSummaries.push({
      packId: pack.packId,
      name: pack.name,
      category: pack.category,
      version: pack.version,
      description: pack.description,
      enabled: pack.enabled,
      valid: true,
      warnings: pack.warnings
    })
  }

  const plan: ModpackPlan = {
    name: input.name,
    mcVersion: input.mcVersion,
    loader: input.loader,
    loaderVersion: input.loaderVersion,
    zipEntries: zipItems.map((i) => i.name),
    curseforgeFiles,
    modrinthFiles,
    jars,
    exclusions,
    packs: packSummaries,
    depGraph: buildDependencyGraph(decls, input.sources),
    warnings
  }

  return { ok: true, plan, zipItems }
}