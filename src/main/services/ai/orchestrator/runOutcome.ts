/**
 * RunOutcome：流水线收口处汇总运行结论的单一事实源。
 *
 * 原则：
 * - 标题、状态、历史一律由 RunOutcome 派生，绝不再拼接模型自述的 plan.goal；
 * - 构建真实成败、实际落盘文件（含语义资产生成路径）、测试、导出全部可溯源；
 * - composeReply 只做格式化，不做任何推断。
 */
import type {
  AcceptanceContract,
  AgentFileChange,
  BuildConclusion,
  ExportOutcome,
  RunCheck,
  RunOutcome,
  TestOutcome,
  VisualReviewOutcome
} from '../../../../shared/types/agent'

export interface DeriveOutcomeInput {
  files: AgentFileChange[]
  assetSaves: number
  build: BuildConclusion | null
  test: TestOutcome | null
  visualReview: VisualReviewOutcome | null
  export: ExportOutcome | null
  contract: AcceptanceContract | null
  /** 计划承诺但项目中实际缺失的内容类型（完整性核对） */
  missingContentTypes: string[]
  /**
   * P2：generate 阶段上报的静态缺口（缺 Java 类 / 缺贴图 / 被闸门拒收的文件）。
   * 非空时不得冒充成功——verdict 封顶 partial、gaps 显式列出、runStatus 落 failed 开放续跑；
   * 这是「静态缺口硬门」退场后的替代防线（原先硬门直接清空 files 判失败，整份成果作废）。
   */
  generateGaps?: string[]
  /**
   * 计划含 generate 阶段（理应产出验收契约）——P0-5。
   * 为 true 且 contract 为 null 时（LLM 未回契约 / 输出非法被静默降级）：
   * 零验收依据，绿灯不可信——verdict 封顶 partial 并落 failed（可续跑重新产出契约）。
   * verify 类 run 不含 generate 阶段，传 false 不受此约束。
   */
  contractExpected: boolean
}

export function deriveRunOutcome(input: DeriveOutcomeInput): RunOutcome {
  const {
    files,
    assetSaves,
    build,
    test,
    visualReview,
    export: exportOutcome,
    contract,
    missingContentTypes,
    generateGaps = [],
    contractExpected
  } = input

  const filesWritten = files.filter((f) => f.accepted).length
  const filesRejected = files.filter((f) => !f.accepted).length
  const hasAnyOutput = filesWritten > 0 || assetSaves > 0
  const hasCodeOutput = assetSaves > 0 || files.some((f) => f.accepted && f.path.endsWith('.java'))

  // 验收缺口：构建通过、有产出，但若承诺类型缺失 / 游戏测试失败 /
  // 契约断言失败，仍不能判完全成功
  const testFailed = test?.status === 'connected-fail' || test?.status === 'gametest-fail'
  const failedAssertions = contract
    ? contract.assertions.filter((a: { status: string }) => a.status === 'fail' || a.status === 'failed')
    : []
  // P0-5：拆开两类「非失败」断言——
  // awaiting-user（人工确认项，设计上不可能自动判定）：语义不变，可落 completed；
  // pending/skipped/unverified（压根没评估过）：不得 completed——进 gaps 落 failed 并开放续跑复验。
  const awaitingUserAssertions = contract
    ? contract.assertions.filter((a: { status: string }) => a.status === 'awaiting-user')
    : []
  const unassessedAssertions = contract
    ? contract.assertions.filter((a: { status: string }) =>
        ['pending', 'skipped', 'unverified'].includes(a.status)
      )
    : []
  const unresolvedAssertions = [...awaitingUserAssertions, ...unassessedAssertions]
  // P0-5：计划含 generate 却拿到 null 契约（LLM 未回/输出非法被静默降级）——
  // 零验收依据，绿灯不可信：封顶 partial 并落 failed（续跑重新产出契约）
  const contractMissing = contractExpected && contract === null
  // P0-b：构建/验证因环境阻塞未能执行——工具链未就绪 / 矩阵未激活 /
  // Gradle 互斥 / 启动失败 / 外部中断。这些不是内容本身的失败。
  const environmentBlocked = build?.blockedByEnvironment === true
  // 真实失败信号（与运行环境无关、指向内容本身）：任一成立都不得以「无法判定」掩盖。
  const hasRealFailure =
    missingContentTypes.length > 0 ||
    generateGaps.length > 0 ||
    testFailed ||
    visualReview?.status === 'fail' ||
    failedAssertions.length > 0 ||
    contractMissing
  const gaps: string[] = []
  if (missingContentTypes.length > 0) gaps.push(`承诺的 ${missingContentTypes.join('、')} 未交付`)
  // P2：静态缺口逐条列出（缺 Java 类 / 缺贴图 / 被闸门拒收的文件），
  // 让用户知道「已落盘了什么、还差什么」——不再是整份作废后只剩一句「生成失败」
  for (const gap of generateGaps) gaps.push(gap)
  if (testFailed) gaps.push('游戏测试未通过')
  if (visualReview?.status === 'fail') gaps.push('视觉自审未通过')
  if (failedAssertions.length > 0) gaps.push(`${failedAssertions.length} 项验收断言未通过`)
  if (unassessedAssertions.length > 0)
    gaps.push(`${unassessedAssertions.length} 项验收断言未评估（需续跑验证）`)
  if (contractMissing) gaps.push('验收契约未产出，无法自动验收')

  // verdict 判定：构建结论优先于产出判定（构建失败但产出了文件 = partial）
  const buildFailed = build?.status === 'fail'
  const buildPassed = build?.status === 'pass'
  let verdict: RunOutcome['verdict']
  if (buildFailed) {
    verdict = hasAnyOutput ? 'partial' : 'failed'
  } else if (buildPassed) {
    // 构建过但零产出=假绿灯；有产出但存在验收缺口=partial（不冒充成功）；
    // 未评估断言/契约缺失进 gaps 封顶 partial 且落 failed（P0-5）；
    // 纯待人工确认项同样封顶 partial，但不作为失败落库
    verdict = !hasAnyOutput
      ? 'failed'
      : gaps.length > 0 || unresolvedAssertions.length > 0
        ? 'partial'
        : 'success'
  } else {
    // 构建未触发/跳过
    if (environmentBlocked && !hasRealFailure) {
      // P0-b：环境阻塞且无真实失败信号 → 本次判定无效（不冒充失败，也不冒充完成）
      verdict = 'inconclusive'
    } else {
      verdict = hasAnyOutput ? 'partial' : 'failed'
    }
  }

  // headline：一句话中文结论，替代 plan.goal
  let headline: string
  if (verdict === 'success') {
    const parts: string[] = []
    if (filesWritten > 0) parts.push(`${filesWritten} 个文件`)
    if (assetSaves > 0) parts.push(`${assetSaves} 个语义资产`)
    headline = `已产出 ${parts.join(' + ')}，构建通过`
  } else if (verdict === 'partial') {
    if (buildFailed) {
      headline = `已产出但构建失败（${build!.summary}）`
    } else if (buildPassed && gaps.length > 0) {
      headline = `构建通过但验收未达标：${gaps.join('；')}`
    } else if (buildPassed && awaitingUserAssertions.length > 0) {
      // 走到这里必然 gaps 为空（unassessed/契约缺失都进了 gaps）——纯 awaiting-user 场景
      headline =
        `构建通过；${awaitingUserAssertions.length} 项验收断言待人工确认` +
        '（非失败，确认后即为完成）'
    } else if (hasAnyOutput) {
      headline = '已产出内容，但构建未触发或跳过'
    } else {
      headline = '构建未触发，且无产出'
    }
  } else if (verdict === 'inconclusive') {
    // P0-b：显式「无法判定」——点明环境阻塞原因，提示修复后可重试
    headline = `无法判定：${
      build?.summary ?? '环境/工具链阻塞，本次验收结论无效（修复环境后可重试）'
    }`
  } else {
    headline = buildFailed ? `构建失败：${build!.summary}` : '本轮无产出'
  }

  // runStatus（P0-B）：落库状态由 verdict 派生，只有 success 才是绿灯；
  // 例外：构建通过、无真实验收失败、gaps 为空（gaps 已含「未评估断言」「契约缺失」，
  // 两者必然落 failed 开放续跑），仅卡在待人工确认项的 partial——
  // 落 completed（无需续跑，点"继续"不会从 understand 重跑烧额度）
  const runStatus: RunOutcome['runStatus'] =
    verdict === 'inconclusive'
      ? 'inconclusive'
      : verdict === 'success' || (buildPassed && failedAssertions.length === 0 && gaps.length === 0)
        ? 'completed'
        : 'failed'

  // -------------------------------------------------------------------------
  // 三态验收面板：逐项维度标 verified/inconclusive/failed。
  // 未验证（inconclusive）不计入已验证——面板让「哪些有实证、哪些没有」一目了然。
  // -------------------------------------------------------------------------
  const checks: RunCheck[] = []

  // 内容产出：有落盘=已验证；零产出=失败（与 verdict 的假绿灯拦截对齐）
  const outParts: string[] = []
  if (filesWritten > 0) outParts.push(`${filesWritten} 个文件`)
  if (assetSaves > 0) outParts.push(`${assetSaves} 个语义资产`)
  checks.push({
    id: 'output',
    label: '内容产出',
    state: hasAnyOutput ? 'verified' : 'failed',
    evidence: hasAnyOutput ? `${outParts.join(' + ')} 已落盘` : '本轮无产出'
  })

  // 构建：pass=已验证；fail=失败；skipped/未触发=未验证（含环境阻塞）
  checks.push({
    id: 'build',
    label: 'Gradle 构建',
    state:
      build?.status === 'pass' ? 'verified' : build?.status === 'fail' ? 'failed' : 'inconclusive',
    evidence: build ? build.summary : '未触发'
  })

  // 游戏测试：通过=已验证；失败=失败；skipped/未触发=未验证
  const testPassed = test?.status === 'gametest-ok' || test?.status === 'connected-ok'
  checks.push({
    id: 'test',
    label: '游戏测试',
    state: testPassed ? 'verified' : testFailed ? 'failed' : 'inconclusive',
    evidence: test ? test.summary : '未触发'
  })

  // 视觉自审：仅触发过才列入（无视觉内容的 run 不算「未验证」）
  if (visualReview) {
    checks.push({
      id: 'visual',
      label: '视觉自审',
      state:
        visualReview.status === 'pass'
          ? 'verified'
          : visualReview.status === 'fail'
            ? 'failed'
            : 'inconclusive',
      evidence:
        visualReview.status === 'skipped'
          ? visualReview.feedback
          : `评分 ${visualReview.score ?? '-'}/100`
    })
  }

  // 导出：仅触发过才列入；skipped=未验证（产物未远端/本地落出不代表内容失败）
  if (exportOutcome) {
    checks.push({
      id: 'export',
      label: '导出',
      state: exportOutcome.status === 'ok' ? 'verified' : 'inconclusive',
      evidence: exportOutcome.summary
    })
  }

  // 验收契约：任一断言失败=失败；有未评估/待人工项=未验证；全过=已验证。
  // 契约缺失但计划要求产出（contractExpected）=未验证（零验收依据，绿灯不可信）。
  if (contract) {
    const contractEvidence =
      contract.summary +
      (unassessedAssertions.length > 0
        ? `（${unassessedAssertions.length} 项未评估）`
        : awaitingUserAssertions.length > 0
          ? `（${awaitingUserAssertions.length} 项待人工确认）`
          : '')
    checks.push({
      id: 'contract',
      label: '验收契约',
      state:
        failedAssertions.length > 0
          ? 'failed'
          : unresolvedAssertions.length > 0
            ? 'inconclusive'
            : 'verified',
      evidence: contractEvidence
    })
  } else if (contractExpected) {
    checks.push({
      id: 'contract',
      label: '验收契约',
      state: 'inconclusive',
      evidence: '契约未产出，无法自动验收'
    })
  }

  // 承诺内容类型缺失 / generate 静态缺口：明确失败项，显式上面板
  if (missingContentTypes.length > 0) {
    checks.push({
      id: 'promised-types',
      label: '承诺内容类型',
      state: 'failed',
      evidence: `${missingContentTypes.join('、')} 未交付`
    })
  }
  if (generateGaps.length > 0) {
    checks.push({
      id: 'generate-gaps',
      label: '生成缺口',
      state: 'failed',
      evidence: `${generateGaps.length} 项未闭环（详见下方缺口清单）`
    })
  }

  return {
    build,
    test,
    visualReview,
    export: exportOutcome,
    contract,
    filesWritten,
    filesRejected,
    assetSaves,
    hasAnyOutput,
    hasCodeOutput,
    verdict,
    runStatus,
    headline,
    gaps,
    checks
  }
}
