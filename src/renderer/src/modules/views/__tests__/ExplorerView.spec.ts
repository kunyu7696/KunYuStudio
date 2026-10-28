/**
 * ExplorerView（代码工作区）视图测试。
 * 覆盖空态提示、标签栏渲染/激活/脏标记/关闭。Monaco 编辑器以 stub 替换。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ExplorerView from '../ExplorerView.vue'
import { useEditorStore } from '../../../stores/editor'

vi.mock('../../../components/editor/CodeEditor.vue', () => ({
  default: { name: 'CodeEditor', template: '<div class="code-editor-stub" />', props: ['path', 'content', 'language'] }
}))
vi.mock('../../../components/editor/DiffEditor.vue', () => ({
  default: { name: 'DiffEditor', template: '<div class="diff-editor-stub" />', props: ['path', 'original', 'modified', 'language'] }
}))

function stubApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    on: vi.fn(() => vi.fn()),
    fs: { writeTextFile: vi.fn(async () => undefined), readTextFile: vi.fn(async () => '') }
  }
}

function mountView() {
  return mount(ExplorerView, { global: { plugins: [ElementPlus] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  stubApi()
})

describe('空态', () => {
  it('无标签页时显示空态提示', () => {
    const w = mountView()
    expect(w.find('.ws-empty h2').text()).toBe('没有打开的文件')
    expect(w.find('.ws-tabs').exists()).toBe(false)
  })

  it('未打开项目时引导去项目管理', () => {
    const w = mountView()
    expect(w.find('.ws-hint').exists()).toBe(true)
    expect(w.find('.ws-hint').text()).toContain('项目管理')
  })
})

describe('标签栏', () => {
  it('渲染标签名/脏标记/激活态，点击切换激活', async () => {
    const editor = useEditorStore()
    editor.tabs = [
      { path: 'D:/p/A.java', name: 'A.java', ext: 'java', content: '', dirty: false, mtime: 0, language: 'java' },
      { path: 'D:/p/B.json', name: 'B.json', ext: 'json', content: '', dirty: true, mtime: 0, language: 'json' }
    ]
    editor.activePath = 'D:/p/A.java'
    const w = mountView()
    const tabs = w.findAll('.ws-tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.classes()).toContain('active')
    expect(tabs[0]!.find('.ws-dirty-dot').exists()).toBe(false)
    expect(tabs[1]!.find('.ws-dirty-dot').exists()).toBe(true)
    await tabs[1]!.trigger('click')
    expect(editor.activePath).toBe('D:/p/B.json')
  })

  it('非脏标签点击关闭直接移除并回退激活到相邻标签', async () => {
    const editor = useEditorStore()
    editor.tabs = [
      { path: 'D:/p/A.java', name: 'A.java', ext: 'java', content: '', dirty: false, mtime: 0, language: 'java' },
      { path: 'D:/p/B.json', name: 'B.json', ext: 'json', content: '', dirty: false, mtime: 0, language: 'json' }
    ]
    editor.activePath = 'D:/p/B.json'
    const w = mountView()
    await w.findAll('.ws-tab .ws-tab-close')[1]!.trigger('click')
    expect(editor.tabs.map((t) => t.name)).toEqual(['A.java'])
    expect(editor.activePath).toBe('D:/p/A.java')
  })
})
