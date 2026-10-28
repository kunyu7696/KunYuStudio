<template>
  <div v-if="targetNode" class="muv">
    <p class="mw-col-title mw-col-gap">UV</p>

    <!-- 面切换：cube 六面；mesh 逐面 -->
    <div v-if="cube" class="muv-faces">
      <button
        v-for="f in FACE_NAMES"
        :key="f"
        class="muv-face-btn"
        :class="{ 'is-active': f === curFace, 'is-off': !cube.faces[f] }"
        @click="curFace = f"
      >
        {{ faceText(f) }}
      </button>
    </div>
    <div v-else-if="mesh" class="muv-faces">
      <button
        v-for="i in mesh.faces.length"
        :key="i - 1"
        class="muv-face-btn"
        :class="{ 'is-active': i - 1 === curMeshFace }"
        @click="curMeshFace = i - 1"
      >
        {{ i }}
      </button>
    </div>

    <!-- 叠加画布：当前面贴图 + 同贴图全部面 -->
    <canvas
      v-if="view"
      ref="canvasRef"
      class="muv-canvas"
      :width="view.w"
      :height="view.h"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    ></canvas>
    <p v-else class="muv-hint">{{ t('modeler.uv.noTextureHint') }}</p>

    <!-- 面开关（仅 cube）+ 贴图绑定 -->
    <div class="muv-row">
      <el-checkbox v-if="cube" v-model="faceEnabledModel" size="small">{{ t('modeler.uv.enableFace') }}</el-checkbox>
      <el-select v-model="textureModel" size="small" class="muv-tex-select" :placeholder="t('modeler.uv.noTexture')">
        <el-option :label="t('modeler.uv.noTextureOption')" value="" />
        <el-option v-for="tex in textureList" :key="tex.id" :label="tex.name" :value="tex.id" />
      </el-select>
    </div>

    <!-- 旋转 + 自动 UV（仅 cube） -->
    <div v-if="cube" class="muv-row">
      <span class="muv-label">{{ t('modeler.uv.rotation') }}</span>
      <el-select v-model="rotationModel" size="small" class="muv-rot-select" :disabled="!faceEnabled">
        <el-option v-for="r in [0, 90, 180, 270]" :key="r" :label="`${r}°`" :value="r" />
      </el-select>
      <el-button v-if="!boxActive" size="small" :disabled="!faceEnabled" @click="onAutoUv">{{ t('modeler.uv.autoUv') }}</el-button>
    </div>

    <!-- box-uv 生效：整体偏移（仅 cube） -->
    <template v-if="cube && boxActive">
      <span class="muv-label">{{ t('modeler.uv.boxUvOffset') }}</span>
      <div class="muv-vec">
        <el-input-number
          v-for="(axis, i) in ['U', 'V'] as const"
          :key="axis"
          size="small"
          :controls="false"
          :model-value="cube.boxUv?.uvOffset[i] ?? 0"
          @change="(v: number | undefined) => commitBoxOffsetInput(i as 0 | 1, v)"
        />
      </div>
      <p class="muv-hint">{{ t('modeler.uv.boxUvHint') }}</p>
    </template>

    <!-- UV 数值：cube per-face rect；mesh 面 UV 装入矩形 -->
    <template v-else>
      <span class="muv-label">u1 · v1 · u2 · v2</span>
      <div class="muv-vec">
        <el-input-number
          v-for="i in [0, 1, 2, 3] as const"
          :key="i"
          size="small"
          :controls="false"
          :disabled="!(cube ? faceEnabled : !!mesh)"
          :model-value="curRect?.[i] ?? 0"
          @change="(v: number | undefined) => commitUvInput(i, v)"
        />
      </div>
      <p v-if="mesh" class="muv-hint">{{ t('modeler.uv.meshHint') }}</p>
      <p v-else class="muv-hint">{{ t('modeler.uv.rectHint') }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * ModelerUvEditor：UV 编辑器面板（建模器通用化重建 P2-d，方案 §4.6；v3 C3b 接 mesh）。
 *
 * - 选中单个立方体或 mesh 节点时显示；画布叠加显示当前面贴图与「同贴图」全部面
 *   （当前面高亮，点其它面切换当前面）；
 * - cube per-face：矩形内拖拽移动、左上/右下角手柄缩放（整像素吸附、clamp 到
 *   贴图内、尺寸 ≥1）、90° 旋转、自动 UV（按面投影尺寸）、u1..v2 数值输入；
 *   box-uv 生效（uvMode=box 且带 boxUv）：矩形由 boxUvFaces 推导，拖拽整体移动；
 * - mesh（v3 C3b）：逐顶点 UV 体系——拖面整体平移、拖顶点手柄改单顶点 UV、数值
 *   u1..v2 把该面 UV 按包围盒装入矩形（二分体系经 uv.ts 桥接函数打通）；
 * - 面贴图绑定/解绑两体系共有；cube 额外有面启用/剔除与旋转；
 * - 所有落定经 store.execute + patchNode 走命令栈（一次拖拽 = 一条命令），
 *   拖拽过程只改本地 draft 预览。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useModelerStore } from '../../stores/modeler'
import { patchNode } from '../../../../shared/modeler/document'
import {
  autoFaceUv,
  boxUvFaces,
  boxUvRegionSize,
  cubeSize,
  effectiveFaceBindings,
  fitMeshFaceUvIntoRect,
  meshFaceUvBounds,
  normalizeUvRect,
  setMeshFaceUvVertex,
  translateMeshFaceUv
} from '../../../../shared/modeler/uv'
import type { UvRect } from '../../../../shared/modeler/uv'
import { FACE_NAMES, isCubeNode, isMeshNode } from '../../../../shared/modeler/types'
import type { FaceName, MeshNode, TextureId, Vec2, Vec3 } from '../../../../shared/modeler/types'
import { t } from '../../i18n'

const store = useModelerStore()

function faceText(face: FaceName): string {
  return t(`modeler.face.${face}`)
}

/** 当前编辑对象（cube 或 mesh，仅单选时） */
const targetNode = computed(() => {
  if (store.selection.length !== 1) return null
  const n = store.doc?.nodes[store.selection[0]!]
  return n && (isCubeNode(n) || isMeshNode(n)) ? n : null
})

const cube = computed(() => {
  const n = targetNode.value
  return n && isCubeNode(n) ? n : null
})

const mesh = computed<MeshNode | null>(() => {
  const n = targetNode.value
  return n && isMeshNode(n) ? n : null
})

const curFace = ref<FaceName>('north')
const curMeshFace = ref(0)

const size = computed<Vec3>(() => (cube.value ? cubeSize(cube.value) : [0, 0, 0]))

const resolved = computed(() =>
  cube.value && store.doc ? effectiveFaceBindings(cube.value, store.doc.settings.uvMode) : {}
)

/** box-uv 生效（文档 box 模式且节点带 boxUv） */
const boxActive = computed(() => !!store.doc && store.doc.settings.uvMode === 'box' && !!cube.value?.boxUv)

const curBinding = computed(() => cube.value?.faces[curFace.value])
const faceEnabled = computed(() => !!curBinding.value)

/** 当前面绑定贴图（cube 取有效绑定；mesh 取 face.texture） */
const curTexId = computed<TextureId | null>(() => {
  if (mesh.value) return mesh.value.faces[curMeshFace.value]?.texture ?? null
  return resolved.value[curFace.value]?.texture ?? null
})
const curTex = computed(() => (curTexId.value ? (store.doc?.textures[curTexId.value] ?? null) : null))

const textureList = computed(() => {
  const d = store.doc
  if (!d) return []
  return Object.values(d.textures).map((t) => ({ id: t.id, name: t.name }))
})

/* ------------------------------------------------------------------ */
/* 画布与绘制                                                           */
/* ------------------------------------------------------------------ */

const canvasRef = ref<HTMLCanvasElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

/** 贴图图像缓存（data 变化时异步重载，加载完成触发重绘） */
watch(
  () => curTex.value?.data,
  (data) => {
    if (!data) {
      imgRef.value = null
      return
    }
    const img = new Image()
    img.onload = () => {
      imgRef.value = img
    }
    img.src = data
  },
  { immediate: true }
)

const CANVAS_MAX = 204

/** 画布适配：按贴图宽高比缩放到 204 内 */
const view = computed(() => {
  const tex = curTex.value
  if (!tex) return null
  const scale = Math.min(CANVAS_MAX / tex.width, CANVAS_MAX / tex.height)
  return {
    tex,
    scale,
    w: Math.max(1, Math.round(tex.width * scale)),
    h: Math.max(1, Math.round(tex.height * scale))
  }
})

/** 拖拽中的预览态（提交前不写文档） */
const draftUv = ref<UvRect | null>(null)
const draftOffset = ref<Vec2 | null>(null)
/** mesh：当前面拖拽中的逐顶点 UV 预览 */
const draftFaceUv = ref<Vec2[] | null>(null)

/** box 模式当前生效的六面矩形（含拖拽预览偏移） */
const boxMapNow = computed(() => {
  if (!boxActive.value || !cube.value?.boxUv) return null
  return boxUvFaces(size.value, draftOffset.value ?? cube.value.boxUv.uvOffset)
})

/** cube 某面当前生效矩形（box 取十字展开；per-face 取 faces，当前面优先草稿） */
function rectOf(face: FaceName): UvRect | null {
  if (boxMapNow.value) return boxMapNow.value[face] ?? null
  const b = cube.value?.faces[face]
  if (!b?.uv) return null
  if (face === curFace.value && draftUv.value) return draftUv.value
  return b.uv
}

/** mesh 某面当前生效逐顶点 UV（当前面优先草稿） */
function meshFaceUvAt(fi: number): Vec2[] | null {
  const m = mesh.value
  if (!m) return null
  if (fi === curMeshFace.value && draftFaceUv.value) return draftFaceUv.value
  return m.faces[fi]?.uv ?? null
}

/** 当前面矩形（cube 取 rect；mesh 取面 UV 包围盒）——数值输入显示用 */
const curRect = computed<UvRect | null>(() => {
  if (mesh.value) {
    const uvs = meshFaceUvAt(curMeshFace.value)
    return uvs ? meshFaceUvBounds({ vertices: [], uv: uvs }) : null
  }
  return rectOf(curFace.value)
})

function draw(): void {
  const canvas = canvasRef.value
  const v = view.value
  if (!canvas || !v) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 透明棋盘底
  const cell = 6
  for (let y = 0; y < canvas.height; y += cell) {
    for (let x = 0; x < canvas.width; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) | 0) % 2 === 0 ? '#3a3f4b' : '#2f333d'
      ctx.fillRect(x, y, cell, cell)
    }
  }
  // 贴图（像素风放大）
  if (imgRef.value) {
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(imgRef.value, 0, 0, v.w, v.h)
  }

  if (mesh.value) drawMeshOverlay(ctx, v.scale)
  else drawCubeOverlay(ctx, v.scale)
}

/** cube 叠加：同贴图面矩形 + 当前面角手柄 */
function drawCubeOverlay(ctx: CanvasRenderingContext2D, scale: number): void {
  for (const face of FACE_NAMES) {
    if ((resolved.value[face]?.texture ?? null) !== curTexId.value) continue
    const r = rectOf(face)
    if (!r) continue
    const active = face === curFace.value
    const x = r[0] * scale
    const y = r[1] * scale
    const w = Math.max(1, (r[2] - r[0]) * scale)
    const h = Math.max(1, (r[3] - r[1]) * scale)
    ctx.strokeStyle = active ? '#89b4fa' : 'rgba(255,255,255,0.55)'
    ctx.lineWidth = active ? 2 : 1
    ctx.strokeRect(x, y, w, h)
    ctx.fillStyle = active ? '#89b4fa' : 'rgba(255,255,255,0.65)'
    ctx.font = '9px sans-serif'
    ctx.fillText(faceText(face), x + 3, y + 10)
  }
  if (!boxActive.value && faceEnabled.value) {
    const r = rectOf(curFace.value)
    if (r) {
      ctx.fillStyle = '#89b4fa'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      for (const [cx, cy] of [
        [r[0] * scale, r[1] * scale],
        [r[2] * scale, r[3] * scale]
      ] as const) {
        ctx.fillRect(cx - 3, cy - 3, 6, 6)
        ctx.strokeRect(cx - 3, cy - 3, 6, 6)
      }
    }
  }
}

/** mesh 叠加：同贴图面多边形 + 当前面顶点手柄 */
function drawMeshOverlay(ctx: CanvasRenderingContext2D, scale: number): void {
  const m = mesh.value
  if (!m) return
  m.faces.forEach((face, fi) => {
    const tex = face.texture ?? null
    if (tex !== curTexId.value) return
    const uvs = meshFaceUvAt(fi)
    if (!uvs || uvs.length === 0) return
    const active = fi === curMeshFace.value
    ctx.beginPath()
    uvs.forEach(([u, vv], i) => {
      const x = u * scale
      const y = vv * scale
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.strokeStyle = active ? '#89b4fa' : 'rgba(255,255,255,0.55)'
    ctx.lineWidth = active ? 2 : 1
    ctx.stroke()
    ctx.fillStyle = active ? 'rgba(137,180,250,0.12)' : 'rgba(255,255,255,0.05)'
    ctx.fill()
    const first = uvs[0]!
    ctx.fillStyle = active ? '#89b4fa' : 'rgba(255,255,255,0.65)'
    ctx.font = '9px sans-serif'
    ctx.fillText(`${fi + 1}`, first[0] * scale + 3, first[1] * scale + 10)
    // 当前面顶点手柄
    if (active) {
      ctx.fillStyle = '#89b4fa'
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      for (const [u, vv] of uvs) {
        const x = u * scale
        const y = vv * scale
        ctx.fillRect(x - 3, y - 3, 6, 6)
        ctx.strokeRect(x - 3, y - 3, 6, 6)
      }
    }
  })
}

// 文档引用 / 当前面 / 草稿 / 图像 / 视图变化 → 重绘（canvas 由 v-if 重建时等 nextTick）
watch(
  [() => store.doc, curFace, curMeshFace, draftUv, draftOffset, draftFaceUv, imgRef, view],
  () => void nextTick(draw),
  { flush: 'post' }
)

/* ------------------------------------------------------------------ */
/* 指针交互                                                             */
/* ------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 屏幕坐标 → 贴图像素坐标（未取整，调用方按模式吸附） */
function toPixel(e: PointerEvent): Vec2 {
  const canvas = canvasRef.value!
  const v = view.value!
  const rect = canvas.getBoundingClientRect()
  return [(e.clientX - rect.left) / v.scale, (e.clientY - rect.top) / v.scale]
}

type HitKind = 'tl' | 'br' | 'move' | 'mesh-move' | 'mesh-vertex' | 'switch'
interface Hit {
  kind: HitKind
  face: FaceName | null
  /** mesh：面下标 / 顶点槽位 */
  meshFace?: number
  meshSlot?: number
}

/** 点是否在多边形内（射线法） */
function pointInPoly(px: number, py: number, pts: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!
    const [xj, yj] = pts[j]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function hitTest(px: number, py: number): Hit | null {
  const v = view.value
  if (!v) return null
  const tol = 5 / v.scale // 屏幕 5px 命中容差（像素单位）

  if (mesh.value) {
    const m = mesh.value
    const curUvs = meshFaceUvAt(curMeshFace.value)
    // 当前面顶点手柄优先
    if (curUvs) {
      for (let slot = 0; slot < curUvs.length; slot++) {
        const [u, vv] = curUvs[slot]!
        if (Math.abs(px - u) <= tol && Math.abs(py - vv) <= tol) {
          return { kind: 'mesh-vertex', face: null, meshFace: curMeshFace.value, meshSlot: slot }
        }
      }
      if (pointInPoly(px, py, curUvs)) {
        return { kind: 'mesh-move', face: null, meshFace: curMeshFace.value }
      }
    }
    // 其它同贴图面：切换当前面
    for (let fi = 0; fi < m.faces.length; fi++) {
      if (fi === curMeshFace.value) continue
      if ((m.faces[fi]?.texture ?? null) !== curTexId.value) continue
      const uvs = meshFaceUvAt(fi)
      if (uvs && uvs.length > 0 && pointInPoly(px, py, uvs)) {
        return { kind: 'switch', face: null, meshFace: fi }
      }
    }
    return null
  }

  // cube：角手柄优先（仅 per-face + 当前面已启用）
  if (!boxActive.value && faceEnabled.value) {
    const r = rectOf(curFace.value)
    if (r) {
      if (Math.abs(px - r[0]) <= tol && Math.abs(py - r[1]) <= tol) return { kind: 'tl', face: curFace.value }
      if (Math.abs(px - r[2]) <= tol && Math.abs(py - r[3]) <= tol) return { kind: 'br', face: curFace.value }
    }
  }
  const cur = rectOf(curFace.value)
  if (cur && px >= cur[0] - tol && px <= cur[2] + tol && py >= cur[1] - tol && py <= cur[3] + tol) {
    return { kind: 'move', face: curFace.value }
  }
  for (const face of FACE_NAMES) {
    if (face === curFace.value) continue
    if ((resolved.value[face]?.texture ?? null) !== curTexId.value) continue
    const r = rectOf(face)
    if (!r) continue
    if (px >= r[0] && px <= r[2] && py >= r[1] && py <= r[3]) {
      return boxActive.value ? { kind: 'move', face } : { kind: 'switch', face }
    }
  }
  return null
}

interface DragState {
  kind: Exclude<HitKind, 'switch'>
  start: Vec2
  origUv: UvRect
  origOffset: Vec2
  /** mesh：拖拽起始的逐顶点 UV 副本 */
  origFaceUv: Vec2[]
  meshSlot: number
}

let drag: DragState | null = null

function onDown(e: PointerEvent): void {
  if (!view.value || !targetNode.value) return
  const [px, py] = toPixel(e)
  const hit = hitTest(px, py)
  if (!hit) return
  if (hit.kind === 'switch') {
    if (hit.meshFace !== undefined) curMeshFace.value = hit.meshFace
    else if (hit.face) curFace.value = hit.face
    return
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag = {
    kind: hit.kind,
    start: [px, py],
    origUv: (hit.kind === 'mesh-move' || hit.kind === 'mesh-vertex' ? [0, 0, 0, 0] : rectOf(hit.face ?? curFace.value) ?? [0, 0, 0, 0]) as UvRect,
    origOffset: cube.value?.boxUv ? ([...cube.value.boxUv.uvOffset] as Vec2) : [0, 0],
    origFaceUv: (meshFaceUvAt(hit.meshFace ?? curMeshFace.value) ?? []).map((c) => [...c] as Vec2),
    meshSlot: hit.meshSlot ?? -1
  }
}

function onMove(e: PointerEvent): void {
  if (!drag || !view.value) return
  const v = view.value
  const [px, py] = toPixel(e)
  const dx = px - drag.start[0]
  const dy = py - drag.start[1]

  if (mesh.value) {
    if (drag.kind === 'mesh-move') {
      draftFaceUv.value = translateMeshFaceUv(
        { vertices: [], uv: drag.origFaceUv },
        Math.round(dx),
        Math.round(dy)
      )
    } else if (drag.kind === 'mesh-vertex') {
      const u = clamp(Math.round(px), 0, v.tex.width)
      const vv = clamp(Math.round(py), 0, v.tex.height)
      draftFaceUv.value = setMeshFaceUvVertex({ vertices: [], uv: drag.origFaceUv }, drag.meshSlot, [u, vv])
    }
    return
  }

  if (boxActive.value) {
    const region = boxUvRegionSize(size.value)
    const maxX = Math.max(0, v.tex.width - region.width)
    const maxY = Math.max(0, v.tex.height - region.height)
    draftOffset.value = [
      clamp(Math.round(drag.origOffset[0] + dx), 0, maxX),
      clamp(Math.round(drag.origOffset[1] + dy), 0, maxY)
    ]
    return
  }

  const r = drag.origUv
  if (drag.kind === 'move') {
    const wpx = r[2] - r[0]
    const hpx = r[3] - r[1]
    const nx = clamp(Math.round(r[0] + dx), 0, Math.max(0, v.tex.width - wpx))
    const ny = clamp(Math.round(r[1] + dy), 0, Math.max(0, v.tex.height - hpx))
    draftUv.value = [nx, ny, nx + wpx, ny + hpx]
  } else if (drag.kind === 'tl') {
    draftUv.value = [
      clamp(Math.round(r[0] + dx), 0, r[2] - 1),
      clamp(Math.round(r[1] + dy), 0, r[3] - 1),
      r[2],
      r[3]
    ]
  } else {
    draftUv.value = [
      r[0],
      r[1],
      clamp(Math.round(r[2] + dx), r[0] + 1, v.tex.width),
      clamp(Math.round(r[3] + dy), r[1] + 1, v.tex.height)
    ]
  }
}

function onUp(): void {
  if (!drag) return
  const d = drag
  drag = null

  if (mesh.value) {
    const uvs = draftFaceUv.value
    draftFaceUv.value = null
    if (!uvs) return
    if (uvs.every((c, i) => c[0] === d.origFaceUv[i]?.[0] && c[1] === d.origFaceUv[i]?.[1])) return
    commitMeshFaceUv(uvs)
    return
  }

  if (boxActive.value) {
    const off = draftOffset.value
    draftOffset.value = null
    if (off && (off[0] !== d.origOffset[0] || off[1] !== d.origOffset[1])) commitBoxOffset(off)
    return
  }
  const uv = draftUv.value
  draftUv.value = null
  if (!uv) return
  const o = d.origUv
  if (uv[0] === o[0] && uv[1] === o[1] && uv[2] === o[2] && uv[3] === o[3]) return
  commitFaceUv(uv)
}

/* ------------------------------------------------------------------ */
/* 命令提交（全部走命令栈）                                              */
/* ------------------------------------------------------------------ */

function commitFaceUv(uv: UvRect): void {
  const c = cube.value
  if (!c) return
  store.execute(t('modeler.uv.cmdEditUv'), (d) => {
    const node = d.nodes[c.id]
    if (!node || !isCubeNode(node)) return d
    const binding = node.faces[curFace.value] ?? {}
    return patchNode(d, c.id, { faces: { ...node.faces, [curFace.value]: { ...binding, uv } } })
  })
}

/** mesh 面逐顶点 UV 写回（仅改当前面，其它面保持原引用） */
function commitMeshFaceUv(uvs: Vec2[]): void {
  const m = mesh.value
  if (!m) return
  store.execute(t('modeler.uv.cmdEditMeshUv'), (d) => {
    const node = d.nodes[m.id]
    if (!node || !isMeshNode(node)) return d
    const fi = curMeshFace.value
    const faces = node.faces.map((f, i) => (i === fi ? { ...f, uv: uvs.map((c) => [...c] as Vec2) } : f))
    return patchNode(d, m.id, { faces })
  })
}

function commitBoxOffset(off: Vec2): void {
  const c = cube.value
  if (!c) return
  store.execute(t('modeler.uv.cmdEditBoxUvOffset'), (d) => patchNode(d, c.id, { boxUv: { uvOffset: off } }))
}

function commitUvInput(index: number, val: number | undefined): void {
  if (val === undefined) return
  const r = curRect.value
  if (!r) return
  if (mesh.value) {
    const next = [...r] as UvRect
    next[index] = Math.round(val)
    const face = mesh.value.faces[curMeshFace.value]
    if (!face) return
    commitMeshFaceUv(fitMeshFaceUvIntoRect(face, next))
    return
  }
  if (!faceEnabled.value) return
  const next = [...r] as UvRect
  next[index] = Math.round(val)
  commitFaceUv(normalizeUvRect(next))
}

function commitBoxOffsetInput(axis: 0 | 1, val: number | undefined): void {
  const c = cube.value
  if (!c?.boxUv || val === undefined) return
  const off = [...c.boxUv.uvOffset] as Vec2
  off[axis] = Math.round(val)
  commitBoxOffset(off)
}

/** 面启用/剔除（勾选创建默认绑定：自动 UV + 活动贴图） */
const faceEnabledModel = computed({
  get: () => faceEnabled.value,
  set: (on: boolean) => {
    const c = cube.value
    if (!c) return
    store.execute(on ? t('modeler.uv.cmdEnableFace') : t('modeler.uv.cmdCullFace'), (d) => {
      const node = d.nodes[c.id]
      if (!node || !isCubeNode(node)) return d
      const faces = { ...node.faces }
      if (on) {
        faces[curFace.value] = {
          uv: autoFaceUv(size.value, curFace.value),
          ...(store.activeTextureId ? { texture: store.activeTextureId } : {})
        }
      } else {
        delete faces[curFace.value]
      }
      return patchNode(d, c.id, { faces })
    })
  }
})

/** 面贴图绑定/解绑（cube 面未启用时选贴图 = 同时启用并自动 UV；mesh 直接改 face.texture） */
const textureModel = computed({
  get: () => (mesh.value ? (mesh.value.faces[curMeshFace.value]?.texture ?? '') : (curBinding.value?.texture ?? '')),
  set: (val: string) => {
    if (mesh.value) {
      const m = mesh.value
      store.execute(val ? t('modeler.uv.cmdBindTexture') : t('modeler.uv.cmdUnbindTexture'), (d) => {
        const node = d.nodes[m.id]
        if (!node || !isMeshNode(node)) return d
        const fi = curMeshFace.value
        const faces = node.faces.map((f, i) => {
          if (i !== fi) return f
          const next = { ...f, ...(val ? { texture: val } : {}) }
          if (!val) delete next.texture
          return next
        })
        return patchNode(d, m.id, { faces })
      })
      return
    }
    const c = cube.value
    if (!c) return
    store.execute(val ? t('modeler.uv.cmdBindTexture') : t('modeler.uv.cmdUnbindTexture'), (d) => {
      const node = d.nodes[c.id]
      if (!node || !isCubeNode(node)) return d
      const binding = node.faces[curFace.value]
      if (!binding) {
        if (!val) return d
        return patchNode(d, c.id, {
          faces: { ...node.faces, [curFace.value]: { uv: autoFaceUv(size.value, curFace.value), texture: val } }
        })
      }
      return patchNode(d, c.id, {
        faces: { ...node.faces, [curFace.value]: { ...binding, texture: val || undefined } }
      })
    })
  }
})

/** 面内旋转（0 归一为 undefined 保持文档干净） */
const rotationModel = computed({
  get: () => curBinding.value?.rotation ?? 0,
  set: (val: number) => {
    const c = cube.value
    if (!c || !faceEnabled.value) return
    store.execute(t('modeler.uv.cmdRotateUv'), (d) => {
      const node = d.nodes[c.id]
      if (!node || !isCubeNode(node)) return d
      const binding = node.faces[curFace.value]
      if (!binding) return d
      return patchNode(d, c.id, {
        faces: {
          ...node.faces,
          [curFace.value]: { ...binding, rotation: (val === 0 ? undefined : val) as 0 | 90 | 180 | 270 | undefined }
        }
      })
    })
  }
})

/** 自动 UV：按面投影尺寸从贴图原点取矩形 */
function onAutoUv(): void {
  if (!faceEnabled.value) return
  commitFaceUv(autoFaceUv(size.value, curFace.value))
}

// 切换编辑对象（尤其 mesh 面数变化）时收敛当前面下标
watch(
  () => mesh.value?.id,
  () => {
    curMeshFace.value = 0
    draftFaceUv.value = null
  }
)
watch(
  () => mesh.value?.faces.length,
  (n) => {
    if (n !== undefined && curMeshFace.value >= n) curMeshFace.value = Math.max(0, n - 1)
  }
)
</script>

<style scoped>
.muv {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.muv-faces {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.muv-face-btn {
  flex: 1 0 auto;
  min-width: 26px;
  padding: 2px 4px;
  font-size: 10.5px;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
}
.muv-face-btn:hover {
  border-color: var(--ky-accent);
}
.muv-face-btn.is-active {
  background: color-mix(in srgb, var(--ky-accent) 18%, transparent);
  color: var(--ky-accent);
  border-color: var(--ky-accent);
}
.muv-face-btn.is-off {
  opacity: 0.45;
}
.muv-canvas {
  align-self: center;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  cursor: crosshair;
  touch-action: none;
}
.muv-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.muv-label {
  font-size: 10.5px;
  color: var(--ky-text-dim);
  flex-shrink: 0;
}
.muv-tex-select {
  flex: 1;
  min-width: 0;
}
.muv-rot-select {
  width: 76px;
}
.muv-vec {
  display: flex;
  gap: 4px;
}
.muv-vec .el-input-number {
  width: 100%;
}
.muv-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  line-height: 1.5;
}
</style>
