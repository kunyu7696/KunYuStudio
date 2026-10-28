/**
 * 多代理 M1 单测：
 * - isSubAgentToolAllowed 白名单（readonly + web_fetch；写盘/委派拒绝）
 * - runSubAgent 回路：直接答/一轮工具/越权工具拦截/末轮 toolChoice none/空结论/异常/超时
 * - agent_delegate 工具：开关可见性、未注入软失败、空 task 拒绝、结论回填
 * - 设置 subAgentEnabled 默认关 + 解析透传
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiChatRequest, AiChatResponse, ToolCallItem } from '../../../../shared/types/ai'
import { mergeWithDefaults } from '../../../../shared/types/settings'
import {
  isSubAgentToolAllowed,
  runSubAgent,
  type SubAgentRunInput
} from '../subAgentRunner'
import { builtinSubAgentTools, parseBatchItems } from '../fcTools/subAgentTools'
import { createToolRegistry, type ToolExecContext } from '../toolRegistry'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

function call(name: string, args: Record<string, unknown> = {}, id = 'c1'): ToolCallItem {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}

function resp(content: string, toolCalls?: ToolCallItem[]): AiChatResponse {
  return { content, model: 'fake', toolCalls }
}

function baseInput(over: Partial<SubAgentRunInput> = {}): SubAgentRunInput {
  return {
    task: '查清 X 的用法',
    ctx: CTX,
    tools: [],
    executeTool: async () => ({ ok: true, text: '工具结果' }),
    chat: async () => resp('结论：X 这样用'),
    providerId: 'p1',
    ...over
  }
}

describe('isSubAgentToolAllowed 白名单', () => {
  it('readonly 工具放行，web_fetch 额外放行', () => {
    expect(isSubAgentToolAllowed('kb_search')).toBe(true)
    expect(isSubAgentToolAllowed('project_grep')).toBe(true)
    expect(isSubAgentToolAllowed('web_fetch')).toBe(true)
  })

  it('写盘/构建/委派一律拒绝（套娃在结构上不可能）', () => {
    expect(isSubAgentToolAllowed('write_project_file')).toBe(false)
    expect(isSubAgentToolAllowed('run_command')).toBe(false)
    expect(isSubAgentToolAllowed('gradle_build')).toBe(false)
    expect(isSubAgentToolAllowed('agent_delegate')).toBe(false)
    expect(isSubAgentToolAllowed('agent_memory_append')).toBe(false)
  })
})

describe('runSubAgent 回路', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('首轮无工具调用直接产出结论', async () => {
    const r = await runSubAgent(baseInput())
    expect(r.ok).toBe(true)
    expect(r.rounds).toBe(1)
    expect(r.text).toContain('结论：X 这样用')
  })

  it('一轮工具调用后回填结果再收口', async () => {
    const seen: string[] = []
    let n = 0
    const r = await runSubAgent(
      baseInput({
        chat: async () => (++n === 1 ? resp('', [call('kb_search', { query: 'q' })]) : resp('基于证据的结论')),
        executeTool: async (name, args) => {
          seen.push(`${name}:${String(args['query'])}`)
          return { ok: true, text: '证据片段' }
        }
      })
    )
    expect(r.ok).toBe(true)
    expect(r.rounds).toBe(2)
    expect(r.text).toBe('基于证据的结论')
    expect(seen).toEqual(['kb_search:q'])
  })

  it('模型请求白名单外工具被拒且不执行', async () => {
    const executed: string[] = []
    let n = 0
    const r = await runSubAgent(
      baseInput({
        chat: async () => (++n === 1 ? resp('', [call('write_project_file', { path: 'A.java' })]) : resp('明白了，只读回答')),
        executeTool: async (name) => {
          executed.push(name)
          return { ok: true, text: '' }
        }
      })
    )
    expect(r.ok).toBe(true)
    expect(executed).toEqual([])
  })

  it('末轮强制 toolChoice none 且不再带 tools', async () => {
    const reqs: AiChatRequest[] = []
    const r = await runSubAgent(
      baseInput({
        maxRounds: 2,
        chat: async (req) => {
          reqs.push(req)
          return reqs.length === 1 ? resp('', [call('project_grep', { query: 'x' })]) : resp('收尾结论')
        }
      })
    )
    expect(r.ok).toBe(true)
    expect(reqs.length).toBe(2)
    expect(reqs[1]!.toolChoice).toBe('none')
    expect(reqs[1]!.tools).toBeUndefined()
  })

  it('最终空结论软失败；chat 抛错软失败', async () => {
    const empty = await runSubAgent(baseInput({ chat: async () => resp('   ') }))
    expect(empty.ok).toBe(false)
    expect(empty.error).toContain('空响应')
    const boom = await runSubAgent(
      baseInput({ chat: async () => { throw new Error('HTTP 500') } })
    )
    expect(boom.ok).toBe(false)
    expect(boom.error).toContain('HTTP 500')
  })

  it('超时护栏：超 deadline 后中止并报告', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const r = await runSubAgent(
      baseInput({
        timeoutMs: 120_000,
        chat: async () => {
          vi.setSystemTime(Date.now() + 200_000)
          return resp('', [call('kb_search', { query: 'q' })])
        }
      })
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('超时')
  })
})

describe('agent_delegate 工具', () => {
  const tool = builtinSubAgentTools({
    subAgentEnabled: () => true,
    runSubAgent: async ({ task }) => ({ ok: true, text: `结论<${task}>`, rounds: 2 })
  })[0]!

  it('空 task 拒绝', async () => {
    const r = await tool.execute({ task: '  ' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('task 不能为空')
  })

  it('结论回填含轮次信息', async () => {
    const r = await tool.execute({ task: '调研 X' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('结论<调研 X>')
    expect(r.data).toMatchObject({ rounds: 2 })
  })

  it('未注入 runSubAgent 软失败', async () => {
    const t = builtinSubAgentTools({ subAgentEnabled: () => true })[0]!
    const r = await t.execute({ task: 'x' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未就绪')
  })

  it('可见性由设置开关门控：关=不暴露，开=暴露且带行为级标签', () => {
    const off = createToolRegistry({ subAgentEnabled: () => false })
    expect(off.getToolDefinitions().map((d) => d.function.name)).not.toContain('agent_delegate')
    const noFlag = createToolRegistry({})
    expect(noFlag.getToolDefinitions().map((d) => d.function.name)).not.toContain('agent_delegate')
    const on = createToolRegistry({
      subAgentEnabled: () => true,
      runSubAgent: async () => ({ ok: true, text: 'x', rounds: 1 })
    })
    const def = on.getToolDefinitions().find((d) => d.function.name === 'agent_delegate')
    expect(def?.function.description).toMatch(/^【外部副作用】/)
  })

  it('ctx 透传到 runSubAgent', async () => {
    let got: ToolExecContext | undefined
    const t = builtinSubAgentTools({
      subAgentEnabled: () => true,
      runSubAgent: async ({ ctx }) => {
        got = ctx
        return { ok: true, text: 'ok', rounds: 1 }
      }
    })[0]!
    await t.execute({ task: 'x' }, CTX)
    expect(got?.loader).toBe('fabric')
    expect(got?.mcVersion).toBe('1.20.1')
  })
})

describe('设置 subAgentEnabled', () => {
  it('默认关；显式开启被保留；非法值回退默认', () => {
    expect(mergeWithDefaults({}).ai.subAgentEnabled).toBe(false)
    expect(mergeWithDefaults({ ai: { subAgentEnabled: true } }).ai.subAgentEnabled).toBe(true)
    expect(mergeWithDefaults({ ai: { subAgentEnabled: 'yes' } }).ai.subAgentEnabled).toBe(false)
  })
})

describe('M1 端到端验收（生产同款接线）', () => {
  it('委派→子代理调真实注册表只读工具→结论回填主代理', async () => {
    // 与 orchestrator/index.ts 完全相同的装配方式（闭包引用 registry，TDZ 安全）
    const childReqs: AiChatRequest[] = []
    const registry = createToolRegistry({
      subAgentEnabled: () => true,
      runSubAgent: async ({ task, context, ctx }) =>
        runSubAgent({
          task,
          context,
          ctx,
          tools: registry.getToolDefinitions().filter((d) => isSubAgentToolAllowed(d.function.name)),
          executeTool: (n, a, c) => registry.executeTool(n, a, c),
          chat: async (req) => {
            childReqs.push(req)
            // 子代理第一轮：调 todo_write（只读、空 deps 可执行）；第二轮：带证据收口
            return childReqs.length === 1
              ? resp('', [call('todo_write', { todos: [{ content: '查证据', status: 'in_progress' }] })])
              : resp('子代理结论：已取证')
          },
          providerId: 'p1'
        })
    })

    // 主代理侧：agent_delegate 可见且可用
    const names = registry.getToolDefinitions().map((d) => d.function.name)
    expect(names).toContain('agent_delegate')
    // 子代理可见的工具集不含写盘/委派（定义层已过滤）
    const childToolNames = (childReqs0: AiChatRequest[]) => childReqs0[0]!.tools!.map((d) => d.function.name)

    const r = await registry.executeTool('agent_delegate', { task: '调研某机制' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('子代理结论：已取证')
    expect(r.data).toMatchObject({ rounds: 2 })

    // 子代理确实拿到了过滤后的工具集，且工具结果真实回填进了子对话
    const childNames = childToolNames(childReqs)
    expect(childNames).toContain('todo_write')
    expect(childNames).toContain('web_fetch')
    expect(childNames).not.toContain('write_project_file')
    expect(childNames).not.toContain('agent_delegate')
    const toolMsg = childReqs[1]!.messages!.find((m) => m.role === 'tool')
    expect(toolMsg?.content).toBeTruthy()
  })
})

describe('M2 agent_delegate_batch 并行只读批', () => {
  it('parseBatchItems：非数组/全空拒绝；超上限截断', () => {
    expect('error' in parseBatchItems('x')).toBe(true)
    expect('error' in parseBatchItems([{ task: '  ' }])).toBe(true)
    const p = parseBatchItems([
      { task: 'A' },
      { task: 'B' },
      { task: 'C' },
      { task: 'D' },
      { task: 'E' }
    ])
    expect('error' in p).toBe(false)
    if (!('error' in p)) {
      expect(p.items.length).toBe(4)
      expect(p.truncated).toBe(true)
    }
  })

  it('并发执行且并发数不超过上限；结论按序汇总', async () => {
    let active = 0
    let peak = 0
    const tool = builtinSubAgentTools({
      subAgentEnabled: () => true,
      runSubAgent: async ({ task }) => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 20))
        active--
        return { ok: true, text: `结论<${task}>`, rounds: 1 }
      }
    })[1]!
    const r = await tool.execute(
      { tasks: [{ task: 'T1' }, { task: 'T2' }, { task: 'T3' }, { task: 'T4' }] },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(3)
    expect(r.data).toMatchObject({ total: 4, failed: 0 })
    expect(r.text).toContain('结论<T1>')
    expect(r.text).toContain('结论<T4>')
    expect(r.text.indexOf('结论<T1>')).toBeLessThan(r.text.indexOf('结论<T4>'))
  })

  it('单项失败不拖垮整批；全部失败则整体软失败', async () => {
    const partial = builtinSubAgentTools({
      subAgentEnabled: () => true,
      runSubAgent: async ({ task }) =>
        task === 'bad' ? { ok: false, text: '', error: '炸了', rounds: 0 } : { ok: true, text: '好', rounds: 1 }
    })[1]!
    const r = await partial.execute({ tasks: [{ task: 'good' }, { task: 'bad' }] }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('失败原因：炸了')
    expect(r.data).toMatchObject({ total: 2, failed: 1 })

    const allBad = builtinSubAgentTools({
      subAgentEnabled: () => true,
      runSubAgent: async () => ({ ok: false, text: '', error: 'x', rounds: 0 })
    })[1]!
    const r2 = await allBad.execute({ tasks: [{ task: 'a' }] }, CTX)
    expect(r2.ok).toBe(false)
  })

  it('开关关闭时不暴露；未注入 runSubAgent 软失败', async () => {
    const off = createToolRegistry({ subAgentEnabled: () => false })
    expect(off.getToolDefinitions().map((d) => d.function.name)).not.toContain('agent_delegate_batch')
    const on = createToolRegistry({
      subAgentEnabled: () => true,
      runSubAgent: async () => ({ ok: true, text: 'x', rounds: 1 })
    })
    expect(on.getToolDefinitions().map((d) => d.function.name)).toContain('agent_delegate_batch')

    const t = builtinSubAgentTools({ subAgentEnabled: () => true })[1]!
    const r = await t.execute({ tasks: [{ task: 'x' }] }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未就绪')
  })
})
