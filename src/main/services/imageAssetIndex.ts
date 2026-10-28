/**
 * 项目图像资产库。
 *
 * 动机：AI 出图/贴图编辑器在「造新贴图」之前，应该先知道项目里已经有什么——
 * 直接复用既有 PNG（改路径引用即可）比重新烧额度生成更快、风格更统一。
 * 语义资产画廊（galleryService）覆盖 .kunyu/content 的像素画，但不覆盖
 * src/main/resources/assets/ 下真实落盘的 PNG（代码生成器产物、手工导入的
 * bbmodel 贴图、GUI/实体贴图等）。本模块补齐这块空白。
 *
 * 设计：
 * - 纯文件扫描，默认只扫 src/main/resources/assets（确定性、不踩构建目录）；
 * - 尺寸解析走 PNG IHDR 头部 33 字节快路径（不整解码，扫几千张也快）；
 *   withStats=true 时才用 pngjs 全解码算透明占比/主色板（带体积/尺寸上限防爆）；
 * - 坏文件（截断/非 PNG 内容）一律跳过，绝不因单张坏图拖垮整个清单；
 * - 无持久化缓存：每次调用现扫。项目贴图量级在百级，现扫足够快且永远新鲜。
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { decodePng } from './ai/pixelize'

/** 单条图像资产清单项 */
export interface ImageAssetEntry {
  /** 项目相对 POSIX 路径（如 src/main/resources/assets/mymod/textures/block/ruby.png） */
  relPath: string
  /** assets/<ns>/ 的命名空间；不在 assets 结构下为 '' */
  namespace: string
  /** textures/ 下第一级子目录（block/item/entity/gui/...）；无则 '' */
  kind: string
  width: number
  height: number
  /** 文件字节数 */
  bytes: number
  mtimeMs: number
  /** IHDR 颜色类型带 alpha 通道（4/6）——「可能含透明」，真实透明占比见 transparentRatio */
  hasAlphaChannel: boolean
  /** withStats：透明像素（alpha<8）占比 0..1 */
  transparentRatio?: number
  /** withStats：不透明像素主色板（按像素数 Top5，#rrggbb） */
  palette?: string[]
}

export interface ImageAssetQuery {
  /** 额外扫描根（相对项目根的 POSIX 路径）；默认 ['src/main/resources/assets'] */
  roots?: string[]
  /** 命名空间过滤（精确） */
  namespace?: string
  /** 类型过滤（精确，如 block/item/entity/gui） */
  kind?: string
  /** 是否全解码统计透明占比/主色板（慢路径，默认 false） */
  withStats?: boolean
  /** 返回上限，默认 500（防超大资源目录刷屏） */
  limit?: number
}

/** 永不进入的目录（额外扫描根防踩坑用） */
const SKIP_DIRS = new Set(['node_modules', '.git', '.gradle', 'build', 'out', 'dist', 'run', '.idea'])

/** withStats 全解码上限：4MB 且单边 ≤4096 */
const STATS_MAX_BYTES = 4 * 1024 * 1024
const STATS_MAX_SIDE = 4096

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 只读前 33 字节解析 IHDR；非 PNG/截断返回 null */
function readPngHeader(abs: string): { width: number; height: number; colorType: number } | null {
  let fd: number
  try {
    fd = openSync(abs, 'r')
  } catch {
    return null
  }
  try {
    const head = Buffer.alloc(33)
    const read = readSync(fd, head, 0, 33, 0)
    if (read < 33) return null
    if (!head.subarray(0, 8).equals(PNG_SIGNATURE)) return null
    if (head.toString('ascii', 12, 16) !== 'IHDR') return null
    return {
      width: head.readUInt32BE(16),
      height: head.readUInt32BE(20),
      colorType: head[25]!
    }
  } catch {
    return null
  } finally {
    try {
      closeSync(fd)
    } catch {
      // 关闭失败无所谓
    }
  }
}

/** 从项目相对路径提取命名空间与类型（assets/<ns>/textures/<kind>/... 结构） */
function parseNamespaceKind(relPosix: string): { namespace: string; kind: string } {
  const segs = relPosix.split('/')
  const ai = segs.indexOf('assets')
  if (ai < 0 || ai + 1 >= segs.length) return { namespace: '', kind: '' }
  const namespace = segs[ai + 1]!
  const ti = segs.indexOf('textures', ai + 2)
  const kind = ti >= 0 && ti + 1 < segs.length - 1 ? segs[ti + 1]! : ''
  return { namespace, kind }
}

/** 递归收集 dir 下全部 .png（绝对路径）；坏目录/权限错误跳过 */
function collectPngs(dir: string, out: string[]): void {
  if (!existsSync(dir)) return
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const abs = join(dir, name)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) collectPngs(abs, out)
    } else if (/\.png$/i.test(name)) {
      out.push(abs)
    }
  }
}

function toHex2(v: number): string {
  return v.toString(16).padStart(2, '0')
}

/** withStats 慢路径：全解码算透明占比 + 主色板 Top5；超限/坏图返回 {} */
function computeStats(abs: string, bytes: number, width: number, height: number): Pick<ImageAssetEntry, 'transparentRatio' | 'palette'> {
  if (bytes > STATS_MAX_BYTES || width > STATS_MAX_SIDE || height > STATS_MAX_SIDE) return {}
  let raster
  try {
    raster = decodePng(readFileSync(abs))
  } catch {
    return {}
  }
  const total = raster.width * raster.height
  if (total === 0) return {}
  let transparent = 0
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  const d = raster.data
  for (let i = 0; i < total; i++) {
    const o = i * 4
    if (d[o + 3]! < 8) {
      transparent++
      continue
    }
    const key = ((d[o]! >> 4) << 8) | ((d[o + 1]! >> 4) << 4) | (d[o + 2]! >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count++
      bucket.r += d[o]!
      bucket.g += d[o + 1]!
      bucket.b += d[o + 2]!
    } else {
      buckets.set(key, { count: 1, r: d[o]!, g: d[o + 1]!, b: d[o + 2]! })
    }
  }
  const palette = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((b) => `#${toHex2(Math.round(b.r / b.count))}${toHex2(Math.round(b.g / b.count))}${toHex2(Math.round(b.b / b.count))}`)
  return { transparentRatio: transparent / total, palette }
}

/**
 * 列出项目内全部 PNG 图像资产（按 relPath 排序）。
 * 任何单文件异常都跳过，绝不抛错。
 */
export function listImageAssets(root: string, query: ImageAssetQuery = {}): ImageAssetEntry[] {
  const roots = query.roots ?? ['src/main/resources/assets']
  const limit = Math.max(1, Math.min(5000, query.limit ?? 500))
  const absPaths: string[] = []
  for (const rel of roots) {
    const absRoot = join(root, ...rel.split('/'))
    // 防逃逸：扫描根必须仍在项目内
    const back = relative(root, absRoot)
    if (back.startsWith('..') || back === '') continue
    collectPngs(absRoot, absPaths)
  }

  const entries: ImageAssetEntry[] = []
  for (const abs of absPaths) {
    const head = readPngHeader(abs)
    if (!head || head.width === 0 || head.height === 0) continue
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    const relPosix = relative(root, abs).split(sep).join('/')
    const { namespace, kind } = parseNamespaceKind(relPosix)
    if (query.namespace && namespace !== query.namespace) continue
    if (query.kind && kind !== query.kind) continue
    const entry: ImageAssetEntry = {
      relPath: relPosix,
      namespace,
      kind,
      width: head.width,
      height: head.height,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      hasAlphaChannel: head.colorType === 4 || head.colorType === 6
    }
    if (query.withStats) Object.assign(entry, computeStats(abs, st.size, head.width, head.height))
    entries.push(entry)
    if (entries.length >= limit) break
  }
  return entries.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/**
 * 关键词检索（供 AI/贴图编辑器「先搜再造」）。
 * 打分：文件名精确命中 +3，文件名子串 +2，类型/命名空间命中 +2，路径子串 +1；
 * 多词（空格分隔）累计，0 分不返回；同分按 relPath 字典序。
 */
export function searchImageAssets(root: string, text: string, query: ImageAssetQuery = {}): ImageAssetEntry[] {
  const all = listImageAssets(root, query)
  const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return all
  const scored: Array<{ entry: ImageAssetEntry; score: number }> = []
  for (const entry of all) {
    const path = entry.relPath.toLowerCase()
    const file = path.split('/').pop()!.replace(/\.png$/, '')
    let score = 0
    for (const token of tokens) {
      if (file === token) score += 3
      else if (file.includes(token)) score += 2
      if (entry.kind.toLowerCase() === token || entry.namespace.toLowerCase() === token) score += 2
      if (path.includes(token)) score += 1
    }
    if (score > 0) scored.push({ entry, score })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.relPath.localeCompare(b.entry.relPath))
    .map((s) => s.entry)
}
