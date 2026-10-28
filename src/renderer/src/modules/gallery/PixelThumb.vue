<!--
  像素缩略图：把 size*size 项语义像素直接画到 canvas。
  内部分辨率 = 像素边长（16/32），CSS 放大后靠 image-rendering: pixelated 保持硬边像素风。
  不用 <img src="file://..."> —— 渲染层 CSP 的 img-src 不含 file:，且像素本身就在画廊 JSON 里，最可靠。
-->
<template>
  <canvas ref="canvasRef" class="pixel-thumb" />
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{
  /** size*size 项语义像素（"" = 透明） */
  pixels: string[]
  size: 16 | 32
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const s = props.size
  if (canvas.width !== s) {
    canvas.width = s
    canvas.height = s
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, s, s)
  for (let i = 0; i < props.pixels.length; i++) {
    const hex = props.pixels[i]
    if (!hex) continue
    ctx.fillStyle = hex
    ctx.fillRect(i % s, Math.floor(i / s), 1, 1)
  }
}

onMounted(draw)
watch(() => [props.pixels, props.size], draw, { deep: true })
</script>

<style scoped>
.pixel-thumb {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}
</style>
