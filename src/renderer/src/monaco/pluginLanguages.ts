/**
 * 渲染层声明式插件注册：把主进程扫描到的语言着色插件注册进 Monaco。
 *
 * - 懒加载、幂等：CodeEditor 首次挂载时触发一次，失败静默不阻塞编辑器；
 * - 与内置语言冲突的 id 直接跳过（Monaco getLanguages 为准），
 *   用户目录的插件无法覆盖内置高亮；
 * - monarch 配置在 JSON 中是宽松结构，此处与 packLanguages 同样显式断言类型。
 */
import { monaco } from './setup'
import { registerPluginExtension } from './languageExtensionRegistry'
import { validateRendererPlugin } from '../../../shared/types/rendererPlugin'

let started = false

export async function registerPluginLanguages(): Promise<void> {
  if (started) return
  started = true
  try {
    const res = await window.api.plugin.listRendererPlugins()
    if (!res.ok) return
    const existing = new Set(monaco.languages.getLanguages().map((l) => l.id))
    for (const plugin of res.plugins) {
      // 渲染层再校验一次（与主进程同一份校验器，双层防御）
      if (!validateRendererPlugin(plugin.manifest).ok) continue
      for (const lang of plugin.languages) {
        if (existing.has(lang.id)) continue
        monaco.languages.register({
          id: lang.id,
          aliases: lang.aliases,
          extensions: lang.extensions
        })
        if (lang.configuration) {
          monaco.languages.setLanguageConfiguration(
            lang.id,
            lang.configuration as monaco.languages.LanguageConfiguration
          )
        }
        monaco.languages.setMonarchTokensProvider(
          lang.id,
          lang.monarch as monaco.languages.IMonarchLanguage
        )
        for (const ext of lang.extensions ?? []) {
          registerPluginExtension(ext, lang.id)
        }
        existing.add(lang.id)
      }
    }
  } catch {
    /* 插件加载失败不阻塞编辑器（通道异常/坏 JSON 等） */
  }
}
