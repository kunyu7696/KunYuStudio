/**
 * useDatapackEditor：生物群系 / 进度 / 标签的 PackDualEditor 双模式编辑状态。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed, ref, watch } from 'vue'
import { useUnifiedStore } from '../../../stores/unified'
import { t } from '../../../i18n'
import { BIOME_FORM } from '../../../../../shared/schemas/datapack/biome.schema'
import { ADVANCEMENT_FORM } from '../../../../../shared/schemas/datapack/advancement.schema'
import { TAG_FORM } from '../../../../../shared/schemas/datapack/forms'
import type { CategoryForm } from '../../../../../shared/schemas/forms'
import type { UnifiedContent } from '../../../../../shared/schemas/unified.schema'

/** 标签的 doc 形态（标签 JSON 的表单覆盖范围） */
function tagDocOf(a: UnifiedContent): Record<string, unknown> {
  const entry = a.data.tags?.[0]
  return { replace: entry?.replace ?? false, values: [...(entry?.values ?? [])] }
}

/** 同一对象的判定键（标签需带注册表维度，同 id 不同注册表是两个对象） */
function objectStamp(a: UnifiedContent | null): string {
  if (!a) return ''
  return a.type === 'tag' ? `${a.type}:${a.data.tags?.[0]?.registry ?? ''}:${a.id}` : `${a.type}:${a.id}`
}

export function useDatapackEditor() {
  const store = useUnifiedStore()

  /** 是否为纯数据包类型（biome/advancement/tag）：无 Java/资源包端，doc 承载产物 JSON */
  const isDatapackContent = computed<boolean>(
    () =>
      store.active?.type === 'biome' ||
      store.active?.type === 'advancement' ||
      store.active?.type === 'tag'
  )

  /* ================= 生物群系 / 进度 / 标签：PackDualEditor 双模式编辑 ================= */
  /** 当前类型对应的表单定义（biome→世界生成，advancement→进度，tag→标签 JSON） */
  const dpForm = computed<CategoryForm | null>(() => {
    const t = store.active?.type
    if (t === 'biome') return BIOME_FORM
    if (t === 'advancement') return ADVANCEMENT_FORM
    if (t === 'tag') return TAG_FORM
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
    const doc =
      a.type === 'biome'
        ? a.data.biomeDoc ?? {}
        : a.type === 'advancement'
          ? a.data.advancementDoc ?? {}
          : tagDocOf(a)
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
      if (!a || (a.type !== 'biome' && a.type !== 'advancement' && a.type !== 'tag')) return
      // 同对象引用变化（表单内编辑）不重置，仅在切换对象/类型/注册表时重置
      if (prev && objectStamp(prev) === objectStamp(a)) return
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
      else if (a.type === 'advancement') a.data.advancementDoc = doc
      else {
        const entry = a.data.tags?.[0]
        if (!entry) return t('unified.actions.docMustBeObject')
        entry.replace = typeof doc.replace === 'boolean' ? doc.replace : false
        entry.values = Array.isArray(doc.values) ? doc.values.map((v) => String(v)) : []
      }
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
