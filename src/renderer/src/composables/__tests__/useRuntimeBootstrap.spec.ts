/**
 * 首启运行环境后台自动置备。
 *
 * 覆盖的是本次改动的核心行为：不再把首次使用者导航到设置页，而是在后台直接
 * 下载 JDK + 目标版本运行时，并在已经就绪时保持静默（不做无谓的下载与打扰）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JdkDetectResult, JdkInfo } from '../../../../shared/types/build'
import type { McInstance } from '../../../../shared/types/mcRuntime'
import { DEFAULT_MC_VERSION, useRuntimeBootstrap } from '../useRuntimeBootstrap'

interface ApiMock {
  jdk: {
    detect: ReturnType<typeof vi.fn>
    provision: ReturnType<typeof vi.fn>
  }
  mc: {
    listInstances: ReturnType<typeof vi.fn>
    provision: ReturnType<typeof vi.fn>
  }
  on: ReturnType<typeof vi.fn>
}

let api: ApiMock

function detectResult(over: Partial<JdkDetectResult> = {}): JdkDetectResult {
  return {
    compatible: false,
    jdk: null,
    requiredMajor: 21,
    candidates: [],
    requirements: { requiredMajor: 21, preferredMajor: 21, maxMajor: 25 },
    ...over
  } as JdkDetectResult
}

function instance(mcVersion: string): McInstance {
  return {
    id: mcVersion,
    name: mcVersion,
    mcVersion,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null
  }
}

function fakeJdk(): JdkInfo {
  return { home: '/jdk', javaPath: '/jdk/bin/java', version: '21', major: 21, source: 'managed' }
}

beforeEach(() => {
  api = {
    jdk: {
      detect: vi.fn(async () => detectResult()),
      provision: vi.fn(async () => ({
        ok: true,
        jdk: fakeJdk(),
        home: '/jdk'
      }))
    },
    mc: {
      listInstances: vi.fn(async () => [] as McInstance[]),
      provision: vi.fn(async () => ({ ok: true }))
    },
    on: vi.fn(() => () => {})
  }
  ;(globalThis as unknown as { window: { api: ApiMock } }).window.api = api
})

describe('useRuntimeBootstrap 首启自动置备', () => {
  it('已就绪时不下载：JDK 兼容且目标版本实例存在则保持静默', async () => {
    api.jdk.detect = vi.fn(async () =>
      detectResult({ compatible: true, jdk: fakeJdk() })
    )
    api.mc.listInstances = vi.fn(async () => [instance(DEFAULT_MC_VERSION)])

    const { autoStart, phase, visible } = useRuntimeBootstrap()
    await autoStart({ mcVersion: DEFAULT_MC_VERSION })

    expect(api.jdk.provision).not.toHaveBeenCalled()
    expect(api.mc.provision).not.toHaveBeenCalled()
    expect(phase.value).toBe('idle')
    expect(visible.value).toBe(false)
  })

  it('未就绪时按 JDK → MC 顺序下载，并以目标版本置备', async () => {
    const { autoStart, phase, mcPct, targetVersion } = useRuntimeBootstrap()
    await autoStart({ mcVersion: '1.20.1', mirror: 'https://mirror.example' })

    expect(api.jdk.provision).toHaveBeenCalledWith({ major: 21 })
    expect(api.mc.provision).toHaveBeenCalledWith({
      mcVersion: '1.20.1',
      name: '1.20.1',
      mirror: 'https://mirror.example'
    })
    expect(targetVersion.value).toBe('1.20.1')
    expect(mcPct.value).toBe(100)
    expect(phase.value).toBe('done')
  })

  it('JDK 已兼容但缺目标版本实例时只补 MC 运行时', async () => {
    api.jdk.detect = vi.fn(async () =>
      detectResult({ compatible: true, jdk: fakeJdk() })
    )

    const { autoStart, phase } = useRuntimeBootstrap()
    await autoStart({ mcVersion: DEFAULT_MC_VERSION })

    expect(api.jdk.provision).not.toHaveBeenCalled()
    expect(api.mc.provision).toHaveBeenCalledTimes(1)
    expect(phase.value).toBe('done')
  })

  it('镜像为空串时不透传 mirror（回退主进程按网络设置解析）', async () => {
    const { autoStart } = useRuntimeBootstrap()
    await autoStart({ mcVersion: DEFAULT_MC_VERSION, mirror: '   ' })

    expect(api.mc.provision).toHaveBeenCalledWith({
      mcVersion: DEFAULT_MC_VERSION,
      name: DEFAULT_MC_VERSION,
      mirror: undefined
    })
  })

  it('JDK 下载失败进入 error 态并给出原因，不继续下载 MC', async () => {
    api.jdk.provision = vi.fn(async () => ({ ok: false, errorMessage: '镜像不可达' }))

    const { autoStart, phase, message, busy } = useRuntimeBootstrap()
    await autoStart({ mcVersion: DEFAULT_MC_VERSION })

    expect(api.mc.provision).not.toHaveBeenCalled()
    expect(phase.value).toBe('error')
    expect(message.value).toContain('镜像不可达')
    expect(busy.value).toBe(false)
  })

  it('「稍后」只隐藏进度条，不改变已完成的阶段', async () => {
    const { autoStart, dismiss, visible, phase } = useRuntimeBootstrap()
    await autoStart({ mcVersion: DEFAULT_MC_VERSION })
    expect(phase.value).toBe('done')

    dismiss()
    expect(visible.value).toBe(false)
    expect(phase.value).toBe('dismissed')
  })
})
