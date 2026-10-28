/**
 * AI 助手发送路由：Agent 工程模式只在打开项目后生效；
 * 未打开项目（主界面）时面板是普通聊天框——即使 Agent 开关残留为开，
 * 发送也只走厂商问答，避免在主页发起会写盘的项目工作。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatMessaging } from '../assistant/useChatMessaging'
import { useProjectStore } from '../../../stores/project'
import { useAiAgentsStore } from '../../../stores/aiAgents'

const agentRun = vi.fn().mockResolvedValue({ runId: 'run-1', tier: 'master', reply: 'ok' })
const agentCancel = vi.fn().mockResolvedValue(undefined)
const agentHistory = vi.fn().mockResolvedValue([])
const agentActive = vi.fn().mockResolvedValue({ active: false, runId: null })

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  ;(window as unknown as { api: unknown }).api = {
    on: vi.fn(),
    agent: { run: agentRun, cancel: agentCancel, history: agentHistory, active: agentActive },
    ai: { chatStream: vi.fn(), chatStop: vi.fn() }
  }
  agentRun.mockClear()
})

function openFakeProject(): void {
  const projectStore = useProjectStore()
  projectStore.projects = [
    { id: 'p1', name: '测试模组', path: 'D:/p1', type: 'mod' } as never
  ]
  projectStore.currentProjectId = 'p1'
}

describe('useChatMessaging 发送路由（无项目 = 普通聊天框）', () => {
  it('未打开项目：Agent 开关为开也不走 Agent 编排', async () => {
    const { agentMode, send } = useChatMessaging()
    agentMode.value = true

    await send('你好')

    expect(agentRun).not.toHaveBeenCalled()
    expect(useAiAgentsStore().running).toBe(false)
  })

  it('已打开项目：Agent 开关为开则走 Agent 编排', async () => {
    openFakeProject()
    const { agentMode, send } = useChatMessaging()
    agentMode.value = true

    await send('加一个方块')

    expect(agentRun).toHaveBeenCalledTimes(1)
  })

  it('已打开项目但 Agent 开关关闭：仍走普通问答', async () => {
    openFakeProject()
    const { send } = useChatMessaging()

    await send('你好')

    expect(agentRun).not.toHaveBeenCalled()
  })
})
