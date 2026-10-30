/**
 * M9 模组市场与社区桥接共享类型。
 * 统一抽象 CurseForge 与 Modrinth 两个平台的搜索结果、详情、版本与安装结果，
 * 渲染层只面向统一结构编程，平台差异在主进程 marketService 适配层消化。
 */
import type { SideRequirement } from './modpack'

/** 支持的模组平台 */
export type ModPlatform = 'curseforge' | 'modrinth'

/** 市场内容类型：模组 + 数据包/资源包/光影包/整合包 */
export type MarketProjectType = 'mod' | 'datapack' | 'resourcepack' | 'shader' | 'modpack'

/** 内容类型元信息（UI 标签 / 平台参数 / 安装目录提示） */
export interface MarketProjectTypeMeta {
  /** 中文展示名 */
  label: string
  /** CurseForge classId（gameId=432 Minecraft 顶级分类） */
  cfClassId: number
  /** CurseForge 详情页路径段（兜底 URL 用；API 返回 websiteUrl 时优先） */
  cfUrlSegment: string
  /** Modrinth search facets 的 project_type 值 */
  mrProjectType: string
  /** Modrinth 详情页路径段（datapack 项目站点路径为 /datapack/<slug>） */
  mrUrlSegment: string
  /** 安装到项目内的相对目录（展示提示用；实际落盘逻辑在 marketService） */
  installDirHint: string
}

export const PROJECT_TYPE_META: Record<MarketProjectType, MarketProjectTypeMeta> = {
  mod: { label: '模组', cfClassId: 6, cfUrlSegment: 'mc-mods', mrProjectType: 'mod', mrUrlSegment: 'mod', installDirHint: 'run/mods' },
  datapack: { label: '数据包', cfClassId: 6945, cfUrlSegment: 'data-packs', mrProjectType: 'datapack', mrUrlSegment: 'datapack', installDirHint: '存档 datapacks' },
  resourcepack: { label: '资源包', cfClassId: 12, cfUrlSegment: 'texture-packs', mrProjectType: 'resourcepack', mrUrlSegment: 'resourcepack', installDirHint: 'run/resourcepacks' },
  shader: { label: '光影包', cfClassId: 6552, cfUrlSegment: 'shaders', mrProjectType: 'shader', mrUrlSegment: 'shader', installDirHint: 'run/shaderpacks' },
  modpack: { label: '整合包', cfClassId: 4471, cfUrlSegment: 'modpacks', mrProjectType: 'modpack', mrUrlSegment: 'modpack', installDirHint: 'modpacks（下载后导入）' }
}

export const PROJECT_TYPE_ORDER: readonly MarketProjectType[] = ['mod', 'datapack', 'resourcepack', 'shader', 'modpack']

/** 搜索结果列表项（轻量，卡片展示用） */
export interface MarketModSummary {
  /** 平台内唯一标识（CF 为 number 字符串，MR 为 project id） */
  id: string
  platform: ModPlatform
  /** 内容类型（旧数据缺省视为 mod） */
  projectType?: MarketProjectType
  /** 用于 URL 的短标识（CF slug / MR slug） */
  slug: string
  name: string
  summary: string
  /** en→zh 自动翻译结果（渲染层异步填充；null/缺省表示未翻译或展示原文） */
  nameZh?: string | null
  summaryZh?: string | null
  /** 作者或团队名 */
  authors: string[]
  /** 封面图 URL（可能为空） */
  iconUrl: string | null
  /** 下载次数 */
  downloads: number
  /** 最近更新时间 ISO 字符串 */
  updatedAt: string
  /** 支持的加载器（fabric/forge/neoforge/quilt） */
  loaders: string[]
  /** 支持的 Minecraft 版本（如 ['1.20.1','1.21']） */
  gameVersions: string[]
  /** 分类标签 */
  categories: string[]
  /** 外链（平台详情页） */
  url: string
}

/** 依赖项 */
export interface MarketDependency {
  platform: ModPlatform
  /** 依赖在该平台的 mod/project id */
  modId: string
  /** 依赖类型：required 必须、optional 可选、incompatible 不兼容 */
  relationType: 'required' | 'optional' | 'incompatible'
}

/** 单个版本文件 */
export interface MarketModFile {
  id: string
  name: string
  /** 版本号（如 '1.0.0'） */
  versionNumber: string
  /** 文件名（含 .jar） */
  fileName: string
  /** 下载直链 */
  downloadUrl: string
  /** 平台权威哈希（Modrinth version files 返回；CF 无此字段）。下载后按此校验完整性 */
  hashes?: { sha1?: string; sha512?: string }
  /** 文件大小（字节） */
  size: number
  /** 发布日期 ISO */
  releasedAt: string
  /** 支持的加载器 */
  loaders: string[]
  /** 支持的 MC 版本 */
  gameVersions: string[]
  /** 该版本的依赖 */
  dependencies: MarketDependency[]
}

/** 模组详情 */
export interface MarketModDetail extends MarketModSummary {
  description: string
  /** 该模组的全部版本（按发布时间倒序） */
  files: MarketModFile[]
  /** Modrinth 项目级客户端侧别（组装整合包 env 的权威信号；CF 无此字段） */
  clientSide?: SideRequirement
  /** Modrinth 项目级服务端侧别 */
  serverSide?: SideRequirement
  /**
   * 项目许可（P3-1a；Modrinth 详情 API 返回 SPDX id + 名称）。
   * CurseForge API 不提供许可字段，CF 详情恒为 null；缺省一律按「未知」对待。
   */
  license?: { id: string; name: string } | null
}

/** 跨平台联动的轻量项目候选（P3-3：slug/名称匹配与「对侧更新超前」提示用） */
export interface CrossPlatformCandidate {
  id: string
  slug: string
  name: string
  /** 项目最近更新 ISO */
  updatedAt: string
}

/** 搜索查询 */
export interface MarketSearchQuery {
  platform: ModPlatform
  /** 关键词（可为空字符串表示浏览） */
  query: string
  /** 内容类型，缺省 mod */
  projectType?: MarketProjectType
  /** 加载器过滤（仅 mod 类型生效；pack 类内容无加载器概念） */
  loader?: string
  /** Minecraft 版本过滤 */
  gameVersion?: string
  /** 分类过滤（平台原生分类名） */
  category?: string
  /** 页码，从 0 开始 */
  page?: number
  /** 每页数量（默认 20，上限 50） */
  pageSize?: number
  /** 排序：热度/下载量/更新时间 */
  sort?: 'popularity' | 'downloads' | 'updated'
}

/** 中→英查询桥接命中的词条（M12 中文搜索） */
export interface TranslatedTerm {
  /** 用户输入的中文词，如"光影" */
  zh: string
  /** 实际用于检索的英文词，如"shaders" */
  en: string
  /** alias=模组专名（钠→Sodium），term=通用术语（光影→shaders） */
  kind: 'alias' | 'term'
}

/** 搜索结果 */
export interface MarketSearchResult {
  items: MarketModSummary[]
  /** 总数（部分平台不返回，为 null） */
  total: number | null
  /** 是否有下一页 */
  hasMore: boolean
  /** 中文查询被翻译/扩展命中的词条（纯英文搜索时为空，供 UI 提示） */
  translatedTerms?: TranslatedTerm[]
  /** 词典未收录、原样保留检索的中文片段（召回可能有限，UI 可引导去中文社区搜索） */
  untranslatedZh?: string[]
}

/** 安装请求 */
export interface MarketInstallInput {
  platform: ModPlatform
  modId: string
  versionId: string
  /** 内容类型，缺省 mod；决定安装目标目录与依赖/来源记录行为 */
  projectType?: MarketProjectType
  /** 目标项目根目录 */
  projectPath: string
  /** 是否一并安装 required 依赖，默认 true */
  includeDependencies?: boolean
  /** 若同 slug 已存在是否覆盖，默认 false（返回冲突提示） */
  overwrite?: boolean
  /** 加载器与 MC 版本（安装后静态分析入榜用，由项目上下文提供） */
  loader?: string
  mcVersion?: string
}

/** 安装结果 */
export interface MarketInstallResult {
  ok: boolean
  /** 已安装的文件路径（项目内相对或绝对） */
  installed?: string
  /** 安装目标目录的展示用相对路径（如 run/mods、run/resourcepacks） */
  installedDir?: string
  /** 已安装的文件名 */
  fileName?: string
  /** 冲突：同 slug 已存在的旧文件 */
  conflict?: { existingFile: string }
  /** 已安装的依赖列表 */
  dependenciesInstalled?: string[]
  /** 安装后静态分析入榜的模组数 */
  analyzed?: number
  /** 静态分析告警（失败不阻断安装） */
  analysisWarnings?: string[]
  /** 非模组类安装提示（如数据包需重进存档、整合包需导入启动器） */
  note?: string
  /** 失败原因 */
  error?: string
}

/**
 * 精选模组「合规直达」预设。
 * 仅保存平台元数据与外链，**绝不内置 jar / 贴图 / 代码等第三方资产**（EULA 与
 * 各模组协议合规）：用户点击入口后一律走市场正常检索 → 详情 → 安装链路，
 * 文件由平台 API 实时拉取。
 */
export interface CuratedModPreset {
  /** 模组所在平台（点击后自动切换） */
  platform: ModPlatform
  /** 平台 slug：作为检索词，并用于在结果中精确匹配详情项 */
  slug: string
  /** 展示名称 */
  name: string
  /** 一句话简介 */
  summary: string
  /** 支持的加载器（兼容性徽标） */
  loaders: string[]
  /** 已知适配的 MC 版本 */
  gameVersions: string[]
  /** 开源协议 */
  license: string
  /** 平台详情页外链 */
  url: string
  /** 合规 / 兼容性提示（卡片常驻展示） */
  note: string
  /** true = 与本工具主线 Fabric 不兼容（官方无 Fabric 版），UI 必须显著警示 */
  fabricIncompatible?: boolean
}

/**
 * 精选模组清单。
 *
 * Epic Fight（CurseForge projectId 405076，slug epic-fight-mod，GPL-3.0）：
 * 战斗机制 overhaul。官方仅发布 Forge/NeoForge 版本，且明确无 Fabric 移植计划，
 * 因此卡片必须标注「Fabric 不可用」；Fabric 项目点击时仅可查看、不可安装。
 */
export const CURATED_MOD_PRESETS: readonly CuratedModPreset[] = [
  {
    platform: 'curseforge',
    slug: 'epic-fight-mod',
    name: 'Epic Fight',
    summary: '战斗机制 overhaul：连招、技能、武器架势与动画化 Boss 战。',
    loaders: ['forge', 'neoforge'],
    gameVersions: ['1.20.1'],
    license: 'GPL-3.0',
    url: 'https://www.curseforge.com/minecraft/mc-mods/epic-fight-mod',
    note: '仅支持 Forge/NeoForge，官方无 Fabric 移植计划；点击后由 CurseForge 实时拉取，本工具不内置任何模组文件。',
    fabricIncompatible: true
  }
]
