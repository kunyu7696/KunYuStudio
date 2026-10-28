/**
 * useFieldBindings：基础字段、类型化属性、贴图路径、自定义代码的双向绑定。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed } from 'vue'
import { useUnifiedStore } from '../../../stores/unified'
import type { BlockProperties } from '../../../../../shared/schemas/block.schema'
import type { ItemJavaProperties, EntityJavaProperties, UnifiedModel } from '../../../../../shared/schemas/unified.schema'
import type { EntityAttributes } from '../../../../../shared/schemas/entity.schema'
import type { UnifiedTextureRef } from '../../../../../shared/schemas/unified.schema'

export function useFieldBindings() {
  const store = useUnifiedStore()

  /* ---- 类型化属性访问 ---- */
  const blockProps = computed(() => store.active?.java.properties as BlockProperties)
  const itemProps = computed(() => store.active?.java.properties as ItemJavaProperties)
  const entityProps = computed(() => store.active?.java.properties as EntityJavaProperties)
  const entityAttrs = computed(() => (store.active?.java.attributes ?? {}) as EntityAttributes)

  const itemModel = computed<UnifiedModel>(() => store.active?.assets.model ?? { type: 'item_generated' })

  /* ---- 自定义代码片段（null ↔ textarea 空字符串互转） ---- */
  const customLogicText = computed<string>({
    get: () => store.active?.java.customLogic ?? '',
    set: (v: string) => {
      if (store.active) store.active.java.customLogic = v.trim() ? v : null
    }
  })

  /* ---- 贴图路径双向绑定 ---- */
  const blockTexPath = computed({
    get: () => store.active?.assets.textures.block?.[0]?.path ?? '',
    set: (v: string) => {
      if (store.active?.assets.textures.block?.[0]) store.active.assets.textures.block[0].path = v
    }
  })
  const itemTexPath = computed({
    get: () => store.active?.assets.textures.item?.path ?? '',
    set: (v: string) => {
      if (store.active?.assets.textures.item) store.active.assets.textures.item.path = v
    }
  })
  const entityTexPath = computed({
    get: () => store.active?.assets.textures.entity?.path ?? '',
    set: (v: string) => {
      if (store.active?.assets.textures.entity) store.active.assets.textures.entity.path = v
    }
  })

  /* ---- 当前对象的贴图 ref（方块取 block[0]，物品取 item），无则 null ---- */
  function activeTextureRef(): UnifiedTextureRef | null {
    const u = store.active
    if (!u) return null
    if (u.type === 'block') return u.assets.textures.block?.[0] ?? null
    if (u.type === 'item') return u.assets.textures.item ?? null
    if (u.type === 'entity') return u.assets.textures.entity ?? null
    return null
  }

  /* ---- 语言键编辑 ---- */
  const langKeys = computed({
    get: () => {
      const obj = store.active?.assets.lang ?? {}
      return { ...obj }
    },
    set: () => {}
  })

  function addLangKey(): void {
    if (!store.active) return
    const key = `key_${Date.now()}`
    store.active.assets.lang[key] = ''
  }
  function removeLangKey(key: string): void {
    if (!store.active) return
    delete store.active.assets.lang[key]
  }

  return {
    blockProps,
    itemProps,
    entityProps,
    entityAttrs,
    itemModel,
    customLogicText,
    blockTexPath,
    itemTexPath,
    entityTexPath,
    activeTextureRef,
    langKeys,
    addLangKey,
    removeLangKey
  }
}
