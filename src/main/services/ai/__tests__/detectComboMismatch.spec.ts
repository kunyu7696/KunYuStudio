/**
 * P1-3 修复测试：AgentRunRequest.loader/mcVersion 与工程实际组合不一致时给出提示。
 *
 * 修复前：
 * - 类型注释写「仅 fabric/1.20.1 激活，其余组合被拒绝并提示」（agent.ts:348）
 * - 实测：传 loader:'neoforge', mcVersion:'1.21.1' 照样跑，
 *   且用工程自身组合（forge 1.20.1）——既不拒绝也不提示
 * - 用户会以为能跨组合生成
 *
 * 修复后：仍允许跑（17 个组合全激活），但 emit 一条一致性提示。
 */
import { describe, expect, it } from 'vitest'
import type { AgentRunRequest } from '../../../../shared/types/agent'
import type { ResolvedProject } from '../orchestrator/types'
import { detectComboMismatch } from '../orchestrator'

function makeRequest(loader: string, mcVersion: string): AgentRunRequest {
  return {
    message: '',
    projectId: 'p1',
    loader: loader as AgentRunRequest['loader'],
    mcVersion,
    context: { sourceView: 'ai' }
  } as AgentRunRequest
}

function makeProject(loader: string | null, mcVersion: string): ResolvedProject {
  return {
    id: 'p1',
    name: 'p1',
    path: '/tmp/p1',
    type: 'mod',
    mcVersion,
    loader: loader as ResolvedProject['loader'],
    loaderVersion: null
  } as ResolvedProject
}

describe('detectComboMismatch：请求组合 vs 工程实际组合一致性提示', () => {
  it('无项目 → 不提示', () => {
    expect(detectComboMismatch(makeRequest('fabric', '1.20.1'), null)).toBeNull()
  })

  it('请求组合 = 工程组合 → 不提示', () => {
    const proj = makeProject('fabric', '1.20.1')
    expect(detectComboMismatch(makeRequest('fabric', '1.20.1'), proj)).toBeNull()
  })

  it('loader 不一致 → 提示', () => {
    const proj = makeProject('forge', '1.20.1')
    const r = detectComboMismatch(makeRequest('neoforge', '1.21.1'), proj)
    expect(r).not.toBeNull()
    expect(r?.loader).toBe('neoforge')
    expect(r?.mcVersion).toBe('1.21.1')
  })

  it('mcVersion 不一致 → 提示', () => {
    const proj = makeProject('fabric', '1.20.1')
    const r = detectComboMismatch(makeRequest('fabric', '1.21.1'), proj)
    expect(r).not.toBeNull()
    expect(r?.loader).toBeUndefined()
    expect(r?.mcVersion).toBe('1.21.1')
  })

  it('工程 loader 为 null → 跳过 loader 比较，仅比对 mcVersion', () => {
    const proj = makeProject(null, '1.20.1')
    expect(detectComboMismatch(makeRequest('fabric', '1.20.1'), proj)).toBeNull()
    const r = detectComboMismatch(makeRequest('fabric', '1.21.1'), proj)
    expect(r?.mcVersion).toBe('1.21.1')
  })
})
