import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  applyCommand,
  applyPatch,
  CommandStack,
  coalesceCommands,
  commandFromTransform,
  DEFAULT_COMMAND_LIMIT,
  diffDocument,
  mergePatches,
  revertCommand
} from '../commands'
import {
  addNode,
  createCubeNode,
  createDocument,
  createGroupNode,
  moveNode,
  patchNode,
  removeNodes,
  renameNode,
  reorderInList,
  subtreeIds,
  touch,
  validateDocument
} from '../document'
import type { ModelAnimation, ModelDocument, ModelTexture } from '../types'

/** 递归排序键后序列化（内容相等性比较，忽略键序差异） */
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k]
      return sorted
    }
    return v
  })
}

function makeTexture(id: string, mark: string): ModelTexture {
  return { id, name: `贴图 ${id}`, width: 16, height: 16, data: `data:image/png;base64,${mark}`, visible: true }
}

function makeAnimation(id: string, targets: string[]): ModelAnimation {
  return {
    id,
    name: `动画 ${id}`,
    length: 1,
    loop: 'once',
    channels: Object.fromEntries(
      targets.map((t) => [
        t,
        { rotation: [{ time: 0, value: [0, 0, 0] as [number, number, number], interpolation: 'linear' as const }] }
      ])
    )
  }
}

/** 构建固定测试文档：root: [cube1, group1[locator1, cube2], cube3] + 一张贴图 + 一段动画 */
function fixture(): { doc: ModelDocument; ids: Record<string, string> } {
  let doc = createDocument({ id: 'doc-test', name: '测试文档', format: 'java_block', now: 1000 })
  const cube1 = createCubeNode('立方体 1', { from: [0, 0, 0], to: [8, 8, 8] })
  const group1 = createGroupNode('骨骼 1')
  const cube2 = createCubeNode('立方体 2')
  const cube3 = createCubeNode('立方体 3')
  doc = addNode(doc, cube1, null)
  doc = addNode(doc, group1, null)
  doc = addNode(doc, cube2, group1.id)
  doc = addNode(doc, cube3, null)
  doc = {
    ...doc,
    textures: { t1: makeTexture('t1', 'AAA') },
    animations: { a1: makeAnimation('a1', [cube2.id, cube3.id]) }
  }
  return { doc, ids: { cube1: cube1.id, group1: group1.id, cube2: cube2.id, cube3: cube3.id } }
}

describe('modeler/commands diffDocument 与补丁应用', () => {
  it('完全相同的文档 diff 为 null', () => {
    const { doc } = fixture()
    expect(diffDocument(doc, doc)).toBeNull()
  })

  it('仅 meta.updatedAt 变化时产生 meta-only 补丁', () => {
    const { doc } = fixture()
    const next = touch(doc, doc.meta.updatedAt + 5)
    const patch = diffDocument(doc, next)
    expect(patch).toEqual({ metaUpdatedAt: doc.meta.updatedAt + 5 })
  })

  it('patchNode 命令：apply 等价直接变换，revert 恢复原状，before 捕获原对象引用', () => {
    const { doc, ids } = fixture()
    const original = doc.nodes[ids.cube1]!
    const { command, doc: next } = commandFromTransform(doc, '改尺寸', (d) =>
      patchNode(d, ids.cube1, { from: [1, 1, 1], to: [9, 9, 9] })
    )
    expect(command).not.toBeNull()
    expect(Object.keys(command!.after.setNodes!)).toEqual([ids.cube1])
    expect(command!.before.setNodes![ids.cube1]).toBe(original)
    expect(canon(applyCommand(doc, command!))).toBe(canon(next))
    expect(canon(revertCommand(next, command!))).toBe(canon(doc))
  })

  it('addNode 命令：before 为删除补丁且携带原 root', () => {
    const { doc } = fixture()
    const node = createCubeNode('新块')
    const { command, doc: next } = commandFromTransform(doc, '新增', (d) => addNode(d, node, null))
    expect(command).not.toBeNull()
    expect(command!.before.removedNodeIds).toEqual([node.id])
    expect(command!.before.setRoot).toEqual(doc.root)
    expect(command!.after.setNodes![node.id]!.parent).toBeNull()
    expect(canon(applyCommand(doc, command!))).toBe(canon(next))
  })

  it('removeNodes 命令：undo 同时恢复子树、root 与被清理的动画通道', () => {
    const { doc, ids } = fixture()
    const { command, doc: next } = commandFromTransform(doc, '删除', (d) => removeNodes(d, [ids.group1]))
    expect(command).not.toBeNull()
    // before 补丁语义 = next→doc：被删节点以原对象引用出现在 setNodes 中
    const beforeNodes = command!.before.setNodes ?? {}
    for (const id of subtreeIds(doc, ids.group1)) {
      expect(beforeNodes[id]).toBe(doc.nodes[id])
    }
    expect(command!.before.setRoot).toEqual(doc.root)
    // 动画通道清理也被记录：before 捕获原动画（含被删节点通道），next 中已被清理
    expect(command!.before.setAnimations!['a1']).toBe(doc.animations['a1'])
    expect(command!.before.setAnimations!['a1']!.channels[ids.cube2]).toBeDefined()
    expect(next.animations['a1']!.channels[ids.cube2]).toBeUndefined()
    expect(next.animations['a1']!.channels[ids.cube3]).toBeDefined()
    expect(canon(revertCommand(next, command!))).toBe(canon(doc))
    expect(validateDocument(revertCommand(next, command!))).toEqual([])
  })

  it('贴图新增/修改/删除的 diff 与往返', () => {
    const { doc } = fixture()
    // 新增
    const t2 = makeTexture('t2', 'BBB')
    const add = commandFromTransform(doc, '加贴图', (d) => ({
      ...d,
      textures: { ...d.textures, t2: t2 },
      meta: { ...d.meta, updatedAt: d.meta.updatedAt + 1 }
    }))
    expect(add.command!.after.setTextures!['t2']).toBe(t2)
    expect(add.command!.before.removedTextureIds).toEqual(['t2'])
    expect(canon(applyCommand(doc, add.command!))).toBe(canon(add.doc))
    // 修改
    const t2b = makeTexture('t2', 'CCC')
    const mod = commandFromTransform(add.doc, '改贴图', (d) => ({
      ...d,
      textures: { ...d.textures, t2: t2b },
      meta: { ...d.meta, updatedAt: d.meta.updatedAt + 1 }
    }))
    expect(mod.command!.after.setTextures!['t2']).toBe(t2b)
    expect(mod.command!.before.setTextures!['t2']).toBe(t2)
    // 删除
    const del = commandFromTransform(mod.doc, '删贴图', (d) => {
      const textures = { ...d.textures }
      delete textures['t2']
      return { ...d, textures, meta: { ...d.meta, updatedAt: d.meta.updatedAt + 1 } }
    })
    expect(del.command!.after.removedTextureIds).toEqual(['t2'])
    expect(canon(revertCommand(del.doc, del.command!))).toBe(canon(mod.doc))
  })

  it('display：undefined → 对象 → 清除（null）的 diff 往返', () => {
    const { doc } = fixture()
    const withDisplay = { ...doc, display: { gui: { rotation: [0, 45, 0] as [number, number, number] } } }
    const add = diffDocument(doc, withDisplay)
    expect(add!.display).toEqual({ gui: { rotation: [0, 45, 0] } })
    const cleared = diffDocument(withDisplay, doc)
    expect(cleared!.display).toBeNull()
    const restored = applyPatch(withDisplay, cleared!)
    expect(restored.display).toBeUndefined()
    expect(canon(applyPatch(doc, add!))).toBe(canon(withDisplay))
  })

  it('root 重排 diff：undo 恢复原顺序', () => {
    const { doc, ids } = fixture()
    const { command, doc: next } = commandFromTransform(doc, '重排', (d) => reorderInList(d, null, 0, 2))
    expect(command!.after.setRoot).toEqual([ids.group1, ids.cube3, ids.cube1])
    expect(command!.before.setRoot).toEqual(doc.root)
    expect(canon(revertCommand(next, command!))).toBe(canon(doc))
  })

  it('applyPatch 同一补丁内先删后设：支持删除后重建', () => {
    const { doc, ids } = fixture()
    const replacement = { ...doc.nodes[ids.cube2]!, name: '重建' }
    const reAdded = applyPatch(doc, { removedNodeIds: [ids.cube2], setNodes: { [ids.cube2]: replacement } })
    expect(reAdded.nodes[ids.cube2]!.name).toBe('重建')
    // 同补丁同时含删与设时先删后设，设生效（支撑删除后重建语义）
    const both = applyPatch(doc, {
      setNodes: { [ids.cube2]: replacement },
      removedNodeIds: [ids.cube2]
    })
    expect(both.nodes[ids.cube2]!.name).toBe('重建')
  })
})

describe('modeler/commands mergePatches 合并语义', () => {
  it('set→set：后者胜', () => {
    const { doc, ids } = fixture()
    const a = diffDocument(doc, patchNode(doc, ids.cube1, { name: 'A' }))!
    const b = diffDocument(patchNode(doc, ids.cube1, { name: 'A' }), patchNode(doc, ids.cube1, { name: 'B' }))!
    const merged = mergePatches(a, b)
    const viaMerged = applyPatch(doc, merged)
    const viaSteps = patchNode(patchNode(doc, ids.cube1, { name: 'A' }), ids.cube1, { name: 'B' })
    // updatedAt 取墙钟（Date.now），多次 patch 跨毫秒会产生合法的 meta 差异——
    // 本断言关心合并语义而非时间戳，归一化后再比
    const stripTime = (d: ModelDocument): ModelDocument => ({ ...d, meta: { ...d.meta, updatedAt: 0 } })
    expect(canon(stripTime(viaMerged))).toBe(canon(stripTime(viaSteps)))
    expect(viaMerged.nodes[ids.cube1]!.name).toBe('B')
  })

  it('set→remove：抵消为删除；remove→set：重建为存在', () => {
    const { doc, ids } = fixture()
    const node = doc.nodes[ids.cube2]!
    const addPatch: DocumentPatchLike = { setNodes: { x: node } }
    const removePatch: DocumentPatchLike = { removedNodeIds: ['x'] }
    const setThenRemove = mergePatches(addPatch, removePatch)
    expect(setThenRemove.setNodes).toBeUndefined()
    expect(setThenRemove.removedNodeIds).toEqual(['x'])
    const removeThenSet = mergePatches(removePatch, addPatch)
    expect(removeThenSet.setNodes!['x']).toBe(node)
    expect(removeThenSet.removedNodeIds).toBeUndefined()
  })

  it('root/display/meta：b 提及时取 b，未提及时取 a', () => {
    const rootA: DocumentPatchLike = { setRoot: ['a'] }
    const rootB: DocumentPatchLike = { setRoot: ['b'] }
    expect(mergePatches(rootA, rootB).setRoot).toEqual(['b'])
    expect(mergePatches(rootA, {}).setRoot).toEqual(['a'])
    expect(mergePatches({ display: null }, { display: { gui: {} } }).display).toEqual({ gui: {} })
    expect(mergePatches({ display: { gui: {} } }, {}).display).toEqual({ gui: {} })
    expect(mergePatches({ metaUpdatedAt: 1 }, { metaUpdatedAt: 2 }).metaUpdatedAt).toBe(2)
    expect(mergePatches({ metaUpdatedAt: 1 }, {}).metaUpdatedAt).toBe(1)
  })
})

type DocumentPatchLike = Parameters<typeof mergePatches>[0]

describe('modeler/commands CommandStack 基本流', () => {
  it('默认上限 200 步', () => {
    expect(DEFAULT_COMMAND_LIMIT).toBe(200)
    expect(new CommandStack().limit).toBe(200)
  })

  it('execute/undo/redo：空栈 undo 为 null，execute 清空 redo', () => {
    const { doc, ids } = fixture()
    const stack = new CommandStack()
    expect(stack.undo()).toBeNull()
    const c1 = commandFromTransform(doc, 'a', (d) => renameNode(d, ids.cube1, 'X')).command!
    stack.execute(c1)
    const next = applyCommand(doc, c1)
    const c2 = commandFromTransform(next, 'b', (d) => renameNode(d, ids.cube1, 'Y')).command!
    stack.execute(c2)
    expect(stack.size).toBe(2)
    expect(stack.undo()!.label).toBe('b')
    expect(stack.canRedo).toBe(true)
    stack.execute(commandFromTransform(next, 'c', (d) => renameNode(d, ids.cube1, 'Z')).command!)
    expect(stack.canRedo).toBe(false)
    expect(stack.redo()).toBeNull()
  })

  it('超过 limit 时最老命令被逐出', () => {
    const { doc, ids } = fixture()
    const stack = new CommandStack({ limit: 3 })
    let cur = doc
    for (let i = 0; i < 4; i++) {
      const { command, doc: next } = commandFromTransform(cur, `step-${i}`, (d) =>
        renameNode(d, ids.cube1, `N${i}`)
      )
      stack.execute(command!)
      cur = next
    }
    expect(stack.size).toBe(3)
    expect(stack.undo()!.label).toBe('step-3')
    expect(stack.undo()!.label).toBe('step-2')
    expect(stack.undo()!.label).toBe('step-1')
    expect(stack.canUndo).toBe(false)
  })

  it('revision / isDirty / markSaved / clear', () => {
    const { doc, ids } = fixture()
    const stack = new CommandStack()
    expect(stack.isDirty).toBe(false)
    stack.execute(commandFromTransform(doc, 'a', (d) => renameNode(d, ids.cube1, 'X')).command!)
    expect(stack.isDirty).toBe(true)
    stack.markSaved()
    expect(stack.isDirty).toBe(false)
    stack.undo()
    expect(stack.isDirty).toBe(true)
    stack.clear()
    expect(stack.size).toBe(0)
    expect(stack.canRedo).toBe(false)
    expect(stack.isDirty).toBe(false)
  })
})

describe('modeler/commands mergeKey 连续合并', () => {
  it('同 mergeKey 连续 execute 合并为一条，一次 undo 回初态', () => {
    const { doc, ids } = fixture()
    const stack = new CommandStack()
    let cur = doc
    for (const name of ['X', 'Y', 'Z']) {
      const { command, doc: next } = commandFromTransform(cur, `改名 ${name}`, (d) =>
        renameNode(d, ids.cube1, name)
      )
      stack.execute(command!, { mergeKey: 'rename-drag' })
      cur = next
    }
    expect(stack.size).toBe(1)
    const cmd = stack.undo()!
    expect(canon(revertCommand(cur, cmd))).toBe(canon(doc))
    expect(stack.redo()!.label).toBe('改名 X')
  })

  it('不同 mergeKey 不合并；coalesce 选择字段取首 before / 末 after', () => {
    const { doc, ids } = fixture()
    const c1 = commandFromTransform(doc, 'a', (d) => renameNode(d, ids.cube1, 'X'), {
      mergeKey: 'k',
      selectionBefore: ['s1'],
      selectionAfter: ['s2']
    }).command!
    const c2 = commandFromTransform(applyCommand(doc, c1), 'b', (d) => renameNode(d, ids.cube1, 'Y'), {
      mergeKey: 'k',
      selectionAfter: ['s3']
    }).command!
    const merged = coalesceCommands(c1, c2)
    expect(merged.selectionBefore).toEqual(['s1'])
    expect(merged.selectionAfter).toEqual(['s3'])
    expect(merged.label).toBe('a')
  })
})

describe('modeler/commands 事务', () => {
  function buildOps(doc: ModelDocument, ids: Record<string, string>): { commands: ReturnType<typeof commandFromTransform>['command'][]; final: ModelDocument } {
    const stack: ReturnType<typeof commandFromTransform>['command'][] = []
    let cur = doc
    const steps: Array<(d: ModelDocument) => ModelDocument> = [
      (d) => addNode(d, createCubeNode('事务块'), null),
      (d) => patchNode(d, ids.cube1, { from: [2, 2, 2], to: [10, 10, 10] }),
      (d) => renameNode(d, ids.cube3, '改名')
    ]
    for (let i = 0; i < steps.length; i++) {
      const r = commandFromTransform(cur, `t${i}`, steps[i]!)
      stack.push(r.command)
      cur = r.doc
    }
    return { commands: stack, final: cur }
  }

  it('commit 后折叠为单条命令：一次 undo 回初态、一次 redo 到终态', () => {
    const { doc, ids } = fixture()
    const { commands, final } = buildOps(doc, ids)
    const stack = new CommandStack()
    stack.beginTransaction('批量编辑')
    for (const c of commands) stack.execute(c!)
    stack.commitTransaction()
    expect(stack.size).toBe(1)
    const undone = stack.undo()!
    expect(undone.label).toBe('批量编辑')
    expect(canon(revertCommand(final, undone))).toBe(canon(doc))
    expect(validateDocument(revertCommand(final, undone))).toEqual([])
    const redone = stack.redo()!
    expect(canon(applyCommand(doc, redone))).toBe(canon(final))
  })

  it('事务中 undo/redo 返回 null；重复 begin 忽略；cancel 丢弃缓冲', () => {
    const { doc, ids } = fixture()
    const { commands } = buildOps(doc, ids)
    const stack = new CommandStack()
    stack.beginTransaction('t1')
    stack.execute(commands[0]!)
    expect(stack.undo()).toBeNull()
    expect(stack.redo()).toBeNull()
    stack.beginTransaction('t2') // 忽略
    stack.execute(commands[1]!)
    stack.cancelTransaction()
    stack.commitTransaction() // no-op
    expect(stack.size).toBe(0)
    expect(stack.canUndo).toBe(false)
  })

  it('commit 未 begin 为 no-op；空事务不入栈', () => {
    const { doc, ids } = fixture()
    const stack = new CommandStack()
    stack.commitTransaction()
    stack.beginTransaction('空')
    stack.commitTransaction()
    expect(stack.size).toBe(0)
    stack.execute(commandFromTransform(doc, 'a', (d) => renameNode(d, ids.cube1, 'X')).command!)
    expect(stack.size).toBe(1)
  })

  it('事务命令 selectionBefore 取第一条，selectionAfter 取最后一条非空值', () => {
    const { doc, ids } = fixture()
    const { commands } = buildOps(doc, ids)
    const stack = new CommandStack()
    stack.beginTransaction('t')
    stack.execute(commands[0]!, { selectionBefore: ['before'], selectionAfter: ['mid'] })
    stack.execute(commands[1]!)
    stack.execute(commands[2]!, { selectionAfter: ['after'] })
    stack.commitTransaction()
    const cmd = stack.undo()!
    expect(cmd.selectionBefore).toEqual(['before'])
    expect(cmd.selectionAfter).toEqual(['after'])
  })
})

describe('modeler/commands snapshotSelection', () => {
  it('为栈顶命令补记撤销后选择，已有值不覆盖', () => {
    const { doc, ids } = fixture()
    const stack = new CommandStack()
    stack.execute(commandFromTransform(doc, 'a', (d) => renameNode(d, ids.cube1, 'X')).command!)
    stack.snapshotSelection(['n1'])
    stack.execute(
      commandFromTransform(doc, 'b', (d) => renameNode(d, ids.cube1, 'Y'), { selectionAfter: ['n2'] }).command!
    )
    stack.snapshotSelection(['ignored'])
    expect(stack.undo()!.selectionAfter).toEqual(['n2'])
    expect(stack.undo()!.selectionAfter).toEqual(['n1'])
  })
})

/* ------------------------------------------------------------------ */
/* 属性测试                                                            */
/* ------------------------------------------------------------------ */

type RandomOp =
  | { t: 'addCube'; rel: number; label: string; group: boolean; merge: boolean }
  | { t: 'addGroup'; rel: number; label: string }
  | { t: 'patch'; rel: number; dx: number; dy: number; dz: number; merge: boolean }
  | { t: 'remove'; rel: number }
  | { t: 'rename'; rel: number; label: string; merge: boolean }
  | { t: 'reorder'; from: number; to: number }
  | { t: 'texture'; rel: number; mode: 'add' | 'patch' | 'remove' }
  | { t: 'move'; rel: number; targetRel: number }
  | { t: 'touch' }

const opArb = fc.oneof(
  fc.record({
    t: fc.constant('addCube' as const),
    rel: fc.nat(4),
    label: fc.string({ minLength: 1, maxLength: 6 }),
    group: fc.boolean(),
    merge: fc.boolean()
  }),
  fc.record({ t: fc.constant('addGroup' as const), rel: fc.nat(4), label: fc.string({ minLength: 1, maxLength: 6 }) }),
  fc.record({
    t: fc.constant('patch' as const),
    rel: fc.nat(8),
    dx: fc.integer({ min: -8, max: 8 }),
    dy: fc.integer({ min: -8, max: 8 }),
    dz: fc.integer({ min: -8, max: 8 }),
    merge: fc.boolean()
  }),
  fc.record({ t: fc.constant('remove' as const), rel: fc.nat(8) }),
  fc.record({
    t: fc.constant('rename' as const),
    rel: fc.nat(8),
    label: fc.string({ minLength: 1, maxLength: 6 }),
    merge: fc.boolean()
  }),
  fc.record({ t: fc.constant('reorder' as const), from: fc.nat(4), to: fc.nat(4) }),
  fc.record({ t: fc.constant('texture' as const), rel: fc.nat(3), mode: fc.constantFrom('add', 'patch', 'remove') }),
  fc.record({ t: fc.constant('move' as const), rel: fc.nat(8), targetRel: fc.nat(4) }),
  fc.record({ t: fc.constant('touch' as const) })
)

/** 解释单条随机操作：执行并返回新文档（操作无效时原样返回） */
function applyRandomOp(
  doc: ModelDocument,
  op: RandomOp,
  stack: CommandStack,
  textureCounter: { n: number }
): ModelDocument {
  const nodeIds = Object.keys(doc.nodes)
  const groupIds = nodeIds.filter((id) => doc.nodes[id]!.type === 'group')
  const texIds = Object.keys(doc.textures)
  const pick = <T>(list: T[], rel: number): T | undefined =>
    list.length ? list[rel % list.length] : undefined

  const run = (
    label: string,
    transform: (d: ModelDocument) => ModelDocument,
    extras?: { mergeKey?: string; selectionAfter?: string[] }
  ): ModelDocument => {
    const r = commandFromTransform(doc, label, transform, extras)
    if (r.command) stack.execute(r.command, extras)
    return r.doc
  }

  switch (op.t) {
    case 'addCube': {
      const parent = op.group ? (pick(groupIds, op.rel) ?? null) : null
      const node = createCubeNode(op.label || '块')
      return run('新增立方体', (d) => addNode(d, node, parent), {
        ...(op.merge ? { mergeKey: 'add-cube' } : {}),
        selectionAfter: [node.id]
      })
    }
    case 'addGroup': {
      const parent = pick(groupIds, op.rel) ?? null
      const node = createGroupNode(op.label || '组')
      return run('新增组', (d) => addNode(d, node, parent))
    }
    case 'patch': {
      const id = pick(nodeIds, op.rel)
      if (!id) return doc
      const node = doc.nodes[id]!
      const patchDef =
        node.type === 'cube'
          ? { to: [8 + op.dx, 8 + op.dy, 8 + op.dz] as [number, number, number] }
          : node.type === 'group'
            ? { rotation: [op.dx, op.dy, op.dz] as [number, number, number] }
            : { position: [op.dx, op.dy, op.dz] as [number, number, number] }
      return run('属性修改', (d) => patchNode(d, id, patchDef), op.merge ? { mergeKey: 'drag' } : undefined)
    }
    case 'remove': {
      const id = pick(nodeIds, op.rel)
      if (!id) return doc
      return run('删除', (d) => removeNodes(d, [id]))
    }
    case 'rename': {
      const id = pick(nodeIds, op.rel)
      if (!id) return doc
      return run('重命名', (d) => renameNode(d, id, op.label || '名'), op.merge ? { mergeKey: 'rename' } : undefined)
    }
    case 'reorder':
      return run('重排', (d) => reorderInList(d, null, op.from, op.to))
    case 'texture': {
      if (op.mode === 'add') {
        textureCounter.n++
        const tex = makeTexture(`tx${textureCounter.n}`, `${textureCounter.n}`)
        return run('加贴图', (d) => ({
          ...d,
          textures: { ...d.textures, [tex.id]: tex },
          meta: { ...d.meta, updatedAt: d.meta.updatedAt + 1 }
        }))
      }
      const id = pick(texIds, op.rel)
      if (!id) return doc
      if (op.mode === 'patch') {
        const tex = makeTexture(id, `P${textureCounter.n}`)
        return run('改贴图', (d) => ({
          ...d,
          textures: { ...d.textures, [id]: tex },
          meta: { ...d.meta, updatedAt: d.meta.updatedAt + 1 }
        }))
      }
      return run('删贴图', (d) => {
        const textures = { ...d.textures }
        delete textures[id]
        return { ...d, textures, meta: { ...d.meta, updatedAt: d.meta.updatedAt + 1 } }
      })
    }
    case 'move': {
      const id = pick(nodeIds, op.rel)
      if (!id) return doc
      const target = op.targetRel === 0 ? null : (pick(groupIds, op.targetRel) ?? null)
      if (target !== null && (target === id || subtreeIds(doc, id).includes(target))) return doc
      return run('移动', (d) => moveNode(d, id, target))
    }
    case 'touch':
      return run('刷新', (d) => touch(d, d.meta.updatedAt + 1))
  }
}

describe('modeler/commands 属性测试（fast-check）', () => {
  it('随机操作序列：全部 undo 后与初态深相等；全部 redo 后与终态深相等；redo 幂等', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        const { doc: initial } = fixture()
        const stack = new CommandStack()
        let doc = initial
        const counter = { n: 0 }
        for (const op of ops) doc = applyRandomOp(doc, op, stack, counter)
        const final = doc
        expect(validateDocument(final)).toEqual([])

        while (stack.canUndo) {
          const cmd = stack.undo()!
          doc = revertCommand(doc, cmd)
          expect(validateDocument(doc)).toEqual([])
        }
        expect(canon(doc)).toBe(canon(initial))
        expect(stack.canUndo).toBe(false)

        while (stack.canRedo) doc = applyCommand(doc, stack.redo()!)
        expect(canon(doc)).toBe(canon(final))
        expect(stack.redo()).toBeNull()
      }),
      { numRuns: 100 }
    )
  })

  it('随机操作包进单条事务：commit 后一次 undo 回初态、一次 redo 到终态', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 20 }), (ops) => {
        const { doc: initial } = fixture()
        const stack = new CommandStack()
        let doc = initial
        const counter = { n: 0 }
        stack.beginTransaction('随机事务')
        for (const op of ops) doc = applyRandomOp(doc, op, stack, counter)
        stack.commitTransaction()
        const final = doc
        expect(validateDocument(final)).toEqual([])
        if (stack.size === 0) {
          expect(canon(final)).toBe(canon(initial))
          return
        }
        expect(stack.size).toBe(1)
        const undone = stack.undo()!
        expect(canon(revertCommand(final, undone))).toBe(canon(initial))
        const redone = stack.redo()!
        expect(canon(applyCommand(initial, redone))).toBe(canon(final))
        // undo→redo 后命令回到 undo 栈：可继续撤销、无重做项
        expect(stack.canUndo).toBe(true)
        expect(stack.canRedo).toBe(false)
      }),
      { numRuns: 100 }
    )
  })
})
