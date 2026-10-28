import type {
  AcceptanceContract,
  AgentFileChange,
  AgentPlan,
  AgentRunRequest,
  BuildConclusion,
  ExportOutcome,
  TestOutcome,
  VisualReviewOutcome
} from '../../../../shared/types/agent'
import { TIER_CONFIGS, type TierId } from '../../../../shared/types/tiers'
import type { ResolvedProject } from './types'
import { intentLabel } from './prompts'
import { deriveRunOutcome } from './runOutcome'

export function composeReply(input: {
  request: AgentRunRequest
  plan: AgentPlan
  tier: TierId
  tierMatched: string[]
  project: ResolvedProject | null
  files: AgentFileChange[]
  /** 语义资产落盘数（content_upsert / texture_paint 等，由 generatePipeline 统计） */
  assetSaves?: number
  build: BuildConclusion | null
  test: TestOutcome | null
  /** P1 真机视觉自审结论（未触发为 null/undefined） */
  visualReview?: VisualReviewOutcome | null
  export: ExportOutcome | null
  contract: AcceptanceContract | null
  /**
   * 验收门禁：计划承诺的内容类型中未落盘语义资产的清单。
   * 非空时 verdict 降级为 partial，并在 gaps 显式列出缺口。
   */
  missingContentTypes?: string[]
  /**
   * P2：generate 上报的静态缺口（缺 Java 类 / 缺贴图 / 被拒文件）。
   * 非空时 verdict 封顶 partial 且 gaps 逐条列出（不再清空成果只剩一句失败）。
   */
  generateGaps?: string[]
  notes: string
}): string {
  const { plan, tier, project, files, build, test, visualReview, export: exportOutcome, contract } = input
  const tierCfg = TIER_CONFIGS[tier]

  // RunOutcome 单一事实源：标题、状态、结论一律由它派生
  const outcome = deriveRunOutcome({
    files,
    assetSaves: input.assetSaves ?? 0,
    build,
    test: test ?? null,
    visualReview: visualReview ?? null,
    export: exportOutcome,
    contract,
    missingContentTypes: input.missingContentTypes ?? [],
    generateGaps: input.generateGaps ?? [],
    contractExpected: plan.stages.includes('generate')
  })

  const lines: string[] = []
  // 标题 = intentLabel + 真实结论（headline），不再拼接 plan.goal
  const verdictIcon =
    outcome.verdict === 'success'
      ? '✅'
      : outcome.verdict === 'partial'
        ? '⚠️'
        : outcome.verdict === 'inconclusive'
          ? '❔'
          : '❌'
  const verdictLabel =
    outcome.verdict === 'success'
      ? '完成'
      : outcome.verdict === 'partial'
        ? '部分完成'
        : outcome.verdict === 'inconclusive'
          ? '无法判定'
          : '未完成'
  lines.push(
    `${verdictIcon} **${intentLabel(plan.intent)}${verdictLabel}**（${tierCfg.name}档） —— ${outcome.headline}`
  )
  if (input.tierMatched.length > 0) {
    lines.push(`档位路由：命中关键词「${input.tierMatched.join('、')}」→ ${tierCfg.name}（${tierCfg.title}）`)
  }

  // 文件变更章节：按真实落盘数展示，不再依赖"哪个数组恰好有值"
  const accepted = files.filter((f) => f.accepted)
  const rejected = files.filter((f) => !f.accepted)
  const assetSaves = input.assetSaves ?? 0
  if (outcome.hasAnyOutput || outcome.filesRejected > 0) {
    if (project) {
      const parts: string[] = []
      if (accepted.length > 0) parts.push(`${accepted.length} 个文件`)
      if (assetSaves > 0) parts.push(`${assetSaves} 个语义资产`)
      lines.push(
        `\n文件变更：${parts.join(' + ')} 已写入项目 \`${project.name}\`` +
          (rejected.length > 0 ? `，${rejected.length} 个被拒绝` : '') +
          '。'
      )
    } else {
      lines.push(`\n当前没有打开项目，下面 ${files.length} 个文件仅为代码片段，未写盘。`)
    }
    for (const f of files) {
      lines.push(`- ${f.accepted ? '✅' : '⚠️'} \`${f.path}\`${f.reason ? `（${f.reason}）` : ''}`)
    }
    if (input.notes) lines.push(`\n${input.notes}`)
  } else if (project && (plan.intent === 'code' || plan.intent === 'fix')) {
    // 反幻觉兜底：零产出时显式标注
    lines.push('\n⚠️ 文件变更：无（本轮没有生成任何文件或资产）。')
  }

  if (build) {
    // P0-b：环境阻塞的「跳过」用 ❔ 区别于普通 ⚪（明确「没跑成」而非「没内容可跑」）
    const icon =
      build.status === 'pass'
        ? '🟢'
        : build.status === 'fail'
          ? '🔴'
          : build.blockedByEnvironment
            ? '❔'
            : '⚪'
    lines.push(`\n${icon} 真实 Gradle 构建：${build.summary}`)
    if (build.matchedPatternIds.length > 0) {
      lines.push(`命中错误模式：${build.matchedPatternIds.join(', ')}`)
    }
  }

  if (test) {
    if (test.status === 'gametest-ok') {
      lines.push(`\n🧪 无头测试通过：${test.summary}`)
    } else if (test.status === 'gametest-fail') {
      lines.push(`\n🧪 无头测试失败：${test.summary}`)
    } else if (test.status === 'connected-ok') {
      lines.push(`\n🎮 游戏内省通过：${test.summary}`)
    } else if (test.status === 'connected-fail') {
      lines.push(`\n⚠️ 游戏内省失败：${test.summary}`)
    } else {
      lines.push(`\n⚪ 游戏测试跳过：${test.summary}`)
    }
  }

  if (visualReview) {
    const gateFail = visualReview.gates?.filter((g) => !g.pass) ?? []
    const gateText = visualReview.gates
      ? `，硬门 ${visualReview.gates.length - gateFail.length}/${visualReview.gates.length}`
      : ''
    if (visualReview.status === 'pass') {
      lines.push(`\n👁️ 视觉自审通过：${visualReview.score}/100（回写 ${visualReview.rounds} 轮${gateText}）${visualReview.feedback ? ` —— ${visualReview.feedback}` : ''}`)
    } else if (visualReview.status === 'fail') {
      const failDetail = gateFail.length > 0 ? `，未过：${gateFail.map((g) => g.id).join('、')}` : ''
      const rb = visualReview.rolledBack ? '，模型已回滚' : ''
      lines.push(`\n👁️ 视觉自审未达标：${visualReview.score ?? '-'}/100（回写 ${visualReview.rounds} 轮${gateText}${failDetail}${rb}）${visualReview.feedback ? ` —— ${visualReview.feedback}` : ''}`)
    } else {
      lines.push(`\n⚪ 视觉自审跳过：${visualReview.feedback}`)
    }
  }

  if (exportOutcome) {
    if (exportOutcome.status === 'ok' && exportOutcome.artifacts.length > 0) {
      lines.push(`\n📦 ${exportOutcome.summary}`)
    } else if (exportOutcome.status === 'skipped' && exportOutcome.artifacts.length === 0) {
      lines.push(`\n📦 导出：${exportOutcome.summary}`)
    }
  }

  if (contract) {
    const icon =
      contract.overall === 'pass' || contract.overall === 'verified'
        ? '✅'
        : contract.overall === 'fail' || contract.overall === 'failed'
          ? '❌'
          : contract.overall === 'skipped' || contract.overall === 'unverified'
            ? '⚪'
            : '⏳'
    lines.push(`\n${icon} 验收契约：${contract.summary}`)
    for (const a of contract.assertions) {
      const aIcon =
        a.status === 'pass' || a.status === 'verified'
          ? '✅'
          : a.status === 'fail' || a.status === 'failed'
            ? '❌'
            : a.status === 'skipped' || a.status === 'unverified'
              ? '⚪'
              : '⏳'
      const kindLabel =
        a.kind === 'file-exists'
          ? '文件就位'
          : a.kind === 'texture-ready'
            ? '贴图就位'
            : a.kind === 'registry-entry'
              ? '注册条目'
              : a.kind === 'runtime-world'
                ? '真机方块'
                : a.kind === 'runtime-inventory'
                  ? '真机背包'
                  : a.kind === 'gametest-runtime'
                    ? '无头测试'
                    : a.kind === 'user-confirmation'
                      ? '人工确认'
                      : '构建通过'
      const tail =
        (a.status === 'fail' || a.status === 'failed') && a.reason
          ? `（${a.reason}）`
          : a.actual
            ? `（${a.actual}）`
            : ''
      lines.push(`- ${aIcon} ${kindLabel}：${a.description}${tail}`)
    }
  }

  // 三态验收：会话结束的显式面板——已验证/未验证/失败逐项列出。
  // 未验证（inconclusive）项没有实证支撑，不计入已验证；让「差什么证据」一目了然。
  const verifiedCount = outcome.checks.filter((c) => c.state === 'verified').length
  const inconclusiveCount = outcome.checks.filter((c) => c.state === 'inconclusive').length
  const failedCount = outcome.checks.filter((c) => c.state === 'failed').length
  lines.push(
    `\n📋 验收面板：${verifiedCount} 项已验证 · ${inconclusiveCount} 项未验证 · ${failedCount} 项失败`
  )
  for (const c of outcome.checks) {
    const icon = c.state === 'verified' ? '✅' : c.state === 'failed' ? '❌' : '⚪'
    lines.push(`- ${icon} ${c.label}${c.evidence ? `：${c.evidence}` : ''}`)
  }
  if (inconclusiveCount > 0) {
    lines.push('⚪ 未验证项无实证支撑，不计入已验证——补齐验证后方可视为交付。')
  }

  // P2：未闭环缺口逐条列出（静态缺口 / 承诺类型缺失 / 断言失败 / 测试未过）——
  // 无论构建成败都显式呈现「差什么」，避免只留一句结论让用户无从下手
  if (outcome.gaps.length > 0 && outcome.verdict !== 'success') {
    lines.push('\n⚠️ 未闭环缺口（本次不以成功收口）：')
    for (const gap of outcome.gaps) lines.push(`- ${gap}`)
    if (outcome.runStatus === 'failed') {
      lines.push('修复后回复「继续」可从本次断点续跑补齐缺口。')
    }
  }

  return lines.join('\n')
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

export function clipTail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max)
}
