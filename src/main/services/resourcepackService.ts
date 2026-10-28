/**
 * 资源包编辑器主进程服务（P0）。
 * 两种布局：
 * - embedded（模组项目内嵌）：<root>/resourcepacks/<packId>/，可含多个包
 * - standalone（独立资源包项目）：项目根即包根（pack.mcmeta + assets/）
 * 元数据统一存 <root>/.kunyu/resourcepack.json，包内结构可直接 zip 导出。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, join, normalize, relative, sep } from 'node:path'
import type {
  ResourcePackFile,
  ResourcePackMeta
} from '../../shared/schemas/resourcepack.schema'
import {
  buildResourcePackMcmeta,
  classifyResourceFile,
  createResourcePackMeta,
  mcVersionFromPackFormat,
  RESOURCE_CATEGORIES,
  RESOURCE_TEXT_EXT,
  validateResourcePackMeta
} from '../../shared/schemas/resourcepack.schema'
import { validateContentId } from '../../shared/types/content'
import { pixelsToPngRect } from './modelCompiler'
import { collectZipEntries, zipEntries } from './ai/zipUtil'
import { assertWithinRoot, readFile, writeBinaryFile, writeFile } from './fsService'

/** 布局模式：standalone=项目根即包根；embedded=模组项目内 resourcepacks/<packId> */
export type PackMode = 'standalone' | 'embedded'

/** 分类 → 顶层目录名（other 为空串） */
const CATEGORY_DIRS = new Map(RESOURCE_CATEGORIES.map((c) => [c.key, c.dir]))

function metaPath(root: string): string {
  return join(root, '.kunyu', 'resourcepack.json')
}

/** 包根目录（文件操作基准） */
function packRoot(root: string, meta: ResourcePackMeta, mode: PackMode): string {
  return mode === 'standalone' ? root : join(root, 'resourcepacks', meta.packId)
}

function nsDir(root: string, meta: ResourcePackMeta, mode: PackMode): string {
  return join(packRoot(root, meta, mode), 'assets', meta.namespace)
}

/** 读取资源包元数据；未初始化返回 null */
export function readResourcePackMeta(root: string): ResourcePackMeta | null {
  assertWithinRoot(root)
  const p = metaPath(root)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')) as ResourcePackMeta
  } catch {
    return null
  }
}

/**
 * 初始化资源包（幂等）：写元数据 + pack.mcmeta + 标准 assets 目录。
 * pack.mcmeta 已存在时不覆盖（避免丢掉用户编辑）。
 * standalone 模式 packId 可省略（固定 default，路径不依赖它）。
 */
export function initResourcePack(
  root: string,
  input: {
    packId?: string
    name: string
    mcVersion: string
    description: string
    namespace: string
  },
  mode: PackMode = 'embedded'
): ResourcePackMeta {
  assertWithinRoot(root)
  const metaInput = {
    ...input,
    packId: mode === 'standalone' ? input.packId?.trim() || 'default' : input.packId ?? ''
  }
  const meta = createResourcePackMeta(metaInput)
  const err = validateResourcePackMeta(meta)
  if (err) throw new Error(err)

  const metaDir = join(root, '.kunyu')
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true })
  writeFile(metaPath(root), JSON.stringify(meta, null, 2) + '\n')

  // 标准目录骨架
  const base = nsDir(root, meta, mode)
  const dirs = [
    '',
    'blockstates',
    join('models', 'block'),
    join('models', 'item'),
    join('textures', 'block'),
    join('textures', 'item'),
    join('textures', 'entity'),
    join('textures', 'gui'),
    'sounds',
    'font',
    'lang'
  ]
  for (const d of dirs) {
    const abs = d ? join(base, ...d.split('/')) : base
    if (!existsSync(abs)) mkdirSync(abs, { recursive: true })
  }

  const mcmetaPath = join(packRoot(root, meta, mode), 'pack.mcmeta')
  if (!existsSync(mcmetaPath)) writeFile(mcmetaPath, buildResourcePackMcmeta(meta))

  return meta
}

/** 扫描资源包全部文件（递归 assets/ + 包根 pack.mcmeta/pack.png） */
export function listResourceFiles(root: string, mode: PackMode = 'embedded'): ResourcePackFile[] {
  const meta = readResourcePackMeta(root)
  if (!meta) return []
  assertWithinRoot(root)
  const base = packRoot(root, meta, mode)
  if (!existsSync(base)) return []
  const found: string[] = []

  /** 递归收集目录下文件，结果为相对包根的 POSIX 路径 */
  function walk(absDir: string, relPrefix: string): void {
    for (const name of readdirSync(absDir)) {
      const abs = join(absDir, name)
      const relPath = relPrefix ? `${relPrefix}/${name}` : name
      if (statSync(abs).isDirectory()) {
        walk(abs, relPath)
      } else {
        found.push(relPath)
      }
    }
  }

  if (existsSync(join(base, 'assets'))) walk(join(base, 'assets'), 'assets')
  for (const fixed of ['pack.mcmeta', 'pack.png']) {
    if (existsSync(join(base, fixed))) found.push(fixed)
  }

  return found
    .map((relPath) => {
      const abs = join(base, ...relPath.split('/'))
      return toFileNode(relPath, statSync(abs).mtimeMs)
    })
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/** 校验 relPath：必须位于当前资源包内，禁止穿越；返回绝对路径 */
function resolveSafePackPath(
  root: string,
  meta: ResourcePackMeta,
  mode: PackMode,
  relPath: string
): string {
  if (!relPath || relPath.includes('\0')) throw new Error('文件路径不合法')
  const normalized = normalize(relPath).split(sep).join('/')
  const base = packRoot(root, meta, mode)
  const abs = join(base, ...normalized.split('/'))
  const rel = relative(base, abs)
  if (rel.startsWith('..') || normalize(rel) === '..') throw new Error('文件路径越界')
  assertWithinRoot(root)
  assertWithinRoot(abs)
  return abs
}

/** 读取资源包文件原始文本（仅文本类型） */
export function readResourceFile(
  root: string,
  relPath: string,
  mode: PackMode = 'embedded'
): string {
  const meta = requireMeta(root)
  const abs = resolveSafePackPath(root, meta, mode, relPath)
  if (!RESOURCE_TEXT_EXT.has(extOf(relPath))) {
    throw new Error('该文件为二进制资源，P0 暂不支持在编辑器内打开')
  }
  return readFile(abs).content
}

/** 写入资源包文本文件（新建或覆盖），返回文件节点 */
export function writeResourceFile(
  root: string,
  relPath: string,
  content: string,
  mode: PackMode = 'embedded'
): ResourcePackFile {
  const meta = requireMeta(root)
  const abs = resolveSafePackPath(root, meta, mode, relPath)
  const normalized = normalize(relPath).split(sep).join('/')
  const ext = extOf(normalized)
  if (!RESOURCE_TEXT_EXT.has(ext)) throw new Error(`该文件类型不支持文本编辑: ${ext}`)
  if (!content || !content.trim()) throw new Error('文件内容不能为空')
  const dir = join(abs, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFile(abs, content.endsWith('\n') ? content : content + '\n')
  return toFileNode(normalized, statSync(abs).mtimeMs)
}

/** 像素画参数校验（PNG 读写共用） */
function assertPixelCanvas(pixels: string[], width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    width > 1024 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 1024
  ) {
    throw new Error('贴图尺寸必须在 1-1024 之间')
  }
  if (!Array.isArray(pixels) || pixels.length !== width * height) {
    throw new Error(`像素数据长度必须为 ${width * height}`)
  }
}

/** 把像素画写为包内 PNG（新建或覆盖），返回文件节点 */
export function writeResourceTexture(
  root: string,
  relPath: string,
  pixels: string[],
  width: number,
  height: number,
  mode: PackMode = 'embedded'
): ResourcePackFile {
  const meta = requireMeta(root)
  const abs = resolveSafePackPath(root, meta, mode, relPath)
  const normalized = normalize(relPath).split(sep).join('/')
  if (extOf(normalized) !== '.png') throw new Error('贴图文件必须以 .png 结尾')
  assertPixelCanvas(pixels, width, height)
  const dir = join(abs, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeBinaryFile(abs, pixelsToPngRect(pixels, width, height))
  return toFileNode(normalized, statSync(abs).mtimeMs)
}

/** 读取包内 PNG 为 data URL（渲染进程用画布解码成像素） */
export function readResourceTexture(
  root: string,
  relPath: string,
  mode: PackMode = 'embedded'
): string {
  const meta = requireMeta(root)
  const abs = resolveSafePackPath(root, meta, mode, relPath)
  if (extOf(relPath) !== '.png') throw new Error('仅支持读取 PNG 贴图')
  if (!existsSync(abs)) throw new Error('贴图文件不存在')
  return `data:image/png;base64,${readFileSync(abs).toString('base64')}`
}

/** 删除资源包文件；pack.mcmeta 不允许删除 */
export function deleteResourceFile(
  root: string,
  relPath: string,
  mode: PackMode = 'embedded'
): boolean {
  const meta = requireMeta(root)
  const abs = resolveSafePackPath(root, meta, mode, relPath)
  const normalized = normalize(relPath).split(sep).join('/')
  if (normalized === 'pack.mcmeta') throw new Error('pack.mcmeta 为资源包必需文件，不允许删除')
  if (!existsSync(abs)) return false
  rmSync(abs, { force: true })
  return true
}

/**
 * 导入资源包图标：将用户选择的图片复制为包根 pack.png。
 * @param srcPath 用户通过系统文件选择器选中的源图片
 */
export function importPackIcon(
  root: string,
  srcPath: string,
  mode: PackMode = 'embedded'
): string {
  const meta = requireMeta(root)
  assertWithinRoot(root)
  if (!existsSync(srcPath) || !statSync(srcPath).isFile()) {
    throw new Error('源图片不存在')
  }
  const lower = srcPath.toLowerCase()
  if (!lower.endsWith('.png')) throw new Error('资源包图标必须为 PNG 图片')
  const dest = join(packRoot(root, meta, mode), 'pack.png')
  copyFileSync(srcPath, dest)
  return 'pack.png'
}

/**
 * 导入 .ogg 音效：复制到 assets/<ns>/sounds/ 下（文件名主干须为合法内容 ID），
 * 返回包内相对路径。同名已存在则覆盖（用户经系统选择器显式确认来源）。
 */
export function importResourceSound(
  root: string,
  srcPath: string,
  mode: PackMode = 'embedded'
): string {
  const meta = requireMeta(root)
  assertWithinRoot(root)
  if (!existsSync(srcPath) || !statSync(srcPath).isFile()) {
    throw new Error('源音频文件不存在')
  }
  const fileName = basename(srcPath)
  if (!fileName.toLowerCase().endsWith('.ogg')) throw new Error('音效文件必须为 .ogg 格式')
  const stem = fileName.slice(0, -4)
  if (!validateContentId(stem)) {
    throw new Error('文件名主干不合法：小写字母开头，仅含小写字母、数字、下划线')
  }
  const relPath = `assets/${meta.namespace}/sounds/${stem}.ogg`
  copyFileSync(srcPath, join(nsDir(root, meta, mode), 'sounds', `${stem}.ogg`))
  return relPath
}

/** 读取包内 .ogg 为 data URL（渲染进程试听用；上限 8MB 防内存暴涨） */
export function readResourceSound(
  root: string,
  relPath: string,
  mode: PackMode = 'embedded'
): string {
  const meta = requireMeta(root)
  const abs = resolveSafePackPath(root, meta, mode, relPath)
  if (extOf(relPath) !== '.ogg') throw new Error('仅支持读取 .ogg 音效')
  if (!existsSync(abs)) throw new Error('音效文件不存在')
  const stat = statSync(abs)
  if (stat.size > 8 * 1024 * 1024) throw new Error('音效文件超过 8MB，请用系统播放器试听')
  return `data:audio/ogg;base64,${readFileSync(abs).toString('base64')}`
}

/**
 * standalone 自动升级：项目根存在 pack.mcmeta 但缺少编辑器元数据时，
 * 从 pack.mcmeta（pack_format/description）与 assets/ 目录（namespace）推导元数据并落盘，
 * 同时补全标准目录。已初始化（.kunyu/resourcepack.json 已存在）时返回现有元数据。
 * @returns 无法识别（无 pack.mcmeta）返回 null
 */
export function upgradeStandaloneResourcePack(root: string): ResourcePackMeta | null {
  assertWithinRoot(root)
  const existing = readResourcePackMeta(root)
  if (existing) return existing

  const mcmetaAbs = join(root, 'pack.mcmeta')
  if (!existsSync(mcmetaAbs)) return null
  let packFormat: number | undefined
  let description = ''
  try {
    const parsed = JSON.parse(readFileSync(mcmetaAbs, 'utf-8').replace(/^\uFEFF/, '')) as {
      pack?: { pack_format?: number; description?: string }
    }
    packFormat = parsed.pack?.pack_format
    if (typeof parsed.pack?.description === 'string') description = parsed.pack.description
  } catch {
    return null
  }
  const format = packFormat ?? 15

  // namespace：assets/ 下首个合法命名空间目录
  let namespace = 'mymod'
  const assetsDir = join(root, 'assets')
  if (existsSync(assetsDir)) {
    const ns = readdirSync(assetsDir).find(
      (n) => statSync(join(assetsDir, n)).isDirectory() && validateContentId(n)
    )
    if (ns) namespace = ns
  }

  const now = Date.now()
  const meta: ResourcePackMeta = {
    packId: 'default',
    name: basename(root) || 'resourcepack',
    mcVersion: mcVersionFromPackFormat(format),
    packFormat: format,
    description,
    namespace,
    createdAt: now,
    updatedAt: now
  }
  const metaDir = join(root, '.kunyu')
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true })
  writeFile(metaPath(root), JSON.stringify(meta, null, 2) + '\n')

  // 补全标准目录（已存在跳过）
  const base = join(root, 'assets', namespace)
  const dirs = [
    '',
    'blockstates',
    join('models', 'block'),
    join('models', 'item'),
    join('textures', 'block'),
    join('textures', 'item'),
    join('textures', 'entity'),
    join('textures', 'gui'),
    'sounds',
    'font',
    'lang'
  ]
  for (const d of dirs) {
    const abs = d ? join(base, ...d.split('/')) : base
    if (!existsSync(abs)) mkdirSync(abs, { recursive: true })
  }
  return meta
}

/** 校验新建文件名（含扩展名的完整名），允许 a/b 子路径与常见资源扩展名 */
export function validateNewResourcePath(fileName: string): string | null {
  if (!fileName) return '文件名不能为空'
  if (fileName.includes('..')) return '文件名不能包含 ..'
  const segs = fileName.split('/').filter(Boolean)
  if (segs.length === 0) return '文件名不能为空'
  for (const s of segs) {
    if (!/^[a-z0-9_./-]+$/.test(s)) return '文件名仅允许小写字母、数字、下划线、连字符'
  }
  const last = segs[segs.length - 1]
  if (!last.includes('.')) return '文件名必须包含扩展名'
  const base = last.slice(0, last.lastIndexOf('.'))
  if (!validateContentId(base)) return '文件名主干不合法：小写字母开头，仅含小写字母、数字、下划线'
  return null
}

/**
 * 导出可分发资源包 zip（MC 约定：zip 顶层为 pack.mcmeta + assets/，不多套一层目录）。
 * 固定产物路径 <root>/dist/<packId>.zip（与整合包/光影包 dist/ 约定一致，避免渲染层
 * 传入任意写盘路径）；重复导出覆盖旧包。返回产物绝对路径。
 * standalone 模式包根即项目根，必须用白名单过滤（仅 pack.mcmeta / pack.png / assets/**），
 * 排除 .kunyu/ 元数据与 dist/ 旧产物。
 */
export function exportResourcePackZip(root: string, mode: PackMode = 'embedded'): string {
  assertWithinRoot(root)
  const meta = requireMeta(root)
  const base = packRoot(root, meta, mode)
  if (!existsSync(join(base, 'pack.mcmeta')) || !existsSync(join(base, 'assets'))) {
    throw new Error('资源包目录不完整：缺少 pack.mcmeta 或 assets/，无法导出')
  }
  const entries = collectZipEntries(base, {
    filter: (rel) => rel === 'pack.mcmeta' || rel === 'pack.png' || rel.startsWith('assets/')
  })
  const outZip = join(root, 'dist', `${meta.packId}.zip`)
  zipEntries(entries, outZip)
  return outZip
}

function extOf(relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

function toFileNode(relPath: string, mtime: number): ResourcePackFile {
  const parts = relPath.split('/')
  const base = parts[parts.length - 1]
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : ''
  let category: ResourcePackFile['category'] = 'root'
  let id = base
  if (parts[0] === 'assets' && parts.length >= 3) {
    // assets/<ns>/<categoryDir>/...
    const relToNs = parts.slice(2).join('/')
    category = classifyResourceFile(relToNs)
    // id 为组内相对前缀（去掉类别目录段与扩展名），如 models/block/a.json → block/a
    const catDir = CATEGORY_DIRS.get(category)
    const withinCat =
      catDir && relToNs.startsWith(`${catDir}/`)
        ? relToNs.slice(catDir.length + 1)
        : relToNs
    id = ext ? withinCat.slice(0, withinCat.length - ext.length) : withinCat
    if (!id) id = base
  }
  return {
    id,
    relPath,
    category,
    ext,
    editable: RESOURCE_TEXT_EXT.has(ext),
    updatedAt: mtime
  }
}

function requireMeta(root: string): ResourcePackMeta {
  const meta = readResourcePackMeta(root)
  if (!meta) throw new Error('尚未创建资源包，请先初始化')
  return meta
}
