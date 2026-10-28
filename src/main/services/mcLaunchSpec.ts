/**
 * MC 运行时纯函数（零配置运行环境 3b）：镜像重写、库规则解析、natives 选择、启动参数拼装。
 *
 * 全部为无副作用纯函数，不 import electron / fs，便于离线单测。
 * 国内镜像默认指向 BMCLAPI，但地址始终可被设置覆盖，不在本模块锁死任何第三方 ID。
 */
import { release as osRelease } from 'node:os'
import type {
  McArgumentEntry,
  McDownload,
  McLibrary,
  McRule,
  McVersionDetail
} from '../../shared/types/mcRuntime'

/** 内置国内镜像默认基地址（BMCLAPI）；仅在用户未显式配置且选择国内镜像时生效 */
export const DEFAULT_BMCLAPI = 'https://bmclapi2.bangbang93.com'

/** 官方版本清单地址 */
export const OFFICIAL_MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export type McOsName = 'windows' | 'osx' | 'linux'
export type McArch = 'x64' | 'x86' | 'arm64'

/** 依据网络设置解析实际使用的镜像基地址；空串表示官方直连（不重写） */
export function resolveMcMirrorBase(
  mirrorMode: 'china' | 'official',
  customMirror?: string | null
): string {
  const custom = (customMirror ?? '').trim().replace(/\/+$/, '')
  if (custom) return custom
  return mirrorMode === 'china' ? DEFAULT_BMCLAPI : ''
}

/** 版本清单地址（按镜像重写） */
export function manifestUrl(mirrorBase: string): string {
  const base = (mirrorBase ?? '').trim().replace(/\/+$/, '')
  return base ? `${base}/mc/game/version_manifest_v2.json` : OFFICIAL_MANIFEST_URL
}

/**
 * 将 Mojang 官方下载地址重写为 BMCLAPI 等镜像路径；镜像为空时原样返回。
 *  - libraries.minecraft.net/<p>      → <base>/maven/<p>
 *  - resources.download.minecraft.net → <base>/assets/<p>
 *  - *.mojang.com/<p>                 → <base>/<p>
 * 其他主机（含第三方库 CDN）不重写，避免误伤。
 */
export function rewriteMcUrl(url: string, mirrorBase: string): string {
  const base = (mirrorBase ?? '').trim().replace(/\/+$/, '')
  if (!base) return url
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  const host = parsed.hostname.toLowerCase()
  const path = parsed.pathname.replace(/^\/+/, '')
  if (host === 'libraries.minecraft.net') return `${base}/maven/${path}`
  if (host === 'resources.download.minecraft.net') return `${base}/assets/${path}`
  if (host === 'mojang.com' || host.endsWith('.mojang.com')) return `${base}/${path}`
  return url
}

/** 当前平台 → Mojang 规则中的 os.name */
export function platformOsName(platform: NodeJS.Platform = process.platform): McOsName {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'osx'
  return 'linux'
}

/** 当前架构 → Mojang 规则/分类器中的 arch */
export function platformMcArch(arch: NodeJS.Architecture = process.arch): McArch {
  if (arch === 'ia32') return 'x86'
  if (arch === 'arm64') return 'arm64'
  return 'x64'
}

/**
 * maven 坐标名 → 相对路径。兼容两种分类器写法：
 *  - group:artifact:version@classifier（现代）
 *  - group:artifact:version:classifier（旧版）
 */
export function mavenPathFromName(name: string): string | null {
  const at = name.indexOf('@')
  const coord = at >= 0 ? name.slice(0, at) : name
  const atClassifier = at >= 0 ? name.slice(at + 1) : ''
  const parts = coord.split(':')
  if (parts.length < 3) return null
  const [group, artifact, version] = parts
  const classifier = atClassifier || (parts.length >= 4 ? parts[3] : '')
  const dir = group.replace(/\./g, '/')
  const file = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`
  return `${dir}/${artifact}/${version}/${file}`
}

/** 库文件落盘相对路径：优先下载描述自带 path，否则由 maven 名推导 */
export function libraryPath(download: McDownload | undefined, lib: McLibrary): string {
  const fromDownload = download?.path?.replace(/^\/+/, '')
  if (fromDownload) return fromDownload
  return mavenPathFromName(lib.name) ?? ''
}

/** 规则求值上下文 */
export interface McRuleContext {
  os: McOsName
  arch: McArch
  /** 系统版本（可留空：规则含 os.version 且此处为空时视为匹配，避免误判） */
  osVersion?: string
  /** 可选特性（如 has_custom_resolution），缺省全 false */
  features?: Record<string, boolean>
}

/** 单条规则是否命中当前上下文 */
export function ruleMatches(rule: McRule, ctx: McRuleContext): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== ctx.os) return false
    if (rule.os.arch && rule.os.arch !== ctx.arch) return false
    if (rule.os.version && ctx.osVersion) {
      try {
        if (!new RegExp(rule.os.version).test(ctx.osVersion)) return false
      } catch {
        return false
      }
    }
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if ((ctx.features?.[key] ?? false) !== expected) return false
    }
  }
  return true
}

/** 规则数组求值：空规则=允许；命中的最后一条规则决定结果 */
export function evaluateRules(rules: McRule[] | undefined, ctx: McRuleContext): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    if (ruleMatches(rule, ctx)) allowed = rule.action === 'allow'
  }
  return allowed
}

/** 该库在当前平台适用的普通制品下载；不适用返回 null */
export function libraryArtifactDownload(lib: McLibrary, ctx: McRuleContext): McDownload | null {
  if (!evaluateRules(lib.rules, ctx)) return null
  const artifact = lib.downloads?.artifact
  if (!artifact?.url) return null
  return artifact
}

/** natives 分类器名（将 ${arch} 展开为 32/64/arm64） */
export function nativeClassifier(lib: McLibrary, os: McOsName, arch: McArch): string | null {
  const tmpl = lib.natives?.[os]
  if (!tmpl) return null
  const archToken = arch === 'x64' ? '64' : arch === 'arm64' ? 'arm64' : '32'
  return tmpl.replace(/\$\{arch\}/g, archToken)
}

/** 该库在当前平台适用的 natives 下载；不适用返回 null */
export function nativeDownload(
  lib: McLibrary,
  ctx: McRuleContext
): { classifier: string; download: McDownload; exclude: string[] } | null {
  if (!evaluateRules(lib.rules, ctx)) return null
  const classifier = nativeClassifier(lib, ctx.os, ctx.arch)
  if (!classifier) return null
  const download = lib.downloads?.classifiers?.[classifier]
  if (!download?.url) return null
  return { classifier, download, exclude: lib.extract?.exclude ?? [] }
}

/** 类路径分隔符 */
export function classpathSeparator(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? ';' : ':'
}

/** 参数占位符替换（未知占位符替换为空串） */
export function substituteArg(arg: string, vars: Record<string, string>): string {
  return arg.replace(/\$\{([^}]+)\}/g, (_m, key: string) => vars[key] ?? '')
}

/** 参数条目数组 → 展开后的参数列表（应用规则与占位符替换） */
export function buildArgList(
  entries: McArgumentEntry[],
  ctx: McRuleContext,
  vars: Record<string, string>
): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      out.push(substituteArg(entry, vars))
      continue
    }
    if (entry.rules && !evaluateRules(entry.rules, ctx)) continue
    const values = Array.isArray(entry.value) ? entry.value : [entry.value]
    for (const value of values) out.push(substituteArg(value, vars))
  }
  return out
}

/** 旧结构 minecraftArguments（空格分隔）→ 参数列表 */
export function parseLegacyGameArgs(raw: string | undefined): McArgumentEntry[] {
  if (!raw) return []
  return raw.split(/\s+/).filter(Boolean)
}

/** 启动参数拼装所需的实例路径与运行环境 */
export interface McLaunchSpecInput {
  detail: McVersionDetail
  /** 实例目录（${game_directory}） */
  gameDir: string
  /** 客户端 jar 绝对路径 */
  clientJar: string
  /** 库根目录 */
  librariesDir: string
  /** 已就绪库的相对路径（含客户端 jar 之外的 classpath 项，不含 natives） */
  libraryRelPaths: string[]
  /** natives 解包目录 */
  nativesDir: string
  /** 资产根目录 */
  assetsDir: string
  /** 账号/会话占位符（auth_player_name 等）；缺省给安全占位值 */
  vars?: Record<string, string>
  /** 附加 JVM 参数（内存等），追加在原版 JVM 参数之前 */
  extraJvmArgs?: string[]
  features?: Record<string, boolean>
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  osVersion?: string
  /** 启动器名/版本（${launcher_name}/${launcher_version}） */
  launcherName?: string
  launcherVersion?: string
}

/** 拼装结果：主类 + 类路径 + JVM/游戏参数（供启动器直接 spawn java） */
export interface McLaunchSpec {
  mainClass: string
  classpath: string[]
  jvmArgs: string[]
  gameArgs: string[]
}

/**
 * 依据版本 JSON 与实例路径拼装完整启动参数。
 * 类路径 = 原版库 + 客户端 jar（保持原版库在前、客户端 jar 在后的惯例）。
 */
export function assembleLaunchSpec(input: McLaunchSpecInput): McLaunchSpec {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const os = platformOsName(platform)
  const mcArch = platformMcArch(arch)
  const sep = classpathSeparator(platform)
  const ctx: McRuleContext = {
    os,
    arch: mcArch,
    osVersion: input.osVersion ?? osRelease(),
    features: input.features
  }
  const { detail } = input
  const clientJar = input.clientJar
  const classpath = [
    ...input.libraryRelPaths.map((rel) => `${input.librariesDir}/${rel}`),
    clientJar
  ]
  const vars: Record<string, string> = {
    natives_directory: input.nativesDir,
    launcher_name: input.launcherName ?? 'KunYu Studio',
    launcher_version: input.launcherVersion ?? '0.1',
    classpath: classpath.join(sep),
    classpath_separator: sep,
    library_directory: input.librariesDir,
    version_name: detail.id,
    assets_index_name: detail.assets,
    assets_root: input.assetsDir,
    game_directory: input.gameDir,
    auth_player_name: 'Player',
    auth_uuid: '00000000000000000000000000000000',
    auth_access_token: '0',
    auth_session: '0',
    user_type: 'legacy',
    version_type: detail.type ?? 'release',
    resolution_width: '854',
    resolution_height: '480',
    ...(input.vars ?? {})
  }

  const jvmArgs: string[] = [...(input.extraJvmArgs ?? [])]
  if (detail.arguments?.jvm) {
    jvmArgs.push(...buildArgList(detail.arguments.jvm, ctx, vars))
  } else {
    // 旧版本无 jvm 参数块：给出最小可用默认（natives + 类路径）
    jvmArgs.push(
      `-Djava.library.path=${input.nativesDir}`,
      '-cp',
      classpath.join(sep)
    )
  }

  const gameArgs: string[] = detail.arguments?.game
    ? buildArgList(detail.arguments.game, ctx, vars)
    : buildArgList(parseLegacyGameArgs(detail.minecraftArguments), ctx, vars)

  return { mainClass: detail.mainClass, classpath, jvmArgs, gameArgs }
}
