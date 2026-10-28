import { describe, expect, it } from 'vitest'
import { DEFAULT_TIER, routeTier } from '../agentRouter'

/**
 * 档位路由规则（M8 档位选择功能的判定核心）：
 * 用户手动选择 > 关键词路由 > 默认匠造。
 * 渲染层卡片点选传入的 explicit 必须压过任何关键词，
 * 这正是“点了几下都是迅工”回归的根因防线。
 */
describe('routeTier 档位路由', () => {
  describe('手动档位优先', () => {
    it('explicit 指定的档位直接生效，且不报告命中关键词', () => {
      const r = routeTier('帮我做一个整合包', 'sprinter')
      expect(r.tier).toBe('sprinter')
      expect(r.matched).toEqual([])
    })

    it('即使消息含其他档关键词，手动档也不被改写', () => {
      expect(routeTier('做个 modpack 整合', 'master').tier).toBe('master')
      expect(routeTier('把 forge 转成 fabric', 'weaver').tier).toBe('weaver')
      expect(routeTier('写一个 mixin 维度', 'artisan').tier).toBe('artisan')
    })
  })

  describe('自动关键词路由', () => {
    it('整合包类需求路由到织星 weaver', () => {
      const r = routeTier('帮我做一个冒险整合包')
      expect(r.tier).toBe('weaver')
      expect(r.matched).toContain('整合包')
    })

    it('英文关键词大小写不敏感：MODPACK → weaver', () => {
      const r = routeTier('please build a MODPACK for me')
      expect(r.tier).toBe('weaver')
      expect(r.matched).toContain('modpack')
    })

    it('版本迁移 / loader 转换路由到桥接 bridge', () => {
      expect(routeTier('把模组迁移到 1.20.4').tier).toBe('bridge')
      expect(routeTier('forge转fabric 兼容').tier).toBe('bridge')
    })

    it('复杂特性路由到大师 master', () => {
      const r = routeTier('新增一个自定义 BOSS 和维度')
      expect(r.tier).toBe('master')
      expect(r.matched).toEqual(expect.arrayContaining(['boss', '维度']))
    })

    it('规则顺序：同时命中 master 与 sprinter 关键词时 master 优先（更特殊在前）', () => {
      // 'mixin' 是大师词；master 规则排在 sprinter 之前
      expect(routeTier('写一个 mixin').tier).toBe('master')
    })

    it('"做一个X" 是最常见句式，不再因"一个"命中最低档迅工', () => {
      const r = routeTier('帮我做一个 Ruby 物品')
      expect(r.tier).toBe('artisan')
      expect(r.matched).toEqual([])
    })

    it('简单小改路由到迅工 sprinter', () => {
      const r = routeTier('简单改一下这个配方')
      expect(r.tier).toBe('sprinter')
      expect(r.matched).toContain('简单')
    })

    it('无命中时落到默认档匠造 artisan', () => {
      expect(DEFAULT_TIER).toBe('artisan')
      expect(routeTier('今天天气不错').tier).toBe('artisan')
    })
  })

  describe('边界', () => {
    it('explicit 为 null / undefined 时走自动路由', () => {
      expect(routeTier('做整合包', null).tier).toBe('weaver')
      expect(routeTier('做整合包', undefined).tier).toBe('weaver')
    })

    it('空消息落到默认档且无命中词', () => {
      const r = routeTier('')
      expect(r.tier).toBe('artisan')
      expect(r.matched).toEqual([])
    })

    it('命中词去重且最多回传 3 个', () => {
      const r = routeTier('整合整合包 mod包 模组包 数据包合集')
      expect(r.tier).toBe('weaver')
      expect(r.matched.length).toBeLessThanOrEqual(3)
      expect(new Set(r.matched).size).toBe(r.matched.length)
    })

    it('材质包/光影包不是整合包，不再误路由到织星档', () => {
      // '光影包' 含 master 词 '光影' → 大师档
      expect(routeTier('做一个光影包').tier).toBe('master')
      // '材质包' 无命中 → 默认匠造档
      expect(routeTier('做一个材质包').tier).toBe('artisan')
      expect(routeTier('做一个材质包').matched).toEqual([])
    })

    it('裸 "整合" 收紧，非整合包语境不误路由', () => {
      expect(routeTier('把这几段配置整合到一起').tier).toBe('artisan')
      expect(routeTier('整合包开发').tier).toBe('weaver')
    })
  })
})
