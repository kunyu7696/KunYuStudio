/**
 * 数据包目录单点映射。
 *
 * 1.21（快照 24w21a）起，Mojang 将数据包内数据注册表目录与标签目录由
 * 复数改为与注册表同名：
 *   recipes → recipe，loot_tables → loot_table，advancements → advancement，
 *   structures → structure，predicates → predicate，item_modifiers → item_modifier，
 *   functions → function；tags/blocks → tags/block，tags/items → tags/item，
 *   tags/entity_types → tags/entity_type，tags/fluids → tags/fluid，
 *   tags/game_events → tags/game_event。
 *
 * 本模块只做字符串映射，不依赖具体版本联合类型，供主进程内容生成器、
 * AI FC 工具与数据包编辑器共用，避免同一目录名在多处硬编码、只改一半。
 */

/** mcVersion 是否为 1.21 或更高（含 24w21a 及以后快照）。无法解析时按旧版本处理。 */
export function isMc121OrLater(mcVersion: string): boolean {
  const v = mcVersion.trim()
  const snapshot = /^(\d{2})w(\d{2})[a-z]?/i.exec(v)
  if (snapshot) {
    const year = Number(snapshot[1])
    const week = Number(snapshot[2])
    return year > 24 || (year === 24 && week >= 21)
  }
  const release = /^(\d+)\.(\d+)/.exec(v)
  if (release) {
    const major = Number(release[1])
    const minor = Number(release[2])
    return major > 1 || (major === 1 && minor >= 21)
  }
  return false
}

/**
 * mcVersion 是否为 1.20.5 或更高（含 24w09a 及以后快照）。
 * 1.20.5 起，配方 result 的 item 字段改名为 id；advancement icon 同理。
 */
export function isMc1205OrLater(mcVersion: string): boolean {
  const v = mcVersion.trim()
  const snapshot = /^(\d{2})w(\d{2})[a-z]?/i.exec(v)
  if (snapshot) {
    const year = Number(snapshot[1])
    const week = Number(snapshot[2])
    return year > 24 || (year === 24 && week >= 9)
  }
  const release = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v)
  if (release) {
    const major = Number(release[1])
    const minor = Number(release[2])
    const patch = release[3] ? Number(release[3]) : 0
    if (major > 1) return true
    if (major < 1) return false
    if (minor > 20) return true
    if (minor < 20) return false
    return patch >= 5
  }
  return false
}

/**
 * mcVersion 是否为 1.21.2 或更高（含 24w33a 及以后快照）。
 * 1.21.2 起，配方 ingredient/key/ingredients 的对象形式 {item:...} 失效，
 * 改为纯字符串（"minecraft:diamond" 或 "#minecraft:logs"）。
 */
export function isMc1212OrLater(mcVersion: string): boolean {
  const v = mcVersion.trim()
  const snapshot = /^(\d{2})w(\d{2})[a-z]?/i.exec(v)
  if (snapshot) {
    const year = Number(snapshot[1])
    const week = Number(snapshot[2])
    return year > 24 || (year === 24 && week >= 33)
  }
  const release = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(v)
  if (release) {
    const major = Number(release[1])
    const minor = Number(release[2])
    const patch = release[3] ? Number(release[3]) : 0
    if (major > 1) return true
    if (major < 1) return false
    if (minor > 21) return true
    if (minor < 21) return false
    return patch >= 2
  }
  return false
}

/** 数据注册表目录（位于 data/<namespace>/ 下） */
export type DataRegistryKind =
  | 'recipe'
  | 'loot_table'
  | 'advancement'
  | 'structure'
  | 'predicate'
  | 'item_modifier'
  | 'function'
  | 'enchantment'

const DATA_PLURAL: Record<DataRegistryKind, string> = {
  recipe: 'recipes',
  loot_table: 'loot_tables',
  advancement: 'advancements',
  structure: 'structures',
  predicate: 'predicates',
  item_modifier: 'item_modifiers',
  function: 'functions',
  enchantment: 'enchantments'
}

/**
 * 数据注册表目录名：1.20.x 及更早为复数，1.21+ 与注册表同名（单数）。
 * 注意：loot_table 的子目录 blocks/items/entities 跨版本不变（仍为复数），
 * 调用方拼接子目录时不要走本映射。
 */
export function dataPath(kind: DataRegistryKind, mcVersion: string): string {
  return isMc121OrLater(mcVersion) ? kind : DATA_PLURAL[kind]
}

/** 标签注册表（tags/<registry>/）目录段 */
export type TagRegistryKind =
  | 'block'
  | 'item'
  | 'entity_type'
  | 'fluid'
  | 'game_event'
  | 'enchantment'

const TAG_PLURAL: Record<TagRegistryKind, string> = {
  block: 'blocks',
  item: 'items',
  entity_type: 'entity_types',
  fluid: 'fluids',
  game_event: 'game_events',
  enchantment: 'enchantments'
}

/** 标签目录段：1.20.x 及更早为复数，1.21+ 与注册表同名。 */
export function tagRegistryPath(kind: TagRegistryKind, mcVersion: string): string {
  return isMc121OrLater(mcVersion) ? kind : TAG_PLURAL[kind]
}
