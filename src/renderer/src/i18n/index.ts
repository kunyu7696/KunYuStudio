import { readonly, ref } from 'vue'
import type { LocalePreference } from '../../../shared/types/settings'
import { setSharedLocale, sharedT } from '../../../shared/i18n'
import zhCN, { type Messages } from './messages/zh-CN'
import enUS from './messages/en-US'

/**
 * 渲染层多语言（阶段 A：框架层）。
 * 零依赖轻量实现：中文为源语言与兜底语言，英文为第一套译文；
 * 新增语言只需在 messages/ 下加一份同构语言包并登记到 catalogs。
 */
export type AppLocale = 'zh-CN' | 'en-US'
export type { LocalePreference }

/** 支持的语言（顺序即设置页下拉顺序） */
export const SUPPORTED_LOCALES: readonly AppLocale[] = ['zh-CN', 'en-US']

/** 源语言：任何缺失键都回退到这里 */
export const SOURCE_LOCALE: AppLocale = 'zh-CN'

const catalogs: Record<AppLocale, Messages> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

/** 当前生效语言；用 ref 保证模板中 t() 随切换重新求值 */
const activeLocale = ref<AppLocale>(SOURCE_LOCALE)

export const locale = readonly(activeLocale)

type MessageTree = { [key: string]: string | MessageTree }

/** 按语言偏好解析出具体语言；system 取操作系统语言，非中文一律回落英文 */
export function resolveLocale(pref: LocalePreference | string | null | undefined): AppLocale {
  if (pref === 'zh-CN' || pref === 'en-US') return pref
  if (pref === 'system') {
    const lang = typeof navigator === 'undefined' ? '' : navigator.language
    return lang.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
  }
  return SOURCE_LOCALE
}

/** 切换语言（设置页与启动 hydrate 各调用一次），返回实际生效语言 */
export function setLocale(pref: LocalePreference | string | null | undefined): AppLocale {
  activeLocale.value = resolveLocale(pref)
  // 同步共享层语言：schema 校验错误与选项重建走同一语言
  setSharedLocale(activeLocale.value)
  return activeLocale.value
}

/**
 * 共享层 schema 文案的响应式翻译：模板/computed 内调用即可随语言切换重算
 * （sharedT 本身不依赖响应式，这里读 activeLocale.value 建立依赖）。
 */
export function st(key: string, params?: Record<string, string | number>): string {
  return sharedT(key, params, activeLocale.value)
}

/** 按点分路径取叶子字符串（只认 string 叶子，中间节点不参与翻译） */
function lookup(tree: Messages, path: string[]): string | undefined {
  let node: string | MessageTree | undefined = tree as unknown as MessageTree
  for (const part of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** 键是否存在（当前语言或源语言任一命中） */
export function te(key: string): boolean {
  const path = key.split('.')
  return (
    lookup(catalogs[activeLocale.value], path) !== undefined ||
    lookup(catalogs[SOURCE_LOCALE], path) !== undefined
  )
}

function interpolate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

/**
 * 翻译：当前语言 → 源语言 → 键名本身。
 * params 用 {name} 占位替换，缺失参数保留原占位符便于排查。
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const path = key.split('.')
  const raw =
    lookup(catalogs[activeLocale.value], path) ??
    lookup(catalogs[SOURCE_LOCALE], path) ??
    key
  return params ? interpolate(raw, params) : raw
}

/** 组合式入口：组件里可 const { t, locale } = useI18n()，也可直接 import { t } */
export function useI18n(): {
  t: typeof t
  te: typeof te
  locale: typeof locale
  setLocale: typeof setLocale
} {
  return { t, te, locale, setLocale }
}

/** 模块元数据文案：约定键 modules.<id>.name / modules.<id>.description，
 *  语言包缺失时回退注册表里的中文原名（保证第三方模块不受影响）。 */
export function moduleName(mod: { id: string; name: string }): string {
  const key = `modules.${mod.id}.name`
  return te(key) ? t(key) : mod.name
}

export function moduleDescription(mod: { id: string; description: string }): string {
  const key = `modules.${mod.id}.description`
  return te(key) ? t(key) : mod.description
}
