/**
 * 模组许可协议（license）与再分发合规判定。
 *
 * 动机：整合包把第三方模组 jar 物理打进 overrides 属于「再分发」行为，
 * 是否合规取决于该模组的许可协议——MIT/Apache 类宽松许可允许，GPL 类 copyleft
 * 附条件许可，ARR（保留所有权利）/专有许可原则上禁止。此前组装器只有一句总括提醒，
 * 不知道每个 jar 的具体许可，合规风险不可见。
 *
 * 本模块只做分类与告警文案（纯函数），许可数据由市场详情链路
 * （marketService → 来源记录 ModSourceEntry.license）落盘供给；
 * CurseForge API 不返回许可字段，该类记录按 unknown 处理（不臆测）。
 */

/** 再分发合规四分类 */
export type RedistributionClass = 'permissive' | 'copyleft' | 'restricted' | 'unknown'

/** 宽松许可（允许再分发，只需保留声明）：SPDX id 归一化后精确匹配 */
const PERMISSIVE = new Set([
  'mit', 'mit-0', 'apache-2.0', 'apache-1.1', 'bsd', 'bsd-1-clause', 'bsd-2-clause',
  'bsd-3-clause', '0bsd', 'isc', 'zlib', 'unlicense', 'wtfpl', 'cc0-1.0', 'cc0',
  'bsl-1.0', 'artistic-2.0', 'postgresql', 'ncsa', 'python-2.0', 'public-domain'
])

/** copyleft 许可（允许再分发但附条件：保留声明/相同许可/提供源码等）——前缀匹配覆盖版本变体 */
const COPYLEFT_PREFIX = [
  'gpl', 'lgpl', 'agpl', 'mpl', 'epl', 'eupl', 'cc-by-sa', 'osl', 'cddl', 'ms-rl',
  'cc-by-nc-sa' // 含 NC（非商业）实际上是「非商业限制性 copyleft」，分发整合包通常免费，仍按 copyleft 提示条件
]

/** 归一化许可串：小写、去首尾空白、下划线/空格折叠为连字符 */
export function normalizeLicenseId(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

/**
 * 判定许可的再分发合规类别。判不出的一律 unknown（保守：不臆测、不误放行）。
 * - restricted：ARR / 专有 / LicenseRef-*（平台自定义许可引用，内容未知按限制对待）
 * - copyleft：GPL/LGPL/MPL 等（可再分发但有条件）
 * - permissive：MIT/Apache/BSD 等
 */
export function classifyRedistribution(license: string | null | undefined): RedistributionClass {
  const id = normalizeLicenseId(license)
  if (!id) return 'unknown'
  if (id === 'arr' || id.includes('all-rights-reserved')) return 'restricted'
  if (id.startsWith('licenseref')) return 'restricted'
  if (id === 'proprietary' || id === 'custom' || id === 'none' || id === 'unlicensed') return 'restricted'
  if (PERMISSIVE.has(id)) return 'permissive'
  // copyleft 前缀匹配：gpl-2.0 / gpl-3.0-only / lgplv3 等一并覆盖
  if (COPYLEFT_PREFIX.some((p) => id === p || id.startsWith(p))) return 'copyleft'
  // CC 系列其余形态（by / by-nc / by-nd / by-nc-nd 等）：ND（禁止演绎）不适合随包改分发，NC 限制商业，
  // 保守归 restricted 提示人工确认，而非误报放行
  if (id.startsWith('cc-')) return 'restricted'
  return 'unknown'
}

/**
 * 单个随包（overrides）jar 的合规告警；无需告警时返回 null。
 * 文案三档：
 * - restricted：强提示（原则上禁止再分发，建议改平台清单引用或取得授权）
 * - copyleft：条件提示（可分发但须遵守该许可义务）
 * - unknown：轻提示（无许可数据，人工确认）——调用方负责合并避免刷屏
 */
export function redistributionWarning(
  fileName: string,
  license: string | null | undefined,
  cls: RedistributionClass
): string | null {
  const label = license?.trim() || '未知'
  switch (cls) {
    case 'restricted':
      return (
        `${fileName} 的许可为 ${label}（保留所有权利/专有或自定义许可）：` +
        '原则上不允许随包再分发。建议改为平台清单引用（CurseForge/Modrinth files），或取得作者书面授权后再分发。'
      )
    case 'copyleft':
      return (
        `${fileName} 的许可为 ${label}（copyleft）：可再分发但须遵守其义务` +
        '（保留版权与许可声明、相同方式共享、提供源码获取途径等），请在整合包说明中注明。'
      )
    case 'unknown':
      return (
        `${fileName} 无许可协议数据（CurseForge API 不提供该字段或为旧安装记录）：` +
        '随包再分发前请人工到其项目主页确认许可。'
      )
    default:
      return null
  }
}

/**
 * 汇总一组「文件名 → 许可串」的随包合规告警（供组装计划 warnings 使用）。
 * restricted/copyleft 逐条列出；unknown 合并为一条（许可数据缺失很常见，逐条会刷屏）。
 */
export function collectRedistributionWarnings(
  bundled: Array<{ fileName: string; license?: string | null }>
): string[] {
  const warnings: string[] = []
  const unknowns: string[] = []
  for (const item of bundled) {
    const cls = classifyRedistribution(item.license)
    if (cls === 'permissive') continue
    if (cls === 'unknown') {
      unknowns.push(item.fileName)
      continue
    }
    const w = redistributionWarning(item.fileName, item.license, cls)
    if (w) warnings.push(w)
  }
  if (unknowns.length > 0) {
    warnings.push(
      `${unknowns.length} 个随包模组无许可协议数据（${unknowns.slice(0, 5).join('、')}${unknowns.length > 5 ? ' 等' : ''}）：` +
      'CurseForge API 不返回许可字段，随包再分发前请人工确认各模组许可。'
    )
  }
  return warnings
}
