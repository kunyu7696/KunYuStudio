/**
 * T2 集成：run 结束后「对比/单文件回滚」仍可用。
 *
 * 链路：fake chat 驱动 FC 工具循环（write_project_file ×2：一个 create、一个 modify）
 * → write-through 即时落盘并留存 run 前快照 → run 结束（runs 表删除）
 * → orchestrator.getRunFileSnapshot / rollbackRunFile 仍按 runId 找到端口工作。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

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

import { createOrchestrator } from '../orchestrator'
import type { AiChatRequest, AiChatResponse } from '../../../../shared/types/ai'
import type { McpClient } from '../mcpClient'
import type { ReferenceService } from '../referencePackageService'
import type { ContextBuilder } from '../contextBuilder'

const PLAN = JSON.stringify({
  intent: 'code',
  contentTypes: [],
  stages: ['generate'],
  goal: '写入两个测试文件'
})

const NEW_FILE = 'src/main/java/com/x/RollbackNew.java'
const OLD_FILE = 'src/main/java/com/x/RollbackOld.java'

/** 第 1 次 PLAN；第 2 次 FC 工具调用（create + modify）；第 3 次起最终 JSON */
function makeChat() {
  let n = 0
  return (_req: AiChatRequest): Promise<AiChatResponse> => {
    n += 1
    if (n === 1) return Promise.resolve({ content: PLAN } as AiChatResponse)
    if (n === 2) {
      return Promise.resolve({
        content: '',
        toolCalls: [
          {
            id: 'call-new',
            function: {
              name: 'write_project_file',
              arguments: JSON.stringify({
                relPath: NEW_FILE,
                content: 'package com.x;\npublic class RollbackNew {}\n'
              })
            }
          },
          {
            id: 'call-old',
            function: {
              name: 'write_project_file',
              arguments: JSON.stringify({
                relPath: OLD_FILE,
                content: 'package com.x;\npublic class RollbackOld { /* AI 改写 */ }\n'
              })
            }
          }
        ]
      } as unknown as AiChatResponse)
    }
    return Promise.resolve({
      content: JSON.stringify({ files: [], notes: '两个文件已写入' })
    } as AiChatResponse)
  }
}

function makeReference(): ReferenceService {
  return {
    getSystemPromptBase: () => '',
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

describe('orchestrator · T2 run 后对比/单文件回滚', () => {
  let projectDir: string

  afterEach(() => {
    if (projectDir) rmSync(projectDir, { recursive: true, force: true })
  })

  it('run 结束后：快照可读取（modify=原文 / create=null），回滚恢复 run 前状态且幂等收口', async () => {
    projectDir = mkdtempSync(join(tmpdir(), 'kunyu-rollback-'))
    // modify 目标：run 前已存在的原文
    mkdirSync(dirname(join(projectDir, OLD_FILE)), { recursive: true })
    writeFileSync(join(projectDir, OLD_FILE), 'ORIGINAL_OLD_CONTENT', 'utf8')

    const orchestrator = createOrchestrator({
      chat: makeChat(),
      mcp: {
        isEnabled: () => false,
        getStatus: () => ({ kind: 'disabled' }),
        callStaticTool: () => Promise.reject(new Error('disabled'))
      } as unknown as McpClient,
      reference: makeReference(),
      contextBuilder: makeContextBuilder(),
      gradleBusy: () => false,
      resolveProject: (id) =>
        id === 'p1'
          ? {
              id: 'p1',
              name: 'rollback-test',
              path: projectDir,
              type: 'mod',
              mcVersion: '1.20.1',
              loader: 'fabric',
              loaderVersion: '0.15.11'
            }
          : null
    })

    const result = await orchestrator.run({
      message: '写入两个测试文件',
      projectId: 'p1',
      loader: 'fabric',
      mcVersion: '1.20.1'
    })

    // 即时落盘事实
    expect(readFileSync(join(projectDir, NEW_FILE), 'utf8')).toContain('RollbackNew')
    expect(readFileSync(join(projectDir, OLD_FILE), 'utf8')).toContain('AI 改写')

    // run 结束（runs 表已删）后快照仍可读：modify → 原文；create → null；未知路径/runId → found:false
    expect(orchestrator.getRunFileSnapshot(result.runId, OLD_FILE)).toEqual({
      found: true,
      original: 'ORIGINAL_OLD_CONTENT'
    })
    expect(orchestrator.getRunFileSnapshot(result.runId, NEW_FILE)).toEqual({
      found: true,
      original: null
    })
    expect(orchestrator.getRunFileSnapshot(result.runId, 'src/main/java/com/x/Never.java').found).toBe(false)
    expect(orchestrator.getRunFileSnapshot('unknown-run', OLD_FILE).found).toBe(false)

    // modify 回滚：恢复原文；再次回滚 → 快照已消费，ok:false（幂等收口）
    expect(orchestrator.rollbackRunFile(result.runId, OLD_FILE)).toEqual({ ok: true })
    expect(readFileSync(join(projectDir, OLD_FILE), 'utf8')).toBe('ORIGINAL_OLD_CONTENT')
    expect(orchestrator.rollbackRunFile(result.runId, OLD_FILE).ok).toBe(false)

    // create 回滚：删除文件
    expect(orchestrator.rollbackRunFile(result.runId, NEW_FILE)).toEqual({ ok: true })
    expect(existsSync(join(projectDir, NEW_FILE))).toBe(false)

    // 未知 runId 回滚：如实失败
    expect(orchestrator.rollbackRunFile('unknown-run', OLD_FILE).ok).toBe(false)
  })
})
