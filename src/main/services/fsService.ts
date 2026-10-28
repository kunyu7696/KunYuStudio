import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  BinaryFileContent,
  CopyFsEntryInput,
  CreateFsEntryInput,
  FileContent,
  FileNode,
  RenameFsEntryInput
} from '../../shared/types/fs'
import { BINARY_READ_MAX_BYTES, DEFAULT_EXCLUDE_PATTERNS } from '../../shared/types/fs'

/** 安全根目录集合：所有 fs 操作必须落在这些根目录之下。 */
const allowedRoots = new Set<string>()

/**
 * 注册一个允许的项目根目录。
 * 打开项目时调用，防止渲染进程通过路径穿越访问项目外文件。
 */
export function registerProjectRoot(root: string): void {
  const abs = resolve(root)
  allowedRoots.add(abs)
  // macOS /var → /private/var 等符号链接：assertWithinRoot 会把 target realpath 成真实路径，
  // 根目录侧必须同步登记真实路径，否则 realpath 后的 target 反而被判越界（mac CI 实证）。
  try {
    allowedRoots.add(realpathSync(abs))
  } catch {
    /* 根目录尚不存在时仅登记词法路径 */
  }
}

export function unregisterProjectRoot(root: string): void {
  allowedRoots.delete(resolve(root))
}

/** 校验目标路径必须落在某个已注册的项目根目录内。 */
export function assertWithinRoot(target: string): void {
  const abs = resolve(target)
  // 纯词法 resolve 前缀比较不解析符号链接（Windows mklink /J 无需管理员），
  // Junction 可以绕过前缀检查写树外。对已存在路径用 realpathSync 还原真实位置再比对；
  // 路径不存在（写新文件）时回退对最近存在祖先做 realpath。
  let real = abs
  try {
    real = realpathSync(abs)
  } catch {
    let probe = dirname(abs)
    for (let i = 0; i < 32 && probe !== dirname(probe); i++) {
      try {
        real = join(realpathSync(probe), abs.slice(probe.length))
        break
      } catch {
        probe = dirname(probe)
      }
    }
  }
  for (const root of allowedRoots) {
    const rel = relative(root, real)
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return
  }
  throw new Error(`路径越界，禁止访问: ${target}`)
}

function isExcluded(name: string): boolean {
  return DEFAULT_EXCLUDE_PATTERNS.includes(name)
}

function toFileNode(absPath: string): FileNode {
  const st = statSync(absPath)
  const name = basename(absPath)
  const ext = extname(absPath).slice(1).toLowerCase()
  return {
    path: absPath,
    name,
    kind: st.isDirectory() ? 'directory' : 'file',
    ext,
    size: st.isDirectory() ? 0 : st.size,
    mtime: st.mtimeMs
  }
}

/**
 * 读取目录子节点。目录在前、文件在后，各自按名称升序。
 * 过滤掉 DEFAULT_EXCLUDE_PATTERNS 中的目录/文件。
 */
export function readDir(dirPath: string): FileNode[] {
  assertWithinRoot(dirPath)
  const entries = readdirSync(dirPath, { withFileTypes: true })
  const dirs: FileNode[] = []
  const files: FileNode[] = []
  for (const entry of entries) {
    if (isExcluded(entry.name)) continue
    const abs = join(dirPath, entry.name)
    try {
      const node = toFileNode(abs)
      if (node.kind === 'directory') dirs.push(node)
      else files.push(node)
    } catch {
      // 跳过无权限或符号链接异常项
    }
  }
  const byName = (a: FileNode, b: FileNode) => a.name.localeCompare(b.name)
  return [...dirs.sort(byName), ...files.sort(byName)]
}

export function readFile(filePath: string): FileContent {
  assertWithinRoot(filePath)
  const content = readFileSync(filePath, 'utf-8')
  const mtime = statSync(filePath).mtimeMs
  return { path: filePath, content, encoding: 'utf-8', mtime }
}

/** 按扩展名推断 MIME（图片预览用，未知类型回退 application/octet-stream） */
function extToMime(ext: string): string {
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}

/** 读取二进制文件（图片预览），base64 返回；超过上限拒绝，防止撑爆渲染进程 */
export function readBinaryFile(filePath: string): BinaryFileContent {
  assertWithinRoot(filePath)
  const st = statSync(filePath)
  if (st.size > BINARY_READ_MAX_BYTES) {
    throw new Error(`文件过大（${Math.round(st.size / 1024 / 1024)}MB > 20MB），不支持预览`)
  }
  const data = readFileSync(filePath)
  const ext = extname(filePath).slice(1).toLowerCase()
  return {
    path: filePath,
    dataBase64: data.toString('base64'),
    mime: extToMime(ext),
    size: st.size,
    mtime: st.mtimeMs
  }
}

/** 写入文件并返回新的 mtime。 */
export function writeFile(filePath: string, content: string): number {
  assertWithinRoot(filePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
  return statSync(filePath).mtimeMs
}

/** 写入二进制文件（如 PNG 贴图），返回字节数。 */
export function writeBinaryFile(filePath: string, data: Buffer): number {
  assertWithinRoot(filePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, data)
  return data.length
}

export function createEntry(input: CreateFsEntryInput): FileNode {
  assertWithinRoot(input.parentPath)
  const target = join(input.parentPath, input.name)
  assertWithinRoot(target)
  if (existsSync(target)) throw new Error(`已存在: ${target}`)
  if (input.kind === 'directory') {
    mkdirSync(target, { recursive: true })
  } else {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, '', 'utf-8')
  }
  return toFileNode(target)
}

export function renameEntry(input: RenameFsEntryInput): string {
  assertWithinRoot(input.oldPath)
  const target = join(dirname(input.oldPath), input.newName)
  assertWithinRoot(target)
  if (existsSync(target)) throw new Error(`目标已存在: ${target}`)
  renameSync(input.oldPath, target)
  return target
}

export function deleteEntry(targetPath: string): boolean {
  assertWithinRoot(targetPath)
  if (!existsSync(targetPath)) return false
  rmSync(targetPath, { recursive: true, force: true })
  return true
}

export function copyEntry(input: CopyFsEntryInput): string {
  assertWithinRoot(input.src)
  assertWithinRoot(input.dest)
  if (!existsSync(input.src)) throw new Error(`源不存在: ${input.src}`)
  const st = statSync(input.src)
  if (st.isDirectory()) {
    cpSync(input.src, input.dest, { recursive: true })
  } else {
    mkdirSync(dirname(input.dest), { recursive: true })
    copyFileSync(input.src, input.dest)
  }
  return input.dest
}

/** 移动文件/目录到目标目录（跨目录 rename；目标已存在或源在目标内时拒绝） */
export function moveEntry(src: string, destDir: string): string {
  assertWithinRoot(src)
  assertWithinRoot(destDir)
  if (!existsSync(src)) throw new Error(`源不存在: ${src}`)
  if (!statSync(destDir).isDirectory()) throw new Error(`目标不是目录: ${destDir}`)
  const target = join(destDir, basename(src))
  assertWithinRoot(target)
  if (existsSync(target)) throw new Error(`目标已存在: ${basename(src)}`)
  // 禁止把目录移进自己/自己的子目录
  const rel = relative(src, destDir)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error('不能把目录移动到它自己内部')
  }
  renameSync(src, target)
  return target
}

/** 搜索单轮上限：防止超大项目把 IPC 通道打满 */
export const SEARCH_MAX_RESULTS = 200
/** 搜索遍历的目录深度上限（从 root 算起） */
const SEARCH_MAX_DEPTH = 24

/**
 * 按文件名模糊搜索（大小写不敏感，子串匹配）。
 * 跳过 DEFAULT_EXCLUDE_PATTERNS 目录；结果按「文件优先、路径升序」截断到上限。
 */
export function searchFiles(root: string, query: string, maxResults = SEARCH_MAX_RESULTS): FileNode[] {
  assertWithinRoot(root)
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: FileNode[] = []
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  while (stack.length > 0 && hits.length < maxResults * 2) {
    const { dir, depth } = stack.pop()!
    if (depth > SEARCH_MAX_DEPTH) continue
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (isExcluded(entry.name)) continue
      const abs = join(dir, entry.name)
      try {
        if (entry.isDirectory()) {
          stack.push({ dir: abs, depth: depth + 1 })
        } else if (entry.name.toLowerCase().includes(q)) {
          hits.push(toFileNode(abs))
        }
      } catch {
        /* 跳过无权限项 */
      }
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path)).slice(0, maxResults)
}

export function statEntry(targetPath: string): FileNode | null {
  assertWithinRoot(targetPath)
  if (!existsSync(targetPath)) return null
  return toFileNode(targetPath)
}

/** 规范化路径分隔符，统一用 / 以便前后端一致比较。 */
export function normalizePath(p: string): string {
  return p.split(sep).join('/')
}
