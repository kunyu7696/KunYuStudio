/**
 * 场景增量桥纯逻辑（自 ModelerViewport.vue 抽离，行为保持逐字一致）：
 * 把「纯变换 + 结构」DocumentPatch 增量应用到 three.js 场景树——
 * 已存在节点只改变换（几何/结构字段变更留给全量重建兜底）、
 * 删除节点子树（含索引清理与几何/材质释放）、新节点按拓扑序挂父级、
 * setRoot 根顺序重排，最后不变式校验（nodeObjects 数量 vs 文档节点数）。
 * 场景索引（nodeObjects/pickMeshes/highlightLines/animOverlaid/modelRoot）由宿主注入，
 * 本模块不持有 Vue 响应式状态。
 */
import * as THREE from 'three'
import type { DocumentPatch } from '../../../../../shared/modeler/commands'
import type { ModelDocument, ModelNode, NodeId } from '../../../../../shared/modeler/types'
import { isCubeNode, isGroupNode, isLocatorNode, isMeshNode } from '../../../../../shared/modeler/types'

const DEG2RAD = Math.PI / 180

/** 增量桥依赖的宿主上下文（场景索引经 getter/setter 读写，宿主本地变量保持为唯一真源） */
export interface SceneBridgeCtx {
  nodeObjects: Map<NodeId, THREE.Object3D>
  animOverlaid: Set<NodeId>
  /** 共享几何（高亮线不 dispose 的判定依据） */
  edgeGeo: THREE.EdgesGeometry | null
  getDoc: () => ModelDocument | null
  getPickMeshes: () => THREE.Mesh[]
  setPickMeshes: (v: THREE.Mesh[]) => void
  getHighlightLines: () => THREE.LineSegments[]
  setHighlightLines: (v: THREE.LineSegments[]) => void
  getModelRoot: () => THREE.Group | null
  buildNodeObject: (doc: ModelDocument, node: ModelNode) => THREE.Object3D
  rebuildScene: () => void
  applyHighlights: () => void
  syncSubEditVisuals: () => void
  refreshGizmo: () => void
}

/**
 * 遍历 outer Group 子树，收集所有 nodeObject 的 nodeId（含自身）。
 * 用于 removedNodeIds 增量删除时发现后代（patch 只列顶层 id，后代需从旧 Object3D 找）。
 */
export function collectDescendantNodeIds(outer: THREE.Object3D, out: Set<NodeId>): void {
  const id = outer.userData.nodeId as NodeId | undefined
  if (id) out.add(id)
  for (const child of outer.children) collectDescendantNodeIds(child, out)
}

/** dispose 单个 nodeObject 子树上所有独立几何/材质 */
export function disposeNodeSubtree(outer: THREE.Object3D, edgeGeo: THREE.EdgesGeometry | null): void {
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
export function removeNodeObjects(ctx: SceneBridgeCtx, ids: NodeId[]): void {
  if (ids.length === 0) return
  const topOuters: THREE.Object3D[] = [] /* 先存顶层 outer 引用，delete 后仍可 dispose */
  const all = new Set<NodeId>()
  for (const id of ids) {
    const outer = ctx.nodeObjects.get(id)
    if (!outer) continue
    topOuters.push(outer)
    collectDescendantNodeIds(outer, all)
  }
  if (all.size === 0) return

  /* 从各集合清除后代 id（nodeObjects.delete 必须在保存 outer 之后） */
  for (const id of all) ctx.nodeObjects.delete(id)
  ctx.setPickMeshes(ctx.getPickMeshes().filter((m) => !all.has((m.userData.nodeId as NodeId) ?? '')))
  for (const id of all) ctx.animOverlaid.delete(id)
  /* highlightLines：挂在目标 mesh 上的 LineSegments —— 遍历找 parent.userData.nodeId */
  ctx.setHighlightLines(
    ctx.getHighlightLines().filter((line) => {
      const parentId = line.parent?.userData.nodeId as NodeId | undefined
      if (parentId && all.has(parentId)) {
        line.parent?.remove(line)
        if (line.geometry !== ctx.edgeGeo) line.geometry.dispose()
        return false
      }
      return true
    })
  )

  /* dispose 几何 + 从父级 detach（topOuters 是 delete 前的引用，不受影响） */
  for (const outer of topOuters) {
    disposeNodeSubtree(outer, ctx.edgeGeo)
    outer.parent?.remove(outer)
  }
}

/**
 * 按拓扑序（父先子后）创建新节点的 Object3D 并挂到正确父级。
 * - 根节点挂 modelRoot
 * - 组内子节点挂父 outer 的 inner Group
 */
export function addNewNodeObjects(ctx: SceneBridgeCtx, newIds: NodeId[], d: ModelDocument): void {
  const modelRoot = ctx.getModelRoot()
  if (newIds.length === 0 || !modelRoot) return
  const byId = new Map<NodeId, ModelNode>()
  for (const id of newIds) {
    const n = d.nodes[id]
    if (n && !ctx.nodeObjects.has(id)) byId.set(id, n)
  }
  if (byId.size === 0) return

  /* 拓扑排序：父节点（不在 newIds 里的已存在节点，或在 newIds 里但 parent=null）优先 */
  const ordered: NodeId[] = []
  const added = new Set<NodeId>()
  const queue: NodeId[] = [...byId.keys()].sort((a, b) => {
    /* 先放 parent=null 的根节点（父不存在），再放 parent 在 nodeObjects 已存在的 */
    const na = byId.get(a)!
    const nb = byId.get(b)!
    const aIsRoot = na.parent === null || ctx.nodeObjects.has(na.parent!)
    const bIsRoot = nb.parent === null || ctx.nodeObjects.has(nb.parent!)
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
    const outer = ctx.buildNodeObject(d, node) /* 会写入 nodeObjects.set */
    const parentId = node.parent
    if (parentId === null || parentId === undefined) {
      modelRoot.add(outer)
    } else {
      const parentOuter = ctx.nodeObjects.get(parentId)
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
export function applyDocPatch(ctx: SceneBridgeCtx, patch: DocumentPatch): void {
  const d = ctx.getDoc()
  if (!d) return

  /* D2b：removedNodeIds 增量删除（先删再加，避免子节点父级挂错） */
  if (patch.removedNodeIds && patch.removedNodeIds.length > 0) {
    removeNodeObjects(ctx, patch.removedNodeIds)
  }

  /* D2a：setNodes 中已有 id 只改变换 */
  const setNodes = patch.setNodes
  if (setNodes) {
    for (const [id, newNode] of Object.entries(setNodes)) {
      const obj = ctx.nodeObjects.get(id)
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
      if (!ctx.nodeObjects.has(id)) newIds.push(id)
    }
  }
  addNewNodeObjects(ctx, newIds, d)

  /* 不变式检查：nodeObjects.size 必须与文档节点数一致；否则立即 rebuildScene 兜底 */
  if (ctx.nodeObjects.size !== Object.keys(d.nodes).length) {
    console.warn('[D2] nodeObjects 与文档节点数不一致，fallback rebuildScene')
    ctx.rebuildScene()
    return
  }

  /* setRoot 根顺序变更：重排 modelRoot.children 与 doc.root 对齐 */
  const modelRoot = ctx.getModelRoot()
  if (patch.setRoot !== undefined && modelRoot) {
    const existingChildren = [...modelRoot.children]
    modelRoot.clear()
    for (const id of patch.setRoot) {
      const outer = ctx.nodeObjects.get(id)
      if (outer) modelRoot.add(outer)
    }
    /* 保留未在 setRoot 里但仍在 nodeObjects 里的根节点（理论上 setRoot 应覆盖全量，这里兜底） */
    for (const child of existingChildren) {
      if (!modelRoot.children.includes(child as THREE.Object3D)) modelRoot.add(child)
    }
  }

  ctx.applyHighlights()
  ctx.syncSubEditVisuals()
  ctx.refreshGizmo()
}
