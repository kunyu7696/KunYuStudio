/**
 * 特性④ GameTest Runner（gradleService 复用）。
 *
 * 调用 `./gradlew runGameTestServer`（fabric-loom 自动注册的 task），累积 stdout，
 * 完成后调用 parseGameTestReport 解析出 GameTestReport。
 *
 * 协议依据 Fabric 1.20.1 fabric-gametest-api-v1 输出（实测 + 官方源码）：
 * - 通过：`GameTest <name> passed in <N> ticks` 或 `GameTest <name> passed!`
 * - 失败：`GameTest <name> failed at <description>` + 后续 `Reason: <message>` 或行内 `: <message>`
 * - 汇总：`All required tests passed!` / `Tests: <P> passed, <F> failed` 等
 *
 * 安全边界：
 * - 解析仅看 stdout/stderr，不写盘
 * - 超时/取消 → status='skipped' + summary
 * - 未识别格式 → status='skipped' + 摘要
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { executeGradleBuild, hasActiveRun, cancelGradle, type GradleSink } from './gradleService'
import type { GradleEvent, GradleRunInput } from '../../shared/types/build'
import type { GameTestReport } from '../../shared/types/agent'

export interface RunGameTestInput {
  /** 项目根（含 gradlew） */
  root: string
  /** JAVA_HOME（通常来自 resolveJavaHome） */
  javaHome: string
  /** 超时（ms），默认 120s */
  timeoutMs?: number
  /** 实时输出回调（每行/块） */
  onOutput?: (text: string) => void
  /** 注入测试用：替换 executeGradleBuild 实现 */
  runner?: typeof executeGradleBuild
}

const DEFAULT_TIMEOUT_MS = 120_000

/**
 * 把 runGameTestServer 包装为 Promise：等 Gradle phase=done 事件后解析 stdout。
 * - 失败/超时/取消 → GameTestReport.status='skipped' + summary
 * - 成功 → 调 parseGameTestReport(stdout)
 */
export async function runGameTestServer(input: RunGameTestInput): Promise<GameTestReport> {
  if (!existsSync(join(input.root, 'gradlew')) && !existsSync(join(input.root, 'gradlew.bat'))) {
    return skippedReport('项目缺少 gradlew，无法运行 runGameTestServer')
  }

  if (hasActiveRun()) {
    return skippedReport('已有 Gradle 任务在运行，请先停止')
  }

  const gradleInput: GradleRunInput = {
    root: input.root,
    tasks: ['runGameTestServer'],
    extraArgs: ['--console=plain', '--stacktrace'],
    javaHome: input.javaHome,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  const startMs = Date.now()
  const stdoutBuf: string[] = []
  const stderrBuf: string[] = []
  const runner = input.runner ?? executeGradleBuild

  await new Promise<void>((resolveRun) => {
    const sink: GradleSink = (event: GradleEvent) => {
      if (event.type === 'output') {
        const text = event.text
        if (event.stream === 'stdout' || event.stream === 'system') stdoutBuf.push(text)
        if (event.stream === 'stderr') stderrBuf.push(text)
        try {
          input.onOutput?.(text)
        } catch {
          /* 忽略回调异常 */
        }
      } else if (event.type === 'phase' && event.phase === 'done') {
        resolveRun()
      } else if (event.type === 'crash') {
        // GameTest 无崩溃报告路径，仅记录占位
        try {
          input.onOutput?.(`[crash] ${event.crash?.headline ?? ''}\n`)
        } catch {
          /* 忽略 */
        }
      }
    }

    try {
      runner(gradleInput, sink)
      // runId 返回即异步执行；done 事件到达时 resolveRun 触发
    } catch (err) {
      // executeGradleBuild 抛错（如 wrapper 缺失）→ 立即 resolve，让 parse 返回 skipped
      try {
        input.onOutput?.(`[error] ${(err as Error).message}\n`)
      } catch {
        /* 忽略 */
      }
      resolveRun()
    }
  })

  const durationMs = Date.now() - startMs
  const stdout = stdoutBuf.join('')
  const stderr = stderrBuf.join('')
  const combined = stdout + (stderr ? `\n${stderr}` : '')

  const report = parseGameTestReport(combined, durationMs)
  return report
}

/** 取消正在运行的 GameTest 任务（杀进程树） */
export function cancelGameTest(runId?: string): boolean {
  return cancelGradle(runId)
}

/**
 * 纯函数：解析 runGameTestServer stdout 为 GameTestReport。
 *
 * 兼容多种 Fabric 输出格式：
 * 1. `GameTest <name> passed in <N> ticks` / `GameTest <name> passed!`
 * 2. `GameTest <name> failed at <pos>: <reason>` / `GameTest <name> failed: <reason>`
 * 3. `<name> passed` / `<name> failed`（无前缀，旧版/简化输出）
 *
 * - 无任何 GameTest 行 → status='skipped'
 * - 全 pass → status='pass'
 * - 任一 fail → status='fail'
 */
export function parseGameTestReport(stdout: string, durationMs = 0): GameTestReport {
  const passed = new Set<string>()
  const failed: { name: string; error: string }[] = []

  // 通过：先扫，标记名字
  const passedRe = /GameTest\s+([\w_]+)\s+passed(?:\s+in\s+\d+\s+ticks)?!?\s*/gi
  let m: RegExpExecArray | null
  while ((m = passedRe.exec(stdout)) !== null) {
    passed.add(m[1] as string)
  }

  // 简化版（无 GameTest 前缀）
  const simplePassedRe = /\b(test_\w+)\s+passed\b/gi
  while ((m = simplePassedRe.exec(stdout)) !== null) {
    passed.add(m[1] as string)
  }

  // 失败：带位置/原因（[\s\S] 跨行匹配，因 reason 可能在下一行如 "Reason: ..."）
  const failedRe = /GameTest\s+([\w_]+)\s+failed(?:\s+at\s+[^:\n]+)?\s*[:\n]\s*([\s\S]+?)(?=\n\s*\n|\nGameTest|\nRunning|\nAll|$)/gi
  while ((m = failedRe.exec(stdout)) !== null) {
    const name = m[1] as string
    const reason = (m[2] as string).trim().split(/\n/)[0].trim() || '未知原因'
    failed.push({ name, error: reason })
    passed.delete(name)
  }

  // 简化版失败：行尾有 `failed` 且没在 passed 列表里
  const simpleFailedRe = /\b(test_\w+)\s+failed\b(?!\s+at)/gi
  const seenSimple = new Set<string>()
  while ((m = simpleFailedRe.exec(stdout)) !== null) {
    const name = m[1] as string
    if (passed.has(name) || seenSimple.has(name)) continue
    seenSimple.add(name)
    failed.push({ name, error: '失败（无详细原因）' })
  }

  const hasAny = passed.size > 0 || failed.length > 0
  const status: GameTestReport['status'] = !hasAny
    ? 'skipped'
    : failed.length > 0
      ? 'fail'
      : 'pass'

  const parts: string[] = []
  if (passed.size > 0) parts.push(`${passed.size} 项通过`)
  if (failed.length > 0) parts.push(`${failed.length} 项失败`)
  const summary = parts.length === 0
    ? '未捕获到 GameTest 输出（可能未生成测试类或 loom 版本不匹配）'
    : `GameTest ${parts.join('，')}`

  return {
    status,
    passed: [...passed],
    failed,
    summary,
    durationMs
  }
}

function skippedReport(summary: string): GameTestReport {
  return { status: 'skipped', passed: [], failed: [], summary, durationMs: 0 }
}

/** 列举项目中 .kunyu/content/gametest/*.json 的相对路径（diagnostics 用） */
export function listGameTestJsonFiles(projectRoot: string): string[] {
  const dir = join(projectRoot, '.kunyu', 'content', 'gametest')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => `.kunyu/content/gametest/${f}`)
  } catch {
    return []
  }
}
