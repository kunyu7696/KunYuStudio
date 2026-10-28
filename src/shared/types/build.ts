/**
 * 构建与运行相关共享类型（M5，设计文档 3.13 + 8.6）。
 * 主进程 Gradle 服务与渲染进程终端面板/构建状态共用。
 */

/** JDK 安装信息 */
export interface JdkInfo {
  /** JAVA_HOME 风格根目录（bin 的父目录） */
  home: string
  /** java 可执行文件绝对路径 */
  javaPath: string
  /** 完整版本字符串，如 "17.0.12" */
  version: string
  /** 主版本号（8 / 17 / 21 …） */
  major: number
  /** 来源：项目配置 / 全局设置 / JAVA_HOME / 常见目录扫描 / PATH / 应用内下载的托管 JDK */
  source: 'configured' | 'global' | 'java-home' | 'scanned' | 'path' | 'managed'
}

/** JDK 与当前工具链的兼容等级 */
export type JdkCompatibility = 'recommended' | 'compatible' | 'too-low' | 'too-high'

/** 一组 JDK 版本要求（按加载器 + MC 版本从版本矩阵推导） */
export interface JdkRequirements {
  /** 项目工具链要求的最低 JDK 主版本（低于此值无法构建） */
  requiredMajor: number
  /** 自动选择时优先精确命中的主版本 */
  preferredMajor: number
  /** Gradle 可运行的最高 JDK 主版本（高于此值构建宿主起不来） */
  maxMajor: number
}

/** Gradle 8.10.2 可运行的最高 JDK 主版本 */
export const GRADLE_MAX_MAJOR = 23
/** 推荐（Fabric 1.20.1 原生要求）的 JDK 主版本 */
export const PREFERRED_JDK_MAJOR = 17
/** Minecraft 1.20.1 开发要求的 JDK 主版本 */
export const REQUIRED_JDK_MAJOR = 17

/** 1.20.1 时代工具链（Fabric 1.20.1 + Gradle 8.10.2）的默认要求；
 *  未提供项目上下文时的回退值，26.x 等新版本由版本矩阵推导 */
export const LEGACY_JDK_REQUIREMENTS: JdkRequirements = {
  requiredMajor: REQUIRED_JDK_MAJOR,
  preferredMajor: PREFERRED_JDK_MAJOR,
  maxMajor: GRADLE_MAX_MAJOR
}

/** 纯函数：判定 JDK 主版本与工具链的兼容等级（主进程检测与设置 UI 共用） */
export function judgeJdkCompatibility(
  major: number,
  req: JdkRequirements = LEGACY_JDK_REQUIREMENTS
): JdkCompatibility {
  if (major === req.preferredMajor) return 'recommended'
  if (major < req.requiredMajor) return 'too-low'
  if (major > req.maxMajor) return 'too-high'
  return 'compatible'
}

/** JDK 来源的中文标签 */
export function jdkSourceLabel(source: JdkInfo['source']): string {
  switch (source) {
    case 'configured':
      return '项目配置'
    case 'global':
      return '全局设置'
    case 'java-home':
      return 'JAVA_HOME'
    case 'scanned':
      return '系统扫描'
    case 'path':
      return '系统 PATH'
    case 'managed':
      return '应用内下载'
  }
}

/** 零配置运行环境 3a：JDK 置备（应用内一键下载安装） */
export interface JdkProvisionInput {
  /** 目标 JDK 主版本（8/17/21/25…） */
  major: number
  /** 覆盖设置中的镜像基地址（测试/自定义用） */
  mirror?: string
  /** 覆盖托管根目录（测试用） */
  managedRoot?: string
}

export interface JdkProvisionProgress {
  phase: 'resolve' | 'download' | 'extract' | 'done'
  /** 0-100（resolve/extract 为粗粒度） */
  progress: number
  message?: string
  loadedBytes?: number
  totalBytes?: number
}

export type JdkProvisionResult =
  | { ok: true; jdk: JdkInfo; home: string }
  | { ok: false; errorMessage: string }

/** JDK 检测结果 */
export interface JdkDetectResult {
  /** 最终选用的 JDK（无兼容 JDK 时为 null） */
  jdk: JdkInfo | null
  /** 本次判定所用的版本要求（按项目加载器/MC 版本推导，无项目上下文为 legacy 默认） */
  requirements: JdkRequirements
  /** 当前工具链要求的 JDK 主版本 */
  requiredMajor: number
  /** 是否兼容 */
  compatible: boolean
  /** 面向用户的说明/警告 */
  message: string
  /** 扫描到的全部 JDK */
  candidates: JdkInfo[]
  /** 主进程环境中的 JAVA_HOME（设置页只读展示用） */
  javaHomeEnv: string
}

/** 渲染进程发起的 Gradle 任务请求 */
export interface GradleRunInput {
  /** 项目根目录（含 gradlew） */
  root: string
  /** 任务列表，如 ['build'] / ['runClient'] / ['clean','build'] */
  tasks: string[]
  /** 指定 JAVA_HOME（通常来自 JDK 检测结果），不传则沿用进程环境 */
  javaHome?: string
  /** 超时（ms），超时杀进程；runClient 不传 */
  timeoutMs?: number
  /** 附加 Gradle 参数 */
  extraArgs?: string[]
  /**
   * 多实例隔离（仅 runClient 有意义）：同一项目同时跑多个客户端时，
   * 给每个实例一个短 id（如 observer-a）。主进程会：
   * 1) 追加 --args=--gameDir .kunyu/runs/<id>，存档/日志/mods 各自独立；
   * 2) 追加 --project-cache-dir .kunyu/cache/<id>，避开同项目 Gradle 缓存互锁
   *    （依赖仍走同一 GRADLE_USER_HOME，不会重复下载 MC/Loom）。
   * 不传时使用默认 run/ 目录，且同一时刻只允许一个 Gradle 任务。
   */
  instanceId?: string
}

/** Gradle 输出块 */
export interface GradleOutputEvent {
  type: 'output'
  runId: string
  /** stdout / stderr / 工具自身的系统消息 */
  stream: 'stdout' | 'stderr' | 'system'
  /** 已按行切分的文本块（可能含多行，渲染端再切） */
  text: string
}

/** 任务阶段事件 */
export interface GradlePhaseEvent {
  type: 'phase'
  runId: string
  phase: 'started' | 'done'
  /** 退出码（仅 done）；被信号杀死/超时时可能为 null */
  exitCode: number | null
  cancelled: boolean
  timedOut: boolean
  durationMs: number
}

/** 游戏客户端启动成功标记（T5.3） */
export interface GameStartedEvent {
  type: 'game-started'
  runId: string
}

/** 崩溃报告摘要（T5.3） */
export interface CrashSummary {
  /** crash-report 文本文件绝对路径 */
  reportPath: string
  /** Description 行 */
  description: string
  /** 首个异常类型+消息（Headline 段第一行非 at 行） */
  headline: string
  /** 根因（Caused by 最后一条；无则取 headline） */
  cause: string
  /** 归因分类关键词，如 "内存不足" / "注册冲突" / "依赖缺失" */
  keyword: string
}

export interface GradleCrashEvent {
  type: 'crash'
  runId: string
  crash: CrashSummary
}

/** 主进程 → 渲染进程的全部构建事件 */
export type GradleEvent =
  | GradleOutputEvent
  | GradlePhaseEvent
  | GameStartedEvent
  | GradleCrashEvent

/** 终端面板日志级别（信息灰/成功绿/警告黄/错误红，设计文档 3.8） */
export type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'dim'

/** 解析后的一条终端日志 */
export interface ConsoleLine {
  id: number
  level: LogLevel
  text: string
}

/** 构建问题（编译错误/警告），用于问题列表与点击跳转 */
export interface BuildProblem {
  severity: 'error' | 'warning'
  /** 绝对路径（可能为 null，如纯 Gradle 配置错误） */
  file: string | null
  line: number | null
  column: number | null
  message: string
  /** 原始日志行 */
  raw: string
}
