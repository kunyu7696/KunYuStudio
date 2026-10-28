<template>
  <div class="mpv" :class="{ 'is-fill': fill }">
    <canvas ref="canvasRef" class="mpv-canvas"></canvas>
    <div v-if="failed" class="mpv-fallback">当前环境不支持 WebGL 3D 预览</div>
    <span class="mpv-hint">拖动旋转 · 滚轮缩放</span>
  </div>
</template>

<script setup lang="ts">
/**
 * ModelPreview：只读 3D 模型预览（建模器通用化重建 P0，方案 §4.1/§7.4）。
 *
 * 三种形态：
 * - elements：按 CubeElement[] 装配（逐面 UV/剔面/单轴旋转），供统一编辑器右栏与
 *   画廊 3D 预览；可选 selected 高亮单个元素（点选联动由外部持有状态）；
 * - cube：六面同贴图的立方体（方块默认 cube_all 形态，贴图弹窗用）；
 * - plane：双面贴片（物品/实体的平面形态，AI 重绘候选预览用）。
 *
 * 像素画改动经 CanvasTexture 热更新；无像素时用中性灰占位保证形体可辨。
 * 仅展示用（轨道旋转/缩放），不编辑几何；几何/UV 装配在 modelPreviewScene.ts（可单测）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  buildPreviewGroup,
  disposeCubeGroup,
  fitView,
  groupBounds
} from './modelPreviewScene'
import type { PreviewElement } from './documentToElements'

const props = withDefaults(
  defineProps<{
    /** 预览形态：elements=按元素装配 / cube=整块立方体 / plane=双面贴片 */
    shape?: 'elements' | 'cube' | 'plane'
    /** 元素列表（shape='elements' 时必填；cube 或 mesh 元素，v3 C4 起支持 mesh） */
    elements?: PreviewElement[]
    pixels: string[]
    /** 贴图画布边长（UV 换算用） */
    textureSize?: number
    /** 高亮元素下标（shape='elements'；null/undefined = 不高亮） */
    selected?: number | null
    /** 场景底色；缺省透明 */
    background?: string
    /** 视角重置信号：父组件递增此值触发回到默认取景 */
    resetSignal?: number
    /** 撑满父容器（右栏预览区填满剩余高度，避免大片空白） */
    fill?: boolean
  }>(),
  { shape: 'cube', textureSize: 16, selected: null, fill: false }
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const failed = ref(false)

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let modelRoot: THREE.Group | null = null
let highlight: THREE.LineSegments | null = null
let texture: THREE.CanvasTexture | null = null
let offCanvas: HTMLCanvasElement | null = null
let ctx2d: CanvasRenderingContext2D | null = null
let rafId = 0
let resizeObs: ResizeObserver | null = null
let needFit = true

const PLACEHOLDER = '#7a7f8a'
/** 默认观察方向（Blockbench 式等轴测感） */
const VIEW_DIR = new THREE.Vector3(1, 0.8, 1.4).normalize()

function drawTexture(): void {
  const size = props.textureSize
  if (!offCanvas || !ctx2d || !texture) return
  if (offCanvas.width !== size) {
    offCanvas.width = size
    offCanvas.height = size
  }
  ctx2d.clearRect(0, 0, size, size)
  let painted = 0
  for (let i = 0; i < props.pixels.length; i++) {
    const hex = props.pixels[i]
    if (!hex) continue
    painted++
    ctx2d.fillStyle = hex
    ctx2d.fillRect(i % size, Math.floor(i / size), 1, 1)
  }
  // 无任何像素：整面中性灰占位，保证形体可辨
  if (painted === 0) {
    ctx2d.fillStyle = PLACEHOLDER
    ctx2d.fillRect(0, 0, size, size)
  }
  texture.needsUpdate = true
}

function clearModel(): void {
  clearHighlight()
  if (modelRoot) {
    disposeCubeGroup(modelRoot)
    modelRoot = null
  }
}

function clearHighlight(): void {
  if (highlight) {
    highlight.parent?.remove(highlight)
    highlight.geometry.dispose()
    ;(highlight.material as THREE.Material).dispose()
    highlight = null
  }
}

function applyHighlight(): void {
  clearHighlight()
  if (!modelRoot || props.selected === null || props.selected === undefined) return
  const mesh = modelRoot.children.find(
    (c) => c.userData.elementIndex === props.selected
  )?.children[0]
  if (!(mesh instanceof THREE.Mesh)) return
  const edges = new THREE.EdgesGeometry(mesh.geometry)
  const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x89b4fa }))
  // 高亮挂在 mesh 本地（继承 pivot 变换与自身 scale）
  mesh.add(lines)
  lines.scale.set(
    1 / Math.max(mesh.scale.x, 1e-6),
    1 / Math.max(mesh.scale.y, 1e-6),
    1 / Math.max(mesh.scale.z, 1e-6)
  )
  highlight = lines
}

function rebuildModel(): void {
  if (!scene) return
  clearModel()
  if (props.shape === 'elements' && props.elements) {
    modelRoot = buildPreviewGroup(props.elements, texture, props.textureSize)
    scene.add(modelRoot)
    applyHighlight()
  } else {
    const geometry =
      props.shape === 'cube' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshLambertMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.02,
      side: props.shape === 'cube' ? THREE.FrontSide : THREE.DoubleSide
    })
    const root = new THREE.Group()
    root.name = 'model-preview-root'
    root.add(new THREE.Mesh(geometry, material))
    modelRoot = root
    scene.add(root)
  }
  needFit = true
}

/** 把内容包围盒取景入视（仅内容变化/视角重置时执行一次） */
function fitCamera(): void {
  if (!camera || !controls || !modelRoot) return
  const box = groupBounds(modelRoot) ?? new THREE.Box3(
    new THREE.Vector3(-0.5, -0.5, -0.5),
    new THREE.Vector3(0.5, 0.5, 0.5)
  )
  const { target, distance } = fitView(box, camera.fov)
  controls.target.copy(target)
  camera.position.copy(target).addScaledVector(VIEW_DIR, distance)
  controls.update()
}

function ensureFit(): void {
  if (!needFit) return
  needFit = false
  fitCamera()
}

function init(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  } catch {
    failed.value = true
    return
  }
  const w = canvas.clientWidth || 240
  const h = canvas.clientHeight || 240
  renderer.setSize(w, h, false)

  scene = new THREE.Scene()
  if (props.background) scene.background = new THREE.Color(props.background)
  camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 50)
  camera.position.set(1.5, 1.2, 2.1)

  scene.add(new THREE.AmbientLight(0xffffff, 0.9))
  const dir = new THREE.DirectionalLight(0xffffff, 0.6)
  dir.position.set(2, 3, 2.5)
  scene.add(dir)

  // 离屏 canvas → CanvasTexture
  offCanvas = document.createElement('canvas')
  offCanvas.width = props.textureSize
  offCanvas.height = props.textureSize
  ctx2d = offCanvas.getContext('2d')
  texture = new THREE.CanvasTexture(offCanvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.2
  controls.enablePan = false
  controls.minDistance = 0.3
  controls.maxDistance = 12

  drawTexture()
  rebuildModel()
  fitCamera()

  resizeObs = new ResizeObserver(() => {
    if (!renderer || !camera) return
    const nw = canvas.clientWidth
    const nh = canvas.clientHeight
    if (nw === 0 || nh === 0) return
    renderer.setSize(nw, nh, false)
    camera.aspect = nw / nh
    camera.updateProjectionMatrix()
  })
  resizeObs.observe(canvas)

  const loop = (): void => {
    rafId = requestAnimationFrame(loop)
    controls?.update()
    ensureFit()
    if (renderer && scene && camera) renderer.render(scene, camera)
  }
  loop()
}

onMounted(init)

// 像素变化热更新（不重建几何）
watch(
  () => props.pixels,
  () => drawTexture(),
  { deep: true }
)

// 几何/形态变化重建（含取景）
watch(
  () => [props.shape, props.elements, props.textureSize] as const,
  () => {
    drawTexture()
    rebuildModel()
  },
  { deep: true }
)

// 点选联动高亮（不重建几何）
watch(
  () => props.selected,
  () => applyHighlight()
)

// 父组件视角重置信号
watch(
  () => props.resetSignal,
  () => {
    needFit = true
  }
)

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  resizeObs?.disconnect()
  controls?.dispose()
  clearModel()
  texture?.dispose()
  renderer?.dispose()
})
</script>

<style scoped>
.mpv {
  position: relative;
  width: 240px;
  height: 240px;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
/* 撑满父容器：宽高由布局决定；去掉边框与底色，避免变成一块突兀的大方框 */
.mpv.is-fill {
  width: 100%;
  height: 100%;
  min-height: 0;
  border: none;
  border-radius: 0;
  background: transparent;
}
.mpv-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.mpv-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  color: var(--ky-text-sub);
}
.mpv-hint {
  position: absolute;
  left: 8px;
  bottom: 6px;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  pointer-events: none;
}
</style>
