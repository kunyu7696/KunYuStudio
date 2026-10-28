/**
 * P1 视觉自审（visualReview，方案 A）：test 阶段后对产出的模型资产做
 * 「离线三视图渲染 → 视觉模型硬门评审 → 不达标回写模型 JSON（≤3 轮）→ 耗尽回滚」闭环。
 *
 * 设计要点：
 * - 主证据为离线三视图（modelSnapshot：正/侧/等轴正交渲染，不依赖游戏在线）；
 *   观察通道在线时附第 4 张真机画面作辅证；
 * - 合格 = score≥82 ∧ 五项硬门全过 ∧ 数值指标无越界（三者缺一不可，
 *   「分数达标」只是必要非充分条件）；硬门由视觉模型逐项判定，一票否决；
 * - 数值指标（occupancy/clipping/contrast/edgeDensity）为客观护栏，越界即不达标；
 *   viewConsistency 仅参考（非对称设计不一票否决）；
 * - 失败契约：修正轮次耗尽仍不达标 → 如实报告 + 模型文件回滚到评审前状态，
 *   禁止使用「已完成」措辞（由 runOutcome/reply 的 fail 语义保证）；
 * - 全部副作用经 VisualReviewDeps 注入，单测可全 mock；
 * - 观察通道离线且离线渲染不可用 / 应答无法解析 → skipped 或 fail，均不阻塞主流水线。
 */
import type { AgentFileChange, VisualReviewGateResult, VisualReviewOutcome } from '../../../../shared/types/agent'
import type { ChatMessage } from '../../../../shared/types/ai'
import type { ModelSnapshotResult, SnapshotMetrics } from '../modelSnapshot'
import { computeSnapshotMetrics, metricViolations } from '../modelSnapshot'

export const VISUAL_REVIEW_MAX_ROUNDS = 3
export const VISUAL_REVIEW_PASS_SCORE = 82

/** 五项硬门（评审清单）：任一不过即一票否决 */
export const VISUAL_REVIEW_HARD_GATES = [
  ['identifiable', '身份可辨：一眼能认出目标物，不是一根扁平贴图杆'],
  ['proportionate', '比例协调：部件尺寸/位置无明显畸变失调'],
  ['noFloating', '无悬空漂浮件：所有部件与主体有可见连接'],
  ['noBlackFace', 'UV 无黑脸：可见面无纯黑或未映射区域'],
  ['textureBound', '贴图绑定正确：无品红/黑色 missing texture 块']
] as const

export type VisualReviewGateId = (typeof VISUAL_REVIEW_HARD_GATES)[number][0]

/** 一帧真机画面（data URL + 已落盘的本地路径，供 UI 展示） */
export interface VisualReviewShot {
  dataUrl: string
  savedPath: string
}

export interface VisualReviewDeps {
  /** 离线三视图渲染（主证据）；模型不可解析返回 null */
  snapshot: (modelAbsPath: string) => ModelSnapshotResult | null
  /** 抓一帧当前游戏画面（kunyu-observer 真机探针）；离线返回 null */
  capture: () => Promise<VisualReviewShot | null>
  /** 视觉模型提问（调用方已注入 provider/model；应答要求按 JSON 格式） */
  ask: (messages: ChatMessage[]) => Promise<string>
  /** 读取项目内模型 JSON；不存在返回 null */
  readFile: (absPath: string) => string | null
  /** 回写修正后的模型 JSON */
  writeFile: (absPath: string, content: string) => void
  /** 进度日志（可选，接到 run 事件流） */
  log?: (detail: string) => void
}

/** 项目内模型资产相对路径（POSIX 风格，content_upsert 导出或 LLM 直写） */
const MODEL_FILE_RE = /(^|\/)assets\/[^/]+\/models\/.+\.json$/

/** 从本轮文件变更中挑出已写盘的模型 JSON 相对路径（视觉自审对象） */
export function findModelAssetPaths(files: AgentFileChange[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of files) {
    if (!f.accepted) continue
    const p = f.path.replace(/\\/g, '/')
    if (!MODEL_FILE_RE.test(p) || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

interface ReviewAnswer {
  score: number
  feedback: string
  gates: VisualReviewGateResult[] | null
  fix?: { elements?: unknown; display?: unknown } | null
}

function normalizeGates(raw: unknown): VisualReviewGateResult[] | null {
  if (typeof raw !== 'object' || raw === null) return null
  const src = raw as Record<string, unknown>
  const out: VisualReviewGateResult[] = []
  for (const [id, label] of VISUAL_REVIEW_HARD_GATES) {
    const g = src[id]
    if (typeof g !== 'object' || g === null) return null
    const go = g as Record<string, unknown>
    if (typeof go['pass'] !== 'boolean') return null
    out.push({
      id,
      label,
      pass: go['pass'],
      note: typeof go['note'] === 'string' ? go['note'].slice(0, 120) : ''
    })
  }
  return out
}

/** 从视觉模型应答中提取 JSON（容忍围栏/前后杂言）；无法解析返回 null */
export function parseReviewAnswer(raw: string): ReviewAnswer | null {
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
  const scoreRaw = typeof r['score'] === 'number' ? r['score'] : Number.NaN
  if (!Number.isFinite(scoreRaw)) return null
  const score = Math.min(100, Math.max(0, Math.round(scoreRaw)))
  const feedback = typeof r['feedback'] === 'string' ? r['feedback'].slice(0, 500) : ''
  const gates = normalizeGates(r['gates'])
  const fixRaw = r['fix']
  const fix =
    typeof fixRaw === 'object' && fixRaw !== null
      ? (fixRaw as { elements?: unknown; display?: unknown })
      : null
  return { score, feedback, gates, fix }
}

/** cube 元素最小合法性：from/to 为 3 元素数字数组（允许 0..16 之外的轻微负值/超出，MC 支持 -16..32） */
function isValidElements(v: unknown): v is Array<Record<string, unknown>> {
  if (!Array.isArray(v) || v.length === 0 || v.length > 64) return false
  const isVec = (x: unknown): boolean =>
    Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === 'number' && Number.isFinite(n))
  return v.every(
    (el) =>
      typeof el === 'object' &&
      el !== null &&
      isVec((el as Record<string, unknown>)['from']) &&
      isVec((el as Record<string, unknown>)['to'])
  )
}

/**
 * 把视觉模型给出的 fix 合并进模型文件：elements 整体替换、display 浅合并。
 * 返回 true 表示已写盘；fix 不合法/文件不可读返回 false。
 */
export function applyModelFix(
  deps: Pick<VisualReviewDeps, 'readFile' | 'writeFile'>,
  absPath: string,
  fix: { elements?: unknown; display?: unknown }
): boolean {
  const current = deps.readFile(absPath)
  if (!current) return false
  let json: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(current)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
    json = parsed as Record<string, unknown>
  } catch {
    return false
  }
  let changed = false
  if (isValidElements(fix.elements)) {
    json['elements'] = fix.elements
    // 手写 elements 存在时 parent 链顶不得为 builtin/generated（隐形陷阱），直接移除 parent
    delete json['parent']
    changed = true
  }
  if (typeof fix.display === 'object' && fix.display !== null && !Array.isArray(fix.display)) {
    const prev =
      typeof json['display'] === 'object' && json['display'] !== null && !Array.isArray(json['display'])
        ? (json['display'] as Record<string, unknown>)
        : {}
    json['display'] = { ...prev, ...(fix.display as Record<string, unknown>) }
    changed = true
  }
  if (!changed) return false
  deps.writeFile(absPath, JSON.stringify(json, null, 2))
  return true
}

function metricsLine(metrics: SnapshotMetrics | null, violations: string[]): string {
  if (!metrics) return '数值指标：不可用（离线渲染失败，仅凭真机画面评审）'
  const v = violations.length > 0 ? violations.join('；') : '无'
  return (
    `数值指标：occupancy=${metrics.occupancy.toFixed(3)}（参考 0.14~0.70）、` +
    `clipping=${metrics.clipping.toFixed(3)}（≤0.08）、contrast=${metrics.contrast.toFixed(3)}（≥0.20）、` +
    `edgeDensity=${metrics.edgeDensity.toFixed(4)}（≥0.015）、` +
    `viewConsistency=${metrics.viewConsistency.toFixed(3)}（仅参考）\n指标越界：${v}`
  )
}

function buildReviewMessages(
  goal: string,
  images: { dataUrl: string; label: string }[],
  targetHint: string,
  metrics: SnapshotMetrics | null,
  violations: string[]
): ChatMessage[] {
  const imageDesc = images.map((im, i) => `第${i + 1}张=${im.label}`).join('、')
  return [
    {
      role: 'system',
      content:
        '你是 Minecraft 模组视觉评审。输入为自定义 3D 物品/方块模型的离线三视图渲染图' +
        '（正/侧/等轴，面为贴图平均色填充）；若附真机游戏画面则作辅证。' +
        '按五项硬门逐项判定（任何一项不过即整体不合格，不受总分豁免）：\n' +
        VISUAL_REVIEW_HARD_GATES.map(([id, label], i) => `${i + 1}. ${id} — ${label}`).join('\n') +
        '\n只输出一个 JSON 对象，禁止输出任何其他文字。'
    },
    {
      role: 'user',
      content:
        `目标物：${goal}\n评审对象模型文件：${targetHint}\n图片顺序：${imageDesc}\n` +
        `${metricsLine(metrics, violations)}\n` +
        '请评审并只回复 JSON：\n' +
        '{"score":0-100,"feedback":"中文一句诊断",' +
        '"gates":{"identifiable":{"pass":true|false,"note":"…"},"proportionate":{...},"noFloating":{...},"noBlackFace":{...},"textureBound":{...}},' +
        '"fix":{...}?}\n' +
        `合格条件：score≥${VISUAL_REVIEW_PASS_SCORE} 且五项硬门全部 pass 且无指标越界（缺一不可）。` +
        '合格时 fix 省略；不合格时 fix 给出修正：{"elements":[{"name":"...","from":[x,y,z],"to":[x,y,z]}...],"display":{...}}，' +
        '坐标系 0..16、y+ 向上，rotation 仅单轴且为 22.5 的倍数。',
      images: images.map((im) => im.dataUrl)
    }
  ]
}

function skippedOutcome(feedback: string): VisualReviewOutcome {
  return { status: 'skipped', score: null, feedback, rounds: 0, screenshotPath: null }
}

/**
 * 执行视觉自审闭环。
 * @param modelPaths 待评审模型文件绝对路径（取首个作为回写目标）
 * @param goal 用户目标描述（评审提示词上下文）
 */
export async function runVisualReview(
  deps: VisualReviewDeps,
  modelPaths: string[],
  goal: string
): Promise<VisualReviewOutcome> {
  const target = modelPaths[0]
  const targetHint = modelPaths.join('、')
  if (!target) {
    return skippedOutcome('本轮没有产出模型资产，无需视觉自审')
  }

  /* 评审前留底：失败契约的回滚基线 */
  const baseline = deps.readFile(target)

  let snapshot = deps.snapshot(target)
  let live = await deps.capture()
  if (!snapshot && !live) {
    return skippedOutcome('离线渲染不可用且游戏观察通道离线（kunyu-observer 不可用），视觉自审跳过')
  }
  if (snapshot && snapshot.warnings.length > 0) {
    for (const w of snapshot.warnings) deps.log?.(`三视图渲染告警：${w}`)
  }

  const evidence: 'offline' | 'live' | 'mixed' = snapshot ? (live ? 'mixed' : 'offline') : 'live'
  let dirty = false
  let lastScreenshot: string | null = live?.savedPath ?? null

  for (let round = 0; round <= VISUAL_REVIEW_MAX_ROUNDS; round++) {
    const metrics = snapshot ? computeSnapshotMetrics(snapshot.views) : null
    const violations = metrics ? metricViolations(metrics) : []
    const images: { dataUrl: string; label: string }[] = snapshot
      ? snapshot.views.map((v) => ({ dataUrl: v.dataUrl, label: `${v.view} 视图` }))
      : []
    if (live) images.push({ dataUrl: live.dataUrl, label: '真机画面（辅证）' })

    const raw = await deps.ask(buildReviewMessages(goal, images, targetHint, metrics, violations))
    const answer = parseReviewAnswer(raw)
    if (!answer) {
      return {
        status: 'fail',
        score: null,
        feedback: '视觉模型未按约定 JSON 作答，无法解析评审结果',
        rounds: round,
        screenshotPath: lastScreenshot,
        gates: null,
        metrics,
        metricViolations: violations,
        rolledBack: rollback(deps, target, baseline, dirty),
        evidence
      }
    }

    /* 硬门缺失（旧格式应答/漏判）按不过处理：保守判失败并要求模型逐门给结论 */
    const gates =
      answer.gates ??
      VISUAL_REVIEW_HARD_GATES.map(([id, label]) => ({
        id,
        label,
        pass: false,
        note: '评审未给出该门结论'
      }))
    const failedGates = gates.filter((g) => !g.pass)
    const gateSummary = failedGates.length === 0 ? '硬门全过' : `硬门未过：${failedGates.map((g) => g.id).join('、')}`
    deps.log?.(
      `视觉自审第 ${round + 1} 评：${answer.score}/100，${gateSummary}` +
        `${violations.length > 0 ? `，指标越界 ${violations.length} 项` : ''}` +
        `${answer.feedback ? ` —— ${answer.feedback}` : ''}`
    )

    const pass = answer.score >= VISUAL_REVIEW_PASS_SCORE && failedGates.length === 0 && violations.length === 0
    if (pass) {
      return {
        status: 'pass',
        score: answer.score,
        feedback: answer.feedback,
        rounds: round,
        screenshotPath: lastScreenshot,
        gates,
        metrics,
        metricViolations: [],
        rolledBack: false,
        evidence
      }
    }

    /* 不达标原因如实汇总（供失败报告与最终反馈） */
    const reasons: string[] = []
    if (answer.score < VISUAL_REVIEW_PASS_SCORE) reasons.push(`评分 ${answer.score} 未达 ${VISUAL_REVIEW_PASS_SCORE}`)
    for (const g of failedGates) reasons.push(`硬门「${g.id}」未过${g.note ? `：${g.note}` : ''}`)
    for (const vio of violations) reasons.push(`指标越界：${vio}`)
    const reasonText = reasons.join('；')

    /* 修正预算内且有 fix → 回写重渲染复评；否则进入失败契约 */
    const canFix = round < VISUAL_REVIEW_MAX_ROUNDS && answer.fix && (answer.fix.elements || answer.fix.display)
    if (canFix && answer.fix) {
      const written = applyModelFix(deps, target, answer.fix)
      if (written) {
        dirty = true
        deps.log?.(`已按视觉反馈回写模型坐标/display：${target}`)
        snapshot = deps.snapshot(target) ?? snapshot
        live = (await deps.capture()) ?? live
        lastScreenshot = live?.savedPath ?? lastScreenshot
        continue
      }
      deps.log?.('视觉反馈中的 fix 不合法（elements/display 校验失败），放弃回写')
    }

    /* 失败契约：轮次耗尽/无可修方案 → 如实报告 + 回滚模型文件 */
    const rolledBack = rollback(deps, target, baseline, dirty)
    return {
      status: 'fail',
      score: answer.score,
      feedback:
        `${answer.feedback ? `${answer.feedback}。` : ''}未达标原因：${reasonText}` +
        (rolledBack ? '。模型文件已回滚到评审前状态' : ''),
      rounds: round,
      screenshotPath: lastScreenshot,
      gates,
      metrics,
      metricViolations: violations,
      rolledBack,
      evidence
    }
  }
  /* 理论不可达（loop 内必返回），防御性兜底 */
  const rolledBack = rollback(deps, target, baseline, dirty)
  return {
    status: 'fail',
    score: null,
    feedback: '视觉自审轮次耗尽',
    rounds: VISUAL_REVIEW_MAX_ROUNDS,
    screenshotPath: lastScreenshot,
    gates: null,
    metrics: null,
    metricViolations: [],
    rolledBack,
    evidence
  }
}

/** 失败契约回滚：仅当评审期间实际写过模型文件才回滚；回滚动作进日志 */
function rollback(
  deps: VisualReviewDeps,
  target: string,
  baseline: string | null,
  dirty: boolean
): boolean {
  if (!dirty || baseline === null) return false
  deps.writeFile(target, baseline)
  deps.log?.(`视觉自审未达标，模型文件已回滚到评审前状态：${target}`)
  return true
}
