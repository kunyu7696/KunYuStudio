/**
 * 构建依赖（Maven 坐标）管理：三端共享类型。
 *
 * 安全边界：只读写带 kunyu 标记的行（`// kunyu:dep:<group>:<artifact>` /
 * `// kunyu:maven:<url>`），用户手写的依赖与仓库一律不碰，也不参与列表展示。
 */

/** Gradle 依赖配置：Fabric 的模组依赖用 modImplementation，Forge/NeoForge 用 implementation */
export type DependencyConfiguration =
  | 'modImplementation'
  | 'implementation'
  | 'compileOnly'
  | 'runtimeOnly'
  | 'api'

export interface MavenCoordinate {
  group: string
  artifact: string
  version: string
}

/** 一条由 KunYu 管理的依赖（来源是 build.gradle 里的带标记行） */
export interface ProjectDependency {
  coordinate: MavenCoordinate
  /** group:artifact:version */
  notation: string
  configuration: DependencyConfiguration
}

export interface DependencyFileState {
  dependencies: ProjectDependency[]
  /** 由 KunYu 管理（带标记）的 maven 仓库地址 */
  repositories: string[]
  /** 项目根目录下是否存在 build.gradle（不存在时无法管理依赖） */
  hasBuildGradle: boolean
}

export interface DependencyAddInput {
  /** group:artifact:version */
  notation: string
  /** 省略时按项目加载器取默认值 */
  configuration?: DependencyConfiguration
  /** 需要一并声明的 maven 仓库（必须是 https） */
  repository?: string
}

export type DependencyOpResult =
  | { ok: true; changed: boolean; state: DependencyFileState }
  | { ok: false; error: string }
