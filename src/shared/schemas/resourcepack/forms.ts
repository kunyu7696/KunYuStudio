/**
 * 资源包文件类别的表单注册表。
 * texture 走像素画编辑器、二进制文件（.ogg/.ttf）与 other 目录文件返回 null（仅源码模式）。
 */
import type { ResourceFileCategory } from '../resourcepack.schema'
import type { CategoryForm } from '../forms'
import type { SharedLocale } from '../../i18n'
import { getModelForm, MODEL_FORM } from './model.schema'
import { BLOCKSTATE_FORM, getBlockstateForm } from './blockstate.schema'
import { getLangForm, LANG_FORM } from './lang.schema'
import { getSoundsForm, SOUNDS_FORM } from './sounds.schema'
import { FONT_FORM, getFontForm } from './font.schema'
import { getPackMetaForm, PACK_META_FORM } from './packMeta.schema'
import { getItemModelForm, ITEM_MODEL_FORM } from './itemModel'

/** 文件所属类别（包根文件为 'root'） */
export type ResourceFormTarget = ResourceFileCategory | 'root'

/**
 * 取资源包文件的表单定义。
 * @param relPath 包内相对路径（判定 pack.mcmeta 与 root 类文件）；空串表示新建文件
 */
export function resourcepackForm(
  category: ResourceFormTarget,
  relPath: string
): CategoryForm | null {
  const isJson = !relPath || relPath.endsWith('.json')
  switch (category) {
    case 'model':
      return MODEL_FORM
    case 'blockstate':
      return BLOCKSTATE_FORM
    case 'font':
      return FONT_FORM
    case 'lang':
      return isJson ? LANG_FORM : null
    case 'sound':
      return isJson ? SOUNDS_FORM : null
    case 'item_model':
      return isJson ? ITEM_MODEL_FORM : null
    case 'root':
      return !relPath || relPath === 'pack.mcmeta' ? PACK_META_FORM : null
    default:
      return null
  }
}

/** 按语言重建资源包表单（语言切换时由消费侧 computed 调用）；zh-CN/缺省回落冻结常量 */
export function getResourcepackForm(
  category: ResourceFormTarget,
  relPath: string,
  locale?: SharedLocale
): CategoryForm | null {
  if (!locale || locale === 'zh-CN') return resourcepackForm(category, relPath)
  const isJson = !relPath || relPath.endsWith('.json')
  switch (category) {
    case 'model':
      return getModelForm(locale)
    case 'blockstate':
      return getBlockstateForm(locale)
    case 'font':
      return getFontForm(locale)
    case 'lang':
      return isJson ? getLangForm(locale) : null
    case 'sound':
      return isJson ? getSoundsForm(locale) : null
    case 'item_model':
      return isJson ? getItemModelForm(locale) : null
    case 'root':
      return !relPath || relPath === 'pack.mcmeta' ? getPackMetaForm(locale) : null
    default:
      return null
  }
}
