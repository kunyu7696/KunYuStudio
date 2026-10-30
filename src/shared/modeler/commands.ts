/**
 * 文档级命令与撤销栈（方案 §4.3）。
 *
 * 设计要点：
 * - 命令记录「被触及条目」的 before/after 补丁（节点/贴图/动画按 id 记录变更值与删除项，
 *   root/display 整体替换），不整树克隆；补丁由 diffDocument 基于不可变文档的引用差分生成；
 * - CommandStack 只负责顺序/合并/事务/保存点，不持有文档：undo/redo 返回命令，
 *   由调用方（store）执行 revertCommand/applyCommand 并恢复选择，保持 shared 层纯净；
 * - 前提：ModelDocument 及其节点/贴图/动画对象按不可变约定使用（document.ts 已保证），
 *   命令捕获的是引用；若调用方就地修改对象，撤销将无法恢复。
 * - 本模块不依赖 DOM/three/Electron；补丁为纯 JSON 数据，未来可经 IPC 复用。
 */
import type {
  AnimationId,
  ModelAnimation,
  ModelDocument,
  ModelNode,
  ModelTexture,
  NodeId,
  TextureId
} from './types'

/* ------------------------------------------------------------------ */
/* 补丁                                                                */
/* ------------------------------------------------------------------ */

/**
 * 文档补丁：可应用到任意文档快照上的一组变更。
 * setX 为变更后的完整对象（覆盖同 id），removedXIds 为删除项；
 * 应用顺序 = 先删后设（支持「删除后重建」在同一补丁内表达）。
 */
export interface DocumentPatch {
  setNodes?: Record<NodeId, ModelNode>
  removedNodeIds?: NodeId[]
  setRoot?: NodeId[]
  setTextures?: Record<TextureId, ModelTexture>
  removedTextureIds?: TextureId[]
  setAnimations?: Record<AnimationId, ModelAnimation>
  removedAnimationIds?: AnimationId[]
  /** 引用变化即整体替换；null = 清空 display */
  display?: ModelDocument['display'] | null
  metaUpdatedAt?: number
}

function hasKeys(record: Record<string, unknown> | undefined): boolean {
  return !!record && Object.keys(record).length > 0
}

/** 应用补丁（不可变：返回新文档对象） */
export function applyPatch(doc: ModelDocument, patch: DocumentPatch): ModelDocument {
  let nodes = doc.nodes
  let textures = doc.textures
  let animations = doc.animations
  if (patch.removedNodeIds?.length) {
    nodes = { ...nodes }
    for (const id of patch.removedNodeIds) delete nodes[id]
  }
  if (hasKeys(patch.setNodes)) nodes = { ...nodes, ...patch.setNodes }
  if (patch.removedTextureIds?.length) {
    textures = { ...textures }
    for (const id of patch.removedTextureIds) delete textures[id]
  }
  if (hasKeys(patch.setTextures)) textures = { ...textures, ...patch.setTextures }
  if (patch.removedAnimationIds?.length) {
    animations = { ...animations }
    for (const id of patch.removedAnimationIds) delete animations[id]
  }
  if (hasKeys(patch.setAnimations)) animations = { ...animations, ...patch.setAnimations }
  return {
    ...doc,
    nodes,
    textures,
    animations,
    root: patch.setRoot ?? doc.root,
    display: patch.display === undefined ? doc.display : (patch.display ?? undefined),
    meta: { ...doc.meta, updatedAt: patch.metaUpdatedAt ?? doc.meta.updatedAt }
  }
}

/**
 * 引用差分：比较两份不可变文档，生成「before → after」补丁。
 * 条目级按引用比较（document.ts 的不可变更新保证未触及条目引用不变）；
 * root/display/贴图/动画同理。完全一致时返回 null。
 */
export function diffDocument(before: ModelDocument, after: ModelDocument): DocumentPatch | null {
  const patch: DocumentPatch = {}
  let touched = false

  const diffRecord = <T>(
    b: Record<string, T>,
    a: Record<string, T>,
    setKey: 'setNodes' | 'setTextures' | 'setAnimations',
    removedKey: 'removedNodeIds' | 'removedTextureIds' | 'removedAnimationIds'
  ): boolean => {
    let changed = false
    const set: Record<string, T> = {}
    const removed: string[] = []
    const ids = new Set([...Object.keys(b), ...Object.keys(a)])
    for (const id of ids) {
      const beforeValue = b[id]
      const afterValue = a[id]
      if (beforeValue === afterValue) continue
      if (afterValue) set[id] = afterValue
      else removed.push(id)
      changed = true
    }
    if (hasKeys(set)) (patch as Record<string, unknown>)[setKey] = set
    if (removed.length) (patch as Record<string, unknown>)[removedKey] = removed
    return changed
  }

  // 三个差分必须全部执行（有副作用写 patch），不能用短路 ||
  const nodesChanged = diffRecord(before.nodes, after.nodes, 'setNodes', 'removedNodeIds')
  const texturesChanged = diffRecord(before.textures, after.textures, 'setTextures', 'removedTextureIds')
  const animationsChanged = diffRecord(
    before.animations,
    after.animations,
    'setAnimations',
    'removedAnimationIds'
  )
  touched = nodesChanged || texturesChanged || animationsChanged || touched
  if (before.root !== after.root) {
    patch.setRoot = after.root
    touched = true
  }
  if (before.display !== after.display) {
    patch.display = after.display ?? null
    touched = true
  }
  if (before.meta.updatedAt !== after.meta.updatedAt) {
    patch.metaUpdatedAt = after.meta.updatedAt
    touched = true
  }
  return touched ? patch : null
}

/* ------------------------------------------------------------------ */
/* 补丁合并                                                            */
/* ------------------------------------------------------------------ */

/**
 * 顺序合并两个补丁（语义 = 先应用 a 再应用 b ≡ 单补丁）。
 * 冲突规则：b 优先——b 的 set 覆盖 a 的 set/removed；b 的 remove 抵消 a 的 set；
 * root/display/meta 整体取 b（b 未提及则取 a）。
 */
export function mergePatches(a: DocumentPatch, b: DocumentPatch): DocumentPatch {
  const out: DocumentPatch = {}

  const mergeRecord = <T>(
    aSet: Record<string, T> | undefined,
    aRemoved: string[] | undefined,
    bSet: Record<string, T> | undefined,
    bRemoved: string[] | undefined,
    setKey: 'setNodes' | 'setTextures' | 'setAnimations',
    removedKey: 'removedNodeIds' | 'removedTextureIds' | 'removedAnimationIds'
  ): void => {
    const set: Record<string, T> = { ...(aSet ?? {}) }
    const removed = new Set(aRemoved ?? [])
    for (const id of bRemoved ?? []) {
      delete set[id]
      removed.add(id)
    }
    // b 的 set 优先于一切（覆盖 a 的 set/removed，也补入新增键）
    Object.assign(set, bSet ?? {})
    for (const id of Object.keys(bSet ?? {})) removed.delete(id)
    if (hasKeys(set)) (out as Record<string, unknown>)[setKey] = set
    if (removed.size) (out as Record<string, unknown>)[removedKey] = [...removed]
  }

  mergeRecord(
    a.setNodes,
    a.removedNodeIds,
    b.setNodes,
    b.removedNodeIds,
    'setNodes',
    'removedNodeIds'
  )
  mergeRecord(
    a.setTextures,
    a.removedTextureIds,
    b.setTextures,
    b.removedTextureIds,
    'setTextures',
    'removedTextureIds'
  )
  mergeRecord(
    a.setAnimations,
    a.removedAnimationIds,
    b.setAnimations,
    b.removedAnimationIds,
    'setAnimations',
    'removedAnimationIds'
  )
  if (b.setRoot !== undefined) out.setRoot = b.setRoot
  else if (a.setRoot !== undefined) out.setRoot = a.setRoot
  if (b.display !== undefined) out.display = b.display
  else if (a.display !== undefined) out.display = a.display
  out.metaUpdatedAt = b.metaUpdatedAt ?? a.metaUpdatedAt
  return out
}

/* ------------------------------------------------------------------ */
/* 命令                                                                */
/* ------------------------------------------------------------------ */

export interface ModelerCommand {
  label: string
  before: DocumentPatch
  after: DocumentPatch
  /** 合并键：同键的连续 execute 合并为一条命令（连续拖拽/属性输入） */
  mergeKey?: string
  selectionBefore?: NodeId[]
  selectionAfter?: NodeId[]
}

/** 应用命令（文档进入 after 态） */
export function applyCommand(doc: ModelDocument, command: ModelerCommand): ModelDocument {
  return applyPatch(doc, command.after)
}

/** 回退命令（文档回到 before 态） */
export function revertCommand(doc: ModelDocument, command: ModelerCommand): ModelDocument {
  return applyPatch(doc, command.before)
}

/** 合并两条连续命令为一条（b 在 a 之后执行） */
export function coalesceCommands(a: ModelerCommand, b: ModelerCommand): ModelerCommand {
  return {
    label: a.label,
    mergeKey: a.mergeKey,
    // 回退顺序 = 先回退 b 再回退 a；应用顺序 = 先 a 后 b
    before: mergePatches(b.before, a.before),
    after: mergePatches(a.after, b.after),
    selectionBefore: a.selectionBefore ?? b.selectionBefore,
    selectionAfter: b.selectionAfter ?? a.selectionAfter
  }
}

/** 把命令列表折叠为单条事务命令（按执行顺序） */
export function mergeCommandList(commands: readonly ModelerCommand[], label: string): ModelerCommand {
  const first = commands[0]!
  const last = commands[commands.length - 1]!
  let after = first.after
  for (let i = 1; i < commands.length; i++) after = mergePatches(after, commands[i]!.after)
  let before = last.before
  for (let i = commands.length - 2; i >= 0; i--) before = mergePatches(before, commands[i]!.before)
  let selectionAfter = last.selectionAfter
  for (let i = commands.length - 2; i >= 0 && !selectionAfter; i--) {
    selectionAfter = commands[i]!.selectionAfter
  }
  return {
    label,
    before,
    after,
    selectionBefore: first.selectionBefore,
    selectionAfter
  }
}

export interface TransformResult {
  /** 无实际变更（diff 为空）时为 null */
  command: ModelerCommand | null
  /** transform 之后的文档（无论是否产生命令） */
  doc: ModelDocument
}

export interface CommandExtras {
  mergeKey?: string
  selectionBefore?: NodeId[]
  selectionAfter?: NodeId[]
}

/**
 * 执行一次文档变换并生成命令：
 * transform 返回新文档（document.ts 的不可变操作），差分得到 before/after 补丁。
 */
export function commandFromTransform(
  doc: ModelDocument,
  label: string,
  transform: (d: ModelDocument) => ModelDocument,
  extras?: CommandExtras
): TransformResult {
  const next = transform(doc)
  const after = diffDocument(doc, next)
  if (!after) return { command: null, doc: next }
  const before = diffDocument(next, doc)
  return {
    command: {
      label,
      before: before!,
      after,
      ...(extras?.mergeKey !== undefined ? { mergeKey: extras.mergeKey } : {}),
      ...(extras?.selectionBefore !== undefined ? { selectionBefore: extras.selectionBefore } : {}),
      ...(extras?.selectionAfter !== undefined ? { selectionAfter: extras.selectionAfter } : {})
    },
    doc: next
  }
}

/* ------------------------------------------------------------------ */
/* 命令栈                                                              */
/* ------------------------------------------------------------------ */

export type ExecuteOptions = CommandExtras

export interface CommandStackOptions {
  /** 撤销历史上限（默认 200 步） */
  limit?: number
}

export const DEFAULT_COMMAND_LIMIT = 200

/**
 * 撤销/重做栈。不持有文档：undo/redo 返回命令，由调用方执行补丁。
 * - execute：入栈并清空 redo；同 mergeKey 的栈顶命令自动合并；
 * - beginTransaction/commitTransaction：缓冲期内的 execute 聚合为单条命令；
 * - snapshotSelection：为栈顶命令补记撤销后选择；
 * - revision/markSaved：驱动标题脏标记与关闭确认。
 */
export class CommandStack {
  private undoStack: ModelerCommand[] = []
  private redoStack: ModelerCommand[] = []
  private txnLabel: string | null = null
  private txnBuffer: ModelerCommand[] = []
  private rev = 0
  private savedRev = 0
  readonly limit: number

  constructor(options?: CommandStackOptions) {
    this.limit = options?.limit ?? DEFAULT_COMMAND_LIMIT
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0
  }
  get size(): number {
    return this.undoStack.length
  }
  get revision(): number {
    return this.rev
  }
  get isDirty(): boolean {
    return this.rev !== this.savedRev
  }

  execute(command: ModelerCommand, options?: ExecuteOptions): void {
    const stored: ModelerCommand = { ...command, ...(options ?? {}) }
    if (this.txnLabel !== null) {
      this.txnBuffer.push(stored)
      this.rev++
      return
    }
    const top = this.undoStack[this.undoStack.length - 1]
    if (stored.mergeKey !== undefined && top && top.mergeKey === stored.mergeKey) {
      this.undoStack[this.undoStack.length - 1] = coalesceCommands(top, stored)
    } else {
      this.undoStack.push(stored)
      if (this.undoStack.length > this.limit) this.undoStack.shift()
    }
    this.redoStack = []
    this.rev++
  }

  /** 事务中返回 null（拖拽中途禁止撤销） */
  undo(): ModelerCommand | null {
    if (this.txnLabel !== null) return null
    const command = this.undoStack.pop()
    if (!command) return null
    this.redoStack.push(command)
    this.rev++
    return command
  }

  redo(): ModelerCommand | null {
    if (this.txnLabel !== null) return null
    const command = this.redoStack.pop()
    if (!command) return null
    this.undoStack.push(command)
    this.rev++
    return command
  }

  /** 开始事务（重复 begin 忽略）；事务内 execute 只进缓冲不入栈 */
  beginTransaction(label: string): void {
    if (this.txnLabel !== null) return
    this.txnLabel = label
    this.txnBuffer = []
  }

  /** 提交事务：缓冲命令折叠为单条入栈；空事务/未 begin 为 no-op */
  commitTransaction(): void {
    if (this.txnLabel === null) return
    const label = this.txnLabel
    const buffer = this.txnBuffer
    this.txnLabel = null
    this.txnBuffer = []
    if (buffer.length === 0) return
    this.undoStack.push(mergeCommandList(buffer, label))
    if (this.undoStack.length > this.limit) this.undoStack.shift()
    this.redoStack = []
    this.rev++
  }

  /** 丢弃事务缓冲（拖拽被取消时用） */
  cancelTransaction(): void {
    this.txnLabel = null
    this.txnBuffer = []
  }

  /** 为栈顶命令补记撤销后的选择（已设置时保留原值） */
  snapshotSelection(selection: NodeId[]): void {
    const top = this.undoStack[this.undoStack.length - 1]
    if (top && top.selectionAfter === undefined) top.selectionAfter = selection
  }

  /** 标记当前为已保存状态（保存/无变更落盘后调用） */
  markSaved(): void {
    this.savedRev = this.rev
  }

  /** 清空历史（打开/替换文档时调用）；revision 保持单调 */
  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.txnLabel = null
    this.txnBuffer = []
    this.savedRev = this.rev
  }
}
