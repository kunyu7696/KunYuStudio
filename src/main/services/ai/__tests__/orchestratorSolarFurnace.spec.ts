/**
 * 集成监测：修复后的五阶段事件流（太阳能熔炉场景，fabric/1.21.1）。
 *
 * 验证点（对应用户反馈的 4 个 bug）：
 * 1. build 阶段必须出现 phase=running（节点亮起），不再静默跳过
 * 2. test 阶段必须出现 phase=running，且 kunyu-observer 在线时落到 done
 * 3. 流水线不再自动导出（导出分离为手动按钮）：结果与事件流均无 export 痕迹
 * 4. fabric/1.21.1 这样的"已激活但非 1.20.1"组合不再被硬编码卡成储备
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
      tierModels: { sprinter: ov, artisan: ov, master: ov, bridge: ov, weaver: ov },
      manualLock: { tier: null, source: null, lockedAt: null },
      visualReviewEnabled: false
    }
  }
}))
vi.mock('../../projectService', () => ({ openProject: () => null }))
// kunyu-observer 探针在线桩：test 阶段走真机探针通道到 connected-ok
vi.mock('../../observer/observerClient', () => ({
  probeObserver: () =>
    Promise.resolve({
      port: 9876,
      health: { ok: true, mod: 'kunyu-observer-agent', version: '2.1.0-agent', minecraft: '1.21.1', protocol: 3, inGame: true }
    }),
  fetchPlayerState: () =>
    Promise.resolve({ name: 'Steve', x: 0, y: 64, z: 0, gameMode: 'creative', dimension: 'minecraft:overworld' }),
  fetchScreenshot: () =>
    Promise.resolve({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' })
}))

import { createOrchestrator } from '../orchestrator'
import type { AgentEvent } from '../../../../shared/types/agent'
import type { AiChatRequest, AiChatResponse } from '../../../../shared/types/ai'
import type { McpClient } from '../mcpClient'
import type { ReferenceService } from '../referencePackageService'
import type { ContextBuilder } from '../contextBuilder'
import type { GradleEvent, GradleRunInput } from '../../../../shared/types/build'

const PLAN = JSON.stringify({
  intent: 'code',
  contentTypes: ['block'],
  stages: ['generate', 'build', 'test'],
  goal: '新增太阳能熔炉方块'
})

const CODER = JSON.stringify({
  files: [
    {
      path: 'src/main/java/com/example/solar/SolarFurnaceBlock.java',
      action: 'create',
      content: 'package com.example.solar; public class SolarFurnaceBlock {}'
    }
  ],
  notes: '太阳能熔炉骨架已生成'
})

function makeChat() {
  let n = 0
  const chat = (_req: AiChatRequest): Promise<AiChatResponse> => {
    n += 1
    const content = n === 1 ? PLAN : CODER
    return Promise.resolve({ content } as AiChatResponse)
  }
  return chat
}

function makeReference(): ReferenceService {
  return {
    getSystemPromptBase: () => '',
    listMatrixCells: () => [
      {
        id: 'fabric-1.21.1',
        loader: 'fabric',
        mcVersion: '1.21.1',
        loaderVersion: '0.15.11',
        mapping: 'yarn',
        jdk: '21',
        health: 'ok',
        driftRisk: 'low',
        active: true,
        templateCount: 0,
        verifiedAt: null,
        note: ''
      }
    ],
    getFingerprint: () => null,
    findTemplates: () => [],
    findErrorPatterns: () => [],
    getApiIndex: () => null
  } as unknown as ReferenceService
}

function makeContextBuilder(): ContextBuilder {
  return {
    detectContentTypes: () => [],
    getTemplateContents: () => [],
    matchErrorPatterns: () => [],
    getErrorFixContext: () => ({ templates: [], patterns: [] }),
    getVersionFingerprint: () => '',
    getHealthStatus: () => 'ok',
    buildDriftWarning: () => '',
    buildMappingDeclaration: () => '',
    buildSystemPrompt: () => ''
  } as unknown as ContextBuilder
}

describe('orchestrator 太阳能熔炉（修复后事件流）', () => {
  it('fabric/1.21.1 激活组合：build/test 全阶段亮起，流水线不自动导出', async () => {
    // 临时目录放 gradlew.bat，绕过 hasGradlew 真实文件检查
    const projectDir = mkdtempSync(join(tmpdir(), 'kunyu-solar-'))
    writeFileSync(join(projectDir, 'gradlew.bat'), '@echo off\r\n')
    // 模拟构建产物（planExport 需要 build/libs/*.jar 真实存在才会 ok）
    mkdirSync(join(projectDir, 'build', 'libs'), { recursive: true })
    writeFileSync(join(projectDir, 'build', 'libs', 'solar-furnace-1.0.0.jar'), 'fake-jar')

    const events: AgentEvent[] = []
    const gradleCalls: GradleRunInput[] = []

    const runGradle = (input: GradleRunInput, sink: (e: GradleEvent) => void): string => {
      gradleCalls.push(input)
      const runId = `gradle-${gradleCalls.length}`
      // 异步发 done 事件，模拟一次成功构建
      setTimeout(() => {
        sink({ type: 'phase', phase: 'done', runId, exitCode: 0, cancelled: false, timedOut: false } as GradleEvent)
      }, 5)
      return runId
    }

    const orchestrator = createOrchestrator({
      chat: makeChat(),
      mcp: {
        isEnabled: () => false,
        getStatus: () => ({ kind: 'disabled' }),
        callStaticTool: () => Promise.reject(new Error('disabled'))
      } as unknown as McpClient,
      reference: makeReference(),
      contextBuilder: makeContextBuilder(),
      runGradle,
      gradleBusy: () => false,
      resolveProject: (id) =>
        id === 'p1'
          ? {
              id: 'p1',
              name: 'solar-furnace',
              path: projectDir,
              type: 'mod',
              mcVersion: '1.21.1',
              loader: 'fabric',
              loaderVersion: '0.15.11'
            }
          : null,
      writeFile: () => undefined,
      idFactory: () => 'run-solar'
    })

    const result = await orchestrator.run(
      {
        message: '做一个太阳能熔炉',
        projectId: 'p1',
        loader: 'fabric',
        mcVersion: '1.21.1'
      },
      (e) => events.push(e)
    )

    // ===== 用户反馈的 4 个核心断言 =====

    // 1. fabric/1.21.1 不再被卡成储备组合（combo 通过 + 真跑 gradle）
    expect(gradleCalls.length).toBeGreaterThan(0)
    expect(result.build?.status).toBe('pass')

    // 2. build 阶段必须亮起来（phase=running），不再静默 skipped
    const buildPhases = events.filter((e) => e.stage === 'build' && e.type === 'phase')
    expect(buildPhases.some((e) => e.phase === 'running')).toBe(true)
    expect(buildPhases.some((e) => e.phase === 'done')).toBe(true)
    expect(buildPhases.some((e) => e.phase === 'skipped')).toBe(false)

    // 3. test 阶段必须真跑（kunyu-observer 在线 → done），不再秒跳 skipped
    const testPhases = events.filter((e) => e.stage === 'test' && e.type === 'phase')
    expect(testPhases.some((e) => e.phase === 'running')).toBe(true)
    expect(testPhases.some((e) => e.phase === 'done')).toBe(true)

    // 4. 导出已分离为手动操作：流水线不产出 export 事件，结果 export 恒为 null
    expect(result.export).toBeNull()
    expect(events.filter((e) => e.stage === 'export')).toHaveLength(0)

    // 5. 时序断言：build.done 必须先于最终回复（reply）
    const seqOf = (pred: (e: AgentEvent) => boolean) =>
      events.find(pred)?.seq ?? Number.POSITIVE_INFINITY
    const buildDoneSeq = seqOf((e) => e.stage === 'build' && e.phase === 'done')
    const replySeq = seqOf((e) => e.type === 'reply')
    expect(buildDoneSeq).toBeLessThan(replySeq)

    // 6. 各阶段都有产物（不再是「各阶段没有对应的输出」）
    expect(result.files.length).toBeGreaterThan(0)
    expect(result.files[0]?.accepted).toBe(true)
    expect(result.build?.rounds).toBeGreaterThan(0)
    expect(result.test?.status).toBe('connected-ok')
  }, 15000)

  it('build 失败时流水线失败收口，不再自动导出', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'kunyu-solar-fail-'))
    writeFileSync(join(projectDir, 'gradlew.bat'), '@echo off\r\n')

    const events: AgentEvent[] = []
    const runGradle = (_input: GradleRunInput, sink: (e: GradleEvent) => void): string => {
      const runId = 'gradle-fail'
      setTimeout(() => {
        sink({ type: 'phase', phase: 'done', runId, exitCode: 1, cancelled: false, timedOut: false } as GradleEvent)
      }, 5)
      return runId
    }

    // chat 第 1 次返 plan，之后 generate/fix 全部返空 files（让 build 真的失败而非"零产出"触发反幻觉门）
    let n = 0
    const chat = (_req: AiChatRequest): Promise<AiChatResponse> => {
      n += 1
      const content = n === 1 ? PLAN : CODER
      return Promise.resolve({ content } as AiChatResponse)
    }

    const orchestrator = createOrchestrator({
      chat,
      mcp: {
        isEnabled: () => false,
        getStatus: () => ({ kind: 'disabled' }),
        callStaticTool: () => Promise.reject(new Error('disabled'))
      } as unknown as McpClient,
      reference: makeReference(),
      contextBuilder: makeContextBuilder(),
      runGradle,
      gradleBusy: () => false,
      resolveProject: () => ({
        id: 'p1',
        name: 'solar-furnace',
        path: projectDir,
        type: 'mod',
        mcVersion: '1.21.1',
        loader: 'fabric',
        loaderVersion: '0.15.11'
      }),
      writeFile: () => undefined,
      idFactory: () => 'run-fail'
    })

    const result = await orchestrator.run(
      {
        message: '做一个太阳能熔炉',
        projectId: 'p1',
        loader: 'fabric',
        mcVersion: '1.21.1',
        tier: 'sprinter' // 7 轮封顶，避免长测试
      },
      (e) => events.push(e)
    )

    // build 失败 → 流水线失败收口；导出已分离为手动操作，事件流不再出现 export 阶段
    expect(result.build?.status).toBe('fail')
    expect(result.export).toBeNull()
    expect(events.filter((e) => e.stage === 'export')).toHaveLength(0)
  }, 30000)
})
