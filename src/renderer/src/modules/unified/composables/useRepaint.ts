/**
 * useRepaint：AI 重绘候选画廊（A3）与舞台贴图像素。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import { ElMessage } from 'element-plus'
import { useUnifiedStore } from '../../../stores/unified'
import { t } from '../../../i18n'
import type { EmbeddedCubeModel } from '../../../../../shared/types/content'
import type { UnifiedTextureRef } from '../../../../../shared/schemas/unified.schema'

export function useRepaint(
  cubeModel: ComputedRef<EmbeddedCubeModel | null>,
  activeTextureRef: () => UnifiedTextureRef | null
) {
  const store = useUnifiedStore()

  /* ================================================================== */
  /* 展示 / 建模区：当前对象贴图像素与形态                                  */
  /* ================================================================== */

  const activePixels = computed<string[]>(() => {
    const u = store.active
    if (!u) return []
    if (u.type === 'block') return u.assets.textures.block?.[0]?.pixels ?? []
    if (u.type === 'item') return u.assets.textures.item?.pixels ?? []
    return u.assets.textures.entity?.pixels ?? []
  })

  const stageShape = computed<'cube' | 'plane'>(() =>
    store.active?.type === 'block' ? 'cube' : 'plane'
  )

  /* ---- AI 重绘候选画廊（A3）：目标贴图优先取嵌入式 Cube 模型，否则对象主贴图 ---- */
  const repaintOpen = ref(false)
  const repaintTarget = computed<{ size: 16 | 32; pixels: string[]; shape: 'cube' | 'plane' }>(() => {
    const cm = cubeModel.value
    if (cm) return { size: cm.textureSize, pixels: cm.pixels, shape: 'cube' }
    return { size: 16, pixels: activePixels.value, shape: stageShape.value }
  })

  function openRepaint(): void {
    if (repaintTarget.value.pixels.length === 0) {
      ElMessage.warning(t('unified.actions.noTexturePixels'))
    }
    repaintOpen.value = true
  }

  /** 用户在画廊确认候选：就地写回对应贴图（保存/生成时才落盘 PNG） */
  function onRepaintApplied(pixels: string[]): void {
    const cm = cubeModel.value
    if (cm) {
      cm.pixels = pixels
      ElMessage.success(
        t('unified.actions.repaintAppliedModel', { w: cm.textureSize, h: cm.textureSize })
      )
      return
    }
    const ref0 = activeTextureRef()
    if (!ref0) {
      ElMessage.error(t('unified.actions.textureSlotNotFound'))
      return
    }
    ref0.pixels = pixels
    ElMessage.success(t('unified.actions.repaintApplied'))
  }

  return { activePixels, stageShape, repaintOpen, repaintTarget, openRepaint, onRepaintApplied }
}
