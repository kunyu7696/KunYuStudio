/**
 * 整合包双平台清单构建（纯函数）。
 * CurseForge 与 Modrinth 清单骨架在建项目时已写入，组装时只重写 files[] 与 dependencies，
 * 其余字段（名称、版本、overrides 目录等）原样沿用。
 */
import type { ModLoader } from '../../../shared/types/project'
import type {
  CurseForgeFileEntry,
  ModJarPlan,
  ModSourceEntry,
  ModrinthFileEntry
} from '../../../shared/types/modpack'

/** JSON 对象（清单骨架经 JSON.parse 后的形态） */
export type JsonObject = Record<string, unknown>

/** CurseForge 加载器 id 约定：fabric-0.15.11 / forge-47.2.0 / neoforge-20.4.237 */
export function curseForgeLoaderId(loader: ModLoader, loaderVersion: string | null): string {
  return loaderVersion ? `${loader}-${loaderVersion}` : loader
}

/** Modrinth dependencies 的加载器键名约定 */
export function modrinthLoaderKey(loader: ModLoader): string {
  return loader === 'fabric' ? 'fabric-loader' : loader
}

/** CF 清单 minecraft 段所需项目元数据 */
export interface CurseForgeManifestMeta {
  mcVersion: string
  loader: ModLoader
  loaderVersion: string | null
}

/**
 * 重写 CurseForge manifest.json。
 * 不仅重写 files[]（旧实现只做这一步，骨架中的 minecraft 模板默认值会导致装错版本）：
 * meta 非空时一并重写 minecraft.version 与 modLoaders，以项目记录为权威。
 */
export function buildCurseForgeManifest(
  base: JsonObject,
  files: CurseForgeFileEntry[],
  meta?: CurseForgeManifestMeta
): JsonObject {
  // P-01：骨架缺失/损坏时回落最小合法骨架，避免导出的清单缺 manifestType 等必需字段。
  const result: JsonObject = {
    manifestType: 'minecraftModpack',
    manifestVersion: 1,
    name: 'modpack',
    version: '1.0.0',
    ...base,
    files: files.map((f) => ({ ...f }))
  }
  if (meta) {
    const prevMc =
      base.minecraft && typeof base.minecraft === 'object' && !Array.isArray(base.minecraft)
        ? (base.minecraft as JsonObject)
        : {}
    result.minecraft = {
      ...prevMc,
      version: meta.mcVersion,
      modLoaders: meta.loaderVersion
        ? [{ id: curseForgeLoaderId(meta.loader, meta.loaderVersion), primary: true }]
        : []
    }
  }
  return result
}

/** 从骨架 dependencies 中提取字符串值 */
function readDeps(base: JsonObject): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = base.dependencies
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as JsonObject)) {
      if (typeof v === 'string' && v) out[k] = v
    }
  }
  return out
}

/**
 * 构建 Modrinth modrinth.index.json。
 * `minecraft` 依赖以项目登记的 MC 版本为准（清单缺它会装不上）。
 * loaderVersion 为 null 时**省略**加载器键（不能写空串，启动器会解析失败）并给出告警。
 */
export function buildModrinthIndex(
  base: JsonObject,
  loader: ModLoader,
  loaderVersion: string | null,
  mcVersion: string,
  files: ModrinthFileEntry[]
): { index: JsonObject; warnings: string[] } {
  const warnings: string[] = []
  const dependencies = readDeps(base)
  const loaderKey = modrinthLoaderKey(loader)
  dependencies.minecraft = mcVersion

  if (loaderVersion) {
    dependencies[loaderKey] = loaderVersion
  } else {
    if (dependencies[loaderKey]) delete dependencies[loaderKey]
    warnings.push(
      `项目未登记加载器版本，Modrinth 清单已省略 ${loaderKey} 键；请在项目设置中补全后重新组装。`
    )
  }

  return {
    // P-01：骨架缺失/损坏时回落最小合法骨架（formatVersion/game 是 Modrinth 清单必需字段）
    index: { formatVersion: 1, game: 'minecraft', ...base, dependencies, files: files.map((f) => ({ ...f })) },
    warnings
  }
}

/**
 * 生成包内 README：EULA 合规说明 + 模组来源表。
 * 第三方 jar 随包分发必须显式标注来源与许可归属。
 */
export function buildModpackReadme(
  name: string,
  mcVersion: string,
  loader: ModLoader,
  loaderVersion: string | null,
  jars: ModJarPlan[],
  sources: Map<string, ModSourceEntry>
): string {
  const lines: string[] = [
    `# ${name}（整合包）`,
    '',
    `- Minecraft：${mcVersion}`,
    `- 加载器：${loader}${loaderVersion ? ` ${loaderVersion}` : '（版本未登记）'}`,
    '- `manifest.json`：CurseForge 清单（MC 版本、加载器、模组下载坐标）',
    '- `modrinth.index.json`：Modrinth 清单',
    '- `overrides/`：配置覆盖目录，安装时覆盖到游戏目录',
    ''
  ]

  if (jars.length > 0) {
    lines.push('## 模组来源', '', '| 文件 | 平台 | 项目 | 版本 | 分发方式 |', '| --- | --- | --- | --- | --- |')
    for (const jar of jars) {
      const src = sources.get(jar.fileName)
      const platform = src ? src.platform : '未知'
      const project = src && (src.slug || src.name) ? src.slug || src.name : '—'
      const version = src && src.versionNumber ? src.versionNumber : '—'
      const how = !jar.bundledInOverrides
        ? '清单下载'
        : jar.env.server === 'unsupported'
          ? '随包（client-overrides/mods，仅客户端）'
          : jar.env.client === 'unsupported'
            ? '随包（server-overrides/mods，仅服务端）'
            : '随包（overrides/mods）'
      lines.push(`| ${jar.fileName} | ${platform} | ${project} | ${version} | ${how} |`)
    }
    lines.push('')
  }

  lines.push(
    '## 合规说明',
    '',
    '本整合包不包含 Minecraft 游戏本体（client.jar / server.jar 等）。依据 Mojang EULA，',
    '游戏文件由启动器在安装时按清单声明的版本自行下载，禁止再分发客户端 jar。',
    '',
    '随包分发的第三方模组版权归各自作者所有，请遵守其许可协议；'
      + '若需二次分发，请先确认各模组的再分发许可。',
    ''
  )
  return lines.join('\n')
}