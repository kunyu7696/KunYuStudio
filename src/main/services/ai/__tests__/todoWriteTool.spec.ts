/**
 * todo_write（P4）契约：
 * - 入参校验：非数组/空/超长/空 content/非法 status/id 重复 → 整批拒绝并回传可自纠原因
 * - 同一时刻至多一项 in_progress（多项即拒绝）
 * - 每次提交完整清单（全量替换），已完成后再次提交相同清单 → 无变化短路（不刷面板）
 * - 变更时上报 kind=todo-list 的 artifact（同一 run 内 id 固定），并回填进度文本
 * - 不写盘、无副作用；未注入 reportArtifact 时不抛错
 */
import { describe, expect, it } from 'vitest'
import { builtinTodoTools, formatTodos, parseTodos } from '../fcTools/todoTools'
import type { AgentArtifact } from '../../../../shared/types/agent'

const ctx = (runId: string, sink?: AgentArtifact[]) => ({
  loader: 'fabric' as const,
  mcVersion: '1.20.1',
  runId,
  reportArtifact: sink ? (a: AgentArtifact) => sink.push(a) : undefined
})

/** 单次工具实例（真实注册表只建一次，清单缓存随实例存活） */
type TodoTool = ReturnType<typeof builtinTodoTools>[number]
const newTool = (): TodoTool => builtinTodoTools()[0]

describe('parseTodos · 入参校验', () => {
  it('合法清单：缺省 id 按序号生成', () => {
    const r = parseTodos({
      todos: [
        { content: '读回实体类', status: 'in_progress' },
        { content: '写 Goal', status: 'pending' }
      ]
    })
    expect('todos' in r && r.todos).toEqual([
      { id: 't1', content: '读回实体类', status: 'in_progress' },
      { id: 't2', content: '写 Goal', status: 'pending' }
    ])
  })

  it('非数组 / 空数组 → 拒绝', () => {
    expect(parseTodos({ todos: 'x' })).toEqual({ error: 'todos 必须是数组（每次提交完整清单）' })
    expect(parseTodos({ todos: [] })).toEqual({ error: 'todos 为空：至少列出一项待办' })
  })

  it('超长清单 → 拒绝', () => {
    const todos = Array.from({ length: 31 }, (_, i) => ({ content: `步骤${i}`, status: 'pending' }))
    expect(parseTodos({ todos })).toMatchObject({ error: expect.stringContaining('todos 过多') })
  })

  it('content 为空 / 超过 300 字 → 拒绝', () => {
    expect(parseTodos({ todos: [{ content: '  ', status: 'pending' }] })).toEqual({
      error: 'todos[0].content 不能为空'
    })
    expect(parseTodos({ todos: [{ content: 'x'.repeat(301), status: 'pending' }] })).toMatchObject({
      error: expect.stringContaining('过长')
    })
  })

  it('非法 status → 拒绝', () => {
    expect(parseTodos({ todos: [{ content: 'a', status: 'done' }] })).toEqual({
      error: 'todos[0].status 必须是 pending|in_progress|completed'
    })
  })

  it('id 重复 → 拒绝', () => {
    const todos = [
      { id: 's1', content: 'a', status: 'pending' },
      { id: 's1', content: 'b', status: 'pending' }
    ]
    expect(parseTodos({ todos })).toEqual({ error: 'todos[1].id 重复（s1）：每项 id 必须唯一' })
  })

  it('多项 in_progress → 拒绝并提示修正', () => {
    const todos = [
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'in_progress' }
    ]
    expect(parseTodos({ todos })).toMatchObject({
      error: expect.stringContaining('只能有 1 项 in_progress')
    })
  })
})

describe('formatTodos · 回填文本', () => {
  it('标出完成数与进行中项，并给出下一步指令', () => {
    const text = formatTodos([
      { id: 't1', content: '读回实体类', status: 'completed' },
      { id: 't2', content: '写 Goal', status: 'in_progress' },
      { id: 't3', content: '构建', status: 'pending' }
    ])
    expect(text).toContain('1/3 完成')
    expect(text).toContain('[x] 读回实体类')
    expect(text).toContain('[~] 写 Goal')
    expect(text).toContain('当前进行中：写 Goal')
  })

  it('全部完成 → 要求立即收口，不再开新步骤', () => {
    const text = formatTodos([{ id: 't1', content: '构建', status: 'completed' }])
    expect(text).toContain('全部步骤已完成')
  })

  it('无进行中项 → 提示把当前项置为 in_progress', () => {
    const text = formatTodos([{ id: 't1', content: '构建', status: 'pending' }])
    expect(text).toContain('没有进行中的项')
  })
})

describe('todo_write · 工具行为', () => {
  it('首次提交 → 上报 todo-list artifact 并回填进度文本', async () => {
    const sink: AgentArtifact[] = []
    const r = await newTool().execute(
      { todos: [{ content: '读回实体类', status: 'in_progress' }, { content: '写 Goal', status: 'pending' }] },
      ctx('run-1', sink)
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('0/2 完成')
    expect(sink).toHaveLength(1)
    expect(sink[0]).toMatchObject({ kind: 'todo-list', title: '任务清单（0/2 完成）' })
    expect(sink[0].id).toBe('todo-list-run-1')
    expect(sink[0].todos?.[0]).toEqual({ id: 't1', content: '读回实体类', status: 'in_progress' })
  })

  it('进度推进 → 同一 run 内 artifact id 固定（面板原地刷新而非堆叠）', async () => {
    const sink: AgentArtifact[] = []
    const tool = newTool()
    const c = ctx('run-2', sink)
    await tool.execute({ todos: [{ content: 'a', status: 'in_progress' }] }, c)
    const r = await tool.execute(
      { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] },
      c
    )
    expect(sink.map((a) => a.id)).toEqual(['todo-list-run-2', 'todo-list-run-2'])
    expect(r.text).toContain('1/2 完成')
  })

  it('与上一版完全一致 → 无变化短路，不再上报 artifact', async () => {
    const sink: AgentArtifact[] = []
    const tool = newTool()
    const c = ctx('run-3', sink)
    const args = { todos: [{ content: 'a', status: 'pending' }] }
    await tool.execute(args, c)
    const r = await tool.execute(args, c)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('清单与上一版完全一致')
    expect(sink).toHaveLength(1)
  })

  it('换 run 后清单缓存重置（新 run 相同清单仍视为变化）', async () => {
    const sink: AgentArtifact[] = []
    const tool = newTool()
    const args = { todos: [{ content: 'a', status: 'pending' }] }
    await tool.execute(args, ctx('run-4', sink))
    await tool.execute(args, ctx('run-5', sink))
    expect(sink.map((a) => a.id)).toEqual(['todo-list-run-4', 'todo-list-run-5'])
  })

  it('非法入参 → ok:false 且不产生 artifact', async () => {
    const sink: AgentArtifact[] = []
    const r = await newTool().execute(
      { todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }] },
      ctx('run-6', sink)
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('只能有 1 项 in_progress')
    expect(sink).toHaveLength(0)
  })

  it('未注入 reportArtifact（集成桥/直调）时正常返回不抛错', async () => {
    const r = await newTool().execute({ todos: [{ content: 'a', status: 'pending' }] }, ctx('run-7'))
    expect(r.ok).toBe(true)
  })
})
