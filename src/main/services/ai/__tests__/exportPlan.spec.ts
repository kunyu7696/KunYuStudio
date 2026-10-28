/**
 * export 阶段决策与分派（S5）。
 *
 * 修掉的缺陷：原 collectExportOutcome 先判「build pass 且在 build/libs 找到 jar」就 return，
 * 模组项目必然命中该分支 → 织星的整合包 zip 分支成死代码，整合包从未被真正组装。
 * 这里证明：① 整合包项目一律走真实组装（哪怕 build pass 且 jar 存在）；
 * ② 普通模组项目的 jar / zip-directory / none 行为零回归；③ 装配器确实被流水线调用。
 */
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

vi.mock('../../settingsService', () => ({
  getSection: () => ({
    providers: [
      {
        id: 'p1',
        name: 'p1',
        kind: 'openai-compatible',
        baseUrl: 'http://x',
        apiKey: '',
        apiKeyUrl: '',
        model: 'm1',
        maxTokens: 4096,
        temperature: 0.7,
        enabled: true
      }
    ],
    defaultProviderId: 'p1',
    tierModels: {
      sprinter: { providerId: null, model: null },
      artisan: { providerId: null, model: null },
      master: { providerId: null, model: null },
      bridge: { providerId: null, model: null },
      weaver: { providerId: null, model: null }
    },
    manualLock: { tier: null, source: null, lockedAt: null }
  })
}))
vi.mock('../../projectService', () => ({
  openProject: () => null
}))

import { planExport, type ExportProjectInfo } from '../exportPlan'
import { createOrchestrator } from '../orchestrator'
import type { AgentEvent } from '../../../../shared/types/agent'
import type { AiChatResponse } from '../../../../shared/types/ai'
import type { McpClient } from '../mcpClient'
import type { ReferenceService } from '../referencePackageService'
import type { ModpackAssembleResult } from '../../../../shared/types/modpack'
import type { ModpackMeta } from '../../modpack/modpackAssembler'

function project(over: Partial<ExportProjectInfo> = {}): ExportProjectInfo {
  return {
    id: 'p1',
    name: '红石主题包',
    path: join('D:', 'KunYuEcosystem', 'proj'),
    type: 'mod',
    mcVersion: '1.20.1',
    loader: 'fabric',
    loaderVersion: '0.15.11',
    ...over
  }
}

describe('planExport — 分派顺序', () => {
  it('无项目：只汇报生成片段清单', () => {
    const action = planExport({ tier: 'weaver', project: null, buildStatus: null, jarPath: null })
    expect(action.kind).toBe('files')
  })

  it('整合包项目：即使 build pass 且 jar 就绪也走真实组装（短路缺陷已修）', () => {
    const action = planExport({
      tier: 'weaver',
      project: project({ type: 'modpack' }),
      buildStatus: 'pass',
      jarPath: join('D:', 'proj', 'build', 'libs', 'demo.jar')
    })
    expect(action.kind).toBe('modpack-assemble')
  })

  it('普通模组项目 build pass 且有 jar：导出 jar（零回归）', () => {
    const jarPath = join('D:', 'proj', 'build', 'libs', 'demo-1.0.0.jar')
    const action = planExport({ tier: 'artisan', project: project(), buildStatus: 'pass', jarPath })
    expect(action.kind).toBe('jar')
    expect(action.jarPath).toBe(jarPath)
    expect(action.summary).toContain('demo-1.0.0.jar')
  })

  it('织星 + 非整合包项目无 jar：不导出（整目录 zip 兜底已废除，P1-D）', () => {
    const action = planExport({ tier: 'weaver', project: project(), buildStatus: 'skipped', jarPath: null })
    expect(action.kind).toBe('none')
    expect(action.summary).toContain('不导出')
  })

  it('织星 + build pass 但无 jar：明确文案，不整目录打包冒充产物（P1-D）', () => {
    const action = planExport({ tier: 'weaver', project: project(), buildStatus: 'pass', jarPath: null })
    expect(action.kind).toBe('none')
    expect(action.summary).toContain('未找到可分发 jar')
  })

  it('织星 + 构建失败：不导出', () => {
    const action = planExport({ tier: 'weaver', project: project(), buildStatus: 'fail', jarPath: null })
    expect(action.kind).toBe('none')
    expect(action.summary).toContain('构建未通过')
  })

  it('非织星 + build pass 但无 jar：不导出并提示检查 build/libs', () => {
    const action = planExport({ tier: 'artisan', project: project(), buildStatus: 'pass', jarPath: null })
    expect(action.kind).toBe('none')
    expect(action.summary).toContain('build/libs')
  })

  it('手动导出（manual）：build 未跑但 build/libs 已有 jar → 允许导出（此前构建/手动构建的产物）', () => {
    const jarPath = join('D:', 'proj', 'build', 'libs', 'demo-1.0.0.jar')
    const action = planExport({
      tier: 'artisan',
      project: project(),
      buildStatus: 'skipped',
      jarPath,
      manual: true
    })
    expect(action.kind).toBe('jar')
    expect(action.jarPath).toBe(jarPath)
  })

  it('手动导出（manual）：build 失败但 build/libs 有旧 jar → 仍导出（是否过期由用户判断）', () => {
    const jarPath = join('D:', 'proj', 'build', 'libs', 'demo-1.0.0.jar')
    const action = planExport({ tier: 'artisan', project: project(), buildStatus: 'fail', jarPath, manual: true })
    expect(action.kind).toBe('jar')
  })

  it('手动导出（manual）：无 jar 时仍不导出', () => {
    const action = planExport({ tier: 'artisan', project: project(), buildStatus: null, jarPath: null, manual: true })
    expect(action.kind).toBe('none')
  })
})

describe('orchestrator export 分离 — 流水线不再自动导出', () => {
  it('整合包项目：流水线全程不触发装配器、不产出 export 事件（导出改为 AGENT_EXPORT_NOW 手动触发）', async () => {
    const planJson = JSON.stringify({
      intent: 'verify',
      contentTypes: [],
      stages: ['test'],
      goal: '验证整合包'
    })
    const chat = (): Promise<AiChatResponse> =>
      Promise.resolve({ content: planJson } as AiChatResponse)

    const mcp = {
      isEnabled: () => false,
      getStatus: () => ({ kind: 'disabled' }),
      callStaticTool: () => Promise.reject(new Error('disabled'))
    } as unknown as Pick<McpClient, 'isEnabled' | 'getStatus' | 'callStaticTool'>

    const assemble = vi.fn((_projectPath: string, _meta: ModpackMeta): ModpackAssembleResult => ({
      ok: true,
      zipPath: 'should-not-exist.zip'
    }))

    const orchestrator = createOrchestrator({
      chat,
      mcp,
      reference: {
        getSystemPromptBase: () => '',
        listMatrixCells: () => [{ id: 'fabric-1.20.1', active: true }]
      } as unknown as ReferenceService,
      resolveProject: () => ({
        id: 'p1',
        name: '红石主题包',
        path: join('D:', 'KunYu', 'modpack-proj'),
        type: 'modpack',
        mcVersion: '1.20.1',
        loader: 'fabric',
        loaderVersion: '0.15.11'
      }),
      assembleModpack: assemble,
      idFactory: () => 'run-export'
    })

    const events: AgentEvent[] = []
    const result = await orchestrator.run(
      { message: '验证整合包', projectId: 'p1', loader: 'fabric', mcVersion: '1.20.1', tier: 'weaver' },
      (event) => events.push(event)
    )

    // 导出已从流水线分离：装配器不被调用，结果与事件流均无 export 痕迹
    expect(assemble).not.toHaveBeenCalled()
    expect(result.export).toBeNull()
    expect(events.filter((e) => e.stage === 'export')).toHaveLength(0)
  })
})

describe('collectExportOutcome — 手动导出路径（manual=true）', () => {
  it('build 未跑但 build/libs 存在 jar：手动导出直接报告 jar 产物', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const projectDir = mkdtempSync(join(tmpdir(), 'kunyu-manual-export-'))
    mkdirSync(join(projectDir, 'build', 'libs'), { recursive: true })
    writeFileSync(join(projectDir, 'build', 'libs', 'demo-1.0.0.jar'), 'fake-jar')

    const { collectExportOutcome } = await import('../orchestrator/exportStage')
    const outcome = collectExportOutcome({
      tier: 'artisan',
      project: {
        id: 'p1',
        name: '红石主题包',
        path: projectDir,
        type: 'mod',
        mcVersion: '1.20.1',
        loader: 'fabric',
        loaderVersion: '0.15.11'
      },
      build: { status: 'skipped', rounds: 0, summary: '构建跳过', matchedPatternIds: [] },
      files: [],
      manual: true
    })
    expect(outcome.status).toBe('ok')
    expect(outcome.artifacts[0]?.kind).toBe('jar')
    expect(outcome.artifacts[0]?.path).toContain('demo-1.0.0.jar')
  })
})