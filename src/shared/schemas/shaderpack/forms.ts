/**
 * 光影包文件类别的表单注册表。
 * 管线着色器（.vsh/.fsh/.gsh）与 lib 公共库为纯 GLSL 源码，返回 null（仅源码模式）。
 */
import type { ShaderFileCategory } from '../shaderpack.schema'
import type { CategoryForm } from '../forms'
import type { SharedLocale } from '../../i18n'
import { getShaderConfigForm, SHADER_CONFIG_FORM } from './config.schema'
import { getShaderLangForm, SHADER_LANG_FORM } from './lang.schema'

/** 取光影包文件的表单定义；null 表示该类内容仅支持源码模式 */
export function shaderpackForm(
  category: ShaderFileCategory,
  ext: string
): CategoryForm | null {
  if (category === 'config') return SHADER_CONFIG_FORM
  if (category === 'lang' && (!ext || ext === '.lang')) return SHADER_LANG_FORM
  return null
}

/** 按语言重建光影包表单（语言切换时由消费侧 computed 调用）；zh-CN/缺省回落冻结常量 */
export function getShaderpackForm(
  category: ShaderFileCategory,
  ext: string,
  locale?: SharedLocale
): CategoryForm | null {
  if (!locale || locale === 'zh-CN') return shaderpackForm(category, ext)
  if (category === 'config') return getShaderConfigForm(locale)
  if (category === 'lang' && (!ext || ext === '.lang')) return getShaderLangForm(locale)
  return null
}
