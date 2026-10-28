/**
 * Spark 采样编排与降级（TR-14.1）。
 *
 * 获取优先级：
 * 1) kunyu-observer 在线：经 /v1/server-command 触发 spark 并取回报告；
 * 2) 降级：读 spark 本地产出文件；
 * 3) 用户手动导入（报告文本或文件路径）；
 * 4) 均不可得：返回引导信息，流程可继续。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  probeObserver,
  runServerCommand,
  type ObserverServerCommandResult
} from '../observer/observerClient'
import type { PackageIndexEntry } from './jfrParser'
import {
  attributeSpark,
  parseSparkReport,
  type AttributedSpark,
  type SparkReport
} from './sparkParser'

export interface SparkCollectResult {
  path: 'online' | 'file' | 'manual' | 'unavailable'
  /** 不可用时的引导文案 */
  guide?: string
  report: SparkReport
  attributed: AttributedSpark[]
}

export interface CollectSparkInput {
  /** observer 端口；不传时模块自行扫描 9876–9886，扫描不到按离线处理 */
  observerPort?: number | null
  /** 测试注入：替代真实 HTTP 命令调用 */
  runCommand?: (port: number, command: string) => Promise<ObserverServerCommandResult>
  /** 测试注入：替代端口扫描 */
  scanPort?: () => Promise<number | null>
  projectPath: string | null
  /** 手动导入：报告文本或文件路径 */
  manual: string | null
  index: PackageIndexEntry[]
}

/** 在线：触发 spark 并取回输出文本；失败/离线返回 null */
async function collectOnline(
  port: number | null,
  runCommand: (port: number, command: string) => Promise<ObserverServerCommandResult>
): Promise<string | null> {
  if (port === null) return null
  try {
    const r = await runCommand(port, 'spark profiler stop --copy-output')
    const output = r.output.trim()
    return output.length > 0 ? output : null
  } catch {
    // 未进世界（503）/ 当前映射不支持（501）/ 执行异常（500）统一按离线降级
    return null
  }
}

/** 按优先级获取 Spark 报告并归因 */
export async function collectAndAttributeSpark(
  input: CollectSparkInput
): Promise<SparkCollectResult> {
  const { projectPath, manual, index } = input
  const scanPort = input.scanPort ?? (async () => (await probeObserver({ timeoutMs: 800 }))?.port ?? null)
  const runCommand = input.runCommand ?? runServerCommand

  // 1. 在线
  let port: number | null
  if (input.observerPort !== undefined) {
    port = input.observerPort
  } else {
    try {
      port = await scanPort()
    } catch {
      port = null
    }
  }
  const onlineText = await collectOnline(port, runCommand)
  if (onlineText) {
    const report = parseSparkReport(onlineText)
    return { path: 'online', report, attributed: attributeSpark(report, index) }
  }

  // 2. 本地 spark 产出文件
  if (projectPath) {
    const candidates = [
      join(projectPath, 'run', 'spark-report.txt'),
      join(projectPath, 'run', 'spark', 'report.txt')
    ]
    for (const p of candidates) {
      if (existsSync(p)) {
        const report = parseSparkReport(readFileSync(p, 'utf8'))
        return { path: 'file', report, attributed: attributeSpark(report, index) }
      }
    }
  }

  // 3. 手动导入（文件路径或直接文本）
  if (manual) {
    const text = existsSync(manual) ? readFileSync(manual, 'utf8') : manual
    const report = parseSparkReport(text)
    if (report.source !== 'unknown') {
      return { path: 'manual', report, attributed: attributeSpark(report, index) }
    }
  }

  // 4. 不可用：引导，流程继续
  return {
    path: 'unavailable',
    guide:
      '未获取到 Spark 报告。可：①在游戏内安装 Spark 并保持 kunyu-observer 探针在线；' +
      '②运行 /spark profiler 后把报告放入项目 run/ 目录；③直接粘贴或导入报告文件。',
    report: { source: 'unknown', averageTickMs: null, nodes: [] },
    attributed: []
  }
}
