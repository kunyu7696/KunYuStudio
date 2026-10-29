import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ActivityBar from '../ActivityBar.vue'
import { registerBuiltinModules } from '../../../modules'
import { useProjectStore } from '../../../stores/project'
import type { Project, ProjectType } from '../../../../../shared/types/project'

/**
 * 活动栏模块可见性契约（requireProject / homeOnly / projectTypes 组合）：
 * - 未打开项目：只显示不要求项目的模块 —— 资产库、Mod 库、模组与市场、全流程 AI 制作、版本与产物等
 * - 打开 mod 项目：模组与市场、全流程 AI 制作都不出现；资产库出现；光影包编辑器不出现
 * - 打开 modpack 项目：模组与市场出现
 * - 打开 shaderpack 项目：光影包编辑器出现
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

/** 按项目类型挂载活动栏，展开全部分组后返回可见模块名列表 */
async function visibleLabels(type: ProjectType | null): Promise<string[]> {
  const store = useProjectStore()
  store.projects = type ? [makeProject(type, `p-${type}`)] : []
  store.currentProjectId = type ? `p-${type}` : null
  const w = mount(ActivityBar, { global: { plugins: [ElementPlus] } })
  // 分组默认折叠（仅创作工坊展开）：先点开全部组头再收集，可见性断言针对注册逻辑而非折叠态
  for (const h of w.findAll('.ab-grp-h')) {
    if (h.attributes('aria-expanded') === 'false') await h.trigger('click')
  }
  return w.findAll('.ab-label').map((n) => n.text())
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('ActivityBar · 模块可见性', () => {
  it('未打开项目：资产库与模组与市场都在主页活动栏', async () => {
    const labels = await visibleLabels(null)
    expect(labels).toContain('资产库')
    expect(labels).toContain('模组与市场')
    expect(labels).toContain('全流程 AI 制作')
    // 要求项目的模块（如数据包编辑器、整合包组装）不出现在主页
    expect(labels).not.toContain('数据包编辑器')
    expect(labels).not.toContain('整合包组装')
  })

  it('资源库在任意场景都可见（全局库，不绑定项目）', async () => {
    expect(await visibleLabels(null)).toContain('资源库')
    for (const type of ['mod', 'modpack', 'datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(await visibleLabels(type)).toContain('资源库')
    }
  })

  it('普通 mod 项目：模组与市场不出现，资产库出现', async () => {
    const labels = await visibleLabels('mod')
    expect(labels).not.toContain('模组与市场')
    expect(labels).toContain('资产库')
    expect(labels).toContain('数据包编辑器')
  })

  it('打开项目后「全流程 AI 制作」从项目页移除（仅主页保留）', async () => {
    expect(await visibleLabels(null)).toContain('全流程 AI 制作')
    for (const type of ['mod', 'modpack', 'datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(await visibleLabels(type)).not.toContain('全流程 AI 制作')
    }
  })

  it('整合包项目：模组与市场出现（其余项目类型下都不出现）', async () => {
    expect(await visibleLabels('modpack')).toContain('模组与市场')
    for (const type of ['datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(await visibleLabels(type)).not.toContain('模组与市场')
    }
  })

  it('光影包编辑器只在光影包项目里出现（模组项目已移除）', async () => {
    expect(await visibleLabels('shaderpack')).toContain('光影包编辑器')
    for (const type of ['mod', 'modpack', 'datapack', 'resourcepack'] as ProjectType[]) {
      expect(await visibleLabels(type)).not.toContain('光影包编辑器')
    }
    expect(await visibleLabels(null)).not.toContain('光影包编辑器')
  })
})

describe('ActivityBar · 折叠', () => {
  it('默认展开；点左缘折叠条收起为 12px 竖条，再点恢复并持久化', async () => {
    const store = useProjectStore()
    store.projects = []
    store.currentProjectId = null
    const w = mount(ActivityBar, { global: { plugins: [ElementPlus] } })
    const nav = w.find('.activity-bar')
    expect(nav.attributes('style')).toBeUndefined()

    await w.find('.ab-fold').trigger('click')
    expect(nav.attributes('style')).toContain('12px')
    expect(w.find('.ab-panel').attributes('style')).toContain('display: none')
    expect(localStorage.getItem('kunyu.activitybar.collapsed')).toBe('1')

    await w.find('.ab-fold').trigger('click')
    expect(nav.attributes('style')).toBeUndefined()
    expect(w.find('.ab-panel').attributes('style') ?? '').not.toContain('display: none')
    expect(localStorage.getItem('kunyu.activitybar.collapsed')).toBe('0')
  })
})

describe('ActivityBar · 项目管理分组', () => {
  it('项目管理为可折叠分组：含创建/导入入口与项目列表，折叠后隐藏并持久化', async () => {
    const store = useProjectStore()
    store.projects = [makeProject('mod', 'p1'), makeProject('modpack', 'p2')]
    store.currentProjectId = null
    const w = mount(ActivityBar, { global: { plugins: [ElementPlus] } })

    const head = w.findAll('.ab-grp-h').find((h) => h.text().includes('项目管理'))
    expect(head).toBeTruthy()
    // 组头右侧数量与项目数一致
    expect(head!.find('.ab-grp-cnt').text()).toBe('2')

    // 分组内入口顺序：创建项目 → 导入项目；随后是项目条目
    expect(w.findAll('.pn-row').map((r) => r.text())).toEqual(['创建项目', '导入项目'])
    expect(w.findAll('.pn-proj')).toHaveLength(2)
    expect(w.find('.pn-proj-name').text()).toContain('mod-项目')

    await head!.trigger('click')
    expect(w.findAll('.pn-proj')).toHaveLength(0)
    expect(w.findAll('.pn-row')).toHaveLength(0)
    expect(localStorage.getItem('kunyu.activitybar.projectOpen')).toBe('0')
  })

  it('项目管理不再作为普通常驻项渲染（避免与分组重复）', async () => {
    const w = mount(ActivityBar, { global: { plugins: [ElementPlus] } })
    const labels = w.findAll('.ab-label').map((n) => n.text())
    expect(labels).not.toContain('项目管理')
  })
})
