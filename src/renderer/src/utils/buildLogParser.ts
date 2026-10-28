/**
 * Gradle / javac / Minecraft 日志解析（M5 T5.2）。
 * 纯函数模块：日志分级着色、编译错误文件/行号提取、问题去重。
 */
import type { BuildProblem, ConsoleLine, LogLevel } from '../../../shared/types/build'
import { t } from '../i18n'

/**
 * javac 诊断：路径:行[:列]: 级别: 消息
 * 级别兼容英文（error/warning）与中文 JDK（错误/警告），冒号兼容全角
 */
const JAVAC_RE = /^(.+\.(?:java|gradle|kts)):(\d+)(?::(\d+))?:\s*(error|错误|warning|警告)\s*[:：]\s*(.+)$/

/** Gradle 构建脚本错误：Build file 'x' line: 42 */
const GRADLE_FILE_RE = /Build file '([^']+)' line:\s*(\d+)/

const TASK_FAILED_RE = /^> Task .+ FAILED$/
const TASK_LINE_RE = /^> Task /
const PROGRESS_RE = /^[<>=+-]{4,}|^\d+% |^Welcome to Gradle|^Starting a Gradle|^-------------|^\* What went wrong|^\* Try:|^\* Exception is|^BUILD |^\d+ actionable task/
const BUILD_RESULT_RE = /^(BUILD SUCCESSFUL|BUILD FAILED|FAILURE:)/
const LOG4J_RE = /\[(?:[^\]]+\/)?(INFO|WARN|ERROR|DEBUG|FATAL)\]/

/** 浏览器环境路径判断（渲染进程不能引用 node:path）；统一输出 / 分隔符 */
function isAbsolutePath(p: string): boolean {
  return /^([A-Za-z]:)?[\\/]/.test(p)
}

/** 相对路径基于项目根拼为绝对路径，统一 / 分隔符（Windows 下 Node 同样接受） */
function toAbs(maybePath: string, root: string): string {
  const clean = maybePath.replace(/^\.\//, '').replace(/^\.\\/, '').replace(/\\/g, '/')
  const rootNorm = root.replace(/\\/g, '/').replace(/\/+$/, '')
  return isAbsolutePath(clean) ? clean : `${rootNorm}/${clean}`
}

/** 单条日志行分级；若能提取编译问题则一并返回 */
export function classifyLine(
  raw: string,
  root: string
): { level: LogLevel; problem?: BuildProblem } {
  const line = raw.replace(/\s+$/, '')

  const javac = line.match(JAVAC_RE)
  if (javac) {
    const [, file, ln, col, label, message] = javac as [string, string, string, string | undefined, string, string]
    const severity = label === 'error' || label === '错误' ? 'error' : 'warning'
    return {
      level: severity === 'error' ? 'error' : 'warning',
      problem: {
        severity,
        file: toAbs(file, root),
        line: Number.parseInt(ln, 10),
        column: col ? Number.parseInt(col, 10) : null,
        message: message.trim(),
        raw: line
      }
    }
  }

  const gradleFile = line.match(GRADLE_FILE_RE)
  if (gradleFile) {
    const [, file, ln] = gradleFile as [string, string, string]
    return {
      level: 'error',
      problem: {
        severity: 'error',
        file: toAbs(file, root),
        line: Number.parseInt(ln, 10),
        column: null,
        message: t('buildLog.gradleScriptError'),
        raw: line
      }
    }
  }

  if (TASK_FAILED_RE.test(line) || /^FAILURE:/.test(line) || /^Caused by:/.test(line)) {
    return { level: 'error' }
  }
  if (BUILD_RESULT_RE.test(line)) {
    return { level: line.includes('FAILED') || line.includes('FAILURE') ? 'error' : 'success' }
  }
  if (/deprecated|Deprecated Gradle features/i.test(line) || /:\s*(warning|警告)\s*[:：]/.test(line)) {
    return { level: 'warning' }
  }
  if (TASK_LINE_RE.test(line)) return { level: 'dim' }
  if (PROGRESS_RE.test(line)) return { level: 'dim' }

  const log4j = line.match(LOG4J_RE)
  if (log4j) {
    const lvl = log4j[1]
    if (lvl === 'ERROR' || lvl === 'FATAL') return { level: 'error' }
    if (lvl === 'WARN') return { level: 'warning' }
    if (lvl === 'DEBUG') return { level: 'dim' }
    return { level: 'info' }
  }

  // javac 错误后续说明行（symbol/location/代码指针）按普通信息处理
  return { level: 'info' }
}

/** 问题去重键 */
function problemKey(p: BuildProblem): string {
  return `${p.severity}|${p.file ?? ''}|${p.line ?? 0}|${p.message}`
}

export interface ParsedChunk {
  lines: Array<{ level: LogLevel; text: string }>
  problems: BuildProblem[]
}

/** 解析一块多行输出（可能跨多行），返回分级行与新问题 */
export function parseChunk(text: string, root: string, known: Set<string>): ParsedChunk {
  const rawLines = text.split(/\r?\n/)
  const lines: ParsedChunk['lines'] = []
  const problems: BuildProblem[] = []
  for (const raw of rawLines) {
    if (raw === '') continue
    const { level, problem } = classifyLine(raw, root)
    lines.push({ level, text: raw })
    if (problem) {
      const key = problemKey(problem)
      if (!known.has(key)) {
        known.add(key)
        problems.push(problem)
      }
    }
  }
  return { lines, problems }
}

/** 终端最多保留日志条数（防止超长构建占内存） */
export const MAX_CONSOLE_LINES = 6000

export function makeConsoleLine(id: number, level: LogLevel, text: string): ConsoleLine {
  return { id, level, text }
}
