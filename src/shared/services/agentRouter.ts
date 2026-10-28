/**
 * AgentRouter 档位路由（M8，依《完整架构与代码文档》7.1）。
 *
 * 纯函数、零依赖，渲染层可预览路由结果，主进程 run 时生效。
 * 优先级：用户手动选择的档位（explicit）> 关键词路由 > 默认匠造。
 */
import { type TierId, type TierRoute } from '../types/tiers'

/** 关键词路由表：从上到下首个命中的档位生效（更特殊的意图放前面） */
const ROUTE_RULES: Array<{ tier: TierId; words: string[] }> = [
  {
    tier: 'weaver',
    // 材质包/光影包不是整合包——'光影包' 由 master 的 '光影' 兜住，
    // '材质包' 落默认匠造档；裸 '整合' 过宽（"整合配置"类语句误路由）已收紧
    words: ['整合包', 'modpack', 'mod包', '模组包', '数据包合集']
  },
  {
    tier: 'bridge',
    words: [
      '迁移',
      '移植',
      '转换',
      '兼容',
      'forge 转 fabric',
      'forge转fabric',
      'fabric 转 forge',
      'fabric转forge',
      '升级到',
      '降级到',
      '旧版本',
      '迁移到'
    ]
  },
  {
    tier: 'master',
    words: [
      'mixin',
      '混入',
      '维度',
      'dimension',
      'boss',
      '光影',
      'shader',
      '世界生成',
      'worldgen',
      '复杂',
      '深度',
      '性能优化',
      '大型'
    ]
  },
  {
    tier: 'sprinter',
    // '一个' 不入表——"做一个X"是最常见句式，命中最低档会
    // 系统性压低常见需求的档位（5/5 打到迅工）；显式的小改意图才走迅工
    words: ['简单', '单个', '改一下', '改一下下', '小的', '快速']
  }
]

/** 默认档：匠造（对话驱动，均衡） */
export const DEFAULT_TIER: TierId = 'artisan'

/**
 * 路由用户请求到五档之一。
 * @param message 用户原话（关键词匹配来源）
 * @param explicit 用户在面板手动选择的档位；null/undefined 表示自动路由
 */
export function routeTier(message: string, explicit?: TierId | null): TierRoute {
  if (explicit) return { tier: explicit, matched: [] }
  const text = (message || '').toLowerCase()
  for (const rule of ROUTE_RULES) {
    const matched = rule.words.filter((w) => text.includes(w.toLowerCase()))
    if (matched.length > 0) {
      return { tier: rule.tier, matched: [...new Set(matched)].slice(0, 3) }
    }
  }
  return { tier: DEFAULT_TIER, matched: [] }
}
