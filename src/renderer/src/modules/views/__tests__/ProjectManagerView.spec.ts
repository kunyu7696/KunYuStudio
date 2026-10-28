/**
 * ProjectManagerView 视图测试（此前 4 个视图零组件测试）。
 * 覆盖欢迎页三态（加载中/空列表/有列表）与工作区态切换、挂载时刷新。
 * 工作区态直接渲染真实 ExplorerView（其 Monaco 依赖单独 mock，与 ExplorerView.spec 同法）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ProjectManagerView from '../ProjectManagerView.vue'
import { useProjectStore } from '../../../stores/project'
import type { Project } from '../../../../../shared/types/project'

vi.mock('../../../components/editor/CodeEditor.vue', () => ({
  default: {
    name: 'CodeEditor',
    props: ['path', 'content', 'language'],
    template: '<div class="code-editor-stub" />'
  }
}))
vi.mock('../../../components/editor/DiffEditor.vue', () => ({
  default: {
    name: 'DiffEditor',
    props: ['path', 'original', 'modified', 'language'],
    template: '<div class="diff-editor-stub" />'
  }
}))

const listMock = vi.fn()

function stubApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    project: { list: listMock },
    on: vi.fn(() => vi.fn())
  }
}

const fakeProject = {
  id: 'p1',
  name: 'demo',
  root: 'D:/projects/demo',
  type: 'mod',
  loader: 'fabric',
  mcVersion: '1.21.1',
  createdAt: 0,
  updatedAt: 0
} as unknown as Project

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  stubApi()
  listMock.mockResolvedValue([])
})

describe('欢迎页（未打开项目）', () => {
  it('挂载时刷新项目列表，空列表显示"还没有项目"', async () => {
    const w = mount(ProjectManagerView, { global: { plugins: [ElementPlus] } })
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(w.find('.pm-loading').exists()).toBe(false))
    expect(w.find('h1').text()).toBe('项目管理')
    expect(w.find('.pm-hint h2').text()).toBe('还没有项目')
  })

  it('有项目但未选中时提示数量', async () => {
    listMock.mockResolvedValue([fakeProject])
    const w = mount(ProjectManagerView, { global: { plugins: [ElementPlus] } })
    await vi.waitFor(() => expect(w.find('.pm-hint h2').text()).toBe('请选择一个项目'))
    expect(w.find('.pm-hint p').text()).toContain('1 个项目')
  })

  it('加载中渲染 loading 态', async () => {
    listMock.mockReturnValue(new Promise(() => {})) // 永不 resolve
    const w = mount(ProjectManagerView, { global: { plugins: [ElementPlus] } })
    await vi.waitFor(() => expect(w.find('.pm-loading').exists()).toBe(true))
    expect(w.find('.pm-loading span').text()).toBe('加载中…')
  })
})

describe('工作区态（已打开项目）', () => {
  it('渲染工作区容器与真实资源管理器而非欢迎页', async () => {
    const store = useProjectStore()
    store.projects = [fakeProject]
    store.currentProjectId = 'p1'
    listMock.mockResolvedValue([fakeProject]) // onMounted refresh 不清空当前项目
    const w = mount(ProjectManagerView, { global: { plugins: [ElementPlus] } })
    await vi.waitFor(() => expect(w.find('.pm-workspace').exists()).toBe(true))
    // P0-2：ExplorerView 是 defineAsyncComponent 懒加载——必须等它真正挂载，
    // 否则用例结束后 jsdom 已拆除，异步 resolve 的组件 setup 读 localStorage 抛
    // Unhandled Rejection，导致"摘要全绿但退出码 1"的 flaky 门禁。
    await vi.waitFor(() => expect(w.find('.workspace').exists()).toBe(true))
    expect(w.find('.pm-hint').exists()).toBe(false)
    expect(w.classes()).toContain('is-workspace')
  })
})
