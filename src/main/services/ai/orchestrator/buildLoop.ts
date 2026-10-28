// ---------------------------------------------------------------------------
// build 治愈循环（真实 Gradle，轮次按档位：7/14/不限→HARD_CAP 30）
// ---------------------------------------------------------------------------
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import type { AgentFileChange, BuildConclusion } from '../../../../shared/types/agent'
import { TIER_CONFIGS } from '../../../../shared/types/tiers'
import type { GradleRunInput } from '../../../../shared/types/build'
import type { LoaderId } from '../../../../shared/types/aiReference'
import type { ReferenceService } from '../referencePackageService'
import { gatePaused, BudgetExceededError, type BuildLoopInput, type ResolvedProject } from './types'
import { mergeFileChanges } from './planParse'
import { clipTail } from './reply'
import { buildArtifact } from './exportStage'
import {
  classifyBuildFailure,
  isSameFailure,
  type BuildFailureClassification
} from './buildFailureLayers'

const LOG_TAIL_CHARS = 256 * 1024

export async function runBuildLoop(input: BuildLoopInput): Promise<BuildConclusion> {
  const { runId, state, request, project, ctx, emit, javaHome, waitForGradleDone } = input
  const tierCfg = TIER_CONFIGS[input.tier]
  // maxBuildRounds 语义为「构建失败后允许的自动修复轮次」（迅工 0 = 只构建一次直出），
  // 因此总构建尝试次数 = 修复预算 + 1（首次构建）
  const maxFixRounds = tierCfg.maxBuildRounds
  const maxRounds = maxFixRounds + 1
  let round = 0
  let matchedIds: string[] = []
  let logBuffer = ''
  let lastFiles = input.files
  let lastRoundYielded = true
  let lastExitCode: number | null = null
  // 末轮失败层级分类（预算耗尽收口时随结论落库）
  let lastClassification: BuildFailureClassification | null = null
  // 假设-证伪纪律：上一轮分类 + 修复轨迹（同层重现即判定上一假设已证伪）
  let prevClassification: BuildFailureClassification | null = null
  const repairTrace: string[] = []

  while (round < maxRounds) {
    await gatePaused(state)
    if (state.canceled) {
      return {
        status: 'skipped',
        rounds: round,
        summary: '构建已被用户取消。',
        matchedPatternIds: []
      }
    }
    round += 1
    logBuffer = ''
    let lastEmitTs = 0
    let lastLine = ''

    const gradleInput: GradleRunInput = {
      root: project.path,
      tasks: ['clean', 'build'],
      javaHome,
      timeoutMs: 30 * 60 * 1000
    }

    emit('build', {
      type: 'phase',
      phase: 'running',
      action:
        round === 1
          ? maxFixRounds === 0
            ? `第 1 轮：执行真实 Gradle clean build（${tierCfg.name}档直出，构建失败不自动回炉）…`
            : `第 1 轮：执行真实 Gradle clean build（${tierCfg.name}档，最多 ${maxFixRounds} 轮自动修复）…`
          : `第 ${round} 轮：应用修复后重新构建…`
    })

    let gradleRunId: string
    try {
      gradleRunId = input.runGradle(gradleInput, (event) => {
        if (event.type === 'output') {
          logBuffer = clipTail(logBuffer + event.text, LOG_TAIL_CHARS)
          const lines = event.text.split(/\r?\n/)
          lastLine = (lines.filter((l) => l.trim())[0] ?? lastLine).slice(0, 200)
          const ts = Date.now()
          if (
            ts - lastEmitTs > 1500 ||
            /(> Task |BUILD|error:|FAILURE:|警告|warning:)/i.test(event.text)
          ) {
            lastEmitTs = ts
            emit('build', { type: 'log', detail: lastLine })
          }
        }
      })
    } catch (err) {
      // 预算熔断：原样上抛，不能按「环境问题跳过」吞掉
      if (err instanceof BudgetExceededError) throw err
      const conclusion: BuildConclusion = {
        status: 'skipped',
        rounds: round - 1,
        summary: `Gradle 启动失败（环境问题，不计编译失败）：${(err as Error).message}`,
        matchedPatternIds: [],
        // 环境阻塞——工具链未就绪导致本次构建无法执行，不计内容失败
        blockedByEnvironment: true
      }
      emit('build', {
        type: 'phase',
        phase: 'skipped',
        action: conclusion.summary,
        artifact: buildArtifact(`${runId}-build`, conclusion)
      })
      return conclusion
    }

    state.gradleRunId = gradleRunId
    // 等待 done 事件带 watchdog——外层超时比 Gradle 侧 timeoutMs
    // 多 90s 宽限（daemon 收尾 / 事件投递延迟，同 recheckAssertion A-03 范式）。
    // done 事件因 daemon 崩溃等丢失时按超时收口，不再永久挂起。
    const done = await waitForGradleDone(
      gradleRunId,
      (gradleInput.timeoutMs ?? 30 * 60 * 1000) + 90_000
    )
    state.gradleRunId = null
    lastExitCode = done.exitCode
    if (state.canceled) {
      return {
        status: 'skipped',
        rounds: round - 1,
        summary: '构建已被用户取消。',
        matchedPatternIds: []
      }
    }

    if (done.exitCode === 0 && !done.cancelled && !done.timedOut) {
      const conclusion: BuildConclusion = {
        status: 'pass',
        rounds: round,
        summary:
          round === 1
            ? '真实 Gradle clean build 一次通过（exit 0）。'
            : `第 ${round} 轮构建通过（exit 0），修复生效。`,
        matchedPatternIds: matchedIds,
        exitCode: 0
      }
      emit('build', {
        type: 'phase',
        phase: 'done',
        action: conclusion.summary,
        artifact: buildArtifact(`${runId}-build`, conclusion)
      })
      return conclusion
    }

    if (done.timedOut) {
      // 超时是真实失败而非「跳过」（状态归并修复）：
      // 30 分钟未完成说明依赖下载/守护进程/代码存在实质问题，显示「跳过」会误导用户以为没跑
      const conclusion: BuildConclusion = {
        status: 'fail',
        rounds: round,
        summary:
          'Gradle 构建超时（30 分钟）被强制终止。请检查网络/依赖下载与 Gradle 守护进程状态后重试；' +
          '若反复超时，可先在终端手动执行 gradlew build 预热依赖。',
        matchedPatternIds: matchedIds,
        exitCode: null
      }
      emit('build', {
        type: 'phase',
        phase: 'error',
        action: conclusion.summary,
        artifact: buildArtifact(`${runId}-build`, conclusion)
      })
      return conclusion
    }

    if (done.cancelled || done.exitCode === null) {
      // 仅「用户取消 / 外部中断」按环境问题跳过（不计编译失败）
      const conclusion: BuildConclusion = {
        status: 'skipped',
        rounds: round - 1,
        summary: 'Gradle 构建被中断，按环境问题处理，不计编译失败。',
        matchedPatternIds: [],
        // 外部中断属环境阻塞，非内容失败
        blockedByEnvironment: true
      }
      emit('build', {
        type: 'phase',
        phase: 'skipped',
        action: conclusion.summary,
        artifact: buildArtifact(`${runId}-build`, conclusion)
      })
      return conclusion
    }

    // 真实编译失败：匹配错误模式 → 回炉修复
    const matches = ctx.matchErrorPatterns(request.loader, request.mcVersion, logBuffer)
    matchedIds = Array.from(new Set([...matchedIds, ...matches.map((m) => m.pattern.id)]))
    // 九层失败分类——按构建流水线序取最早有证据的层，注入分层修复策略
    const classification = classifyBuildFailure(logBuffer, matches)
    // 同层重现 = 上一根因假设已证伪（修复方向未触及根因）
    const hypothesisFalsified = isSameFailure(prevClassification, classification)
    // 证伪成立时快照上一轮分类供修复 goal 引用（prevClassification 随即被本轮覆盖）
    const falsifiedPrev = hypothesisFalsified ? prevClassification : null
    lastClassification = classification
    repairTrace.push(
      `第 ${round} 轮｜` +
        (classification
          ? `${classification.label}｜证据：${classification.evidence}`
          : '未分类（未命中已知层信号）') +
        (hypothesisFalsified ? '｜与上轮同层：上一假设已证伪' : '')
    )
    prevClassification = classification
    emit('build', {
      type: 'log',
      detail:
        (classification
          ? `失败层级：${classification.label}（${classification.layer}）｜证据：${classification.evidence}\n`
          : '') +
        (matches.length > 0
          ? `构建失败，命中错误模式：${matches.map((m) => m.pattern.id).join(', ')}`
          : '构建失败，未命中已知错误模式，将原始日志尾部交回生成阶段分析')
    })

    if (round >= maxRounds) break

    emit('generate', {
      type: 'phase',
      phase: 'running',
      action: `构建失败，治愈循环第 ${round} 次回炉修复…`
    })
    // 把「未删改的编译错误原文 + 命中模式建议」交回同一 FC 工具循环——
    // 模型可用 edit_project_file 做定向修补（只改坏掉的几行），
    // 不再走「纯文本全量重吐整份文件」的老通道（实测最易截断、最易零产出）。
    const patternHints = matches
      .map((m) => `- ${m.pattern.id}：${m.pattern.cause}｜修复：${m.pattern.solution}`)
      .join('\n')
    const buildFixGoal = (retryHint?: string): string =>
      `修复真实 Gradle 构建失败（第 ${round} 轮）。\n\n` +
      // 同层重现——上一假设已证伪，置顶要求先修诊断而非继续做同类代码改动
      (falsifiedPrev !== null
        ? `【上一假设已证伪】第 ${round - 1} 轮修复后重跑仍败在${classification?.label ?? '同一层'}` +
          `（上轮证据：${falsifiedPrev.evidence}），说明上一轮的根因假设不成立。` +
          '禁止在同一方向上做更多代码改动——重新陈述一个新的根因假设，并说明它与上一轮假设的本质区别。\n\n'
        : '') +
      // 假设先行——动手前显式陈述根因假设与可证伪检查
      '【假设先行】动手改代码前，先用一句话陈述你对根因的假设，并给出一条能证伪该假设的检查' +
      '（例如：若假设成立，重跑构建后某个 error 应消失）。\n\n' +
      // 分层修复策略置顶——先告诉模型「败在哪一层、该往哪修」，再给日志原文
      (classification
        ? `【失败层级：${classification.label}（${classification.layer}）】\n${classification.fixHint}\n\n`
        : '') +
      `【原始构建日志尾部（未删改，${LOG_TAIL_CHARS} 字符内）】\n${logBuffer.slice(-LOG_TAIL_CHARS)}\n\n` +
      (patternHints
        ? `【已命中的错误模式与修复建议】\n${patternHints}\n\n`
        : '【未命中已知错误模式：请依据上面的日志原文自行定位根因】\n\n') +
      '要求：直接改动项目内实际存在的文件——改动既有文件用 edit_project_file 做 search/replace 原地修补' +
      '（一次可传多个 edits 片段）；确实需要新建文件才用 write_project_file 提交完整内容。' +
      '不要重吐未改动的整份文件，不要只解释问题，必须真正改到出错的代码。' +
      (retryHint ? `\n\n${retryHint}` : '')
    // 零产出不再直接放弃（实测：模型首轮 thought 已正确定位根因，
    // 却零文件产出，直接停止浪费了已完成的诊断）。带逐条拒绝原因强提示重试一次；
    // 重试后仍零产出才按原有分流收口。
    let nextFiles: AgentFileChange[] = []
    let fixNotes = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      let retryHint: string | undefined
      if (attempt === 2) {
        emit('generate', {
          type: 'phase',
          phase: 'running',
          // 可观测性：明示强提示重试的额外模型调用消耗，token 用量落库后
          // 用户在运行详情里能对上「额度去哪了」
          action: `第 ${round} 轮修复零有效产出，追加一次强提示重试（额外消耗 1 次模型调用）…`
        })
        const reasons =
          nextFiles.length > 0
            ? nextFiles.map((f) => `- ${f.path}：${f.reason || '未说明原因'}`).join('\n')
            : '（本轮没有任何文件落盘）'
        retryHint =
          `【强制重试】你上一轮修复没有产出任何可写盘的文件变更，逐条原因：\n${reasons}\n\n` +
          '请这次务必真正改到文件：用 edit_project_file 针对编译错误指向的文件做最小必要替换，' +
          '或用 write_project_file 提交必须新增/整体重写的文件的完整内容（不是 diff、不是片段）。'
      }
      const fixOutcome = await input.fixViaGenerate(buildFixGoal(retryHint))
      if (state.canceled) {
        return {
          status: 'skipped',
          rounds: round,
          summary: '修复过程中被用户取消。',
          matchedPatternIds: matchedIds
        }
      }
      fixNotes = fixOutcome.notes
      nextFiles = fixOutcome.files
      // 落盘由 runGeneratePipeline 的 write-through 完成；此处只兜底未走 write-through 的通道产物
      for (const change of nextFiles) {
        if (!change.accepted) continue
        try {
          input.writeFileSafe(resolve(project.path, change.path), change.content)
          // 构建治愈轮的修复落盘同样推 file-written（工作台实时可见）
          emit('build', {
            type: 'file-written',
            fileWritten: {
              path: change.path,
              action: change.action,
              bytes: Buffer.byteLength(change.content, 'utf8')
            }
          })
        } catch (err) {
          change.accepted = false
          change.reason = `写盘失败：${(err as Error).message}`
        }
      }
      if (nextFiles.some((f) => f.accepted)) break
    }
    lastRoundYielded = nextFiles.some((f) => f.accepted)
    if (!lastRoundYielded) {
      // 防死循环护栏：强提示重试后仍零有效产出，立即停止
      // 分流「模型有产出但全部写盘失败」与「模型零产出」——
      // 前者是磁盘/权限问题，归因不能指向模型，否则用户换模型重试只会浪费额度。
      const writeFailed = nextFiles.filter((f) => !f.accepted && f.reason && /写盘失败/.test(f.reason))
      const summary =
        writeFailed.length > 0 && nextFiles.length > 0
          ? `第 ${round} 轮修复产出 ${nextFiles.length} 个文件变更，但全部写盘失败（如 ${writeFailed[0]?.path}），治愈循环提前停止；这是磁盘/权限问题而非模型问题，请检查安全软件拦截、目录只读或文件占用后重试。`
          : `第 ${round} 轮修复经 1 次强提示重试仍未产出有效变更，治愈循环提前停止；请查看日志与命中模式手动介入。`
      const conclusion: BuildConclusion = {
        status: 'fail',
        rounds: round,
        summary,
        matchedPatternIds: matchedIds,
        failureLayer: classification?.layer ?? null,
        failureLayerLabel: classification?.label,
        failureEvidence: classification?.evidence,
        repairTrace: [...repairTrace]
      }
      emit('build', {
        type: 'phase',
        phase: 'error',
        action: conclusion.summary,
        artifact: buildArtifact(`${runId}-build`, conclusion)
      })
      return conclusion
    }
    lastFiles = mergeFileChanges(lastFiles, nextFiles)
    input.setFiles(lastFiles)
    emit('generate', {
      type: 'phase',
      phase: 'done',
      action: `回炉产出 ${nextFiles.length} 个修复文件变更`,
      artifact: {
        id: `${runId}-files-fix-${round}`,
        kind: 'file-change',
        title: `第 ${round} 轮修复变更`,
        files: nextFiles,
        body: fixNotes || undefined
      }
    })
  }

  const conclusion: BuildConclusion = {
    status: 'fail',
    rounds: round,
    summary:
      // 分层标签前置——用户第一眼看到「败在哪一层」
      (lastClassification ? `【${lastClassification.label}】` : '') +
      (maxFixRounds === 0
        ? '首次真实构建失败；本档为直出模式（不自动回炉修复）。请查看日志与命中模式手动介入，或切换匠造/大师档重试。'
        : `构建失败且 ${maxFixRounds} 轮自动修复预算已用尽（共 ${round} 轮构建），已如实停止；请查看日志与命中模式手动介入。`),
    matchedPatternIds: matchedIds,
    exitCode: lastExitCode,
    failureLayer: lastClassification?.layer ?? null,
    failureLayerLabel: lastClassification?.label,
    failureEvidence: lastClassification?.evidence,
    repairTrace: [...repairTrace]
  }
  emit('build', {
    type: 'phase',
    phase: 'error',
    action: conclusion.summary,
    artifact: buildArtifact(`${runId}-build`, conclusion)
  })
  return conclusion
}

// ---------------------------------------------------------------------------
// 其它辅助
// ---------------------------------------------------------------------------
export function isComboActive(
  reference: ReferenceService,
  loader: LoaderId,
  mcVersion: string
): boolean {
  const cell = reference
    .listMatrixCells()
    .find((c) => c.id === `${loader}-${mcVersion}`)
  // 激活源唯一权威：参考包 manifest.scopeControl.m7ActiveVersions
  // 历史上此处硬编码仅放行 fabric/1.20.1，导致 manifest 已激活的其余 16 个组合
  // 在 build 阶段被强制判成「储备组合」。以 manifest 为准，不再叠加硬编码白名单。
  return cell?.active === true
}

export function hasGradlew(project: ResolvedProject): boolean {
  return (
    existsSync(resolve(project.path, 'gradlew')) ||
    existsSync(resolve(project.path, 'gradlew.bat'))
  )
}
