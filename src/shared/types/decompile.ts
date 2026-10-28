/**
 * 反编译工作区共享类型。
 *
 * 边界约定：
 * - Vineflower 运行时按需下载到 userData/tools/（不打进安装包，避免再分发与体积问题）；
 * - 反编译产物落 userData/decompiled/<jarName>-<hash>/，由 decompileService 自管安全根，
 *   与项目 fsService 的 assertWithinRoot 根集合完全隔离（产物不属于任何项目）。
 */

/** 反编译工具（vineflower.jar）就绪状态 */
export interface DecompileToolStatus {
  /** jar 已落盘且通过 ZIP 魔数/结构校验 */
  installed: boolean
  /** jar 绝对路径（未安装时也是目标路径） */
  path: string
  /** 已安装/将要安装的版本号 */
  version: string
  /**
   * 完整性：sha256-verified = 与下载时记录的官方 SHA-256 一致；
   * unverified = 本地既有 jar 无校验记录（历史版本或手动放置），使用前需用户知情
   */
  integrity: 'sha256-verified' | 'unverified'
}

/** 反编译工作区条目（userData/decompiled 下一级目录） */
export interface DecompileWorkspaceInfo {
  /** 工作区根目录绝对路径 */
  root: string
  /** 目录名（jar 基名净化 + 短哈希） */
  name: string
  mtime: number
}

/** 反编译任务进度推送载荷（decompile:event） */
export interface DecompileEvent {
  jobId: string
  phase: 'tool-download' | 'running' | 'done' | 'error'
  /** 人类可读进度行（工具下载状态 / Vineflower 日志截断行） */
  message?: string
  /** 工具下载进度（字节）；totalBytes 未知为 0 */
  loadedBytes?: number
  totalBytes?: number
  /** phase=done 时携带 */
  outDir?: string
  fileCount?: number
  /** phase=error 时携带 */
  error?: string
}

/** 反编译任务最终结果（decompile:start invoke 返回） */
export interface DecompileResult {
  outDir: string
  /** 产出的 .java 文件数 */
  fileCount: number
  /** Vineflower 日志尾部（最长约 8KB，供失败诊断） */
  logTail: string
}

/** 工作区内文本文件读取结果 */
export interface DecompileFileContent {
  path: string
  relPath: string
  content: string
  /** 超过 2MB 截断标记 */
  truncated: boolean
}
