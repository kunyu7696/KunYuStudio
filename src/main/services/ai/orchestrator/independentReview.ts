/**
 * 独立审查：生成者与审查者上下文隔离的硬闸门。
 *
 * 现状问题：generate 之后是同一模型、同一上下文「自审」——它已经知道自己
 * 为什么这么写，看到的是自己的推理，容易顺着自己的结论打勾。
 *
 * 这里把审查者做成一个**只读 diff 的角色**：输入仅有
 *   1) 变更后的 unified diff（真实落盘内容 vs 变更前快照）
 *   2) 验收条件（来自契约/计划，作为待核对项，不作为证据）
 *   3) 项目类型（mod / modpack、loader、MC 版本）
 * 不传生成过程、工具轨迹、模型自述、计划理由。输出结构化
 * 「verdict + 问题清单（文件:行 + 理由）」，fail 时由调用方阻断并回滚。
 *
 * 容错：应答无法解析 → skipped（不阻断），避免审查环节自身成为不稳定源；
 * 只有审查者明确给出 verdict=fail 才阻断。
 */
import type { ChatMessage } from '../../../../shared/types/ai'

/** 单个送审文件：变更前快照可为 null（新建） */
export interface ReviewFileInput {
  path: string
  before: string | null
  after: string
  action: 'create' | 'modify'
}

export interface ReviewIssue {
  file: string
  /** 行号（变更后文件）；无法定位时为 null */
  line: number | null
  severity: 'blocker' | 'warning'
  reason: string
}

export interface IndependentReviewInput {
  /** 项目类型描述，如 "mod（fabric / 1.21.1）" */
  projectType: string
  /** 验收条件（逐条核对项） */
  acceptance: string[]
  files: ReviewFileInput[]
}

export interface IndependentReviewDeps {
  /** 隔离上下文的一次模型调用（调用方负责预算记账） */
  ask: (messages: ChatMessage[]) => Promise<string>
  log?: (detail: string) => void
}

export type IndependentReviewStatus = 'pass' | 'fail' | 'skipped'

export interface IndependentReviewOutcome {
  status: IndependentReviewStatus
  summary: string
  issues: ReviewIssue[]
  /** 实际送审文件数（审计用） */
  reviewedFiles: number
  /** 送审 diff 字符数（成本/截断可追溯） */
  diffChars: number
}

/** 单文件 diff 上限：超出时只保留前 N 字符并明确标注截断 */
export const REVIEW_FILE_DIFF_CAP = 24_000
/** 全部 diff 总上限 */
export const REVIEW_TOTAL_DIFF_CAP = 80_000

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

interface DiffOp {
  type: ' ' | '-' | '+'
  text: string
}

/** 行级 LCS；超大文件退化为整文件替换，避免 O(n·m) 内存爆炸 */
function diffOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  if (n * m > 4_000_000) {
    return [
      ...a.map((text): DiffOp => ({ type: '-', text })),
      ...b.map((text): DiffOp => ({ type: '+', text }))
    ]
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: ' ', text: a[i]! })
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: '-', text: a[i]! })
      i += 1
    } else {
      out.push({ type: '+', text: b[j]! })
      j += 1
    }
  }
  while (i < n) out.push({ type: '-', text: a[i++]! })
  while (j < m) out.push({ type: '+', text: b[j++]! })
  return out
}

/** 只输出变更块 ±3 行上下文，避免整文件灌给审查者 */
const CONTEXT_LINES = 3

/** 生成统一 diff；无变更返回空串 */
export function buildUnifiedDiff(
  path: string,
  before: string | null,
  after: string
): string {
  const ops = diffOps(splitLines(before ?? ''), splitLines(after))
  const changed = ops.map((o, idx) => (o.type === ' ' ? -1 : idx)).filter((i) => i >= 0)
  if (changed.length === 0) return ''

  const keep = new Set<number>()
  for (const idx of changed) {
    for (let k = idx - CONTEXT_LINES; k <= idx + CONTEXT_LINES; k++) {
      if (k >= 0 && k < ops.length) keep.add(k)
    }
  }
  const kept = [...keep].sort((x, y) => x - y)

  /* 为每个 op 预计算变更前/后的行号（hunk header 需要） */
  const oldNo: number[] = []
  const newNo: number[] = []
  let o = 1
  let nn = 1
  for (const op of ops) {
    oldNo.push(o)
    newNo.push(nn)
    if (op.type !== '+') o += 1
    if (op.type !== '-') nn += 1
  }

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`]
  let cursor = 0
  while (cursor < kept.length) {
    let end = cursor
    while (end + 1 < kept.length && kept[end + 1]! === kept[end]! + 1) end += 1
    const group = kept.slice(cursor, end + 1)
    const first = group[0]!
    const last = group[group.length - 1]!
    const oldCount = ops.slice(first, last + 1).filter((op) => op.type !== '+').length
    const newCount = ops.slice(first, last + 1).filter((op) => op.type !== '-').length
    lines.push(`@@ -${oldNo[first]},${oldCount} +${newNo[first]},${newCount} @@`)
    for (const idx of group) {
      const op = ops[idx]!
      lines.push(`${op.type}${op.text}`)
    }
    cursor = end + 1
  }
  return lines.join('\n')
}

/** 把文件列表渲染为送审 diff 文本（带单文件与总量截断保护） */
export function buildReviewDiff(files: ReviewFileInput[]): { text: string; chars: number } {
  const parts: string[] = []
  let total = 0
  for (const file of files) {
    let diff = buildUnifiedDiff(file.path, file.before, file.after)
    if (!diff) continue
    if (diff.length > REVIEW_FILE_DIFF_CAP) {
      diff = `${diff.slice(0, REVIEW_FILE_DIFF_CAP)}\n…（该文件 diff 过长，已截断）`
    }
    if (total + diff.length > REVIEW_TOTAL_DIFF_CAP) {
      parts.push('…（其余文件 diff 超出总量上限，已省略）')
      break
    }
    parts.push(diff)
    total += diff.length
  }
  const text = parts.join('\n\n')
  return { text, chars: text.length }
}

/** 隔离上下文的审查提示词：只有 diff / 验收条件 / 项目类型 */
export function buildReviewMessages(input: IndependentReviewInput, diff: string): ChatMessage[] {
  const acceptance =
    input.acceptance.length > 0
      ? input.acceptance.map((a, i) => `${i + 1}. ${a}`).join('\n')
      : '（未提供验收条件：只审查 diff 本身的正确性、编译风险与破坏性改动）'
  return [
    {
      role: 'system',
      content:
        '你是独立代码审查者，与被审查的生成过程完全隔离。你只能看到统一 diff、验收条件、项目类型，' +
        '看不到生成者的计划、推理、工具轨迹或任何自述。\n' +
        '规则：\n' +
        '1. 只报告能从 diff 直接证实的问题；不要猜测未展示的文件内容。\n' +
        '2. severity=blocker：会导致验收失败（编译错误、逻辑错误、缺失注册/资源引用、破坏既有行为、安全问题）；' +
        'severity=warning：可改进但不阻断。\n' +
        '3. verdict=fail 当且仅当至少存在一个 blocker。\n' +
        '4. 每条问题必须给到文件路径与变更后行号（无法定位时 line 用 null）。\n' +
        '只输出一个 JSON 对象，禁止输出任何其他文字。'
    },
    {
      role: 'user',
      content:
        `项目类型：${input.projectType}\n\n` +
        `验收条件：\n${acceptance}\n\n` +
        `待审查变更（unified diff）：\n${diff}\n\n` +
        '只回复 JSON：\n' +
        '{"verdict":"pass"|"fail","summary":"一句中文结论",' +
        '"issues":[{"file":"相对路径","line":12,"severity":"blocker"|"warning","reason":"中文理由"}]}'
    }
  ]
}

function normalizeIssues(raw: unknown): ReviewIssue[] {
  if (!Array.isArray(raw)) return []
  const out: ReviewIssue[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    const file = typeof r['file'] === 'string' ? r['file'].slice(0, 300) : ''
    const reason = typeof r['reason'] === 'string' ? r['reason'].slice(0, 400) : ''
    if (!file || !reason) continue
    const lineRaw = r['line']
    const line =
      typeof lineRaw === 'number' && Number.isFinite(lineRaw) && lineRaw > 0
        ? Math.round(lineRaw)
        : null
    const severity = r['severity'] === 'blocker' ? 'blocker' : 'warning'
    out.push({ file, line, severity, reason })
  }
  return out
}

export interface ParsedReview {
  verdict: 'pass' | 'fail'
  summary: string
  issues: ReviewIssue[]
}

/** 从应答中提取 JSON（容忍围栏/前后杂言）；无法解析返回 null */
export function parseReviewReply(raw: string): ParsedReview | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(m[0])
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const r = parsed as Record<string, unknown>
  if (r['verdict'] !== 'pass' && r['verdict'] !== 'fail') return null
  return {
    verdict: r['verdict'],
    summary: typeof r['summary'] === 'string' ? r['summary'].slice(0, 500) : '',
    issues: normalizeIssues(r['issues'])
  }
}

function skipped(summary: string, files: number, chars: number): IndependentReviewOutcome {
  return { status: 'skipped', summary, issues: [], reviewedFiles: files, diffChars: chars }
}

/**
 * 执行独立审查。
 * 无变更 / 应答不可解析 → skipped；审查者明确 fail 且有 blocker → fail。
 */
export async function runIndependentReview(
  deps: IndependentReviewDeps,
  input: IndependentReviewInput
): Promise<IndependentReviewOutcome> {
  const { text: diff, chars } = buildReviewDiff(input.files)
  if (!diff) {
    return skipped('没有可审查的代码变更', 0, 0)
  }
  const reviewedFiles = input.files.filter((f) => buildUnifiedDiff(f.path, f.before, f.after)).length
  const raw = await deps.ask(buildReviewMessages(input, diff))
  const parsed = parseReviewReply(raw)
  if (!parsed) {
    deps.log?.('独立审查应答无法解析为约定 JSON，本次跳过（不阻断）')
    return skipped('审查模型未按约定 JSON 作答，无法解析审查结论', reviewedFiles, chars)
  }
  const blockers = parsed.issues.filter((i) => i.severity === 'blocker')
  if (parsed.verdict === 'fail' && blockers.length > 0) {
    return {
      status: 'fail',
      summary: parsed.summary || `独立审查发现 ${blockers.length} 个阻断问题`,
      issues: parsed.issues,
      reviewedFiles,
      diffChars: chars
    }
  }
  return {
    status: 'pass',
    summary: parsed.summary || '独立审查未发现阻断问题',
    issues: parsed.issues.filter((i) => i.severity === 'warning'),
    reviewedFiles,
    diffChars: chars
  }
}

/** 失败报告正文：问题清单（文件:行 + 理由），供 reply / artifact 展示 */
export function formatReviewIssues(issues: ReviewIssue[]): string {
  return issues
    .filter((i) => i.severity === 'blocker')
    .map((i) => `- \`${i.file}${i.line ? `:${i.line}` : ''}\` —— ${i.reason}`)
    .join('\n')
}
