/**
 * 音效工坊共享类型。
 *
 * 链路约定：
 * - FFmpeg 运行时按需下载到 userData/tools/ffmpeg/（不打进安装包）；
 * - 合成（jfxr 参数合成 / MIDI 渲染）在渲染层完成并编码为 WAV 字节，
 *   主进程统一经 FFmpeg 转码为 OGG Vorbis 44.1kHz 落盘到
 *   assets/<modid>/sounds/（模组项目）或 assets/<namespace>/sounds/（独立资源包项目）；
 * - 音效事件注册写 assets/<ns>/sounds.json（原版资源包格式）。
 */

/** FFmpeg 工具就绪状态 */
export interface AudioToolStatus {
  /** ffmpeg.exe 已落盘 */
  installed: boolean
  /** ffmpeg 可执行文件绝对路径（未安装时也是目标路径） */
  path: string
  /** 已安装版本（sidecar 记录；未知为空串） */
  version: string
  /**
   * 完整性：sha256-verified = 下载时已按上游 SHA-256 校验；
   * unverified = 上游未提供校验值或为本地既有安装（使用前需用户知情）
   */
  integrity: 'sha256-verified' | 'unverified'
}

/** 音频任务进度推送载荷（audio:event） */
export interface AudioEvent {
  jobId: string
  phase: 'tool-download' | 'converting' | 'done' | 'error'
  /** 人类可读进度行 */
  message?: string
  /** 工具下载进度（字节）；totalBytes 未知为 0 */
  loadedBytes?: number
  totalBytes?: number
  /** 当前转换的文件名 */
  file?: string
  /** phase=error 时携带 */
  error?: string
}

/** 转换输入：渲染层合成字节（WAV）或本地文件路径 */
export interface AudioConvertInput {
  /** 项目根 */
  root: string
  /** 目标文件名主干（合法内容 ID：小写字母开头，仅小写字母/数字/下划线） */
  stem: string
  source:
    | { kind: 'bytes'; data: Uint8Array; fileName: string }
    | { kind: 'path'; srcPath: string }
}

/** 单个音效转换结果 */
export interface AudioConvertResult {
  /** 包内相对路径（assets/<ns>/sounds/<stem>.ogg） */
  relPath: string
  sizeBytes: number
}

/** 声音库中的 .ogg 文件条目 */
export interface SoundFileInfo {
  /** 文件名主干（注册事件时引用的 ID） */
  stem: string
  /** 包内相对路径 */
  relPath: string
  sizeBytes: number
  /** 引用了该文件的音效事件名列表 */
  events: string[]
}

/** sounds.json 中的一个音效事件 */
export interface SoundEventEntry {
  /** 事件名（如 mymod.ambient_chime） */
  name: string
  /** 引用的音效（<ns>:<stem> 全限定 ID） */
  sounds: string[]
  /** 字幕翻译键（可选） */
  subtitle?: string
}

/** 声音库全貌（文件 + 事件） */
export interface AudioLibrary {
  /** 命名空间（modid / resourcepack namespace） */
  namespace: string
  /** sounds 目录的包内相对路径（assets/<ns>/sounds） */
  soundsRelDir: string
  files: SoundFileInfo[]
  events: SoundEventEntry[]
}
