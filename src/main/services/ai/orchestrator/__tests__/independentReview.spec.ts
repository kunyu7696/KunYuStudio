/**
 * 独立审查：上下文隔离 + 结构化结论 + 阻断判定。
 * - 送审消息只有 system/user 两条：项目类型 + 验收条件 + diff，没有任何生成轨迹
 * - 只有「verdict=fail 且至少一个 blocker」才阻断（warning 不阻断）
 * - 应答不可解析 → skipped，绝不因为审查自身不稳定误伤运行
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildReviewDiff,
  buildReviewMessages,
  buildUnifiedDiff,
  parseReviewReply,
  runIndependentReview,
  type IndependentReviewInput
} from '../independentReview'

const INPUT: IndependentReviewInput = {
  projectType: 'mod（fabric / 1.21.1）',
  acceptance: ['方块注册进 Registry', '贴图 16x16'],
  files: [
    {
      path: 'src/main/java/com/demo/ModBlocks.java',
      before: 'public class ModBlocks {\n}\n',
      after: 'public class ModBlocks {\n  public static final Block ORE = null;\n}\n',
      action: 'modify'
    }
  ]
}

describe('buildUnifiedDiff', () => {
  it('新建文件输出全增行', () => {
    const diff = buildUnifiedDiff('a/New.java', null, 'class A {\n}\n')
    expect(diff).toContain('--- a/a/New.java')
    expect(diff).toContain('+++ b/a/New.java')
    expect(diff).toContain('+class A {')
    expect(diff).not.toContain('-class A {')
  })

  it('修改文件输出增删行', () => {
    const diff = buildUnifiedDiff(
      'A.java',
      'class A {\n}\n',
      'class A {\n  int x;\n}\n'
    )
    expect(diff).toContain('+  int x;')
    expect(diff.split('\n').some((l) => l === ' class A {')).toBe(true)
  })

  it('无变更返回空串', () => {
    expect(buildUnifiedDiff('A.java', 'same\n', 'same\n')).toBe('')
  })
})

describe('buildReviewMessages：上下文隔离', () => {
  it('只有 system + user，内容仅含项目类型/验收条件/diff', () => {
    const { text } = buildReviewDiff(INPUT.files)
    const messages = buildReviewMessages(INPUT, text)
    expect(messages.map((m) => m.role)).toEqual(['system', 'user'])
    const body = messages.map((m) => m.content).join('\n')
    expect(body).toContain('mod（fabric / 1.21.1）')
    expect(body).toContain('方块注册进 Registry')
    expect(body).toContain('+  public static final Block ORE = null;')
    // 不得出现生成过程/工具轨迹/计划自述类内容
    expect(body).not.toContain('tool_calls')
    expect(body).not.toContain('执行计划')
    expect(body).not.toContain('思考过程')
  })
})

describe('parseReviewReply', () => {
  it('解析纯 JSON 与围栏 JSON', () => {
    expect(parseReviewReply('{"verdict":"pass","summary":"ok","issues":[]}')?.verdict).toBe('pass')
    expect(
      parseReviewReply('```json\n{"verdict":"fail","summary":"bad","issues":[]}\n```')?.verdict
    ).toBe('fail')
  })

  it('缺少 verdict / 非 JSON → null', () => {
    expect(parseReviewReply('{"summary":"x"}')).toBeNull()
    expect(parseReviewReply('not json at all')).toBeNull()
  })

  it('问题项做白名单与截断，未知 severity 记为 warning', () => {
    const parsed = parseReviewReply(
      JSON.stringify({
        verdict: 'fail',
        summary: 'x',
        issues: [{ file: 'A.java', line: 3, severity: 'weird', reason: 'r' }, { file: '' }]
      })
    )
    expect(parsed?.issues).toEqual([
      { file: 'A.java', line: 3, severity: 'warning', reason: 'r' }
    ])
  })
})

describe('runIndependentReview', () => {
  it('明确 fail + blocker → 阻断', async () => {
    const ask = vi.fn().mockResolvedValue(
      JSON.stringify({
        verdict: 'fail',
        summary: '缺少注册',
        issues: [{ file: 'src/main/java/com/demo/ModBlocks.java', line: 2, severity: 'blocker', reason: 'ORE 未注册' }]
      })
    )
    const out = await runIndependentReview({ ask }, INPUT)
    expect(out.status).toBe('fail')
    expect(out.issues).toHaveLength(1)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('verdict=fail 但没有 blocker → 不阻断（记为 pass + warning）', async () => {
    const ask = vi.fn().mockResolvedValue(
      JSON.stringify({
        verdict: 'fail',
        summary: '仅风格问题',
        issues: [{ file: 'A.java', line: 1, severity: 'warning', reason: '命名' }]
      })
    )
    const out = await runIndependentReview({ ask }, INPUT)
    expect(out.status).toBe('pass')
    expect(out.issues).toEqual([
      { file: 'A.java', line: 1, severity: 'warning', reason: '命名' }
    ])
  })

  it('应答不可解析 → skipped，不阻断', async () => {
    const out = await runIndependentReview({ ask: async () => '模型跑偏了' }, INPUT)
    expect(out.status).toBe('skipped')
  })

  it('无 diff → skipped 且不调用模型', async () => {
    const ask = vi.fn()
    const out = await runIndependentReview(
      { ask },
      { ...INPUT, files: [{ path: 'A.java', before: 'x\n', after: 'x\n', action: 'modify' }] }
    )
    expect(out.status).toBe('skipped')
    expect(ask).not.toHaveBeenCalled()
  })
})
