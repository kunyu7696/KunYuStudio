import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ActivityBar from '../ActivityBar.vue'
import { registerBuiltinModules } from '../../../modules'
import { useProjectStore } from '../../../stores/project'
import type { Project, ProjectType } from '../../../../../shared/types/project'

/**
 * 活动栏四层可见性契约（requireProject / homeOnly / projectTypes 组合）：
 * L1 无项目层（homeOnly）：资产库、资源库、模组与市场、插件库与商城、DSH 插件
 * L2 有项目层（requireProject + projectTypes）：各编辑器的项目类型装配
 * L3 跟随层（仅 requireProject）：模型工坊、版本与产物
 * L4 全局层（无约束）：项目管理、设置、反编译
 * 灵感台为应用级模式（顶栏切换），任何状态下都不出现在活动栏
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

/** 按项目类型挂载活动栏，返回可见模块名列表 */
function visibleLabels(type: ProjectType | null): string[] {
  const store = useProjectStore()
  store.projects = type ? [makeProject(type, `p-${type}`)] : []
  store.currentProjectId = type ? `p-${type}` : null
  const w = mount(ActivityBar, { global: { plugins: [ElementPlus] } })
  return w.findAll('.ab-label').map((n) => n.text())
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('ActivityBar · 模块可见性', () => {
  it('未打开项目：主页入口出现，项目专属模块不出现', () => {
    const labels = visibleLabels(null)
    expect(labels).toContain('资产库')
    expect(labels).toContain('模组与市场')
    expect(labels).toContain('插件库与商城')
    expect(labels).toContain('DSH 插件')
    // 要求项目的模块（如数据包编辑器、整合包组装、版本与产物）不出现在主页
    expect(labels).not.toContain('数据包编辑器')
    expect(labels).not.toContain('整合包组装')
    expect(labels).not.toContain('版本与产物')
  })

  it('资产库与资源库为主页活动栏专用（打开任何项目后隐藏）', () => {
    expect(visibleLabels(null)).toContain('资产库')
    expect(visibleLabels(null)).toContain('资源库')
    for (const type of ['mod', 'modpack', 'datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(visibleLabels(type)).not.toContain('资产库')
      expect(visibleLabels(type)).not.toContain('资源库')
    }
  })

  it('普通 mod 项目：工坊链出现，包编辑器与主页入口不出现', () => {
    const labels = visibleLabels('mod')
    expect(labels).not.toContain('模组与市场')
    expect(labels).not.toContain('资产库')
    expect(labels).not.toContain('资源库')
    expect(labels).not.toContain('数据包编辑器')
    expect(labels).not.toContain('资源包编辑器')
    expect(labels).toContain('工坊')
    expect(labels).toContain('音效工坊')
    expect(labels).toContain('性能画像')
    expect(labels).toContain('CI/CD 集成')
    expect(labels).toContain('版本与产物')
  })

  it('资源包 / 数据包编辑器只在本类型项目里出现', () => {
    expect(visibleLabels('resourcepack')).toContain('资源包编辑器')
    expect(visibleLabels('datapack')).toContain('数据包编辑器')
    for (const type of ['mod', 'modpack', 'datapack', 'shaderpack'] as ProjectType[]) {
      expect(visibleLabels(type)).not.toContain('资源包编辑器')
    }
    for (const type of ['mod', 'modpack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(visibleLabels(type)).not.toContain('数据包编辑器')
    }
  })

  it('性能画像只在模组与整合包项目里出现', () => {
    expect(visibleLabels(null)).not.toContain('性能画像')
    for (const type of ['datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(visibleLabels(type)).not.toContain('性能画像')
    }
  })

  it('插件库与 DSH 插件只在主页出现；版本与产物只在项目内出现', () => {
    const home = visibleLabels(null)
    expect(home).toContain('插件库与商城')
    expect(home).toContain('DSH 插件')
    expect(home).not.toContain('版本与产物')
    const mod = visibleLabels('mod')
    expect(mod).not.toContain('插件库与商城')
    expect(mod).not.toContain('DSH 插件')
    expect(mod).toContain('版本与产物')
  })

  it('FTB 任务书、指南书与 KubeJS 脚本仅整合包项目可见', () => {
    for (const name of ['FTB 任务书', '指南书', 'KubeJS 脚本']) {
      expect(visibleLabels('modpack')).toContain(name)
      expect(visibleLabels(null)).not.toContain(name)
      for (const type of ['mod', 'datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
        expect(visibleLabels(type)).not.toContain(name)
      }
    }
  })

  it('「全流程 AI 制作」已移除（灵感台为应用级模式，不占活动栏）', () => {
    expect(visibleLabels(null)).not.toContain('全流程 AI 制作')
    for (const type of ['mod', 'modpack', 'datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(visibleLabels(type)).not.toContain('全流程 AI 制作')
    }
  })

  it('整合包项目：模组与市场出现（其余项目类型下都不出现）', () => {
    expect(visibleLabels('modpack')).toContain('模组与市场')
    for (const type of ['datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(visibleLabels(type)).not.toContain('模组与市场')
    }
  })

  it('光影包编辑器只在光影包项目里出现（模组项目已移除）', () => {
    expect(visibleLabels('shaderpack')).toContain('光影包编辑器')
    for (const type of ['mod', 'modpack', 'datapack', 'resourcepack'] as ProjectType[]) {
      expect(visibleLabels(type)).not.toContain('光影包编辑器')
    }
    expect(visibleLabels(null)).not.toContain('光影包编辑器')
  })
})
