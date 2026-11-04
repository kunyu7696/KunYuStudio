/**
 * modeler store 项目隔离测试。
 * 修复点：sessions / openDocIds 只按 doc.id 索引，不同项目可能重名（如 block__xxx）；
 * 切项目若不整体清空会话，就会把上一个项目的模型「串」到新项目里。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { Project } from '../../../../shared/types/project'
import { createDocument, serializeDocument } from '../../../../shared/modeler/document'
import { useProjectStore } from '../project'
import { useModelerStore } from '../modeler'

interface ApiMock {
  fs: {
    readDir: ReturnType<typeof vi.fn>
    readFile: ReturnType<typeof vi.fn>
  }
  modeler: { checkDocRecovery: ReturnType<typeof vi.fn> }
}
let api: ApiMock

function fakeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: '演示',
    type: 'mod',
    path: 'D:/proj/a',
    loader: 'fabric',
    mcVersion: '1.20.1',
    loaderVersion: '0.15.11',
    modId: 'demo',
    namespace: 'demo',
    jdkPath: null,
    description: '',
    createdAt: 1,
    lastOpenedAt: 1,
    ...over
  }
}

/** .kunyu/modeler 目录按项目根返回不同的已保存文档 */
function filesByRoot(): Record<string, { name: string; kind: string }[]> {
  return {
    'D:/proj/a/.kunyu/modeler': [{ name: '盾牌.json', kind: 'file' }],
    'D:/proj/b/.kunyu/modeler': [{ name: '盔甲.json', kind: 'file' }]
  }
}

describe('modeler store 项目隔离', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const files = filesByRoot()
    api = {
      fs: {
        readDir: vi.fn(async (path: string) => {
          if (!files[path]) throw new Error('ENOENT')
          return files[path]
        }),
        readFile: vi.fn(async (path: string) => {
          const m = /modeler\/(.+?)\.json$/.exec(path)
          if (!m) throw new Error('ENOENT')
          const doc = createDocument({ name: m[1]!, format: 'java_block' })
          doc.id = m[1]!
          return { content: JSON.stringify(serializeDocument(doc)) }
        })
      },
      modeler: { checkDocRecovery: vi.fn().mockResolvedValue(null) }
    }
    ;(window as unknown as { api: ApiMock }).api = api
  })

  it('切换项目会清空上一项目的标签/当前文档/选择，并加载新项目文档列表', async () => {
    const project = useProjectStore()
    project.projects = [
      fakeProject({ id: 'p1', path: 'D:/proj/a' }),
      fakeProject({ id: 'p2', path: 'D:/proj/b' })
    ]
    project.currentProjectId = 'p1'
    const store = useModelerStore()
    await store.refreshList()
    expect(store.docIds).toEqual(['盾牌'])

    // 在 A 项目里新建内存文档（未落盘）
    store.create('甲模型', 'java_block')
    expect(store.doc?.name).toBe('甲模型')
    expect(store.openDocIds).toHaveLength(1)

    project.currentProjectId = 'p2'
    await nextTick()
    await nextTick()

    expect(store.doc).toBeNull()
    expect(store.openDocIds).toEqual([])
    expect(store.docIds).toEqual(['盔甲'])
    expect(store.selection).toEqual([])

    // 切回 A：旧文档不能“复活”，列表按 A 重新加载
    project.currentProjectId = 'p1'
    await nextTick()
    await nextTick()

    expect(store.doc).toBeNull()
    expect(store.openDocIds).toEqual([])
    expect(store.docIds).toEqual(['盾牌'])
  })

  it('同名 doc id 跨项目不会复用上一项目的内存会话', async () => {
    const project = useProjectStore()
    project.projects = [
      fakeProject({ id: 'p1', path: 'D:/proj/a' }),
      fakeProject({ id: 'p2', path: 'D:/proj/b' })
    ]
    project.currentProjectId = 'p1'
    const store = useModelerStore()
    // 手工制造一个内存会话（模拟从对象编辑器「在模型工坊打开」的绑定文档）
    store.create('甲模型', 'java_block')
    const sharedId = store.doc!.id

    project.currentProjectId = 'p2'
    await nextTick()
    await nextTick()
    expect(store.openDocIds).toEqual([])

    // 新项目里再打开同名 id：必须按新项目磁盘内容新建会话，而不是复用旧文档
    await store.open(sharedId)
    expect(store.doc?.id).toBe(sharedId)
    expect(store.doc?.name).toBe(sharedId)
    expect(store.openDocIds).toEqual([sharedId])
  })
})
