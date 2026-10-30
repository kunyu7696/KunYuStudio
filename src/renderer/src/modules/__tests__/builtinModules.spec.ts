import { describe, expect, it } from 'vitest'
import { moduleRegistry, registerBuiltinModules } from '../index'

/**
 * 活动栏可见性契约：
 * - requireProject：未打开项目时是否出现在「主页活动栏」
 * - homeOnly：是否只出现在「主页活动栏」（打开项目后隐藏）
 * - projectTypes：已打开项目时限定项目类型（未打开项目不受其影响）
 * - 模组与市场：不要求项目（主页可先逛市场），已打开项目时只保留在整合包项目里
 * - 全流程 AI 制作：只在主页活动栏，项目页里移除
 * - 资产库（原画廊）：不要求项目——未打开项目时进入跨项目汇总模式；mod 项目内隐藏
 * - 资源库：主页可整理，mod 项目内隐藏（主页已有入口）
 * - FTB 任务书 / 指南书：整合包项目专用
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

  it('资产库（原画廊改名）不要求先打开项目；mod 项目内隐藏（主页已有入口）', () => {
    const gallery = moduleRegistry.get('gallery')
    expect(gallery?.requireProject).toBeFalsy()
    expect(gallery?.homeOnly).toBeFalsy()
    expect(gallery?.name).toBe('资产库')
    expect(gallery?.projectTypes).toEqual(['resourcepack', 'datapack', 'shaderpack', 'modpack'])
  })

  it('资源库：不要求项目、不限主页；mod 项目内隐藏（主页已有入口）', () => {
    const modlib = moduleRegistry.get('modlib')
    expect(modlib?.name).toBe('资源库')
    expect(modlib?.requireProject).toBeFalsy()
    expect(modlib?.homeOnly).toBeFalsy()
    expect(modlib?.projectTypes).toEqual(['resourcepack', 'datapack', 'shaderpack', 'modpack'])
  })

  it('FTB 任务书与指南书为整合包项目专用', () => {
    for (const id of ['ftbquest', 'patchouli'] as const) {
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
