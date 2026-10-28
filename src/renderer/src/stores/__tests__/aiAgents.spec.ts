import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AgentEvent, AgentRunRequest, AgentRunResult } from '../../../../shared/types/agent'
import { useAiAgentsStore } from '../aiAgents'
import { useUiStore } from '../ui'

/** window.api 打桩：store 只经 preload 白名单桥与主进程通信 */
interface ApiMock {
  on: ReturnType<typeof vi.fn>
  agent: {
    run: ReturnType<typeof vi.fn>
    cancel: ReturnType<typeof vi.fn>
    active: ReturnType<typeof vi.fn>
    history: ReturnType<typeof vi.fn>
  }
}
let api: ApiMock

function fakeResult(over: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    runId: 'run-1',
    intent: 'code',
    tier: 'master',
    tierMatched: [],
    reply: '已完成',
    files: [],
    build: null,
    test: null,
    export: null,
    skippedStages: [],
    canceled: false,
    ...over
  }
}

describe('aiAgents 档位选择 store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    api = {
      on: vi.fn(),
      agent: {
        run: vi.fn().mockResolvedValue(fakeResult()),
        cancel: vi.fn().mockResolvedValue(undefined),
        active: vi.fn().mockResolvedValue({ active: false, runId: null }),
        history: vi.fn().mockResolvedValue([])
      }
    }
    ;(window as unknown as { api: ApiMock }).api = api
  })

  describe('setTier 手动选档', () => {
    it('默认为 null（自动路由）', () => {
      const store = useAiAgentsStore()
      expect(store.selectedTier).toBeNull()
    })

    it('设置后持久在 state 中（卡片选中态的数据源）', () => {
      const store = useAiAgentsStore()
      store.setTier('master')
      expect(store.selectedTier).toBe('master')
    })

    it('传 null 切回自动匹配', () => {
      const store = useAiAgentsStore()
      store.setTier('bridge')
      store.setTier(null)
      expect(store.selectedTier).toBeNull()
    })

    it('运行中禁改档位：忽略 setTier 调用', () => {
      const store = useAiAgentsStore()
      store.running = true
      store.setTier('weaver')
      expect(store.selectedTier).toBeNull()

      store.setTier(null)
      store.running = true
      store.setTier('sprinter')
      expect(store.selectedTier).toBeNull()
    })
  })

  describe('resetRun 不抹掉手动档位', () => {
    it('清空运行态但保留 selectedTier（跨次运行沿用用户选择）', () => {
      const store = useAiAgentsStore()
      store.setTier('master')
      store.lastTier = 'master'
      store.lastIntent = 'code'
      store.tierMatched = ['x']
      store.resetRun()
      expect(store.selectedTier).toBe('master')
      expect(store.lastTier).toBeNull()
      expect(store.lastIntent).toBeNull()
      expect(store.tierMatched).toEqual([])
      expect(store.stages.every((s) => s.phase === 'waiting')).toBe(true)
    })
  })

  describe('run 把手选档位真实带入编排请求', () => {
    it('selectedTier=master 时 request.tier 为 master（不会退化成自动路由）', async () => {
      const store = useAiAgentsStore()
      store.setTier('master')
      const err = await store.run('帮我新增一个自定义方块')
      expect(err).toBeNull()

      expect(api.agent.run).toHaveBeenCalledTimes(1)
      const request = api.agent.run.mock.calls[0][0] as AgentRunRequest
      expect(request.tier).toBe('master')
      expect(request.message).toBe('帮我新增一个自定义方块')
      // 无打开项目时的默认目标组合
      expect(request.projectId).toBeNull()
      expect(request.loader).toBe('fabric')
      expect(request.mcVersion).toBe('1.20.1')
    })

    it('自动档（null）时 request.tier 为 null，交由主进程按关键词路由', async () => {
      const store = useAiAgentsStore()
      await store.run('随便聊聊')
      const request = api.agent.run.mock.calls[0][0] as AgentRunRequest
      expect(request.tier).toBeNull()
    })

    it('运行结束回填实际档位与意图，运行锁释放', async () => {
      const store = useAiAgentsStore()
      api.agent.run.mockResolvedValueOnce(
        fakeResult({ runId: 'run-9', intent: 'code', tier: 'master', reply: '大师档交付' })
      )
      await store.run('深度优化')
      expect(store.running).toBe(false)
      expect(store.runId).toBe('run-9')
      expect(store.lastTier).toBe('master')
      expect(store.lastIntent).toBe('code')
    })

    it('主进程抛错时释放运行锁并给出错误气泡，不吞异常', async () => {
      const store = useAiAgentsStore()
      api.agent.run.mockRejectedValueOnce(new Error('boom'))
      await store.run('测试')
      expect(store.running).toBe(false)
      expect(store.visible).toBe(false)
    })

    it('空白消息不发起运行', async () => {
      const store = useAiAgentsStore()
      expect(await store.run('   ')).toBeNull()
      expect(api.agent.run).not.toHaveBeenCalled()
    })
  })

  describe('cancel', () => {
    it('按当前 runId 调用主进程取消', async () => {
      const store = useAiAgentsStore()
      api.agent.run.mockResolvedValueOnce(fakeResult({ runId: 'run-cancel' }))
      await store.run('任务')
      await store.cancel()
      expect(api.agent.cancel).toHaveBeenCalledWith('run-cancel')
    })
  })

  describe('不常驻：AI 助手随项目开启/关闭绑定', () => {
    it('打开项目：主动展开面板、绑定项目、按该项目刷新历史', () => {
      const store = useAiAgentsStore()
      const ui = useUiStore()
      expect(ui.aiPanelVisible).toBe(false)

      store.openForProject('p1')

      expect(ui.aiPanelVisible).toBe(true)
      expect(store.sessionProjectId).toBe('p1')
      expect(api.agent.history).toHaveBeenCalledWith({ projectId: 'p1', limit: 20 })
    })

    it('关闭项目：收起面板并清空运行/历史，解除项目绑定', () => {
      const store = useAiAgentsStore()
      const ui = useUiStore()
      store.openForProject('p1')
      store.runId = 'run-old'
      store.lastReply = '旧的回复'
      store.lastIntent = 'code'
      store.history = [{ id: 'r1' } as never]

      store.closeForProject()

      expect(ui.aiPanelVisible).toBe(false)
      expect(store.sessionProjectId).toBeNull()
      expect(store.runId).toBeNull()
      expect(store.lastReply).toBeNull()
      expect(store.lastIntent).toBeNull()
      expect(store.history).toEqual([])
      expect(store.historyLoaded).toBe(false)
    })

    it('切换项目时旧项目任务在跑：取消旧运行、作废其 runId 并丢弃迟到事件', () => {
      const store = useAiAgentsStore()
      store.openForProject('pA')
      store.running = true
      store.runId = 'run-A'

      store.openForProject('pB')

      expect(api.agent.cancel).toHaveBeenCalledWith('run-A')
      expect(store.running).toBe(false)
      expect(store.runId).toBeNull()
      expect(store.mutedRunId).toBe('run-A')
      expect(store.sessionProjectId).toBe('pB')

      // 旧运行的迟到事件不得污染新项目的轨道
      store.handleEvent({
        runId: 'run-A',
        stage: 'understand',
        type: 'progress',
        detail: '旧项目的日志'
      } as unknown as AgentEvent)
      expect(store.stages.every((s) => s.logs.length === 0)).toBe(true)
    })

    it('启动接管的后台运行（adoptedRunId）在打开项目时被认领，不取消', () => {
      const store = useAiAgentsStore()
      store.running = true
      store.runId = 'run-bg'
      store.adoptedRunId = 'run-bg'

      store.openForProject('p1')

      expect(api.agent.cancel).not.toHaveBeenCalled()
      expect(store.running).toBe(true)
      expect(store.runId).toBe('run-bg')
      expect(store.sessionProjectId).toBe('p1')
      expect(store.adoptedRunId).toBeNull()
      expect(useUiStore().aiPanelVisible).toBe(true)
    })

    it('非接管的未绑定运行在打开项目时被当作旧项目运行取消', () => {
      const store = useAiAgentsStore()
      store.running = true
      store.runId = 'run-other'

      store.openForProject('p1')

      expect(api.agent.cancel).toHaveBeenCalledWith('run-other')
      expect(store.mutedRunId).toBe('run-other')
      expect(store.running).toBe(false)
      expect(store.sessionProjectId).toBe('p1')
    })

    it('重复打开同一项目：仅确保面板展开，不清盘运行态', () => {
      const store = useAiAgentsStore()
      store.openForProject('p1')
      api.agent.cancel.mockClear()
      store.runId = 'run-keep'
      store.running = true

      store.openForProject('p1')

      expect(api.agent.cancel).not.toHaveBeenCalled()
      expect(store.runId).toBe('run-keep')
      expect(store.running).toBe(true)
    })

    it('运行期间切换项目：丢弃旧运行的收尾回填，不写进新项目面板', async () => {
      const store = useAiAgentsStore()
      store.openForProject('pA')
      let release: (r: AgentRunResult) => void = () => {}
      api.agent.run.mockReturnValueOnce(
        new Promise<AgentRunResult>((res) => {
          release = res
        })
      )

      const pending = store.run('做点东西')
      // 运行未结束时切到另一个项目
      store.openForProject('pB')
      release(fakeResult({ runId: 'run-A', tier: 'master', reply: '旧项目的产物' }))
      await pending

      expect(store.lastReply).toBeNull()
      expect(store.runId).toBeNull()
      expect(store.sessionProjectId).toBe('pB')
    })
  })
})
