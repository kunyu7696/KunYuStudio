/**
 * useTextureEditing：贴图编辑器弹窗与像素画布模型。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useUnifiedStore } from '../../../stores/unified'
import { t } from '../../../i18n'
import type { PixelCanvasModel } from '../../../components/texture/usePixelCanvas'
import type { UnifiedTextureRef } from '../../../../../shared/schemas/unified.schema'

export function useTextureEditing() {
  const store = useUnifiedStore()

  /** 当前对象的贴图 ref（方块取 block[0]，物品取 item），无则 null */
  function activeTextureRef(): UnifiedTextureRef | null {
    const u = store.active
    if (!u) return null
    if (u.type === 'block') return u.assets.textures.block?.[0] ?? null
    if (u.type === 'item') return u.assets.textures.item ?? null
    if (u.type === 'entity') return u.assets.textures.entity ?? null
    return null
  }

  /**
   * 像素画模型：直接引用当前对象的贴图 ref，像素改动就地写回。
   * 首次打开时确保 pixels 已初始化（256 项）。
   */
  const textureModel = computed<PixelCanvasModel>(() => {
    const ref0 = activeTextureRef()
    if (ref0) {
      if (!Array.isArray(ref0.pixels) || ref0.pixels.length !== 256) {
        ref0.pixels = Array(256).fill('')
      }
      return { textureSize: 16, pixels: ref0.pixels }
    }
    return { textureSize: 16, pixels: Array(256).fill('') }
  })

  const textureDialogOpen = ref(false)

  function openTextureEditor(): void {
    textureDialogOpen.value = true
  }

  /** 停笔：像素已就地写回对象，仅提示需要保存/生成落盘 */
  function onTexturePainted(): void {
    // 改动已在 store.active 的贴图 ref 上，无需额外处理
  }

  function onTextureDialogClosed(): void {
    if (store.active) {
      ElMessage.info(t('unified.actions.pixelKept'))
    }
  }

  return {
    textureDialogOpen,
    textureModel,
    activeTextureRef,
    openTextureEditor,
    onTexturePainted,
    onTextureDialogClosed
  }
}
