/**
 * 资源包编辑器语义结构（P0：项目管理 + pack.mcmeta + 分类文件树 + 图标）。
 *
 * 资源包是独立分发单位（.zip，解开即 pack.mcmeta + pack.png + assets/）；
 * 模组项目里资源又天然位于 src/main/resources/assets/，两者共存。
 * 开发期独立资源包目录落在 <projectRoot>/resourcepacks/<packId>/，
 * 后续可直接打包该目录导出 zip（zip 内不多一层目录）。
 */
import { validateContentId } from '../types/content'
import { resourcepackForm } from './resourcepack/forms'
import { sharedT, type SharedLocale } from '../i18n'

/** 资源包元数据（存于项目 .kunyu/resourcepack.json） */
export interface ResourcePackMeta {
  /** 包目录名（resourcepacks/<packId>），小写安全字符 */
  packId: string
  /** 展示名（任意字符） */
  name: string
  mcVersion: string
  /** pack.mcmeta 的 pack_format（随 mcVersion 自动匹配） */
  packFormat: number
  description: string
  /** 自定义命名空间（默认 mymod），目录 assets/<namespace>/ */
  namespace: string
  createdAt: number
  updatedAt: number
}

/**
 * pack_format 数值表、版本选项与表单提示的单一真源位于
 * resourcepack/formats.ts；此处 re-export 保持既有导入路径兼容。
 */
export {
  RESOURCE_PACK_FORMATS,
  RESOURCE_PACK_VERSIONS,
  resourcePackFormatHint
} from './resourcepack/formats'

import { RESOURCE_PACK_FORMATS } from './resourcepack/formats'

/**
 * pack_format 反查 MC 版本（导入/升级场景）。
 * 一个 pack_format 可能对应多个版本时取映射表中第一个匹配项。
 */
export function mcVersionFromPackFormat(packFormat: number): string {
  for (const [version, fmt] of Object.entries(RESOURCE_PACK_FORMATS)) {
    if (fmt === packFormat) return version
  }
  return '1.20.1'
}

/**
 * 文件树分组类别。
 * 资源包 assets/ 目录可递归含子目录（textures/block/ 等），
 * 分类由顶层相对目录判定，节点 id 保留相对子路径。
 */
export type ResourceFileCategory =
  | 'texture'
  | 'model'
  | 'blockstate'
  | 'sound'
  | 'font'
  | 'lang'
  | 'item_model'
  | 'other'

export interface ResourceCategoryInfo {
  key: ResourceFileCategory
  label: string
  hint: string
  /** 包内相对目录（assets/<ns>/ 之后）；'' 表示 assets/<ns>/ 根 */
  dir: string
  /** 新建文件的默认扩展名 */
  defaultExt: string
  /** 是否允许新建文件（文本类别走源码编辑；texture 走像素画编辑器） */
  creatable: boolean
  /** 新建时可选子目录（如 textures/block）；空数组表示无子目录 */
  subDirs: string[]
}

/** 类别注册表 builder（常量在 import 时按当前语言冻结，getter 支持按语言重建） */
function buildResourceCategories(locale?: SharedLocale): ResourceCategoryInfo[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    {
      key: 'texture',
      label: t('schema.resourcepack.catTexture'),
      hint: t('schema.resourcepack.catTextureHint'),
      dir: 'textures',
      defaultExt: '.png',
      creatable: true,
      subDirs: ['block', 'item', 'entity', 'gui']
    },
    {
      key: 'model',
      label: t('schema.resourcepack.catModel'),
      hint: t('schema.resourcepack.catModelHint'),
      dir: 'models',
      defaultExt: '.json',
      creatable: true,
      subDirs: ['block', 'item']
    },
    {
      key: 'blockstate',
      label: t('schema.resourcepack.catBlockstate'),
      hint: t('schema.resourcepack.catBlockstateHint'),
      dir: 'blockstates',
      defaultExt: '.json',
      creatable: true,
      subDirs: []
    },
    {
      key: 'sound',
      label: t('schema.resourcepack.catSound'),
      hint: t('schema.resourcepack.catSoundHint'),
      dir: 'sounds',
      defaultExt: '.ogg',
      creatable: false,
      subDirs: []
    },
    {
      key: 'font',
      label: t('schema.resourcepack.catFont'),
      hint: t('schema.resourcepack.catFontHint'),
      dir: 'font',
      defaultExt: '.json',
      creatable: true,
      subDirs: []
    },
    {
      key: 'lang',
      label: t('schema.resourcepack.catLang'),
      hint: t('schema.resourcepack.catLangHint'),
      dir: 'lang',
      defaultExt: '.json',
      creatable: true,
      subDirs: []
    },
    {
      key: 'item_model',
      label: t('schema.resourcepack.catItemModel'),
      hint: t('schema.resourcepack.catItemModelHint'),
      dir: 'items',
      defaultExt: '.json',
      creatable: true,
      subDirs: []
    },
    {
      key: 'other',
      label: t('schema.resourcepack.catOther'),
      hint: t('schema.resourcepack.catOtherHint'),
      dir: '',
      defaultExt: '.json',
      creatable: false,
      subDirs: []
    }
  ]
}

/** 类别注册表（文件树分组与新建目录共用；UI 侧请用 getResourceCategories 建立响应式） */
export const RESOURCE_CATEGORIES: ResourceCategoryInfo[] = buildResourceCategories()

/** 按语言取类别注册表（组件 computed 内传 locale.value 建立响应式依赖） */
export function getResourceCategories(locale?: SharedLocale): ResourceCategoryInfo[] {
  return buildResourceCategories(locale)
}

export function resourceCategoryInfo(key: string): ResourceCategoryInfo | undefined {
  return RESOURCE_CATEGORIES.find((c) => c.key === key)
}

/** 资源包文件节点 */
export interface ResourcePackFile {
  /** 文件名（不含扩展名），子目录文件保留目录前缀如 block/ruby_ore */
  id: string
  /** 包内相对路径：assets/<ns>/textures/block/a.png / pack.mcmeta */
  relPath: string
  category: ResourceFileCategory | 'root'
  /** 扩展名（小写，含点） */
  ext: string
  /** 是否文本可编辑（json/mcmeta/txt 可编辑；png/ogg/ttf 等只读展示） */
  editable: boolean
  updatedAt: number
}

/** 可在 P0 编辑器内文本编辑的扩展名 */
export const RESOURCE_TEXT_EXT = new Set(['.json', '.mcmeta', '.txt', '.lang', '.properties'])

/**
 * 按 assets/<ns>/ 之后的相对路径分类。
 * 顶层段决定类别（textures/models/blockstates/sounds/font/lang），其余归 other。
 */
export function classifyResourceFile(relToNs: string): ResourceFileCategory {
  const first = relToNs.split('/')[0]
  switch (first) {
    case 'textures':
      return 'texture'
    case 'models':
      return 'model'
    case 'blockstates':
      return 'blockstate'
    case 'sounds':
      return 'sound'
    case 'font':
      return 'font'
    case 'lang':
      return 'lang'
    case 'items':
      return 'item_model'
    default:
      return 'other'
  }
}

/** 新建资源包元数据 */
export function createResourcePackMeta(input: {
  packId: string
  name: string
  mcVersion: string
  description: string
  namespace: string
}): ResourcePackMeta {
  const now = Date.now()
  const packFormat = RESOURCE_PACK_FORMATS[input.mcVersion] ?? 15
  return {
    packId: input.packId,
    name: input.name || input.packId,
    mcVersion: input.mcVersion,
    packFormat,
    description: input.description || '',
    namespace: input.namespace || 'mymod',
    createdAt: now,
    updatedAt: now
  }
}

/** 校验资源包元数据；返回错误消息，合法返回 null */
export function validateResourcePackMeta(meta: ResourcePackMeta): string | null {
  if (!validateContentId(meta.packId)) {
    return sharedT('schema.common.errPackIdInvalid')
  }
  if (!(meta.name || '').trim()) {
    return sharedT('schema.resourcepack.errNameRequired')
  }
  if (!validateContentId(meta.namespace)) {
    return sharedT('schema.common.errNamespaceInvalid')
  }
  if (!RESOURCE_PACK_FORMATS[meta.mcVersion]) {
    return sharedT('schema.common.errMcVersionUnsupported', { v: meta.mcVersion })
  }
  return null
}

/** pack.mcmeta 内容 */
export function buildResourcePackMcmeta(meta: ResourcePackMeta): string {
  return `${JSON.stringify(
    {
      pack: {
        pack_format: meta.packFormat,
        description: meta.description || meta.name
      }
    },
    null,
    2
  )}\n`
}

/**
 * 新建文件的包内相对路径。
 * @param sub 类别下的子目录（如 textures 的 block），无子目录传空串
 */
export function resourceFileRelPath(
  namespace: string,
  category: ResourceCategoryInfo,
  sub: string,
  fileName: string
): string {
  const segs = ['assets', namespace, category.dir]
  if (sub) segs.push(sub)
  return `${segs.filter(Boolean).join('/')}/${fileName}`
}

/** 新建文件的内容模板（取该类别的表单默认值，保证「表单 ⇄ 源码」内容一致） */
export function createResourceFileTemplate(category: ResourceFileCategory): string {
  const form = resourcepackForm(category, '')
  if (!form) return '{}\n'
  return `${JSON.stringify(form.createDefault(), null, 2)}\n`
}
