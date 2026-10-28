/**
 * CUE（Context Understanding Engine）注册入口（M1）。
 *
 * registerCue 在指定语言上注册 InlineCompletionsProvider，返回 CueHandle 用于
 * 设置变化时更新、编辑器卸载时 dispose。disposeCue 反注册并释放。
 *
 * 用法（CodeEditor.vue）：
 *   const handle = registerCue({ settings, defaultProviderId, modelOverride })
 *   // settings 变化时：handle.update(nextOptions)
 *   // onBeforeUnmount：handle.dispose()
 */
import { monaco } from '../setup'
import {
  createCueInlineProvider,
  type CueProviderHandle,
  type CueProviderOptions
} from './inlineCompletionProvider'

export { splitFimContext } from './fimPrompt'
export type { FimContext } from './fimPrompt'
export type { CueProviderOptions, CueProviderHandle } from './inlineCompletionProvider'
export { createChangePointTracker } from './changePoints'
export type {
  ChangePoint,
  ChangePointTracker,
  ChangePointTrackerOptions
} from './changePoints'

export interface CueHandle extends CueProviderHandle {
  /** 已注册的语言 id 列表（用于 dispose 时反注册） */
  readonly languages: readonly string[]
}

/**
 * 在 cue.settings.languages 列出的所有语言上注册 InlineCompletionsProvider。
 * Monaco 的 registerInlineCompletionsProvider 是按语言注册的，需对每个语言单独调用。
 */
export function registerCue(options: CueProviderOptions): CueHandle {
  const { provider, handle } = createCueInlineProvider(options)
  const languages = [...options.settings.languages]
  const disposers = languages.map((lang) =>
    monaco.languages.registerInlineCompletionsProvider(lang, provider)
  )
  return {
    ...handle,
    languages,
    dispose() {
      handle.dispose()
      for (const d of disposers) d.dispose()
    }
  }
}
