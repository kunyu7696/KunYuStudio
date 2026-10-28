import { describe, expect, it } from 'vitest'
import { neoForgeClientClass, type NeoForgeTemplateVars } from '../neoForgeTemplates'

function baseVars(mcVersion: string): NeoForgeTemplateVars {
  return {
    modId: 'testmod',
    modName: 'Test Mod',
    version: '1.0.0',
    packageName: 'com.example.testmod',
    mcVersion,
    neoForgeVersion: '21.1.250',
    modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2',
    jdk: mcVersion === '1.20.4' ? 17 : 21
  }
}

describe('neoForgeClientClass（XV-01：FML 2.x/3.x EventBusSubscriber 分派）', () => {
  it('1.20.4（FML 2.x）：使用嵌套类 Mod.EventBusSubscriber，不导入顶层 EventBusSubscriber', () => {
    const src = neoForgeClientClass(baseVars('1.20.4'))
    // FML 2.0.17 只有 net.neoforged.fml.common.Mod.EventBusSubscriber（嵌套类）
    expect(src).toContain('import net.neoforged.fml.common.Mod;')
    expect(src).toContain('@Mod.EventBusSubscriber')
    expect(src).toContain('Mod.EventBusSubscriber.Bus.MOD')
    // 不能有顶层 EventBusSubscriber 导入或注解
    expect(src).not.toContain('import net.neoforged.fml.common.EventBusSubscriber;')
    expect(src).not.toMatch(/@EventBusSubscriber\(/)
  })

  it('1.20.6+（FML 3.x）：使用顶层 EventBusSubscriber', () => {
    const src = neoForgeClientClass(baseVars('1.20.6'))
    expect(src).toContain('import net.neoforged.fml.common.EventBusSubscriber;')
    expect(src).toContain('@EventBusSubscriber')
    expect(src).toContain('EventBusSubscriber.Bus.MOD')
  })

  it('1.21.1（FML 3.x）：使用顶层 EventBusSubscriber', () => {
    const src = neoForgeClientClass(baseVars('1.21.1'))
    expect(src).toContain('import net.neoforged.fml.common.EventBusSubscriber;')
    expect(src).toContain('@EventBusSubscriber')
  })
})
