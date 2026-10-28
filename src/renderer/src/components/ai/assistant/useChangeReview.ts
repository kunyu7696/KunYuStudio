/**
 * 改动审批回路（P3）：把一次运行落盘的文件变更做成「逐条复核 + 采纳/撤销」队列。
 *
 * 落盘策略保持 T1 的即时 write-through（工作台实时可见），审批是事后的：
 * - 采纳 = 保持磁盘现状（无副作用，仅记状态）；
 * - 撤销 = 调已有 agent.rollback-file（modify 恢复 run 前原文 / create 删文件）。
 * 每行附带「＋N −M」行级统计（小文件 LCS 精确计数；超过阈值降级为「整文件视图」，
 * 不在面板内展开行级预览，改用 Monaco DiffEditor 看全文）。
 *
 * 审批状态与统计按 `${runId}:${path}` 存在模块级 reactive Map：切换气泡/重挂载后仍在，
 * 同一文件在 run 内只复核一次。
 */
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAiAgentsStore } from '../../../stores/aiAgents'
import { useEditorStore } from '../../../stores/editor'
import { useExplorerStore } from '../../../stores/explorer'
import { useProjectStore } from '../../../stores/project'
import type { AgentArtifact } from '../../../../../shared/types/agent'
import { t } from '../../../i18n'

export type ChangeReviewStatus = 'pending' | 'kept' | 'reverted'

export interface LineDiffStats {
  added: number
  removed: number
  /** 变更规模超过阈值：调用方应提示「整文件视图」，不展开行级预览 */
  truncated: boolean
}

/** 行级预览的规模上限（超过即降级为整文件视图） */
export const MAX_DIFF_LINES = 1200

function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** 经典 LCS 长度（滚动数组，内存 O(min)，用于小文件精确统计 +/- 行数） */
function lcsLength(a: string[], b: string[]): number {
  const n = b.length
  let prev = new Uint32Array(n + 1)
  let cur = new Uint32Array(n + 1)
  for (let i = 1; i <= a.length; i++) {
    const ai = a[i - 1]
    for (let j = 1; j <= n; j++) {
      cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    const tmp = prev
    prev = cur
    cur = tmp
    cur.fill(0)
  }
  return prev[n]
}

/** 多重集差集计数（大文件降级路径，O(n)） */
function multisetDiff(a: string[], b: string[]): { added: number; removed: number } {
  const counts = new Map<string, number>()
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of b) {
    const n = counts.get(line) ?? 0
    if (n > 0) counts.set(line, n - 1)
    else added += 1
  }
  let removed = 0
  for (const n of counts.values()) if (n > 0) removed += n
  return { added, removed }
}

/**
 * 行级 diff 统计（审批行的「＋N −M」徽标）：
 * 两侧都不超过 maxLines 时走 LCS 精确计数（与统一 diff 的 +/- 行数一致）；
 * 任一侧超限则降级为多重集计数并置 truncated=true。
 */
export function diffLineStats(
  original: string,
  current: string,
  maxLines: number = MAX_DIFF_LINES
): LineDiffStats {
  const a = toLines(original)
  const b = toLines(current)
  if (a.length <= maxLines && b.length <= maxLines) {
    const common = lcsLength(a, b)
    return { added: b.length - common, removed: a.length - common, truncated: false }
  }
  const { added, removed } = multisetDiff(a, b)
  return { added, removed, truncated: true }
}

/** 本次运行里已落盘（accepted）的文件路径，按 artifact 出现顺序去重 */
export function landedPaths(artifacts: AgentArtifact[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const art of artifacts) {
    if (art.kind !== 'file-change') continue
    for (const f of art.files ?? []) {
      if (!f.accepted || seen.has(f.path)) continue
      seen.add(f.path)
      out.push(f.path)
    }
  }
  return out
}

function keyOf(runId: string, relPath: string): string {
  return `${runId}:${relPath}`
}

/** 会话级审批状态与统计缓存（跨组件重挂载保留） */
const statusMap = reactive(new Map<string, ChangeReviewStatus>())
const statsMap = reactive(new Map<string, LineDiffStats | null>())

/** 某文件的审批状态：默认 pending（已落盘但用户尚未复核） */
export function reviewStatusOf(runId: string | null, relPath: string): ChangeReviewStatus {
  if (!runId) return 'pending'
  return statusMap.get(keyOf(runId, relPath)) ?? 'pending'
}

/**
 * 严格审查闸门：某 run 已落盘但仍 pending 的文件列表。
 * 开启 ai.strictReview 后，此列表清空前不允许发起下一次 Agent 运行。
 */
export function pendingReviewPaths(runId: string | null, artifacts: AgentArtifact[]): string[] {
  if (!runId) return []
  return landedPaths(artifacts).filter((p) => reviewStatusOf(runId, p) === 'pending')
}

export function useChangeReview() {
  const projectStore = useProjectStore()
  const editorStore = useEditorStore()
  const explorerStore = useExplorerStore()
  const agentsStore = useAiAgentsStore()
  /** 撤销进行中（按钮 loading 态 + 防重入） */
  const reviewing = ref(false)

  function currentRunId(): string | null {
    return agentsStore.runId
  }

  function statsOf(runId: string | null, relPath: string): LineDiffStats | null | undefined {
    if (!runId) return undefined
    return statsMap.get(keyOf(runId, relPath))
  }

  /** 懒加载行级统计：取 run 前快照 + 当前磁盘内容（未落盘/无快照则记 null） */
  async function loadStats(runId: string | null, paths: string[]): Promise<void> {
    const projectPath = projectStore.currentProject?.path
    if (!runId || !projectPath || paths.length === 0) return
    const pending = paths.filter((p) => !statsMap.has(keyOf(runId, p)))
    for (const relPath of pending) {
      const key = keyOf(runId, relPath)
      try {
        const snap = await window.api.agent.getFileSnapshot(runId, relPath)
        if (!snap.found) {
          statsMap.set(key, null)
          continue
        }
        const file = await window.api.fs.readFile(`${projectPath}/${relPath}`)
        statsMap.set(key, diffLineStats(snap.original ?? '', file.content))
      } catch {
        // 文件已被删除/读取失败：无统计不阻断审批队列
        statsMap.set(key, null)
      }
    }
  }

  /** 「对比」：run 前快照 vs 当前磁盘，打开 Monaco DiffEditor 标签（只读） */
  async function openDiff(runId: string | null, relPath: string): Promise<void> {
    if (!runId) {
      ElMessage.warning(t('assistant.review.noRun'))
      return
    }
    const projectPath = projectStore.currentProject?.path
    if (!projectPath) {
      ElMessage.warning(t('assistant.review.noProject'))
      return
    }
    const snap = await window.api.agent.getFileSnapshot(runId, relPath)
    if (!snap.found) {
      ElMessage.info(t('assistant.review.noSnapshot'))
      return
    }
    await editorStore.openDiff({
      relPath,
      absPath: `${projectPath}/${relPath}`,
      original: snap.original ?? ''
    })
  }

  function keep(runId: string | null, relPath: string): void {
    if (!runId) return
    statusMap.set(keyOf(runId, relPath), 'kept')
  }

  /** 撤销后同步工作台：文件树刷新；已打开该文件则重载（create 撤销后文件已删 → 关标签） */
  async function syncWorkbench(projectPath: string, relPath: string): Promise<void> {
    await explorerStore.refreshAll()
    const absPath = `${projectPath}/${relPath}`
    const diffPath = `diff://${relPath}`
    if (editorStore.tabs.some((tab) => tab.path === diffPath)) await editorStore.closeTab(diffPath)
    if (editorStore.tabs.some((tab) => tab.path === absPath)) {
      try {
        await editorStore.reloadTab(absPath)
      } catch {
        await editorStore.closeTab(absPath)
      }
    }
  }

  /**
   * 撤销单个文件（把磁盘恢复到 run 前状态）。
   * @param confirm false 时不再弹确认（批量撤销已在入口确认过一次）
   */
  async function revert(runId: string | null, relPath: string, confirm = true): Promise<boolean> {
    if (!runId) {
      ElMessage.warning(t('assistant.review.noRunRevert'))
      return false
    }
    const projectPath = projectStore.currentProject?.path
    if (!projectPath) {
      ElMessage.warning(t('assistant.review.noProject'))
      return false
    }
    if (confirm) {
      try {
        await ElMessageBox.confirm(t('assistant.review.revertConfirm', { path: relPath }), t('assistant.review.revertTitle'), {
          type: 'warning',
          confirmButtonText: t('assistant.review.revert'),
          cancelButtonText: t('common.cancel')
        })
      } catch {
        return false // 用户取消
      }
    }
    const res = await window.api.agent.rollbackFile(runId, relPath)
    if (!res.ok) {
      ElMessage.warning(res.reason ?? t('assistant.review.revertFailed'))
      return false
    }
    statusMap.set(keyOf(runId, relPath), 'reverted')
    await syncWorkbench(projectPath, relPath)
    return true
  }

  function keepAll(runId: string | null, paths: string[]): void {
    if (!runId) return
    for (const relPath of paths) statusMap.set(keyOf(runId, relPath), 'kept')
  }

  /** 批量撤销：一次确认后逐文件回滚，返回成功条数 */
  async function revertAll(runId: string | null, paths: string[]): Promise<number> {
    if (!runId || paths.length === 0) return 0
    try {
      await ElMessageBox.confirm(t('assistant.review.revertAllConfirm', { n: paths.length }), t('assistant.review.revertAllTitle'), {
        type: 'warning',
        confirmButtonText: t('assistant.review.revertAllBtn'),
        cancelButtonText: t('common.cancel')
      })
    } catch {
      return 0 // 用户取消
    }
    if (reviewing.value) return 0
    reviewing.value = true
    let done = 0
    try {
      for (const relPath of paths) {
        if (await revert(runId, relPath, false)) done += 1
      }
      if (done > 0) ElMessage.success(t('assistant.review.revertedMsg', { n: done }))
    } finally {
      reviewing.value = false
    }
    return done
  }

  return {
    reviewing,
    currentRunId,
    statsOf,
    statusOf: reviewStatusOf,
    loadStats,
    openDiff,
    keep,
    keepAll,
    revert,
    revertAll
  }
}
