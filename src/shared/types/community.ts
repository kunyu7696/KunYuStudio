/**
 * KunYu 创作社区（本地创作广场）共享类型。
 * 工具无自有服务器：社区页聚合本机全部项目的语义创作，
 * 作品互换走 .kyshare.json 分享包（语义 JSON 单文件，贴图 pixels 内嵌）。
 */
import type { ContentDefinition, ContentKind } from './content'
import type { ModLoader } from './project'

/** 跨项目聚合的创作条目（画廊卡片数据源） */
export interface CreationEntry {
  /** 所属项目绝对路径 */
  projectPath: string
  projectName: string
  kind: ContentKind
  id: string
  /** 已按 zh→en→id 回落链解析的展示名 */
  displayName: string
  /** 语义文件绝对路径（定位文件用） */
  filePath: string
  updatedAt: number
}

/** 分享包文件格式标识 */
export const KY_SHARE_FORMAT = 'kunyu-share@1'

/** 分享包许可证预设（导出对话框中选择；手工制作的包可能带预设外 id，展示时原样显示） */
export interface KyShareLicensePreset {
  id: string
  label: string
  /** 一句话说明（导出选择器里展示，帮助用户判断「能不能用/改/再分发」） */
  desc: string
}

export const KY_SHARE_LICENSES: readonly KyShareLicensePreset[] = [
  { id: 'MIT', label: 'MIT', desc: '允许任意使用、修改与再分发，需保留版权声明' },
  { id: 'CC-BY-4.0', label: 'CC BY 4.0', desc: '允许分享与演绎（含商用），需署名原作者' },
  { id: 'CC-BY-NC-4.0', label: 'CC BY-NC 4.0', desc: '允许非商业分享与演绎，需署名原作者' },
  { id: 'LEARNING-ONLY', label: '仅供学习', desc: '仅供学习参考，禁止商用与再分发' },
  { id: 'ARR', label: '保留所有权利', desc: '他人仅可使用，不得修改或再分发' }
]

/** .kyshare.json 分享包：语义 JSON 原样内嵌（贴图 pixels 随语义走，导入后生成时重建） */
export interface KySharePackage {
  format: typeof KY_SHARE_FORMAT
  exportedAt: string
  /** 导出项目的模组加载器（旧包/包类项目可能缺失，导入侧显示「未知」） */
  loader?: ModLoader
  /** 导出项目面向的 MC 版本（旧包可能缺失） */
  mcVersion?: string
  /** 许可证预设 id（见 KY_SHARE_LICENSES）；旧包/导出未选择时缺失，导入侧显示「未声明」 */
  license?: string
  /** 依赖说明（如依赖的模组/内容 id 列表）；未声明时缺失 */
  dependencies?: string[]
  /** 来源说明（导出来源项目等） */
  provenance?: string
  /** 语义对象（block/item/entity/model/recipe/texture/enchantment） */
  content: ContentDefinition
}

/**
 * 导入预览：读包后、落盘前返回给渲染层展示的元数据。
 * 确认导入时回传 filePath，避免重复弹文件选择框。
 */
export interface SharePackagePreview {
  status: 'preview'
  /** 已选分享包文件路径 */
  filePath: string
  kind: ContentKind
  id: string
  /** 已按 zh→en→id 回落链解析的展示名 */
  displayName: string
  exportedAt?: string
  loader?: ModLoader
  mcVersion?: string
  license?: string
  dependencies?: string[]
  provenance?: string
  /** 目标项目已存在同 kind+id 内容（确认导入即覆盖） */
  conflict: boolean
  existingDisplayName?: string
}

/** 导入结果：imported=已写入；conflict=同 kind+id 已存在（需用户确认覆盖后重试） */
export interface ImportCreationResult {
  status: 'imported' | 'conflict'
  kind?: ContentKind
  id?: string
  displayName?: string
}
