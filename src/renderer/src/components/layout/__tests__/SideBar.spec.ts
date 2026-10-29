import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SideBar from '../SideBar.vue'
import { registerBuiltinModules } from '../../../modules'
import { useProjectStore } from '../../../stores/project'
import { useUiStore } from '../../../stores/ui'
import type { Project, ProjectType } from '../../../../../shared/types/project'

/**
 * 侧栏文件树归属：
 * - 模块自带专属侧栏（数据包/资源包等）时显示专属树
 * - 模块没有专属侧栏（整合包组装、建模器等）时，有项目即回落为项目文件树
 * - 未打开项目时不显示文件树（显示模块说明占位）
 */
registerBuiltinModules()

function makeProject(type: ProjectType, id: string): Project {
  return {
    id,
    name: `${type}-项目`,
    type,
    path: `C:\\proj\\${id}`,
    loader: type === 'mod' ? 'fabric' : null,
    mcVersion: '1.20.1',
    loaderVersion: type === 'mod' ? '0.15.11' : null,
    modId: id,
    namespace: id,
    jdkPath: null,
    description: '',
    createdAt: 0,
    lastOpenedAt: 0
  }
}

/** 侧栏挂载时会 refresh 一次项目列表，用可变数组模拟主进程返回 */
let apiProjects: Project[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  apiProjects = []
  Object.assign(window, { api: { project: { list: async () => apiProjects } } })
})

describe('SideBar · 文件树回落', () => {
  it('整合包项目在「整合包组装」模块下仍显示项目文件树', async () => {
    apiProjects = [makeProject('modpack', 'mp')]
    useProjectStore().currentProjectId = 'mp'
    useUiStore().setActiveModule('modpack')

    const w = mount(SideBar, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    // 文件树分支自带刷新按钮（模块未注册专属侧栏时回落为项目文件树）
    expect(w.find('.sb-head-btn').exists()).toBe(true)
    // 异步组件在测试环境可能停在 Suspense 占位：断言走的是文件树分支（而非模块说明占位）
    expect(w.find('.sb-placeholder').exists()).toBe(false)
    expect(w.find('.sb-loading').exists()).toBe(true)
  })

  it('未打开项目时不渲染文件树，显示模块说明占位', async () => {
    useUiStore().setActiveModule('gallery')

    const w = mount(SideBar, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(w.find('.file-tree').exists()).toBe(false)
    expect(w.find('.sb-placeholder').exists()).toBe(true)
  })
})
