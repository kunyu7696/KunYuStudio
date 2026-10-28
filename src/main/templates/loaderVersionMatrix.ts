/**
 * 加载器版本矩阵（Fabric / Forge / NeoForge 全版本线）。
 *
 * 唯一数据源：projectService 脚手架、CI buildGradleForLoader、buildProbe 探针
 * 均从此处按 (loader, mcVersion) 查询完整工具链版本，不再各自硬编码 *_DEFAULTS。
 *
 * 字段说明：
 *  - jdk:            目标 Java 大版本（决定 toolchain / release）
 *  - gradleVersion:  gradle-wrapper.properties 的 distribution 版本
 *  - loaderVersion:  加载器版本（Fabric loader / Forge / NeoForge）
 *  - [Fabric] yarnVersion / fabricVersion / loomVersion
 *  - [Forge]  forgeGradleVersion（插件版本区间）
 *  - [NeoForge] modDevGradleVersion
 *  - forgeConstructorStyle: 'classic'(1.20.1-: 无参构造器+FMLJavaModLoadingContext.get())
 *                            'injected'(1.20.4+: 构造器注入 IEventBus)
 *                            'modbusgroup'(26.x FG7: 构造器注入 FMLJavaModLoadingContext，
 *                                          DeferredRegister.register(ModBusGroup))
 *  - stability: 'beta' 表示上游仍处 Beta（登记仅为向导展示/矩阵可见），
 *               isSupportedCombo 返回 false，脚手架/整合包/CI/探针一律拒绝生成
 *
 * 版本覆盖 manifest.versionFingerprints：34 个活跃组合（用户指令全部激活，
 * 原 16 已验证 + 18 原储备组合 1.21.4~1.21.11 × Fabric/NeoForge 各 8 + Fabric/Forge 26.3，
 * 模板已补齐、verified=null 待探针回写）+ MC 26.3 三个组合（一手核实）：
 *  - Fabric 26.3：官方发布当天即稳定（loader 0.19.5 / fabric-api 0.162.0+26.3 /
 *    loom 1.18-SNAPSHOT / Java 25）；26.x 起 Yarn 无构建，改用 Loom 默认 Mojang 官方映射，
 *    yarnVersion 留空（模板据此不输出 mappings 行）。已激活，真机验证未完成。
 *  - Forge 26.3：66.0.11 正式版（promotions latest 频道），FG7 mavenizer 体系 + Java 25，
 *    已激活，真机验证未完成。
 *  - NeoForge 26.3：官方仍标 Beta（26.3.0.x-beta），stability='beta' 禁用，
 *    向导灰显「Beta，暂不支持」，待官方 GA 后解除。
 * 注：Forge 1.16.5 因 FG4 + official mappings 框架级不兼容已冻结（见下方注释），
 * 不计入可达组合。
 */
import { GRADLE_MAX_MAJOR, type JdkRequirements } from '../../shared/types/build'
import type { ModLoader } from '../../shared/types/project'

export type ForgeConstructorStyle = 'classic' | 'injected' | 'modbusgroup'

/** 组合稳定度：缺省 stable；beta=上游仍 Beta（登记可见但禁止创建，如 NeoForge 26.3） */
export type ComboStability = 'stable' | 'beta'

/**
 * 版本分层（M23 实测 + 主流度）：
 *  - core:     1.20.1 / 1.21.1（三加载器主力，发布前强制真机验证全绿门槛）
 *  - extended: 1.20.4 / 1.20.6 / 1.21.3（次主流，验证通过即收录，失败可容忍标黄）
 *  - pending:  1.21.4~1.21.11（已全部激活，真机验证未完成，分层值仍为 extended，
 *              待验证态由 manifest 指纹 health=unknown + 模板 verified=null 表达）
 *  - legacy:   1.16.5 / 1.18.2 / 1.19.2（遗产，新建向导默认隐藏，forge-1.16.5 已 deprecated 冻结）
 */
export type VersionTier = 'core' | 'extended' | 'legacy'

/** 按 MC 版本派生分层（与加载器无关，避免条目重复硬编码） */
export function tierOfMcVersion(mcVersion: string): VersionTier {
  if (mcVersion === '1.20.1' || mcVersion === '1.21.1') return 'core'
  // 1.21.4~1.21.11 统一 extended（pending 态由 manifest health 表达）
  const m21 = /^1\.21\.(\d+)$/.exec(mcVersion)
  if (m21 && Number(m21[1]) >= 3) return 'extended'
  if (mcVersion === '1.20.4' || mcVersion === '1.20.6') return 'extended'
  // 26.x 新年份版本线（26.3 起登记）：非 1.x 的数字点分版本一律 extended
  const mYear = /^(\d+)\./.exec(mcVersion)
  if (mYear && Number(mYear[1]) > 1) return 'extended'
  return 'legacy' // 1.16.5 / 1.18.2 / 1.19.2
}

/** 26.x 新年份版本线（major>1）：Fabric 26.x 起无 Yarn、全面 Mojang 映射，模板据此分派 */
export function isMojangEra(mcVersion: string): boolean {
  const m = /^(\d+)\./.exec(mcVersion)
  return !!m && Number(m[1]) > 1
}

export interface FabricToolchain {
  loader: 'fabric'
  mcVersion: string
  loaderVersion: string
  /** 26.x 起 Yarn 无构建：空串表示不输出 mappings 行（Loom 1.18 默认 Mojang 官方映射） */
  yarnVersion: string
  fabricVersion: string
  loomVersion: string
  gradleVersion: string
  /** 编译目标 Java 版本（release target）。1.21.6+ 与宿主 JDK 解耦 */
  jdk: 8 | 17 | 21 | 25
  /** 宿主 JVM 版本（Gradle + loom 插件运行所需）。缺省与 jdk 相同；
   *  1.21.6+ 因 loom 1.18.4 强制 JVM 25 而独立设置为 25 */
  hostJdk?: 17 | 21 | 25
  stability?: ComboStability
}

export interface ForgeToolchain {
  loader: 'forge'
  mcVersion: string
  forgeVersion: string
  forgeGradleVersion: string
  gradleVersion: string
  jdk: 8 | 17 | 21 | 25
  forgeConstructorStyle: ForgeConstructorStyle
  stability?: ComboStability
}

export interface NeoForgeToolchain {
  loader: 'neoforge'
  mcVersion: string
  neoForgeVersion: string
  modDevGradleVersion: string
  gradleVersion: string
  jdk: 17 | 21 | 25
  /** beta=上游仍 Beta（如 26.3）：登记可见但禁止创建，坐标待 GA 后落证 */
  stability?: ComboStability
}

export type LoaderToolchain = FabricToolchain | ForgeToolchain | NeoForgeToolchain

/** Fabric 全版本线（yarn / fabric-api / loom / jdk 对齐官方 MDK） */
const FABRIC_MATRIX: Record<string, FabricToolchain> = {
  '1.16.5': {
    loader: 'fabric', mcVersion: '1.16.5',
    // loom 1.4-SNAPSHOT 已滚动升级为强制 Gradle 8.3+ 且宿主 JVM 17+（M23 探针实测）；
    // jdk 字段在此表示宿主 JDK（选 JAVA_HOME 用），编译目标 release=8 由模板按 mcVersion 硬推导
    loaderVersion: '0.14.0', yarnVersion: '1.16.5+build.10',
    fabricVersion: '0.42.0+1.16', loomVersion: '1.4-SNAPSHOT',
    gradleVersion: '8.10.2', jdk: 17
  },
  '1.18.2': {
    loader: 'fabric', mcVersion: '1.18.2',
    loaderVersion: '0.15.11', yarnVersion: '1.18.2+build.4',
    fabricVersion: '0.77.0+1.18.2', loomVersion: '1.6-SNAPSHOT',
    gradleVersion: '8.10.2', jdk: 17
  },
  '1.19.2': {
    loader: 'fabric', mcVersion: '1.19.2',
    loaderVersion: '0.15.11', yarnVersion: '1.19.2+build.2',
    fabricVersion: '0.76.1+1.19.2', loomVersion: '1.6-SNAPSHOT',
    gradleVersion: '8.10.2', jdk: 17
  },
  '1.20.1': {
    loader: 'fabric', mcVersion: '1.20.1',
    loaderVersion: '0.15.11', yarnVersion: '1.20.1+build.10',
    fabricVersion: '0.92.1+1.20.1', loomVersion: '1.6-SNAPSHOT',
    gradleVersion: '8.10.2', jdk: 17
  },
  '1.20.4': {
    loader: 'fabric', mcVersion: '1.20.4',
    loaderVersion: '0.15.11', yarnVersion: '1.20.4+build.2',
    fabricVersion: '0.96.4+1.20.4', loomVersion: '1.6-SNAPSHOT',
    gradleVersion: '8.10.2', jdk: 17
  },
  '1.20.6': {
    loader: 'fabric', mcVersion: '1.20.6',
    loaderVersion: '0.15.11', yarnVersion: '1.20.6+build.1',
    fabricVersion: '0.100.8+1.20.6', loomVersion: '1.6-SNAPSHOT',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.1': {
    loader: 'fabric', mcVersion: '1.21.1',
    loaderVersion: '0.15.11', yarnVersion: '1.21.1+build.3',
    fabricVersion: '0.106.0+1.21.1', loomVersion: '1.6-SNAPSHOT',
    gradleVersion: '8.10.2', jdk: 21
  },
  // V-01：1.21.4/1.21.5 坐标来自 Fabric Maven 实测 metadata：
  // yarn / fabric-api 取该 MC 线最新构建；loader 取 0.16 线稳定版。
  // loom 1.10.5 为同时支持两版本的稳定版；矩阵门禁实测其元数据强制 Gradle 8.12+
  // （"requires at least Gradle 8.12"），wrapper 相应用 8.12，不能用 8.10.2。
  // 真机构建验证未完成，组合状态以 manifest 指纹 health=unknown / inactive 表达。
  '1.21.4': {
    loader: 'fabric', mcVersion: '1.21.4',
    loaderVersion: '0.16.14', yarnVersion: '1.21.4+build.8',
    fabricVersion: '0.119.4+1.21.4', loomVersion: '1.10.5',
    gradleVersion: '8.12', jdk: 21
  },
  '1.21.5': {
    loader: 'fabric', mcVersion: '1.21.5',
    loaderVersion: '0.16.14', yarnVersion: '1.21.5+build.1',
    fabricVersion: '0.128.2+1.21.5', loomVersion: '1.10.5',
    gradleVersion: '8.12', jdk: 21
  },
  // 1.21.6~1.21.11 坐标全部一手验证：
  //   loader/yarn ← meta.fabricmc.net v2 API（HTTP 200，逐版本查询）；
  //   fabric-api ← maven.fabricmc.net maven-metadata.xml（各线最新构建）；
  //   loom 1.18 线 + Gradle 9.7.1 ← FabricMC/fabric-example-mod 官方模板分支
  //   （1.21.6 与 1.21.11 分支 gradle.properties/wrapper 逐字节核对）。
  // 宿主 JDK=25：loom 1.18.4 自身需要 JVM 25（构建期错误 "requires at least JVM runtime version 25"），
  // 但编译目标仍是 Java 21（游戏侧需求），故 jdk 字段保持 21、新增 hostJdk=25 表示宿主。
  '1.21.6': {
    loader: 'fabric', mcVersion: '1.21.6',
    loaderVersion: '0.19.5', yarnVersion: '1.21.6+build.1',
    fabricVersion: '0.128.2+1.21.6', loomVersion: '1.18.4',
    gradleVersion: '9.7.1', jdk: 21, hostJdk: 25
  },
  '1.21.7': {
    loader: 'fabric', mcVersion: '1.21.7',
    loaderVersion: '0.19.5', yarnVersion: '1.21.7+build.8',
    fabricVersion: '0.129.0+1.21.7', loomVersion: '1.18.4',
    gradleVersion: '9.7.1', jdk: 21, hostJdk: 25
  },
  '1.21.8': {
    loader: 'fabric', mcVersion: '1.21.8',
    loaderVersion: '0.19.5', yarnVersion: '1.21.8+build.1',
    fabricVersion: '0.136.1+1.21.8', loomVersion: '1.18.4',
    gradleVersion: '9.7.1', jdk: 21, hostJdk: 25
  },
  '1.21.9': {
    loader: 'fabric', mcVersion: '1.21.9',
    loaderVersion: '0.19.5', yarnVersion: '1.21.9+build.1',
    fabricVersion: '0.134.1+1.21.9', loomVersion: '1.18.4',
    gradleVersion: '9.7.1', jdk: 21, hostJdk: 25
  },
  '1.21.10': {
    loader: 'fabric', mcVersion: '1.21.10',
    loaderVersion: '0.19.5', yarnVersion: '1.21.10+build.3',
    fabricVersion: '0.138.4+1.21.10', loomVersion: '1.18.4',
    gradleVersion: '9.7.1', jdk: 21, hostJdk: 25
  },
  '1.21.11': {
    loader: 'fabric', mcVersion: '1.21.11',
    loaderVersion: '0.19.5', yarnVersion: '1.21.11+build.6',
    fabricVersion: '0.141.6+1.21.11', loomVersion: '1.18.4',
    gradleVersion: '9.7.1', jdk: 21, hostJdk: 25
  },
  // MC 26.3（正式版，Java 25）：Fabric 发布当天即稳定。
  // 坐标一手核实（meta.fabricmc.net / maven.fabricmc.net /
  // FabricMC/fabric-example-mod 26.3 分支逐字节核对）：
  //   loader 0.19.5 / fabric-api 0.162.0+26.3（maven-metadata 最新）；
  //   loom 官方写法 1.18-SNAPSHOT（注意不是 1.18.4 release）/ Gradle 9.7.1。
  // 26.x 起 Yarn 无任何构建（/v2/versions/yarn/26.3 count=0）：yarnVersion 留空，
  // 官方 MDK 不再有 mappings 行，Loom 默认 Mojang 官方映射（Identifier 等已改名）。
  // 真机编译验证未完成，组合状态以 manifest 指纹 health=unknown / inactive 表达。
  '26.3': {
    loader: 'fabric', mcVersion: '26.3',
    loaderVersion: '0.19.5', yarnVersion: '',
    fabricVersion: '0.162.0+26.3', loomVersion: '1.18-SNAPSHOT',
    gradleVersion: '9.7.1', jdk: 25
  }
}

/** Forge 全版本线（ForgeGradle 与 Gradle 版本严格对齐：5.x→Gradle7, 6.x→Gradle8, 7.x→Gradle8） */
const FORGE_MATRIX: Record<string, ForgeToolchain> = {
  // M23 DEPRECATED：FG4 + official mappings 框架级不兼容（mcp_config-1.16.5.zip 无 obf_to_srg.tsrg，
  // MCPRepo.findOfficialMapping 硬编码查找失败），且 mcp channel 产物已 404。冻结不再投入。
  // 保留条目仅为历史参考；新建项目请选用 1.18.2+。
  // '1.16.5': {
  //   loader: 'forge', mcVersion: '1.16.5',
  //   forgeVersion: '36.2.42', forgeGradleVersion: '[4.1,4.2)',
  //   gradleVersion: '6.9.4', jdk: 8, forgeConstructorStyle: 'classic'
  // },
  '1.18.2': {
    loader: 'forge', mcVersion: '1.18.2',
    forgeVersion: '40.2.0', forgeGradleVersion: '[5.1,5.2)',
    gradleVersion: '7.6.3', jdk: 17, forgeConstructorStyle: 'classic'
  },
  '1.19.2': {
    loader: 'forge', mcVersion: '1.19.2',
    forgeVersion: '43.4.0', forgeGradleVersion: '[5.1,5.2)',
    gradleVersion: '7.6.3', jdk: 17, forgeConstructorStyle: 'classic'
  },
  '1.20.1': {
    loader: 'forge', mcVersion: '1.20.1',
    forgeVersion: '47.4.23', forgeGradleVersion: '[6.0,6.2)',
    gradleVersion: '8.10.2', jdk: 17, forgeConstructorStyle: 'classic'
  },
  '1.20.4': {
    loader: 'forge', mcVersion: '1.20.4',
    forgeVersion: '49.0.53', forgeGradleVersion: '[6.0,6.2)',
    gradleVersion: '8.10.2', jdk: 17, forgeConstructorStyle: 'injected'
  },
  '1.21.1': {
    loader: 'forge', mcVersion: '1.21.1',
    // 官方 1.21.1-52.0.57 MDK 锁定 FG [6.0.24,6.2) + Gradle 8.x（M23 探针实测 FG7/Gradle9 组合不兼容）
    forgeVersion: '52.0.57', forgeGradleVersion: '[6.0.24,6.2)',
    gradleVersion: '8.10.2', jdk: 21, forgeConstructorStyle: 'injected'
  },
  // MC 26.3（正式版，Java 25）：Forge 66.0.11 已为正式版
  // （promotions_slim.json 的 26.3-latest 频道；用户提及的 66.0.9 已被 66.0.11 取代）。
  // 坐标来自官方 forge-26.3-66.0.11-mdk.zip 逐文件核对：
  //   FG7 mavenizer 体系：插件 [7.0.17,8)、Gradle 9.7.1、eventbus-validator 7.0.6，
  //   无 mappings channel/version（mavenizer 直接官方映射）；
  //   主类构造器改注入 FMLJavaModLoadingContext（ModBusGroup），故新增 modbusgroup 风格。
  // 真机编译验证未完成，组合状态以 manifest 指纹 health=unknown / inactive 表达。
  '26.3': {
    loader: 'forge', mcVersion: '26.3',
    forgeVersion: '66.0.11', forgeGradleVersion: '[7.0.17,8)',
    gradleVersion: '9.7.1', jdk: 25, forgeConstructorStyle: 'modbusgroup'
  }
}

/** NeoForge 全版本线（ModDevGradle 2.x 全版本线通用） */
const NEOFORGE_MATRIX: Record<string, NeoForgeToolchain> = {
  '1.20.4': {
    loader: 'neoforge', mcVersion: '1.20.4',
    neoForgeVersion: '20.4.240', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 17
  },
  '1.20.6': {
    loader: 'neoforge', mcVersion: '1.20.6',
    neoForgeVersion: '20.6.132', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.1': {
    loader: 'neoforge', mcVersion: '1.21.1',
    neoForgeVersion: '21.1.250', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.3': {
    loader: 'neoforge', mcVersion: '1.21.3',
    neoForgeVersion: '21.3.97', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  // V-01：NeoForge 版本取 Prism Launcher meta（镜像官方 maven metadata）
  // 各 MC 线最新稳定构建；ModDevGradle 与 MC 小版本无关，沿用已实测的 2.0.147。
  // 官方 maven.neoforged.net 在本机网络不可达，真机构建验证待补（指纹 health=unknown）。
  '1.21.4': {
    loader: 'neoforge', mcVersion: '1.21.4',
    neoForgeVersion: '21.4.158', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.5': {
    loader: 'neoforge', mcVersion: '1.21.5',
    neoForgeVersion: '21.5.98', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  // NeoForge 1.21.6~1.21.11 各线最新构建（BMCLAPI 镜像官方
  // maven-metadata.xml 一手核对，21.6.20 / 21.7.25 / 21.8.54 / 21.9.16 /
  // 21.10.64 / 21.11.45）。ModDevGradle 与 MC 小版本无关，沿用已实测的 2.0.147。
  // 真机编译验证未完成，组合状态以 manifest 指纹 health=unknown / inactive 表达。
  '1.21.6': {
    loader: 'neoforge', mcVersion: '1.21.6',
    // 1.21.6 线 NeoForge 未 GA，官方仅发布 -beta 后缀版本（forgecdn/bmclapi maven-metadata 实证）
    neoForgeVersion: '21.6.20-beta', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.7': {
    loader: 'neoforge', mcVersion: '1.21.7',
    // 1.21.7 线同上（仅 -beta 存在）
    neoForgeVersion: '21.7.25-beta', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.8': {
    loader: 'neoforge', mcVersion: '1.21.8',
    neoForgeVersion: '21.8.54', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.9': {
    loader: 'neoforge', mcVersion: '1.21.9',
    // 1.21.9 线同上（仅 -beta 存在）
    neoForgeVersion: '21.9.16-beta', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.10': {
    loader: 'neoforge', mcVersion: '1.21.10',
    neoForgeVersion: '21.10.64', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  '1.21.11': {
    loader: 'neoforge', mcVersion: '1.21.11',
    neoForgeVersion: '21.11.45', modDevGradleVersion: '2.0.147',
    gradleVersion: '8.10.2', jdk: 21
  },
  // MC 26.3：NeoForge 官方仍将该线标记为 Beta（BMCLAPI 镜像官方 maven-metadata 核实，
  // 26.3.0.0-beta ~ 26.3.0.75-beta 全部带 -beta 后缀；26.3.0.76 虽去后缀，
  // 但用户决策时点按官方 Beta 口径处理）。用户明确指示：标 beta 且禁用，暂不支持使用，
  // 待官方稳定后再解除——stability='beta' 使 isSupportedCombo 返回 false，
  // 脚手架/整合包/CI/探针全部拒绝；MDG/Gradle 坐标待 GA 后从官方 MDK 落证，暂留空串。
  '26.3': {
    loader: 'neoforge', mcVersion: '26.3',
    neoForgeVersion: '26.3.0.75-beta', modDevGradleVersion: '',
    gradleVersion: '', jdk: 25, stability: 'beta'
  }
}

export const LOADER_VERSION_MATRIX: Record<ModLoader, Record<string, LoaderToolchain>> = {
  fabric: FABRIC_MATRIX,
  forge: FORGE_MATRIX,
  neoforge: NEOFORGE_MATRIX
}

/** 各加载器的默认 MC 版本（空值或未识别版本的回退目标） */
export const LOADER_DEFAULT_MC: Record<ModLoader, string> = {
  fabric: '1.20.1',
  forge: '1.20.1',
  neoforge: '1.21.1'
}

/** 查询某加载器某 MC 版本的工具链；找不到/为空时回退到该加载器默认 MC 版本 */
export function getToolchain(loader: ModLoader, mcVersion: string): LoaderToolchain {
  const table = LOADER_VERSION_MATRIX[loader]
  return table[mcVersion] ?? table[LOADER_DEFAULT_MC[loader]] ?? table[Object.keys(table)[0]]
}

/** Gradle 大版本 → 可运行的最高 JDK 主版本（运行 Gradle 本身的宿主上限） */
function gradleHostMaxJdk(gradleVersion: string): number {
  const major = Number.parseInt(gradleVersion.split('.')[0] ?? '', 10)
  if (major >= 9) return 25
  if (major === 8) return 23
  if (major === 7) return 19
  return 15
}

/** 按 (loader, mcVersion) 推导 JDK 版本要求：required/preferred 取矩阵 hostJdk（宿主 JVM），
 *  max 取「hostJdk」与「该 Gradle 版本宿主上限」的较大者（JDK 检测与设置页共用）。
 *  hostJdk 缺省时回落到 jdk（编译目标 == 宿主）。 */
export function jdkRequirementsFor(loader: ModLoader, mcVersion: string): JdkRequirements {
  const tc = getToolchain(loader, mcVersion)
  const hostJdk = ('hostJdk' in tc && tc.hostJdk) ? tc.hostJdk : tc.jdk
  const gradleMax = gradleHostMaxJdk(tc.gradleVersion)
  return {
    requiredMajor: hostJdk,
    preferredMajor: hostJdk,
    maxMajor: Math.max(hostJdk, gradleMax)
  }
}

/**
 * 纯 MC 版本推导 JDK 要求（加载器无关）——零配置运行环境向导在未打开项目时
 * 只有目标 MC 版本可用，不能落入 1.20.1 时代默认（否则 26.3 目标永远推不到 JDK 25）。
 * 优先取任一已登记工具链（非 beta 优先，与 fabric/forge 26.3 开放、neoforge 26.3
 * beta 禁用的矩阵语义一致）；未登记组合按宿主 JDK 时代阈值兜底
 * （26.3+≈25 / 1.20.5+≈21 / 其余≈17，与 1.16.5 宿主 17 的登记语义对齐）。
 */
export function jdkRequirementsForMcVersion(mcVersion: string): JdkRequirements {
  const loaders = Object.keys(LOADER_VERSION_MATRIX) as ModLoader[]
  for (const loader of loaders) {
    const tc = LOADER_VERSION_MATRIX[loader]?.[mcVersion]
    if (tc && tc.stability !== 'beta') return jdkRequirementsFor(loader, mcVersion)
  }
  for (const loader of loaders) {
    const tc = LOADER_VERSION_MATRIX[loader]?.[mcVersion]
    if (tc) return jdkRequirementsFor(loader, mcVersion)
  }
  const major =
    compareMcVersion(mcVersion, '26.3') >= 0 ? 25 : compareMcVersion(mcVersion, '1.20.5') >= 0 ? 21 : 17
  return { requiredMajor: major, preferredMajor: major, maxMajor: Math.max(major, GRADLE_MAX_MAJOR) }
}

/** 某加载器支持的全部 MC 版本（按矩阵登记顺序；含 beta 登记项——
 *  创建/探针/门禁等「可生成」语义必须再过 isBetaBlocked / isSupportedCombo） */
export function supportedMcVersions(loader: ModLoader): string[] {
  return Object.keys(LOADER_VERSION_MATRIX[loader])
}

/** beta 组合（如 NeoForge 26.3）：矩阵登记仅为矩阵/向导可见，任何生成链路一律拒绝 */
export function isBetaBlocked(loader: ModLoader, mcVersion: string): boolean {
  return LOADER_VERSION_MATRIX[loader]?.[mcVersion]?.stability === 'beta'
}

/** 简单 MC 版本号比较（按 . 分段数值升序；-1/0/1）。模板层 API 分派共用（导出避免各模板重复实现）。
 *  F5-01：与 services/ai/versionMatrix.compareMcVersions 行为对齐——非数字段归一化为 0（而非 NaN），
 *  避免 "1.20.5-rc1" 这类带后缀版本让 < 0 和 >= 0 同时为 false、静默走较新分支。 */
export function compareMcVersion(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/** 矩阵登记的全部去重 MC 版本（三加载器并集，按版本升序）——包类项目的可选版本数据源 */
export function allMatrixMcVersions(): string[] {
  const set = new Set<string>()
  for (const loader of Object.keys(LOADER_VERSION_MATRIX) as ModLoader[]) {
    for (const v of Object.keys(LOADER_VERSION_MATRIX[loader])) set.add(v)
  }
  return [...set].sort(compareMcVersion)
}

/** MC 版本的「下一 minor」上界（mods.toml 区间用，对齐 MDK 惯例）：
 *  1.16.5→1.17，1.18.2→1.19，1.20.4→1.21，1.21.1→1.22。无法解析时原样返回。 */
export function nextMinorMc(mcVersion: string): string {
  const m = /^(\d+)\.(\d+)/.exec(mcVersion)
  if (!m) return mcVersion
  return `${m[1]}.${Number(m[2]) + 1}`
}

/** Fabric 模板的「产物/运行时 Java 目标」：
 *  1.16.5 的 Gradle/loom 宿主需 JDK 17（矩阵 jdk=17），但编译目标与游戏运行时仍是 Java 8；
 *  其余版本矩阵 jdk 即目标。fabric.mod.json 的 java depends 必须用此值而非宿主 jdk。 */
export function fabricTargetJdk(tc: FabricToolchain): 8 | 17 | 21 | 25 {
  return tc.mcVersion === '1.16.5' ? 8 : tc.jdk
}

/** 判断 (loader, mcVersion) 是否可用于生成项目：已登记且非 beta（beta 仅展示，禁止创建） */
export function isSupportedCombo(loader: ModLoader, mcVersion: string): boolean {
  const tc = LOADER_VERSION_MATRIX[loader]?.[mcVersion]
  return Boolean(tc) && tc.stability !== 'beta'
}

/** Java 大版本 → release 目标值 */
export function jdkRelease(jdk: number): number {
  return jdk
}
