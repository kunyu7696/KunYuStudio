/**
 * useQuickCreate：快速创建模板（C5）。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectStore } from '../../../stores/project'
import { useUnifiedStore } from '../../../stores/unified'
import { getQuickCreateTemplates } from '../../../../../shared/schemas/quickCreate'
import { t, locale } from '../../../i18n'

export function useQuickCreate() {
  const projectStore = useProjectStore()
  const store = useUnifiedStore()

  const ns = computed(() => projectStore.currentProject?.namespace || 'mymod')

  /** 快速创建模板仅适用于方块/物品/实体 */
  const quickCreateEnabled = computed<boolean>(() => {
    const t = store.active?.type
    return !t || t === 'block' || t === 'item' || t === 'entity'
  })

  /* ================= QuickCreate 快速创建（C5） ================= */
  const quickTemplates = computed(() => getQuickCreateTemplates(locale.value))

  /** 配方模板需要当前对象为方块或物品 */
  const canQuickRecipe = computed<boolean>(
    () => store.active?.type === 'block' || store.active?.type === 'item'
  )

  /** 模板显示名（Boss 等专有名称的中文由语言包提供） */
  const QUICK_LABEL = computed<Record<string, string>>(() =>
    Object.fromEntries(
      quickTemplates.value.map((tpl) => [tpl.id, t(`unified.quickTemplate.${tpl.id}.label`)])
    )
  )

  async function onQuickCreate(cmd: string): Promise<void> {
    if (cmd === 'recipe') {
      const err = store.addQuickRecipeToActive()
      if (err) ElMessage.warning(err)
      else ElMessage.success(t('unified.actions.quickRecipeAdded'))
      return
    }
    const label = QUICK_LABEL.value[cmd]
    if (!label) return
    let answer: { value: string }
    try {
      answer = await ElMessageBox.prompt(
        t('unified.actions.quickPrompt', { label }),
        t('unified.actions.quickTitle', { label }),
        {
          confirmButtonText: t('unified.actions.create'),
          cancelButtonText: t('common.cancel'),
          inputPlaceholder: t('unified.actions.idPlaceholder'),
          inputPattern: /^[a-z][a-z0-9_]{0,63}$/,
          inputErrorMessage: t('unified.actions.idInvalid')
        }
      )
    } catch {
      return // 用户取消
    }
    store.beginQuickCreate(cmd as 'block' | 'item' | 'food' | 'entity' | 'boss' | 'tool' | 'armor', {
      id: answer.value.trim(),
      namespace: ns.value
    })
    ElMessage.success(t('unified.actions.quickCreated', { label }))
  }

  return { quickCreateEnabled, quickTemplates, canQuickRecipe, onQuickCreate }
}
