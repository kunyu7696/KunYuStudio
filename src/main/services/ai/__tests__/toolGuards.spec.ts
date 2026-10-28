import { describe, expect, it } from 'vitest'
import {
  ToolLoopGuard,
  clipToolResult,
  MONOLOGUE_MIN_CHARS,
  normalizeArgs,
  normalizeError,
  WRITE_TOOL_NAMES
} from '../orchestrator/toolGuards'

describe('normalizeArgs', () => {
  it('键序不同但内容相同视为同一签名', () => {
    expect(normalizeArgs({ a: 1, b: 2 })).toBe(normalizeArgs({ b: 2, a: 1 }))
  })

  it('数组与非对象参数稳定序列化', () => {
    expect(normalizeArgs([1, 2])).toBe('[1,2]')
    expect(normalizeArgs('x')).toBe('"x"')
    expect(normalizeArgs(null)).toBe('null')
  })
})

describe('ToolLoopGuard repeat-guard', () => {
  it('同工具同参数超过上限后短路', () => {
    const g = new ToolLoopGuard()
    const a1 = g.noteCall('kb_search', { query: '镐子注册' })
    const a2 = g.noteCall('kb_search', { query: '镐子注册' })
    const a3 = g.noteCall('kb_search', { query: '镐子注册' })
    expect(a1.blocked).toBe(false)
    expect(a2.blocked).toBe(false)
    expect(a3.blocked).toBe(true)
    expect(a3.count).toBe(3)
    expect(a3.notice).toContain('kb_search')
  })

  it('参数不同不拦截；不同工具互不影响', () => {
    const g = new ToolLoopGuard()
    expect(g.noteCall('kb_search', { query: 'a' }).blocked).toBe(false)
    expect(g.noteCall('kb_search', { query: 'a' }).blocked).toBe(false)
    expect(g.noteCall('kb_search', { query: 'b' }).blocked).toBe(false)
    expect(g.noteCall('template_search', { query: 'a' }).blocked).toBe(false)
  })

  it('自定义重复阈值生效', () => {
    const g = new ToolLoopGuard(1)
    expect(g.noteCall('x', {}).blocked).toBe(false)
    expect(g.noteCall('x', {}).blocked).toBe(true)
  })
})

describe('ToolLoopGuard 只读轮次上限', () => {
  it('连续只读达到阈值时强制收口且只触发一次', () => {
    const g = new ToolLoopGuard(2, 3)
    expect(g.noteRound(['kb_search']).forceSynthesize).toBe(false)
    expect(g.noteRound(['template_search', 'kb_search']).forceSynthesize).toBe(false)
    const third = g.noteRound(['kb_search'])
    expect(third.forceSynthesize).toBe(true)
    expect(third.notice).toContain('3 轮')
    // 继续只读也不重复触发
    expect(g.noteRound(['kb_search']).forceSynthesize).toBe(false)
  })

  it('写工具执行成功（result.ok）才清零连续计数', () => {
    const g = new ToolLoopGuard(2, 2)
    g.noteRound(['kb_search'])
    expect(g.noteRound(['content_upsert'], true).readonlyStreak).toBe(0)
    expect(g.noteRound(['kb_search']).forceSynthesize).toBe(false)
    expect(g.currentReadonlyStreak).toBe(1)
  })

  it('P1-6：写意图但执行失败（ok:false）不清零——按结果记账防无限空转', () => {
    // 复现实测：两轮只读 + 第三轮 write_project_file 返回 ok:false ⇒ 旧实现 streak=0 永不收口
    const g = new ToolLoopGuard(2, 3)
    g.noteRound(['kb_search'])
    g.noteRound(['kb_search'])
    const third = g.noteRound(['write_project_file'], false)
    expect(third.readonlyStreak).toBe(3)
    expect(third.forceSynthesize).toBe(true)
    expect(third.notice).toContain('3 轮')
  })

  it('P1-6：被 repeat-guard 拦截的写调用不算成功写入', () => {
    const g = new ToolLoopGuard(2, 2)
    g.noteRound(['write_project_file'], false)
    const second = g.noteRound(['write_project_file'], false)
    expect(second.readonlyStreak).toBe(2)
  })

  it('写工具集合覆盖三类内容落盘动作', () => {
    for (const n of [
      'content_upsert',
      'write_project_file',
      'edit_project_file',
      'texture_paint',
      'texture_pixelize',
      'texture_repaint'
    ]) {
      expect(WRITE_TOOL_NAMES.has(n)).toBe(true)
    }
  })

  it('未调用工具的轮次不累计只读', () => {
    const g = new ToolLoopGuard(2, 2)
    g.noteRound(['kb_search'])
    expect(g.noteRound([]).readonlyStreak).toBe(0)
  })
})

describe('normalizeError（P2 卡死检测：同类失败聚合）', () => {
  it('抹平空白与数字差异，让「同类错误」可聚合', () => {
    expect(normalizeError('search 未命中: line  42')).toBe(normalizeError('search 未命中: line 7'))
  })

  it('不同错因不聚合', () => {
    expect(normalizeError('路径逃逸 /tmp/x')).not.toBe(normalizeError('文件不存在'))
  })

  it('超长错误文本截断到 200 字符（避免签名无限膨胀）', () => {
    expect(normalizeError('e'.repeat(500)).length).toBe(200)
  })
})

describe('ToolLoopGuard 卡死检测（P2）', () => {
  it('同一工具同一错因反复失败 → 达阈值提示换策略且只提示一次', () => {
    const g = new ToolLoopGuard(2, 3, 2)
    expect(g.noteFailure('edit_project_file', 'search 未命中：line 12').stuck).toBe(false)
    expect(g.noteFailure('edit_project_file', 'search 未命中：line 34').stuck).toBe(false)
    const third = g.noteFailure('edit_project_file', 'search 未命中：line 99')
    expect(third.stuck).toBe(true)
    expect(third.kind).toBe('repeat-error')
    expect(third.notice).toContain('同一原因失败 3 次')
    // 后续同类失败不再重复刷提示
    expect(g.noteFailure('edit_project_file', 'search 未命中：line 108').stuck).toBe(false)
  })

  it('不同错因 / 不同工具各自计数，不误判卡死', () => {
    const g = new ToolLoopGuard(2, 3, 2)
    g.noteFailure('edit_project_file', 'A')
    g.noteFailure('edit_project_file', 'B')
    g.noteFailure('write_project_file', 'A')
    expect(g.noteFailure('edit_project_file', 'C').stuck).toBe(false)
  })

  it('连续全失败工具轮 → 达阈值提示停止试探', () => {
    const g = new ToolLoopGuard(2, 3, 3, 2)
    g.noteRound(['write_project_file'], false, 1)
    expect(g.noteFailedRounds().stuck).toBe(false)
    g.noteRound(['write_project_file'], false, 1)
    const third = g.noteRound(['write_project_file'], false, 1)
    expect(third.readonlyStreak).toBe(3)
    // 有成功写入的轮次复位连续失败计数
    const g2 = new ToolLoopGuard(2, 3, 3, 2)
    g2.noteRound(['write_project_file'], false, 1)
    g2.noteRound(['kb_search'], false, 0)
    g2.noteRound(['write_project_file'], false, 1)
    expect(g2.noteFailedRounds().stuck).toBe(false)
  })

  it('独白：连续两轮长篇零产出 → 判定卡死；短文本不计', () => {
    const g = new ToolLoopGuard(2, 3, 3, 3, 2)
    expect(g.noteMonologue(MONOLOGUE_MIN_CHARS - 1).stuck).toBe(false)
    expect(g.noteMonologue(MONOLOGUE_MIN_CHARS).stuck).toBe(false)
    const second = g.noteMonologue(MONOLOGUE_MIN_CHARS + 10)
    expect(second.stuck).toBe(true)
    expect(second.kind).toBe('monologue')
    expect(second.notice).toContain('只输出解释/规划')
  })

  it('独白计数在产出恢复（成功写入）后可复位', () => {
    const g = new ToolLoopGuard(2, 3, 3, 3, 2)
    g.noteMonologue(MONOLOGUE_MIN_CHARS)
    g.resetMonologue()
    expect(g.noteMonologue(MONOLOGUE_MIN_CHARS).stuck).toBe(false)
  })
})

describe('clipToolResult', () => {
  it('未超长原样返回', () => {
    expect(clipToolResult('abc', 10)).toBe('abc')
  })

  it('超长截断并显式提示（P1-6：保留尾部）', () => {
    const out = clipToolResult('x'.repeat(100), 80)
    expect(out.endsWith('x'.repeat(80))).toBe(true)
    expect(out).toContain('开头 20 个字符已截断')
  })

  it('P1-6：末尾的错误详情不被截掉（模型能看到失败原因）', () => {
    const body = 'a'.repeat(200) + '真实失败原因：路径逃逸 /tmp/escape'
    const out = clipToolResult(body, 60)
    expect(out).toContain('真实失败原因：路径逃逸 /tmp/escape')
    expect(out).not.toContain('a'.repeat(60))
  })
})
