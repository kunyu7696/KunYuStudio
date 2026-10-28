/**
 * useObjectNav：顶部类型 Tab / 对象切换 / 新建对象。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useProjectStore } from '../../../stores/project'
import { useUnifiedStore } from '../../../stores/unified'
import { t } from '../../../i18n'
import type { UnifiedContentType } from '../../../../../shared/schemas/unified.schema'

const CONTENT_TYPES: UnifiedContentType[] = ['block', 'item', 'entity', 'biome', 'advancement']

export function useObjectNav() {
  const projectStore = useProjectStore()
  const store = useUnifiedStore()

  const ns = computed(() => projectStore.currentProject?.namespace || 'mymod')

  /* ---- 顶部类型 Tab：同类型有对象选第一个，无对象则新建 ---- */
  function onKindTab(v: string | number | boolean | undefined): void {
    const type = v as UnifiedContentType
    if (
      type !== 'block' &&
      type !== 'item' &&
      type !== 'entity' &&
      type !== 'biome' &&
      type !== 'advancement'
    ) {
      return
    }
    if (store.active?.type === type) return
    const first = store.objects.find((o) => o.type === type)
    if (first) store.select(first)
    else store.beginNew(type, ns.value)
  }

  /* ================= 顶部对象切换 / 新建 ================= */
  const objectGroups = computed(() => {
    const defs: { label: string; type: UnifiedContentType }[] = [
      { label: t('unified.kind.block'), type: 'block' },
      { label: t('unified.kind.item'), type: 'item' },
      { label: t('unified.kind.entity'), type: 'entity' },
      { label: t('unified.kind.biome'), type: 'biome' },
      { label: t('unified.kind.advancement'), type: 'advancement' }
    ]
    return defs.map((d) => ({
      label: d.label,
      items: store.objects.filter((o) => o.type === d.type)
    }))
  })

  function onSwitchObject(id: string): void {
    const target = store.objects.find((o) => o.id === id)
    if (target) store.select(target)
  }

  async function onNewObject(cmd: string): Promise<void> {
    // 自定义：直接指定注册名，其余字段全空（不套用任何模板），生物群系/进度同样支持
    if (cmd.startsWith('custom:')) {
      const type = cmd.slice('custom:'.length) as UnifiedContentType
      if (!CONTENT_TYPES.includes(type)) return
      try {
        const answer = await ElMessageBox.prompt(
          t('unified.actions.idPrompt'),
          t('unified.actions.customTitle'),
          {
            confirmButtonText: t('unified.actions.create'),
            cancelButtonText: t('common.cancel'),
            inputPlaceholder: t('unified.actions.idPlaceholder'),
            inputPattern: /^[a-z][a-z0-9_]{0,63}$/,
            inputErrorMessage: t('unified.actions.idInvalid')
          }
        )
        store.beginNew(type, ns.value, answer.value.trim())
      } catch {
        /* 用户取消 */
      }
      return
    }
    if (CONTENT_TYPES.includes(cmd as UnifiedContentType)) {
      store.beginNew(cmd as UnifiedContentType, ns.value)
    }
  }

  return { objectGroups, onKindTab, onSwitchObject, onNewObject }
}
