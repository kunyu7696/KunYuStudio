import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  addNode,
  addTexture,
  assertDocumentInvariants,
  childrenIdsOf,
  createCubeNode,
  createDocument,
  createGroupNode,
  createLocatorNode,
  deserializeDocument,
  depthOf,
  duplicateNodes,
  isAncestor,
  ModelerDocumentError,
  moveNode,
  patchNode,
  patchTexture,
  removeNodes,
  removeTexture,
  renameNode,
  reorderInList,
  serializeDocument,
  subtreeIds,
  touch,
  uid,
  validateDocument,
  walkTree
} from '../document'
import type { ModelDocument, ModelNode, ModelTexture } from '../types'

/** 构建固定测试文档：root: [cube1, group1[locator1, cube2], cube3] */
function fixture(): { doc: ModelDocument; ids: Record<string, string> } {
  let doc = createDocument({ id: 'doc-test', name: '测试文档', format: 'java_block', now: 1000 })
  const cube1 = createCubeNode('立方体 1', { from: [0, 0, 0], to: [8, 8, 8] })
  const group1 = createGroupNode('骨骼 1')
  const locator1 = createLocatorNode('挂点 1', [1, 2, 3])
  const cube2 = createCubeNode('立方体 2')
  const cube3 = createCubeNode('立方体 3')
  doc = addNode(doc, cube1, null)
  doc = addNode(doc, group1, null)
  doc = addNode(doc, locator1, group1.id)
  doc = addNode(doc, cube2, group1.id)
  doc = addNode(doc, cube3, null)
  return {
    doc,
    ids: { cube1: cube1.id, group1: group1.id, locator1: locator1.id, cube2: cube2.id, cube3: cube3.id }
  }
}

describe('modeler/document 工厂与 uid', () => {
  it('uid：带前缀且大量生成不重复', () => {
    const set = new Set<string>()
    for (let i = 0; i < 2000; i++) set.add(uid('n'))
    expect(set.size).toBe(2000)
    expect([...set][0]!.startsWith('n-')).toBe(true)
  })

  it('createDocument：默认 settings 与 meta', () => {
    const doc = createDocument({ name: 'm', format: 'free', now: 42 })
    expect(doc.schemaVersion).toBe(1)
    expect(doc.id.startsWith('doc-')).toBe(true)
    expect(doc.format).toBe('free')
    expect(doc.settings.uvMode).toBe('per_face')
    expect(doc.settings.textureSize).toBeUndefined()
    expect(doc.root).toEqual([])
    expect(doc.meta.createdAt).toBe(42)
    expect(doc.meta.updatedAt).toBe(42)
    expect(typeof doc.meta.editorVersion).toBe('string')
  })

  it('createDocument：显式 settings 与 id 生效', () => {
    const doc = createDocument({
      id: 'd1',
      name: 'm',
      format: 'java_block',
      settings: { uvMode: 'box', textureSize: [16, 16], boxUv: { width: 64, height: 32 } }
    })
    expect(doc.id).toBe('d1')
    expect(doc.settings.uvMode).toBe('box')
    expect(doc.settings.boxUv).toEqual({ width: 64, height: 32 })
  })

  it('createCubeNode：默认 16³ 六面齐全不绑贴图；seed 生效', () => {
    const c = createCubeNode('a')
    expect(c.from).toEqual([0, 0, 0])
    expect(c.to).toEqual([16, 16, 16])
    expect(Object.keys(c.faces)).toHaveLength(6)
    expect(c.faces.north?.texture).toBeUndefined()
    expect(c.faces.north?.uv).toEqual([0, 0, 16, 16])
    const s = createCubeNode('b', { from: [1, 2, 3], to: [4, 5, 6] })
    expect(s.from).toEqual([1, 2, 3])
    expect(s.to).toEqual([4, 5, 6])
  })
})

describe('modeler/document 结构操作', () => {
  it('addNode：root 顺序与父子字段正确', () => {
    const { doc, ids } = fixture()
    expect(doc.root).toEqual([ids.cube1, ids.group1, ids.cube3])
    expect(doc.nodes[ids.locator1]!.parent).toBe(ids.group1)
    expect(doc.nodes[ids.cube1]!.parent).toBeNull()
  })

  it('addNode：指定 index 插入；重复 id 拒绝；父级非法抛错', () => {
    let doc = createDocument({ name: 'm', format: 'free' })
    const a = createCubeNode('a')
    const b = createCubeNode('b')
    doc = addNode(doc, a, null)
    doc = addNode(doc, b, null, 0)
    expect(doc.root).toEqual([b.id, a.id])
    expect(() => addNode(doc, createCubeNode('x'), a.id)).toThrow(/不是组节点/)
    expect(() => addNode(doc, a, null)).toThrow(/已存在/)
    expect(() => addNode(doc, createCubeNode('x'), 'nope')).toThrow(/不存在/)
  })

  it('moveNode：跨父级移动更新 parent 与两侧表', () => {
    const { doc, ids } = fixture()
    const next = moveNode(doc, ids.cube3, ids.group1)
    expect(next.root).toEqual([ids.cube1, ids.group1])
    expect(childrenIdsOf(next, ids.group1)).toEqual([ids.locator1, ids.cube2, ids.cube3])
    expect(next.nodes[ids.cube3]!.parent).toBe(ids.group1)
    // 原文档不被修改
    expect(doc.root).toContain(ids.cube3)
  })

  it('moveNode：同表重排（index 相对摘除后的表）', () => {
    const { doc, ids } = fixture()
    const next = moveNode(doc, ids.cube1, null, 2)
    expect(next.root).toEqual([ids.group1, ids.cube3, ids.cube1])
  })

  it('moveNode：拒绝成环与非法目标', () => {
    const { doc, ids } = fixture()
    expect(() => moveNode(doc, ids.group1, ids.locator1)).toThrow(/自己的子树/)
    expect(() => moveNode(doc, ids.group1, ids.group1)).toThrow(/自己的子树/)
    expect(() => moveNode(doc, 'nope', null)).toThrow(/不存在/)
    expect(() => moveNode(doc, ids.cube1, 'nope')).toThrow(/不存在/)
  })

  it('removeNodes：连子树删除 + 动画通道清理 + 其他保留', () => {
    let { doc, ids } = fixture()
    doc = {
      ...doc,
      animations: {
        a1: {
          id: 'a1',
          name: 'idle',
          length: 1,
          loop: 'loop',
          channels: {
            [ids.cube1]: { rotation: [{ time: 0, value: [0, 0, 0], interpolation: 'linear' }] },
            [ids.group1]: { rotation: [{ time: 0, value: [0, 0, 0], interpolation: 'linear' }] },
            [ids.cube2]: { position: [{ time: 0, value: [0, 0, 0], interpolation: 'step' }] }
          }
        }
      }
    }
    const next = removeNodes(doc, [ids.group1, 'unknown'])
    expect(next.nodes[ids.group1]).toBeUndefined()
    expect(next.nodes[ids.locator1]).toBeUndefined()
    expect(next.nodes[ids.cube2]).toBeUndefined()
    expect(next.root).toEqual([ids.cube1, ids.cube3])
    // 被删节点（含子树内 cube2）的通道清理，存活节点 cube1 的通道保留
    expect(next.animations.a1!.channels[ids.cube1]).toBeDefined()
    expect(next.animations.a1!.channels[ids.group1]).toBeUndefined()
    expect(next.animations.a1!.channels[ids.cube2]).toBeUndefined()
    // 原文档不变
    expect(doc.nodes[ids.locator1]).toBeDefined()
    // 空 id 列表原样返回
    expect(removeNodes(doc, [])).toBe(doc)
  })

  it('removeNodes：删除后文档仍满足不变量', () => {
    const { doc, ids } = fixture()
    const next = removeNodes(doc, [ids.cube1, ids.group1])
    expect(() => assertDocumentInvariants(next)).not.toThrow()
  })

  it('reorderInList：root 与组内重排；非法下标原样返回', () => {
    const { doc, ids } = fixture()
    const r1 = reorderInList(doc, null, 0, 2)
    expect(r1.root).toEqual([ids.group1, ids.cube3, ids.cube1])
    const r2 = reorderInList(r1, ids.group1, 1, 0)
    expect(childrenIdsOf(r2, ids.group1)).toEqual([ids.cube2, ids.locator1])
    expect(reorderInList(doc, null, 0, 0)).toBe(doc)
    expect(reorderInList(doc, null, -1, 5)).toBe(doc)
    expect(reorderInList(doc, 'nope', 0, 1)).toBe(doc)
  })

  it('duplicateNodes：换新 id、插到紧后、顶层改名、原子树结构一致', () => {
    const { doc, ids } = fixture()
    const { doc: next, idMap } = duplicateNodes(doc, [ids.group1])
    const newId = idMap[ids.group1]!
    expect(newId).not.toBe(ids.group1)
    expect(next.root).toEqual([ids.cube1, ids.group1, newId, ids.cube3])
    const copy = next.nodes[newId]!
    expect(copy.name).toBe('骨骼 1-副本')
    expect(copy.type).toBe('group')
    const copyChildren = (copy as { children: string[] }).children
    expect(copyChildren).toHaveLength(2)
    expect(copyChildren[0]).not.toBe(ids.locator1)
    expect(next.nodes[copyChildren[0]]!.name).toBe('挂点 1')
    expect(next.nodes[copyChildren[0]]!.parent).toBe(newId)
    // 原子树未受影响
    expect(next.nodes[ids.locator1]!.parent).toBe(ids.group1)
    expect(() => assertDocumentInvariants(next)).not.toThrow()
  })

  it('duplicateNodes：未知 id 跳过、多个请求各自插入', () => {
    const { doc, ids } = fixture()
    const { doc: next, idMap } = duplicateNodes(doc, ['nope', ids.cube1, ids.cube3])
    expect(Object.keys(idMap)).toEqual([ids.cube1, ids.cube3])
    expect(next.root).toEqual([
      ids.cube1,
      idMap[ids.cube1],
      ids.group1,
      ids.cube3,
      idMap[ids.cube3]
    ])
  })
})

describe('modeler/document 字段级操作', () => {
  it('renameNode：生效且原文档不变', () => {
    const { doc, ids } = fixture()
    const next = renameNode(doc, ids.cube1, '改名')
    expect(next.nodes[ids.cube1]!.name).toBe('改名')
    expect(doc.nodes[ids.cube1]!.name).toBe('立方体 1')
    expect(renameNode(doc, 'nope', 'x')).toBe(doc)
  })

  it('patchNode：浅合并几何字段；结构字段被还原', () => {
    const { doc, ids } = fixture()
    const next = patchNode(doc, ids.cube1, {
      from: [1, 1, 1],
      to: [2, 2, 2],
      visible: false
    })
    expect(next.nodes[ids.cube1]!.type).toBe('cube')
    expect((next.nodes[ids.cube1] as { from: number[] }).from).toEqual([1, 1, 1])
    expect(next.nodes[ids.cube1]!.visible).toBe(false)
    expect(next.nodes[ids.cube1]!.id).toBe(ids.cube1)
    expect(next.nodes[ids.cube1]!.parent).toBeNull()
    // 强转传入结构字段：被还原
    const evil = patchNode(doc, ids.cube1, { id: 'hack' } as never)
    expect(evil.nodes[ids.cube1]!.id).toBe(ids.cube1)
    const evilGroup = patchNode(doc, ids.group1, { children: ['hack'] } as never)
    expect((evilGroup.nodes[ids.group1] as { children: string[] }).children).toEqual([
      ids.locator1,
      ids.cube2
    ])
    expect(patchNode(doc, 'nope', { name: 'x' })).toBe(doc)
  })

  it('touch：刷新 updatedAt', () => {
    const doc = createDocument({ name: 'm', format: 'free', now: 1000 })
    const next = touch(doc, 999)
    expect(next.meta.updatedAt).toBe(999)
    expect(doc.meta.updatedAt).toBe(1000)
  })
})

describe('modeler/document 查询与遍历', () => {
  it('subtreeIds / isAncestor / depthOf', () => {
    const { doc, ids } = fixture()
    expect(subtreeIds(doc, ids.group1)).toEqual([ids.group1, ids.locator1, ids.cube2])
    expect(subtreeIds(doc, ids.cube1)).toEqual([ids.cube1])
    expect(subtreeIds(doc, 'nope')).toEqual([])
    expect(isAncestor(doc, ids.group1, ids.cube2)).toBe(true)
    expect(isAncestor(doc, ids.cube2, ids.group1)).toBe(false)
    expect(isAncestor(doc, ids.cube1, ids.cube3)).toBe(false)
    expect(depthOf(doc, ids.locator1)).toBe(1)
    expect(depthOf(doc, ids.cube1)).toBe(0)
    expect(depthOf(doc, 'nope')).toBe(-1)
  })

  it('walkTree：前序遍历 + 提前终止', () => {
    const { doc, ids } = fixture()
    const order: string[] = []
    walkTree(doc, (n) => {
      order.push(n.name)
    })
    expect(order).toEqual(['立方体 1', '骨骼 1', '挂点 1', '立方体 2', '立方体 3'])

    const stopped: string[] = []
    walkTree(doc, (n) => {
      stopped.push(n.name)
      if (stopped.length >= 3) return false
    })
    expect(stopped).toEqual(['立方体 1', '骨骼 1', '挂点 1'])
    expect(ids.cube3).toBeDefined()
  })
})

describe('modeler/document 校验', () => {
  it('合法文档零问题', () => {
    const { doc } = fixture()
    expect(validateDocument(doc)).toEqual([])
  })

  it('孤儿节点', () => {
    const doc = createDocument({ name: 'm', format: 'free' })
    doc.nodes['x'] = createCubeNode('孤儿')
    // 直接改 nodes 制造孤儿（绕过 addNode）
    const issues = validateDocument(doc)
    expect(issues.some((i) => i.code === 'orphan_node' && i.nodeId === 'x')).toBe(true)
  })

  it('parent 字段与 children 表不一致', () => {
    const { doc, ids } = fixture()
    const bad: ModelDocument = {
      ...doc,
      nodes: { ...doc.nodes, [ids.cube3]: { ...doc.nodes[ids.cube3]!, parent: ids.group1 } }
    }
    const issues = validateDocument(bad)
    // 三条 parent_child_mismatch：root 扫描（parent 非空）+ children 缺表项 + 同时出现在 root
    expect(issues.filter((i) => i.code === 'parent_child_mismatch')).toHaveLength(3)
  })

  it('root 引用不存在节点 / 重复表项', () => {
    const { doc, ids } = fixture()
    expect(validateDocument({ ...doc, root: [...doc.root, 'ghost'] }).some((i) => i.code === 'missing_node')).toBe(true)
    expect(
      validateDocument({ ...doc, root: [ids.cube1, ids.cube1, ...doc.root.slice(1)] }).some(
        (i) => i.code === 'duplicate_entry'
      )
    ).toBe(true)
  })

  it('父级环', () => {
    const { doc } = fixture()
    const a = createGroupNode('环A')
    const b = createGroupNode('环B')
    let bad = addNode(doc, a, null)
    bad = addNode(bad, b, a.id)
    // 手工制造环：a.parent = b（同时保持 children 双写以聚焦环检测）
    bad = {
      ...bad,
      nodes: {
        ...bad.nodes,
        [a.id]: { ...bad.nodes[a.id]!, parent: b.id },
        [b.id]: { ...bad.nodes[b.id]!, children: [a.id] }
      } as Record<string, ModelNode>,
      root: bad.root.filter((r) => r !== a.id)
    }
    const issues = validateDocument(bad)
    expect(issues.some((i) => i.code === 'parent_cycle')).toBe(true)
  })

  it('面贴图引用缺失 / 动画通道节点缺失', () => {
    const { doc, ids } = fixture()
    const withTex: ModelDocument = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [ids.cube1]: {
          ...doc.nodes[ids.cube1]!,
          faces: { north: { uv: [0, 0, 1, 1], texture: 'ghost-tex' } }
        } as ModelNode
      }
    }
    expect(
      validateDocument(withTex).some((i) => i.code === 'texture_ref_missing' && i.nodeId === ids.cube1)
    ).toBe(true)

    const withAnim: ModelDocument = {
      ...doc,
      animations: {
        a: { id: 'a', name: 'x', length: 1, loop: 'once', channels: { ghost: {} } }
      }
    }
    expect(validateDocument(withAnim).some((i) => i.code === 'animation_node_missing')).toBe(true)
  })

  it('assertDocumentInvariants：非法文档抛错', () => {
    const doc = createDocument({ name: 'm', format: 'free' })
    doc.nodes['x'] = createCubeNode('孤儿')
    expect(() => assertDocumentInvariants(doc)).toThrow(/不变量被破坏/)
  })
})

describe('modeler/document 序列化', () => {
  it('serialize → deserialize 往返等价', () => {
    const { doc } = fixture()
    const json = serializeDocument(doc)
    const back = deserializeDocument(json)
    expect(back).toEqual(doc)
    // pretty 输出
    expect(json.startsWith('{\n  "schemaVersion"')).toBe(true)
  })

  it('deserialize：对象输入 / 非法输入', () => {
    const { doc } = fixture()
    expect(deserializeDocument(JSON.parse(serializeDocument(doc)))).toEqual(doc)
    expect(() => deserializeDocument('not json')).toThrow(ModelerDocumentError)
    expect(() => deserializeDocument(42)).toThrow(ModelerDocumentError)
    expect(() => deserializeDocument({ schemaVersion: 2 })).toThrow(/不支持的文档版本/)
    expect(() => deserializeDocument({ schemaVersion: 1 })).toThrow(/缺少/)
  })

  it('deserialize：带环文档被拒绝且携带 issues', () => {
    const { doc } = fixture()
    const a = createGroupNode('环A')
    const b = createGroupNode('环B')
    let bad = addNode(doc, a, null)
    bad = addNode(bad, b, a.id)
    bad = {
      ...bad,
      nodes: {
        ...bad.nodes,
        [a.id]: { ...bad.nodes[a.id]!, parent: b.id },
        [b.id]: { ...bad.nodes[b.id]!, children: [a.id] }
      } as Record<string, ModelNode>,
      root: bad.root.filter((r) => r !== a.id)
    }
    try {
      deserializeDocument(JSON.parse(JSON.stringify(bad)))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ModelerDocumentError)
      expect((e as ModelerDocumentError).issues.some((i) => i.code === 'parent_cycle')).toBe(true)
    }
  })
})

describe('modeler/document 属性测试（fast-check）', () => {
  interface Op {
    kind: 'addCube' | 'addGroup' | 'move' | 'remove' | 'duplicate' | 'reorder'
  }

  it('随机操作序列后文档始终满足树不变量且遍历覆盖全部节点', () => {
    const opArb = fc.constantFrom<Op>(
      { kind: 'addCube' },
      { kind: 'addGroup' },
      { kind: 'move' },
      { kind: 'remove' },
      { kind: 'duplicate' },
      { kind: 'reorder' }
    )
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 80 }), (ops) => {
        let doc = createDocument({ name: 'p', format: 'free' })
        for (const op of ops) {
          const ids = Object.keys(doc.nodes)
          try {
            switch (op.kind) {
              case 'addCube': {
                const parent = ids.length > 0 && doc.root.length > 0 ? pickGroupParent(doc) : null
                doc = addNode(doc, createCubeNode(`c${ids.length}`), parent)
                break
              }
              case 'addGroup': {
                const parent = ids.length > 0 && doc.root.length > 0 ? pickGroupParent(doc) : null
                doc = addNode(doc, createGroupNode(`g${ids.length}`), parent)
                break
              }
              case 'move': {
                if (ids.length < 1) break
                const id = ids[0]!
                const target = ids.length > 1 ? pickOther(doc, id) : null
                // 目标在子树内会抛错——视为预期拒绝
                doc = moveNode(doc, id, target)
                break
              }
              case 'remove': {
                if (ids.length === 0) break
                doc = removeNodes(doc, [ids[0]!])
                break
              }
              case 'duplicate': {
                if (ids.length === 0) break
                doc = duplicateNodes(doc, [ids[0]!]).doc
                break
              }
              case 'reorder': {
                if (doc.root.length < 2) break
                doc = reorderInList(doc, null, 0, 1)
                break
              }
            }
          } catch {
            // 非法结构操作（成环等）被拒绝是预期行为
          }
          assertDocumentInvariants(doc)
          // 遍历恰好覆盖全部节点（无孤儿、无重复）
          const visited: string[] = []
          walkTree(doc, (n) => {
            visited.push(n.id)
          })
          expect(new Set(visited).size).toBe(visited.length)
          expect(new Set(visited)).toEqual(new Set(Object.keys(doc.nodes)))
        }
      }),
      { numRuns: 100 }
    )
  })

  function pickGroupParent(doc: ModelDocument): string | null {
    const groups = Object.values(doc.nodes).filter((n) => n.type === 'group')
    if (groups.length === 0) return null
    return groups[0]!.id
  }

  function pickOther(doc: ModelDocument, id: string): string | null {
    const groups = Object.values(doc.nodes).filter((n) => n.type === 'group' && n.id !== id)
    return groups.length > 0 ? groups[0]!.id : null
  }
})

function makeTex(id: string): ModelTexture {
  return { id, name: id, width: 16, height: 16, data: `data:image/png;base64,${id}`, visible: true }
}

describe('modeler/document 贴图操作', () => {
  it('addTexture：登记贴图并刷新 updatedAt，原 doc 不被修改', () => {
    const doc = createDocument({ name: 't', format: 'free' })
    const before = JSON.stringify(doc)
    const next = addTexture(doc, makeTex('tex-a'))
    expect(next.textures['tex-a']).toBeDefined()
    expect(next.textures['tex-a']!.name).toBe('tex-a')
    expect(next.meta.updatedAt).toBeGreaterThanOrEqual(doc.meta.updatedAt)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('patchTexture：更新 data；未知 id 原样返回', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    doc = addTexture(doc, makeTex('tex-a'))
    const patched = patchTexture(doc, 'tex-a', { data: 'data:image/png;base64,xyz' })
    expect(patched.textures['tex-a']!.data).toBe('data:image/png;base64,xyz')
    expect(patched.textures['tex-a']!.width).toBe(16)
    expect(patchTexture(doc, 'tex-missing', { data: 'x' })).toBe(doc)
  })

  it('removeTexture：删除条目并清理 faces 引用（uv 保留），其余贴图引用不动', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    doc = addTexture(doc, makeTex('tex-a'))
    doc = addTexture(doc, makeTex('tex-b'))
    const cube = createCubeNode('c')
    cube.faces = {
      north: { uv: [0, 0, 16, 16], texture: 'tex-a' },
      south: { uv: [0, 0, 16, 16], texture: 'tex-b' },
      east: { uv: [0, 0, 16, 16] },
      west: { uv: [0, 0, 16, 16], texture: 'tex-a', rotation: 90 },
      up: { uv: [0, 0, 16, 16] },
      down: { uv: [0, 0, 16, 16] }
    }
    doc = addNode(doc, cube, null)
    const cleaned = removeTexture(doc, 'tex-a')
    expect(cleaned.textures['tex-a']).toBeUndefined()
    expect(cleaned.textures['tex-b']).toBeDefined()
    const node = cleaned.nodes[cube.id]
    expect(node?.type === 'cube' && node.faces.north).toEqual({ uv: [0, 0, 16, 16] })
    expect(node?.type === 'cube' && node.faces.south?.texture).toBe('tex-b')
    expect(node?.type === 'cube' && node.faces.west).toEqual({ uv: [0, 0, 16, 16], rotation: 90 })
    // 原文档不受影响
    const orig = doc.nodes[cube.id]
    expect(orig?.type === 'cube' && orig.faces.north?.texture).toBe('tex-a')
    assertDocumentInvariants(cleaned)
  })

  it('removeTexture：未知 id / 无引用时返回不含该贴图的新文档', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    expect(removeTexture(doc, 'tex-x')).toBe(doc)
    doc = addTexture(doc, makeTex('tex-a'))
    const removed = removeTexture(doc, 'tex-a')
    expect(removed.textures['tex-a']).toBeUndefined()
    expect(Object.keys(removed.nodes).length).toBe(Object.keys(doc.nodes).length)
  })
})
