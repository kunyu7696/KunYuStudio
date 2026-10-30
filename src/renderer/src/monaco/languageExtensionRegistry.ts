/**
 * 插件语言「扩展名 → 语言 id」映射。
 * 独立成无 Monaco 依赖的微型模块：pluginLanguages 注册时填充，
 * editor store 的 extToLanguage 查表——避免 store 经由本链路静态拉入 Monaco。
 */
const pluginExtensions = new Map<string, string>()

/** 登记一个扩展名映射（ext 含点或不含点均可，内部统一为不含点的小写） */
export function registerPluginExtension(ext: string, languageId: string): void {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  if (normalized) pluginExtensions.set(normalized, languageId)
}

/** 查询扩展名对应的插件语言 id（未命中返回 undefined） */
export function pluginLanguageForExtension(ext: string): string | undefined {
  return pluginExtensions.get(ext.toLowerCase())
}
