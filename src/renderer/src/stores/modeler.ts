/**
 * useModelerStore：模型工坊文档状态（建模器通用化重建 P0，方案 §4.2/§4.3）。
 *
 * - 文档源文件：项目内 .kunyu/modeler/<id>.json（fs 通用通道读写，writeFile 自带建目录）；
 * - 撤销栈：shared/modeler/commands 的 CommandStack（不持有文档，undo/redo 由本 store
 *   执行补丁并恢复选择）；revision 依赖用 bumpRev 计数器驱动 dirty/canUndo 响应式；
 * - 所有编辑经 execute()：shared 纯函数变换 → diffDocument 生成命令 → 入栈；
 * - 选择恒为 NodeId[]（不存数组下标）；空文档时编辑动作 no-op。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectStore } from './project'
import {
  CommandStack,
  applyCommand,
  commandFromTransform,
  revertCommand,
  type DocumentPatch
} from '../../../shared/modeler/commands'
import {
  addNode,
  addTexture,
  createCubeNode,
  createDocument,
  createGroupNode,
  createLocatorNode,
  createMeshNode,
  deserializeDocument,
  patchNode,
  patchTexture,
  removeNodes,
  removeTexture,
  renameNode,
  serializeDocument,
  setTextureAnimation,
  uid
} from '../../../shared/modeler/document'
import {
  defaultMeshGeometry,
  findEdgeRing,
  knifeCutPlane,
  loopCutMesh,
  meshEdgeKey,
  parseMeshEdgeKey,
  removeMeshFaces,
  sliceMeshByPlane
} from '../../../shared/modeler/mesh'
import { growVertexWeights, paintVertexWeights } from '../../../shared/modeler/weights'
import type { WeightStroke } from '../../../shared/modeler/weights'
import { computeModelerRevision } from '../../../shared/modeler/revision'
import { autoFaceUv, cubeSize } from '../../../shared/modeler/uv'
import { getControllers } from '../../../shared/modeler/controller'
import { documentToAnimations, mergeAnimationsIntoDocument } from '../../../shared/modeler/formats/bedrockAnim'
import { documentToAnimationControllers, mergeControllerIntoDocument } from '../../../shared/modeler/formats/bedrockController'
import { bbmodelToDocument, documentToBbmodel } from '../../../shared/modeler/formats/bbmodel'
import { documentToGltf } from '../../../shared/modeler/formats/gltf'
import { gltfToDocument } from '../../../shared/modeler/formats/gltf'
import { documentToJem, documentToJpm, jemToDocument, jpmToDocument } from '../../../shared/modeler/formats/optifine'
import { documentToSkin, skinToDocument } from '../../../shared/modeler/formats/skin'
import type { SkinFormatData } from '../../../shared/modeler/formats/skin'
import type { FormatImportResult } from '../../../shared/modeler/formats/types'
import { objToDocument, documentToObj } from '../../../shared/modeler/formats/obj'
import { daeToDocument } from '../../../shared/modeler/formats/dae'
import { fbxTextToDocument } from '../../../shared/modeler/formats/fbx'
import { geoToDocument, documentToGeo, modelAssetToDocument } from '../../../shared/modeler/formats'
import { embeddedCubeOf, modelAssetFromEmbedded } from '../../../shared/utils/cubeModelAsset'
import { formatPixel, parsePixel } from '../../../shared/utils/pixelColor'
import { FACE_NAMES } from '../../../shared/modeler/types'
import { effectiveLayers, hasCustomLayers, addLayer, removeLayer, patchLayer, moveLayer, addReferenceImage, removeReferenceImage, patchReferenceImage } from '../../../shared/modeler/layer'
import { bakeLayers, clearBakeCache, transparentPng as bakeTransparentPng } from '../modules/modeler/textureBake'
import type { ModelApplyResponse } from '../../../shared/types/ipc'
import type { ModelAsset } from '../../../shared/types/content'
import type {
  FormatId,
  MeshNode,
  ModelDocument,
  NodeId,
  TextureAnimation,
  TextureId,
  Vec3
} from '../../../shared/modeler/types'
import { isGroupNode, isMeshNode } from '../../../shared/modeler/types'

/** 网格子对象编辑模式（B4-3/v3 C1·C2）：object=对象级；vertex/face/edge/knife=网格子对象级 */
export type MeshEditMode = 'object' | 'vertex' | 'face' | 'edge' | 'knife'

/** 对象绑定文档 id 约定：<type>__<objectId>（统一编辑器「在模型工坊打开」定位/新建用） */
export function boundDocId(type: 'block' | 'item' | 'entity', id: string): string {
  return `${type}__${id}`
}

/** 解析绑定文档 id；非绑定文档返回 null（模型工坊「打开关联对象」入口显隐依据） */
export function parseBoundDocId(
  docId: string
): { type: 'block' | 'item' | 'entity'; id: string } | null {
  const m = /^(block|item|entity)__([A-Za-z0-9_-]+)$/.exec(docId)
  return m ? { type: m[1] as 'block' | 'item' | 'entity', id: m[2]! } : null
}

export const useModelerStore = defineStore('modeler', () => {
  const project = useProjectStore()
  const root = computed(() => project.currentProject?.path ?? '')

  /** 已保存文档 id 列表（.kunyu/modeler/*.json） */
  const docIds = ref<string[]>([])
  /** 已打开文档 id 列表（标签页顺序） */
  const openDocIds = ref<string[]>([])
  /** 当前编辑文档；null = 未打开 */
  const doc = ref<ModelDocument | null>(null)
  const selection = ref<NodeId[]>([])
  const loading = ref(false)
  /** 活动贴图：绘画目标 + 新建立方体的面绑定来源；null = 未选 */
  const activeTextureId = ref<TextureId | null>(null)
  /** 活动层：绘画落笔目标；null = 无层（单基层模式） */
  const activeLayerId = ref<string | null>(null)

  /* ---- 网格子对象编辑（B4-3） ---- */
  /** 编辑模式：仅当选中单个 mesh 节点时可进入 vertex/face */
  const editMode = ref<MeshEditMode>('object')
  /** 顶点子选择（mesh.vertices 下标；仅 vertex 模式有意义） */
  const vertexSelection = ref<number[]>([])
  /** 面子选择（mesh.faces 下标；仅 face 模式有意义） */
  const faceSelection = ref<number[]>([])
  /** 边子选择（v3 C1：meshEdgeKey 列表；仅 edge 模式有意义——边无稳定下标故存键） */
  const edgeSelection = ref<string[]>([])
  /** 切刀锚点（v3 C2）：首击面下标 + 父空间交点；null = 未开始（仅 knife 模式有意义） */
  const knifeAnchor = ref<{ face: number; point: Vec3 } | null>(null)
  /**
   * 权重绘制目标组（v3 C3a）：权重刷要把影响涂到哪个组节点上；null = 未选目标
   * （权重刷不可用）。目标是组节点 id，不随选择变化（独立于 selection）。
   */
  const weightTarget = ref<NodeId | null>(null)

  /** 子对象编辑目标：唯一选中的 mesh 节点 id（不满足 = null，模式自动回落 object） */
  const meshEditTarget = computed<NodeId | null>(() => {
    const d = doc.value
    if (!d || selection.value.length !== 1) return null
    const n = d.nodes[selection.value[0]!]
    return n && isMeshNode(n) ? n.id : null
  })

  /** 切换编辑模式：进入子对象模式需目标存在；切换即清空子选择与切刀锚点 */
  function setEditMode(mode: MeshEditMode): void {
    if (mode !== 'object' && !meshEditTarget.value) return
    editMode.value = mode
    vertexSelection.value = []
    faceSelection.value = []
    edgeSelection.value = []
    knifeAnchor.value = null
  }

  // 自动回落与越界修剪：选中变化/文档替换（撤销、删除、导入）后保持子选择合法；
  // 切换文档（含多标签恢复会话）时整体重置子编辑状态（下标语义不可跨文档携带）
  let lastEditDocId = ''
  watch([selection, doc], () => {
    const docId = doc.value?.id ?? ''
    if (docId !== lastEditDocId) {
      lastEditDocId = docId
      if (editMode.value !== 'object') editMode.value = 'object'
      if (vertexSelection.value.length > 0) vertexSelection.value = []
      if (faceSelection.value.length > 0) faceSelection.value = []
      if (edgeSelection.value.length > 0) edgeSelection.value = []
      if (knifeAnchor.value) knifeAnchor.value = null
      return
    }
    const id = meshEditTarget.value
    if (!id) {
      if (editMode.value !== 'object') editMode.value = 'object'
      if (vertexSelection.value.length > 0) vertexSelection.value = []
      if (faceSelection.value.length > 0) faceSelection.value = []
      if (edgeSelection.value.length > 0) edgeSelection.value = []
      if (knifeAnchor.value) knifeAnchor.value = null
      return
    }
    const node = doc.value!.nodes[id] as MeshNode
    const vs = vertexSelection.value
    if (vs.length > 0) {
      const pruned = vs.filter((i) => i >= 0 && i < node.vertices.length)
      if (pruned.length !== vs.length) vertexSelection.value = pruned
    }
    const fs = faceSelection.value
    if (fs.length > 0) {
      const pruned = fs.filter((i) => i >= 0 && i < node.faces.length)
      if (pruned.length !== fs.length) faceSelection.value = pruned
    }
    // 边选择：环形切/删面后顶点下标漂移或边消失 → 仅保留两端仍存在的边键
    const es = edgeSelection.value
    if (es.length > 0) {
      const valid = new Set(
        node.faces.flatMap((f) =>
          f.vertices.map((vi, k) => meshEdgeKey(vi, f.vertices[(k + 1) % f.vertices.length]!))
        )
      )
      const pruned = es.filter((key) => {
        const pair = parseMeshEdgeKey(key)
        return (
          !!pair &&
          node.vertices[pair.a] !== undefined &&
          node.vertices[pair.b] !== undefined &&
          valid.has(key)
        )
      })
      if (pruned.length !== es.length) edgeSelection.value = pruned
    }
  })

  /** 删除面子选择（B4-3）：patchNode {faces} 一条命令；顶点不压缩 */
  function deleteSelectedMeshFaces(): void {
    const d = doc.value
    const id = meshEditTarget.value
    if (!d || !id || faceSelection.value.length === 0) return
    const node = d.nodes[id]
    if (!node || !isMeshNode(node)) return
    const faces = removeMeshFaces(node, faceSelection.value)
    if (faces.length === node.faces.length) return
    execute('删除网格面', (dd) => patchNode(dd, id, { faces }))
    faceSelection.value = []
  }

  /**
   * 顶点增删后的权重对齐补丁（v3 C3a）：节点有权重体系时为新增顶点补空权重；
   * 无权重（缺省全刚性）时返回空对象（不向文档写入 weights 键）。
   */
  function weightsPatch(
    node: MeshNode,
    vertexCount: number,
    newIndices: readonly number[]
  ): { weights?: MeshNode['weights'] } {
    const grown = growVertexWeights(node.weights, vertexCount, newIndices)
    return grown ? { weights: grown } : {}
  }

  /**
   * 环切（v3 C1）：对每条选中边求边环（去重）后插入一圈顶点并切分四边面，一条命令。
   * 边环仅穿四边面——若所选边环不含四边面（如三角网格）则无切分，提示后不改文档。
   */
  function loopCutSelectedEdges(): void {
    const d = doc.value
    const id = meshEditTarget.value
    if (!d || !id || edgeSelection.value.length === 0) return
    const node = d.nodes[id]
    if (!node || !isMeshNode(node)) return
    const ringKeys = new Map<string, { a: number; b: number }>()
    for (const key of edgeSelection.value) {
      const pair = parseMeshEdgeKey(key)
      if (!pair) continue
      for (const e of findEdgeRing(node, pair).edges) ringKeys.set(meshEdgeKey(e.a, e.b), e)
    }
    if (ringKeys.size === 0) return
    const cut = loopCutMesh(node, [...ringKeys.values()])
    if (cut.faces.length === node.faces.length) {
      ElMessage.info('环切无效果：所选边环不含四边面（环切仅作用于四边面）')
      return
    }
    execute('环切', (dd) =>
      patchNode(dd, id, {
        vertices: cut.vertices,
        faces: cut.faces,
        ...weightsPatch(node, cut.vertices.length, cut.newVertexIndices)
      })
    )
    edgeSelection.value = []
  }

  /**
   * 切刀点击（v3 C2）：首击记录锚点（首击面 + 父空间交点，视觉上打标记）；
   * 次击以两点求切割平面（过两点且垂直于首击面）对全网格跨面切开，一条命令。
   * 平面不确定/未穿过网格时提示并丢弃锚点，不改文档。
   */
  function knifeClick(face: number, point: Vec3): void {
    const anchor = knifeAnchor.value
    if (!anchor) {
      knifeAnchor.value = { face, point }
      return
    }
    const d = doc.value
    const id = meshEditTarget.value
    if (!d || !id) return
    const node = d.nodes[id]
    if (!node || !isMeshNode(node)) return
    knifeAnchor.value = null
    if (
      face === anchor.face &&
      point[0] === anchor.point[0] &&
      point[1] === anchor.point[1] &&
      point[2] === anchor.point[2]
    ) {
      ElMessage.info('切刀：两次点击重合，已取消')
      return
    }
    const normal = knifeCutPlane(node, anchor.face, anchor.point, point)
    if (!normal) {
      ElMessage.warning('切刀：两点连线与首击面法线平行，无法确定切割平面')
      return
    }
    const cut = sliceMeshByPlane(node, anchor.point, normal)
    if (cut.newVertexIndices.length === 0) {
      ElMessage.info('切刀：切割平面未穿过网格，无效果')
      return
    }
    execute('切刀', (dd) =>
      patchNode(dd, id, {
        vertices: cut.vertices,
        faces: cut.faces,
        ...weightsPatch(node, cut.vertices.length, cut.newVertexIndices)
      })
    )
  }

  /** 取消切刀锚点（Esc / 切换模式）：仅清待定点，不动文档 */
  function cancelKnife(): void {
    knifeAnchor.value = null
  }

  /** 设置权重绘制目标组（v3 C3a）；null = 取消目标（权重刷不可用） */
  function setWeightTarget(groupId: NodeId | null): void {
    weightTarget.value = groupId
  }

  /**
   * 施加一笔权重绘制（v3 C3a）：视口按笔刷衰减算出逐顶点落笔量、整笔累积后调用，
   * 一条命令。未选目标 / 目标不是组 / 目标不存在 → 忽略（不改文档）。
   */
  function paintWeights(stroke: WeightStroke): void {
    const d = doc.value
    const id = meshEditTarget.value
    if (!d || !id || stroke.entries.length === 0) return
    const node = d.nodes[id]
    if (!node || !isMeshNode(node)) return
    const target = d.nodes[stroke.groupId]
    if (!target || !isGroupNode(target)) return
    execute('权重绘制', (dd) => {
      const n = dd.nodes[id]
      if (!n || !isMeshNode(n)) return dd
      return patchNode(dd, id, { weights: paintVertexWeights(n, stroke) })
    })
    weightTarget.value = stroke.groupId
  }

  /** 清空目标 mesh 的逐顶点权重（回到全刚性缺省；一项为空 → 移除 weights 键） */
  function clearMeshWeights(): void {
    const d = doc.value
    const id = meshEditTarget.value
    if (!d || !id) return
    const node = d.nodes[id]
    if (!node || !isMeshNode(node) || !node.weights) return
    execute('清除权重', (dd) => patchNode(dd, id, { weights: undefined }))
  }

  /** 多文档会话状态（B3-2）：切换标签时保存/恢复 */
  interface DocSession {
    doc: ModelDocument
    selection: NodeId[]
    activeTextureId: TextureId | null
    activeLayerId: string | null
    stack: CommandStack
    recoveredDirty: boolean
    /** P1② 乐观锁基线：本会话读盘时的文档 revision（新建/导入未落盘为 null） */
    savedRevision: string | null
  }
  const sessions = new Map<string, DocSession>()

  /** 当前文档的撤销栈（B3-2 多文档：切换时替换引用） */
  let stack = new CommandStack()
  /** 撤销栈变更计数：CommandStack 非响应式，用它驱动 canUndo/canRedo/dirty 重算 */
  const stackRev = ref(0)
  /** 最近一次命令栈编辑产生的 after patch（D2 增量桥：viewport 消费后置 null） */
  const latestPatch = ref<DocumentPatch | null>(null)
  function bumpRev(): void {
    stackRev.value++
  }

  const canUndo = computed(() => {
    void stackRev.value
    return stack.canUndo
  })
  const canRedo = computed(() => {
    void stackRev.value
    return stack.canRedo
  })
  /** 崩溃恢复载入后的人为脏标记（栈为空但内容与主文件不同；首次编辑/保存后清除） */
  const recoveredDirty = ref(false)
  /** P1② 乐观锁基线 revision：当前文档会话基于的磁盘版本（随会话切换保存/恢复） */
  const savedRevision = ref<string | null>(null)
  const dirty = computed(() => {
    void stackRev.value
    return !!doc.value && (stack.isDirty || recoveredDirty.value)
  })

  /* ---- 自动保存（P2-f）：脏状态防抖写 <id>.autosave 影子文件，不打断编辑 ---- */
  const AUTOSAVE_DELAY = 2500
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  function clearAutosaveTimer(): void {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
  }

  /** 编辑动作后调用：脏 → 防抖自动保存；回到已保存态 → 清影子文件（避免恢复误报） */
  function scheduleAutosave(): void {
    clearAutosaveTimer()
    if (!doc.value || !root.value) return
    if (!dirty.value) {
      void window.api.modeler.autosaveDoc(root.value, doc.value.id, null).catch(() => {})
      return
    }
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null
      const d = doc.value
      if (!d || !root.value || !dirty.value) return
      // 自动保存失败静默：不打断编辑，下次编辑会重试
      void window.api.modeler
        .autosaveDoc(root.value, d.id, JSON.stringify(serializeDocument(d)))
        .catch(() => {})
    }, AUTOSAVE_DELAY)
  }

  function docsDir(): string {
    return `${root.value}/.kunyu/modeler`
  }

  /** 刷新已保存文档列表（目录不存在 = 空列表） */
  async function refreshList(): Promise<void> {
    if (!root.value) {
      docIds.value = []
      return
    }
    try {
      const nodes = await window.api.fs.readDir(docsDir())
      docIds.value = nodes
        .filter((n) => n.kind === 'file' && n.name.endsWith('.json'))
        .map((n) => n.name.slice(0, -5))
    } catch {
      docIds.value = []
    }
  }

  /** 当前文档的会话 key（doc.id）；无文档时 '' */
  const currentDocKey = computed(() => doc.value?.id ?? '')

  /** 保存当前会话到 sessions（切换前调用） */
  function saveSession(): void {
    const key = currentDocKey.value
    if (!key || !doc.value) return
    sessions.set(key, {
      doc: doc.value,
      selection: selection.value.slice(),
      activeTextureId: activeTextureId.value,
      activeLayerId: activeLayerId.value,
      stack,
      recoveredDirty: recoveredDirty.value,
      savedRevision: savedRevision.value
    })
  }

  /** 恢复会话（切换后调用）；无存档时初始化新会话 */
  function restoreSession(key: string): void {
    const s = sessions.get(key)
    if (s) {
      doc.value = s.doc
      selection.value = s.selection
      activeTextureId.value = s.activeTextureId
      activeLayerId.value = s.activeLayerId
      stack = s.stack
      recoveredDirty.value = s.recoveredDirty
      savedRevision.value = s.savedRevision
    } else {
      // 新文档：初始化空会话
      doc.value = null
      selection.value = []
      activeTextureId.value = null
      activeLayerId.value = null
      stack = new CommandStack()
      recoveredDirty.value = false
      savedRevision.value = null
    }
  }

  /** 读磁盘主文档当前 revision（P1② 基线采集；不存在/读取失败为 null） */
  async function readDiskRevision(id: string): Promise<string | null> {
    try {
      const f = await window.api.fs.readFile(`${docsDir()}/${id}.json`)
      return computeModelerRevision(f.content)
    } catch {
      return null
    }
  }

  /** 打开已保存文档（反序列化 + 校验；历史栈清空并标记已保存；autosave 较新时提示恢复） */
  async function open(id: string): Promise<void> {
    if (!root.value) return
    // 已打开则直接切换标签
    if (openDocIds.value.includes(id)) {
      saveSession()
      restoreSession(id)
      bumpRev()
      return
    }
    loading.value = true
    try {
      // 崩溃恢复检测：autosave 比主文件新 = 上次有未保存修改（应用崩溃/异常退出）
      let rec = null
      try {
        rec = await window.api.modeler.checkDocRecovery(root.value, id)
      } catch {
        rec = null // 检测失败不阻塞正常打开
      }
      if (rec?.hasAutosave && (rec.autosaveMtime ?? 0) > (rec.docMtime ?? 0)) {
        const time = rec.autosaveMtime ? new Date(rec.autosaveMtime).toLocaleString() : '未知时间'
        let action: 'restore' | 'discard' | 'abort' = 'abort'
        try {
          await ElMessageBox.confirm(
            `检测到「${id}」的自动恢复副本（${time}），比已保存版本更新。是否恢复未保存的修改？`,
            '恢复未保存修改',
            {
              type: 'warning',
              confirmButtonText: '恢复',
              cancelButtonText: '丢弃副本',
              distinguishCancelAndClose: true
            }
          )
          action = 'restore'
        } catch (e) {
          action = e === 'cancel' ? 'discard' : 'abort'
        }
        if (action === 'abort') return
        if (action === 'discard') {
          await window.api.modeler.autosaveDoc(root.value, id, null).catch(() => {})
        } else {
          // 恢复：载入 autosave 内容，保持脏标记提示用户尽快显式保存
          // P1②：乐观锁基线仍取主文档（autosave 不是保存冲突的判定对象）
          const baseline = await readDiskRevision(id)
          const file = await window.api.fs.readFile(`${docsDir()}/${id}.autosave`)
          const parsed = deserializeDocument(JSON.parse(file.content))
          saveSession()
          openDocIds.value.push(id)
          restoreSession(id)
          doc.value = parsed
          selection.value = []
          activeTextureId.value = firstTextureId(parsed)
          stack.clear()
          recoveredDirty.value = true
          savedRevision.value = baseline
          bumpRev()
          ElMessage.warning('已恢复未保存的修改，请确认后尽快保存')
          return
        }
      }
      const file = await window.api.fs.readFile(`${docsDir()}/${id}.json`)
      const parsed = deserializeDocument(JSON.parse(file.content))
      saveSession()
      openDocIds.value.push(id)
      restoreSession(id)
      doc.value = parsed
      selection.value = []
      activeTextureId.value = firstTextureId(parsed)
      stack.clear()
      stack.markSaved()
      recoveredDirty.value = false
      // P1②：乐观锁基线 = 本次读到的主文档 revision
      savedRevision.value = computeModelerRevision(file.content)
      bumpRev()
    } catch (err) {
      ElMessage.error(`打开模型文档失败：${(err as Error).message}`)
    } finally {
      loading.value = false
    }
  }

  /** 新建空文档（内存态；点保存才落盘） */
  function create(name: string, format: FormatId): void {
    clearAutosaveTimer()
    saveSession()
    const d = createDocument({ name, format })
    openDocIds.value.push(d.id)
    restoreSession(d.id)
    doc.value = d
    selection.value = []
    activeTextureId.value = null
    stack.clear()
    stack.markSaved()
    recoveredDirty.value = false
    bumpRev()
  }

  /** 关闭当前文档（有未保存修改时由视图层负责确认；同时清自动保存影子文件） */
  function close(): void {
    clearAutosaveTimer()
    const d = doc.value
    if (d && root.value) {
      void window.api.modeler.autosaveDoc(root.value, d.id, null).catch(() => {})
    }
    const key = currentDocKey.value
    sessions.delete(key)
    openDocIds.value = openDocIds.value.filter((id) => id !== key)
    // 切换到剩余标签或清空
    if (openDocIds.value.length > 0) {
      restoreSession(openDocIds.value[openDocIds.value.length - 1]!)
    } else {
      doc.value = null
      selection.value = []
      activeTextureId.value = null
      activeLayerId.value = null
      stack.clear()
      recoveredDirty.value = false
    }
    clearBakeCache()
    bumpRev()
  }

  /** 保存当前文档到 .kunyu/modeler/<id>.json（主进程：备份轮转 + 原子写 + 清 autosave）。
   *  成功后同步把可编译格式（java_block/bedrock/geckolib）落盘到资源包 assets/<modId>/。
   *  资源包写入失败不打断保存本身——只弹 warning 让用户知道还没编译好。
   */
  async function save(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    try {
      clearAutosaveTimer()
      // P1② 乐观锁：带上本会话基线 revision——期间被其它来源改动则主进程拒绝并提示
      const saved = await window.api.modeler.saveDoc(
        root.value,
        d.id,
        JSON.stringify(serializeDocument(d)),
        savedRevision.value
      )
      savedRevision.value = saved.revision
      stack.markSaved()
      recoveredDirty.value = false
      bumpRev()
      await refreshList()
      /* D1：可编译格式 → 直接落资源包；失败降级 warning，不中断保存 */
      if (d.format === 'java_block' || d.format === 'bedrock_entity' || d.format === 'geckolib') {
        try {
          const res = await window.api.modeler.compileResource(root.value, d.id)
          if (res.ok) {
            const warns = res.downgrades.filter((x) => x.severity === 'warning')
            const files = res.files.length > 0 ? `（落盘 ${res.files.join('、')}）` : ''
            if (warns.length > 0) {
              ElMessage.warning(`已保存「${d.name}」，资源包编译 ${warns.length} 处 warning：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}${files}`)
            } else {
              ElMessage.success(`已保存「${d.name}」${files}`)
            }
          } else {
            ElMessage.warning(`已保存「${d.name}」，资源包编译未写入：${res.errorMessage}`)
          }
        } catch (err) {
          ElMessage.warning(`已保存「${d.name}」，资源包编译调用失败：${(err as Error).message}`)
        }
      } else {
        ElMessage.success(`已保存 ${d.name}`)
      }
    } catch (err) {
      ElMessage.error(`保存失败：${(err as Error).message}`)
    }
  }

  /**
   * 执行一次编辑：transform 返回新文档（shared 不可变操作），差分入命令栈。
   * transform 抛错（如 ModelerDocumentError）时保持原文档并提示。
   */
  function execute(
    label: string,
    transform: (d: ModelDocument) => ModelDocument,
    extras?: { mergeKey?: string; selectAfter?: NodeId[] }
  ): void {
    const current = doc.value
    if (!current) return
    try {
      const beforeSelection = selection.value.slice()
      const { command, doc: next } = commandFromTransform(current, label, transform)
      doc.value = next
      if (command) {
        stack.execute(command, {
          ...(extras?.mergeKey !== undefined ? { mergeKey: extras.mergeKey } : {}),
          selectionBefore: beforeSelection
        })
        recoveredDirty.value = false // 真实命令取代人为脏标记
        latestPatch.value = command.after // D2：暴露给 viewport 做增量桥
        bumpRev()
      }
      if (extras?.selectAfter) selection.value = extras.selectAfter
      scheduleAutosave()
    } catch (err) {
      ElMessage.error((err as Error).message)
    }
  }

  function undo(): void {
    const current = doc.value
    if (!current) return
    const command = stack.undo()
    if (!command) return
    doc.value = revertCommand(current, command)
    selection.value = command.selectionBefore ?? []
    recoveredDirty.value = false
    latestPatch.value = command.before // D2：撤销也暴露 patch（方向和 redo 相反）
    bumpRev()
    scheduleAutosave()
  }

  function redo(): void {
    const current = doc.value
    if (!current) return
    const command = stack.redo()
    if (!command) return
    doc.value = applyCommand(current, command)
    selection.value = command.selectionAfter ?? []
    recoveredDirty.value = false
    latestPatch.value = command.after
    bumpRev()
    scheduleAutosave()
  }

  /* ---- 贴图与绘画（P1） ---- */

  /** 文档第一个贴图 id（打开文档时作为活动贴图缺省） */
  function firstTextureId(d: ModelDocument): TextureId | null {
    const ids = Object.keys(d.textures)
    return ids.length > 0 ? ids[0]! : null
  }

  /** 渲染层生成全透明 PNG data URL（贴图初始内容，后续绘画就地更新） */
  function transparentPng(w: number, h: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    return canvas.toDataURL('image/png')
  }

  /** 新建贴图（16–512 见方），成功后设为活动贴图 */
  function addTextureToDoc(name: string, size: number): void {
    if (!doc.value) return
    const clamped = Math.min(512, Math.max(4, Math.round(size)))
    const tex = {
      id: uid('tex-'),
      name: name.trim() || '贴图',
      width: clamped,
      height: clamped,
      data: transparentPng(clamped, clamped),
      visible: true
    }
    execute('新建贴图', (d) => addTexture(d, tex))
    activeTextureId.value = tex.id
  }

  /** 删除贴图（节点 faces 引用由 document.removeTexture 清理） */
  function removeTextureById(id: TextureId): void {
    if (!doc.value || !doc.value.textures[id]) return
    execute('删除贴图', (d) => removeTexture(d, id))
    if (activeTextureId.value === id) activeTextureId.value = firstTextureId(doc.value)
  }

  /** 绘画笔画落定：把笔画后的完整贴图 data 写回文档（每笔画一条命令，可撤销） */
  async function applyPaintStroke(textureId: TextureId, dataUrl: string): Promise<void> {
    if (!doc.value) return
    const tex = doc.value.textures[textureId]
    if (!tex) return
    const layers = effectiveLayers(tex)
    const hasLayers = hasCustomLayers(tex)
    const activeLayer = hasLayers ? layers.find((l) => l.id === activeLayerId.value) : null

    if (hasLayers && activeLayer) {
      // 多层模式：笔画落活动层，再烘焙为单张 data
      const newLayerData = dataUrl
      const nextLayers = layers.map((l) => (l.id === activeLayer.id ? { ...l, data: newLayerData } : l))
      const baked = await bakeLayers(nextLayers, tex.width, tex.height)
      execute('绘画', (d) => {
        const withLayer = patchLayer(d, textureId, activeLayer.id, { data: newLayerData })
        return patchTexture(withLayer, textureId, { data: baked })
      })
    } else {
      // 单基层模式：直接更新贴图 data（无层栈）
      execute('绘画', (d) => patchTexture(d, textureId, { data: dataUrl }))
    }
  }

  /* ---- 纹理层 CRUD（B2-2） ---- */

  /** 当前贴图的有效层栈（无层时返回单基层） */
  function getTextureLayers(texId: TextureId): ReturnType<typeof effectiveLayers> {
    const tex = doc.value?.textures[texId]
    return tex ? effectiveLayers(tex) : []
  }

  /** 新建层（渲染层生成透明初始像素） */
  async function addLayerToDoc(texId: TextureId, name?: string): Promise<void> {
    if (!doc.value) return
    const tex = doc.value.textures[texId]
    if (!tex) return
    const data = bakeTransparentPng(tex.width, tex.height)
    const { doc: next, layerId } = addLayer(doc.value, texId, { name, data })
    if (layerId) {
      doc.value = next
      activeLayerId.value = layerId
      bumpRev()
      scheduleAutosave()
    }
  }

  /** 删除层（至少保留一层） */
  async function removeLayerFromDoc(texId: TextureId, layerId: string): Promise<void> {
    if (!doc.value) return
    const next = removeLayer(doc.value, texId, layerId)
    if (next !== doc.value) {
      doc.value = next
      // 活动层被删时回退到第一层
      const layers = getTextureLayers(texId)
      if (activeLayerId.value === layerId) {
        activeLayerId.value = layers.length > 0 ? layers[0]!.id : null
      }
      bumpRev()
      scheduleAutosave()
    }
  }

  /** 更新层字段（名称/显隐/不透明度/像素） */
  async function patchLayerInDoc(
    texId: TextureId,
    layerId: string,
    patch: Parameters<typeof patchLayer>[3]
  ): Promise<void> {
    if (!doc.value) return
    const next = patchLayer(doc.value, texId, layerId, patch)
    if (next !== doc.value) {
      doc.value = next
      bumpRev()
      scheduleAutosave()
    }
  }

  /** 层上移/下移 */
  async function moveLayerInDoc(texId: TextureId, layerId: string, delta: number): Promise<void> {
    if (!doc.value) return
    const next = moveLayer(doc.value, texId, layerId, delta)
    if (next !== doc.value) {
      doc.value = next
      bumpRev()
      scheduleAutosave()
    }
  }

  /** 烘焙当前贴图层栈为单张 data（撤销/重做后恢复一致性） */
  async function rebakeTexture(texId: TextureId): Promise<void> {
    const tex = doc.value?.textures[texId]
    if (!tex || !hasCustomLayers(tex)) return
    const baked = await bakeLayers(effectiveLayers(tex), tex.width, tex.height)
    if (baked !== tex.data) {
      execute('重烘焙贴图', (d) => patchTexture(d, texId, { data: baked }))
    }
  }

  /* ---- 参考图（B3-1） ---- */

  /** 添加参考图（data URL），返回新图 id */
  function addRefImage(input: { name: string; data: string; position?: [number, number, number]; size?: [number, number] }): string {
    if (!doc.value) return ''
    const { doc: next, refId } = addReferenceImage(doc.value, input)
    doc.value = next
    bumpRev()
    scheduleAutosave()
    return refId
  }

  /** 删除参考图 */
  function removeRefImage(refId: string): void {
    if (!doc.value) return
    const next = removeReferenceImage(doc.value, refId)
    if (next !== doc.value) {
      doc.value = next
      bumpRev()
      scheduleAutosave()
    }
  }

  /** 更新参考图字段 */
  function patchRefImage(refId: string, patch: Parameters<typeof patchReferenceImage>[2]): void {
    if (!doc.value) return
    const next = patchReferenceImage(doc.value, refId, patch)
    if (next !== doc.value) {
      doc.value = next
      bumpRev()
      scheduleAutosave()
    }
  }

  /**
   * B2-1 flipbook：设置/清除贴图动画元数据（null = 清除）。
   * frametime 连续调整经 mergeKey 合并为一条命令。
   */
  function setTexAnimation(id: TextureId, animation: TextureAnimation | null, mergeKey?: string): void {
    if (!doc.value || !doc.value.textures[id]) return
    execute(
      animation ? '编辑贴图动画' : '移除贴图动画',
      (d) => setTextureAnimation(d, id, animation),
      mergeKey ? { mergeKey } : undefined
    )
  }

  /** 导入 PNG 为文档贴图（主进程弹框解码 ≤512），成功后设为活动贴图；可撤销 */
  async function importTexturePng(): Promise<void> {
    if (!doc.value || !root.value) return
    let res
    try {
      res = await window.api.modeler.importTexturePng(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.dataUrl || !res.width || !res.height) {
      ElMessage.error(`导入失败：${res.error ?? '贴图数据不完整'}`)
      return
    }
    const tex = {
      id: uid('tex-'),
      name: res.name?.trim() || '导入贴图',
      width: res.width,
      height: res.height,
      data: res.dataUrl,
      visible: true
    }
    execute('导入贴图', (d) => addTexture(d, tex))
    activeTextureId.value = tex.id
    ElMessage.success(`已导入贴图「${tex.name}」（${tex.width}×${tex.height}）`)
  }

  /** 导出文档贴图为 PNG 文件（主进程弹保存框落盘） */
  async function exportTexturePng(id: TextureId): Promise<void> {
    const tex = doc.value?.textures[id]
    if (!tex || !root.value) return
    let res
    try {
      res = await window.api.modeler.exportTexturePng(root.value, { name: tex.name, dataUrl: tex.data })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    ElMessage.success(`已导出 ${res.path}`)
  }

  /**
   * （P3-f）把当前文档导出 geo.json 写回实体（仅 bedrock_entity/geckolib）。
   * 注意：主进程读取的是已保存版本，调用方需先保证文档已保存。
   */
  async function applyGeoToEntity(entityId: string, confirm?: boolean): Promise<ModelApplyResponse> {
    const d = doc.value
    if (!d || !root.value) return { ok: false, errorMessage: '没有打开的文档或项目' }
    try {
      return await window.api.modeler.applyGeoToEntity(root.value, d.id, entityId, confirm)
    } catch (err) {
      return { ok: false, errorMessage: (err as Error).message }
    }
  }

  /**
   * （P5-open）把当前文档导出 ModelAsset 写回方块/物品/实体对象（仅 java_block）。
   * 主进程读取已保存版本，调用方需先保证文档已保存。
   */
  async function applyModelToObject(
    targetKind: 'block' | 'item' | 'entity',
    targetId: string,
    confirm?: boolean
  ): Promise<ModelApplyResponse> {
    const d = doc.value
    if (!d || !root.value) return { ok: false, errorMessage: '没有打开的文档或项目' }
    try {
      return await window.api.modeler.applyModelToObject(root.value, d.id, targetKind, targetId, confirm)
    } catch (err) {
      return { ok: false, errorMessage: (err as Error).message }
    }
  }

  /** 语义像素 → PNG data URL（modelAssetToDocument 的 encodePixels 注入；canvas 编码） */
  function encodePixelsToDataUrl(pixels: string[], w: number, h: number): string {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布上下文')
    const img = ctx.createImageData(w, h)
    for (let i = 0; i < w * h; i++) {
      const c = parsePixel(pixels[i] ?? '')
      if (!c) continue
      const o = i * 4
      img.data[o] = c.r
      img.data[o + 1] = c.g
      img.data[o + 2] = c.b
      img.data[o + 3] = c.a
    }
    ctx.putImageData(img, 0, 0)
    return canvas.toDataURL('image/png')
  }

  /**
   * （P5-open）统一编辑器「在模型工坊打开」：定位或新建对象绑定的模型文档。
   * 绑定约定 id = <type>__<objectId>；实体优先打开 renderer.modelerDocId 登记的文档。
   * 无绑定文档时按对象现状导入：实体 geoJson → bedrock 文档；内嵌/绑定 cube 模型 →
   * java_block 文档；都没有则新建空文档（实体 bedrock_entity，方块/物品 java_block）。
   * 导入/新建的文档为内存态（人为脏），用户保存后才落盘。
   * @returns 错误文案；成功返回 null（调用方负责跳转模型工坊模块）
   */
  async function openForObject(
    type: 'block' | 'item' | 'entity',
    id: string,
    displayName: string
  ): Promise<string | null> {
    const r = root.value
    if (!r) return '没有打开的项目'
    // 当前文档有未保存修改：先引导保存，避免跳模块后误以为丢失（文档仍驻留 store）
    if (doc.value && dirty.value) {
      try {
        await ElMessageBox.confirm(
          '当前模型文档有未保存修改。先保存再继续？',
          '未保存修改',
          { type: 'warning', confirmButtonText: '保存并继续', cancelButtonText: '放弃修改' }
        )
        await save()
      } catch {
        // 放弃修改：清栈避免污染新文档会话
        close()
      }
    }
    clearAutosaveTimer()
    await refreshList()

    let def: Record<string, unknown> | null = null
    try {
      def = (await window.api.content.load(r, type, id)) as unknown as Record<string, unknown>
    } catch (err) {
      return `读取对象失败：${(err as Error).message}`
    }

    // 实体已登记来源文档且文档在 → 直接打开（P4-gen 绑定优先于 id 约定）
    if (type === 'entity') {
      const registered = (def?.renderer as { modelerDocId?: string | null } | undefined)?.modelerDocId
      if (typeof registered === 'string' && registered && docIds.value.includes(registered)) {
        await open(registered)
        return null
      }
    }

    const boundId = boundDocId(type, id)
    if (docIds.value.includes(boundId)) {
      await open(boundId)
      return null
    }

    /* 导入为新文档（内存态） */
    let imported: ModelDocument | null = null
    const emptyFormat: FormatId = type === 'entity' ? 'bedrock_entity' : 'java_block'
    try {
      if (type === 'entity') {
        const geoJson = (def?.renderer as { geoJson?: string | null } | undefined)?.geoJson
        if (typeof geoJson === 'string' && geoJson.trim()) {
          imported = geoToDocument(geoJson).doc
        }
      }
      if (!imported) {
        // cube 路径：内嵌优先，退化 cubeModelId 绑定的独立模型资产
        let asset: ModelAsset | null = null
        const cm = embeddedCubeOf(def, type)
        if (cm) {
          asset = modelAssetFromEmbedded(id, cm, displayName || id)
        } else {
          const boundModelId = (def as { cubeModelId?: string | null }).cubeModelId
          if (typeof boundModelId === 'string' && boundModelId) {
            const m = (await window.api.content.load(r, 'model', boundModelId)) as ModelAsset
            if (m?.kind === 'model') asset = m
          }
        }
        if (asset) {
          imported = modelAssetToDocument(asset, { encodePixels: encodePixelsToDataUrl }).doc
        }
      }
    } catch (err) {
      return `导入模型失败：${(err as Error).message}`
    }

    const base = imported ?? createDocument({ name: displayName || id, format: emptyFormat })
    doc.value = {
      ...base,
      id: boundId,
      formatData: { ...(base.formatData ?? {}), boundObject: { type, id } }
    }
    selection.value = []
    activeTextureId.value = firstTextureId(doc.value)
    stack.clear()
    recoveredDirty.value = true // 导入/新建尚未落盘：人为脏，提示尽快保存
    savedRevision.value = null // P1②：boundId 已确认不在磁盘（上方 docIds 检查），基线为「不存在」
    bumpRev()
    ElMessage.success(
      imported ? `已把「${id}」的模型导入模型工坊，保存后生效` : `已为「${id}」新建空模型文档，保存后生效`
    )
    return null
  }

  /** （P4）导入 .animation.json 合并进当前文档（主进程弹框读原文，codec 合并为一条命令，可撤销） */
  async function importAnimations(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    let res
    try {
      res = await window.api.modeler.importAnimations(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.content) {
      ElMessage.error(`导入失败：${res.error ?? '文件内容为空'}`)
      return
    }
    const { doc: merged, downgrades } = mergeAnimationsIntoDocument(res.content, d)
    const added = Object.keys(merged.animations).length - Object.keys(d.animations).length
    if (added <= 0 && downgrades.length === 0) {
      ElMessage.info('文件中没有可导入的动画')
      return
    }
    execute('导入动画', () => merged)
    const warns = downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`导入完成，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导入 ${added} 个动画`)
    }
  }

  /** （P4）导出文档全部动画为 .animation.json（主进程弹保存框落盘） */
  async function exportAnimations(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    if (Object.keys(d.animations).length === 0) {
      ElMessage.info('当前文档没有动画可导出')
      return
    }
    const { output, downgrades } = documentToAnimations(d)
    let res
    try {
      res = await window.api.modeler.exportAnimations(root.value, {
        name: d.name || d.id,
        content: JSON.stringify(output, null, 2)
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path}`)
    }
  }

  /** （B5-2）导入 .animation_controllers.json（主进程弹框读原文，codec 合并为一条命令，可撤销） */
  async function importController(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    let res
    try {
      res = await window.api.modeler.importController(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.content) {
      ElMessage.error(`导入失败：${res.error ?? '文件内容为空'}`)
      return
    }
    let merged: ReturnType<typeof mergeControllerIntoDocument>
    try {
      merged = mergeControllerIntoDocument(res.content, d)
    } catch (err) {
      ElMessage.error((err as Error).message)
      return
    }
    if (merged.doc === d) {
      ElMessage.info('文件中没有可导入的控制器状态')
      return
    }
    execute('导入动画控制器', () => merged.doc)
    const warns = merged.downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`导入完成，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导入控制器，设为当前激活控制器`)
    }
  }

  /** （B5-2）导出文档首个动画控制器为 .animation_controllers.json（主进程弹保存框落盘） */
  async function exportController(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    if (getControllers(d).length === 0) {
      ElMessage.info('当前文档没有动画控制器可导出（在时间线「控制器」里创建）')
      return
    }
    const { output, downgrades } = documentToAnimationControllers(d)
    let res
    try {
      res = await window.api.modeler.exportController(root.value, {
        name: d.name || d.id,
        content: JSON.stringify(output, null, 2)
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path}`)
    }
  }

  /** 整文档导入前的脏守卫（bbmodel/JEM/JPM 共用）：未保存修改先引导保存 */
  async function guardUnsavedBeforeImport(): Promise<void> {
    if (!doc.value || !dirty.value) return
    try {
      await ElMessageBox.confirm(
        '当前模型文档有未保存修改。先保存再继续？',
        '未保存修改',
        { type: 'warning', confirmButtonText: '保存并继续', cancelButtonText: '放弃修改' }
      )
      await save()
    } catch {
      close()
    }
  }

  /**
   * 整文档导入落地（bbmodel/JEM/JPM 共用）：不走命令栈（与打开文档同级）；
   * id 与既有文档冲突时追加序号；人为脏标记提示尽快保存。
   */
  async function applyImportedDocument(parsed: FormatImportResult, ioWarnings: string[]): Promise<void> {
    await refreshList()
    let id = parsed.doc.id
    let n = 2
    while (docIds.value.includes(id)) id = `${parsed.doc.id}_${n++}`
    clearAutosaveTimer()
    doc.value = { ...parsed.doc, id }
    selection.value = []
    activeTextureId.value = firstTextureId(doc.value)
    stack.clear()
    recoveredDirty.value = true // 导入尚未落盘：人为脏，提示尽快保存
    bumpRev()
    const warns = parsed.downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0 || ioWarnings.length > 0) {
      const first = warns[0]?.message ?? ioWarnings[0]!
      const total = warns.length + ioWarnings.length
      ElMessage.warning(`已导入「${doc.value.name}」，${total} 处降级：${first}${total > 1 ? ' 等' : ''}；保存后生效`)
    } else {
      ElMessage.success(`已导入「${doc.value.name}」，保存后生效`)
    }
  }

  /**
   * （B5-3）导入 OptiFine .jem 整实体模型为新模型文档（整文档导入，不走命令栈）。
   */
  async function importJem(): Promise<void> {
    if (!root.value) return
    await guardUnsavedBeforeImport()
    let res
    try {
      res = await window.api.modeler.importJem(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.content) {
      ElMessage.error(`导入失败：${res.error ?? '文件内容为空'}`)
      return
    }
    let parsed: FormatImportResult
    try {
      parsed = jemToDocument(res.content)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    await applyImportedDocument(parsed, [])
  }

  /** （B5-3）把当前文档导出为 OptiFine .jem 整实体模型（主进程弹保存框落盘） */
  async function exportJem(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    const { output, downgrades } = documentToJem(d)
    let res
    try {
      res = await window.api.modeler.exportJem(root.value, {
        name: d.name || d.id,
        content: JSON.stringify(output, null, 2)
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path}`)
    }
  }

  /** （B5-3）导入 OptiFine .jpm 部件为新模型文档（整文档导入，不走命令栈） */
  async function importJpm(): Promise<void> {
    if (!root.value) return
    await guardUnsavedBeforeImport()
    let res
    try {
      res = await window.api.modeler.importJpm(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.content) {
      ElMessage.error(`导入失败：${res.error ?? '文件内容为空'}`)
      return
    }
    let parsed: FormatImportResult
    try {
      parsed = jpmToDocument(res.content, { name: res.name || 'part' })
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    await applyImportedDocument(parsed, [])
  }

  /** （B5-3）把当前文档导出为 OptiFine .jpm 部件（主进程弹保存框落盘） */
  async function exportJpm(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    const { output, downgrades } = documentToJpm(d)
    let res
    try {
      res = await window.api.modeler.exportJpm(root.value, {
        name: d.name || d.id,
        content: JSON.stringify(output, null, 2)
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path}`)
    }
  }

  /** 贴图 data URL → 行优先像素串（canvas 解码；失败返回 null 由 codec 逐面告警） */
  async function decodeTexturePixels(
    dataUrl: string,
    w: number,
    h: number
  ): Promise<string[] | null> {
    if (!dataUrl.startsWith('data:image')) return null
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('贴图解码失败'))
        el.src = dataUrl
      })
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h).data
      const out: string[] = []
      for (let i = 0; i < w * h; i++) {
        const o = i * 4
        out.push(
          formatPixel({ r: d[o]!, g: d[o + 1]!, b: d[o + 2]!, a: d[o + 3]! })
        )
      }
      return out
    } catch {
      return null
    }
  }

  /**
   * （B5-4）导入 MC 皮肤 PNG（64×64/64×32）为新模型文档：主进程解码像素串，
   * 渲染层 shared/modeler/formats/skin 组装 12 部件立方体 + 1 张贴图。
   * 弹窗询问体型（Slim Alex = 手臂 3 像素宽；经典 Steve = 4 像素宽）。
   */
  async function importSkin(): Promise<void> {
    if (!root.value) return
    await guardUnsavedBeforeImport()
    let slim = false
    try {
      await ElMessageBox.confirm(
        '这是 Slim（Alex，手臂 3 像素宽）皮肤吗？',
        '皮肤体型',
        {
          confirmButtonText: 'Slim（Alex）',
          cancelButtonText: 'Classic（Steve）',
          type: 'info',
          distinguishCancelAndClose: true
        }
      )
      slim = true
    } catch (action) {
      if (action === 'close') return // 右上角关闭 = 放弃导入
      slim = false // 点「Classic」继续按经典体型导入
    }
    let res
    try {
      res = await window.api.modeler.importSkin(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.pixels || !res.width || !res.height) {
      ElMessage.error(`导入失败：${res.error ?? '未读取到像素数据'}`)
      return
    }
    let parsed: FormatImportResult
    try {
      parsed = skinToDocument(res.width, res.height, res.pixels, {
        name: res.name || 'MC 皮肤',
        slim,
        encodePixels: encodePixelsToDataUrl
      })
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    await applyImportedDocument(parsed, [])
  }

  /**
   * （B5-4）把当前文档导出为 MC 皮肤 PNG（64×64 / 64×32）：渲染层解码文档贴图 →
   * documentToSkin 烘焙图集 → 主进程编码落盘。体型/画布尺寸读 formatData.skin。
   */
  async function exportSkin(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    const cache = new Map<string, string[]>()
    for (const tex of Object.values(d.textures)) {
      const px = await decodeTexturePixels(tex.data, tex.width, tex.height)
      if (px) cache.set(tex.id, px)
    }
    const { output, downgrades } = documentToSkin(d, {
      resolvePixels: (tex) => cache.get(tex.id) ?? null
    })
    let res
    try {
      res = await window.api.modeler.exportSkin(root.value, {
        name: d.name || d.id,
        width: output.width,
        height: output.height,
        pixels: output.pixels
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path}`)
    }
  }

  /** 皮肤元数据（formatData.skin）：体型/画布尺寸在导出时读取 */
  const skinMeta = computed<SkinFormatData>(() => {
    const raw = doc.value?.formatData?.skin
    return (raw ?? {}) as SkinFormatData
  })

  /**
   * （P5-bbmodel）导入 .bbmodel 为新模型文档（整文档导入，不走命令栈：
   * 与打开文档同级；人为脏标记提示尽快保存）。id 与既有文档冲突时追加序号。
   */
  async function importBbmodel(): Promise<void> {
    if (!root.value) return
    await guardUnsavedBeforeImport()
    let res
    try {
      res = await window.api.modeler.importBbmodel(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.content) {
      ElMessage.error(`导入失败：${res.error ?? '文件内容为空'}`)
      return
    }
    let parsed
    try {
      parsed = bbmodelToDocument(res.content)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    await applyImportedDocument(parsed, res.warnings ?? [])
  }

  /** （P5-bbmodel）把当前文档导出为 .bbmodel（主进程弹保存框落盘；带引用的贴图同步物化 PNG） */
  async function exportBbmodel(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    const { output, downgrades } = documentToBbmodel(d)
    const linkedTextures = Object.values(d.textures)
      .filter((t) => t.file && t.data.startsWith('data:image/png'))
      .map((t) => ({ file: t.file!, data: t.data, name: t.name }))
    let res
    try {
      res = await window.api.modeler.exportBbmodel(root.value, {
        name: d.name || d.id,
        content: JSON.stringify(output, null, 2),
        ...(linkedTextures.length > 0 ? { textures: linkedTextures } : {})
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    const landed = res.texturesWritten ? `，${res.texturesWritten} 张引用贴图已落地` : ''
    if (res.warnings && res.warnings.length > 0) {
      ElMessage.warning(`已导出 ${res.path}${landed}，贴图告警：${res.warnings[0]}${res.warnings.length > 1 ? ' 等' : ''}`)
    } else if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}${landed}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path}${landed}`)
    }
  }

  /** （B5-1）把当前文档导出为 glTF 2.0（主进程弹保存框落盘 .gltf + .bin 并物化 PNG 贴图） */
  async function exportGltf(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    const { output, downgrades } = documentToGltf(d)
    let res
    try {
      res = await window.api.modeler.exportGltf(root.value, {
        name: d.name || d.id,
        gltf: JSON.stringify(output.gltf),
        bin: output.bin,
        ...(output.images.length > 0 ? { images: output.images } : {})
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    const landed = res.texturesWritten ? `，${res.texturesWritten} 张贴图已落地` : ''
    if (res.warnings && res.warnings.length > 0) {
      ElMessage.warning(`已导出 ${res.path}${landed}，贴图告警：${res.warnings[0]}${res.warnings.length > 1 ? ' 等' : ''}`)
    } else if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}${landed}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path}${landed}`)
    }
  }

  /** （C8）把当前文档导出为 OBJ（.obj + .mtl，纯文本；主进程弹保存框落盘） */
  async function exportObj(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    const { output, downgrades } = documentToObj(d)
    if (!output.objText) {
      ElMessage.warning('无可导出的 MeshNode（OBJ 仅支持自由网格）')
      return
    }
    let res
    try {
      res = await window.api.modeler.exportObj(root.value, {
        name: d.name || d.id,
        obj: output.objText,
        mtl: output.mtlText
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path} + model.mtl`)
    }
  }

  /** （C9）导入 Bedrock geo.json（Entity / Block / GeckoLib 共用 codec；默认标记为 bedrock_entity） */
  async function importBedrockGeo(): Promise<void> {
    if (!root.value) return
    await guardUnsavedBeforeImport()
    let res
    try {
      res = await window.api.modeler.importBedrockGeo(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.content) {
      ElMessage.error(`导入失败：${res.error ?? '文件内容为空'}`)
      return
    }
    let parsed
    try {
      parsed = geoToDocument(res.content)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    await applyImportedDocument(parsed, [])
  }

  /** （C9）把当前文档导出为 Bedrock geo.json（Entity / Block / GeckoLib 共用 codec） */
  async function exportBedrockGeo(): Promise<void> {
    const d = doc.value
    if (!d || !root.value) return
    const { output, downgrades } = documentToGeo(d)
    let res
    try {
      res = await window.api.modeler.exportBedrockGeo(root.value, {
        name: d.name || d.id,
        content: JSON.stringify(output, null, 2)
      })
    } catch (err) {
      ElMessage.error(`导出失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(`导出失败：${res.error}`)
      return
    }
    const warns = downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`已导出 ${res.path}，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}`)
    } else {
      ElMessage.success(`已导出 ${res.path}`)
    }
  }

  /**
   * （P5-obj）导入 .obj 体素化为新模型文档（与导入 BB 同模式：整文档、人为脏）。
   * 先问最长轴体素分辨率（8–32，默认 16）；调色板经 canvas 编码为内嵌贴图。
   */
  async function importObj(): Promise<void> {
    if (!root.value) return
    // 当前文档有未保存修改：先引导保存，避免导入后误以为丢失
    if (doc.value && dirty.value) {
      try {
        await ElMessageBox.confirm(
          '当前模型文档有未保存修改。先保存再继续？',
          '未保存修改',
          { type: 'warning', confirmButtonText: '保存并继续', cancelButtonText: '放弃修改' }
        )
        await save()
      } catch {
        close()
      }
    }
    let resolution = 16
    try {
      const { value } = await ElMessageBox.prompt('最长轴体素分辨率（8–32，越大越精细也越重）', '导入 OBJ', {
        inputValue: '16',
        inputPattern: /^([89]|[12]\d|3[0-2])$/,
        inputErrorMessage: '请输入 8 到 32 的整数',
        confirmButtonText: '选择文件',
        cancelButtonText: '取消'
      })
      resolution = Number(value)
    } catch {
      return // 用户取消
    }
    let res
    try {
      res = await window.api.modeler.importObj(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.content) {
      ElMessage.error(`导入失败：${res.error ?? '文件内容为空'}`)
      return
    }
    let parsed
    try {
      parsed = objToDocument(
        { objText: res.content, ...(res.mtlContent !== undefined ? { mtlText: res.mtlContent } : {}) },
        { resolution, id: res.name, name: res.name, encodePixels: encodePixelsToDataUrl }
      )
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    await refreshList()
    let id = parsed.doc.id
    let n = 2
    while (docIds.value.includes(id)) id = `${parsed.doc.id}_${n++}`
    clearAutosaveTimer()
    doc.value = { ...parsed.doc, id }
    selection.value = []
    activeTextureId.value = firstTextureId(doc.value)
    stack.clear()
    recoveredDirty.value = true // 导入尚未落盘：人为脏，提示尽快保存
    bumpRev()
    const stats = parsed.doc.formatData?.obj as { boxes?: number; colors?: number } | undefined
    const warns = parsed.downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(`已导入「${doc.value.name}」，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}；保存后生效`)
    } else {
      ElMessage.success(
        `已导入「${doc.value.name}」（${stats?.boxes ?? 0} 立方体 / ${stats?.colors ?? 0} 色），保存后生效`
      )
    }
  }

  /**
   * （C5）导入 Collada .dae / ASCII FBX .fbx 为新模型文档（与导入 BB/OBJ 同模式：
   * 整文档、人为脏）。解析与文档组装由渲染层 shared codec 完成；节点变换按 codec
   * 规则烘焙进网格顶点（组仅保留结构）。
   */
  async function importMeshFile(kind: 'dae' | 'fbx' | 'gltf'): Promise<void> {
    if (!root.value) return
    if (doc.value && dirty.value) {
      try {
        await ElMessageBox.confirm(
          '当前模型文档有未保存修改。先保存再继续？',
          '未保存修改',
          { type: 'warning', confirmButtonText: '保存并继续', cancelButtonText: '放弃修改' }
        )
        await save()
      } catch {
        close()
      }
    }
    const label = kind === 'dae' ? 'Collada .dae' : kind === 'fbx' ? 'ASCII FBX' : 'glTF 2.0 .gltf'
    let res
    try {
      res =
        kind === 'dae'
          ? await window.api.modeler.importDae(root.value)
          : kind === 'fbx'
            ? await window.api.modeler.importFbx(root.value)
            : await window.api.modeler.importGltf(root.value)
    } catch (err) {
      ElMessage.error(`导入失败：${(err as Error).message}`)
      return
    }
    if (res.canceled) return
    if (res.error || !res.content) {
      ElMessage.error(`导入失败：${res.error ?? '文件内容为空'}`)
      return
    }
    const text = res.content
    let parsed: FormatImportResult
    try {
      if (kind === 'dae') {
        parsed = daeToDocument(text, { id: res.name, name: res.name })
      } else if (kind === 'fbx') {
        parsed = fbxTextToDocument(text, { id: res.name, name: res.name })
      } else {
        const json = JSON.parse(text) as Record<string, unknown>
        parsed = gltfToDocument(json, [], { id: res.name, name: res.name })
      }
    } catch (err) {
      ElMessage.error(`导入 ${label} 失败：${(err as Error).message}`)
      return
    }
    await refreshList()
    let id = parsed.doc.id
    let n = 2
    while (docIds.value.includes(id)) id = `${parsed.doc.id}_${n++}`
    clearAutosaveTimer()
    doc.value = { ...parsed.doc, id }
    selection.value = []
    activeTextureId.value = firstTextureId(doc.value)
    stack.clear()
    recoveredDirty.value = true // 导入尚未落盘：人为脏，提示尽快保存
    bumpRev()
    const fd = parsed.doc.formatData as
      | { dae?: { geometries?: number }; fbx?: { geometries?: number } }
      | undefined
    const nGeo =
      kind === 'dae' ? fd?.dae?.geometries ?? 0
      : kind === 'fbx' ? fd?.fbx?.geometries ?? 0
      : Object.values(parsed.doc.nodes).filter((n) => n.type === 'mesh').length
    const warns = parsed.downgrades.filter((x) => x.severity === 'warning')
    if (warns.length > 0) {
      ElMessage.warning(
        `已导入「${doc.value.name}」，${warns.length} 处降级：${warns[0]!.message}${warns.length > 1 ? ' 等' : ''}；保存后生效`
      )
    } else {
      ElMessage.success(`已导入「${doc.value.name}」（${nGeo} 个几何），保存后生效`)
    }
  }

  /** 导入 Collada .dae 为新模型文档（C5） */
  function importDae(): Promise<void> {
    return importMeshFile('dae')
  }

  /** 导入 ASCII FBX .fbx 为新模型文档（C5） */
  function importFbx(): Promise<void> {
    return importMeshFile('fbx')
  }

  /** 导入 glTF 2.0 .gltf 为新模型文档（C7） */
  function importGltf(): Promise<void> {
    return importMeshFile('gltf')
  }

  /* ---- 高层编辑动作（视图层直接调用） ---- */

  /** 新建立方体：挂在第一个选中组下（否则顶层），尺寸 16³；有活动贴图时六面绑定 + 自动 UV */
  function addCube(): void {
    if (!doc.value) return
    const parent = pickGroupParent()
    const node = createCubeNode(uniqueName('立方体'))
    const texId = activeTextureId.value
    if (texId && doc.value.textures[texId]) {
      const size = cubeSize(node)
      node.faces = Object.fromEntries(
        FACE_NAMES.map((f) => [f, { uv: autoFaceUv(size, f), texture: texId }])
      ) as typeof node.faces
    }
    execute(
      '新建立方体',
      (d) => addNode(d, { ...node }, parent),
      { selectAfter: [node.id] }
    )
  }

  /** 新建组（骨骼） */
  function addGroup(): void {
    if (!doc.value) return
    const parent = pickGroupParent()
    const node = createGroupNode(uniqueName('组'))
    execute(
      '新建组',
      (d) => addNode(d, { ...node }, parent),
      { selectAfter: [node.id] }
    )
  }

  /** 新建定位点 */
  function addLocator(): void {
    if (!doc.value) return
    const parent = pickGroupParent()
    const node = createLocatorNode(uniqueName('定位点'))
    execute(
      '新建定位点',
      (d) => addNode(d, { ...node }, parent),
      { selectAfter: [node.id] }
    )
  }

  /** 新建网格（B4-1）：默认四棱锥；有活动贴图时全部面绑定 */
  function addMesh(): void {
    if (!doc.value) return
    const parent = pickGroupParent()
    const node = createMeshNode(uniqueName('网格'), defaultMeshGeometry())
    const texId = activeTextureId.value
    if (texId && doc.value.textures[texId]) {
      node.faces = node.faces.map((f) => ({ ...f, texture: texId }))
    }
    execute(
      '新建网格',
      (d) => addNode(d, { ...node }, parent),
      { selectAfter: [node.id] }
    )
  }

  /** 删除选中（removeNodes 同步清动画通道；命令栈记 before/after 补丁） */
  function removeSelected(): void {
    if (!doc.value || selection.value.length === 0) return
    const targets = selection.value.slice()
    execute('删除节点', (d) => removeNodes(d, targets), { selectAfter: [] })
  }

  /** 重命名（文本输入逐步触发时用 mergeKey 合并为一条命令） */
  function rename(id: NodeId, name: string): void {
    execute(
      '重命名',
      (d) => renameNode(d, id, name),
      { mergeKey: `rename:${id}` }
    )
  }

  /** 选中组父级：唯一选中项是组时挂其下，否则顶层 */
  function pickGroupParent(): NodeId | null {
    const d = doc.value
    if (!d || selection.value.length !== 1) return null
    const node = d.nodes[selection.value[0]!]
    return node && node.type === 'group' ? node.id : null
  }

  /** 同名自动编号（立方体 / 立方体 2 / 立方体 3 …） */
  function uniqueName(base: string): string {
    const d = doc.value
    if (!d) return base
    const names = new Set(Object.values(d.nodes).map((n) => n.name))
    if (!names.has(base)) return base
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`
      if (!names.has(candidate)) return candidate
    }
  }

  return {
    docIds,
    openDocIds,
    doc,
    selection,
    loading,
    activeTextureId,
    activeLayerId,
    editMode,
    vertexSelection,
    faceSelection,
    edgeSelection,
    knifeAnchor,
    weightTarget,
    meshEditTarget,
    setEditMode,
    deleteSelectedMeshFaces,
    loopCutSelectedEdges,
    knifeClick,
    cancelKnife,
    setWeightTarget,
    paintWeights,
    clearMeshWeights,
    canUndo,
    canRedo,
    dirty,
    latestPatch,
    refreshList,
    open,
    create,
    close,
    save,
    execute,
    undo,
    redo,
    addCube,
    addGroup,
    addLocator,
    addMesh,
    removeSelected,
    rename,
    addTextureToDoc,
    removeTextureById,
    applyPaintStroke,
    setTexAnimation,
    importTexturePng,
    exportTexturePng,
    applyGeoToEntity,
    applyModelToObject,
    openForObject,
    importAnimations,
    exportAnimations,
    importController,
    exportController,
    importBbmodel,
    exportBbmodel,
    exportGltf,
    exportObj,
    importBedrockGeo,
    exportBedrockGeo,
    importJem,
    exportJem,
    importJpm,
    exportJpm,
    importObj,
    importDae,
    importFbx,
    importGltf,
    importSkin,
    exportSkin,
    skinMeta,
    getTextureLayers,
    addLayerToDoc,
    removeLayerFromDoc,
    patchLayerInDoc,
    moveLayerInDoc,
    rebakeTexture,
    addRefImage,
    removeRefImage,
    patchRefImage
  }
})
