/**
 * 反幻觉硬门（鬼泣之刃事件回归）：
 * - code/fix 意图 generate 零产出（无写工具调用、files 为空）时，
 *   先触发一次补救轮；补救仍为零 → 直接判失败，禁止进入 build/export，
 *   回复必须显式说明「生成失败」，不得宣称完成。
 * - 附：sanitizePlan 对「刀/剑/武器」类需求的内容类型兜底路由为 item。
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
import { sanitizePlan } from '../orchestrator/planParse'
import type { AgentEvent, AgentPlan } from '../../../../shared/types/agent'
import type { AiChatResponse } from '../../../../shared/types/ai'
import type { McpClient } from '../mcpClient'
import type { ReferenceService } from '../referencePackageService'

const PLAN = JSON.stringify({
  intent: 'code',
  contentTypes: ['item'],
  stages: ['generate', 'build', 'test'],
  goal: '新增可合成的鬼泣之刃武士刀物品'
})

describe('零产出反幻觉硬门', () => {
  it('generate 零产出：补救一次仍为空 → 判失败、不跑 Gradle、回复不含「完成」', async () => {
    const counter = { n: 0 }
    // 第 1 次：understand 计划；其后所有生成调用均空回复、无工具调用（模拟弱模型零产出）
    const chat = vi.fn(async (): Promise<AiChatResponse> => {
      counter.n += 1
      if (counter.n === 1) return { content: PLAN, model: 'm1' }
      return { content: '好的，我这就开始做。', model: 'm1', toolCalls: [] }
    })

    const runGradle = vi.fn(() => 'run-should-never-happen')
    const mcp = {
      isEnabled: () => false,
      getStatus: () => ({ kind: 'disabled' }),
      callStaticTool: () => Promise.reject(new Error('disabled'))
    } as unknown as Pick<McpClient, 'isEnabled' | 'getStatus' | 'callStaticTool'>
    const registry = {
      getToolDefinitions: () => [],
      registerTool: () => undefined,
      executeTool: vi.fn()
    }

    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference: { getSystemPromptBase: () => '', listMatrixCells: () => [] } as unknown as ReferenceService,
      contextBuilder: {
        getTemplateContents: () => [],
        getVersionFingerprint: () => '',
        buildMappingDeclaration: () => ''
      } as never,
      // @ts-expect-error 仅需字段的桩
      registry,
      resolveProject: () => ({
        id: 'p1',
        name: 'fixture',
        path: 'D:/nonexistent-fixture',
        type: 'mod',
        mcVersion: '1.20.1',
        loader: 'fabric',
        loaderVersion: '0.15.11'
      }),
      runGradle: runGradle as never,
      idFactory: () => 'run-zero'
    })

    const events: AgentEvent[] = []
    const result = await orchestrator.run(
      {
        message: '做一把鬼泣之刃，日本武士刀的模型，右键释放刀气',
        projectId: 'p1',
        loader: 'fabric',
        mcVersion: '1.20.1'
      },
      (event) => events.push(event)
    )

    // understand(1) + 生成首轮(1) + 零产出补救-续写循环(3)
    expect(counter.n).toBe(5)
    // 核心断言：零产出绝不能触发构建
    expect(runGradle).not.toHaveBeenCalled()
    expect(result.build).toBeNull()
    expect(result.test).toBeNull()
    expect(result.export).toBeNull()
    expect(result.files).toEqual([])
    expect(result.reply).toContain('生成失败')
    expect(result.reply).not.toContain('代码完成')
    expect(result.skippedStages).toEqual(expect.arrayContaining(['build', 'test', 'export']))
    // 事件流：generate 阶段报错 + 最终回复
    expect(
      events.some((e) => e.stage === 'generate' && e.type === 'phase' && e.phase === 'error')
    ).toBe(true)
    expect(events.some((e) => e.type === 'reply' && e.reply?.includes('生成失败'))).toBe(true)
  })

  it('只产出资源 JSON、零 Java（代码型目标）→ 完整性门判失败、不跑 Gradle（反假绿灯，run#5 回归）', async () => {
    const counter = { n: 0 }
    const chat = vi.fn(async (): Promise<AiChatResponse> => {
      counter.n += 1
      if (counter.n === 1) return { content: PLAN, model: 'm1' }
      // 首轮只给资源文件（旧代码 + JSON 编译仍会过）；两轮补救均不再产出
      if (counter.n === 2) {
        return {
          content: JSON.stringify({
            files: [
              { path: 'src/main/resources/assets/x/blockstates/solar.json', content: '{}', action: 'create' },
              { path: 'src/main/resources/data/x/recipes/solar.json', content: '{}', action: 'create' }
            ],
            notes: ''
          }),
          model: 'm1',
          toolCalls: []
        }
      }
      return { content: '好的。', model: 'm1', toolCalls: [] }
    })

    const runGradle = vi.fn(() => 'run-should-never-happen')
    const mcp = {
      isEnabled: () => false,
      getStatus: () => ({ kind: 'disabled' }),
      callStaticTool: () => Promise.reject(new Error('disabled'))
    } as unknown as Pick<McpClient, 'isEnabled' | 'getStatus' | 'callStaticTool'>
    const registry = {
      getToolDefinitions: () => [],
      registerTool: () => undefined,
      executeTool: vi.fn()
    }

    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference: { getSystemPromptBase: () => '', listMatrixCells: () => [] } as unknown as ReferenceService,
      contextBuilder: {
        getTemplateContents: () => [],
        getVersionFingerprint: () => '',
        buildMappingDeclaration: () => ''
      } as never,
      // @ts-expect-error 仅需字段的桩
      registry,
      resolveProject: () => ({
        id: 'p1',
        name: 'fixture',
        path: 'D:/nonexistent-fixture',
        type: 'mod',
        mcVersion: '1.20.1',
        loader: 'fabric',
        loaderVersion: '0.15.11'
      }),
      runGradle: runGradle as never,
      idFactory: () => 'run-incomplete'
    })

    const events: AgentEvent[] = []
    const result = await orchestrator.run(
      { message: '做一个太阳能熔炉方块', projectId: 'p1', loader: 'fabric', mcVersion: '1.20.1' },
      (event) => events.push(event)
    )

    expect(runGradle).not.toHaveBeenCalled()
    expect(result.build).toBeNull()
    expect(result.files).toEqual([])
    expect(result.reply).toContain('生成失败')
    expect(
      events.some((e) => e.stage === 'generate' && e.type === 'log' && e.detail?.includes('核心 Java'))
    ).toBe(true)
  })

  it('fallback 路由：武士刀/之刃/武器类需求兜底为 item 而非 block', () => {
    const base: AgentPlan = {
      intent: 'code',
      contentTypes: [],
      stages: ['generate'],
      goal: '',
      tier: 'artisan'
    }
    const a = sanitizePlan(base, '做一把鬼泣之刃，日本武士刀的模型')
    expect(a.contentTypes).toContain('item')
    const b = sanitizePlan(base, '给我加个能发射剑气的武器')
    expect(b.contentTypes).toContain('item')
    // 非物品需求仍走 block，避免过度泛化
    const c = sanitizePlan(base, '做一个带纹路的装饰方块')
    expect(c.contentTypes).toContain('block')
  })
})
