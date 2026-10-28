import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MAX_DIFF_LINES, diffLineStats, landedPaths, pendingReviewPaths, useChangeReview } from '../assistant/useChangeReview'
import type { AgentArtifact } from '../../../../../shared/types/agent'

/**
 * 改动审批（P3）行级统计契约：
 * - 小文件走 LCS 精确计数（added/removed 与统一 diff 的 +/- 行数一致）
 * - CRLF/LF 归一后不产生假差异
 * - 超过行数阈值降级为整文件视图（truncated=true，计数退化为多重集差集）
 * - landedPaths 只收已落盘（accepted）文件并按出现顺序去重
 */
describe('diffLineStats · 行级统计', () => {
  it('内容相同 → 零增零删', () => {
    expect(diffLineStats('a\nb\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0, truncated: false })
  })

  it('替换一行 → 各计一行', () => {
    expect(diffLineStats('a\nb\nc', 'a\nx\nc')).toEqual({ added: 1, removed: 1, truncated: false })
  })

  it('追加行 → 只计新增', () => {
    expect(diffLineStats('a\nb', 'a\nb\nc\nd')).toEqual({ added: 2, removed: 0, truncated: false })
  })

  it('删除行 → 只计删除', () => {
    expect(diffLineStats('a\nb\nc\nd', 'a\nc')).toEqual({ added: 0, removed: 2, truncated: false })
  })

  it('CRLF/LF 归一后不产生假差异', () => {
    expect(diffLineStats('a\r\nb\r\nc', 'a\nb\nc')).toEqual({ added: 0, removed: 0, truncated: false })
  })

  it('超过阈值降级为整文件视图（truncated=true）并按多重集计数', () => {
    const stats = diffLineStats('l1\nl2\nl3\nl4', 'l1\nl2\nl5\nl6', 3)
    expect(stats).toEqual({ added: 2, removed: 2, truncated: true })
  })

  it('未超阈值时 truncated=false（阈值即上限，正好等于不算超）', () => {
    const lines = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `l${i}`).join('\n')
    expect(diffLineStats(lines, lines).truncated).toBe(false)
  })
})

describe('landedPaths · 审批队列收集', () => {
  function changeArt(id: string, files: AgentArtifact['files']): AgentArtifact {
    return { id, kind: 'file-change', title: '文件变更', files }
  }

  it('只收 accepted 文件，跨 artifact 去重并保持出现顺序', () => {
    const artifacts: AgentArtifact[] = [
      changeArt('a', [
        { path: 'src/A.java', action: 'create', content: '', accepted: true },
        { path: 'src/Bad.java', action: 'create', content: '', accepted: false, reason: '括号不配平' }
      ]),
      changeArt('b', [
        { path: 'src/A.java', action: 'modify', content: '', accepted: true },
        { path: 'src/C.java', action: 'create', content: '', accepted: true }
      ])
    ]
    expect(landedPaths(artifacts)).toEqual(['src/A.java', 'src/C.java'])
  })

  it('忽略非 file-change 产物', () => {
    const artifacts: AgentArtifact[] = [{ id: 'x', kind: 'plan', title: '计划', body: '' }]
    expect(landedPaths(artifacts)).toEqual([])
  })
})

describe('pendingReviewPaths · 严格审查闸门', () => {
  function changeArt(id: string, files: AgentArtifact['files']): AgentArtifact {
    return { id, kind: 'file-change', title: '文件变更', files }
  }
  const artifacts: AgentArtifact[] = [
    changeArt('a', [
      { path: 'src/A.java', action: 'create', content: '', accepted: true },
      { path: 'src/B.java', action: 'modify', content: '', accepted: true },
      { path: 'src/Rej.java', action: 'create', content: '', accepted: false, reason: '校验失败' }
    ])
  ]

  it('runId 为空 → 不阻塞（返回空队列）', () => {
    expect(pendingReviewPaths(null, artifacts)).toEqual([])
  })

  it('默认全部 pending；keep / keepAll 后逐步移出闸门队列', () => {
    setActivePinia(createPinia())
    const review = useChangeReview()
    // statusMap 为模块级共享：使用专属 runId 避免与其他用例互相污染
    const runId = 'run-strict-gate'
    expect(pendingReviewPaths(runId, artifacts)).toEqual(['src/A.java', 'src/B.java'])
    review.keep(runId, 'src/A.java')
    expect(pendingReviewPaths(runId, artifacts)).toEqual(['src/B.java'])
    review.keepAll(runId, ['src/B.java'])
    expect(pendingReviewPaths(runId, artifacts)).toEqual([])
  })
})
