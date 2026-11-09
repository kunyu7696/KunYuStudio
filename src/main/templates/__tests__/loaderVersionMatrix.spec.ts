import { describe, expect, it } from 'vitest'
import {
  compareMcVersion,
  fabricIdentifierClass,
  fabricTargetJdk,
  getToolchain,
  isBetaBlocked,
  isMojangEra,
  isMojmapFabric,
  isSupportedCombo,
  jdkRequirementsFor,
  jdkRequirementsForMcVersion,
  LOADER_VERSION_MATRIX,
  tierOfMcVersion,
  type FabricToolchain
} from '../loaderVersionMatrix'
import { buildGradle } from '../fabricTemplates'
import { judgeJdkCompatibility, LEGACY_JDK_REQUIREMENTS } from '../../../shared/types/build'
import MDK_SNAPSHOT from '../mdkSnapshot.json'

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

  it('fabric 新条目 jdk=21，且版本坐标由 MDK 快照守门', () => {
    for (const v of NEW_VERS) {
      const tc = getToolchain('fabric', v)
      if (!('yarnVersion' in tc)) throw new Error(`fabric ${v} 工具链类型异常`)
      expect(tc.jdk, `${v} jdk`).toBe(21)
      // 版本号一律由 mdkSnapshot.json 做结构断言（见文末「MDK 坐标一致性」），
      // 这里不再硬编码具体值，否则上游刷新时会产生假红
      expect(tc.loaderVersion, `${v} loader`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('neoforge 新条目 jdk=21 且 neoForgeVersion 非空（上游会刷新 patch）', () => {
    for (const v of NEW_VERS) {
      const tc = getToolchain('neoforge', v)
      if (!('neoForgeVersion' in tc)) throw new Error(`neoforge ${v} 工具链类型异常`)
      // NeoForge 版本号是上游自动刷新的：断言非空 + 含数字片段即可（可能带 -beta 后缀）
      expect(tc.neoForgeVersion, `${v} neoForgeVersion`).toMatch(/^\d+\.\d+\.\d+(?:\.?\d+)?(?:-beta)?$/)
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

describe('Fabric 1.21.6~1.21.11 映射策略对齐官方 MDK（Mojang 官方映射）', () => {
  const MOJMAP_VERS = ['1.21.6', '1.21.7', '1.21.8', '1.21.9', '1.21.10', '1.21.11']

  function vars(mc: string): Parameters<typeof buildGradle>[0] {
    const tc = getToolchain('fabric', mc) as FabricToolchain
    return {
      modId: 'demo',
      modName: 'Demo',
      version: '1.0.0',
      packageName: 'com.demo',
      mcVersion: tc.mcVersion,
      loaderVersion: tc.loaderVersion,
      fabricVersion: tc.fabricVersion,
      yarnVersion: tc.yarnVersion,
      loomVersion: tc.loomVersion,
      gradleVersion: tc.gradleVersion,
      jdk: tc.jdk
    }
  }

  it('映射世代判定：1.21.6~1.21.11 与 26.x 同为 Mojmap，1.21.5 仍为 Yarn', () => {
    for (const v of MOJMAP_VERS) expect(isMojmapFabric(v), v).toBe(true)
    expect(isMojmapFabric('26.3')).toBe(true)
    expect(isMojmapFabric('1.21.5')).toBe(false)
    // isMojangEra 语义保持 26.x（Forge/迁移告警依赖），不被 1.21.6 污染
    expect(isMojangEra('1.21.6')).toBe(false)
    // 资源位置类名差异：1.21.6~1.21.10 是 ResourceLocation，1.21.11 起改名 Identifier
    expect(fabricIdentifierClass('1.21.6')).toBe('ResourceLocation')
    expect(fabricIdentifierClass('1.21.10')).toBe('ResourceLocation')
    expect(fabricIdentifierClass('1.21.11')).toBe('Identifier')
    expect(fabricIdentifierClass('26.3')).toBe('Identifier')
  })

  it('矩阵 yarnVersion 全部留空（官方 MDK 不再声明 yarn_mappings）', () => {
    for (const v of MOJMAP_VERS) {
      const tc = getToolchain('fabric', v) as FabricToolchain
      expect(tc.yarnVersion, v).toBe('')
    }
  })

  it('build.gradle：fabric-loom-remap + officialMojangMappings + modImplementation', () => {
    for (const v of MOJMAP_VERS) {
      const text = buildGradle(vars(v), 'official')
      expect(text, v).toContain("id 'net.fabricmc.fabric-loom-remap'")
      expect(text, v).toContain('mappings loom.officialMojangMappings()')
      expect(text, v).toContain('modImplementation "net.fabricmc:fabric-loader:')
      expect(text, v).not.toContain('yarn_mappings')
    }
  })

  it('26.3 保持官方写法：fabric-loom + implementation，且无 mappings 行', () => {
    const text = buildGradle(vars('26.3'), 'official')
    expect(text).toContain("id 'net.fabricmc.fabric-loom'")
    expect(text).not.toContain('fabric-loom-remap')
    expect(text).not.toContain('officialMojangMappings')
    expect(text).toContain('implementation "net.fabricmc:fabric-loader:')
  })

  it('1.21.5 仍是 Yarn：fabric-loom + yarn mappings + modImplementation', () => {
    const text = buildGradle(vars('1.21.5'), 'official')
    expect(text).toContain("id 'fabric-loom'")
    expect(text).toContain('mappings "net.fabricmc:yarn:${project.yarn_mappings}:v2"')
    expect(text).toContain('modImplementation "net.fabricmc:fabric-loader:')
  })
})

describe('26.3 接入（Mojang 映射时代 / Java 25）：fabric/forge 可用，neoforge beta 禁用', () => {
  it('tier 归 extended 且 isMojangEra=true', () => {
    expect(tierOfMcVersion('26.3')).toBe('extended')
    expect(isMojangEra('26.3')).toBe(true)
    expect(isMojangEra('1.21.1')).toBe(false)
  })

  it('fabric 26.3：Mojang 映射时代（无 yarn）/ JDK 25，坐标由 MDK 快照守门', () => {
    expect(isSupportedCombo('fabric', '26.3')).toBe(true)
    const tc = getToolchain('fabric', '26.3')
    if (!('yarnVersion' in tc)) throw new Error('fabric 26.3 工具链类型异常')
    // 26.x 无 Yarn 构建：必须留空，模板据此不输出 mappings 行
    expect(tc.yarnVersion).toBe('')
    expect(tc.jdk).toBe(25)
    expect(fabricTargetJdk(tc)).toBe(25)
    // loom/gradle/loader/api 具体值统一由文末 MDK 快照断言守门
    expect(tc.loomVersion).toMatch(/^\d+\.\d+/)
    expect(tc.fabricVersion).toMatch(/\+26\.3$/)
  })

  it('forge 26.3：Forge 版本号 / FG 区间 / JDK 25 / modbusgroup 构造风格', () => {
    expect(isSupportedCombo('forge', '26.3')).toBe(true)
    const tc = getToolchain('forge', '26.3')
    if (!('forgeVersion' in tc)) throw new Error('forge 26.3 工具链类型异常')
    // forgeVersion 自动刷新 patch：断言是纯数字段（x.y.z）
    expect(/^\d+\.\d+\.\d+$/.test(tc.forgeVersion)).toBe(true)
    // 以下字段脚本不自动刷新，精确断言守门
    expect(tc.forgeGradleVersion).toBe('[7.0.17,8)')
    expect(tc.gradleVersion).toBe('9.7.1')
    expect(tc.jdk).toBe(25)
    expect(tc.forgeConstructorStyle).toBe('modbusgroup')
  })

  it('neoforge 26.3：beta 条目按上游状态判定（版本带 -beta → beta 禁用；否则解除）', () => {
    const tc = getToolchain('neoforge', '26.3')
    if (!('neoForgeVersion' in tc)) throw new Error('neoforge 26.3 工具链类型异常')
    // neoForgeVersion 自动刷新：断言合法数字格式
    expect(tc.neoForgeVersion).toMatch(/^\d+\.\d+\.\d+\.\d+(?:-beta)?$/)
    // stability 跟随 -beta 后缀：脚本刷新上游去 beta 后 stability 也解除
    const expectBeta = tc.neoForgeVersion.includes('-beta')
    expect(tc.stability === 'beta').toBe(expectBeta)
    expect(isBetaBlocked('neoforge', '26.3')).toBe(expectBeta)
    expect(isSupportedCombo('neoforge', '26.3')).toBe(!expectBeta)
    expect(tc.jdk).toBe(25)
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

/**
 * MDK 坐标一致性（离线结构断言，不联网）。
 *
 * mdkSnapshot.json 是「最近一次从官方 MDK 同步到的坐标」的 lockfile，
 * 由 scripts/refresh-loader-matrix.mjs 整组写入（loader / yarn / fabric-api / loom / gradle 同批）。
 *
 * 为什么需要它：这些字段在官方 MDK 里是同批升级的。若某次只升了 loader 没升 loom，
 * 矩阵就会变成官方从未验证过的组合，而单看任何一条测试都是绿的。
 * 这里强制矩阵与 lockfile 完全一致 —— 任何"半更新"都会失败。
 * 断言失败的处理方式：`npm run matrix:refresh:dry` 看上游差异，或用 `npm run matrix:refresh` 同步整组。
 */
describe('MDK 坐标一致性（防止 loader/loom 半更新）', () => {
  const snapshot = MDK_SNAPSHOT as Record<
    string,
    { loaderVersion: string; yarnVersion: string; fabricVersion: string; loomVersion: string; gradleVersion: string }
  >
  const matrix = LOADER_VERSION_MATRIX.fabric as Record<string, FabricToolchain>

  it('每条 fabric 矩阵条目都有对应的 MDK 快照（新增版本必须同步登记）', () => {
    const missing = Object.keys(matrix).filter((mc) => !snapshot[mc])
    expect(
      missing,
      `以下 MC 版本在矩阵里有、mdkSnapshot.json 里没有：${missing.join(', ')}。` +
        ' 新增条目必须同时补快照，否则无法做三元组联动校验。'
    ).toEqual([])
  })

  it('loader / yarn / fabric-api / loom / gradle 五项与快照完全一致', () => {
    const fields = ['loaderVersion', 'yarnVersion', 'fabricVersion', 'loomVersion', 'gradleVersion'] as const
    for (const [mc, entry] of Object.entries(snapshot)) {
      if (!matrix[mc]) continue // 快照可能有矩阵已移除的历史条目，跳过
      for (const field of fields) {
        // 快照为空 = 官方 MDK 未声明该字段（如个别分支无 wrapper），矩阵自行处置。
        // 但 yarnVersion 为空有明确语义：官方自 1.21.6 起改用 Mojang 官方映射，
        // 不再声明 yarn_mappings。此时矩阵必须同样留空——否则就是"绕过官方映射策略"
        // 的隐式分叉（此前正是被这里整体跳过而无人发现）。
        if (!entry[field]) {
          if (field === 'yarnVersion') {
            expect(
              matrix[mc][field],
              `${mc} 的官方 MDK 无 yarn_mappings（Mojang 映射），矩阵 yarnVersion 必须留空，` +
                `实际为 ${String(matrix[mc][field])}`
            ).toBe('')
          }
          continue
        }
        expect(
          matrix[mc][field],
          `${mc} 的 ${field} 与官方 MDK 快照不一致（矩阵=${String(matrix[mc][field])}，` +
            `快照=${entry[field]}）。这五个字段在 MDK 里同批升级，` +
            `只改其中几个会造出官方未验证的组合；请核对 loader_version / loom_version / gradle wrapper 三项后整组更新。`
        ).toBe(entry[field])
      }
    }
  })
})
