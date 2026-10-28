/**
 * P0-3：非预算异常（429/超时等）不得逃出 run()。
 *
 * 修复前：最外层 catch 仅兜 BudgetExceededError，其他异常 throw err 逃出 run()，
 * 导致 runs.delete / persistFinish 未执行，历史永远"运行中"且无法断点续跑。
 *
 * 修复后：所有异常都兜底——runs.delete + persistFinish('failed') + 返回错误结果。
 */
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../settingsService', () => ({
  getSection: (section: string) => {
    if (section !== 'ai') return { globalJdkHome: null }
    const ov = { providerId: null, model: null }
    return {
      providers: [
        {
          id: 'p1', name: 'p1', kind: 'openai-compatible', baseUrl: 'http://x',
          apiKey: '', apiKeyUrl: '', model: 'm1', maxTokens: 4096,
          temperature: 0.7, enabled: true
        }
      ],
      defaultProviderId: 'p1',
      tierModels: { sprinter: ov, artisan: ov, master: ov, bridge: ov, weaver: ov },
      manualLock: { tier: null, source: null, lockedAt: null }
    }
  }
}))
vi.mock('../../projectService', () => ({
  openProject: () => null
}))
vi.mock('../orchestrator/generatePipeline', () => ({
  runGeneratePipeline: vi.fn(() => Promise.reject(new Error('429 Too Many Requests')))
}))
import { createOrchestrator } from '../orchestrator'
import { runGeneratePipeline } from '../orchestrator/generatePipeline'
import type { AiChatRequest, AiChatResponse } from '../../../../shared/types/ai'
import type { McpClient } from '../mcpClient'
import type { ReferenceService } from '../referencePackageService'

const CODE_PLAN_JSON = JSON.stringify({
  intent: 'code',
  contentTypes: ['item'],
  stages: ['generate', 'build'],
  goal: '新增测试物品'
})

function makeDeps() {
  const chat = vi.fn(async (_req: AiChatRequest): Promise<AiChatResponse> => {
    return { content: CODE_PLAN_JSON, model: 'm1' }
  })
  const mcp = {
    isEnabled: () => false,
    getStatus: () => ({ kind: 'disabled' }),
    callStaticTool: () => Promise.reject(new Error('disabled'))
  } as unknown as Pick<McpClient, 'isEnabled' | 'getStatus' | 'callStaticTool'>
  const reference = {
    getSystemPromptBase: () => '',
    listMatrixCells: () => []
  } as unknown as ReferenceService
  const contextBuilder = {
    getTemplateContents: () => [],
    getVersionFingerprint: () => '',
    buildMappingDeclaration: () => '',
    matchErrorPatterns: () => []
  } as never
  return { chat, mcp, reference, contextBuilder }
}

function makeRunStore() {
  const finished = new Map<string, { status: string; reply?: string }>()
  const store = {
    createRun: vi.fn(),
    appendEvent: vi.fn(),
    saveCheckpoint: vi.fn(),
    // P1-1 起 runStore 接口新增 updateIntent（真实意图回写），测试替身需与接口同步，
    // 否则 run() 会在 understand 之后抛 "updateIntent is not a function"，永远进不到 generate 阶段
    updateIntent: vi.fn(),
    finishRun: vi.fn((runId: string, status: string, reply?: string) =>
      finished.set(runId, { status, reply })
    ),
    listRuns: vi.fn(() => []),
    getRun: vi.fn(),
    getRunEvents: vi.fn(() => []),
    deleteRun: vi.fn(() => true),
    markInterruptedOnBoot: vi.fn(() => 0)
  }
  return { store, finished }
}

describe('P0-3：非预算异常不逃出 run()', () => {
  it('runGeneratePipeline 抛出 429 → run() 返回 failed 结果，不抛出，落库 failed', async () => {
    const { chat, mcp, reference, contextBuilder } = makeDeps()
    const { store, finished } = makeRunStore()
    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference,
      contextBuilder,
      runStore: store as never,
      idFactory: () => 'run-429'
    })

    const result = await orchestrator.run(
      { message: '新增一个测试物品', projectId: null, loader: 'fabric', mcVersion: '1.20.1' },
      undefined
    )

    // runGeneratePipeline 确实被调用了（generate 阶段进入了）
    expect(vi.mocked(runGeneratePipeline)).toHaveBeenCalled()
    // run() 没有抛出——返回了一个结果对象
    expect(result).toBeDefined()
    expect(result.runId).toBe('run-429')
    // 落库 failed（不是永远"运行中"）
    expect(finished.get('run-429')?.status).toBe('failed')
    // reply 包含错误信息（用户可感知失败原因）
    expect(result.reply).toMatch(/429|失败|错误/i)
  })
})
