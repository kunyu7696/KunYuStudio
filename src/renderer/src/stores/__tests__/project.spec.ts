import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Project } from '../../../../shared/types/project'
import { useProjectStore } from '../project'
import { useExplorerStore } from '../explorer'
import { useEditorStore } from '../editor'

/** window.api 打桩：store 只经 preload 白名单桥与主进程通信 */
interface ApiMock {
  project: {
    open: ReturnType<typeof vi.fn>
    relocate: ReturnType<typeof vi.fn>
  }
  fs: {
    readDir: ReturnType<typeof vi.fn>
    stat: ReturnType<typeof vi.fn>
    writeFile: ReturnType<typeof vi.fn>
  }
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

describe('project store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    api = {
      project: {
        open: vi.fn().mockResolvedValue(fakeProject()),
        relocate: vi.fn().mockResolvedValue(fakeProject({ path: 'D:/proj/b' }))
      },
      fs: {
        readDir: vi.fn().mockResolvedValue([]),
        stat: vi.fn().mockResolvedValue({
          path: 'D:/proj/a',
          name: 'a',
          kind: 'directory',
          ext: '',
          size: 0,
          mtime: 0
        }),
        writeFile: vi.fn().mockResolvedValue(123)
      }
    }
    ;(window as unknown as { api: ApiMock }).api = api
  })

  it('open 事务化：文件树根跟随新项目（不再依赖调用方补 setRoot）', async () => {
    const store = useProjectStore()
    await store.open('p1')
    const explorer = useExplorerStore()
    expect(explorer.rootPath).toBe('D:/proj/a')
    expect(api.fs.readDir).toHaveBeenCalledWith('D:/proj/a')
  })

  it('open 事务化：关闭不属于新根的标签（脏标签先落盘），保留属于新根的标签', async () => {
    const editor = useEditorStore()
    editor.tabs.push(
      { path: 'D:/old/x.java', name: 'x.java', ext: 'java', content: 'a', dirty: true, mtime: 0, language: 'java' },
      { path: 'D:/proj/a/src/y.java', name: 'y.java', ext: 'java', content: 'b', dirty: false, mtime: 0, language: 'java' }
    )
    editor.activePath = 'D:/old/x.java'

    const store = useProjectStore()
    await store.open('p1')

    expect(api.fs.writeFile).toHaveBeenCalledWith('D:/old/x.java', 'a')
    expect(editor.tabs.map((t) => t.path)).toEqual(['D:/proj/a/src/y.java'])
    expect(editor.activePath).toBe('D:/proj/a/src/y.java')
  })

  it('open 成功后写入 localStorage 并置顶列表（pathExists 归位为 true）', async () => {
    const store = useProjectStore()
    store.projects = [fakeProject({ id: 'p0', path: 'D:/proj/z', pathExists: false })]
    await store.open('p1')
    expect(store.currentProjectId).toBe('p1')
    expect(localStorage.getItem('kunyu:last-project-id')).toBe('p1')
    expect(store.projects[0].id).toBe('p1')
    expect(store.projects[0].pathExists).toBe(true)
  })

  it('relocate 更新列表项路径并标记 pathExists', async () => {
    const store = useProjectStore()
    store.projects = [fakeProject({ pathExists: false })]
    const updated = await store.relocate('p1')
    expect(api.project.relocate).toHaveBeenCalledWith('p1')
    expect(updated?.path).toBe('D:/proj/b')
    expect(store.projects[0].path).toBe('D:/proj/b')
    expect(store.projects[0].pathExists).toBe(true)
  })

  it('relocate 主进程对话框取消时返回 undefined 且不更新列表', async () => {
    api.project.relocate.mockResolvedValue(undefined)
    const store = useProjectStore()
    store.projects = [fakeProject({ pathExists: false, path: 'D:/proj/a' })]
    const updated = await store.relocate('p1')
    expect(updated).toBeUndefined()
    expect(api.project.relocate).toHaveBeenCalledWith('p1')
    expect(store.projects[0].path).toBe('D:/proj/a')
    expect(store.projects[0].pathExists).toBe(false)
  })

  it('open 失败（路径不存在）时不触碰文件树与当前项目', async () => {
    api.project.open.mockRejectedValue(new Error('项目路径不存在: D:/gone'))
    const explorer = useExplorerStore()
    const store = useProjectStore()
    await expect(store.open('gone')).rejects.toThrow('项目路径不存在')
    expect(store.currentProjectId).toBeNull()
    expect(explorer.rootPath).toBeNull()
  })
})
