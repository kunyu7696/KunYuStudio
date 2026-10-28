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
  cubeWorldCorners,
  documentAabb,
  rotateNodes,
  scaleNodes,
  translateNodes,
  worldPivotOf
} from '../../../../shared/modeler/transform'
import { ancestorRotationQuat, composeBoneLocalRotation } from '../../../../shared/modeler/quat'
import { effectiveSelection, patchNode, subtreeIds } from '../../../../shared/modeler/document'
import { isVisible } from '../../../../shared/modeler/query'
import { effectiveFaceBindings, rotateUvCorners } from '../../../../shared/modeler/uv'
import {
  buildMeshEdges,
  meshEdgeKey,
  meshWorldVertices,
  translateMeshVertices,
  triangulateFace
} from '../../../../shared/modeler/mesh'
import { sampleAnimation } from '../../../../shared/modeler/anim'
import { animationPlayer } from './core/animationPlayer'
import type { DocumentPatch } from '../../../../shared/modeler/commands'
import type { FaceName, MeshNode, ModelDocument, ModelNode, NodeId, TextureId, Vec2, Vec3 } from '../../../../shared/modeler/types'
import { isCubeNode, isGroupNode, isLocatorNode, isMeshNode } from '../../../../shared/modeler/types'
import { weightOf, weightPreviewColor } from '../../../../shared/modeler/weights'
import { fitView } from './preview/modelPreviewScene'

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

/** BoxGeometry materialIndex → 文档面名（+x,-x,+y,-y,+z,-z） */
const BOX_FACE_BY_INDEX: readonly FaceName[] = ['east', 'west', 'up', 'down', 'south', 'north']

/** BoxGeometry materialIndex → mesh 局部法线（绘画网格沿法线偏移防 z-fight） */
const BOX_FACE_NORMALS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
]

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
/** 顶点模式句柄（THREE.Points，挂目标 mesh 的 outer 组，随节点变换同步；B4-3） */
let vertexPoints: THREE.Points | null = null
/** 面模式选中面叠加（半透明三角面片；B4-3） */
let faceOverlay: THREE.Mesh | null = null
/** 边模式句柄（全边 LineSegments，顶点色标选中；v3 C1） */
let edgeLines: THREE.LineSegments | null = null
/** 切刀锚点标记（小球，首击点；v3 C2） */
let knifeMarker: THREE.Mesh | null = null
/** 选中高亮线框（挂在被选 cube mesh 上） */
let highlightLines: THREE.LineSegments[] = []

/* ---- 贴图缓存（跨重建复用；绘画直接在 canvas 上落笔） ---- */
interface TexEntry {
  id: TextureId
  w: number
  h: number
  /** 显示画布（烘焙结果，THREE.CanvasTexture 绑定） */
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  /** 已加载进 canvas 的 data URL（与文档一致时跳过重载，避免绘画提交后闪烁） */
  loadedData: string
  /** 绘画画布（多层模式 = 活动层像素；单层模式 = 与 canvas 同一对象） */
  paintCanvas: HTMLCanvasElement
  paintCtx: CanvasRenderingContext2D
  /** 绘画画布已加载的 data URL（活动层像素） */
  loadedPaintData: string
}
const texEntries = new Map<TextureId, TexEntry>()
/** 贴图 → 共享材质（同贴图多 cube 复用） */
const texMats = new Map<TextureId, THREE.MeshLambertMaterial>()

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

/** 卸载文档中已删除的贴图条目 */
function pruneTextures(): void {
  const d = store.doc
  const keep = new Set(d ? Object.keys(d.textures) : [])
  for (const [id, entry] of texEntries) {
    if (!keep.has(id)) {
      entry.tex.dispose()
      texEntries.delete(id)
    }
  }
}

function clearSceneModel(): void {
  clearPaintGrid()
  clearSubEditVisuals()
  for (const d of disposables) d.dispose()
  disposables = []
  for (const m of texMats.values()) m.dispose()
  texMats.clear()
  nodeObjects.clear()
  animOverlaid.clear()
  pickMeshes = []
  clearHighlights()
  pruneTextures()
  if (modelRoot) {
    modelRoot.parent?.remove(modelRoot)
    modelRoot = null
  }
  clearRefPlanes()
}

/* ------------------------------------------------------------------ */
/* D2 视口增量桥（节点级，依赖 DocumentPatch 粒度）                     */
/* ------------------------------------------------------------------ */

/**
 * 遍历 outer Group 子树，收集所有 nodeObject 的 nodeId（含自身）。
 * 用于 removedNodeIds 增量删除时发现后代（patch 只列顶层 id，后代需从旧 Object3D 找）。
 */
function collectDescendantNodeIds(outer: THREE.Object3D, out: Set<NodeId>): void {
  const id = outer.userData.nodeId as NodeId | undefined
  if (id) out.add(id)
  for (const child of outer.children) collectDescendantNodeIds(child, out)
}

/** dispose 单个 nodeObject 子树上所有独立几何/材质 */
function disposeNodeSubtree(outer: THREE.Object3D): void {
  outer.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (obj.geometry) {
        // 高亮线用 edgeGeo 共享 → 不 dispose；其他独立 geometry（如 mesh 网格高亮 EdgesGeometry）dispose
        const isHighlight = obj.geometry === edgeGeo
        if (!isHighlight) obj.geometry.dispose()
      }
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => m.dispose())
      } else if (obj.material) {
        obj.material.dispose()
      }
    }
  })
}

/**
 * 从场景删除指定节点及其后代（增量，无全量 rebuild）。
 * - 递归收集 descendants（three.js 子树 userData.nodeId）
 * - nodeObjects.delete / pickMeshes 过滤 / highlightLines 移除并 dispose / animOverlaid.delete
 * - Object3D.parent.remove + dispose 几何/材质
 */
function removeNodeObjects(ids: NodeId[]): void {
  if (ids.length === 0) return
  const topOuters: THREE.Object3D[] = [] /* 先存顶层 outer 引用，delete 后仍可 dispose */
  const all = new Set<NodeId>()
  for (const id of ids) {
    const outer = nodeObjects.get(id)
    if (!outer) continue
    topOuters.push(outer)
    collectDescendantNodeIds(outer, all)
  }
  if (all.size === 0) return

  /* 从各集合清除后代 id（nodeObjects.delete 必须在保存 outer 之后） */
  for (const id of all) nodeObjects.delete(id)
  pickMeshes = pickMeshes.filter((m) => !all.has((m.userData.nodeId as NodeId) ?? ''))
  for (const id of all) animOverlaid.delete(id)
  /* highlightLines：挂在目标 mesh 上的 LineSegments —— 遍历找 parent.userData.nodeId */
  highlightLines = highlightLines.filter((line) => {
    const parentId = line.parent?.userData.nodeId as NodeId | undefined
    if (parentId && all.has(parentId)) {
      line.parent?.remove(line)
      if (line.geometry !== edgeGeo) line.geometry.dispose()
      return false
    }
    return true
  })

  /* dispose 几何 + 从父级 detach（topOuters 是 delete 前的引用，不受影响） */
  for (const outer of topOuters) {
    disposeNodeSubtree(outer)
    outer.parent?.remove(outer)
  }
}

/**
 * 按拓扑序（父先子后）创建新节点的 Object3D 并挂到正确父级。
 * - 根节点挂 modelRoot
 * - 组内子节点挂父 outer 的 inner Group
 */
function addNewNodeObjects(newIds: NodeId[], d: ModelDocument): void {
  if (newIds.length === 0 || !modelRoot) return
  const byId = new Map<NodeId, ModelNode>()
  for (const id of newIds) {
    const n = d.nodes[id]
    if (n && !nodeObjects.has(id)) byId.set(id, n)
  }
  if (byId.size === 0) return

  /* 拓扑排序：父节点（不在 newIds 里的已存在节点，或在 newIds 里但 parent=null）优先 */
  const ordered: NodeId[] = []
  const added = new Set<NodeId>()
  const queue: NodeId[] = [...byId.keys()].sort((a, b) => {
    /* 先放 parent=null 的根节点（父不存在），再放 parent 在 nodeObjects 已存在的 */
    const na = byId.get(a)!
    const nb = byId.get(b)!
    const aIsRoot = na.parent === null || nodeObjects.has(na.parent!)
    const bIsRoot = nb.parent === null || nodeObjects.has(nb.parent!)
    if (aIsRoot !== bIsRoot) return aIsRoot ? -1 : 1
    return 0
  })
  while (queue.length > 0) {
    /* 挑一个 parent=null 或 parent 已在 ordered 里的 */
    let idx = queue.findIndex((id) => {
      const n = byId.get(id)!
      return n.parent === null || added.has(n.parent!) || !byId.has(n.parent!)
    })
    if (idx < 0) {
      /* 环或依赖未解 → 一次性全加兜底 */
      for (const id of queue) {
        ordered.push(id)
        added.add(id)
      }
      break
    }
    const id = queue.splice(idx, 1)[0]!
    ordered.push(id)
    added.add(id)
  }

  for (const id of ordered) {
    const node = byId.get(id)!
    const outer = buildNodeObject(d, node) /* 会写入 nodeObjects.set */
    const parentId = node.parent
    if (parentId === null || parentId === undefined) {
      modelRoot.add(outer)
    } else {
      const parentOuter = nodeObjects.get(parentId)
      if (!parentOuter) {
        /* 父级不存在（理论上不成立，文档树不变量保证 parent 存在）→ 兜底挂根 */
        modelRoot.add(outer)
      } else {
        if (isGroupNode(d.nodes[parentId])) {
          /* 组内子节点挂 inner Group（承载 T(−origin) 连续空间语义） */
          const inner = parentOuter.children.find((c) => c instanceof THREE.Group && c !== parentOuter)
          ;(inner ?? parentOuter).add(outer)
        } else {
          parentOuter.add(outer)
        }
      }
    }
  }
}

/** 把「纯变换 + 结构」DocumentPatch 增量应用到 three.js 场景树（D2a+D2b 合并入口） */
function applyDocPatch(patch: DocumentPatch): void {
  const d = store.doc
  if (!d) return

  /* D2b：removedNodeIds 增量删除（先删再加，避免子节点父级挂错） */
  if (patch.removedNodeIds && patch.removedNodeIds.length > 0) {
    removeNodeObjects(patch.removedNodeIds)
  }

  /* D2a：setNodes 中已有 id 只改变换 */
  const setNodes = patch.setNodes
  if (setNodes) {
    for (const [id, newNode] of Object.entries(setNodes)) {
      const obj = nodeObjects.get(id)
      if (!obj) continue /* 新节点留待下面 addNewNodeObjects */
      if (!isCubeNode(newNode) && !isMeshNode(newNode) && !isGroupNode(newNode) && !isLocatorNode(newNode)) continue
      /* 判断是否纯变换变更（不含几何/结构字段）——含则跳过让后续全量 rebuild 兜底 */
      const geoField = ['from', 'to', 'vertices', 'faces', 'children', 'parent', 'texture', 'uv', 'weights']
      const nodeAny = newNode as unknown as Record<string, unknown>
      if (geoField.some((k) => k in nodeAny)) continue

      obj.visible = newNode.visible
      if (isLocatorNode(newNode)) {
        obj.position.set(newNode.position[0] / 16, newNode.position[1] / 16, newNode.position[2] / 16)
      } else {
        obj.position.set(newNode.origin[0] / 16, newNode.origin[1] / 16, newNode.origin[2] / 16)
        obj.rotation.set(
          newNode.rotation[0] * DEG2RAD,
          newNode.rotation[1] * DEG2RAD,
          newNode.rotation[2] * DEG2RAD
        )
        if (isGroupNode(newNode)) {
          const s = (newNode as { scale?: [number, number, number] }).scale
          obj.scale.set(s?.[0] ?? 1, s?.[1] ?? 1, s?.[2] ?? 1)
          /* inner.position 承载 T(−origin) */
          const inner = obj.children.find((c) => c instanceof THREE.Group && c !== obj)
          if (inner) {
            ;(inner as THREE.Group).position.set(
              -newNode.origin[0] / 16,
              -newNode.origin[1] / 16,
              -newNode.origin[2] / 16
            )
          }
        }
      }
    }
  }

  /* D2b：新节点增量创建 */
  const newIds: NodeId[] = []
  if (setNodes) {
    for (const id of Object.keys(setNodes)) {
      if (!nodeObjects.has(id)) newIds.push(id)
    }
  }
  addNewNodeObjects(newIds, d)

  /* 不变式检查：nodeObjects.size 必须与文档节点数一致；否则立即 rebuildScene 兜底 */
  if (nodeObjects.size !== Object.keys(d.nodes).length) {
    console.warn('[D2] nodeObjects 与文档节点数不一致，fallback rebuildScene')
    rebuildScene()
    return
  }

  /* setRoot 根顺序变更：重排 modelRoot.children 与 doc.root 对齐 */
  if (patch.setRoot !== undefined && modelRoot) {
    const existingChildren = [...modelRoot.children]
    modelRoot.clear()
    for (const id of patch.setRoot) {
      const outer = nodeObjects.get(id)
      if (outer) modelRoot.add(outer)
    }
    /* 保留未在 setRoot 里但仍在 nodeObjects 里的根节点（理论上 setRoot 应覆盖全量，这里兜底） */
    for (const child of existingChildren) {
      if (!modelRoot.children.includes(child as THREE.Object3D)) modelRoot.add(child)
    }
  }

  applyHighlights()
  syncSubEditVisuals()
  refreshGizmo()
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

/** 权重热力叠加：目标 mesh 顶点着色 Points（显示影响分布；随 outer 组变换） */
let weightOverlay: THREE.Points | null = null
/** 本笔累积：顶点下标 → 落笔量（按 mode 语义累积）；抬起时一次性提交为单条命令 */
let pendingWeights: Map<number, number> | null = null
/** 上次落墨屏幕点（位移节流；笔画结束清空） */
let lastWeightAt: { x: number; y: number } | null = null

/** 释放并移除顶点句柄与面叠加（重建/切模式/切选中前调用） */
function clearSubEditVisuals(): void {
  if (vertexPoints) {
    vertexPoints.parent?.remove(vertexPoints)
    vertexPoints.geometry.dispose()
    ;(vertexPoints.material as THREE.Material).dispose()
    vertexPoints = null
  }
  if (faceOverlay) {
    faceOverlay.parent?.remove(faceOverlay)
    faceOverlay.geometry.dispose()
    ;(faceOverlay.material as THREE.Material).dispose()
    faceOverlay = null
  }
  if (edgeLines) {
    edgeLines.parent?.remove(edgeLines)
    edgeLines.geometry.dispose()
    ;(edgeLines.material as THREE.Material).dispose()
    edgeLines = null
  }
  if (knifeMarker) {
    knifeMarker.parent?.remove(knifeMarker)
    knifeMarker.geometry.dispose()
    ;(knifeMarker.material as THREE.Material).dispose()
    knifeMarker = null
  }
  if (weightOverlay) {
    weightOverlay.parent?.remove(weightOverlay)
    weightOverlay.geometry.dispose()
    ;(weightOverlay.material as THREE.Material).dispose()
    weightOverlay = null
  }
  pendingWeights = null
}

/** 边句柄：目标 mesh 全部唯一边 → THREE.LineSegments（选中边高亮；随节点 outer 组变换） */
function syncEdgeHandles(): void {
  if (edgeLines) {
    edgeLines.parent?.remove(edgeLines)
    edgeLines.geometry.dispose()
    ;(edgeLines.material as THREE.Material).dispose()
    edgeLines = null
  }
  if (store.editMode !== 'edge') return
  const id = store.meshEditTarget
  const node = id ? store.doc?.nodes[id] : undefined
  const outer = id ? nodeObjects.get(id) : undefined
  if (!node || !isMeshNode(node) || !outer) return
  const sel = new Set(store.edgeSelection)
  const cSel = new THREE.Color(SELECT_COLOR)
  const cNor = new THREE.Color(0x9aa3b2)
  const pos: number[] = []
  const col: number[] = []
  for (const e of buildMeshEdges(node)) {
    const va = node.vertices[e.a]!
    const vb = node.vertices[e.b]!
    pos.push(
      (va[0] - node.origin[0]) / 16, (va[1] - node.origin[1]) / 16, (va[2] - node.origin[2]) / 16,
      (vb[0] - node.origin[0]) / 16, (vb[1] - node.origin[1]) / 16, (vb[2] - node.origin[2]) / 16
    )
    const c = sel.has(meshEdgeKey(e.a, e.b)) ? cSel : cNor
    col.push(c.r, c.g, c.b, c.r, c.g, c.b)
  }
  if (pos.length === 0) return
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })
  edgeLines = new THREE.LineSegments(geo, mat)
  edgeLines.renderOrder = 1000
  outer.add(edgeLines)
}

/** 顶点句柄：目标 mesh 全部顶点 → THREE.Points（选中顶点高亮；随节点 outer 组变换） */
function syncVertexHandles(): void {
  if (vertexPoints) {
    vertexPoints.parent?.remove(vertexPoints)
    vertexPoints.geometry.dispose()
    ;(vertexPoints.material as THREE.Material).dispose()
    vertexPoints = null
  }
  if (store.editMode !== 'vertex') return
  const id = store.meshEditTarget
  const node = id ? store.doc?.nodes[id] : undefined
  const outer = id ? nodeObjects.get(id) : undefined
  if (!node || !isMeshNode(node) || !outer) return
  const sel = new Set(store.vertexSelection)
  const cSel = new THREE.Color(SELECT_COLOR)
  const cNor = new THREE.Color(0xf2f4f8)
  const pos: number[] = []
  const col: number[] = []
  node.vertices.forEach((v, i) => {
    pos.push((v[0] - node.origin[0]) / 16, (v[1] - node.origin[1]) / 16, (v[2] - node.origin[2]) / 16)
    const c = sel.has(i) ? cSel : cNor
    col.push(c.r, c.g, c.b)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({
    size: 0.045,
    vertexColors: true,
    sizeAttenuation: true,
    depthTest: false
  })
  vertexPoints = new THREE.Points(geo, mat)
  vertexPoints.renderOrder = 999
  outer.add(vertexPoints)
}

/** 选中面叠加：选中 MeshFace 三角化 → 半透明面片（polygonOffset 防 z-fight） */
function syncFaceOverlay(): void {
  if (faceOverlay) {
    faceOverlay.parent?.remove(faceOverlay)
    faceOverlay.geometry.dispose()
    ;(faceOverlay.material as THREE.Material).dispose()
    faceOverlay = null
  }
  if (store.editMode !== 'face') return
  const id = store.meshEditTarget
  const node = id ? store.doc?.nodes[id] : undefined
  const outer = id ? nodeObjects.get(id) : undefined
  if (!node || !isMeshNode(node) || !outer || store.faceSelection.length === 0) return
  const sel = new Set(store.faceSelection)
  const positions: number[] = []
  node.faces.forEach((face, fi) => {
    if (!sel.has(fi)) return
    for (const tri of triangulateFace(face)) {
      for (const slot of tri) {
        const v = node.vertices[face.vertices[slot]!]
        if (!v) continue
        positions.push((v[0] - node.origin[0]) / 16, (v[1] - node.origin[1]) / 16, (v[2] - node.origin[2]) / 16)
      }
    }
  })
  if (positions.length === 0) return
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.MeshBasicMaterial({
    color: SELECT_COLOR,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2
  })
  faceOverlay = new THREE.Mesh(geo, mat)
  faceOverlay.renderOrder = 998
  outer.add(faceOverlay)
}

/**
 * 切刀锚点标记：knife 模式且已定第一点时，在首击点处显示小球（随 outer 组变换）。
 * 局部坐标 = (父空间点 − origin)/16，与网格几何同系。
 */
function syncKnifeMarker(): void {
  if (knifeMarker) {
    knifeMarker.parent?.remove(knifeMarker)
    knifeMarker.geometry.dispose()
    ;(knifeMarker.material as THREE.Material).dispose()
    knifeMarker = null
  }
  const anchor = store.editMode === 'knife' ? store.knifeAnchor : null
  const id = store.meshEditTarget
  const node = id ? store.doc?.nodes[id] : undefined
  const outer = id ? nodeObjects.get(id) : undefined
  if (!anchor || !node || !isMeshNode(node) || !outer) return
  const geo = new THREE.SphereGeometry(0.06, 12, 8)
  const mat = new THREE.MeshBasicMaterial({ color: SELECT_COLOR, depthTest: false })
  knifeMarker = new THREE.Mesh(geo, mat)
  knifeMarker.position.set(
    (anchor.point[0] - node.origin[0]) / 16,
    (anchor.point[1] - node.origin[1]) / 16,
    (anchor.point[2] - node.origin[2]) / 16
  )
  knifeMarker.renderOrder = 1001
  outer.add(knifeMarker)
}

/** 顶点句柄 + 面叠加 + 边句柄 + 切刀标记 + 权重热力一并同步（选择/模式/文档变化后调用） */
function syncSubEditVisuals(): void {
  syncVertexHandles()
  syncFaceOverlay()
  syncEdgeHandles()
  syncKnifeMarker()
  syncWeightOverlay()
}

/** 确保贴图 canvas 条目存在且内容与文档一致（data 变化时异步重载） */
function ensureTextureEntry(tex: { id: TextureId; width: number; height: number; data: string }): TexEntry {
  let entry = texEntries.get(tex.id)
  if (!entry) {
    const canvas = document.createElement('canvas')
    canvas.width = tex.width
    canvas.height = tex.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建贴图画布上下文')
    const t = new THREE.CanvasTexture(canvas)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    entry = {
      id: tex.id,
      w: tex.width,
      h: tex.height,
      canvas,
      ctx,
      tex: t,
      loadedData: '',
      paintCanvas: canvas,
      paintCtx: ctx,
      loadedPaintData: ''
    }
    texEntries.set(tex.id, entry)
  }
  if (entry.loadedData !== tex.data) {
    const dataUrl = tex.data
    const img = new Image()
    img.onload = () => {
      entry.ctx.clearRect(0, 0, entry.w, entry.h)
      entry.ctx.drawImage(img, 0, 0, entry.w, entry.h)
      entry.loadedData = dataUrl
      entry.tex.needsUpdate = true
      // 多层模式下：显示画布更新后，绘画画布同步为活动层像素
      syncPaintCanvas(entry)
    }
    img.src = dataUrl
  }
  return entry
}

/** 多层模式下同步绘画画布为活动层像素（无层时绘画画布 = 显示画布） */
function syncPaintCanvas(entry: TexEntry): void {
  const d = store.doc
  if (!d) return
  const tex = d.textures[entry.id]
  if (!tex || !tex.layers || tex.layers.length === 0) {
    // 单层模式：绘画画布与显示画布同一对象
    entry.paintCanvas = entry.canvas
    entry.paintCtx = entry.ctx
    entry.loadedPaintData = entry.loadedData
    return
  }
  // 多层模式：绘画画布独立，加载活动层像素
  if (entry.paintCanvas === entry.canvas) {
    // 首次创建独立绘画画布
    const pc = document.createElement('canvas')
    pc.width = entry.w
    pc.height = entry.h
    const pctx = pc.getContext('2d')
    if (!pctx) return
    entry.paintCanvas = pc
    entry.paintCtx = pctx
  }
  const activeLayer = tex.layers.find((l) => l.id === store.activeLayerId) ?? tex.layers[0]
  if (!activeLayer) return
  if (entry.loadedPaintData === activeLayer.data) return
  const img = new Image()
  img.onload = () => {
    entry.paintCtx.clearRect(0, 0, entry.w, entry.h)
    entry.paintCtx.drawImage(img, 0, 0, entry.w, entry.h)
    entry.loadedPaintData = activeLayer.data
  }
  img.src = activeLayer.data
}

/** 共享贴图材质（须在 ensureTextureEntry 之后调用） */
function textureMaterial(texId: TextureId): THREE.MeshLambertMaterial | null {
  const cached = texMats.get(texId)
  if (cached) return cached
  const entry = texEntries.get(texId)
  if (!entry) return null
  const m = new THREE.MeshLambertMaterial({
    map: entry.tex,
    transparent: true,
    alphaTest: 0.02, // 仅剔除全透明像素，半透明像素正常渲染
    side: THREE.FrontSide
  })
  texMats.set(texId, m)
  return m
}

/** 文档节点 → 场景对象（含父子层级映射，见模块头注释） */
function buildNodeObject(d: ModelDocument, node: ModelNode): THREE.Object3D {
  const outer = new THREE.Group()
  outer.userData.nodeId = node.id
  outer.visible = node.visible
  nodeObjects.set(node.id, outer)

  if (isCubeNode(node)) {
    outer.position.set(node.origin[0] / 16, node.origin[1] / 16, node.origin[2] / 16)
    outer.rotation.set(
      node.rotation[0] * DEG2RAD,
      node.rotation[1] * DEG2RAD,
      node.rotation[2] * DEG2RAD
    )
    const mesh = buildCubeMesh(d, node)
    pickMeshes.push(mesh)
    outer.add(mesh)
  } else if (isMeshNode(node)) {
    outer.position.set(node.origin[0] / 16, node.origin[1] / 16, node.origin[2] / 16)
    outer.rotation.set(
      node.rotation[0] * DEG2RAD,
      node.rotation[1] * DEG2RAD,
      node.rotation[2] * DEG2RAD
    )
    for (const m of buildMeshMeshes(d, node)) {
      pickMeshes.push(m)
      outer.add(m)
    }
  } else if (isGroupNode(node)) {
    outer.position.set(node.origin[0] / 16, node.origin[1] / 16, node.origin[2] / 16)
    outer.rotation.set(
      node.rotation[0] * DEG2RAD,
      node.rotation[1] * DEG2RAD,
      node.rotation[2] * DEG2RAD
    )
    if (node.scale) outer.scale.set(node.scale[0], node.scale[1], node.scale[2])
    // inner 承担 T(−origin)，使子节点原始坐标直接映射（父链连续空间语义）
    const inner = new THREE.Group()
    inner.position.set(-node.origin[0] / 16, -node.origin[1] / 16, -node.origin[2] / 16)
    outer.add(inner)
    for (const cid of node.children) {
      const child = d.nodes[cid]
      if (child) inner.add(buildNodeObject(d, child))
    }
  } else if (isLocatorNode(node)) {
    outer.position.set(node.position[0] / 16, node.position[1] / 16, node.position[2] / 16)
    const marker = new THREE.Mesh(markerGeo!, markerMat!)
    marker.userData.nodeId = node.id
    pickMeshes.push(marker)
    outer.add(marker)
  }
  return outer
}

/**
 * 立方体 mesh：任一面绑定贴图 → per-cube 克隆 BoxGeometry 写 UV + 贴图材质数组；
 * 否则共享灰盒。UV 映射细节见模块头注释。
 */
function buildCubeMesh(d: ModelDocument, node: ModelNode & { type: 'cube' }): THREE.Mesh {
  const cx = (node.from[0] + node.to[0]) / 2
  const cy = (node.from[1] + node.to[1]) / 2
  const cz = (node.from[2] + node.to[2]) / 2
  const position: Vec3 = [
    (cx - node.origin[0]) / 16,
    (cy - node.origin[1]) / 16,
    (cz - node.origin[2]) / 16
  ]
  const scale: Vec3 = [
    Math.abs(node.to[0] - node.from[0]) / 16,
    Math.abs(node.to[1] - node.from[1]) / 16,
    Math.abs(node.to[2] - node.from[2]) / 16
  ]

  const resolved = effectiveFaceBindings(node, d.settings.uvMode)
  const usedTexIds = new Set<TextureId>()
  for (const b of Object.values(resolved)) {
    if (b?.texture && d.textures[b.texture]) usedTexIds.add(b.texture)
  }

  if (usedTexIds.size === 0) {
    const mesh = new THREE.Mesh(boxGeo!, cubeMat!)
    mesh.position.set(position[0], position[1], position[2])
    mesh.scale.set(scale[0], scale[1], scale[2])
    mesh.userData.nodeId = node.id
    return mesh
  }

  const geo = boxGeo!.clone()
  const uvAttr = geo.attributes.uv as THREE.BufferAttribute
  const faceMats: THREE.Material[] = []
  for (let fi = 0; fi < 6; fi++) {
    const faceName = BOX_FACE_BY_INDEX[fi]!
    const binding = resolved[faceName]
    const texId = binding?.texture && d.textures[binding.texture] ? binding.texture : null
    const texMeta = texId ? d.textures[texId] : undefined
    let corners: Vec2[] = [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0]
    ]
    if (texMeta && binding?.uv) {
      ensureTextureEntry(texMeta)
      corners = rotateUvCorners(binding.uv, binding.rotation ?? 0)
    }
    // corners = [TL, TR, BR, BL]（像素坐标，v 向下）；BoxGeometry 面内顶点序 [TL, TR, BL, BR]
    const order = [0, 1, 3, 2]
    for (let vi = 0; vi < 4; vi++) {
      const p = corners[order[vi]!]!
      uvAttr.setXY(fi * 4 + vi, texMeta ? p[0] / texMeta.width : 0, texMeta ? 1 - p[1] / texMeta.height : 0)
    }
    faceMats.push((texId ? textureMaterial(texId) : null) ?? cubeMat!)
  }
  uvAttr.needsUpdate = true

  const mesh = new THREE.Mesh(geo, faceMats)
  mesh.position.set(position[0], position[1], position[2])
  mesh.scale.set(scale[0], scale[1], scale[2])
  mesh.userData.nodeId = node.id
  disposables.push(geo)
  return mesh
}

/**
 * 网格节点 → 场景 mesh 列表（B4-1）：按贴图分组，每组一个 BufferGeometry
 * （非索引化逐三角写顶点，computeVertexNormals 得平直法线）。
 * 顶点以「相对 origin 的父空间坐标 /16」存储——外层 Group 已承载 origin/rotation，
 * 与立方体 mesh 的「单位盒 scale + 相对 origin 偏移」同构。
 * userData.triToFace（B4-3）：三角序号 → node.faces 面下标（面模式 raycast 回映射用）。
 */
function buildMeshMeshes(d: ModelDocument, node: MeshNode): THREE.Mesh[] {
  // 按贴图分组面下标（null = 无贴图灰面）
  const groups = new Map<TextureId | null, number[]>()
  node.faces.forEach((face, fi) => {
    const texId = face.texture && d.textures[face.texture] ? face.texture : null
    const list = groups.get(texId) ?? []
    list.push(fi)
    groups.set(texId, list)
  })

  const out: THREE.Mesh[] = []
  for (const [texId, faceIdxList] of groups) {
    const texMeta = texId ? d.textures[texId] : undefined
    if (texMeta) ensureTextureEntry(texMeta)
    const positions: number[] = []
    const uvs: number[] = []
    const triToFace: number[] = []
    for (const fi of faceIdxList) {
      const face = node.faces[fi]!
      for (const tri of triangulateFace(face)) {
        triToFace.push(fi)
        for (const slot of tri) {
          const vi = face.vertices[slot]!
          const v = node.vertices[vi]
          if (!v) continue // 越界下标由文档校验报告，渲染层静默跳过
          positions.push(
            (v[0] - node.origin[0]) / 16,
            (v[1] - node.origin[1]) / 16,
            (v[2] - node.origin[2]) / 16
          )
          const uv = face.uv[slot]
          if (texMeta && uv) {
            uvs.push(uv[0] / texMeta.width, 1 - uv[1] / texMeta.height)
          } else {
            uvs.push(0, 0)
          }
        }
      }
    }
    if (positions.length === 0) continue
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.computeVertexNormals()
    const mat = (texId ? textureMaterial(texId) : null) ?? cubeMat!
    const mesh = new THREE.Mesh(geo, mat)
    mesh.userData.nodeId = node.id
    mesh.userData.triToFace = triToFace
    disposables.push(geo)
    out.push(mesh)
  }
  return out
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
const ndc = new THREE.Vector2()
let downX = 0
let downY = 0

/** 节点自身或任一祖先被锁定 = 有效锁定（禁止视口变换） */
function isEffectivelyLocked(d: ModelDocument, id: NodeId): boolean {
  let cur: string | null = id
  let guard = 0
  while (cur && guard++ < 256) {
    const node: ModelNode | undefined = d.nodes[cur]
    if (!node) return false
    if (node.locked) return true
    cur = node.parent
  }
  return false
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
  const canvas = canvasRef.value
  if (!canvas || !camera) return null
  const rect = canvas.getBoundingClientRect()
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObjects(pickMeshes, false)
  const hit = hits.find((h) => isChainVisible(h.object))
  return hit ? (hit.object.userData.nodeId as NodeId) : null
}

/** 顶点模式拾取（B4-3）：raycast 顶点句柄 Points → 顶点下标 */
function pickVertexAt(clientX: number, clientY: number): number | null {
  const canvas = canvasRef.value
  if (!canvas || !camera || !vertexPoints) return null
  const rect = canvas.getBoundingClientRect()
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObject(vertexPoints, false)
  const idx = hits[0]?.index
  return idx === undefined ? null : idx
}

/**
 * 面模式拾取（B4-3）：raycast 目标 mesh 的分组网格 → 三角序号
 * 经 userData.triToFace 回映射为 node.faces 面下标。
 */
function pickMeshFaceAt(clientX: number, clientY: number): number | null {
  const canvas = canvasRef.value
  if (!canvas || !camera) return null
  const id = store.meshEditTarget
  const outer = id ? nodeObjects.get(id) : undefined
  if (!outer) return null
  const rect = canvas.getBoundingClientRect()
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  const meshes = outer.children.filter(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && c !== faceOverlay && c !== knifeMarker
  )
  const hits = raycaster.intersectObjects(meshes, false)
  const hit = hits.find((h) => h.faceIndex !== undefined)
  if (!hit || hit.faceIndex == null) return null
  const map = hit.object.userData.triToFace as number[] | undefined
  return map?.[hit.faceIndex] ?? null
}

/**
 * 切刀拾取（v3 C2）：raycast 目标 mesh → { 面下标, 父空间交点坐标 }。
 * 父空间换算：outer.worldToLocal(世界交点) 得 (v−origin)/16，乘 16 再加回 origin。
 */
function pickMeshSurfaceAt(clientX: number, clientY: number): { face: number; point: Vec3 } | null {
  const canvas = canvasRef.value
  if (!canvas || !camera) return null
  const id = store.meshEditTarget
  const node = id ? store.doc?.nodes[id] : undefined
  const outer = id ? nodeObjects.get(id) : undefined
  if (!node || !isMeshNode(node) || !outer) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  outer.updateWorldMatrix(true, false)
  const meshes = outer.children.filter(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && c !== faceOverlay && c !== knifeMarker
  )
  const hit = raycaster.intersectObjects(meshes, false).find((h) => h.faceIndex !== undefined)
  if (!hit || hit.faceIndex == null) return null
  const face = (hit.object.userData.triToFace as number[] | undefined)?.[hit.faceIndex] ?? null
  if (face === null) return null
  const local = outer.worldToLocal(hit.point.clone())
  return {
    face,
    point: [
      local.x * 16 + node.origin[0],
      local.y * 16 + node.origin[1],
      local.z * 16 + node.origin[2]
    ]
  }
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
  const minX = Math.min(rect.x1, rect.x2)
  const maxX = Math.max(rect.x1, rect.x2)
  const minY = Math.min(rect.y1, rect.y2)
  const maxY = Math.max(rect.y1, rect.y2)
  const v = new THREE.Vector3()
  const hitIds: NodeId[] = []

  for (const node of Object.values(d.nodes)) {
    if (!isVisible(d, node.id) || isEffectivelyLocked(d, node.id)) continue
    let hit = false
    for (const nid of subtreeIds(d, node.id)) {
      const n = d.nodes[nid]
      if (!n) continue
      const pts: Vec3[] = []
      if (isCubeNode(n)) pts.push(...cubeWorldCorners(d, n))
      else if (isMeshNode(n)) pts.push(...meshWorldVertices(d, n))
      else if (isLocatorNode(n)) pts.push(worldPivotOf(d, nid))
      for (const p of pts) {
        v.set(p[0] / 16 - 0.5, p[1] / 16 - 0.5, p[2] / 16 - 0.5)
        v.project(camera)
        if (v.z < -1 || v.z > 1) continue // 相机后方
        const px = ((v.x + 1) / 2) * stageRect.width
        const py = ((1 - v.y) / 2) * stageRect.height
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          hit = true
          break
        }
      }
      if (hit) break
    }
    if (hit) hitIds.push(node.id)
  }

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

/** 对象链可见性（Raycaster 不按 visible 过滤，需手动检查） */
function isChainVisible(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    if (!cur.visible) return false
    cur = cur.parent
  }
  return true
}

/* ------------------------------------------------------------------ */
/* 绘画（paint 工具）                                                   */
/* ------------------------------------------------------------------ */

interface FaceHit {
  nodeId: NodeId
  /** 立方体面名（mesh 面为 null，改用 faceKey） */
  face: FaceName | null
  /** 面标识键（cube:北 / mesh:3 等）：跨面断线判定用（mesh 无 FaceName） */
  faceKey: string
  texId: TextureId | null
  /** 命中像素（贴图坐标，已 clamp） */
  px: Vec2
  /** 命中 mesh 与几何面索引（cube = materialIndex，mesh = 三角形下标） */
  mesh: THREE.Mesh
  faceIndex: number
}

interface StrokeState {
  texId: TextureId
  entry: TexEntry
  startPx: Vec2
  lastPx: Vec2
  lastFaceKey: string
  /** Shift 直线模式：move 时从快照重画 start→cur */
  shiftLine: boolean
  snapshot: ImageData
  /** 本笔画已落像素（防止重复合成加深） */
  painted: Set<string>
  changed: boolean
}

let stroke: StrokeState | null = null

function paintEnabled(): boolean {
  return tool.value === 'paint' && !!store.doc
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
  stroke = {
    texId: hit.texId,
    entry,
    startPx: hit.px,
    lastPx: hit.px,
    lastFaceKey: hit.faceKey,
    shiftLine: e.shiftKey,
    snapshot: entry.paintCtx.getImageData(0, 0, entry.w, entry.h),
    painted: new Set(),
    changed: false
  }
  if (paintTool.value !== 'eraser') noteRecentColor(paintColor.value)
  if (stroke.shiftLine) strokeLine(stroke, stroke.startPx, hit.px)
  else stampAt(stroke, hit.px[0], hit.px[1])
  window.addEventListener('pointermove', onStrokeMove)
  window.addEventListener('pointerup', onStrokeUp, { once: true })
}

/**
 * 射线拾取表面命中 → 贴图 + 命中像素（v3 C3b 起同时支持 cube 与 mesh）。
 * - cube：materialIndex 推面名，贴图取有效绑定；
 * - mesh：几何三角形下标经 userData.triToFace 推网格面下标，贴图取 face.texture；
 * - 命中像素统一由命中 uv 反推（视口 uv = (u/w, 1 − v/h)，两体系一致）。
 */
function pickFaceAt(clientX: number, clientY: number): FaceHit | null {
  const canvas = canvasRef.value
  const d = store.doc
  if (!canvas || !camera || !d) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  const hits = raycaster.intersectObjects(pickMeshes, false)
  const hit = hits.find((h) => isChainVisible(h.object) && h.face && h.uv)
  if (!hit || !hit.face || !hit.uv) return null
  const nodeId = hit.object.userData.nodeId as NodeId
  const node = d.nodes[nodeId]
  if (!node) return null
  const mesh = hit.object as THREE.Mesh

  let texId: TextureId | null = null
  let faceKey: string
  let cubeFace: FaceName | null = null
  let faceIndex: number
  if (isCubeNode(node)) {
    cubeFace = BOX_FACE_BY_INDEX[hit.face.materialIndex] ?? null
    if (!cubeFace) return null
    faceKey = `cube:${cubeFace}`
    faceIndex = hit.face.materialIndex // 几何面下标 0..5（绘画网格按面 4 顶点定位）
    texId = effectiveFaceBindings(node, d.settings.uvMode)[cubeFace]?.texture ?? null
  } else if (isMeshNode(node)) {
    const triToFace = mesh.userData.triToFace as number[] | undefined
    const fi = triToFace ? triToFace[hit.faceIndex!] : undefined
    if (fi === undefined) return null
    const face = node.faces[fi]
    if (!face) return null
    faceKey = `mesh:${fi}`
    faceIndex = hit.faceIndex! // 三角形下标（网格面全三角化，无固定 4 顶点布局）
    texId = face.texture && d.textures[face.texture] ? face.texture : null
  } else {
    return null
  }

  const texMeta = texId ? d.textures[texId] : undefined
  if (!texMeta) {
    return { nodeId, face: cubeFace, faceKey, texId: null, px: [0, 0], mesh, faceIndex }
  }
  const px: Vec2 = [
    Math.min(texMeta.width - 1, Math.max(0, Math.floor(hit.uv.x * texMeta.width))),
    Math.min(texMeta.height - 1, Math.max(0, Math.floor((1 - hit.uv.y) * texMeta.height)))
  ]
  return { nodeId, face: cubeFace, faceKey, texId, px, mesh, faceIndex }
}

/**
 * 方形笔刷落笔：源覆盖合成（globalAlpha fillRect；橡皮为 destination-out 擦除），
 * 同笔画内同像素不重复画；镜像开关把落点扩展到贴图对侧；锁 alpha 跳过全透明像素。
 */
function stampAt(s: StrokeState, cx: number, cy: number): void {
  const half = Math.floor(brushSize.value / 2)
  const ctx = s.entry.paintCtx
  const erasing = paintTool.value === 'eraser'
  ctx.globalAlpha = paintOpacity.value / 100
  ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
  ctx.fillStyle = erasing ? '#000000' : paintColor.value
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      stampTexel(s, cx + dx, cy + dy)
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  s.entry.tex.needsUpdate = true
}

/** 单 texel 落笔（含镜像扩展与锁 alpha 判定） */
function stampTexel(s: StrokeState, x: number, y: number): void {
  const w = s.entry.w
  const h = s.entry.h
  const pts: [number, number][] = [[x, y]]
  if (mirrorX.value) pts.push([w - 1 - x, y])
  if (mirrorY.value) pts.push([x, h - 1 - y])
  if (mirrorX.value && mirrorY.value) pts.push([w - 1 - x, h - 1 - y])
  for (const [px, py] of pts) {
    if (px < 0 || py < 0 || px >= w || py >= h) continue
    const key = `${px},${py}`
    if (s.painted.has(key)) continue
    if (lockAlpha.value && paintTool.value !== 'eraser') {
      if (s.entry.paintCtx.getImageData(px, py, 1, 1).data[3] === 0) continue
    }
    s.painted.add(key)
    s.entry.paintCtx.fillRect(px, py, 1, 1)
    s.changed = true
  }
}

/** 笔画结束/油漆桶落定提交：活动层像素 → 烘焙 → 写回文档（一次动作一条命令，可撤销） */
function commitEntryPaint(texId: TextureId, entry: TexEntry): void {
  const dataUrl = entry.paintCanvas.toDataURL('image/png')
  entry.loadedPaintData = dataUrl // 绘画画布已是最终态，标记避免重载闪烁
  void store.applyPaintStroke(texId, dataUrl)
}

/**
 * 油漆桶：4-连通域精确匹配种子色 → 源覆盖填充（橡皮桶 = 区域擦除）。
 * 镜像开关扩展填充集；锁 alpha 时全透明像素不参与；无变化不提交。
 */
function bucketFillAt(hit: FaceHit, entry: TexEntry): void {
  const w = entry.w
  const h = entry.h
  const img = entry.paintCtx.getImageData(0, 0, w, h)
  const data = img.data
  const [sx, sy] = hit.px
  const si = (sy * w + sx) * 4
  const seed = [data[si]!, data[si + 1]!, data[si + 2]!, data[si + 3]!] as const
  if (lockAlpha.value && seed[3] === 0) return

  // 连通域收集（BFS，精确 RGBA 匹配）
  const region = new Set<number>()
  const queue = [sy * w + sx]
  region.add(queue[0]!)
  while (queue.length > 0) {
    const cur = queue.pop()!
    const cx = cur % w
    const cy = Math.floor(cur / w)
    for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (region.has(ni)) continue
      const o = ni * 4
      if (data[o] !== seed[0] || data[o + 1] !== seed[1] || data[o + 2] !== seed[2] || data[o + 3] !== seed[3]) continue
      region.add(ni)
      queue.push(ni)
    }
  }

  // 镜像扩展为应用集
  const applySet = new Set<number>(region)
  if (mirrorX.value || mirrorY.value) {
    for (const idx of region) {
      const cx = idx % w
      const cy = Math.floor(idx / w)
      if (mirrorX.value) applySet.add(cy * w + (w - 1 - cx))
      if (mirrorY.value) applySet.add((h - 1 - cy) * w + cx)
      if (mirrorX.value && mirrorY.value) applySet.add((h - 1 - cy) * w + (w - 1 - cx))
    }
  }

  const erasing = paintTool.value === 'eraser'
  const opacity = paintOpacity.value / 100
  const fr = parseInt(paintColor.value.slice(1, 3), 16)
  const fg = parseInt(paintColor.value.slice(3, 5), 16)
  const fb = parseInt(paintColor.value.slice(5, 7), 16)
  let changed = false
  for (const idx of applySet) {
    const o = idx * 4
    const ba = data[o + 3]! / 255
    if (lockAlpha.value && data[o + 3] === 0) continue
    if (erasing) {
      const outA = Math.round(data[o + 3]! * (1 - opacity))
      if (outA === data[o + 3]) continue
      data[o + 3] = outA
      changed = true
      continue
    }
    const outA = opacity + ba * (1 - opacity)
    const nr = outA > 0 ? Math.round((fr * opacity + data[o]! * ba * (1 - opacity)) / outA) : 0
    const ng = outA > 0 ? Math.round((fg * opacity + data[o + 1]! * ba * (1 - opacity)) / outA) : 0
    const nb = outA > 0 ? Math.round((fb * opacity + data[o + 2]! * ba * (1 - opacity)) / outA) : 0
    const na = Math.round(outA * 255)
    if (nr === data[o] && ng === data[o + 1] && nb === data[o + 2] && na === data[o + 3]) continue
    data[o] = nr
    data[o + 1] = ng
    data[o + 2] = nb
    data[o + 3] = na
    changed = true
  }
  if (!changed) return
  entry.paintCtx.putImageData(img, 0, 0)
  entry.tex.needsUpdate = true
  if (!erasing) noteRecentColor(paintColor.value)
  commitEntryPaint(hit.texId!, entry)
}

/** Bresenham 线段落笔（连续笔画插值） */
function strokeLine(s: StrokeState, from: Vec2, to: Vec2): void {
  let [x0, y0] = from
  const [x1, y1] = to
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    stampAt(s, x0, y0)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
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
 * 悬停更新网格：取命中面 UV 矩形像素数 w×h，从 mesh 几何位置属性读该面
 * 4 顶点（面内序 [TL,TR,BL,BR]）双线性插值生成 (w+1)+(h+1) 条边界线，
 * 挂为 mesh 子对象（继承全部变换），沿法线微移防 z-fight。
 * 同一面重复悬停不重建（key 判定）；笔画进行中冻结网格。
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
  const corners = rotateUvCorners(binding.uv, binding.rotation ?? 0) // [TL,TR,BR,BL] 像素坐标
  const w = Math.max(1, Math.round(Math.hypot(corners[1]![0] - corners[0]![0], corners[1]![1] - corners[0]![1])))
  const h = Math.max(1, Math.round(Math.hypot(corners[3]![0] - corners[0]![0], corners[3]![1] - corners[0]![1])))
  const key = `${hit.nodeId}:${hit.faceIndex}:${w}x${h}`
  if (key === paintGridKey) return

  const posAttr = hit.mesh.geometry.attributes.position as THREE.BufferAttribute
  const base = hit.faceIndex * 4
  const vert = (i: number): [number, number, number] => [
    posAttr.getX(base + i),
    posAttr.getY(base + i),
    posAttr.getZ(base + i)
  ]
  const vTL = vert(0)
  const vTR = vert(1)
  const vBL = vert(2)
  const vBR = vert(3)
  const n = BOX_FACE_NORMALS[hit.faceIndex]!
  const OFF = 0.006 // 局部单位偏移（随 mesh scale 缩放）
  const pointAt = (s: number, t: number): [number, number, number] => [
    (1 - t) * ((1 - s) * vTL[0] + s * vTR[0]) + t * ((1 - s) * vBL[0] + s * vBR[0]) + n[0]! * OFF,
    (1 - t) * ((1 - s) * vTL[1] + s * vTR[1]) + t * ((1 - s) * vBL[1] + s * vBR[1]) + n[1]! * OFF,
    (1 - t) * ((1 - s) * vTL[2] + s * vTR[2]) + t * ((1 - s) * vBL[2] + s * vBR[2]) + n[2]! * OFF
  ]
  const pts: number[] = []
  for (let i = 0; i <= w; i++) {
    const s = i / w
    pts.push(...pointAt(s, 0), ...pointAt(s, 1))
  }
  for (let j = 0; j <= h; j++) {
    const t = j / h
    pts.push(...pointAt(0, t), ...pointAt(1, t))
  }

  clearPaintGrid()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  })
  paintGridObj = new THREE.LineSegments(geo, mat)
  paintGridObj.renderOrder = 2
  hit.mesh.add(paintGridObj)
  paintGridKey = key
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

/** 顶点在当前目标组下的「预览权重」（含本笔 pending 增量；用于热力着色） */
function previewWeight(node: MeshNode, index: number): number {
  const target = store.weightTarget
  const base = target ? weightOf(node.weights?.[index], target) : 0
  const pending = pendingWeights?.get(index)
  if (pending === undefined) return base
  if (weightMode.value === 'replace') return pending
  if (weightMode.value === 'subtract') return Math.max(0, base - pending)
  return Math.min(1, base + pending)
}

/** 顶点权重热力着色对象（showWeights 开启时；挂 outer 组，局部坐标 = (v−origin)/16） */
function syncWeightOverlay(): void {
  if (weightOverlay) {
    weightOverlay.parent?.remove(weightOverlay)
    weightOverlay.geometry.dispose()
    ;(weightOverlay.material as THREE.Material).dispose()
    weightOverlay = null
  }
  if (gizmoMode.value !== 'weight' || !showWeights.value) return
  const node = editingMesh.value
  const outer = node ? nodeObjects.get(node.id) : undefined
  if (!node || !outer) return
  const pos: number[] = []
  const col: number[] = []
  for (let i = 0; i < node.vertices.length; i++) {
    const v = node.vertices[i]!
    pos.push(
      (v[0] - node.origin[0]) / 16,
      (v[1] - node.origin[1]) / 16,
      (v[2] - node.origin[2]) / 16
    )
    const [r, g, b] = weightPreviewColor(previewWeight(node, i))
    col.push(r, g, b)
  }
  if (pos.length === 0) return
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({
    size: 0.14,
    sizeAttenuation: true,
    vertexColors: true,
    depthTest: false,
    transparent: true,
    opacity: 0.95
  })
  weightOverlay = new THREE.Points(geo, mat)
  weightOverlay.renderOrder = 1002
  outer.add(weightOverlay)
}

/**
 * 拾取目标 mesh 表面在**父空间**的交点（raycast → worldToLocal → ×16 + origin）。
 * 与切刀拾取同源，但只返回点（权重笔刷不需要面下标）。
 */
function pickMeshModelPoint(clientX: number, clientY: number): Vec3 | null {
  const canvas = canvasRef.value
  if (!canvas || !camera) return null
  const node = editingMesh.value
  const outer = node ? nodeObjects.get(node.id) : undefined
  if (!node || !outer) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(ndc, camera)
  outer.updateWorldMatrix(true, false)
  const excluded = new Set<THREE.Object3D>()
  if (faceOverlay) excluded.add(faceOverlay)
  if (knifeMarker) excluded.add(knifeMarker)
  if (weightOverlay) excluded.add(weightOverlay)
  const meshes = outer.children.filter(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && !excluded.has(c)
  )
  const hit = raycaster.intersectObjects(meshes, false).find((h) => h.faceIndex !== undefined)
  if (!hit) return null
  const local = outer.worldToLocal(hit.point.clone())
  return [local.x * 16 + node.origin[0], local.y * 16 + node.origin[1], local.z * 16 + node.origin[2]]
}

/**
 * 落墨一笔（累积，不立即提交）：以模型空间球半径筛选目标顶点，按 1−d/r 线性衰减
 * 算出逐顶点量，按 mode 语义累积进 pendingWeights（add/subtract 累加饱和、replace 取大），
 * 随后刷新热力预览。整笔在 pointerup 时一次性提交为单条命令。
 */
function stampWeights(center: Vec3): void {
  const node = editingMesh.value
  if (!node || !store.weightTarget) return
  const r = Math.max(0.5, weightRadius.value)
  const strength = Math.max(0.01, Math.min(1, weightStrength.value / 100))
  if (!pendingWeights) pendingWeights = new Map()
  let touched = false
  for (let i = 0; i < node.vertices.length; i++) {
    const v = node.vertices[i]!
    const dist = Math.hypot(v[0] - center[0], v[1] - center[1], v[2] - center[2])
    if (dist > r) continue
    const amount = strength * (1 - dist / r)
    const prev = pendingWeights.get(i) ?? 0
    pendingWeights.set(i, weightMode.value === 'replace' ? Math.max(prev, amount) : Math.min(1, prev + amount))
    touched = true
  }
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
  if (lastWeightAt && Math.hypot(e.clientX - lastWeightAt.x, e.clientY - lastWeightAt.y) < 3) return
  const p = pickMeshModelPoint(e.clientX, e.clientY)
  if (!p) return
  lastWeightAt = { x: e.clientX, y: e.clientY }
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
  for (const entry of texEntries.values()) entry.tex.dispose()
  texEntries.clear()
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
