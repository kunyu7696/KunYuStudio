/**
 * 用户级 Mod 库共享类型。
 *
 * Mod 库位于应用 userData/mod-library/（不绑定具体项目，全局共享）：
 *  - 市场模组 jar 落盘于此，元数据登记在 library.json
 *  - 整合包项目通过右侧常驻「Mod 库」面板拖动模组到 run/mods 进行组装
 * 库条目同时是来源坐标（provenance）的数据源：加入项目时写入 .kunyu/modpack.json。
 */
import type { MarketProjectType, ModPlatform } from './market'

/** 模组来源平台：双平台 + 本地导入（无平台坐标） */
export type ModLibraryPlatform = ModPlatform | 'local'

/** 资源库内容类型：模组 / 资源包 / 数据包 / 光影 / 整合包 */
export type ResourceLibraryType = 'mod' | 'resourcepack' | 'datapack' | 'shader' | 'modpack'

/** Mod 库条目（库内 jar 的元数据） */
export interface ModLibraryEntry {
  /** jar 文件名（库内唯一主键，同时是落盘文件名） */
  fileName: string
  /** 资源类型（旧条目缺失该字段，读取时按 'mod' 归一） */
  resourceType: ResourceLibraryType
  /** 模组展示名（市场名；本地导入且无法解析时回退文件名） */
  name: string
  /** 来源平台 */
  platform: ModLibraryPlatform
  /** 平台项目 id（local 为 null） */
  projectId: string | null
  /** 平台版本文件 id（local 为 null） */
  versionId: string | null
  /** 平台 slug（local 为 null） */
  slug: string | null
  /** 模组版本号 */
  versionNumber: string
  /** 支持的加载器（fabric/forge/neoforge/quilt；本地导入未知时为空数组） */
  loaders: string[]
  /** 支持的 Minecraft 版本（本地导入未知时为空数组） */
  gameVersions: string[]
  /** jar 大小（字节） */
  size: number
  /** 下载直链（local 为 null） */
  downloadUrl: string | null
  /** 平台项目图标 URL（本地导入或旧版条目补齐前为 null） */
  iconUrl?: string | null
  /** 加入库的时间 ISO 字符串 */
  addedAt: string
}

/** Mod 库清单文件（mod-library/library.json） */
export interface ModLibraryFile {
  version: 1
  entries: ModLibraryEntry[]
}

/** 库列表过滤条件（渲染层筛选器） */
export interface ModLibraryFilter {
  /** 加载器精确匹配（空/undefined 不过滤） */
  loader?: string
  /** Minecraft 版本精确匹配（空/undefined 不过滤） */
  mcVersion?: string
  /** 资源类型精确匹配（空/undefined 不过滤） */
  type?: ResourceLibraryType
  /** 名称模糊匹配（大小写不敏感） */
  query?: string
}

/** 从市场下载指定版本文件到库的请求 */
export interface ModLibraryDownloadInput {
  platform: ModPlatform
  /** 平台项目 id */
  projectId: string
  /** 平台版本文件 id */
  versionId: string
  /** 平台项目类型（入库时写入 resourceType；缺省按文件扩展名/zip 结构识别） */
  projectType?: MarketProjectType
}

/** 通用操作结果（加入项目/下载等） */
export type ModLibraryOpResult =
  | { ok: true; fileName: string; message?: string }
  | { ok: false; error: string; conflict?: { existingFile: string } }
