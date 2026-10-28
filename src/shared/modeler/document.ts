/**
 * ModelDocument 文档核心：CRUD、树不变量、复制/重排/重命名、序列化。
 *
 * 设计要点（方案 §4.2）：
 * - 扁平 map + root/children 顺序表：结构操作 O(1)、undo 只记录被触及节点；
 * - 全部函数不可变更新：返回新文档对象，原文档不被修改（Vue shallowRef + revision 计数友好）；
 * - 树不变量（父子一致、无环、无孤儿、无重复表项）由 validateDocument 统一校验，
 *   所有结构操作保证操作结果满足不变量；
 * - 文档坐标不做 0..16 夹取——越界属于格式能力，文档层保持通用。
 */
import type {
  AnimationChannelName,
  AnimationId,
  CubeNode,
  DocumentIssue,
  DocumentSettings,
  FaceBinding,
  FaceName,
  FormatId,
  GroupNode,
  Keyframe,
  LocatorNode,
  LoopMode,
  MeshNode,
  ModelAnimation,
  ModelDocument,
  ModelNode,
  ModelTexture,
  NodeAnimationChannels,
  NodeId,
  TextureAnimation,
  TextureId,
  Vec2,
  Vec3
} from './types'
import { isGroupNode, isCubeNode, isMeshNode } from './types'
import { pruneVertexWeights } from './weights'
import { removeKeyframeAt, upsertKeyframe } from './anim'

/** 文档 schema 版本（破坏性变更时递增并写迁移） */
export const MODELER_SCHEMA_VERSION = 1
/** 编辑器版本（写入 meta.editorVersion，用于诊断） */
export const MODELER_EDITOR_VERSION = '0.1.0'

/** 生成稳定 id（crypto.randomUUID 优先，测试/旧环境回退随机串） */
export function uid(prefix: string): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') {
    return `${prefix}-${c.randomUUID().slice(0, 8)}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

/* ------------------------------------------------------------------ */
/* 工厂                                                                */
/* ------------------------------------------------------------------ */

export interface CreateDocumentInput {
  id?: string
  name: string
  format: FormatId
  settings?: Partial<DocumentSettings>
  now?: number
}

/** 新建空文档（无节点、无贴图、无动画） */
export function createDocument(input: CreateDocumentInput): ModelDocument {
  const now = input.now ?? Date.now()
  return {
    schemaVersion: 1,
    id: input.id ?? uid('doc'),
    name: input.name,
    format: input.format,
    settings: {
      uvMode: input.settings?.uvMode ?? 'per_face',
      ...(input.settings?.textureSize ? { textureSize: input.settings.textureSize } : {}),
      ...(input.settings?.visibleBox ? { visibleBox: input.settings.visibleBox } : {}),
      ...(input.settings?.boxUv ? { boxUv: input.settings.boxUv } : {})
    },
    nodes: {},
    root: [],
    textures: {},
    animations: {},
    meta: {
      createdAt: now,
      updatedAt: now,
      editorVersion: MODELER_EDITOR_VERSION
    }
  }
}

export interface CubeSeed {
  from?: Vec3
  to?: Vec3
}

/** 新建立方体：默认 16³ 原点块，六面齐全（uv 0..16，暂不绑贴图） */
export function createCubeNode(name: string, seed?: CubeSeed): CubeNode {
  const from = seed?.from ?? [0, 0, 0]
  const to = seed?.to ?? [16, 16, 16]
  return {
    id: uid('n'),
    type: 'cube',
    name,
    parent: null,
    visible: true,
    locked: false,
    from: [...from] as Vec3,
    to: [...to] as Vec3,
    origin: [0, 0, 0],
    rotation: [0, 0, 0],
    shade: true,
    faces: {
      north: { uv: [0, 0, 16, 16] },
      south: { uv: [0, 0, 16, 16] },
      east: { uv: [0, 0, 16, 16] },
      west: { uv: [0, 0, 16, 16] },
      up: { uv: [0, 0, 16, 16] },
      down: { uv: [0, 0, 16, 16] }
    }
  }
}

/** 新建组/骨骼节点（pivot 在原点） */
export function createGroupNode(name: string): GroupNode {
  return {
    id: uid('n'),
    type: 'group',
    name,
    parent: null,
    visible: true,
    locked: false,
    children: [],
    origin: [0, 0, 0],
    rotation: [0, 0, 0]
  }
}

/** 新建定位器节点 */
export function createLocatorNode(name: string, position?: Vec3): LocatorNode {
  return {
    id: uid('n'),
    type: 'locator',
    name,
    parent: null,
    visible: true,
    locked: false,
    position: position ? ([...position] as Vec3) : [0, 0, 0]
  }
}

/**
 * 新建网格节点（B4-1）：默认四棱锥（几何来自 mesh.defaultMeshGeometry，
 * 在此注入避免 document ↔ mesh 循环依赖——mesh.ts 依赖 transform.ts，
 * transform.ts 依赖 document.ts）。
 */
export function createMeshNode(
  name: string,
  seed: { vertices: Vec3[]; faces: MeshNode['faces'] }
): MeshNode {
  return {
    id: uid('n'),
    type: 'mesh',
    name,
    parent: null,
    visible: true,
    locked: false,
    vertices: seed.vertices.map((v) => [...v] as Vec3),
    faces: seed.faces.map((f) => ({
      vertices: [...f.vertices],
      uv: f.uv.map((u) => [...u] as Vec2),
      ...(f.texture !== undefined ? { texture: f.texture } : {})
    })),
    origin: [0, 0, 0],
    rotation: [0, 0, 0]
  }
}

/* ------------------------------------------------------------------ */
/* 树不变量                                                            */
/* ------------------------------------------------------------------ */

/**
 * 校验文档树不变量，返回全部问题（空数组 = 合法）。
 * 检查项：表项引用存在、父子双向一致、无孤儿、无重复表项、无环、
 * 面贴图引用存在、动画通道目标节点存在。
 */
export function validateDocument(doc: ModelDocument): DocumentIssue[] {
  const issues: DocumentIssue[] = []
  const ids = new Set(Object.keys(doc.nodes))

  // 1) root 表项：必须存在、parent 必须为 null、不得重复
  const seen = new Set<NodeId>()
  for (const id of doc.root) {
    if (!ids.has(id)) {
      issues.push({ code: 'missing_node', message: `root 引用了不存在的节点 ${id}` })
      continue
    }
    if (doc.nodes[id]!.parent !== null) {
      issues.push({
        code: 'parent_child_mismatch',
        nodeId: id,
        message: `节点 ${id} 在 root 中但 parent 不为 null`
      })
    }
    if (seen.has(id)) {
      issues.push({ code: 'duplicate_entry', nodeId: id, message: `节点 ${id} 在 root 中重复出现` })
    }
    seen.add(id)
  }

  // 2) 每个节点：parent 存在性 + 父子双向一致 + 不与 root 冲突
  for (const id of ids) {
    const node = doc.nodes[id]!
    if (node.parent !== null) {
      if (!ids.has(node.parent)) {
        issues.push({
          code: 'missing_node',
          nodeId: id,
          message: `节点 ${id} 的父节点 ${node.parent} 不存在`
        })
      } else {
        const parent = doc.nodes[node.parent]!
        if (!isGroupNode(parent)) {
          issues.push({
            code: 'parent_child_mismatch',
            nodeId: id,
            message: `节点 ${id} 的父节点 ${node.parent} 不是组节点`
          })
        } else {
          const count = parent.children.filter((c) => c === id).length
          if (count === 0) {
            issues.push({
              code: 'parent_child_mismatch',
              nodeId: id,
              message: `节点 ${id} 声明父级 ${node.parent} 但未出现在其 children 中`
            })
          } else if (count > 1) {
            issues.push({
              code: 'duplicate_entry',
              nodeId: id,
              message: `节点 ${id} 在父级 ${node.parent} 的 children 中重复出现`
            })
          }
        }
      }
      if (doc.root.includes(id)) {
        issues.push({
          code: 'parent_child_mismatch',
          nodeId: id,
          message: `节点 ${id} 同时出现在 root 与父级 children 中`
        })
      }
    } else if (!doc.root.includes(id)) {
      issues.push({
        code: 'orphan_node',
        nodeId: id,
        message: `节点 ${id} 无父级也不在 root 中（孤儿节点）`
      })
    }
  }

  // 3) 组的 children 表项：必须存在、parent 必须回指该组
  for (const id of ids) {
    const node = doc.nodes[id]!
    if (!isGroupNode(node)) continue
    for (const childId of node.children) {
      if (!ids.has(childId)) {
        issues.push({
          code: 'missing_node',
          nodeId: id,
          message: `组 ${id} 的 children 引用了不存在的节点 ${childId}`
        })
        continue
      }
      const child = doc.nodes[childId]!
      if (child.parent !== id) {
        issues.push({
          code: 'parent_child_mismatch',
          nodeId: childId,
          message: `节点 ${childId} 在组 ${id} 的 children 中但 parent 字段不回指`
        })
      }
    }
  }

  // 4) 无环：沿 parent 链上行必须终止于 null
  for (const id of ids) {
    const visited = new Set<NodeId>([id])
    let cur = doc.nodes[id]!.parent
    while (cur !== null) {
      if (visited.has(cur)) {
        issues.push({
          code: 'parent_cycle',
          nodeId: id,
          message: `节点 ${id} 处于父级环上（经 ${cur}）`
        })
        break
      }
      visited.add(cur)
      cur = doc.nodes[cur]?.parent ?? null
    }
  }

  // 5) 面/动画引用
  for (const id of ids) {
    const node = doc.nodes[id]!
    if (node.type === 'cube') {
      for (const [face, binding] of Object.entries(node.faces)) {
        if (binding?.texture && !doc.textures[binding.texture]) {
          issues.push({
            code: 'texture_ref_missing',
            nodeId: id,
            message: `节点 ${id} 的 ${face} 面引用了不存在的贴图 ${binding.texture}`
          })
        }
      }
      continue
    }
    if (isMeshNode(node)) {
      node.faces.forEach((face, fi) => {
        if (face.vertices.length !== 3 && face.vertices.length !== 4) {
          issues.push({
            code: 'mesh_face_invalid',
            nodeId: id,
            message: `网格 ${id} 的第 ${fi + 1} 面顶点数 ${face.vertices.length} 非法（仅支持三角/四边面）`
          })
        }
        if (face.uv.length !== face.vertices.length) {
          issues.push({
            code: 'mesh_face_invalid',
            nodeId: id,
            message: `网格 ${id} 的第 ${fi + 1} 面 UV 数 ${face.uv.length} 与顶点数 ${face.vertices.length} 不一致`
          })
        }
        for (const vi of face.vertices) {
          if (!Number.isInteger(vi) || vi < 0 || vi >= node.vertices.length) {
            issues.push({
              code: 'mesh_face_invalid',
              nodeId: id,
              message: `网格 ${id} 的第 ${fi + 1} 面引用了越界顶点下标 ${vi}（共 ${node.vertices.length} 顶点）`
            })
            break
          }
        }
        if (face.texture && !doc.textures[face.texture]) {
          issues.push({
            code: 'texture_ref_missing',
            nodeId: id,
            message: `网格 ${id} 的第 ${fi + 1} 面引用了不存在的贴图 ${face.texture}`
          })
        }
      })
      // 逐顶点蒙皮权重（v3 C3a）：长度必须与顶点一致，组引用必须存在
      if (node.weights) {
        if (node.weights.length !== node.vertices.length) {
          issues.push({
            code: 'mesh_weights_invalid',
            nodeId: id,
            message: `网格 ${id} 的权重项数 ${node.weights.length} 与顶点数 ${node.vertices.length} 不一致`
          })
        }
        for (const [vi, w] of node.weights.entries()) {
          for (const gid of Object.keys(w)) {
            if (!ids.has(gid) || !isGroupNode(doc.nodes[gid]!)) {
              issues.push({
                code: 'mesh_weights_invalid',
                nodeId: id,
                message: `网格 ${id} 顶点 ${vi} 的权重引用了非组节点 ${gid}`
              })
              break
            }
          }
        }
      }
    }
  }
  for (const [animId, anim] of Object.entries(doc.animations)) {
    for (const nodeId of Object.keys(anim.channels)) {
      if (!ids.has(nodeId)) {
        issues.push({
          code: 'animation_node_missing',
          nodeId,
          message: `动画 ${anim.name}（${animId}）的通道引用了不存在的节点 ${nodeId}`
        })
      }
    }
  }

  return issues
}

/** 校验失败即抛错（结构操作内部/反序列化后的快速断言） */
export function assertDocumentInvariants(doc: ModelDocument): void {
  const issues = validateDocument(doc)
  if (issues.length > 0) {
    throw new Error(`文档不变量被破坏：${issues.map((i) => i.message).join('；')}`)
  }
}

/* ------------------------------------------------------------------ */
/* 查询与遍历                                                          */
/* ------------------------------------------------------------------ */

/** 指定父级的子表 id 列表（parentId=null → root 顶层顺序） */
export function childrenIdsOf(doc: ModelDocument, parentId: NodeId | null): NodeId[] {
  if (parentId === null) return doc.root
  const parent = doc.nodes[parentId]
  if (!parent || !isGroupNode(parent)) return []
  return parent.children
}

/** 收集子树 id（含自身），按 children 顺序深度优先；节点不存在返回空数组 */
export function subtreeIds(doc: ModelDocument, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const walk = (nid: NodeId): void => {
    const node = doc.nodes[nid]
    if (!node) return
    out.push(nid)
    if (isGroupNode(node)) for (const c of node.children) walk(c)
  }
  walk(id)
  return out
}

/** ancestorId 是否为 id 的祖先（不含自身） */
export function isAncestor(doc: ModelDocument, ancestorId: NodeId, id: NodeId): boolean {
  let cur = doc.nodes[id]?.parent ?? null
  while (cur !== null) {
    if (cur === ancestorId) return true
    cur = doc.nodes[cur]?.parent ?? null
  }
  return false
}

/** 节点深度（顶层 = 0；节点不存在返回 -1） */
export function depthOf(doc: ModelDocument, id: NodeId): number {
  let depth = 0
  let cur = doc.nodes[id]?.parent ?? null
  while (cur !== null) {
    depth++
    cur = doc.nodes[cur]?.parent ?? null
  }
  return doc.nodes[id] ? depth : -1
}

/**
 * 选中集「顶层化」：去除祖先也在选中集内的 id（避免父子同时选中时变换被重复施加），
 * 去重并忽略未知 id。顺序保持传入顺序。
 */
export function effectiveSelection(doc: ModelDocument, ids: readonly NodeId[]): NodeId[] {
  const known = ids.filter((id) => !!doc.nodes[id])
  const set = new Set(known)
  return known.filter((id) => {
    let cur = doc.nodes[id]!.parent
    let guard = 0
    while (cur !== null && guard++ < 256) {
      if (set.has(cur)) return false
      cur = doc.nodes[cur]?.parent ?? null
    }
    return true
  })
}

/** 深度优先前序遍历（root 顺序展开），visit 返回 false 可提前终止 */
export function walkTree(
  doc: ModelDocument,
  visit: (node: ModelNode, depth: number) => void | false
): void {
  const walk = (id: NodeId, depth: number): boolean => {
    const node = doc.nodes[id]
    if (!node) return true
    if (visit(node, depth) === false) return false
    if (isGroupNode(node)) {
      for (const c of node.children) {
        if (!walk(c, depth + 1)) return false
      }
    }
    return true
  }
  for (const id of doc.root) {
    if (!walk(id, 0)) return
  }
}

/** 深拷贝文档（所有字段 JSON 安全，JSON 往返即等价深拷贝） */
export function cloneDocument(doc: ModelDocument): ModelDocument {
  return JSON.parse(JSON.stringify(doc)) as ModelDocument
}

/* ------------------------------------------------------------------ */
/* 结构操作（全部不可变更新）                                          */
/* ------------------------------------------------------------------ */

/** 带元数据更新的返回（所有公开变更操作共用） */
function withMeta(doc: ModelDocument, now?: number): ModelDocument {
  return { ...doc, meta: { ...doc.meta, updatedAt: now ?? Date.now() } }
}

/** 手动刷新 updatedAt（store 层直改文档后调用） */
export function touch(doc: ModelDocument, now?: number): ModelDocument {
  return withMeta(doc, now)
}

/** 取指定父级的子表（内部）；父级不存在或非组时抛错 */
function requireList(doc: ModelDocument, parentId: NodeId | null): NodeId[] {
  if (parentId === null) return doc.root
  const parent = doc.nodes[parentId]
  if (!parent || !isGroupNode(parent)) {
    throw new Error(`父级 ${parentId} 不存在或不是组节点`)
  }
  return parent.children
}

/** 替换指定父级的子表，返回新文档（不可变） */
function withList(doc: ModelDocument, parentId: NodeId | null, list: NodeId[]): ModelDocument {
  if (parentId === null) return { ...doc, root: list }
  const parent = doc.nodes[parentId]
  if (!parent || !isGroupNode(parent)) {
    throw new Error(`父级 ${parentId} 不存在或不是组节点`)
  }
  return { ...doc, nodes: { ...doc.nodes, [parentId]: { ...parent, children: list } } }
}

/** 规范化插入下标（缺省/负数/越界 → 末尾） */
function normalizeIndex(index: number | undefined, listLength: number): number {
  if (index === undefined || index < 0 || index > listLength) return listLength
  return index
}

/**
 * 添加新节点到指定父级（null = 顶层）。index 缺省 = 追加到末尾。
 * 节点 id 不得已存在；父级必须存在（null 除外）。
 */
export function addNode(
  doc: ModelDocument,
  node: ModelNode,
  parentId: NodeId | null,
  index?: number
): ModelDocument {
  if (doc.nodes[node.id]) throw new Error(`节点 ${node.id} 已存在`)
  const list = requireList(doc, parentId)
  const at = normalizeIndex(index, list.length)
  const stored: ModelNode = { ...node, parent: parentId }
  const nextList = [...list.slice(0, at), node.id, ...list.slice(at)]
  const withNode: ModelDocument = { ...doc, nodes: { ...doc.nodes, [node.id]: stored } }
  return withMeta(withList(withNode, parentId, nextList))
}

/**
 * 移动已有节点（连同子树）到指定父级（null = 顶层），index 缺省 = 追加末尾。
 * 拒绝把节点移进它自己的子树（成环）。
 */
export function moveNode(
  doc: ModelDocument,
  id: NodeId,
  parentId: NodeId | null,
  index?: number
): ModelDocument {
  const node = doc.nodes[id]
  if (!node) throw new Error(`节点 ${id} 不存在`)
  if (parentId !== null) {
    if (!doc.nodes[parentId]) throw new Error(`父级 ${parentId} 不存在`)
    if (subtreeIds(doc, id).includes(parentId)) {
      throw new Error(`不能把节点 ${id} 移动到它自己的子树内（${parentId}）`)
    }
  }
  // 从旧表摘除
  const oldList = requireList(doc, node.parent).filter((x) => x !== id)
  let next = withList(doc, node.parent, oldList)
  // 插入新表（index 相对摘除后的目标表）
  const targetList = requireList(next, parentId)
  const at = normalizeIndex(index, targetList.length)
  next = withList(next, parentId, [...targetList.slice(0, at), id, ...targetList.slice(at)])
  next = { ...next, nodes: { ...next.nodes, [id]: { ...node, parent: parentId } } }
  return withMeta(next)
}

/**
 * 删除节点集合（各自连同子树），并清理动画通道对已删节点的引用。
 * 未知 id 静默跳过；同一子树被重复请求时天然去重。
 */
export function removeNodes(doc: ModelDocument, ids: readonly NodeId[]): ModelDocument {
  const removed = new Set<NodeId>()
  for (const id of ids) {
    if (!doc.nodes[id] || removed.has(id)) continue
    for (const nid of subtreeIds(doc, id)) removed.add(nid)
  }
  if (removed.size === 0) return doc

  const nodes: Record<NodeId, ModelNode> = {}
  const validGroups = new Set<NodeId>()
  for (const id of Object.keys(doc.nodes)) {
    if (!removed.has(id) && isGroupNode(doc.nodes[id]!)) validGroups.add(id)
  }
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (removed.has(id)) continue
    if (isGroupNode(node)) {
      nodes[id] = { ...node, children: node.children.filter((c) => !removed.has(c)) }
    } else if (isMeshNode(node) && node.weights) {
      // 组被删 → 清掉网格逐顶点权重里对这些组的引用（v3 C3a）
      const weights = pruneVertexWeights(node.weights, validGroups)
      nodes[id] = weights ? { ...node, weights } : node
    } else {
      nodes[id] = node
    }
  }

  const animations: Record<AnimationId, ModelAnimation> = {}
  for (const [animId, anim] of Object.entries(doc.animations)) {
    const channels: typeof anim.channels = {}
    for (const [nodeId, ch] of Object.entries(anim.channels)) {
      if (!removed.has(nodeId)) channels[nodeId] = ch
    }
    animations[animId] = { ...anim, channels }
  }

  return withMeta({ ...doc, nodes, root: doc.root.filter((id) => !removed.has(id)), animations })
}

/** 在同一父级表内重排（from/to 为表内下标；parentId=null → root）。父级非法/下标非法/相等时原样返回。 */
export function reorderInList(
  doc: ModelDocument,
  parentId: NodeId | null,
  from: number,
  to: number
): ModelDocument {
  if (parentId !== null) {
    const p = doc.nodes[parentId]
    if (!p || !isGroupNode(p)) return doc
  }
  const list = requireList(doc, parentId)
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return doc
  const next = list.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return withMeta(withList(doc, parentId, next))
}

export interface DuplicateResult {
  doc: ModelDocument
  /** 原顶层请求 id → 复制后的新 id（仅含实际复制的顶层节点） */
  idMap: Record<NodeId, NodeId>
}

/**
 * 复制节点子树：全部换新 id，副本插入到原节点在同一表内的紧后位置。
 * 顶层副本名追加“-副本”，子级保持原名。未知 id 跳过。
 */
export function duplicateNodes(doc: ModelDocument, ids: readonly NodeId[]): DuplicateResult {
  let next = doc
  const idMap: Record<NodeId, NodeId> = {}
  for (const id of ids) {
    const src = next.nodes[id]
    if (!src) continue
    const parentId = src.parent
    const copies: ModelNode[] = []
    // 深拷贝子树：换 id + 逐级重写 parent 指向副本链（JSON 克隆保留的是原父级 id）
    const walk = (nid: NodeId, newParent: NodeId | null): ModelNode => {
      const node = next.nodes[nid]!
      const newId = uid('n')
      const base = JSON.parse(JSON.stringify(node)) as ModelNode
      base.id = newId
      base.parent = newParent
      if (isGroupNode(base) && isGroupNode(node)) {
        base.children = node.children.map((c) => walk(c, newId).id)
      }
      copies.push(base)
      return base
    }
    const topCopy = walk(id, parentId)
    topCopy.name = `${src.name}-副本`

    const nodes = { ...next.nodes }
    for (const c of copies) nodes[c.id] = c
    next = { ...next, nodes }
    const list = requireList(next, parentId)
    const at = list.indexOf(id)
    const insertAt = at >= 0 ? at + 1 : list.length
    next = withList(next, parentId, [
      ...list.slice(0, insertAt),
      topCopy.id,
      ...list.slice(insertAt)
    ])
    idMap[id] = topCopy.id
  }
  return { doc: withMeta(next), idMap }
}

/* ------------------------------------------------------------------ */
/* 字段级操作                                                          */
/* ------------------------------------------------------------------ */

/** 重命名节点（未知 id 原样返回） */
export function renameNode(doc: ModelDocument, id: NodeId, name: string): ModelDocument {
  const node = doc.nodes[id]
  if (!node) return doc
  return withMeta({ ...doc, nodes: { ...doc.nodes, [id]: { ...node, name } } })
}

/**
 * 字段级补丁（浅合并）。结构字段（id/parent/children）不在补丁类型内，
 * 即便被强转传入也会在此还原——结构变更必须走 addNode/moveNode/removeNodes。
 */
export type NodePatch = Partial<
  Pick<
    CubeNode,
    | 'name'
    | 'visible'
    | 'locked'
    | 'from'
    | 'to'
    | 'origin'
    | 'rotation'
    | 'inflate'
    | 'shade'
    | 'boxUv'
  > &
    Pick<GroupNode, 'origin' | 'rotation' | 'scale'> &
    Pick<LocatorNode, 'position'> &
    Pick<MeshNode, 'origin' | 'rotation' | 'vertices' | 'weights'> & {
      /** cube 与 mesh 的 faces 结构不同，做联合而非交叉（交叉类型不可满足） */
      faces?: CubeNode['faces'] | MeshNode['faces']
    }
>

export function patchNode(doc: ModelDocument, id: NodeId, patch: NodePatch): ModelDocument {
  const node = doc.nodes[id]
  if (!node) return doc
  const safe = { ...node, ...patch } as ModelNode
  // 显式传 undefined 的可选字段 = 移除该键（保持文档 JSON 干净）
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (safe as unknown as Record<string, unknown>)[k]
  }
  // 结构字段还原（防调用方绕过类型系统）
  safe.id = node.id
  safe.parent = node.parent
  if (isGroupNode(node) && isGroupNode(safe)) safe.children = node.children
  return withMeta({ ...doc, nodes: { ...doc.nodes, [id]: safe } })
}

/* ------------------------------------------------------------------ */
/* 贴图操作                                                            */
/* ------------------------------------------------------------------ */

/** 新建贴图登记（data 为调用方生成的透明 PNG data URL；元数据不可变插入） */
export function addTexture(doc: ModelDocument, tex: ModelTexture): ModelDocument {
  return withMeta({ ...doc, textures: { ...doc.textures, [tex.id]: tex } })
}

/** 贴图字段更新（绘画落笔 / 重命名 / 显隐）；未知 id 原样返回 */
export function patchTexture(
  doc: ModelDocument,
  id: TextureId,
  patch: Partial<Pick<ModelTexture, 'name' | 'data' | 'width' | 'height' | 'uvSize' | 'visible'>>
): ModelDocument {
  const tex = doc.textures[id]
  if (!tex) return doc
  return withMeta({ ...doc, textures: { ...doc.textures, [id]: { ...tex, ...patch } } })
}

/**
 * 设置/清除贴图 flipbook 动画元数据（B2-1）。
 * null = 删除 animation 键（保持文档 JSON 干净）；写入时归一化
 * （interpolate 仅真值保留、frames 空数组丢弃、数组深拷贝）。
 */
export function setTextureAnimation(
  doc: ModelDocument,
  id: TextureId,
  animation: TextureAnimation | null
): ModelDocument {
  const tex = doc.textures[id]
  if (!tex) return doc
  const next = { ...tex }
  if (animation) {
    const clean: TextureAnimation = { frametime: animation.frametime }
    if (animation.interpolate) clean.interpolate = true
    if (animation.frames && animation.frames.length > 0) clean.frames = [...animation.frames]
    next.animation = clean
  } else {
    delete next.animation
  }
  return withMeta({ ...doc, textures: { ...doc.textures, [id]: next } })
}

/** 删除贴图并清理所有节点 faces 中对它的 texture 引用（uv 坐标保留） */
export function removeTexture(doc: ModelDocument, id: TextureId): ModelDocument {
  if (!doc.textures[id]) return doc
  const textures = { ...doc.textures }
  delete textures[id]
  const nodes: Record<NodeId, ModelNode> = {}
  let changed = false
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (isMeshNode(node)) {
      let meshChanged = false
      const faces = node.faces.map((f) => {
        if (f.texture !== id) return f
        const { texture: _drop, ...rest } = f
        meshChanged = true
        return rest
      })
      nodes[nid] = meshChanged ? { ...node, faces } : node
      changed = changed || meshChanged
      continue
    }
    if (!isCubeNode(node)) {
      nodes[nid] = node
      continue
    }
    let nodeChanged = false
    const faces: Partial<Record<FaceName, FaceBinding>> = {}
    for (const [face, binding] of Object.entries(node.faces) as [FaceName, FaceBinding][]) {
      if (binding.texture === id) {
        const { texture: _drop, ...rest } = binding
        faces[face] = rest
        nodeChanged = true
      } else {
        faces[face] = binding
      }
    }
    nodes[nid] = nodeChanged ? { ...node, faces } : node
    changed = changed || nodeChanged
  }
  return withMeta(changed ? { ...doc, textures, nodes } : { ...doc, textures })
}

/* ------------------------------------------------------------------ */
/* 动画操作（P4-a；采样与插值数学见 anim.ts）                             */
/* ------------------------------------------------------------------ */

/** 新建动画（默认 2 秒、循环、无通道） */
export function createAnimation(name: string, seed?: { length?: number; loop?: LoopMode }): ModelAnimation {
  return {
    id: uid('anim'),
    name,
    length: seed?.length ?? 2,
    loop: seed?.loop ?? 'loop',
    channels: {}
  }
}

/** 新建动画登记（id 冲突抛错） */
export function addAnimation(doc: ModelDocument, anim: ModelAnimation): ModelDocument {
  if (doc.animations[anim.id]) throw new Error(`动画 ${anim.id} 已存在`)
  return withMeta({ ...doc, animations: { ...doc.animations, [anim.id]: anim } })
}

/** 动画元信息更新（重命名/时长/循环模式）；未知 id 原样返回 */
export function patchAnimation(
  doc: ModelDocument,
  id: AnimationId,
  patch: Partial<Pick<ModelAnimation, 'name' | 'length' | 'loop'>>
): ModelDocument {
  const anim = doc.animations[id]
  if (!anim) return doc
  return withMeta({ ...doc, animations: { ...doc.animations, [id]: { ...anim, ...patch } } })
}

/** 删除动画；未知 id 原样返回 */
export function removeAnimation(doc: ModelDocument, id: AnimationId): ModelDocument {
  if (!doc.animations[id]) return doc
  const animations = { ...doc.animations }
  delete animations[id]
  return withMeta({ ...doc, animations })
}

/**
 * 插入/替换关键帧：目标节点通道不存在时自动建立；
 * 与已有帧时间差 ≤ eps 视为同一帧（替换值与插值）。动画/节点未知时抛错。
 */
export function upsertAnimationKeyframe(
  doc: ModelDocument,
  animId: AnimationId,
  nodeId: NodeId,
  channel: AnimationChannelName,
  kf: Keyframe
): ModelDocument {
  const anim = doc.animations[animId]
  if (!anim) throw new Error(`动画 ${animId} 不存在`)
  if (!doc.nodes[nodeId]) throw new Error(`节点 ${nodeId} 不存在`)
  const channels = anim.channels[nodeId] ?? {}
  const next = upsertKeyframe(channels[channel] ?? [], kf)
  return withMeta({
    ...doc,
    animations: {
      ...doc.animations,
      [animId]: { ...anim, channels: { ...anim.channels, [nodeId]: { ...channels, [channel]: next } } }
    }
  })
}

/**
 * 删除指定时间点的关键帧：通道删空时移除该通道，节点通道全空时移除节点条目
 * （保持 validateDocument 的 animation_node_missing 语义干净）。动画未知时抛错。
 */
export function removeAnimationKeyframe(
  doc: ModelDocument,
  animId: AnimationId,
  nodeId: NodeId,
  channel: AnimationChannelName,
  time: number
): ModelDocument {
  const anim = doc.animations[animId]
  if (!anim) throw new Error(`动画 ${animId} 不存在`)
  const channels = anim.channels[nodeId]
  const keys = channels?.[channel]
  if (!channels || !keys) return doc
  const next = removeKeyframeAt(keys, time)
  if (next === keys) return doc // 无匹配帧
  const nextChannels: NodeAnimationChannels = { ...channels }
  if (next.length === 0) delete nextChannels[channel]
  else nextChannels[channel] = next
  const nextAnimChannels = { ...anim.channels }
  if (Object.keys(nextChannels).length === 0) delete nextAnimChannels[nodeId]
  else nextAnimChannels[nodeId] = nextChannels
  return withMeta({ ...doc, animations: { ...doc.animations, [animId]: { ...anim, channels: nextAnimChannels } } })
}

/* ------------------------------------------------------------------ */
/* 序列化                                                              */
/* ------------------------------------------------------------------ */

/** 反序列化错误（携带全部校验问题，UI 可直接展示） */
export class ModelerDocumentError extends Error {
  readonly issues: DocumentIssue[]
  constructor(message: string, issues: DocumentIssue[]) {
    super(message)
    this.name = 'ModelerDocumentError'
    this.issues = issues
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 解析 + 最小结构检查 + 完整不变量校验；非法输入抛 ModelerDocumentError */
export function deserializeDocument(raw: unknown): ModelDocument {
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch (e) {
      throw new ModelerDocumentError(`文档 JSON 解析失败：${String(e)}`, [])
    }
  }
  if (!isRecord(data)) throw new ModelerDocumentError('文档必须是 JSON 对象', [])
  if (data.schemaVersion !== MODELER_SCHEMA_VERSION) {
    throw new ModelerDocumentError(
      `不支持的文档版本 ${String(data.schemaVersion)}（当前 ${MODELER_SCHEMA_VERSION}）`,
      []
    )
  }
  if (
    !isRecord(data.nodes) ||
    !Array.isArray(data.root) ||
    !isRecord(data.textures) ||
    !isRecord(data.animations) ||
    !isRecord(data.meta)
  ) {
    throw new ModelerDocumentError('文档缺少 nodes/root/textures/animations/meta 结构', [])
  }
  const doc = data as unknown as ModelDocument
  const issues = validateDocument(doc)
  if (issues.length > 0) {
    throw new ModelerDocumentError(`文档校验失败（${issues.length} 个问题）`, issues)
  }
  return doc
}

/** 序列化为 JSON 字符串（pretty，落盘 .kunyu/modeler/<id>.json 直接可用） */
export function serializeDocument(doc: ModelDocument): string {
  return JSON.stringify(doc, null, 2)
}
