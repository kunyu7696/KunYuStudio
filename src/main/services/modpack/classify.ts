/**
 * 整合包 jar 归类（纯函数，唯一真源）。
 * 决定每个候选 jar 进 CurseForge 清单、Modrinth 清单，还是只随包到 overrides/mods。
 *
 * 按序短路：损坏 → 游戏本体（EULA）→ 无来源记录 → 本地文件已被替换 → 平台坐标。
 */
import type {
  JarEnv,
  ModJarDisposition,
  ModJarPlan,
  ModSourceEntry,
  ModpackExclusion,
  SideRequirement
} from '../../../shared/types/modpack'
import { collectRedistributionWarnings } from './licensePolicy'

/** 双端必需（无任何侧别信号时的保守默认） */
export const REQUIRED_BOTH: JarEnv = { client: 'required', server: 'required' }

/** 候选 jar（由组装器扫描 run/mods 后传入） */
export interface JarCandidate {
  fileName: string
  absPath: string
  /** 相对项目根的 POSIX 路径（`run/mods/x.jar` 或历史遗留的 `mods/x.jar`），打包时按此取源文件 */
  sourceRel: string
  /** 当前磁盘大小（字节） */
  size: number
  /** 文件头是否为合法 zip/jar（PK\x03\x04） */
  validZip: boolean
  /** jar 内元数据探测出的侧别（fabric.mod.json environment 等）；无信号为 null */
  env?: JarEnv | null
}

export interface ClassifyOptions {
  /**
   * 只进单一清单的 jar 是否额外随包到 overrides/mods（默认 true）。
   * CurseForge 清单无法表达 Modrinth 来源的模组，关掉会丢内容。
   */
  bundleUncoveredJars?: boolean
  /**
   * 候选文件哈希（文件名→哈希，组装器现算）。
   * 来源记录含平台权威 sha1 且本地可算时按内容比对（同尺寸替换也能识别，P1-10）；
   * 否则回退 size 比对。
   */
  hashes?: ReadonlyMap<string, { sha1: string }>
}

export interface ClassifyResult {
  jars: ModJarPlan[]
  exclusions: ModpackExclusion[]
  warnings: string[]
}

/**
 * 判定是否为 Minecraft 游戏本体 / 服务端 / Forge 通用包。
 * 依据 Mojang EULA，这些文件绝不可随整合包分发。
 */
export function isGameVessel(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return (
    lower === 'client.jar' ||
    lower === 'server.jar' ||
    /^minecraft[_-]?server.*\.jar$/.test(lower) ||
    /^forge-.*-universal\.jar$/.test(lower)
  )
}

/** 平台 id 是否可转为数字（CurseForge manifest 要求数值 projectID/fileID） */
function toNumericId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** 侧别合并：来源记录（Modrinth project 权威）优先，其次 jar 内探测，最后双 required */
function resolveJarEnv(src: ModSourceEntry | undefined, detected: JarEnv | null | undefined): JarEnv {
  const base = detected ?? REQUIRED_BOTH
  const client: SideRequirement = src?.clientSide ?? base.client
  const server: SideRequirement = src?.serverSide ?? base.server
  return { client, server }
}

/**
 * 本地文件是否已被替换（P1-10）：
 * 来源记录含平台权威 sha1 且本地可算时按内容比对（同尺寸替换也能识别）；
 * sha1 缺失或本地不可算时回退 size 比对（兼容旧记录 / CF 无哈希）。
 */
function isLocalReplaced(
  src: ModSourceEntry,
  c: JarCandidate,
  hashes?: ReadonlyMap<string, { sha1: string }>
): boolean {
  const localSha1 = src.sha1 ? hashes?.get(c.fileName)?.sha1 : undefined
  if (src.sha1 && localSha1) return localSha1 !== src.sha1
  return src.size > 0 && src.size !== c.size
}

/**
 * 归类候选 jar。
 * @param candidates 已扫描的候选（文件名唯一）
 * @param sources 文件名 → 安装来源记录
 */
export function classifyJars(
  candidates: JarCandidate[],
  sources: Map<string, ModSourceEntry>,
  opts: ClassifyOptions = {}
): ClassifyResult {
  const bundleUncoveredJars = opts.bundleUncoveredJars ?? true
  const jars: ModJarPlan[] = []
  const exclusions: ModpackExclusion[] = []
  const warnings: string[] = []

  for (const c of candidates) {
    if (!c.validZip) {
      exclusions.push({ fileName: c.fileName, reason: '文件头不是合法 zip/jar，可能已损坏' })
      continue
    }
    if (isGameVessel(c.fileName)) {
      exclusions.push({
        fileName: c.fileName,
        reason: 'Minecraft 游戏本体/服务端，依 EULA 禁止随整合包分发'
      })
      warnings.push(`已排除游戏本体文件 ${c.fileName}：依 Mojang EULA 不得再分发。`)
      continue
    }

    const src = sources.get(c.fileName)
    let disposition: ModJarDisposition = 'overrides'
    let reason = '无安装来源记录，随包到 overrides/mods'

    if (!src || src.platform === 'local') {
      disposition = 'overrides'
      reason = src ? '本地手工放入，无平台坐标' : '无安装来源记录，随包到 overrides/mods'
    } else if (isLocalReplaced(src, c, opts.hashes)) {
      // 本地文件已被替换：有平台 sha1 按内容比对（权威），否则回退大小比对
      const byHash = !!(src.sha1 && opts.hashes?.get(c.fileName)?.sha1)
      disposition = 'overrides'
      reason = byHash
        ? '本地文件内容（sha1）与安装记录不符，已改为随包分发'
        : `本地文件大小(${c.size})与安装记录(${src.size})不符，已改为随包分发`
      warnings.push(
        `${c.fileName} 与市场安装记录不一致（本地已被替换），已改走 overrides/mods；若仍留在清单中会导致安装校验失败。`
      )
    } else if (src.platform === 'curseforge') {
      const projectId = toNumericId(src.modId)
      const fileId = toNumericId(src.versionId)
      if (projectId !== null && fileId !== null) {
        disposition = 'curseforge-files'
        reason = `CurseForge 清单坐标 projectID=${projectId}, fileID=${fileId}`
      } else {
        disposition = 'overrides'
        reason = 'CurseForge 坐标不是数值型，无法写入清单，改随包分发'
      }
    } else if (src.downloadUrl) {
      disposition = 'modrinth-files'
      reason = 'Modrinth 清单坐标（含直链与双哈希）'
    } else {
      disposition = 'overrides'
      reason = 'Modrinth 版本无下载直链，无法写入清单，改随包分发'
    }

    jars.push({
      fileName: c.fileName,
      size: c.size,
      disposition,
      // 清单只覆盖单一平台，另一平台的启动器装不到 → 一律兜底随包
      bundledInOverrides: disposition === 'overrides' || bundleUncoveredJars,
      env: resolveJarEnv(src, c.env),
      reason
    })
  }

  // P3-1a：许可感知——随包分发（bundledInOverrides）属于再分发行为，
  // 按来源记录中的许可 SPDX id 逐 jar 判定合规性并给出中文告警
  // （restricted 强提示改清单引用/取得授权，copyleft 条件提示，unknown 合并轻提示）。
  const bundled = jars
    .filter((j) => j.bundledInOverrides)
    .map((j) => ({ fileName: j.fileName, license: sources.get(j.fileName)?.license ?? null }))
  warnings.push(...collectRedistributionWarnings(bundled))

  return { jars, exclusions, warnings }
}