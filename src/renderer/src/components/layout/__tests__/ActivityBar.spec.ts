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
 * - 未打开项目：只显示不要求项目的模块 —— 资产库、资源库、模组与市场、版本与产物等
 * - 打开 mod 项目：模组与市场、资产库、资源库都不出现（主页已有入口）；光影包编辑器不出现
 * - 打开 modpack 项目：模组与市场出现
 * - 打开 shaderpack 项目：光影包编辑器出现
 * - 灵感台为应用级模式（顶栏切换），任何状态下都不出现在活动栏
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
  it('未打开项目：资产库与模组与市场都在主页活动栏', () => {
    const labels = visibleLabels(null)
    expect(labels).toContain('资产库')
    expect(labels).toContain('模组与市场')
    // 要求项目的模块（如数据包编辑器、整合包组装）不出现在主页
    expect(labels).not.toContain('数据包编辑器')
    expect(labels).not.toContain('整合包组装')
  })

  it('资产库与资源库为主页活动栏专用（打开任何项目后隐藏）', () => {
    expect(visibleLabels(null)).toContain('资产库')
    expect(visibleLabels(null)).toContain('资源库')
    for (const type of ['mod', 'modpack', 'datapack', 'resourcepack', 'shaderpack'] as ProjectType[]) {
      expect(visibleLabels(type)).not.toContain('资产库')
      expect(visibleLabels(type)).not.toContain('资源库')
    }
  })

  it('普通 mod 项目：模组与市场、资产库、资源库都不出现', () => {
    const labels = visibleLabels('mod')
    expect(labels).not.toContain('模组与市场')
    expect(labels).not.toContain('资产库')
    expect(labels).not.toContain('资源库')
    expect(labels).toContain('数据包编辑器')
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
