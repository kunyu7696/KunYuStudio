/**
 * 文件系统相关共享类型（M3 资源管理器）。
 * 主进程 fsService 与渲染进程 FileTree/CodeEditor 共用。
 */

/** 文件系统节点类型 */
export type FileNodeKind = 'file' | 'directory'

/**
 * 文件树节点。轻量结构，避免一次传输整个项目的大目录。
 * children 仅在目录展开时懒加载填充。
 */
export interface FileNode {
  /** 绝对路径 */
  path: string
  /** 文件名（含扩展名） */
  name: string
  kind: FileNodeKind
  /** 扩展名（小写，不含点）；目录为 '' */
  ext: string
  /** 字节大小，目录为 0 */
  size: number
  /** 修改时间戳（ms） */
  mtime: number
  /** 子节点（目录展开后填充） */
  children?: FileNode[]
}

/** 新建文件 / 目录请求 */
export interface CreateFsEntryInput {
  parentPath: string
  name: string
  kind: FileNodeKind
}

/** 重命名 / 移动请求 */
export interface RenameFsEntryInput {
  oldPath: string
  newName: string
}

/** 复制请求 */
export interface CopyFsEntryInput {
  src: string
  dest: string
}

/** 文件内容（读取/写入） */
export interface FileContent {
  path: string
  content: string
  encoding: 'utf-8'
  mtime: number
}

/** 二进制文件内容（图片预览等场景；base64 传输） */
export interface BinaryFileContent {
  path: string
  /** base64 编码内容 */
  dataBase64: string
  /** MIME 类型（按扩展名推断） */
  mime: string
  /** 原始字节大小 */
  size: number
  mtime: number
}

/** 二进制读取大小上限（20MB）：防渲染进程被超大文件 base64 撑爆 */
export const BINARY_READ_MAX_BYTES = 20 * 1024 * 1024

/** 主进程推送给渲染进程的文件系统变更事件 */
export interface FsChangeEvent {
  /** 变更类型 */
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  /** 变更路径（绝对路径） */
  path: string
}

/** 默认路径过滤规则：隐藏构建产物与系统目录 */
export const DEFAULT_EXCLUDE_PATTERNS: readonly string[] = [
  '.git',
  '.gradle',
  'build',
  'node_modules',
  '.idea',
  '.vscode',
  '.dev-userdata',
  '.kunyu',
  'run',
  'out',
  'dist',
  '.DS_Store'
]
