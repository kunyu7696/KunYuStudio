/**
 * 子代理委派工具（多代理 M1）：agent_delegate。
 *
 * 主代理把边界明确的调研类小任务委派给子代理独立小循环执行，浓缩结论回填。
 * 护栏集中在 subAgentRunner.ts（只读工具白名单/轮次/超时/禁套娃）；
 * 成本闸门在设置 ai.subAgentEnabled（visibility 'subagent'，默认关）。
 */
import type { RegisteredTool, ToolRegistryDeps, ToolExecContext } from '../toolRegistry'
import { clipToolText } from './textClip'
import { SUB_AGENT_BATCH_CONCURRENCY, SUB_AGENT_BATCH_MAX_TASKS } from '../subAgentRunner'

/** 子代理活动的展示类别（本地简化版，与 generatePipeline.toolActivityKind 同思路，避免循环依赖） */
function toolActivityKindOf(name: string): 'read' | 'search' | 'write' | 'build' | 'other' {
  if (/search|grep|lookup/.test(name)) return 'search'
  if (/web_fetch/.test(name)) return 'read'
  return 'other'
}

interface BatchItemInput {
  task: string
  context?: string
}

/** 解析并净化批任务列表：去空白、去空项、限量截断 */
export function parseBatchItems(raw: unknown): { items: BatchItemInput[]; truncated: boolean } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'tasks 必须是数组' }
  const items: BatchItemInput[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const task = typeof (entry as Record<string, unknown>)['task'] === 'string'
      ? ((entry as Record<string, unknown>)['task'] as string).trim()
      : ''
    if (!task) continue
    const context = typeof (entry as Record<string, unknown>)['context'] === 'string'
      ? ((entry as Record<string, unknown>)['context'] as string)
      : undefined
    items.push({ task, context })
  }
  if (items.length === 0) return { error: 'tasks 至少需要一项非空任务' }
  const truncated = items.length > SUB_AGENT_BATCH_MAX_TASKS
  return { items: items.slice(0, SUB_AGENT_BATCH_MAX_TASKS), truncated }
}

/** 并发池执行（共享 deps.runSubAgent 单任务端口，编排层接线不变） */
async function runBatchPool(
  items: BatchItemInput[],
  ctx: ToolExecContext,
  runOne: NonNullable<ToolRegistryDeps['runSubAgent']>
): Promise<Array<{ task: string; ok: boolean; text: string; error?: string; rounds: number }>> {
  const results = new Array<{ task: string; ok: boolean; text: string; error?: string; rounds: number }>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= items.length) return
      const item = items[i]!
      try {
        const r = await runOne({
          task: item.task,
          context: item.context,
          ctx,
          // M3：批内各子代理的活动同样嵌套到本 agent_delegate_batch 卡片下；
          // callId 前缀 t{i}- 区分子任务，避免同 r1-0 互撞
          onToolActivity: ctx.reportToolActivity
            ? (a) =>
                ctx.reportToolActivity!({
                  callId: `t${i}-${a.callId}`,
                  tool: a.tool,
                  kind: toolActivityKindOf(a.tool),
                  summary: a.summary,
                  ok: a.ok ?? false,
                  parentCallId: ctx.toolCallId,
                  subAgentTask: item.task
                })
            : undefined
        })
        results[i] = { task: item.task, ok: r.ok, text: r.text, error: r.error, rounds: r.rounds }
      } catch (e) {
        results[i] = { task: item.task, ok: false, text: '', error: `子代理异常：${(e as Error).message}`, rounds: 0 }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(SUB_AGENT_BATCH_CONCURRENCY, items.length)) }, () => worker()))
  return results
}

export function builtinSubAgentTools(deps: ToolRegistryDeps): RegisteredTool[] {
  return [
    {
      kind: 'chat',
      def: {
        type: 'function',
        function: {
          name: 'agent_delegate',
          description:
            '把一个边界明确的调研类小任务委派给子代理独立执行，收回浓缩结论。' +
            '子代理只能用只读检索/联网工具（不写盘、不构建、不再委派），有轮次与超时护栏。' +
            '适用：需要多步检索取证的独立问题（如「查清某 API 在 1.20.1 的完整用法」）。' +
            '不适用：简单问题（直接答）、单页联网（web_fetch）、要写代码/改文件的任务（主代理自己做）。',
          parameters: {
            type: 'object',
            properties: {
              task: { type: 'string', description: '委派任务描述：边界明确、可独立完成的调研问题' },
              context: { type: 'string', description: '补充上下文（可选）：已查到的线索、相关结论，避免子代理重复劳动' }
            },
            required: ['task']
          }
        }
      },
      visibility: 'subagent',
      execute: async (args, ctx) => {
        const task = typeof args['task'] === 'string' ? args['task'].trim() : ''
        if (!task) return { ok: false, text: '', error: 'task 不能为空' }
        if (!deps.runSubAgent) return { ok: false, text: '', error: '子代理回路未就绪（编排层未注入 runSubAgent）' }
        const context = typeof args['context'] === 'string' ? args['context'] : undefined
        const r = await deps.runSubAgent({
          task,
          context,
          ctx,
          // M3：子代理内部工具活动嵌套上报（挂到本 agent_delegate 卡片下）
          onToolActivity: ctx.reportToolActivity
            ? (a) =>
                ctx.reportToolActivity!({
                  callId: a.callId,
                  tool: a.tool,
                  kind: toolActivityKindOf(a.tool),
                  summary: a.summary,
                  ok: a.ok ?? false,
                  parentCallId: ctx.toolCallId,
                  subAgentTask: task
                })
            : undefined
        })
        if (!r.ok) return { ok: false, text: '', error: r.error ?? '子代理执行失败' }
        return {
          ok: true,
          text: clipToolText(`===== 子代理结论（${r.rounds} 轮） =====\n${r.text}`),
          data: { rounds: r.rounds }
        }
      }
    },
    {
      kind: 'chat',
      def: {
        type: 'function',
        function: {
          name: 'agent_delegate_batch',
          description:
            '一次委派多个互相独立的调研子任务并发执行（只读子代理），汇总全部结论。' +
            `单批最多 ${SUB_AGENT_BATCH_MAX_TASKS} 个任务、并发上限 ${SUB_AGENT_BATCH_CONCURRENCY}；单项失败不影响其他项。` +
            '适用：同一主题需要多路并行取证（如「Yarn 映射」「Wiki 机制」「同类模组做法」三路并查）。' +
            '不适用：任务间有依赖（前一个的结论是后一个的输入）——那应串行多次 agent_delegate。',
          parameters: {
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                description: `子任务列表（1-${SUB_AGENT_BATCH_MAX_TASKS} 项，互相独立）`,
                items: {
                  type: 'object',
                  properties: {
                    task: { type: 'string', description: '边界明确的调研问题' },
                    context: { type: 'string', description: '补充上下文（可选）' }
                  },
                  required: ['task']
                }
              }
            },
            required: ['tasks']
          }
        }
      },
      visibility: 'subagent',
      execute: async (args, ctx) => {
        if (!deps.runSubAgent) return { ok: false, text: '', error: '子代理回路未就绪（编排层未注入 runSubAgent）' }
        const parsed = parseBatchItems(args['tasks'])
        if ('error' in parsed) return { ok: false, text: '', error: parsed.error }
        const results = await runBatchPool(parsed.items, ctx, deps.runSubAgent)
        const body = results
          .map((r, i) => {
            const head = `===== 子任务 ${i + 1}/${results.length}：${r.task}（${r.ok ? `${r.rounds} 轮` : '失败'}） =====`
            return `${head}\n${r.ok ? r.text : `失败原因：${r.error ?? '未知'}`}`
          })
          .join('\n\n')
        const notice = parsed.truncated ? `[提示] 任务数超上限，仅执行前 ${SUB_AGENT_BATCH_MAX_TASKS} 项。\n\n` : ''
        const failed = results.filter((r) => !r.ok).length
        return {
          ok: failed < results.length,
          text: clipToolText(notice + body),
          data: { total: results.length, failed }
        }
      }
    }
  ]
}
