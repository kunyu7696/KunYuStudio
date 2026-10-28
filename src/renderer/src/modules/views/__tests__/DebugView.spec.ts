/**
 * DebugView JDK 候选列表测试。
 * 修复点：删除硬编码 `.bad` 灰化（c.major < 17 || c.major > 23），
 * 改为按当前项目工具链 requirements 逐行显示兼容性徽章——
 * 26.3 项目的 JDK 25 显示「推荐」而非灰化，1.20.1 项目的 JDK 25 显示「版本过高」。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import DebugView from '../DebugView.vue'
import { useBuildStore } from '../../../stores/build'
import { useProjectStore } from '../../../stores/project'
import type { Project } from '../../../../../shared/types/project'
import type { JdkDetectResult, JdkInfo, JdkRequirements } from '../../../../../shared/types/build'

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

function jdk(home: string, major: number, version: string): JdkInfo {
  return { home, javaPath: `${home}/bin/java.exe`, version, major, source: 'scanned' }
}

function fakeDetect(requirements: JdkRequirements, over: Partial<JdkDetectResult> = {}): JdkDetectResult {
  return {
    jdk: null,
    requirements,
    requiredMajor: requirements.requiredMajor,
    compatible: true,
    message: '',
    candidates: [],
    javaHomeEnv: '',
    ...over
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  ;(window as unknown as { api: unknown }).api = {}
})

function mountView() {
  return mount(DebugView, { global: { plugins: [ElementPlus] } })
}

describe('JDK 候选兼容性徽章', () => {
  it('26.3 项目：JDK 25 显示「推荐」，低版本显示「版本过低」，无硬编码灰化', () => {
    const project = useProjectStore()
    project.projects = [fakeProject({ loader: null, loaderVersion: null, mcVersion: '26.3' })]
    project.currentProjectId = 'p1'
    const build = useBuildStore()
    build.jdk = fakeDetect(
      { requiredMajor: 25, preferredMajor: 25, maxMajor: 25 },
      {
        jdk: jdk('/jdks/25', 25, '25'),
        candidates: [jdk('/jdks/25', 25, '25'), jdk('/jdks/21', 21, '21.0.5'), jdk('/jdks/17', 17, '17.0.13')]
      }
    )
    const w = mountView()
    const items = w.findAll('.dv-jdks li')
    expect(items).toHaveLength(3)
    expect(items[0].text()).toContain('推荐')
    expect(items[1].text()).toContain('版本过低')
    expect(items[2].text()).toContain('版本过低')
    expect(w.find('.dv-jdks li.bad').exists()).toBe(false)
  })

  it('1.20.1 项目：JDK 17 推荐、21 兼容、25 版本过高、8 版本过低', () => {
    const project = useProjectStore()
    project.projects = [fakeProject()]
    project.currentProjectId = 'p1'
    const build = useBuildStore()
    build.jdk = fakeDetect(
      { requiredMajor: 17, preferredMajor: 17, maxMajor: 23 },
      {
        jdk: jdk('/jdks/17', 17, '17.0.13'),
        candidates: [
          jdk('/jdks/17', 17, '17.0.13'),
          jdk('/jdks/21', 21, '21.0.5'),
          jdk('/jdks/25', 25, '25'),
          jdk('/jdks/8', 8, '1.8.0_442')
        ]
      }
    )
    const w = mountView()
    const items = w.findAll('.dv-jdks li')
    expect(items).toHaveLength(4)
    expect(items[0].text()).toContain('推荐')
    expect(items[1].text()).toContain('兼容')
    expect(items[2].text()).toContain('版本过高')
    expect(items[3].text()).toContain('版本过低')
    expect(w.find('.dv-jdks li.bad').exists()).toBe(false)
  })
})
