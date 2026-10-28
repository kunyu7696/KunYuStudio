import { describe, expect, it } from 'vitest'
import {
  compareMcVersion,
  fabricTargetJdk,
  getToolchain,
  isBetaBlocked,
  isMojangEra,
  isSupportedCombo,
  jdkRequirementsFor,
  jdkRequirementsForMcVersion,
  tierOfMcVersion
} from '../loaderVersionMatrix'
import { judgeJdkCompatibility, LEGACY_JDK_REQUIREMENTS } from '../../../shared/types/build'

describe('compareMcVersion（F5-01：非数字版本不归一化为 NaN）', () => {
  it('纯数字版本：1.20.4 < 1.20.5 < 1.20.6 < 1.21.1', () => {
    expect(compareMcVersion('1.20.4', '1.20.5')).toBeLessThan(0)
    expect(compareMcVersion('1.20.5', '1.20.6')).toBeLessThan(0)
    expect(compareMcVersion('1.20.6', '1.21.1')).toBeLessThan(0)
    expect(compareMcVersion('1.21.1', '1.21.1')).toBe(0)
    expect(compareMcVersion('1.21.1', '1.20.4')).toBeGreaterThan(0)
  })

  it('带后缀版本（1.20.5-rc1）不返回 NaN，按 0 归一化', () => {
    // 修复前：map(Number) 把 '5-rc1' 变成 NaN，两个方向比较均为 false
    // 修复后：parseInt('5-rc1',10) || 0 = 5，行为与 '1.20.5' 一致
    const r = compareMcVersion('1.20.5-rc1', '1.20.5')
    expect(Number.isNaN(r)).toBe(false)
    expect(r).toBe(0)
  })

  it('快照版本（24w21a）不返回 NaN', () => {
    const r = compareMcVersion('24w21a', '1.20.5')
    expect(Number.isNaN(r)).toBe(false)
    // 24 vs 1 → 24 > 1 → 返回 1
    expect(r).toBe(1)
  })

  it('未来大版本（26.1）正确大于 1.21', () => {
    expect(compareMcVersion('26.1', '1.21')).toBeGreaterThan(0)
  })

  it('返回值归一化为 -1/0/1（兼容 sort comparator）', () => {
    expect(compareMcVersion('1.20.4', '1.21.1')).toBe(-1)
    expect(compareMcVersion('1.21.1', '1.20.4')).toBe(1)
    expect(compareMcVersion('1.20.5', '1.20.5')).toBe(0)
  })
})

describe('V-02 矩阵补 1.21.6~1.21.11（坐标一手验证）', () => {
  const NEW_VERS = ['1.21.6', '1.21.7', '1.21.8', '1.21.9', '1.21.10', '1.21.11'] as const

  it('fabric/neoforge 全部登记且 isSupportedCombo=true', () => {
    for (const v of NEW_VERS) {
      expect(isSupportedCombo('fabric', v), `fabric ${v}`).toBe(true)
      expect(isSupportedCombo('neoforge', v), `neoforge ${v}`).toBe(true)
    }
  })

  it('fabric 新条目 jdk=21、Gradle 9.7.1、loom 1.18.4（官方模板分支核实）', () => {
    for (const v of NEW_VERS) {
      const tc = getToolchain('fabric', v)
      if (!('yarnVersion' in tc)) throw new Error(`fabric ${v} 工具链类型异常`)
      expect(tc.jdk, `${v} jdk`).toBe(21)
      expect(tc.gradleVersion, `${v} gradle`).toBe('9.7.1')
      expect(tc.loomVersion, `${v} loom`).toBe('1.18.4')
      expect(tc.loaderVersion, `${v} loader`).toBe('0.19.5')
    }
  })

  it('neoforge 新条目 jdk=21 且 neoForgeVersion 与各线最新构建一致', () => {
    // 1.21.6/1.21.7/1.21.9 线 NeoForge 未 GA，官方仅发布 -beta 后缀构建
    // （forgecdn/bmclapi maven-metadata 逐版本实证；plain 版本不存在，门禁依赖解析 404 证实）
    const expected: Record<string, string> = {
      '1.21.6': '21.6.20-beta',
      '1.21.7': '21.7.25-beta',
      '1.21.8': '21.8.54',
      '1.21.9': '21.9.16-beta',
      '1.21.10': '21.10.64',
      '1.21.11': '21.11.45'
    }
    for (const [v, nf] of Object.entries(expected)) {
      const tc = getToolchain('neoforge', v)
      if (!('neoForgeVersion' in tc)) throw new Error(`neoforge ${v} 工具链类型异常`)
      expect(tc.neoForgeVersion).toBe(nf)
      expect(tc.jdk).toBe(21)
    }
  })

  it('tierOfMcVersion：1.21.6~1.21.11 归 extended；未登记的 26.1 仍不可用', () => {
    for (const v of NEW_VERS) expect(tierOfMcVersion(v)).toBe('extended')
    expect(isSupportedCombo('fabric', '26.1')).toBe(false)
  })

  it('fabric buildGradle 模板经 v.jdk 派生 Java 版本（三真值源收口：1.21.11 不得回退 17）', () => {
    // 直接断言模板产物含 release 21（旧硬编码列表漏改时此断言失败）
    const tc = getToolchain('fabric', '1.21.11')
    expect('jdk' in tc ? tc.jdk : null).toBe(21)
  })
})

describe('26.3 接入（Mojang 映射时代 / Java 25）：fabric/forge 可用，neoforge beta 禁用', () => {
  it('tier 归 extended 且 isMojangEra=true', () => {
    expect(tierOfMcVersion('26.3')).toBe('extended')
    expect(isMojangEra('26.3')).toBe(true)
    expect(isMojangEra('1.21.1')).toBe(false)
  })

  it('fabric 26.3：loader 0.19.5 / fabric-api 0.162.0+26.3 / loom 1.18-SNAPSHOT / JDK 25 / 无 yarn', () => {
    expect(isSupportedCombo('fabric', '26.3')).toBe(true)
    const tc = getToolchain('fabric', '26.3')
    if (!('yarnVersion' in tc)) throw new Error('fabric 26.3 工具链类型异常')
    expect(tc.loaderVersion).toBe('0.19.5')
    expect(tc.fabricVersion).toBe('0.162.0+26.3')
    expect(tc.loomVersion).toBe('1.18-SNAPSHOT')
    expect(tc.gradleVersion).toBe('9.7.1')
    expect(tc.jdk).toBe(25)
    expect(tc.yarnVersion).toBe('')
    expect(fabricTargetJdk(tc)).toBe(25)
  })

  it('forge 26.3：66.0.11 正式版 / FG [7.0.17,8) / JDK 25 / modbusgroup 构造风格', () => {
    expect(isSupportedCombo('forge', '26.3')).toBe(true)
    const tc = getToolchain('forge', '26.3')
    if (!('forgeVersion' in tc)) throw new Error('forge 26.3 工具链类型异常')
    expect(tc.forgeVersion).toBe('66.0.11')
    expect(tc.forgeGradleVersion).toBe('[7.0.17,8)')
    expect(tc.gradleVersion).toBe('9.7.1')
    expect(tc.jdk).toBe(25)
    expect(tc.forgeConstructorStyle).toBe('modbusgroup')
  })

  it('neoforge 26.3：beta 条目存在但 isBetaBlocked=true、isSupportedCombo=false（不回退其他版本）', () => {
    expect(isBetaBlocked('neoforge', '26.3')).toBe(true)
    expect(isBetaBlocked('fabric', '26.3')).toBe(false)
    expect(isBetaBlocked('forge', '26.3')).toBe(false)
    expect(isSupportedCombo('neoforge', '26.3')).toBe(false)
    // 条目本身已登记：getToolchain 返回 beta 条目而非回退默认（创建链路由 isSupportedCombo 拦）
    const tc = getToolchain('neoforge', '26.3')
    if (!('neoForgeVersion' in tc)) throw new Error('neoforge 26.3 工具链类型异常')
    expect(tc.neoForgeVersion).toBe('26.3.0.75-beta')
    expect(tc.jdk).toBe(25)
    expect(tc.stability).toBe('beta')
    // fabric/forge 26.3 不带 beta 标记
    expect(getToolchain('fabric', '26.3').stability).not.toBe('beta')
    expect(getToolchain('forge', '26.3').stability).not.toBe('beta')
  })
})

describe('jdkRequirementsFor（按 loader/MC 版本推导 JDK 要求）', () => {
  it('1.20.1 fabric/forge：required/preferred=17，max=23（Gradle 8.10.2 宿主上限）', () => {
    for (const loader of ['fabric', 'forge'] as const) {
      const req = jdkRequirementsFor(loader, '1.20.1')
      expect(req.requiredMajor).toBe(17)
      expect(req.preferredMajor).toBe(17)
      expect(req.maxMajor).toBe(23)
    }
  })

  it('neoforge 无 1.20.1 登记，回退默认 1.21.1：required=21，max=23', () => {
    const req = jdkRequirementsFor('neoforge', '1.20.1')
    expect(req.requiredMajor).toBe(21)
    expect(req.maxMajor).toBe(23)
  })

  it('26.3（Gradle 9.7.1）：required/preferred=25，max=25', () => {
    for (const loader of ['fabric', 'forge', 'neoforge'] as const) {
      const req = jdkRequirementsFor(loader, '26.3')
      expect(req.requiredMajor).toBe(25)
      expect(req.preferredMajor).toBe(25)
      expect(req.maxMajor).toBe(25)
    }
  })

  it('1.21.x（Gradle 8.12+/9.7.1 + jdk 21）：required=21，max 不低于 required', () => {
    const req = jdkRequirementsFor('fabric', '1.21.1')
    expect(req.requiredMajor).toBe(21)
    expect(req.maxMajor).toBeGreaterThanOrEqual(21)
  })

  it('judgeJdkCompatibility 按传入要求判定：25 在 26.3 下可用、在 legacy 下过高', () => {
    expect(judgeJdkCompatibility(25, jdkRequirementsFor('fabric', '26.3'))).toBe('recommended')
    expect(judgeJdkCompatibility(25, LEGACY_JDK_REQUIREMENTS)).toBe('too-high')
    expect(judgeJdkCompatibility(17, jdkRequirementsFor('fabric', '26.3'))).toBe('too-low')
    // 缺省参数回退 legacy（1.20.1 语义不变）
    expect(judgeJdkCompatibility(17)).toBe('recommended')
    expect(judgeJdkCompatibility(24)).toBe('too-high')
  })
})

describe('jdkRequirementsForMcVersion（零配置向导：无 loader 的纯 MC 版本推导）', () => {
  it('26.3 → JDK 25（fabric/forge 已开放；不因 neoforge beta 受阻）', () => {
    const req = jdkRequirementsForMcVersion('26.3')
    expect(req.requiredMajor).toBe(25)
    expect(req.preferredMajor).toBe(25)
    // 非默认兜底：不能落 1.20.1 时代（17），否则向导永远推不到 25
    expect(judgeJdkCompatibility(25, req)).toBe('recommended')
    expect(judgeJdkCompatibility(17, req)).toBe('too-low')
  })

  it('已登记版本取工具链宿主 JDK：1.21.1 → 21、1.20.1 → 17、1.16.5 → 17（宿主语义）', () => {
    expect(jdkRequirementsForMcVersion('1.21.1').requiredMajor).toBe(21)
    expect(jdkRequirementsForMcVersion('1.20.1').requiredMajor).toBe(17)
    expect(jdkRequirementsForMcVersion('1.16.5').requiredMajor).toBe(17)
  })

  it('仅单一加载器登记的版本走并集：1.21.3（仅 neoforge）→ 21', () => {
    expect(jdkRequirementsForMcVersion('1.21.3').requiredMajor).toBe(21)
  })

  it('未登记版本按时代阈值兜底：26.4 → 25、1.20.7 → 21、1.17.1 → 17、1.12.2 → 17', () => {
    expect(jdkRequirementsForMcVersion('26.4').requiredMajor).toBe(25)
    expect(jdkRequirementsForMcVersion('1.20.7').requiredMajor).toBe(21)
    expect(jdkRequirementsForMcVersion('1.17.1').requiredMajor).toBe(17)
    expect(jdkRequirementsForMcVersion('1.12.2').requiredMajor).toBe(17)
  })
})
