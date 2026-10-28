/**
 * 项目类型（设计文档 3.12 + 6 扩展）。
 * 第一版完整支持 mod，其余类型在向导中可选但仅生成基础骨架。
 */
export type ProjectType =
  | 'mod'
  | 'resourcepack'
  | 'datapack'
  | 'shaderpack'
  | 'modpack'

/** 模组加载器（M7+ 解锁 Fabric/Forge/NeoForge 三加载器） */
export type ModLoader = 'fabric' | 'forge' | 'neoforge'

/**
 * 包类项目（资源包/数据包/光影包）可选 MC 版本。
 * 与 loaderVersionMatrix 登记的 10 个去重 MC 版本一致
 * （Fabric×9 / Forge×5 / NeoForge×6 的并集；1.21.4/1.21.5 待真机验证）；
 * 其中 1.16.5/1.18.2/1.19.2 为 legacy 层，新建向导不展示，仅供导入/迁移路径使用。
 */
export type PackMcVersion =
  | '1.16.5'
  | '1.18.2'
  | '1.19.2'
  | '1.20.1'
  | '1.20.4'
  | '1.20.6'
  | '1.21.1'
  | '1.21.3'
  | '1.21.4'
  | '1.21.5'

export interface Project {
  id: string
  name: string
  type: ProjectType
  /** 项目在磁盘上的绝对路径 */
  path: string
  /** 仅模组类型有值 */
  loader: ModLoader | null
  mcVersion: string
  /** 加载器版本（如 Fabric loader 0.15.11），旧数据/导入未探测时为 null */
  loaderVersion: string | null
  modId: string | null
  namespace: string | null
  jdkPath: string | null
  /** 描述/备注 */
  description: string
  createdAt: number
  lastOpenedAt: number
  /** 目录当前是否存在于磁盘（列表时由主进程实时计算，不落库；路径失效角标用） */
  pathExists?: boolean
}

export interface CreateProjectInput {
  name: string
  type: ProjectType
  path: string
  loader?: ModLoader
  mcVersion?: string
  /** 加载器版本（创建项目向导中选择）；非模组类型为 null */
  loaderVersion?: string | null
  modId?: string
  namespace?: string
  /** 光影包加载器（仅 shaderpack 类型：iris/optifine） */
  shaderLoader?: 'iris' | 'optifine'
  jdkPath?: string
  description?: string
}

/** 更新项目可写字段 */
export interface UpdateProjectInput {
  name?: string
  description?: string
  lastOpenedAt?: number
  /** 重新定位：目录被移动后指向新位置 */
  path?: string
}

export const PROJECT_TYPE_META: Record<
  ProjectType,
  { label: string; icon: string; requiresLoader: boolean }
> = {
  mod: { label: '模组', icon: 'Box', requiresLoader: true },
  resourcepack: { label: '资源包', icon: 'Picture', requiresLoader: false },
  datapack: { label: '数据包', icon: 'DataLine', requiresLoader: false },
  shaderpack: { label: '光影包', icon: 'Sunny', requiresLoader: false },
  modpack: { label: '整合包', icon: 'Files', requiresLoader: false }
}

export {}
