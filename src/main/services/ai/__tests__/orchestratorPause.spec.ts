/**
 * TR-9.1：显式状态机暂停/恢复。
 * - 暂停后：不启动 understand 的模型调用、无新阶段事件
 * - 恢复后：流水线继续至完成；事件流含 paused 与 resumed
 * - generate 轮内暂停后晚到的模型结果不执行工具/落盘，恢复后继续
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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
import type { AgentEvent } from '../../../../shared/types/agent'
import type { AiChatRequest, AiChatResponse } from '../../../../shared/types/ai'
import type { ContextBuilder } from '../contextBuilder'
import type { GradleEvent } from '../../../../shared/types/build'
import type { McpClient } from '../mcpClient'
import type { ReferenceService } from '../referencePackageService'

const PLAN = JSON.stringify({
  intent: 'chat',
  contentTypes: [],
  stages: [],
  goal: '打个招呼'
})

function makeChat(): {
  chat: (req: AiChatRequest) => Promise<AiChatResponse>
  counter: { n: number }
}
{
  const counter = { n: 0 }
  const chat = (): Promise<AiChatResponse> => {
    counter.n += 1
    const content = counter.n === 1 ? PLAN : '你好，这是测试回答。'
    return Promise.resolve({ content } as AiChatResponse)
  }
  return { chat, counter }
}

describe('orchestrator 暂停/恢复', () => {
  it('暂停时不启动新阶段，恢复后完成，事件含 paused/resumed', async () => {
    const { chat, counter } = makeChat()
    const mcp = {
      isEnabled: () => false,
      getStatus: () => ({ kind: 'disabled' }),
      callStaticTool: () => Promise.reject(new Error('disabled'))
    } as unknown as Pick<McpClient, 'isEnabled' | 'getStatus' | 'callStaticTool'>
    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference: { getSystemPromptBase: () => '', getKunyuCapabilities: () => '' } as unknown as ReferenceService,
      idFactory: () => 'run-1'
    })

    const events: AgentEvent[] = []
    let pausedOnce = false
    const resultPromise = orchestrator.run(
      {
        message: '你好',
        projectId: null,
        loader: 'fabric',
        mcVersion: '1.20.1'
      },
      (event) => {
        events.push(event)
        // 首个事件（档位 log）到达即暂停，此时尚未进入 understand
        if (!pausedOnce) {
          pausedOnce = true
          orchestrator.pause(event.runId)
        }
      }
    )

    // 给事件循环时间，确认暂停期间无模型调用
    await new Promise((r) => setTimeout(r, 50))
    expect(counter.n).toBe(0)
    expect(events.some((e) => e.stage === 'understand' && e.phase === 'running')).toBe(false)
    expect(events.some((e) => e.type === 'paused')).toBe(true)

    orchestrator.resume('run-1')
    const result = await resultPromise

    expect(counter.n).toBe(2)
    expect(result.intent).toBe('chat')
    expect(events.some((e) => e.type === 'resumed')).toBe(true)
    // 恢复后流水线继续：出现 understand running 与最终 reply
    expect(events.some((e) => e.stage === 'understand' && e.phase === 'running')).toBe(true)
    expect(events.some((e) => e.type === 'reply')).toBe(true)
  })

  it('暂停后晚到的模型结果不执行工具/落盘，恢复后继续', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'kunyu-pause-a9-'))
    writeFileSync(join(projectDir, 'gradlew.bat'), '@echo off\r\n')
    mkdirSync(join(projectDir, 'build', 'libs'), { recursive: true })
    writeFileSync(join(projectDir, 'build', 'libs', 'pause-a9-1.0.0.jar'), 'fake-jar')

    const PLAN_A9 = JSON.stringify({
      intent: 'code',
      contentTypes: ['block'],
      stages: ['generate', 'build', 'test'],
      goal: '新增暂停测试方块'
    })
    const CODER_A9 = JSON.stringify({
      files: [
        {
          path: 'src/main/java/com/example/a9/A9Block.java',
          action: 'create',
          content: 'package com.example.a9; public class A9Block {}'
        }
      ],
      notes: '暂停恢复续跑完成'
    })

    const events: AgentEvent[] = []
    let writes = 0
    let n = 0
    let releaseGenerate!: (r: AiChatResponse) => void
    const generateGate = new Promise<AiChatResponse>((resolve) => {
      releaseGenerate = resolve
    })
    const chat = (_req: AiChatRequest): Promise<AiChatResponse> => {
      n += 1
      if (n === 1) return Promise.resolve({ content: PLAN_A9 } as AiChatResponse)
      if (n === 2) return generateGate // generate 首轮：挂起，由测试在暂停后放行
      return Promise.resolve({ content: CODER_A9 } as AiChatResponse)
    }

    const orchestrator = createOrchestrator({
      chat,
      mcp: {
        isEnabled: () => false,
        getStatus: () => ({ kind: 'disabled' }),
        callStaticTool: () => Promise.reject(new Error('disabled'))
      } as unknown as Pick<McpClient, 'isEnabled' | 'getStatus' | 'callStaticTool'>,
      reference: {
        getSystemPromptBase: () => '',
        getKunyuCapabilities: () => '',
        listMatrixCells: () => [
          {
            id: 'fabric-1.20.1',
            loader: 'fabric',
            mcVersion: '1.20.1',
            loaderVersion: '0.15.11',
            mapping: 'yarn',
            jdk: '17',
            health: 'ok',
            driftRisk: 'low',
            active: true,
            templateCount: 1,
            verifiedAt: null,
            note: ''
          }
        ],
        getFingerprint: () => null,
        findTemplates: () => [],
        findErrorPatterns: () => [],
        getApiIndex: () => null
      } as unknown as ReferenceService,
      contextBuilder: {
        detectContentTypes: () => [],
        getTemplateContents: () => [],
        matchErrorPatterns: () => [],
        getErrorFixContext: () => ({ templates: [], patterns: [] }),
        getVersionFingerprint: () => '',
        getHealthStatus: () => 'ok',
        buildDriftWarning: () => '',
        buildMappingDeclaration: () => '',
        buildSystemPrompt: () => ''
      } as unknown as ContextBuilder,
      runGradle: (_input, sink) => {
        const runId = 'gradle-a9'
        setTimeout(() => {
          sink({ type: 'phase', phase: 'done', runId, exitCode: 0, cancelled: false, timedOut: false } as GradleEvent)
        }, 5)
        return runId
      },
      gradleBusy: () => false,
      resolveProject: () => ({
        id: 'p1',
        name: 'pause-a9',
        path: projectDir,
        type: 'mod',
        mcVersion: '1.20.1',
        loader: 'fabric',
        loaderVersion: '0.15.11'
      }),
      writeFile: () => {
        writes += 1
      },
      idFactory: () => 'run-a9'
    })

    const resultPromise = orchestrator.run(
      { message: '做一个暂停测试方块', projectId: 'p1', loader: 'fabric', mcVersion: '1.20.1', tier: 'sprinter' },
      (e) => events.push(e)
    )

    // 等待 generate 首轮 chat 已发出（n===2）
    const deadline = Date.now() + 5000
    while (n < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5))
    expect(n).toBe(2)

    // 暂停后再放行晚到的响应（携带 write_project_file 工具调用）
    orchestrator.pause('run-a9')
    releaseGenerate({
      content: '',
      toolCalls: [
        {
          id: 't1',
          type: 'function',
          function: {
            name: 'write_project_file',
            arguments: JSON.stringify({
              relPath: 'src/main/java/com/example/a9/A9Block.java',
              content: 'package com.example.a9; public class A9Block {}'
            })
          }
        }
      ]
    } as AiChatResponse)

    // 暂停期间：晚到结果不得执行工具、不得写盘
    await new Promise((r) => setTimeout(r, 120))
    expect(events.some((e) => (e.action ?? '').includes('write_project_file'))).toBe(false)
    expect(writes).toBe(0)

    // 恢复后：本轮工具执行、文件落盘、流水线跑完
    orchestrator.resume('run-a9')
    await resultPromise
    expect(events.some((e) => (e.action ?? '').includes('write_project_file'))).toBe(true)
    expect(writes).toBeGreaterThan(0)
    expect(events.some((e) => e.type === 'paused')).toBe(true)
    expect(events.some((e) => e.type === 'resumed')).toBe(true)
  }, 15000)
})
