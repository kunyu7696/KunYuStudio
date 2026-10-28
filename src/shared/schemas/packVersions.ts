/**
 * 包类项目（资源包/数据包/光影包）MC 版本白名单单一真源（P0-4）。
 *
 * 此前包类可选版本散落四份：datapack.schema 的 PACK_FORMATS 键集、
 * resourcepack/formats 的 RESOURCE_PACK_FORMATS 键集、shaderpack.schema 的
 * VALID_MC_VERSIONS，以及新建向导从「模组版本矩阵」派生的版本列表——
 * 向导可选 1.21.6+，但数据包/光影包初始化只认 ≤1.21.5，所选版本必然失败。
 *
 * 本模块从各包类真实格式表键集派生白名单（不另手列，杜绝漂移），并提供
 * 「向下取最近合法版本」的回退函数；向导滚轮与 projectService 守卫统一走这里。
 */
import { PACK_FORMATS } from './datapack.schema'
import { RESOURCE_PACK_FORMATS } from './resourcepack/formats'
import { VALID_MC_VERSIONS } from './shaderpack.schema'

export type PackType = 'resourcepack' | 'datapack' | 'shaderpack'

/** MC 版本升序比较（. 分段数值；段缺失按 0 补齐） */
export function comparePackMcVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** 各包类合法 MC 版本白名单（升序）；键集直接取自真实格式表/合法集 */
export const PACK_TYPE_MC_VERSIONS: Record<PackType, string[]> = {
  resourcepack: Object.keys(RESOURCE_PACK_FORMATS).sort(comparePackMcVersion),
  datapack: Object.keys(PACK_FORMATS).sort(comparePackMcVersion),
  shaderpack: [...VALID_MC_VERSIONS].sort(comparePackMcVersion)
}

/**
 * 向下取最近合法包类版本：raw 合法则原样返回；否则取白名单中小于 raw 的
 * 最大版本（如 resourcepack 的 1.21.10 → 1.21.9）；全部不小于 raw 时取最小版本。
 * 杜绝「非法值原样透传到 init 才报错、已建目录被清理」的路径。
 */
export function nearestPackMcVersion(type: PackType, raw: string): string {
  const list = PACK_TYPE_MC_VERSIONS[type]
  if (list.includes(raw)) return raw
  const below = list.filter((v) => comparePackMcVersion(v, raw) < 0)
  return below.length ? below[below.length - 1] : list[0]
}
