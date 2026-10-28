/**
 * 资源包版本格式单一真源。
 *
 * pack_format 数值表、版本选项与表单提示同出此文件，避免 UI hint
 * 与真实映射不一致（如曾把 1.21.1 资源包格式误写为 48，实际为 34）。
 * 本文件为叶子模块（无项目内依赖），供 resourcepack.schema 与
 * resourcepack/packMeta.schema 共用，不产生循环依赖。
 */
import { sharedT, type SharedLocale } from '../../i18n'

/**
 * MC 版本 → pack_format（资源包，官方口径）。
 * 覆盖矩阵 8 版本 + 1.21.4~1.21.9（独立资源包项目可选）。
 */
export const RESOURCE_PACK_FORMATS: Record<string, number> = {
  '1.16.5': 6,
  '1.18.2': 8,
  '1.19.2': 9,
  '1.20.1': 15,
  '1.20.4': 22,
  '1.20.6': 32,
  '1.21.1': 34,
  '1.21.3': 42,
  '1.21.4': 46,
  '1.21.5': 55,
  '1.21.6': 63,
  '1.21.7': 64,
  '1.21.8': 64,
  '1.21.9': 69
}

/** 创建表单可选版本（label 与映射表一致） */
export const RESOURCE_PACK_VERSIONS: { value: string; label: string }[] = [
  { value: '1.16.5', label: '1.16.5（pack_format 6）' },
  { value: '1.18.2', label: '1.18.2（pack_format 8）' },
  { value: '1.19.2', label: '1.19.2（pack_format 9）' },
  { value: '1.20.1', label: '1.20.1（pack_format 15）' },
  { value: '1.20.4', label: '1.20.4（pack_format 22）' },
  { value: '1.20.6', label: '1.20.6（pack_format 32）' },
  { value: '1.21.1', label: '1.21.1（pack_format 34）' },
  { value: '1.21.3', label: '1.21.3（pack_format 42）' },
  { value: '1.21.4', label: '1.21.4（pack_format 46）' },
  { value: '1.21.5', label: '1.21.5（pack_format 55）' },
  { value: '1.21.6', label: '1.21.6（pack_format 63）' },
  { value: '1.21.7', label: '1.21.7（pack_format 64）' },
  { value: '1.21.8', label: '1.21.8（pack_format 64）' },
  { value: '1.21.9', label: '1.21.9（pack_format 69）' }
]

/**
 * pack_format 表单提示：由映射表选取常用版本动态生成，
 * 不再手写，杜绝版本数字漂移。
 */
export function resourcePackFormatHint(locale?: SharedLocale): string {
  const pairs = Object.entries(RESOURCE_PACK_FORMATS)
    .filter(([version]) => version === '1.20.1' || version === '1.21.1')
    .map(([version, fmt]) => `${version} = ${fmt}`)
    .join('，')
  return sharedT('schema.rp.formats.formatHint', { pairs }, locale)
}
