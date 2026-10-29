<template>
  <div class="mvw">
    <!-- 工具条 -->
    <div class="mvw-toolbar">
      <el-radio-group v-model="tool" size="small">
        <el-radio-button value="translate" title="移动（W）">移动</el-radio-button>
        <el-radio-button value="rotate" title="旋转（E）">旋转</el-radio-button>
        <el-radio-button value="scale" title="缩放（R）">缩放</el-radio-button>
        <el-radio-button value="paint" title="绘画（B）" :disabled="store.editMode !== 'object'">绘画</el-radio-button>
        <el-radio-button
          value="weight"
          title="权重绘制（K）：把组（骨骼）影响涂到网格顶点上，供 glTF 蒙皮导出"
          :disabled="!meshEditAvailable"
        >
          权重
        </el-radio-button>
      </el-radio-group>
      <!-- 网格子对象编辑模式（B4-3）：单选 mesh 时可切换对象/顶点/面 -->
      <el-radio-group
        v-if="meshEditAvailable && tool !== 'paint'"
        :model-value="store.editMode"
        size="small"
        class="mvw-editmode"
        @change="onEditModeChange"
      >
        <el-radio-button value="object" title="对象模式（1）">对象</el-radio-button>
        <el-radio-button value="vertex" title="顶点模式（2）：点击选顶点（Shift 加选），gizmo 拖拽平移">顶点</el-radio-button>
        <el-radio-button value="face" title="面模式（3）：点击选面（Shift 加选），Delete 删除">面</el-radio-button>
        <el-radio-button value="edge" title="边模式（4）：点击选边（Shift 加选），「环切」插入一圈边">边</el-radio-button>
        <el-radio-button value="knife" title="切刀（5）：点击面上两点确定切割平面，跨面切开（Esc 取消第一点）">切刀</el-radio-button>
      </el-radio-group>
      <el-button
        v-if="store.editMode === 'edge'"
        size="small"
        :disabled="store.edgeSelection.length === 0"
        title="对选中边求边环并插入一圈新边（仅四边面有效）"
        @click="store.loopCutSelectedEdges()"
      >
        环切
      </el-button>
      <el-checkbox v-if="tool !== 'paint'" v-model="snap" size="small" class="mvw-snap">吸附</el-checkbox>
      <!-- 变换空间（P3-d）：全局=世界轴；自身=节点自身轴；骨骼=父骨骼轴（旋转绕骨骼系） -->
      <el-radio-group v-if="tool !== 'paint'" v-model="space" size="small" class="mvw-space">
        <el-radio-button value="world" title="世界坐标轴">全局</el-radio-button>
        <el-radio-button value="local" title="节点自身坐标轴">自身</el-radio-button>
        <el-radio-button value="bone" title="父骨骼坐标轴（骨骼绕枢轴旋转）">骨骼</el-radio-button>
      </el-radio-group>
      <el-button v-if="tool !== 'paint'" size="small" @click="resetView">视角重置</el-button>

      <!-- 绘画参数（仅绘画模式） -->
      <template v-if="tool === 'paint'">
        <el-radio-group v-model="paintTool" size="small">
          <el-radio-button value="brush">画笔</el-radio-button>
          <el-radio-button value="eraser">橡皮</el-radio-button>
          <el-radio-button value="bucket">油漆桶</el-radio-button>
        </el-radio-group>
        <el-color-picker v-if="paintTool !== 'eraser'" v-model="paintColor" size="small" :show-alpha="false" />
        <div v-if="paintTool !== 'eraser'" class="mvw-palette">
          <button
            v-for="c in BASE_PALETTE"
            :key="c"
            class="mvw-swatch"
            :style="{ background: c }"
            :title="c"
            @click="paintColor = c"
          ></button>
        </div>
        <div v-if="paintTool !== 'eraser' && recentColors.length > 0" class="mvw-palette mvw-palette-recent" title="最近使用">
          <button
            v-for="c in recentColors"
            :key="c"
            class="mvw-swatch"
            :style="{ background: c }"
            :title="c"
            @click="paintColor = c"
          ></button>
        </div>
        <template v-if="paintTool === 'brush' || paintTool === 'eraser'">
          <span class="mvw-toolbar-label">笔刷</span>
          <el-input-number v-model="brushSize" size="small" :min="1" :max="8" :controls="false" class="mvw-brush" />
        </template>
        <span class="mvw-toolbar-label">不透明度</span>
        <el-slider v-model="paintOpacity" size="small" :min="5" :max="100" class="mvw-opacity" />
        <el-checkbox v-model="mirrorX" size="small" title="沿贴图 X 轴镜像落笔">镜像X</el-checkbox>
        <el-checkbox v-model="mirrorY" size="small" title="沿贴图 Y 轴镜像落笔">镜像Y</el-checkbox>
        <el-checkbox v-model="lockAlpha" size="small" title="只画已有像素，透明区域不可落笔">锁α</el-checkbox>
        <el-checkbox v-model="paintGrid" size="small" title="悬停面显示像素网格">网格</el-checkbox>
        <span class="mvw-toolbar-label">Alt 拾色 · Shift 直线</span>
      </template>

      <!-- 权重绘制参数（仅权重模式，v3 C3a） -->
      <template v-if="tool === 'weight'">
        <span class="mvw-toolbar-label">目标组</span>
        <el-select
          :model-value="store.weightTarget ?? ''"
          size="small"
          class="mvw-weight-group"
          placeholder="选择骨骼组"
          @change="(v: string) => store.setWeightTarget(v || null)"
        >
          <el-option label="（未选）" value="" />
          <el-option v-for="g in weightGroupList" :key="g.id" :label="g.name" :value="g.id" />
        </el-select>
        <el-radio-group v-model="weightMode" size="small">
          <el-radio-button value="add" title="累加目标组权重（逐顶点归一化）">累加</el-radio-button>
          <el-radio-button value="replace" title="覆写目标组权重，其余组按剩余比例缩放">替换</el-radio-button>
          <el-radio-button value="subtract" title="削减目标组权重">削减</el-radio-button>
        </el-radio-group>
        <span class="mvw-toolbar-label">半径</span>
        <el-input-number v-model="weightRadius" size="small" :min="0.5" :max="16" :step="0.5" :controls="false" class="mvw-brush" />
        <span class="mvw-toolbar-label">强度</span>
        <el-slider v-model="weightStrength" size="small" :min="1" :max="100" class="mvw-opacity" />
        <el-checkbox v-model="showWeights" size="small" title="顶点按权重热力着色（蓝 0 → 红 1）">显示</el-checkbox>
        <el-button size="small" :disabled="!editingMesh?.weights" @click="store.clearMeshWeights()">清除权重</el-button>
        <span class="mvw-toolbar-label">拖动涂权重 · 目标组必选</span>
      </template>

      <span class="mvw-status">{{ statusText }}</span>
      <el-button size="small" title="导出当前视口截图（PNG）" @click="onExportScreenshot">截图</el-button>
    </div>

    <!-- 视口 -->
    <div class="mvw-stage">
      <canvas ref="canvasRef" class="mvw-canvas" :class="{ 'is-paint': tool === 'paint' }"></canvas>
      <div v-if="failed" class="mvw-fallback">当前环境不支持 WebGL 3D 视口</div>
      <div v-if="readout" class="mvw-readout">{{ readout }}</div>
      <div v-if="marquee" class="mvw-marquee" :style="marqueeStyle"></div>
      <span class="mvw-hint">
        左键旋转 · 右键平移 · 滚轮缩放 · 点击选中 · Shift/Ctrl+拖框选 · 双击选子树 · Ctrl+A 全选 · W/E/R/B 切换工具 · 网格 1/2/3 对象/顶点/面
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ModelerViewport：模型工坊可编辑 3D 视口（建模器通用化重建 P1，方案 §4.4/§4.8）。
 *
 * - 场景同步：文档引用变化 → 全量重建（P1 文档规模小；拖拽/绘画期间不写文档，
 *   增量场景桥留待后续阶段替换内部实现）；
 * - 层级语义（父链连续空间，见 shared/modeler/transform.ts 头注释）：
 *   组 = outer(pos=origin/16, rot, scale) > inner(pos=−origin/16) > 子节点(原始坐标/16)；
 *   cube = outer(pos=origin/16, rot) > mesh(单位盒 scale=尺寸/16, pos=(center−origin)/16)；
 * - 贴图渲染：cube 任一面绑定贴图 → per-cube 克隆 BoxGeometry 写 UV attribute
 *   （面序 [+x,-x,+y,-y,+z,-z] = east/west/up/down/south/north；rotateUvCorners 返回
 *   [TL,TR,BR,BL] 像素坐标 → 面内顶点序 [TL,TR,BL,BR] 用 0,1,3,2 重排），材质按贴图
 *   缓存共享（NearestFilter 像素风）；未绑定贴图的 cube 保持灰盒；
 * - 绘画模式：capture 阶段拦截左键（屏蔽轨道旋转），射线命中面 → materialIndex 推面名
 *   → 绑定贴图 canvas 直接落笔（源覆盖合成 = globalAlpha fillRect），Bresenham 连续笔画、
 *   Shift 直线（快照重画）、Alt 拾色；笔画结束 canvas.toDataURL → applyPaintStroke
 *   （每笔画一条命令可撤销）；文档 data 与 loadedData 一致时跳过重载避免闪烁；
 *   子工具（P2-c）：画笔/橡皮（destination-out）/油漆桶（4-连通域 BFS 源覆盖填充），
 *   镜像X/Y（落点集镜像扩展）、锁 alpha（透明像素不落笔）、绘画网格（悬停面 texel
 *   边界 LineSegments，随 mesh 变换，笔画期间冻结）；
 * - 写入路径：拖拽结束一次性换算 → store.execute（translateNodes/patchNode 走命令栈）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { useModelerStore } from '../../stores/modeler'
import {
  documentAabb,
  rotateNodes,
  scaleNodes,
  translateNodes,
  worldPivotOf
} from '../../../../shared/modeler/transform'
import { ancestorRotationQuat, composeBoneLocalRotation } from '../../../../shared/modeler/quat'
import { effectiveSelection, patchNode, subtreeIds } from '../../../../shared/modeler/document'
import { isEffectivelyLocked } from '../../../../shared/modeler/query'
import { effectiveFaceBindings } from '../../../../shared/modeler/uv'
import {
  buildMeshEdges,
  meshEdgeKey,
  translateMeshVertices
} from '../../../../shared/modeler/mesh'
import { sampleAnimation } from '../../../../shared/modeler/anim'
import { animationPlayer } from './core/animationPlayer'
import type { DocumentPatch } from '../../../../shared/modeler/commands'
import type { MeshNode, ModelDocument, ModelNode, NodeId, TextureId, Vec2, Vec3 } from '../../../../shared/modeler/types'
import { isCubeNode, isGroupNode, isLocatorNode, isMeshNode } from '../../../../shared/modeler/types'
import { weightPreviewColor } from '../../../../shared/modeler/weights'
import { fitView } from './preview/modelPreviewScene'
import {
  computePaintGrid,
  createStrokeState,
  bucketFillAt as bucketFillCore,
  pickFaceAt as pickFaceCore,
  stampAt as stampCore,
  strokeLine as strokeLineCore,
  type FaceHit,
  type PaintCtx,
  type PaintParams,
  type StrokeState,
  type TexEntryLike
} from './viewport/paintTools'
import {
  previewWeight as previewWeightCore,
  stampWeights as stampWeightsCore,
  throttledWeightSample,
  type WeightCtx
} from './viewport/weightPaint'
import {
  disposeAllTextures,
  disposeTextureMats,
  pruneTextures as pruneTexturesCore,
  type TexCacheCtx,
  type TexEntry
} from './viewport/textureCache'
import {
  buildNodeObject as buildNodeObjectCore,
  type NodeBuildCtx
} from './viewport/nodeBuilder'
import {
  clearSubEditHandles,
  createSubEditVisuals,
  syncEdgeHandles as syncEdgeHandlesCore,
  syncFaceOverlay as syncFaceOverlayCore,
  syncKnifeMarker as syncKnifeMarkerCore,
  syncVertexHandles as syncVertexHandlesCore,
  syncWeightOverlay as syncWeightOverlayCore,
  type SubEditCtx,
  type SubEditVisuals
} from './viewport/subEditVisuals'
import {
  isChainVisible,
  nodesInMarquee,
  pickMeshFaceAt as pickMeshFaceAtCore,
  pickMeshModelPoint as pickMeshModelPointCore,
  pickMeshSurfaceAt as pickMeshSurfaceAtCore,
  pickNodeAt,
  pickVertexAt as pickVertexAtCore,
  type PickCtx
} from './viewport/picking'
import { applyDocPatch as applyDocPatchCore, type SceneBridgeCtx } from './viewport/sceneBridge'

type ToolMode = 'translate' | 'rotate' | 'scale' | 'paint' | 'weight'

const TOOL_LABELS: Record<ToolMode, string> = {
  translate: '移动',
  rotate: '旋转',
  scale: '缩放',
  paint: '绘画',
  weight: '权重'
}

/** 无修饰键工具热键（P5-polish / v3 C3a） */
const TOOL_HOTKEYS: Record<string, ToolMode> = {
  w: 'translate',
  e: 'rotate',
  r: 'scale',
  b: 'paint',
  k: 'weight'
}

/** 基础色板（16 色羊毛色系） */
const BASE_PALETTE = [
  '#e9ecec', '#f07613', '#bd44b3', '#29aade', '#f8af4e', '#bd44b3', '#5e7c16', '#706214',
  '#3ab3da', '#893325', '#1e4b99', '#35399d', '#46335b', '#7f3fb2', '#2d6f9e', '#444444'
]

const store = useModelerStore()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const failed = ref(false)
const tool = ref<ToolMode>('translate')
const snap = ref(false)
/** 变换空间（P3-d）：world=世界轴 / local=节点自身轴 / bone=父骨骼轴 */
type GizmoSpace = 'world' | 'local' | 'bone'
const space = ref<GizmoSpace>('world')
const readout = ref('')
const gizmoHint = ref('')
/** gizmo 实际生效的工具（多选强制平移 / locator 回退移动时与 tool 不同） */
const gizmoMode = ref<ToolMode>('translate')

/* ---- 绘画参数 ---- */
const paintColor = ref('#e9ecec')
const brushSize = ref(1)
const paintOpacity = ref(100)
/** 绘画子工具：画笔 / 橡皮（destination-out 擦除）/ 油漆桶（连通域填充） */
type PaintSubTool = 'brush' | 'eraser' | 'bucket'
const paintTool = ref<PaintSubTool>('brush')
/** 镜像绘画：贴图空间 X/Y 轴镜像落笔 */
const mirrorX = ref(false)
const mirrorY = ref(false)
/** 锁 alpha：透明像素不可落笔（只改已有像素颜色） */
const lockAlpha = ref(false)
/** 绘画网格：悬停面显示 texel 边界线 */
const paintGrid = ref(false)
/** 最近使用颜色（最新在前，去重 cap 8；P2-e 调色板完善） */
const recentColors = ref<string[]>([])

/* ---- 权重绘制参数（v3 C3a） ---- */
/** 落笔模式：累加 / 替换 / 削减（对齐 weights.ts paintVertexWeights 的 mode） */
const weightMode = ref<'add' | 'replace' | 'subtract'>('add')
/** 笔刷半径（模型空间单位，16 单位 = 1 方块；3D 距离衰减） */
const weightRadius = ref(4)
/** 笔刷强度（1–100 → 落笔量 0.01–1） */
const weightStrength = ref(60)
/** 顶点按权重热力着色（蓝 0 → 红 1） */
const showWeights = ref(true)

/** 当前编辑的 mesh 节点（单选 mesh；权重绘制目标） */
const editingMesh = computed<MeshNode | null>(() => {
  const id = store.meshEditTarget
  const n = id ? store.doc?.nodes[id] : undefined
  return n && isMeshNode(n) ? n : null
})

/** 可作为权重目标的组节点（名称 + id，按文档顺序） */
const weightGroupList = computed(() => {
  const d = store.doc
  if (!d) return [] as Array<{ id: NodeId; name: string }>
  return Object.values(d.nodes)
    .filter((n) => isGroupNode(n))
    .map((n) => ({ id: n.id, name: n.name }))
})

/** 记录最近使用颜色（取色器定色/落笔提交时调用） */
function noteRecentColor(c: string): void {
  recentColors.value = [c, ...recentColors.value.filter((x) => x !== c)].slice(0, 8)
}

const statusText = computed(() => {
  const n = store.selection.length
  if (n === 0) return '未选中'
  const parts = [`${n} 个选中`, `工具：${TOOL_LABELS[gizmoMode.value]}`]
  if (store.editMode === 'vertex') parts.push(`顶点模式：已选 ${store.vertexSelection.length}`)
  else if (store.editMode === 'face') parts.push(`面模式：已选 ${store.faceSelection.length}`)
  else if (store.editMode === 'edge') parts.push(`边模式：已选 ${store.edgeSelection.length}`)
  else if (store.editMode === 'knife') parts.push(`切刀：${store.knifeAnchor ? '已定第一点' : '待定第一点'}`)
  if (gizmoMode.value === 'weight') {
    const g = store.weightTarget ? (store.doc?.nodes[store.weightTarget]?.name ?? store.weightTarget) : '未选'
    parts.push(`权重：目标组 ${g}`)
  }
  if (gizmoHint.value) parts.push(gizmoHint.value)
  return parts.join(' · ')
})

/** 网格子对象编辑可用：单选 mesh 节点（B4-3） */
const meshEditAvailable = computed(() => store.meshEditTarget !== null)

function onEditModeChange(v: string | number | boolean | undefined): void {
  if (v === 'object' || v === 'vertex' || v === 'face' || v === 'edge' || v === 'knife') {
    store.setEditMode(v)
  }
}

/* ---- three 单例 ---- */
let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let orbit: OrbitControls | null = null
let tc: TransformControls | null = null
let boneProxy: THREE.Object3D | null = null // 骨骼空间 gizmo 代理（P3-d）
let modelRoot: THREE.Group | null = null
let multiProxy: THREE.Group | null = null
let rafId = 0
let resizeObs: ResizeObserver | null = null
let needFit = true
let fittedDocId = ''

/** 本轮重建创建的可释放资源（geometry/material），重建/卸载时统一 dispose */
let disposables: Array<THREE.BufferGeometry | THREE.Material> = []
let boxGeo: THREE.BoxGeometry | null = null
let edgeGeo: THREE.EdgesGeometry | null = null
let markerGeo: THREE.OctahedronGeometry | null = null
let cubeMat: THREE.MeshLambertMaterial | null = null
let markerMat: THREE.MeshBasicMaterial | null = null
let lineMat: THREE.LineBasicMaterial | null = null

/** nodeId → 节点场景对象（gizmo attach 目标） */
const nodeObjects = new Map<NodeId, THREE.Object3D>()
/** 可拾取 mesh（cube 主体 + locator 标记），userData.nodeId 标识 */
let pickMeshes: THREE.Mesh[] = []
/** 网格子对象编辑可视化槽位（B4-3/v3：顶点句柄 Points、选中面叠加、边句柄、切刀锚点；实现见 viewport/subEditVisuals） */
const subEdit: SubEditVisuals = createSubEditVisuals()
/** 选中高亮线框（挂在被选 cube mesh 上） */
let highlightLines: THREE.LineSegments[] = []

/* ---- 贴图缓存（跨重建复用；绘画直接在 canvas 上落笔；实现见 viewport/textureCache） ---- */
const texEntries = new Map<TextureId, TexEntry>()
/** 贴图 → 共享材质（同贴图多 cube 复用） */
const texMats = new Map<TextureId, THREE.MeshLambertMaterial>()
/** 贴图缓存上下文（文档/活动层实时快照） */
const texCacheCtx: TexCacheCtx = {
  entries: texEntries,
  mats: texMats,
  getDoc: () => store.doc,
  getActiveLayerId: () => store.activeLayerId
}

/** 参考图平面（B3-1）：refId → { mesh, tex } */
const refPlanes = new Map<string, { mesh: THREE.Mesh; tex: THREE.Texture }>()

const VIEW_DIR = new THREE.Vector3(1, 0.8, 1.4).normalize()
const SELECT_COLOR = 0x89b4fa
const PLACEHOLDER = 0x7a7f8a
const DEG2RAD = Math.PI / 180

/* ---- 数值工具 ---- */
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4
const normDeg = (v: number): number => ((((v + 180) % 360) + 360) % 360) - 180
const fmt = (v: number): string => String(Math.round(v * 100) / 100)

/* ---- 动画叠加（P4-d）：播放器只改场景对象、不写文档（方案 §4.4） ---- */
/** 本帧被播放器改写变换的节点（下一帧先还原为文档静态变换再叠加） */
const animOverlaid = new Set<NodeId>()
/** gizmo 拖拽中标志（dragging-changed 事件维护；拖拽期间暂停叠加，避免把动画姿态当静态变换写回） */
let gizmoDragging = false

/** 把被叠加节点还原为文档静态变换（base pose）；空集时零开销 */
function restoreAnimBase(): void {
  if (animOverlaid.size === 0) return
  const d = store.doc
  for (const id of animOverlaid) {
    const node = d?.nodes[id]
    const obj = nodeObjects.get(id)
    if (!node || !obj) continue
    if (isCubeNode(node) || isGroupNode(node) || isMeshNode(node)) {
      obj.position.set(node.origin[0] / 16, node.origin[1] / 16, node.origin[2] / 16)
      obj.rotation.set(node.rotation[0] * DEG2RAD, node.rotation[1] * DEG2RAD, node.rotation[2] * DEG2RAD)
      if (isGroupNode(node)) {
        const s = node.scale
        obj.scale.set(s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1)
      }
    } else if (isLocatorNode(node)) {
      obj.position.set(node.position[0] / 16, node.position[1] / 16, node.position[2] / 16)
    }
  }
  animOverlaid.clear()
}

/**
 * 播放器叠加：sampleAnimation 采样当前时间 → 直接改场景对象变换（只读文档）。
 * 每帧先还原再叠加；gizmo 拖拽中整帧跳过（保持拖拽对象不被动画抢占）。
 */
function applyAnimationOverlay(): void {
  if (gizmoDragging) return
  restoreAnimBase()
  const d = store.doc
  const animId = animationPlayer.activeAnimId.value
  if (!d || !animId) return
  const anim = d.animations[animId]
  if (!anim) return
  const sampled = sampleAnimation(anim, animationPlayer.time.value)
  for (const [nodeId, ch] of sampled) {
    const obj = nodeObjects.get(nodeId)
    if (!obj) continue
    if (ch.position) obj.position.set(ch.position[0] / 16, ch.position[1] / 16, ch.position[2] / 16)
    if (ch.rotation) obj.rotation.set(ch.rotation[0] * DEG2RAD, ch.rotation[1] * DEG2RAD, ch.rotation[2] * DEG2RAD)
    if (ch.scale) obj.scale.set(ch.scale[0], ch.scale[1], ch.scale[2])
    animOverlaid.add(nodeId)
  }
}

/* ------------------------------------------------------------------ */
/* 场景构建                                                            */
/* ------------------------------------------------------------------ */

function clearSceneModel(): void {
  clearPaintGrid()
  clearSubEditVisuals()
  for (const d of disposables) d.dispose()
  disposables = []
  disposeTextureMats(texCacheCtx)
  nodeObjects.clear()
  animOverlaid.clear()
  pickMeshes = []
  clearHighlights()
  pruneTexturesCore(texCacheCtx)
  if (modelRoot) {
    modelRoot.parent?.remove(modelRoot)
    modelRoot = null
  }
  clearRefPlanes()
}

/* ------------------------------------------------------------------ */
/* D2 视口增量桥（节点级，依赖 DocumentPatch 粒度）                     */
/* ------------------------------------------------------------------ */

/** 增量桥上下文快照（场景索引经 getter/setter 读写；实现见 viewport/sceneBridge） */
function sceneBridgeCtx(): SceneBridgeCtx {
  return {
    nodeObjects,
    animOverlaid,
    edgeGeo,
    getDoc: () => store.doc,
    getPickMeshes: () => pickMeshes,
    setPickMeshes: (v) => {
      pickMeshes = v
    },
    getHighlightLines: () => highlightLines,
    setHighlightLines: (v) => {
      highlightLines = v
    },
    getModelRoot: () => modelRoot,
    buildNodeObject: (d, node) => buildNodeObject(d, node),
    rebuildScene: () => rebuildScene(),
    applyHighlights: () => applyHighlights(),
    syncSubEditVisuals: () => syncSubEditVisuals(),
    refreshGizmo: () => refreshGizmo()
  }
}

/** 把「纯变换 + 结构」DocumentPatch 增量应用到 three.js 场景树（D2a+D2b 合并入口） */
function applyDocPatch(patch: DocumentPatch): void {
  applyDocPatchCore(sceneBridgeCtx(), patch)
}

/**
 * 判断补丁是否为「纯变换」——仅修改已有节点的 origin/rotation/scale/visible，
 * 无删除、无新增、无根顺序变更、无几何属性修改。
 * 已被 D2b 合并入口 applyDocPatch 取代（完整覆盖 remove/new/setRoot/纯变换快路径），
 * 但保留供注释说明与未来回归测试。
 */
// @ts-expect-error 供注释说明用，无直接调用
function isTransformOnlyPatch(_patch: DocumentPatch): boolean {
  return true
}

/** 清除全部参考图平面（B3-1） */
function clearRefPlanes(): void {
  for (const [, p] of refPlanes) {
    p.mesh.parent?.remove(p.mesh)
    p.mesh.geometry.dispose()
    ;(p.mesh.material as THREE.Material).dispose()
    p.tex.dispose()
  }
  refPlanes.clear()
}

/** 同步参考图平面（B3-1）：与文档 referenceImages 对齐 */
function syncRefPlanes(): void {
  const d = store.doc
  const keep = new Set(d?.referenceImages?.map((r) => r.id) ?? [])
  // 移除已删除的
  for (const [id, p] of refPlanes) {
    if (!keep.has(id)) {
      p.mesh.parent?.remove(p.mesh)
      p.mesh.geometry.dispose()
      ;(p.mesh.material as THREE.Material).dispose()
      p.tex.dispose()
      refPlanes.delete(id)
    }
  }
  if (!d?.referenceImages || d.referenceImages.length === 0) return
  for (const ref of d.referenceImages) {
    let entry = refPlanes.get(ref.id)
    if (!entry) {
      const tex = new THREE.Texture()
      tex.colorSpace = THREE.SRGBColorSpace
      const img = new Image()
      img.onload = () => {
        tex.image = img
        tex.needsUpdate = true
      }
      img.src = ref.data
      const geo = new THREE.PlaneGeometry(ref.size[0] / 16, ref.size[1] / 16)
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: ref.opacity,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(ref.position[0] / 16, ref.position[1] / 16, ref.position[2] / 16)
      mesh.visible = ref.visible
      scene?.add(mesh)
      entry = { mesh, tex }
      refPlanes.set(ref.id, entry)
    } else {
      // 更新位置/尺寸/不透明度/可见性
      entry.mesh.position.set(ref.position[0] / 16, ref.position[1] / 16, ref.position[2] / 16)
      entry.mesh.scale.set(ref.size[0] / 16, ref.size[1] / 16, 1)
      ;(entry.mesh.material as THREE.MeshBasicMaterial).opacity = ref.opacity
      entry.mesh.visible = ref.visible
    }
  }
}

function clearHighlights(): void {
  for (const l of highlightLines) {
    l.parent?.remove(l)
    if (l.geometry !== edgeGeo) l.geometry.dispose() // 网格高亮独立 EdgesGeometry
  }
  highlightLines = []
}

/* ------------------------------------------------------------------ */
/* 网格子对象编辑可视化（B4-3）：顶点句柄 / 选中面叠加                    */
/* ------------------------------------------------------------------ */

/** 本笔累积：顶点下标 → 落笔量（按 mode 语义累积）；抬起时一次性提交为单条命令 */
let pendingWeights: Map<number, number> | null = null
/** 上次落墨屏幕点（位移节流；笔画结束清空） */
let lastWeightAt: { x: number; y: number } | null = null

/** 子对象编辑可视化快照（store 切片 + 场景索引；实现见 viewport/subEditVisuals） */
function subEditCtx(): SubEditCtx {
  return {
    visuals: subEdit,
    nodeObjects,
    doc: store.doc,
    editMode: store.editMode,
    meshEditTarget: store.meshEditTarget,
    vertexSelection: store.vertexSelection,
    faceSelection: store.faceSelection,
    edgeSelection: store.edgeSelection,
    knifeAnchor: store.knifeAnchor
  }
}

/** 释放并移除顶点句柄与面叠加（重建/切模式/切选中前调用） */
function clearSubEditVisuals(): void {
  clearSubEditHandles(subEdit)
  pendingWeights = null
}

/** 边句柄：目标 mesh 全部唯一边 → THREE.LineSegments（选中边高亮；随节点 outer 组变换） */
function syncEdgeHandles(): void {
  syncEdgeHandlesCore(subEditCtx())
}

/** 顶点句柄：目标 mesh 全部顶点 → THREE.Points（选中顶点高亮；随节点 outer 组变换） */
function syncVertexHandles(): void {
  syncVertexHandlesCore(subEditCtx())
}

/** 选中面叠加：选中 MeshFace 三角化 → 半透明面片（polygonOffset 防 z-fight） */
function syncFaceOverlay(): void {
  syncFaceOverlayCore(subEditCtx())
}

/**
 * 切刀锚点标记：knife 模式且已定第一点时，在首击点处显示小球（随 outer 组变换）。
 * 局部坐标 = (父空间点 − origin)/16，与网格几何同系。
 */
function syncKnifeMarker(): void {
  syncKnifeMarkerCore(subEditCtx())
}

/** 顶点句柄 + 面叠加 + 边句柄 + 切刀标记 + 权重热力一并同步（选择/模式/文档变化后调用） */
function syncSubEditVisuals(): void {
  syncVertexHandles()
  syncFaceOverlay()
  syncEdgeHandles()
  syncKnifeMarker()
  syncWeightOverlay()
}

/** 节点构建上下文（共享几何/材质与收集器快照；实现见 viewport/nodeBuilder） */
function nodeBuildCtx(): NodeBuildCtx {
  return {
    nodeObjects,
    pickMeshes,
    disposables,
    boxGeo: boxGeo!,
    markerGeo: markerGeo!,
    cubeMat: cubeMat!,
    markerMat: markerMat!,
    tex: texCacheCtx
  }
}

/** 文档节点 → 场景对象（含父子层级映射，见 viewport/nodeBuilder 模块头注释） */
function buildNodeObject(d: ModelDocument, node: ModelNode): THREE.Object3D {
  return buildNodeObjectCore(nodeBuildCtx(), d, node)
}

function rebuildScene(): void {
  if (!scene) return
  tc?.detach()
  clearSceneModel()
  const d = store.doc
  if (!d) return

  boxGeo = new THREE.BoxGeometry(1, 1, 1)
  edgeGeo = new THREE.EdgesGeometry(boxGeo)
  markerGeo = new THREE.OctahedronGeometry(0.09)
  cubeMat = new THREE.MeshLambertMaterial({ color: PLACEHOLDER })
  markerMat = new THREE.MeshBasicMaterial({ color: 0xd0d4dc })
  lineMat = new THREE.LineBasicMaterial({ color: SELECT_COLOR })
  disposables.push(boxGeo, edgeGeo, markerGeo, cubeMat, markerMat, lineMat)

  modelRoot = new THREE.Group()
  modelRoot.name = 'modeler-root'
  // MC(8,8,8)（模型中心）→ three 原点
  modelRoot.position.set(-0.5, -0.5, -0.5)
  scene.add(modelRoot)

  for (const id of d.root) {
    const node = d.nodes[id]
    if (node) modelRoot.add(buildNodeObject(d, node))
  }
  applyHighlights()
  syncSubEditVisuals()
  refreshGizmo()
  syncRefPlanes()
}

/* ------------------------------------------------------------------ */
/* 选中高亮                                                            */
/* ------------------------------------------------------------------ */

function applyHighlights(): void {
  clearHighlights()
  if (!modelRoot || !edgeGeo || !lineMat) return
  for (const id of store.selection) {
    const node = store.doc?.nodes[id]
    if (!node) continue
    if (isCubeNode(node)) {
      const mesh = nodeObjects.get(id)?.children.find((c) => c instanceof THREE.Mesh)
      if (!(mesh instanceof THREE.Mesh)) continue
      const lines = new THREE.LineSegments(edgeGeo, lineMat)
      // 高亮挂在 mesh 本地，取逆 scale 抵消尺寸缩放（与 ModelPreview 同款手法）
      lines.scale.set(
        1 / Math.max(mesh.scale.x, 1e-6),
        1 / Math.max(mesh.scale.y, 1e-6),
        1 / Math.max(mesh.scale.z, 1e-6)
      )
      mesh.add(lines)
      highlightLines.push(lines)
      continue
    }
    if (isMeshNode(node)) {
      // 网格高亮：对首个子 mesh 的几何建 EdgesGeometry（顶点已是相对 origin 局部坐标）
      const mesh = nodeObjects.get(id)?.children.find((c) => c instanceof THREE.Mesh)
      if (!(mesh instanceof THREE.Mesh)) continue
      const edges = new THREE.EdgesGeometry(mesh.geometry, 15)
      const lines = new THREE.LineSegments(edges, lineMat)
      mesh.add(lines)
      highlightLines.push(lines)
    }
  }
}

/* ------------------------------------------------------------------ */
/* gizmo                                                              */
/* ------------------------------------------------------------------ */

function applySnaps(): void {
  if (!tc) return
  tc.setTranslationSnap(snap.value ? 1 / 16 : null) // 1/16 世界单位 = 1 模型格
  tc.setRotationSnap(snap.value ? 22.5 * DEG2RAD : null)
  tc.setScaleSnap(null)
}

/** 父链骨骼旋转（根 → 直接父级顺序；骨骼空间旋转合成用） */
function ancestorRotations(d: ModelDocument, id: NodeId): Vec3[] {
  const chain: Vec3[] = []
  let cur: NodeId | null = d.nodes[id]?.parent ?? null
  let guard = 0
  while (cur && guard++ < 256) {
    const n = d.nodes[cur]
    if (!n) break
    if (isGroupNode(n)) chain.push(n.rotation)
    cur = n.parent
  }
  return chain.reverse()
}

function refreshGizmo(): void {
  if (!tc) return
  const d = store.doc
  const sel = store.selection
  gizmoHint.value = ''
  gizmoMode.value = tool.value
  if (tool.value === 'paint') {
    // 绘画模式不提供 gizmo（自由绘画类工具禁用相机左键，见模块头注释）
    tc.detach()
    return
  }
  if (tool.value === 'weight') {
    // 权重绘制不提供 gizmo（笔刷接管左键）
    tc.detach()
    gizmoHint.value = store.weightTarget
      ? '权重绘制：拖动把目标组影响涂到顶点（蓝 0 → 红 1）'
      : '权重绘制：请先在工具条选择目标组'
    return
  }
  if (!d || sel.length === 0 || !multiProxy) {
    tc.detach()
    return
  }
  /* 网格子对象模式（B4-3）：顶点模式 gizmo 绑选中顶点质心（仅平移）；面模式无 gizmo */
  if (store.editMode !== 'object') {
    const node = sel.length === 1 ? d.nodes[sel[0]!] : undefined
    const outer = sel.length === 1 ? nodeObjects.get(sel[0]!) : undefined
    if (!node || !isMeshNode(node) || !outer) {
      tc.detach()
      return
    }
    if (isEffectivelyLocked(d, node.id)) {
      tc.detach()
      gizmoHint.value = '已锁定（含祖先锁定）：解除锁定后才能变换'
      return
    }
    if (store.editMode === 'face') {
      tc.detach()
      gizmoHint.value = '面模式：点击选面（Shift 加选），Delete 删除选中面'
      return
    }
    if (store.editMode === 'edge') {
      tc.detach()
      gizmoHint.value = '边模式：点击选边（Shift 加选），工具条「环切」插入一圈边'
      return
    }
    if (store.editMode === 'knife') {
      tc.detach()
      gizmoHint.value = store.knifeAnchor
        ? '切刀：已定第一点（球标），点击第二点确定切割平面'
        : '切刀：点击面上第一点，再点第二点确定切割平面（过两点、垂直于首击面）'
      return
    }
    const vs = store.vertexSelection.filter((i) => i >= 0 && i < node.vertices.length)
    if (vs.length === 0) {
      tc.detach()
      gizmoHint.value = '顶点模式：点击选顶点（Shift 加选）'
      return
    }
    if (tool.value !== 'translate') gizmoHint.value = '顶点模式仅支持移动'
    gizmoMode.value = 'translate'
    tc.setMode('translate')
    tc.setSpace('world') // 顶点增量按世界轴读取，commit 时经节点逆矩阵换算回父空间
    outer.updateWorldMatrix(true, false)
    const centroid = new THREE.Vector3()
    const corner = new THREE.Vector3()
    for (const i of vs) {
      const v = node.vertices[i]!
      corner
        .set((v[0] - node.origin[0]) / 16, (v[1] - node.origin[1]) / 16, (v[2] - node.origin[2]) / 16)
        .applyMatrix4(outer.matrixWorld)
      centroid.add(corner)
    }
    multiProxy.position.copy(centroid.multiplyScalar(1 / vs.length))
    // 代理跨拖拽复用：挂接前重置姿态，避免上次变换残留污染本轮增量读取
    multiProxy.rotation.set(0, 0, 0)
    multiProxy.scale.set(1, 1, 1)
    tc.attach(multiProxy)
    return
  }
  if (sel.length === 1) {
    const node = d.nodes[sel[0]!]
    const obj = nodeObjects.get(sel[0]!)
    if (!node || !obj) {
      tc.detach()
      return
    }
    if (isEffectivelyLocked(d, sel[0]!)) {
      tc.detach()
      gizmoHint.value = '已锁定（含祖先锁定）：解除锁定后才能变换'
      return
    }
    if (!node.visible) {
      tc.detach()
      gizmoHint.value = '节点已隐藏'
      return
    }
    let mode: ToolMode = tool.value
    if (isLocatorNode(node) && mode !== 'translate') {
      mode = 'translate'
      gizmoHint.value = '定位点仅支持移动'
    }
    gizmoMode.value = mode
    tc.setMode(mode)

    /* 骨骼空间（P3-d）：gizmo 挂到「位于节点枢轴、朝向父骨骼系」的代理上 */
    if (space.value === 'bone') {
      if (mode === 'scale') {
        gizmoHint.value = '骨骼空间不支持缩放，已回退自身空间'
        tc.setSpace('local')
        tc.attach(obj)
        return
      }
      const chain = ancestorRotations(d, sel[0]!)
      if (chain.length === 0) {
        gizmoHint.value = '无父骨骼，骨骼空间等同自身空间'
        tc.setSpace('local')
        tc.attach(obj)
        return
      }
      const pivot = worldPivotOf(d, sel[0]!)
      boneProxy!.position.set(pivot[0] / 16 - 0.5, pivot[1] / 16 - 0.5, pivot[2] / 16 - 0.5)
      const q = ancestorRotationQuat(chain)
      boneProxy!.quaternion.set(q[0], q[1], q[2], q[3])
      tc.setSpace('local')
      tc.attach(boneProxy!)
      return
    }

    tc.setSpace(space.value)
    tc.attach(obj)
    return
  }
  // 多选：代理对象放到选中集（顶层化）质心，平移/旋转/缩放均绕质心 pivot
  const tops = effectiveSelection(d, sel)
  if (tops.length === 0) {
    tc.detach()
    return
  }
  if (space.value === 'bone') {
    gizmoHint.value = '骨骼空间仅支持单选，多选已回退全局空间'
  } else if (tool.value !== 'translate') {
    gizmoHint.value = '多选变换绕选中集质心'
  }
  tc.setSpace(space.value === 'bone' ? 'world' : space.value)
  let cx = 0
  let cy = 0
  let cz = 0
  for (const id of tops) {
    const p = worldPivotOf(d, id)
    cx += p[0]
    cy += p[1]
    cz += p[2]
  }
  gizmoMode.value = tool.value
  tc.setMode(tool.value)
  multiProxy.position.set(
    cx / tops.length / 16 - 0.5,
    cy / tops.length / 16 - 0.5,
    cz / tops.length / 16 - 0.5
  )
  // 代理跨拖拽复用：挂接前重置姿态，避免上次旋转/缩放残留污染本轮增量读取
  multiProxy.rotation.set(0, 0, 0)
  multiProxy.scale.set(1, 1, 1)
  tc.attach(multiProxy)
}

/* ---- 拖拽 → 命令 ---- */
const dragStartWorld = new THREE.Vector3()
const dragStartQuat = new THREE.Quaternion() // 旋转增量基准：拖拽起始的世界四元数（骨骼空间 / 多选代理）

function onDraggingChanged(value: boolean): void {
  if (orbit) orbit.enabled = !value
  gizmoDragging = value
  // 拖拽开始：先还原动画叠加，gizmo 读取的是文档静态变换而非动画姿态
  if (value) restoreAnimBase()
  if (!tc) return
  const obj = tc.object
  if (value) {
    if (obj) {
      obj.getWorldPosition(dragStartWorld)
      if (obj === boneProxy || obj === multiProxy) obj.getWorldQuaternion(dragStartQuat)
    }
    readout.value = ''
  } else {
    commitDrag()
    readout.value = ''
  }
}

/** 拖拽结束：把 gizmo 结果一次性换算为文档命令（每次拖拽 = 1 条命令） */
function commitDrag(): void {
  if (!tc) return
  const obj = tc.object
  const d = store.doc
  if (!obj || !d) return
  const sel = store.selection
  const mode = tc.mode

  /* 顶点模式（B4-3）：世界系位移增量 → 节点逆矩阵换算回父空间 → 写回选中顶点 */
  if (store.editMode === 'vertex') {
    if (mode !== 'translate' || obj !== multiProxy) return
    const id = store.meshEditTarget
    const node = id ? d.nodes[id] : undefined
    const outer = id ? nodeObjects.get(id) : undefined
    if (!id || !node || !isMeshNode(node) || !outer) return
    const now = obj.getWorldPosition(new THREE.Vector3())
    const dw = now.sub(dragStartWorld)
    if (dw.lengthSq() < 1e-12) return
    // matrixWorld 含祖先旋转/组缩放（平移项由 w=0 剔除）；局部单位 = 模型单位 /16
    const inv = new THREE.Matrix4().copy(outer.matrixWorld).invert()
    const d4 = new THREE.Vector4(dw.x, dw.y, dw.z, 0).applyMatrix4(inv)
    const delta: Vec3 = [r4(d4.x * 16), r4(d4.y * 16), r4(d4.z * 16)]
    if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return
    const vs = store.vertexSelection.filter((i) => i >= 0 && i < node.vertices.length)
    if (vs.length === 0) return
    store.execute('移动顶点', (doc) =>
      patchNode(doc, id, { vertices: translateMeshVertices(node, vs, delta) })
    )
    return
  }

  if (mode === 'translate') {
    const now = obj.getWorldPosition(new THREE.Vector3())
    const delta: Vec3 = [
      r4((now.x - dragStartWorld.x) * 16),
      r4((now.y - dragStartWorld.y) * 16),
      r4((now.z - dragStartWorld.z) * 16)
    ]
    if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return
    // 锁定节点（含祖先锁定）不参与多选移动
    const movable = sel.filter((id) => d.nodes[id] && !isEffectivelyLocked(d, id))
    if (movable.length === 0) return
    store.execute('移动节点', (doc) => translateNodes(doc, movable, delta))
    return
  }

  // 多选旋转/缩放：绕选中集（顶层化）质心 pivot，gizmo 增量一次性换算为文档命令
  if (sel.length !== 1) {
    const pivot: Vec3 = [
      r4((dragStartWorld.x + 0.5) * 16),
      r4((dragStartWorld.y + 0.5) * 16),
      r4((dragStartWorld.z + 0.5) * 16)
    ]
    const movable = sel.filter((id) => d.nodes[id] && !isEffectivelyLocked(d, id))
    if (movable.length === 0) return
    if (mode === 'rotate') {
      const after = obj.getWorldQuaternion(new THREE.Quaternion())
      const delta = after.multiply(dragStartQuat.clone().invert())
      if (Math.abs(delta.w) > 1 - 1e-6) return
      store.execute('旋转选中节点', (doc) =>
        rotateNodes(doc, movable, [delta.x, delta.y, delta.z, delta.w], pivot)
      )
      return
    }
    if (mode === 'scale') {
      const f: Vec3 = [r4(obj.scale.x), r4(obj.scale.y), r4(obj.scale.z)]
      if (Math.abs(f[0] - 1) < 1e-4 && Math.abs(f[1] - 1) < 1e-4 && Math.abs(f[2] - 1) < 1e-4) return
      store.execute('缩放选中节点', (doc) => scaleNodes(doc, movable, f, pivot))
    }
    return
  }
  const id = sel[0]!
  const node = d.nodes[id]
  if (!node) return

  if (mode === 'rotate') {
    if (!isCubeNode(node) && !isGroupNode(node) && !isMeshNode(node)) return
    if (obj === boneProxy) {
      // 骨骼空间（P3-d）：世界系增量 → 骨骼系合成回节点欧拉角（1 次拖拽 = 1 条命令）
      const after = obj.getWorldQuaternion(new THREE.Quaternion())
      const inv = dragStartQuat.clone().invert()
      const delta = after.multiply(inv)
      const qb = ancestorRotationQuat(ancestorRotations(d, id))
      const rot = composeBoneLocalRotation(node.rotation, qb, [delta.x, delta.y, delta.z, delta.w])
      const final: Vec3 = [
        normDeg(snap.value ? Math.round(rot[0] / 22.5) * 22.5 : r4(rot[0])),
        normDeg(snap.value ? Math.round(rot[1] / 22.5) * 22.5 : r4(rot[1])),
        normDeg(snap.value ? Math.round(rot[2] / 22.5) * 22.5 : r4(rot[2]))
      ]
      store.execute('旋转节点', (doc) => patchNode(doc, id, { rotation: final }))
      return
    }
    const e = obj.rotation
    const rot: Vec3 = [
      normDeg(snap.value ? Math.round((e.x / DEG2RAD) / 22.5) * 22.5 : r4(e.x / DEG2RAD)),
      normDeg(snap.value ? Math.round((e.y / DEG2RAD) / 22.5) * 22.5 : r4(e.y / DEG2RAD)),
      normDeg(snap.value ? Math.round((e.z / DEG2RAD) / 22.5) * 22.5 : r4(e.z / DEG2RAD))
    ]
    store.execute('旋转节点', (doc) => patchNode(doc, id, { rotation: rot }))
    return
  }

  if (mode === 'scale') {
    if (isCubeNode(node)) {
      // 立方体：绕自身 origin 缩放 from/to（外层对象 scale 恒为 1，gizmo 因子即缩放比）
      const from: Vec3 = [0, 0, 0]
      const to: Vec3 = [0, 0, 0]
      for (let i = 0; i < 3; i++) {
        const k = Math.abs(obj.scale.getComponent(i)) < 1e-4 ? 1e-4 : r4(obj.scale.getComponent(i))
        from[i] = r4(node.origin[i]! + k * (node.from[i]! - node.origin[i]!))
        to[i] = r4(node.origin[i]! + k * (node.to[i]! - node.origin[i]!))
      }
      store.execute('缩放立方体', (doc) => patchNode(doc, id, { from, to }))
    } else if (isMeshNode(node)) {
      // 网格：绕自身 origin 缩放顶点（烘焙进几何，与立方体 from/to 缩放同策略）
      const k: Vec3 = [0, 0, 0]
      for (let i = 0; i < 3; i++) {
        k[i] = Math.abs(obj.scale.getComponent(i)) < 1e-4 ? 1e-4 : r4(obj.scale.getComponent(i))
      }
      if (Math.abs(k[0] - 1) < 1e-4 && Math.abs(k[1] - 1) < 1e-4 && Math.abs(k[2] - 1) < 1e-4) return
      const vertices = node.vertices.map(
        (v) =>
          [
            r4(node.origin[0] + k[0] * (v[0] - node.origin[0])),
            r4(node.origin[1] + k[1] * (v[1] - node.origin[1])),
            r4(node.origin[2] + k[2] * (v[2] - node.origin[2]))
          ] as Vec3
      )
      store.execute('缩放网格', (doc) => patchNode(doc, id, { vertices }))
    } else if (isGroupNode(node)) {
      // 组：绝对读取 scale（gizmo 在现有 scale 基础上相乘）
      const f: Vec3 = [r4(obj.scale.x), r4(obj.scale.y), r4(obj.scale.z)]
      const identity = Math.abs(f[0] - 1) < 1e-4 && Math.abs(f[1] - 1) < 1e-4 && Math.abs(f[2] - 1) < 1e-4
      store.execute('缩放组', (doc) => patchNode(doc, id, { scale: identity ? undefined : f }))
    }
  }
}

/** 拖拽过程实时读数（视口右下角） */
function onObjectChange(): void {
  if (!tc || !tc.object) return
  const obj = tc.object
  const mode = tc.mode
  if (mode === 'translate') {
    const now = obj.getWorldPosition(new THREE.Vector3())
    readout.value = `ΔX ${fmt((now.x - dragStartWorld.x) * 16)}  ΔY ${fmt(
      (now.y - dragStartWorld.y) * 16
    )}  ΔZ ${fmt((now.z - dragStartWorld.z) * 16)}`
  } else if (mode === 'rotate') {
    if (obj === boneProxy) {
      // 骨骼空间实时预览：把合成结果直接写到节点对象四元数（不写 store，松手统一提交）
      const sid = store.selection[0]
      const snode = sid ? store.doc?.nodes[sid] : undefined
      const sdoc = store.doc
      if (sdoc && sid && snode && (isCubeNode(snode) || isGroupNode(snode))) {
        const after = obj.getWorldQuaternion(new THREE.Quaternion())
        const delta = after.clone().multiply(dragStartQuat.clone().invert())
        const qb = ancestorRotationQuat(ancestorRotations(sdoc, sid))
        const rot = composeBoneLocalRotation(snode.rotation, qb, [delta.x, delta.y, delta.z, delta.w])
        const target = nodeObjects.get(sid)
        if (target) target.rotation.set(rot[0] * DEG2RAD, rot[1] * DEG2RAD, rot[2] * DEG2RAD)
        readout.value = `R ${fmt(rot[0])}°  ${fmt(rot[1])}°  ${fmt(rot[2])}°`
        return
      }
    }
    readout.value = `R ${fmt(obj.rotation.x / DEG2RAD)}°  ${fmt(obj.rotation.y / DEG2RAD)}°  ${fmt(
      obj.rotation.z / DEG2RAD
    )}°`
  } else {
    readout.value = `S ${fmt(obj.scale.x)}  ${fmt(obj.scale.y)}  ${fmt(obj.scale.z)}`
  }
}

/* ------------------------------------------------------------------ */
/* 点选 / 框选 / 多选                                                   */
/* ------------------------------------------------------------------ */

const raycaster = new THREE.Raycaster()
raycaster.params.Points = { threshold: 0.04 } // 顶点句柄拾取容差（世界单位；B4-3）
let downX = 0
let downY = 0

/** 拾取上下文快照（three 单例 + 场景索引；实现见 viewport/picking） */
function pickCtx(): PickCtx {
  return {
    canvas: canvasRef.value,
    camera,
    raycaster,
    pickMeshes,
    nodeObjects,
    doc: store.doc,
    visuals: subEdit,
    weightOverlay: subEdit.weightOverlay
  }
}

function modifierActive(e: PointerEvent | MouseEvent): boolean {
  return e.shiftKey || e.ctrlKey || e.metaKey
}

/* ---- 橡皮筋框选（Shift/Ctrl + 左键拖拽） ---- */
const marquee = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
let marqueeArmed = false
let marqueeAdditive = false
let marqueeStartX = 0
let marqueeStartY = 0

const marqueeStyle = computed(() => {
  const m = marquee.value
  if (!m) return {}
  return {
    left: `${Math.min(m.x1, m.x2)}px`,
    top: `${Math.min(m.y1, m.y2)}px`,
    width: `${Math.abs(m.x2 - m.x1)}px`,
    height: `${Math.abs(m.y2 - m.y1)}px`
  }
})

function onPointerDown(e: PointerEvent): void {
  downX = e.clientX
  downY = e.clientY
  if (tool.value === 'weight') return // 权重刷不参与框选/gizmo（避免漏接 pointerup 卡住轨道）
  if (e.button !== 0 || !tc || tc.axis) return
  if (modifierActive(e) && store.editMode === 'object') {
    // 修饰键 + 左键 = 框选预备（仅对象模式；子对象模式 Shift 用于加选）；屏蔽轨道旋转直到收尾
    marqueeArmed = true
    marqueeAdditive = e.ctrlKey || e.metaKey
    marqueeStartX = e.clientX
    marqueeStartY = e.clientY
    marquee.value = null
    if (orbit) orbit.enabled = false
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!marqueeArmed || !canvasRef.value) return
  const dx = e.clientX - marqueeStartX
  const dy = e.clientY - marqueeStartY
  if (dx * dx + dy * dy > 16) {
    const rect = canvasRef.value.getBoundingClientRect()
    marquee.value = {
      x1: marqueeStartX - rect.left,
      y1: marqueeStartY - rect.top,
      x2: e.clientX - rect.left,
      y2: e.clientY - rect.top
    }
  }
}

function onPointerUp(e: PointerEvent): void {
  if (!tc || !camera) return
  if (tool.value === 'paint') return // 绘画由 stroke 流程接管
  if (tool.value === 'weight') return // 权重绘制由 brush 流程接管（不动节点选择）
  // 框选收尾
  if (marqueeArmed) {
    marqueeArmed = false
    if (orbit) orbit.enabled = true
    const rect = marquee.value
    marquee.value = null
    if (rect) {
      applyMarquee(rect, marqueeAdditive)
      return
    }
    // 未形成矩形（修饰键单击）→ 落入下方点选分支
  }
  if (tc.dragging || tc.axis) return // 正在拖 gizmo / 悬停 gizmo 不做点选
  const dx = e.clientX - downX
  const dy = e.clientY - downY
  if (dx * dx + dy * dy > 16) return // 拖动视角不算点选

  /* 子对象模式（B4-3）：只改子选择，不动节点级 selection */
  if (store.editMode === 'vertex') {
    const vi = pickVertexAt(e.clientX, e.clientY)
    if (vi !== null) {
      const cur = store.vertexSelection
      store.vertexSelection = modifierActive(e)
        ? cur.includes(vi)
          ? cur.filter((x) => x !== vi)
          : [...cur, vi]
        : [vi]
    } else if (!modifierActive(e)) {
      store.vertexSelection = []
    }
    return
  }
  if (store.editMode === 'face') {
    const fi = pickMeshFaceAt(e.clientX, e.clientY)
    if (fi !== null) {
      const cur = store.faceSelection
      store.faceSelection = modifierActive(e)
        ? cur.includes(fi)
          ? cur.filter((x) => x !== fi)
          : [...cur, fi]
        : [fi]
    } else if (!modifierActive(e)) {
      store.faceSelection = []
    }
    return
  }
  if (store.editMode === 'edge') {
    const ek = pickMeshEdgeAt(e.clientX, e.clientY)
    if (ek !== null) {
      const cur = store.edgeSelection
      store.edgeSelection = modifierActive(e)
        ? cur.includes(ek)
          ? cur.filter((x) => x !== ek)
          : [...cur, ek]
        : [ek]
    } else if (!modifierActive(e)) {
      store.edgeSelection = []
    }
    return
  }
  if (store.editMode === 'knife') {
    // 切刀（v3 C2）：首击定锚点，次击成刀；不打点选（不改节点/子选择）
    const p = pickMeshSurfaceAt(e.clientX, e.clientY)
    if (p) store.knifeClick(p.face, p.point)
    else store.cancelKnife()
    return
  }

  const hit = pickAt(e.clientX, e.clientY)
  if (hit) {
    if (modifierActive(e)) {
      const cur = store.selection
      store.selection = cur.includes(hit) ? cur.filter((x) => x !== hit) : [...cur, hit]
    } else {
      store.selection = [hit]
    }
  } else if (!modifierActive(e)) {
    store.selection = []
  }
}

function pickAt(clientX: number, clientY: number): NodeId | null {
  return pickNodeAt(pickCtx(), clientX, clientY)
}

/** 顶点模式拾取（B4-3）：raycast 顶点句柄 Points → 顶点下标 */
function pickVertexAt(clientX: number, clientY: number): number | null {
  return pickVertexAtCore(pickCtx(), clientX, clientY)
}

/**
 * 面模式拾取（B4-3）：raycast 目标 mesh 的分组网格 → 三角序号
 * 经 userData.triToFace 回映射为 node.faces 面下标。
 */
function pickMeshFaceAt(clientX: number, clientY: number): number | null {
  return pickMeshFaceAtCore(pickCtx(), store.meshEditTarget, clientX, clientY)
}

/**
 * 切刀拾取（v3 C2）：raycast 目标 mesh → { 面下标, 父空间交点坐标 }。
 * 父空间换算：outer.worldToLocal(世界交点) 得 (v−origin)/16，乘 16 再加回 origin。
 */
function pickMeshSurfaceAt(clientX: number, clientY: number): { face: number; point: Vec3 } | null {
  return pickMeshSurfaceAtCore(pickCtx(), store.meshEditTarget, clientX, clientY)
}

/**
 * 边模式拾取（v3 C1）：把目标 mesh 的每条边两端投影到屏幕，取「鼠标点到线段」
 * 最近距离最小且在像素容差内的边（返回 edge key）。不做遮挡剔除（子对象编辑可接受）。
 */
function pickMeshEdgeAt(clientX: number, clientY: number): string | null {
  const canvas = canvasRef.value
  const cam = camera
  if (!canvas || !cam) return null
  const id = store.meshEditTarget
  const node = id ? store.doc?.nodes[id] : undefined
  const outer = id ? nodeObjects.get(id) : undefined
  if (!node || !isMeshNode(node) || !outer) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const px = clientX - rect.left
  const py = clientY - rect.top
  const THRESHOLD = 9 // 屏幕像素容差
  outer.updateWorldMatrix(true, false)
  const v3 = new THREE.Vector3()
  const project = (v: Vec3): { x: number; y: number } => {
    v3.set(
      (v[0] - node.origin[0]) / 16,
      (v[1] - node.origin[1]) / 16,
      (v[2] - node.origin[2]) / 16
    )
      .applyMatrix4(outer.matrixWorld)
      .project(cam)
    return { x: ((v3.x + 1) / 2) * rect.width, y: ((1 - v3.y) / 2) * rect.height }
  }
  let best: string | null = null
  let bestD = THRESHOLD
  for (const e of buildMeshEdges(node)) {
    const a = project(node.vertices[e.a]!)
    const b = project(node.vertices[e.b]!)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    const t = lenSq > 1e-9 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq)) : 0
    const d = Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t))
    if (d < bestD) {
      bestD = d
      best = meshEdgeKey(e.a, e.b)
    }
  }
  return best
}

/**
 * 框选：把每个节点的子树几何点（cube 世界角点 / locator pivot）投影到屏幕，
 * 任一点落入矩形即选中该节点（组被其子树代表；父子重复选中由变换端顶层化消解）。
 * 隐藏节点与有效锁定节点不参与。
 */
function applyMarquee(
  rect: { x1: number; y1: number; x2: number; y2: number },
  additive: boolean
): void {
  const d = store.doc
  const canvas = canvasRef.value
  if (!d || !canvas || !camera) return
  const stageRect = canvas.getBoundingClientRect()
  if (stageRect.width === 0 || stageRect.height === 0) return
  const hitIds = nodesInMarquee(d, camera, stageRect, rect)
  store.selection = additive ? Array.from(new Set([...store.selection, ...hitIds])) : hitIds
}

/** 双击：选中整棵子树（子对象模式不改节点级选择） */
function onDblClick(e: MouseEvent): void {
  if (!store.doc || modifierActive(e) || store.editMode !== 'object') return
  const hit = pickAt(e.clientX, e.clientY)
  if (hit && store.doc.nodes[hit]) store.selection = subtreeIds(store.doc, hit)
}

/** Ctrl/Cmd+A 全选、Esc 清空选择、无修饰键工具热键（输入框聚焦时不劫持） */
function onKeyDown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (!store.doc) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    // 子对象模式：全选当前 mesh 的顶点/面；对象模式：全选节点
    if (store.editMode === 'vertex') {
      const id = store.meshEditTarget
      const node = id ? store.doc.nodes[id] : undefined
      if (node && isMeshNode(node)) store.vertexSelection = node.vertices.map((_, i) => i)
    } else if (store.editMode === 'face') {
      const id = store.meshEditTarget
      const node = id ? store.doc.nodes[id] : undefined
      if (node && isMeshNode(node)) store.faceSelection = node.faces.map((_, i) => i)
    } else if (store.editMode === 'edge') {
      const id = store.meshEditTarget
      const node = id ? store.doc.nodes[id] : undefined
      if (node && isMeshNode(node)) store.edgeSelection = buildMeshEdges(node).map((e) => meshEdgeKey(e.a, e.b))
    } else {
      store.selection = Object.keys(store.doc.nodes)
    }
    return
  }
  if (e.key === 'Escape') {
    // 子对象模式先清子选择（保持模式）；无子选择时清节点选择（触发自动回落）
    if (store.editMode === 'vertex' && store.vertexSelection.length > 0) {
      store.vertexSelection = []
      return
    }
    if (store.editMode === 'face' && store.faceSelection.length > 0) {
      store.faceSelection = []
      return
    }
    if (store.editMode === 'edge' && store.edgeSelection.length > 0) {
      store.edgeSelection = []
      return
    }
    if (store.editMode === 'knife' && store.knifeAnchor) {
      store.cancelKnife()
      return
    }
    store.selection = []
    return
  }
  // 工具热键（P5-polish）：W 移动 / E 旋转 / R 缩放 / B 绘画（带修饰键时不劫持）
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  // 网格子对象模式热键（B4-3/v3 C1·C2）：1 对象 / 2 顶点 / 3 面 / 4 边 / 5 切刀（单选 mesh 时生效）
  if (meshEditAvailable.value) {
    if (e.key === '1') {
      store.setEditMode('object')
      return
    }
    if (e.key === '2') {
      store.setEditMode('vertex')
      return
    }
    if (e.key === '3') {
      store.setEditMode('face')
      return
    }
    if (e.key === '4') {
      store.setEditMode('edge')
      return
    }
    if (e.key === '5') {
      store.setEditMode('knife')
      return
    }
  }
  const next = TOOL_HOTKEYS[e.key.toLowerCase()]
  if (next) tool.value = next
}

/** 指针带出画布时兜底复位框选状态 + 清绘画网格 */
function onPointerLeave(): void {
  clearPaintGrid()
  if (marqueeArmed) {
    marqueeArmed = false
    marquee.value = null
    if (orbit) orbit.enabled = true
  }
}

/* ------------------------------------------------------------------ */
/* 绘画（paint 工具）                                                   */
/* ------------------------------------------------------------------ */

let stroke: StrokeState | null = null

function paintEnabled(): boolean {
  return tool.value === 'paint' && !!store.doc
}

/** 绘画参数快照（事件处理时读取当前响应式值，喂给纯算法） */
function paintParams(): PaintParams {
  return {
    paintTool: paintTool.value,
    color: paintColor.value,
    opacity: paintOpacity.value,
    brushSize: brushSize.value,
    mirrorX: mirrorX.value,
    mirrorY: mirrorY.value,
    lockAlpha: lockAlpha.value
  }
}

/** 绘画上下文（canvas/camera 未就绪时返回 null） */
function paintCtxOf(): PaintCtx | null {
  const canvas = canvasRef.value
  if (!canvas || !camera) return null
  return { doc: store.doc, canvas, camera, raycaster, pickMeshes, texEntries, isChainVisible }
}

/**
 * 绘画模式 capture 拦截左键：屏蔽 OrbitControls（相机左键）与本组件 bubble 点选。
 * Alt = 拾色；否则开始笔画（进入 raycast 落笔循环）。
 */
function onPaintPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  // 权重绘制（v3 C3a）：capture 拦截左键屏蔽轨道旋转；命中面起笔，拖动连续落墨
  if (weightEnabled()) {
    if (onWeightPointerDown(e)) {
      e.stopPropagation()
      window.addEventListener('pointermove', onWeightPointerMove)
      window.addEventListener('pointerup', onWeightPointerUp, { once: true })
    }
    return
  }
  if (!paintEnabled()) return
  e.stopPropagation()
  if (e.altKey) {
    pickColorAt(e.clientX, e.clientY)
    return
  }
  const hit = pickFaceAt(e.clientX, e.clientY)
  if (!hit || !hit.texId) return
  const entry = texEntries.get(hit.texId)
  if (!entry) return
  // 油漆桶：单击连通域填充，立即提交（不走笔画流程）
  if (paintTool.value === 'bucket') {
    bucketFillAt(hit, entry)
    return
  }
  stroke = createStrokeState(hit, entry, e.shiftKey)
  if (paintTool.value !== 'eraser') noteRecentColor(paintColor.value)
  if (stroke.shiftLine) strokeLine(stroke, stroke.startPx, hit.px)
  else stampAt(stroke, hit.px[0], hit.px[1])
  window.addEventListener('pointermove', onStrokeMove)
  window.addEventListener('pointerup', onStrokeUp, { once: true })
}

/** 射线拾取表面命中 → 贴图 + 命中像素（算法实现见 viewport/paintTools.ts） */
function pickFaceAt(clientX: number, clientY: number): FaceHit | null {
  const ctx = paintCtxOf()
  return ctx ? pickFaceCore(ctx, clientX, clientY) : null
}

/** 方形笔刷落笔（算法实现见 viewport/paintTools.ts） */
function stampAt(s: StrokeState, cx: number, cy: number): void {
  stampCore(paintParams(), s, cx, cy)
}

/** 笔画结束/油漆桶落定提交：活动层像素 → 烘焙 → 写回文档（一次动作一条命令，可撤销） */
function commitEntryPaint(texId: TextureId, entry: TexEntryLike): void {
  const dataUrl = entry.paintCanvas.toDataURL('image/png')
  entry.loadedPaintData = dataUrl // 绘画画布已是最终态，标记避免重载闪烁
  void store.applyPaintStroke(texId, dataUrl)
}

/**
 * 油漆桶：4-连通域填充（算法实现见 viewport/paintTools.ts）。
 * 有变化时：记最近色（橡皮除外）→ 提交写回文档。
 */
function bucketFillAt(hit: FaceHit, entry: TexEntry): void {
  if (!bucketFillCore(paintParams(), hit, entry)) return
  if (paintTool.value !== 'eraser') noteRecentColor(paintColor.value)
  commitEntryPaint(hit.texId!, entry)
}

/** Bresenham 线段落笔（算法实现见 viewport/paintTools.ts） */
function strokeLine(s: StrokeState, from: Vec2, to: Vec2): void {
  strokeLineCore(paintParams(), s, from, to)
}

function onStrokeMove(e: PointerEvent): void {
  const s = stroke
  if (!s) return
  const hit = pickFaceAt(e.clientX, e.clientY)
  if (!hit || hit.texId !== s.texId) return
  if (s.shiftLine) {
    // 快照恢复 → 全量重画直线（Shift 直线预览）
    s.entry.paintCtx.putImageData(s.snapshot, 0, 0)
    s.painted.clear()
    strokeLine(s, s.startPx, hit.px)
    s.lastPx = hit.px
    return
  }
  if (hit.faceKey === s.lastFaceKey) {
    strokeLine(s, s.lastPx, hit.px)
  } else {
    // 跨面处 uv 断裂：不连线，重新单点起笔
    stampAt(s, hit.px[0], hit.px[1])
    s.lastFaceKey = hit.faceKey
  }
  s.lastPx = hit.px
}

/** 笔画结束：整张贴图写回文档（每笔画一条命令，可撤销） */
function onStrokeUp(): void {
  const s = stroke
  stroke = null
  window.removeEventListener('pointermove', onStrokeMove)
  if (!s || !s.changed) return
  commitEntryPaint(s.texId, s.entry)
}

/** Alt 拾色：读命中像素（全透明不拾取） */
function pickColorAt(clientX: number, clientY: number): void {
  const hit = pickFaceAt(clientX, clientY)
  if (!hit?.texId) return
  const entry = texEntries.get(hit.texId)
  if (!entry) return
  const [x, y] = hit.px
  const data = entry.paintCtx.getImageData(x, y, 1, 1).data
  if (data[3] === 0) return
  paintColor.value = `#${[data[0], data[1], data[2]]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

/* ---- 绘画网格：悬停面显示 texel 边界线（paintGrid 开关） ---- */
let paintGridObj: THREE.LineSegments | null = null
let paintGridKey = ''

function clearPaintGrid(): void {
  if (paintGridObj) {
    paintGridObj.parent?.remove(paintGridObj)
    paintGridObj.geometry.dispose()
    ;(paintGridObj.material as THREE.Material).dispose()
    paintGridObj = null
  }
  paintGridKey = ''
}

/**
 * 悬停更新网格（几何生成见 viewport/paintTools.ts computePaintGrid）：
 * 挂为命中 mesh 子对象（继承全部变换）。同一面重复悬停不重建（key 判定）；笔画期间冻结。
 */
function onPaintHover(e: PointerEvent): void {
  if (!paintEnabled() || !paintGrid.value || stroke) return
  const hit = pickFaceAt(e.clientX, e.clientY)
  const d = store.doc
  const node = hit && d ? d.nodes[hit.nodeId] : undefined
  // 绘画网格仅支持 cube（按面 4 顶点定位）；mesh 面为三角化任意多边形，不画网格
  if (!hit || !hit.texId || !d || !node || !isCubeNode(node) || !hit.face) {
    clearPaintGrid()
    return
  }
  const binding = effectiveFaceBindings(node, d.settings.uvMode)[hit.face]
  if (!binding?.uv) {
    clearPaintGrid()
    return
  }
  const grid = computePaintGrid(hit, node, d.settings.uvMode, paintGridKey)
  if (!grid) return // 同一面重复悬停（key 未变）

  clearPaintGrid()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(grid.positions, 3))
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  })
  paintGridObj = new THREE.LineSegments(geo, mat)
  paintGridObj.renderOrder = 2
  hit.mesh.add(paintGridObj)
  paintGridKey = grid.key
}

/* ------------------------------------------------------------------ */
/* 权重绘制（v3 C3a）                                                    */
/* ------------------------------------------------------------------ */

/** 权重绘制就绪：权重工具 + 单选 mesh + 已选目标组 */
function weightEnabled(): boolean {
  return (
    gizmoMode.value === 'weight' && meshEditAvailable.value && !!store.weightTarget && !!editingMesh.value
  )
}

/** 权重算法上下文（事件处理时读取当前响应式值，喂给纯算法） */
function weightCtx(): WeightCtx {
  return {
    mode: weightMode.value,
    radius: weightRadius.value,
    strength: weightStrength.value,
    pendingWeights
  }
}

/** 顶点在当前目标组下的「预览权重」（含本笔 pending 增量；用于热力着色） */
function previewWeight(node: MeshNode, index: number): number {
  return previewWeightCore(weightCtx(), node, index, store.weightTarget)
}

/** 顶点权重热力着色对象（showWeights 开启时；挂 outer 组，局部坐标 = (v−origin)/16） */
function syncWeightOverlay(): void {
  const node = editingMesh.value
  syncWeightOverlayCore({
    visuals: subEdit,
    nodeObjects,
    enabled: gizmoMode.value === 'weight' && showWeights.value,
    node,
    colorOf: (i) => (node ? weightPreviewColor(previewWeight(node, i)) : [0, 0, 0])
  })
}

/**
 * 拾取目标 mesh 表面在**父空间**的交点（raycast → worldToLocal → ×16 + origin）。
 * 与切刀拾取同源，但只返回点（权重笔刷不需要面下标）。
 */
function pickMeshModelPoint(clientX: number, clientY: number): Vec3 | null {
  return pickMeshModelPointCore(pickCtx(), editingMesh.value, clientX, clientY)
}

/**
 * 落墨一笔（算法实现见 viewport/weightPaint.ts）：累积进 pendingWeights，
 * 随后刷新热力预览。整笔在 pointerup 时一次性提交为单条命令。
 */
function stampWeights(center: Vec3): void {
  const node = editingMesh.value
  if (!node || !store.weightTarget) return
  const ctx = weightCtx()
  const touched = stampWeightsCore(ctx, node, store.weightTarget, center)
  pendingWeights = ctx.pendingWeights // 算法内可能新建 Map，回写宿主变量
  if (touched) syncWeightOverlay()
}

/** 权重笔画按下：起笔 + 首笔落墨 */
function onWeightPointerDown(e: PointerEvent): boolean {
  if (!weightEnabled()) return false
  const p = pickMeshModelPoint(e.clientX, e.clientY)
  if (!p) return false
  pendingWeights = null
  stampWeights(p)
  lastWeightAt = { x: e.clientX, y: e.clientY }
  return true
}

/** 权重笔画移动：连续落墨（按像素位移节流） */
function onWeightPointerMove(e: PointerEvent): void {
  if (!pendingWeights) return
  const r = throttledWeightSample(lastWeightAt, e.clientX, e.clientY)
  if (!r.sample) return
  const p = pickMeshModelPoint(e.clientX, e.clientY)
  if (!p) return
  lastWeightAt = r.last
  stampWeights(p)
}

/** 权重笔画抬起：把本笔累积一次性提交为单条命令（无落墨则丢弃） */
function onWeightPointerUp(): void {
  window.removeEventListener('pointermove', onWeightPointerMove)
  const pending = pendingWeights
  pendingWeights = null
  lastWeightAt = null
  const target = store.weightTarget
  if (!pending || pending.size === 0 || !target) {
    syncWeightOverlay()
    return
  }
  const entries = [...pending.entries()].map(([index, amount]) => ({ index, amount }))
  store.paintWeights({ groupId: target, mode: weightMode.value, entries })
  syncWeightOverlay()
}

/* ------------------------------------------------------------------ */
/* 相机                                                                */
/* ------------------------------------------------------------------ */

function fitCamera(): void {
  if (!camera || !orbit) return
  const box = new THREE.Box3()
  const d = store.doc
  const b = d ? documentAabb(d) : null
  if (b) {
    box.min.set(b.min[0] / 16 - 0.5, b.min[1] / 16 - 0.5, b.min[2] / 16 - 0.5)
    box.max.set(b.max[0] / 16 - 0.5, b.max[1] / 16 - 0.5, b.max[2] / 16 - 0.5)
  } else {
    box.min.set(-0.5, -0.5, -0.5)
    box.max.set(0.5, 0.5, 0.5)
  }
  const { target, distance } = fitView(box, camera.fov)
  orbit.target.copy(target)
  camera.position.copy(target).addScaledVector(VIEW_DIR, distance)
  orbit.update()
}

function resetView(): void {
  needFit = true
}

/** 导出视口截图（B3-1）：canvas.toDataURL → 弹保存框落盘 PNG */
async function onExportScreenshot(): Promise<void> {
  const canvas = canvasRef.value
  if (!canvas) return
  const dataUrl = canvas.toDataURL('image/png')
  const name = store.doc ? `${store.doc.name}_视口截图` : '视口截图'
  const res = await window.api.modeler.exportTexturePng('', { name, dataUrl })
  if (res.error) {
    console.error('截图导出失败', res.error)
  }
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

function init(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  } catch {
    failed.value = true
    return
  }
  const w = canvas.clientWidth || 320
  const h = canvas.clientHeight || 320
  renderer.setSize(w, h, false)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 50)
  camera.position.set(1.5, 1.2, 2.1)

  scene.add(new THREE.AmbientLight(0xffffff, 0.9))
  const dir = new THREE.DirectionalLight(0xffffff, 0.6)
  dir.position.set(2, 3, 2.5)
  scene.add(dir)

  orbit = new OrbitControls(camera, renderer.domElement)
  orbit.enableDamping = true
  orbit.dampingFactor = 0.2
  orbit.minDistance = 0.3
  orbit.maxDistance = 12

  // 多选变换代理（质心）
  multiProxy = new THREE.Group()
  multiProxy.name = 'modeler-multi-proxy'
  scene.add(multiProxy)

  // 骨骼空间 gizmo 代理（P3-d）：无几何体，仅承载位置/朝向
  boneProxy = new THREE.Object3D()
  boneProxy.name = 'modeler-bone-proxy'
  scene.add(boneProxy)

  tc = new TransformControls(camera, renderer.domElement)
  tc.setSize(0.9)
  scene.add(tc.getHelper())
  tc.addEventListener('dragging-changed', (event) => onDraggingChanged((event as { value: boolean }).value))
  tc.addEventListener('objectChange', () => onObjectChange())
  applySnaps()

  renderer.domElement.addEventListener('pointerdown', onPaintPointerDown, true) // capture：绘画模式屏蔽轨道左键
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPaintHover) // 绘画网格悬停（内部按开关过滤）
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerLeave)
  renderer.domElement.addEventListener('dblclick', onDblClick)
  window.addEventListener('keydown', onKeyDown)

  rebuildScene()
  fittedDocId = store.doc?.id ?? ''
  needFit = true

  resizeObs = new ResizeObserver(() => {
    if (!renderer || !camera || !canvas) return
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
    orbit?.update()
    if (needFit) {
      needFit = false
      fitCamera()
    }
    applyAnimationOverlay() // P4-d：动画姿态叠加（只改场景不写文档）
    if (renderer && scene && camera) renderer.render(scene, camera)
  }
  loop()
}

onMounted(init)

// 文档变化 → 优先消费 latestPatch 做节点级增量桥（D2a+D2b）；patch 缺失或不一致时全量重建
// 几何变更（from/to/vertices/faces 等）在 applyDocPatch 内部跳过纯变换快路径，
// 最终由不变式 nodeObjects.size === doc.nodes.size 检查触发 rebuildScene 兜底
watch(
  () => store.doc,
  () => {
    const patch = store.latestPatch
    store.latestPatch = null // 消费后置空
    if (patch && nodeObjects.size > 0) {
      applyDocPatch(patch)
    } else {
      rebuildScene()
    }
    const id = store.doc?.id ?? ''
    if (id !== fittedDocId) {
      fittedDocId = id
      needFit = true
    }
  }
)

// 参考图变化 → 只同步平面，不重建场景（B3-1）
watch(
  () => store.doc?.referenceImages,
  () => syncRefPlanes(),
  { deep: true }
)

// 选择变化 → 高亮 + gizmo 重挂 + 子对象可视化同步
watch(
  () => store.selection,
  () => {
    applyHighlights()
    syncSubEditVisuals()
    refreshGizmo()
  },
  { deep: true }
)

// 子对象编辑状态（B4-3）：模式切换 → 可视化 + gizmo；子选择变化 → 句柄配色/面叠加 + 质心重挂
watch(
  () => store.editMode,
  () => {
    if (store.editMode !== 'object' && tool.value === 'paint') tool.value = 'translate'
    syncSubEditVisuals()
    refreshGizmo()
  }
)
watch(
  () => [store.vertexSelection, store.faceSelection, store.edgeSelection, store.knifeAnchor],
  () => {
    syncSubEditVisuals()
    refreshGizmo()
  },
  { deep: true }
)

watch(tool, () => {
  refreshGizmo()
  if (tool.value !== 'paint') clearPaintGrid()
  syncWeightOverlay()
})
watch(snap, () => applySnaps())
watch(space, () => refreshGizmo())
watch(paintGrid, (on) => {
  if (!on) clearPaintGrid()
})
// 权重绘制：目标组 / 显示开关 / 编辑目标变化 → 重绘热力叠加
watch(
  () => [store.weightTarget, showWeights.value, store.meshEditTarget],
  () => {
    syncWeightOverlay()
    refreshGizmo()
  }
)

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  resizeObs?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  // 中断进行中的笔画（组件卸载时不提交半截笔迹）
  stroke = null
  window.removeEventListener('pointermove', onStrokeMove)
  window.removeEventListener('pointerup', onStrokeUp)
  const dom = renderer?.domElement
  dom?.removeEventListener('pointerdown', onPaintPointerDown, true)
  dom?.removeEventListener('pointerdown', onPointerDown)
  dom?.removeEventListener('pointermove', onPaintHover)
  dom?.removeEventListener('pointermove', onPointerMove)
  dom?.removeEventListener('pointerup', onPointerUp)
  dom?.removeEventListener('pointerleave', onPointerLeave)
  dom?.removeEventListener('dblclick', onDblClick)
  tc?.detach()
  tc?.dispose()
  orbit?.dispose()
  clearPaintGrid()
  clearSceneModel()
  clearRefPlanes()
  disposeAllTextures(texCacheCtx)
  renderer?.dispose()
})
</script>

<style scoped>
.mvw {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.mvw-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ky-border);
  flex-wrap: wrap;
}
.mvw-snap {
  height: 24px;
}
.mvw-editmode {
  margin-left: 4px;
  padding-left: 8px;
  border-left: 1px solid var(--ky-border);
}
.mvw-toolbar-label {
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.mvw-palette {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  width: 132px;
}
.mvw-palette-recent {
  width: 74px;
  border-left: 1px solid var(--ky-border);
  padding-left: 6px;
}
.mvw-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid var(--ky-border);
  padding: 0;
  cursor: pointer;
}
.mvw-swatch:hover {
  border-color: var(--ky-accent);
}
.mvw-brush {
  width: 52px;
}
.mvw-weight-group {
  width: 120px;
}
.mvw-opacity {
  width: 96px;
}
.mvw-status {
  margin-left: auto;
  font-size: 11px;
  color: var(--ky-text-dim);
}

.mvw-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.mvw-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.mvw-canvas.is-paint {
  cursor: crosshair;
}
.mvw-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  color: var(--ky-text-sub);
}
.mvw-readout {
  position: absolute;
  right: 10px;
  bottom: 26px;
  font-size: 11px;
  color: var(--ky-accent);
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  padding: 2px 8px;
  pointer-events: none;
}
.mvw-marquee {
  position: absolute;
  border: 1px solid var(--ky-accent);
  background: color-mix(in srgb, var(--ky-accent) 16%, transparent);
  pointer-events: none;
  z-index: 5;
}
.mvw-hint {
  position: absolute;
  left: 8px;
  bottom: 6px;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  pointer-events: none;
}
</style>
