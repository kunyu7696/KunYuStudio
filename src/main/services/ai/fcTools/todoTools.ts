/**
 * todo_write（P4）：模型自维护的待办清单 —— FC 循环里的「进度面板」。
 *
 * 动机：多步任务（十余个文件 + 构建 + 验证）里，模型没有稳定锚点，容易在中途
 * 丢失目标或反复重开同一件事。给它一块由它自己维护、且用户实时可见的清单，
 * 既让模型每轮收口「下一步做什么」，也让开发者在运行面板看到真实进度。
 *
 * 语义（对齐成熟 Agent 工具）：
 * - 每次提交「完整清单」（全量替换，非增量），模型负责保留已完成项；
 * - 同一时刻至多一项 in_progress（多项即拒绝，回传修正提示）；
 * - 与上一版完全一致时不产生变化（不重复刷面板、不浪费轮次）；
 * - 无副作用：既不写盘也不算写入工具，不影响只读空转检测。
 */
import type { AgentTodoItem } from '../../../../shared/types/agent'
import type { RegisteredTool, ToolResult } from '../toolRegistry'

const STATUSES = ['pending', 'in_progress', 'completed'] as const
type TodoStatus = (typeof STATUSES)[number]

/** 单次清单长度上限：过长的清单模型自己也维护不住 */
export const MAX_TODOS = 30
/** 单条描述长度上限 */
const MAX_CONTENT_CHARS = 300

/** 解析结果：合法清单 / 拒绝原因 */
type ParseResult = { todos: AgentTodoItem[] } | { error: string }

/**
 * 入参解析 + 校验（纯函数，便于单测直调）：
 * 非法即整批拒绝并给出可自纠的中文原因（模型下一轮据此修正后重试）。
 */
export function parseTodos(args: Record<string, unknown>): ParseResult {
  const raw = args['todos']
  if (!Array.isArray(raw)) return { error: 'todos 必须是数组（每次提交完整清单）' }
  if (raw.length === 0) return { error: 'todos 为空：至少列出一项待办' }
  if (raw.length > MAX_TODOS) return { error: `todos 过多（上限 ${MAX_TODOS} 项）：请合并同类步骤` }
  const todos: AgentTodoItem[] = []
  const seenIds = new Set<string>()
  let inProgress = 0
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown> | null
    if (!entry || typeof entry !== 'object') return { error: `todos[${i}] 必须是对象` }
    const content = typeof entry['content'] === 'string' ? entry['content'].trim() : ''
    if (!content) return { error: `todos[${i}].content 不能为空` }
    if (content.length > MAX_CONTENT_CHARS) {
      return { error: `todos[${i}].content 过长（上限 ${MAX_CONTENT_CHARS} 字）` }
    }
    const status = entry['status']
    if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
      return { error: `todos[${i}].status 必须是 ${STATUSES.join('|')}` }
    }
    if (status === 'in_progress') inProgress += 1
    const rawId = typeof entry['id'] === 'string' ? entry['id'].trim() : ''
    const id = rawId || `t${i + 1}`
    if (seenIds.has(id)) return { error: `todos[${i}].id 重复（${id}）：每项 id 必须唯一` }
    seenIds.add(id)
    todos.push({ id, content, status: status as TodoStatus })
  }
  if (inProgress > 1) {
    return {
      error: `同一时刻只能有 1 项 in_progress（当前 ${inProgress} 项）：请把其余项改回 pending 后重试`
    }
  }
  return { todos }
}

/** 清单文本（回填给模型）：`[x] 步骤` 形式，附带进度与下一步指令 */
export function formatTodos(todos: AgentTodoItem[]): string {
  const mark = (s: TodoStatus): string => (s === 'completed' ? '[x]' : s === 'in_progress' ? '[~]' : '[ ]')
  const done = todos.filter((t) => t.status === 'completed').length
  const current = todos.find((t) => t.status === 'in_progress')
  const lines = todos.map((t) => `${mark(t.status)} ${t.content}`)
  return (
    `清单已更新（${done}/${todos.length} 完成）：\n${lines.join('\n')}\n` +
    (done === todos.length
      ? '全部步骤已完成——请立即输出最终汇总，不要再开新步骤。'
      : current
        ? `当前进行中：${current.content}。完成后立刻再次调用 todo_write 把它标为 completed，并把下一项置为 in_progress。`
        : '当前没有进行中的项——请把正在做的那一项置为 in_progress 后再继续。')
  )
}

/** 清单是否与上一版完全一致（一致则不必刷面板，也不消耗轮次） */
function sameTodos(a: AgentTodoItem[] | undefined, b: AgentTodoItem[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((t, i) => t.id === b[i].id && t.content === b[i].content && t.status === b[i].status)
}

export function builtinTodoTools(): RegisteredTool[] {
  /** run 级清单缓存：仅用于「无变化」短路；只保留最近一次运行的清单 */
  let lastRunId: string | null = null
  let lastTodos: AgentTodoItem[] | undefined

  const tool: RegisteredTool = {
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'todo_write',
        description:
          '维护本次任务的待办清单（进度面板，用户可在运行面板实时看到）。' +
          '执行多步任务时使用：动手前先把步骤列全（首项置 in_progress）；每完成一步立即再次调用，' +
          '把该项改为 completed、下一项置 in_progress。' +
          '每次必须提交完整清单（全量替换，非增量；已完成项保留在清单里不要删除）；' +
          '同一时刻至多一项 in_progress；无副作用的纯进度工具，不写盘。' +
          '清单变化不大时不要频繁刷（与上一版完全相同时不会产生任何动作）。',
        parameters: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              description: `完整待办清单（1-${MAX_TODOS} 项，按执行顺序排列）`,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: '稳定标识（如 step-1）；省略按顺序自动编号' },
                  content: { type: 'string', description: '一步可独立验证的动作描述（中文）' },
                  status: {
                    type: 'string',
                    enum: [...STATUSES],
                    description: 'pending 未开始 / in_progress 进行中（至多一项）/ completed 已完成'
                  }
                },
                required: ['content', 'status']
              }
            }
          },
          required: ['todos']
        }
      }
    },
    execute: (args, ctx): ToolResult => {
      const parsed = parseTodos(args)
      if ('error' in parsed) return { ok: false, text: '', error: parsed.error }
      const todos = parsed.todos
      const runId = ctx.runId ?? 'default'
      if (runId !== lastRunId) {
        lastRunId = runId
        lastTodos = undefined
      }
      if (sameTodos(lastTodos, todos)) {
        return { ok: true, text: '清单与上一版完全一致，无需更新——请继续推进当前 in_progress 的步骤。', data: { changed: false } }
      }
      lastTodos = todos
      const done = todos.filter((t) => t.status === 'completed').length
      // 同一 run 内固定 artifact id：面板上是一张随进度刷新的卡，而不是一条条堆叠
      ctx.reportArtifact?.({
        id: `todo-list-${runId}`,
        kind: 'todo-list',
        title: `任务清单（${done}/${todos.length} 完成）`,
        todos
      })
      return { ok: true, text: formatTodos(todos), data: { changed: true, done, total: todos.length } }
    }
  }

  return [tool]
}
