import { describe, expect, it } from 'vitest'
import { moduleRegistry, registerBuiltinModules } from '../index'

/**
 * 活动栏可见性契约：
 * - requireProject：未打开项目时是否出现在「主页活动栏」
 * - homeOnly：是否只出现在「主页活动栏」（打开项目后隐藏）
 * - projectTypes：已打开项目时限定项目类型（未打开项目不受其影响）
 * - 模组与市场：不要求项目（主页可先逛市场），已打开项目时只保留在整合包项目里
 * - 灵感台：应用级双模式之一（顶栏切换），不注册为活动栏模块
 * - 资产库（原画廊）：主页活动栏专用（打开项目后隐藏）
 * - 资源库：主页活动栏专用（打开项目后隐藏）
 * - FTB 任务书 / 指南书 / KubeJS 脚本：整合包项目专用
 * - 整合包组装：仍要求项目且仅整合包类型可见（本次不动）
 */
registerBuiltinModules()

describe('内置模块注册表 · 主页活动栏可见性', () => {
  it('模组与市场不要求先打开项目，但限定只出现在整合包项目里', () => {
    const market = moduleRegistry.get('market')
    expect(market?.requireProject).toBeFalsy()
    expect(market?.projectTypes).toEqual(['modpack'])
    expect(market?.name).toBe('模组与市场')
  })

  it('灵感台为应用级双模式，不再注册为活动栏模块', () => {
    // 原 ai-workflow「全流程 AI 制作」已砍掉，由顶栏「灵感台」模式承载
    expect(moduleRegistry.get('ai-workflow')).toBeUndefined()
    expect(moduleRegistry.get('inspire')).toBeUndefined()
  })

  it('资产库（原画廊改名）为主页活动栏专用入口（打开项目后隐藏）', () => {
    const gallery = moduleRegistry.get('gallery')
    expect(gallery?.requireProject).toBeFalsy()
    expect(gallery?.homeOnly).toBe(true)
    expect(gallery?.name).toBe('资产库')
    expect(gallery?.projectTypes).toBeUndefined()
  })

  it('资源库为主页活动栏专用入口（打开项目后隐藏）', () => {
    const modlib = moduleRegistry.get('modlib')
    expect(modlib?.name).toBe('资源库')
    expect(modlib?.requireProject).toBeFalsy()
    expect(modlib?.homeOnly).toBe(true)
    expect(modlib?.projectTypes).toBeUndefined()
  })

  it('FTB 任务书、指南书与 KubeJS 脚本为整合包项目专用', () => {
    for (const id of ['ftbquest', 'patchouli', 'kubejs'] as const) {
      const mod = moduleRegistry.get(id)
      expect(mod?.requireProject).toBe(true)
      expect(mod?.projectTypes).toEqual(['modpack'])
    }
  })

  it('整合包组装保持「要求项目 + 仅整合包类型」', () => {
    const modpack = moduleRegistry.get('modpack')
    expect(modpack?.requireProject).toBe(true)
    expect(modpack?.projectTypes).toEqual(['modpack'])
    expect(modpack?.homeOnly).toBeFalsy()
  })

  it('原「统一编辑器」改名为「工坊」，id 保持不变（持久化键）', () => {
    const unified = moduleRegistry.get('unified')
    expect(unified?.name).toBe('工坊')
    expect(unified?.projectTypes).toEqual(['mod'])
    expect(unified?.requireProject).toBe(true)
  })
})
