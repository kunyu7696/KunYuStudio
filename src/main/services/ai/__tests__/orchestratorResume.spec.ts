/**
 * 断点续跑：注入 mock runStore + mock chat，验证 resumeFrom 跳过 understand/generate，
 * files/build 恢复、reply 正常；同时验证 resumeRun 前置校验与任务图落库。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
      tierModels: {
        sprinter: ov, artisan: ov, master: ov, bridge: ov, weaver: ov
      },
      manualLock: { tier: null, source: null, lockedAt: null }
    }
  }
}))
vi.mock('../../projectService', () => ({
  openProject: () => null
}))
import { createOrchestrator } from '../orchestrator'
import type {
  AgentEvent,
  AgentFileChange,
  AgentPlan,
  AgentRunCheckpoint,
  AgentRunRecord
} from '../../../../shared/types/agent'
import type { AiChatRequest, AiChatResponse } from '../../../../shared/types/ai'
import type { McpClient } from '../mcpClient'
import type { ReferenceService } from '../referencePackageService'

const RESUMED_PLAN: AgentPlan = {
  intent: 'code',
  contentTypes: ['item'],
  stages: ['generate', 'build', 'test'],
  goal: '新增测试物品',
  tier: 'artisan'
}

const RESUMED_FILES: AgentFileChange[] = [
  { path: 'src/main/java/com/example/ModItems.java', action: 'create', content: '// code', accepted: true },
  { path: 'src/main/resources/assets/example/lang/en_us.json', action: 'modify', content: '{}', accepted: true }
]

function makeDeps(chatCallCount: { n: number }) {
  const chat = vi.fn(async (_req: AiChatRequest): Promise<AiChatResponse> => {
    chatCallCount.n += 1
    return { content: '（不应被调用）', model: 'm1' }
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

function makeRunStore(): {
  store: {
    createRun: ReturnType<typeof vi.fn>
    appendEvent: ReturnType<typeof vi.fn>
    saveCheckpoint: ReturnType<typeof vi.fn>
    finishRun: ReturnType<typeof vi.fn>
    listRuns: ReturnType<typeof vi.fn>
    getRun: ReturnType<typeof vi.fn>
    getRunEvents: ReturnType<typeof vi.fn>
    deleteRun: ReturnType<typeof vi.fn>
    markInterruptedOnBoot: ReturnType<typeof vi.fn>
  }
  saved: Map<string, AgentRunCheckpoint>
  finished: Map<string, { status: string; reply?: string }>
} {
  const saved = new Map<string, AgentRunCheckpoint>()
  const finished = new Map<string, { status: string; reply?: string }>()
  const store = {
    createRun: vi.fn(),
    appendEvent: vi.fn(),
    saveCheckpoint: vi.fn((runId: string, cp: AgentRunCheckpoint) => saved.set(runId, cp)),
    finishRun: vi.fn((runId: string, status: string, reply?: string) => finished.set(runId, { status, reply })),
    listRuns: vi.fn(() => []),
    getRun: vi.fn(),
    getRunEvents: vi.fn(() => []),
    deleteRun: vi.fn(() => true),
    markInterruptedOnBoot: vi.fn(() => 0)
  }
  return { store, saved, finished }
}

describe('orchestrator 断点续跑', () => {
  it('resumeFrom completedStage=generate：跳过 understand/generate，恢复 files/build，reply 正常', async () => {
    const { chat, mcp, reference, contextBuilder } = makeDeps({ n: 0 })
    const { store, finished } = makeRunStore()
    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference,
      contextBuilder,
      runStore: store as never,
      idFactory: () => 'run-resume'
    })

    const checkpoint: AgentRunCheckpoint = {
      version: 1,
      completedStage: 'generate',
      plan: RESUMED_PLAN,
      files: RESUMED_FILES,
      contract: null,
      build: null,
      test: null,
      skippedStages: [],
      generateNotes: '续跑恢复的生成说明'
    }

    const events: AgentEvent[] = []
    const result = await orchestrator.run(
      {
        message: '新增一个测试物品',
        projectId: null,
        loader: 'fabric',
        mcVersion: '1.20.1'
      },
      (ev) => events.push(ev),
      checkpoint
    )

    // understand 与 generate 的 LLM 调用均被跳过
    expect(chat).not.toHaveBeenCalled()
    // 事件流含续跑恢复的 phase 事件（轨道可感知）
    expect(events.some((e) => e.stage === 'understand' && e.phase === 'done' && e.action?.includes('（续跑）已恢复'))).toBe(true)
    expect(events.some((e) => e.stage === 'generate' && e.phase === 'done' && e.action?.includes('（续跑）已恢复'))).toBe(true)
    // 恢复产物：files 原样保留
    expect(result.files).toEqual(RESUMED_FILES)
    // build 因无项目被跳过（skipped）；test 走 kunyu-observer 离线兜底同样 skipped
    expect(result.build?.status).toBe('skipped')
    expect(result.test?.status).toBe('skipped')
    // reply 正常产出（标题由 RunOutcome 派生，不再拼接 plan.goal）
    expect(result.reply).toContain('部分完成')
    expect(result.reply).toContain('构建未触发')
    expect(result.runId).toBe('run-resume')
    // 任务图落库：RunOutcome 派生 runStatus——本场景 build/test 均 skipped、verdict=partial，
    // 故落 failed（可断点续跑），completedStage='understand'（零产出/无构建从 generate 重跑）
    // persistFinish 现在携带第 5 参 usage；本场景无模型调用 → undefined
    expect(store.finishRun).toHaveBeenCalledWith(
      'run-resume', 'failed', expect.any(String), expect.anything(), undefined
    )
    expect(finished.get('run-resume')?.status).toBe('failed')
  })

  it('resumeRun：从历史记录恢复并跑完剩余阶段', async () => {
    const { chat, mcp, reference, contextBuilder } = makeDeps({ n: 0 })
    const { store } = makeRunStore()
    const historyRecord: AgentRunRecord = {
      id: 'history-1',
      projectId: null,
      tier: 'artisan',
      intent: 'code',
      request: {
        message: '新增一个测试物品',
        projectId: null,
        loader: 'fabric',
        mcVersion: '1.20.1'
      },
      checkpoint: {
        version: 1,
        completedStage: 'generate',
        plan: RESUMED_PLAN,
        files: RESUMED_FILES,
        contract: null,
        build: null,
        test: null,
        skippedStages: [],
        generateNotes: ''
      },
      status: 'interrupted',
      reply: null,
      usage: null,
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 60000,
      finishedAt: Date.now() - 60000
    }
    store.getRun.mockReturnValue(historyRecord)

    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference,
      contextBuilder,
      runStore: store as never,
      idFactory: () => 'run-resume-2'
    })

    const result = await orchestrator.resumeRun('history-1')
    expect(result.runId).toBe('run-resume-2')
    expect(result.files).toEqual(RESUMED_FILES)
    expect(chat).not.toHaveBeenCalled()
  })

  it('resumeRun：记录不存在/已完成时抛中文错误', async () => {
    const { chat, mcp, reference, contextBuilder } = makeDeps({ n: 0 })
    const { store } = makeRunStore()
    store.getRun.mockReturnValue(null)
    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference,
      contextBuilder,
      runStore: store as never,
      idFactory: () => 'run-x'
    })

    await expect(orchestrator.resumeRun('missing')).rejects.toThrow('找不到历史任务记录')

    store.getRun.mockReturnValue({
      id: 'r-done',
      status: 'completed',
      checkpoint: null,
      request: { message: 'm', projectId: null, loader: 'fabric', mcVersion: '1.20.1' }
    })
    await expect(orchestrator.resumeRun('r-done')).rejects.toThrow('该任务已完成，无需续跑')
  })

  // understand 失败也要保留 reply（失败原因落历史，列表可见）+ checkpoint（可续跑）
  it('understand 调用失败：finishRun 携带失败 reply 与 checkpoint（不再是裸 failed）', async () => {
    const { mcp, reference, contextBuilder } = makeDeps({ n: 0 })
    const chat = vi.fn(async (_req: AiChatRequest): Promise<AiChatResponse> => {
      throw new Error('connect ECONNREFUSED')
    })
    const { store, saved } = makeRunStore()
    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference,
      contextBuilder,
      runStore: store as never,
      idFactory: () => 'run-understand-fail'
    })

    const result = await orchestrator.run(
      { message: '新增一个测试物品', projectId: null, loader: 'fabric', mcVersion: '1.20.1' },
      () => {}
    )

    expect(result.intent).toBe('chat')
    expect(result.reply).toContain('模型调用失败')
    const call = store.finishRun.mock.calls.at(-1)!
    expect(call[0]).toBe('run-understand-fail')
    expect(call[1]).toBe('failed')
    // reply = 失败原因（历史列表可见），而非 undefined
    expect(call[2]).toContain('理解阶段调用失败')
    // checkpoint 保留（version:1 + completedStage，续跑入口可重跑 understand）
    expect(call[3]).toMatchObject({ version: 1, completedStage: 'understand' })
    // 无成功调用 → usage 为 null（未初始化时不落空用量）
    expect(call[4]).toBeUndefined()
    expect(saved.size).toBe(0)
  })

  // usage 落库——成功调用后 finishRun 携带累计 token 用量
  it('understand 判定为普通问答：usage 累计并落库（token/成本可查）', async () => {
    const { mcp, reference, contextBuilder } = makeDeps({ n: 0 })
    const chat = vi.fn(async (_req: AiChatRequest): Promise<AiChatResponse> => ({
      content: '这是普通问答的回答',
      model: 'm1',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }
    }))
    const { store } = makeRunStore()
    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference,
      contextBuilder,
      runStore: store as never,
      idFactory: () => 'run-usage'
    })

    await orchestrator.run(
      { message: '你好', projectId: null, loader: 'fabric', mcVersion: '1.20.1' },
      () => {}
    )

    const call = store.finishRun.mock.calls.at(-1)!
    expect(call[1]).toBe('completed')
    // usage：单次调用 → modelCalls=1；厂商 totalTokens 缺失时回退 prompt+completion 求和
    expect(call[4]).toEqual({ promptTokens: 100, completionTokens: 50, totalTokens: 150, modelCalls: 1 })
  })

  it('构建失败：落库 failed + 断点停在 generate（可续跑重跑构建），不是绿灯（P0-B）', async () => {
    // 真目录 + gradlew 桩，让 hasGradlew 通过；runGradle mock 直接报 exitCode=1
    const root = mkdtempSync(join(tmpdir(), 'ky-resume-buildfail-'))
    writeFileSync(join(root, 'gradlew.bat'), '@rem stub\r\n')
    try {
      const { chat, mcp, contextBuilder } = makeDeps({ n: 0 })
      // 参考包组合激活，build 阶段才会真正触发
      const reference = {
        getSystemPromptBase: () => '',
        listMatrixCells: () => [{ id: 'fabric-1.20.1', active: true }]
      } as unknown as ReferenceService
      const { store, finished, saved } = makeRunStore()
      const runGradle = vi.fn(
        (_input: unknown, sink: (e: Record<string, unknown>) => void) => {
          queueMicrotask(() =>
            sink({ type: 'phase', phase: 'done', runId: 'gradle-1', exitCode: 1, cancelled: false, timedOut: false })
          )
          return 'gradle-1'
        }
      )
      const project = {
        id: 'p1',
        name: 'demo',
        path: root,
        type: 'mod',
        mcVersion: '1.20.1',
        loader: 'fabric',
        loaderVersion: '0.15.11'
      } as const
      const orchestrator = createOrchestrator({
        chat,
        mcp,
        reference,
        contextBuilder,
        runStore: store as never,
        resolveProject: () => project as never,
        runGradle: runGradle as never,
        idFactory: () => 'run-build-fail'
      })

      // 迅工档直出（无修复轮），断点从 generate 之后续跑
      const checkpoint: AgentRunCheckpoint = {
        version: 1,
        completedStage: 'generate',
        plan: { ...RESUMED_PLAN, tier: 'sprinter' },
        files: RESUMED_FILES,
        contract: null,
        build: null,
        test: null,
        skippedStages: [],
        generateNotes: ''
      }
      const result = await orchestrator.run(
        { message: '新增一个测试物品', projectId: 'p1', loader: 'fabric', mcVersion: '1.20.1' },
        undefined,
        checkpoint
      )

      expect(runGradle).toHaveBeenCalled()
      expect(result.build?.status).toBe('fail')
      // 落库 failed（历史里不是绿灯），断点 completedStage='generate' → 续跑重跑 build+治愈循环
      expect(finished.get('run-build-fail')?.status).toBe('failed')
      const finishCheckpoint = store.finishRun.mock.calls.at(-1)?.[3] as AgentRunCheckpoint
      expect(finishCheckpoint.completedStage).toBe('generate')
      // 断点快照可用（resumeRun 前置校验放行 failed）
      expect(saved.size).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
