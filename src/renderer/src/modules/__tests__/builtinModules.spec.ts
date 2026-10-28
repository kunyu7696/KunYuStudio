import { describe, expect, it } from 'vitest'
import { moduleRegistry, registerBuiltinModules } from '../index'

/**
 * 活动栏可见性契约：
 * - requireProject：未打开项目时是否出现在「主页活动栏」
 * - homeOnly：是否只出现在「主页活动栏」（打开项目后隐藏）
 * - projectTypes：已打开项目时限定项目类型（未打开项目不受其影响）
 * - 模组与市场：不要求项目（主页可先逛市场），已打开项目时只保留在整合包项目里
 * - 全流程 AI 制作：只在主页活动栏，项目页里移除
 * - 资产库（原画廊）：不要求项目——未打开项目时进入跨项目汇总模式
 * - Mod 库：全局库，不绑定任何项目
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

  it('全流程 AI 制作为主页专用入口（打开项目后隐藏）', () => {
    const ai = moduleRegistry.get('ai-workflow')
    expect(ai?.homeOnly).toBe(true)
    expect(ai?.requireProject).toBeFalsy()
    expect(ai?.projectTypes).toBeUndefined()
  })

  it('资产库（原画廊改名）不再要求先打开项目（主页进出时跨项目汇总）', () => {
    expect(moduleRegistry.get('gallery')?.requireProject).toBeFalsy()
    expect(moduleRegistry.get('gallery')?.homeOnly).toBeFalsy()
    expect(moduleRegistry.get('gallery')?.name).toBe('资产库')
  })

  it('资源库是全局模块：不要求项目、不限定项目类型、不限主页', () => {
    const modlib = moduleRegistry.get('modlib')
    expect(modlib?.name).toBe('资源库')
    expect(modlib?.requireProject).toBeFalsy()
    expect(modlib?.homeOnly).toBeFalsy()
    expect(modlib?.projectTypes).toBeUndefined()
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
