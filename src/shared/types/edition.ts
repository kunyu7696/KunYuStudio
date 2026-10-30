import type { ProjectEdition } from './project'

/**
 * 版本（edition）画像：把「目标平台是 Java 版还是基岩版」的平台假设收敛到一处，
 * 供项目层与 AI 层按 edition 参数化。
 *
 * 基岩版支持尚未开放——本模块只登记 Java 画像，是留给基岩扩展的架构窗口：
 * 未来新增 BEDROCK_EDITION_PROFILE 并在 resolveEditionProfile 分支返回即可，
 * 调用方（提示词装配、工具链）无需再改结构。
 */
export interface EditionProfile {
  id: ProjectEdition
  /** 模组加载器概念（Fabric/Forge/NeoForge）仅 Java 版存在；基岩无加载器 */
  hasLoaders: boolean
  /** 字节码映射体系（Yarn/Mojang 官方映射）仅 Java 版存在 */
  hasMappings: boolean
  /** 构建/运行依赖 JDK；基岩不需要 */
  requiresJdk: boolean
}

/** 当前唯一生效的版本画像：Java 版 */
export const JAVA_EDITION_PROFILE: EditionProfile = {
  id: 'java',
  hasLoaders: true,
  hasMappings: true,
  requiresJdk: true
}

/**
 * 解析 edition → 画像。
 * 缺省/未知一律回落 Java 画像——保证现有行为（提示词、工具链假设）逐字节不变。
 */
export function resolveEditionProfile(edition?: ProjectEdition): EditionProfile {
  switch (edition) {
    // 基岩画像预留位：bedrock 支持到来时返回独立画像（当前回落 Java）
    case 'bedrock':
    case 'java':
    default:
      return JAVA_EDITION_PROFILE
  }
}
