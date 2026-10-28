<template>
  <aside class="rmp">
    <header class="rmp-head">
      <span class="rmp-title">{{ t('resourcepack.modelPreview.title') }}</span>
      <span v-if="parent" class="rmp-parent" :title="t('resourcepack.modelPreview.parentTip', { parent })">
        parent: {{ parentShort }}
      </span>
    </header>

    <div v-if="error" class="rmp-msg">{{ error }}</div>
    <template v-else>
      <ModelPreview
        :shape="hasElements ? 'elements' : 'plane'"
        :elements="elements"
        :pixels="pixels"
        :texture-size="textureSize"
        fill
      />
      <p v-if="!hasElements" class="rmp-msg">
        {{ t('resourcepack.modelPreview.noElements') }}
      </p>
      <p v-if="!texturePath" class="rmp-msg">{{ t('resourcepack.modelPreview.noTexture') }}</p>
      <p v-else class="rmp-tex" :title="texturePath">{{ texturePath }}</p>
    </template>
  </aside>
</template>

<script setup lang="ts">
/**
 * ResourceModelPreview：资源包模型 JSON 的只读 3D 预览（右栏）。
 * elements 直传 ModelPreview（MC Java 元素与 CubeElement 同构）；
 * 主贴图按 all/layer0/texture/particle 优先级解析为包内 PNG，经 IPC 读为
 * data URL 再解码成语义像素；父模型继承的元素不解析（原版父模型不在包内）。
 */
import { ref, watch } from 'vue'
import type { CubeElement } from '../../../../shared/types/content'
import {
  parseJavaModel,
  resolveMainTextureRef,
  textureRefToPackPath
} from '../../../../shared/schemas/resourcepack/modelPreview'
import ModelPreview from '../modeler/preview/ModelPreview.vue'
import { dataUrlImageSize, dataUrlToSquarePixels } from '../../utils/pixels'
import { t } from '../../i18n'

const props = defineProps<{
  root: string
  mode: 'standalone' | 'embedded'
  /** 模型 JSON 文本（编辑器实时内容；组件内部去抖解析） */
  modelText: string
}>()

const elements = ref<CubeElement[]>([])
const pixels = ref<string[]>([])
const textureSize = ref(16)
const texturePath = ref('')
const parent = ref('')
const parentShort = ref('')
const error = ref('')

const hasElements = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null
let seq = 0

watch(
  () => [props.modelText, props.root, props.mode] as const,
  () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void reload(), 350)
  },
  { immediate: true }
)

async function reload(): Promise<void> {
  const mySeq = ++seq
  error.value = ''
  const parsed = parseJavaModel(props.modelText)
  if (!parsed) {
    elements.value = []
    hasElements.value = false
    parent.value = ''
    error.value = t('resourcepack.modelPreview.parseFailed')
    return
  }
  parent.value = parsed.parent ?? ''
  parentShort.value = parsed.parent?.split('/').pop() ?? ''
  const els = Array.isArray(parsed.elements) ? parsed.elements : []
  elements.value = els
  hasElements.value = els.length > 0

  // 主贴图解析：引用 → 包内路径 → IPC data URL → 语义像素（按原图边长，UV 不重缩放）
  const ref = resolveMainTextureRef(parsed.textures)
  const packPath = ref ? textureRefToPackPath(ref) : null
  if (!packPath || !props.root) {
    if (mySeq !== seq) return
    texturePath.value = ''
    pixels.value = []
    textureSize.value = 16
    return
  }
  try {
    const dataUrl = await window.api.resourcepack.readTexture(props.root, packPath, props.mode)
    const native = await dataUrlImageSize(dataUrl)
    const size = Math.min(64, Math.max(16, native))
    const px = await dataUrlToSquarePixels(dataUrl, size)
    if (mySeq !== seq) return
    texturePath.value = packPath
    textureSize.value = size
    pixels.value = px
  } catch {
    if (mySeq !== seq) return
    texturePath.value = ''
    pixels.value = []
    textureSize.value = 16
  }
}
</script>

<style scoped>
.rmp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 300px;
  flex-shrink: 0;
  padding: 10px;
  border-left: 1px solid var(--ky-border);
  min-height: 0;
  overflow: auto;
}
.rmp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.rmp-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text-sub);
}
.rmp-parent {
  font-size: 10px;
  color: var(--ky-text-dim);
  font-family: var(--ky-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.rmp-msg {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  line-height: 1.5;
}
.rmp-tex {
  margin: 0;
  font-size: 10px;
  color: var(--ky-text-dim);
  font-family: var(--ky-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.8;
}
</style>
