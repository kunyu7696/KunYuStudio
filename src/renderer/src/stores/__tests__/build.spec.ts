/**
 * build store detectJdk 上下文推导测试。
 * 修复点：loader 缺失（导入项目未探测）时必须带 mcVersion 走主进程纯 MC 推导，
 * 否则整体落 1.20.1 时代默认值，26.3 项目永远推不到 JDK 25。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Project } from '../../../../shared/types/project'
import type { JdkDetectResult } from '../../../../shared/types/build'
import { useBuildStore } from '../build'
import { useProjectStore } from '../project'

/** window.api 打桩：store 只经 preload 白名单桥与主进程通信 */
interface ApiMock {
  jdk: {
    detect: ReturnType<typeof vi.fn>
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

function fakeDetect(requiredMajor: number): JdkDetectResult {
  return {
    jdk: null,
    requirements: { requiredMajor, preferredMajor: requiredMajor, maxMajor: 999 },
    requiredMajor,
    compatible: false,
    message: '',
    candidates: [],
    javaHomeEnv: ''
  }
}

function openProject(over: Partial<Project> = {}): void {
  const project = useProjectStore()
  project.projects = [fakeProject(over)]
  project.currentProjectId = 'p1'
}

describe('build store detectJdk 上下文推导', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    api = { jdk: { detect: vi.fn().mockResolvedValue(fakeDetect(17)) } }
    ;(window as unknown as { api: ApiMock }).api = api
  })

  it('loader + mcVersion 齐全：按加载器矩阵推导', async () => {
    openProject()
    const build = useBuildStore()
    await build.detectJdk(null)
    expect(api.jdk.detect).toHaveBeenCalledWith(null, { loader: 'fabric', mcVersion: '1.20.1' })
  })

  it('loader 缺失：带 mcVersion 走纯 MC 推导，26.3 项目可推到 JDK 25', async () => {
    openProject({ loader: null, loaderVersion: null, mcVersion: '26.3' })
    api.jdk.detect.mockResolvedValue(fakeDetect(25))
    const build = useBuildStore()
    const result = await build.detectJdk(null)
    expect(api.jdk.detect).toHaveBeenCalledWith(null, { loader: null, mcVersion: '26.3' })
    expect(result.requirements.requiredMajor).toBe(25)
  })

  it('无打开项目：不传上下文（主进程回退 legacy 默认）', async () => {
    const build = useBuildStore()
    await build.detectJdk(null)
    expect(api.jdk.detect).toHaveBeenCalledWith(null, undefined)
  })
})
