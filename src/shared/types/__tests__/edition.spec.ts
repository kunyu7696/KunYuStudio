import { describe, expect, it } from 'vitest'
import { JAVA_EDITION_PROFILE, resolveEditionProfile } from '../edition'

/**
 * 版本画像（基岩预留窗口）契约：
 * - 任何输入（缺省/java/bedrock）当前都恒回落 Java 画像——保证接入 edition 维度后
 *   现有提示词装配与工具链假设逐字节不变；
 * - Java 画像三开关全开（加载器/映射/JDK），与未来基岩画像形成对照锚点。
 */
describe('edition 版本画像（基岩预留）', () => {
  it('缺省与显式 java 均返回 Java 画像', () => {
    expect(resolveEditionProfile()).toBe(JAVA_EDITION_PROFILE)
    expect(resolveEditionProfile('java')).toBe(JAVA_EDITION_PROFILE)
  })

  it('bedrock 当前回落 Java 画像（预留分支，行为不变）', () => {
    expect(resolveEditionProfile('bedrock')).toBe(JAVA_EDITION_PROFILE)
  })

  it('Java 画像：加载器 / 映射 / JDK 三开关全开', () => {
    expect(JAVA_EDITION_PROFILE.id).toBe('java')
    expect(JAVA_EDITION_PROFILE.hasLoaders).toBe(true)
    expect(JAVA_EDITION_PROFILE.hasMappings).toBe(true)
    expect(JAVA_EDITION_PROFILE.requiresJdk).toBe(true)
  })
})
