/**
 * TaCZ 死亡消息（TACZDeathMessage）配置——共享类型。
 *
 * 两个配置文件都在 config/taczdeathmessage/ 下：
 * - global_config.json：全局默认消息 + 是否默认对所有世界启用
 * - world_config.json：按维度覆盖的消息与启用状态
 *
 * 消息占位符：{killer} 击杀者、{victim} 被击杀者、{gun} 使用的枪械。
 * 颜色/格式代码沿用 MC 的 &0~&f 与 &l/&o/&n/&m/&r。
 */

/** 普通击杀 + 爆头击杀两条消息 */
export interface TaczMessagePair {
  /** 普通击杀消息 */
  normal: string
  /** 爆头击杀消息 */
  headshot: string
}

/** 玩家击杀 / 动物击杀两组消息 */
export interface TaczMessages {
  player: TaczMessagePair
  animal: TaczMessagePair
}

/** global_config.json */
export interface TaczGlobalConfig {
  /** 未单独配置的世界是否默认启用 */
  defaultWorldEnabled: boolean
  messages: TaczMessages
  /** 爆头时追加的后缀（可为空） */
  headshotSuffix: string
}

/** world_config.json 里单个世界的配置 */
export interface TaczWorldConfig {
  enabled: boolean
  messages: TaczMessages
}

/** world_config.json 整体（键为维度 ID，如 minecraft:overworld） */
export interface TaczWorldsFile {
  worlds: Record<string, TaczWorldConfig>
}

/** 读取结果：两份配置 + 路径 + 是否存在 */
export interface TaczDeathReadResult {
  global: TaczGlobalConfig
  worlds: TaczWorldsFile
  globalPath: string
  worldPath: string
  /** 文件是否已存在（不存在时为默认值，保存才落盘） */
  exists: {
    global: boolean
    world: boolean
  }
  /** 解析/读取错误（有值时 global/worlds 为默认值） */
  error?: string
}

/** 默认消息模板——与模组自带示例一致，中文语境 */
export const TACZ_DEFAULT_GLOBAL: TaczGlobalConfig = {
  defaultWorldEnabled: true,
  messages: {
    player: {
      normal: '&e{killer} 击杀了 &e{victim}！',
      headshot: '&e{killer} 爆头击杀了 &e{victim}！'
    },
    animal: {
      normal: '&e{killer} 用 {gun} 猎杀了 &e{victim}！',
      headshot: '&e{killer} 用 {gun} 精准猎杀了 &e{victim}！'
    }
  },
  headshotSuffix: '（爆头）'
}

export const TACZ_DEFAULT_WORLD: TaczWorldConfig = {
  enabled: true,
  messages: {
    player: {
      normal: '&a[PvP] &e{killer} 击败了 {victim}！',
      headshot: '&a[PvP] &e{killer} 爆头击败了 {victim}！'
    },
    animal: {
      normal: '&e{killer} 用 {gun} 猎杀了 &e{victim}！',
      headshot: '&e{killer} 用 {gun} 精准猎杀了 &e{victim}！'
    }
  }
}
