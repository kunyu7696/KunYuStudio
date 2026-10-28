/**
 * M10 游戏测试沙箱共享类型。
 * 沙箱为一键全自动流程：构建 → 启动客户端 → 等待进入世界 → 探针 → 收集 → 退出。
 */

/** 沙箱六阶段 */
export type SandboxStage =
  | 'build'
  | 'launch'
  | 'wait-world'
  | 'probes'
  | 'collect'
  | 'shutdown'

export type SandboxStageStatus = 'running' | 'done' | 'failed' | 'skipped'

/** 沙箱运行配置 */
export interface SandboxConfig {
  /** 项目根目录 */
  projectPath: string
  /** 启动阶段超时（毫秒，默认 300000） */
  launchTimeoutMs?: number
  /** 等待进入世界超时（毫秒，默认 120000） */
  waitWorldTimeoutMs?: number
}

/** 单条探针结果 */
export interface SandboxProbeResult {
  name: string
  ok: boolean
  /** 返回值或错误文本 */
  detail: string
}

/** 日志中发现的问题行 */
export interface LogFinding {
  level: 'ERROR' | 'WARN'
  /** 命中的规则标识（如 'mixin-apply-failed'） */
  pattern: string
  /** 原始日志行（截断 500 字） */
  line: string
  /** 归类证据（通常为异常关键片段） */
  evidence: string
}

/** 崩溃/日志根因诊断（T10.3 + T10.4） */
export interface Diagnosis {
  /** 分类标识（missing-dependency/duplicate-registration/mixin/npe/...） */
  category: string
  /** 中文分类名 */
  headline: string
  /** 根因描述 */
  cause: string
  /** 证据行（crash-report 或日志原文） */
  evidence: string[]
  /** 修复建议（只建议，不自动修复） */
  suggestion: string
  /** crash-report 文件路径（来自崩溃报告时） */
  reportPath?: string
}

/** 单阶段记录 */
export interface SandboxStageRecord {
  status: SandboxStageStatus
  detail: string
}

/** 沙箱完整报告 */
export interface SandboxReport {
  runId: string
  ok: boolean
  startedAt: string
  durationMs: number
  stages: Partial<Record<SandboxStage, SandboxStageRecord>>
  probes: SandboxProbeResult[]
  logFindings: LogFinding[]
  diagnosis: Diagnosis | null
  screenshotPath: string | null
  /** 游戏进程退出码 */
  exitCode: number | null
  /** 本次运行 run/mods 清单（文件名），作为"隔离 mods 目录"的可见记录 */
  modsManifest: string[]
  /** 是否因取消而终止 */
  cancelled: boolean
}

/** 沙箱阶段事件（主进程 → 渲染） */
export type SandboxEvent =
  | { type: 'phase'; runId: string; stage: SandboxStage; status: SandboxStageStatus; action: string }
  | { type: 'probe'; runId: string; probe: SandboxProbeResult }
  | { type: 'report'; runId: string; report: SandboxReport }
