/**
 * CurseForge gameVersions 匹配（M18）。
 * CF 上传需要 gameVersions 数字 ID 列表（MC 版本 + 加载器），
 * 本模块负责把「1.20.1 / fabric」映射到 CF 版本条目。
 * 纯函数：不猜测，匹配失败返回前 20 个建议供用户人工选择。
 */

export interface CfGameVersion {
  id: number
  name: string
  slug?: string
  gameVersionTypeID?: number
}

export interface CfVersionMatch {
  /** MC 版本条目（如 1.20.1）；未匹配为 null */
  mcVersion: CfGameVersion | null
  /** 加载器条目（如 Fabric/Forge/NeoForge）；未匹配为 null */
  loader: CfGameVersion | null
  /** 匹配失败时的候选建议（前 20 个名称），便于 UI 展示人工选择 */
  suggestions: string[]
}

const LOADER_NAMES: Record<string, string[]> = {
  fabric: ['fabric'],
  forge: ['forge'],
  neoforge: ['neoforge', 'neo forge'],
  quilt: ['quilt']
}

/**
 * 精确名匹配 MC 版本 + 加载器名匹配。
 * @param all CF 全量 gameVersions 列表
 * @param mcVersion 如 '1.20.1'
 * @param loader 如 'fabric'
 */
export function matchCfGameVersions(
  all: CfGameVersion[],
  mcVersion: string,
  loader: string
): CfVersionMatch {
  const mc = all.find((v) => v.name === mcVersion) ?? null
  const aliases = LOADER_NAMES[loader.toLowerCase()] ?? [loader.toLowerCase()]
  const loaderEntry =
    all.find((v) => aliases.includes(v.name.toLowerCase())) ?? null
  const suggestions =
    mc && loaderEntry
      ? []
      : all
          .filter((v) => /^\d+\.\d+/.test(v.name))
          .slice(0, 20)
          .map((v) => v.name)
  return { mcVersion: mc, loader: loaderEntry, suggestions }
}
