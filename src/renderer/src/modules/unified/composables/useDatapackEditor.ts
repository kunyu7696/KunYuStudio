/**
 * useDatapackEditor：生物群系 / 进度的 PackDualEditor 双模式编辑状态。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed, ref, watch } from 'vue'
import { useUnifiedStore } from '../../../stores/unified'
import { t } from '../../../i18n'
import { BIOME_FORM } from '../../../../../shared/schemas/datapack/biome.schema'
import { ADVANCEMENT_FORM } from '../../../../../shared/schemas/datapack/advancement.schema'
import type { CategoryForm } from '../../../../../shared/schemas/forms'

export function useDatapackEditor() {
  const store = useUnifiedStore()

  /** 是否为纯数据包类型（biome/advancement）：无 Java/资源包端，doc 承载产物 JSON */
  const isDatapackContent = computed<boolean>(
    () => store.active?.type === 'biome' || store.active?.type === 'advancement'
  )

  /* ================= 生物群系 / 进度：PackDualEditor 双模式编辑 ================= */
  /** 当前类型对应的表单定义（biome→世界生成表单，advancement→进度表单） */
  const dpForm = computed<CategoryForm | null>(() => {
    const t = store.active?.type
    if (t === 'biome') return BIOME_FORM
    if (t === 'advancement') return ADVANCEMENT_FORM
    return null
  })
  const dpMode = ref<'form' | 'source'>('form')
  const dpFormValue = ref<Record<string, unknown>>({})
  const dpFormContext = ref<unknown>({})
  const dpSourceText = ref('')

  /** 从 active 对象的 doc 重置编辑器状态（选择/新建/放弃时调用） */
  function resetDpEditor(): void {
    const a = store.active
    const form = dpForm.value
    if (!a || !form) return
    const doc = (a.type === 'biome' ? a.data.biomeDoc : a.data.advancementDoc) ?? {}
    const text = JSON.stringify(doc, null, 2) + '\n'
    const parsed = form.parse(text)
    if (parsed) {
      dpFormValue.value = parsed.value
      dpFormContext.value = parsed.context
      dpMode.value = 'form'
    } else {
      dpFormValue.value = {}
      dpFormContext.value = {}
      dpMode.value = 'source'
    }
    dpSourceText.value = text
  }

  /** 切换编辑对象时同步双模式编辑器 */
  watch(
    () => store.active,
    (a, prev) => {
      if (!a || (a.type !== 'biome' && a.type !== 'advancement')) return
      // 同对象引用变化（表单内编辑）不重置，仅在切换对象/类型时重置
      if (prev && prev.type === a.type && prev.id === a.id) return
      resetDpEditor()
    },
    { flush: 'post' }
  )

  /** 保存前把双模式编辑器内容写回 active 对象的 doc */
  function commitDpEditor(): string | null {
    const a = store.active
    const form = dpForm.value
    if (!a || !form) return null
    let text: string
    if (dpMode.value === 'form') {
      text = form.serialize(dpFormValue.value, dpFormContext.value)
    } else {
      text = dpSourceText.value
    }
    try {
      const doc = JSON.parse(text) as Record<string, unknown>
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        return t('unified.actions.docMustBeObject')
      }
      if (a.type === 'biome') a.data.biomeDoc = doc
      else a.data.advancementDoc = doc
      return null
    } catch (e) {
      return t('unified.actions.jsonParseFailed', { error: (e as Error).message })
    }
  }

  return {
    isDatapackContent,
    dpForm,
    dpMode,
    dpFormValue,
    dpFormContext,
    dpSourceText,
    resetDpEditor,
    commitDpEditor
  }
}
