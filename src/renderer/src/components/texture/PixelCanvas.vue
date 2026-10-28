<template>
  <div class="pixel-canvas">
    <div class="pc-tools">
      <el-button-group>
        <el-tooltip content="铅笔" placement="bottom">
          <el-button :type="api.tool.value === 'pencil' ? 'primary' : ''" size="small" @click="api.tool.value = 'pencil'">
            <el-icon><Edit /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="橡皮" placement="bottom">
          <el-button :type="api.tool.value === 'eraser' ? 'primary' : ''" size="small" @click="api.tool.value = 'eraser'">
            <el-icon><Delete /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="取色（点击画布吸取颜色）" placement="bottom">
          <el-button :type="api.tool.value === 'picker' ? 'primary' : ''" size="small" @click="api.tool.value = 'picker'">
            <el-icon><Aim /></el-icon>
          </el-button>
        </el-tooltip>
      </el-button-group>

      <el-color-picker v-model="api.color.value" size="small" />

      <el-button-group>
        <el-tooltip content="撤销（最多 30 步）" placement="bottom">
          <el-button size="small" :disabled="!api.canUndo.value" @click="api.undo()">
            <el-icon><RefreshLeft /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="重做" placement="bottom">
          <el-button size="small" :disabled="!api.canRedo.value" @click="api.redo()">
            <el-icon><RefreshRight /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="清空画布" placement="bottom">
          <el-button size="small" @click="api.clear()"><el-icon><CircleClose /></el-icon></el-button>
        </el-tooltip>
      </el-button-group>
    </div>

    <!-- 共享像素画布：棋盘格/像素/坐标由 TextureCanvas 渲染，逻辑仍在 usePixelCanvas -->
    <TextureCanvas
      :width="model.textureSize"
      :height="model.textureSize"
      :pixels="model.pixels"
      :zoom="zoom"
      :show-grid="false"
      :draft="null"
      :tool="api.tool.value"
      :color="api.color.value"
      @start="api.strokeStart"
      @move="api.strokeMove"
      @end="api.strokeEnd"
    >
      <!-- UV 选区高亮（u1,v1 左上原点，与画布同向） -->
      <template v-if="highlight" #overlay>
        <div class="pc-uv" :style="highlightStyle" />
      </template>
    </TextureCanvas>

    <p class="pc-hint">
      {{ model.textureSize }}×{{ model.textureSize }} · 按住拖动连续绘制 · 停笔自动写入项目贴图
      <template v-if="highlightLabel"> · 高亮：{{ highlightLabel }}</template>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue'
import {
  Aim,
  CircleClose,
  Delete,
  Edit,
  RefreshLeft,
  RefreshRight
} from '@element-plus/icons-vue'
import type { FaceUv } from '../../../../shared/types/content'
import { usePixelCanvas } from './usePixelCanvas'
import TextureCanvas from './TextureCanvas.vue'

const props = defineProps<{
  model: import('./usePixelCanvas').PixelCanvasModel
  /** 需要高亮的面 UV（来自 UV 面板"预览"） */
  highlight?: FaceUv | null
  highlightLabel?: string
}>()

const emit = defineEmits<{
  /** 一笔结束（ModelForm 防抖落盘 PNG） */
  painted: []
}>()

const modelRef = toRef(props, 'model')
const api = usePixelCanvas(modelRef, { onStrokeEnd: () => emit('painted') })

/** 画布显示尺寸（CSS 像素）固定 256：16 格×16px、32 格×8px */
const DISPLAY = 256
const zoom = computed(() => DISPLAY / props.model.textureSize)

const highlightStyle = computed(() => {
  const uv = props.highlight
  if (!uv) return {}
  const s = props.model.textureSize
  return {
    left: `${(uv[0] / s) * 100}%`,
    top: `${(uv[1] / s) * 100}%`,
    width: `${((uv[2] - uv[0]) / s) * 100}%`,
    height: `${((uv[3] - uv[1]) / s) * 100}%`
  }
})
</script>

<style scoped>
.pixel-canvas {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}
.pc-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}
.pc-uv {
  position: absolute;
  border: 1.5px solid #f9e2af;
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}
.pc-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  text-align: center;
  line-height: 1.5;
}
</style>
