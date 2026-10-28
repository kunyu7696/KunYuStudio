/**
 * 本地知识库 RAG（C2）：全部推理在本机用 onnxruntime 跑 @xenova/transformers，
 * 不经过任何云端 embedding 服务。模型首次使用时从 HuggingFace（或 HF_ENDPOINT 镜像）
 * 下载到本机缓存，之后完全离线可用。
 *
 * 设计约束：
 * - 模块顶层不 import electron / xenova，保证 vitest 纯 Node 可测；
 * - 模型加载与索引建立都是懒触发，embedding 失败自动降级为关键词检索，绝不阻塞造匠；
 * - 向量缓存按「文件相对路径 + mtime + chunk 数」失效，以二进制格式落盘在注入的 cachePath；
 * - 语料清单优先取调用方注入的精确清单（listFiles，如按 manifest 活跃组合挑选），
 *   缺失时回退目录遍历；一律排序后再截断，杜绝枚举顺序随机丢文件；
 * - watch:true 时 fs.watch 语料目录，变更防抖后热重载 chunk 并增量重编码。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
  type Dirent,
  type FSWatcher
} from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import type { KbRagRootStat, KbRagStatus } from '../../../shared/types/models'

export type { KbRagRootStat, KbRagStatus } from '../../../shared/types/models'

/** 语料文件白名单（参考包内的文档 / Java 模板 / JSON 配方样例） */
const CORPUS_EXTENSIONS = new Set(['.md', '.txt', '.java', '.json'])
/** 遍历时跳过的目录 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', '.gradle', 'run', '.kunyu'])
/**
 * 语料文件数上限：对齐 manifest 清单规模（1574 模板 + 根文档 + knowledge 语料约 36）
 * 并留余量；精确清单与目录遍历统一排序后按此截断（确定性，不再随机丢弃）。
 */
const MAX_FILES = 2048
/** 单块目标字符数（中文约 600 字，兼顾召回粒度与工具上下文体积） */
const CHUNK_TARGET = 600
const CHUNK_OVERLAP = 80
const EMBED_BATCH = 8

export interface KbChunk {
  /** file + 块序号拼出的稳定 id */
  id: string
  /** 绝对路径 */
  file: string
  /** 相对语料根的展示路径（多个根时带根别名前缀） */
  relPath: string
  /** 文件内块序号 */
  index: number
  /** 块正文 */
  text: string
}

export interface KbHit {
  chunk: KbChunk
  /** 0..1：向量路径为余弦×0.7 + 关键词×0.3 的混合得分；降级路径为关键词重叠归一得分 */
  score: number
}

export interface Embedder {
  readonly model: string
  embed(texts: string[]): Promise<number[][]>
}

export interface CorpusRoot {
  /** 展示用别名（命中结果里区分来源） */
  alias: string
  dir: string
}

/** 内部状态：面板展示字段（roots/cacheBytes/watching）在 status() 读取时计算 */
type CoreStatus = Omit<KbRagStatus, 'roots' | 'cacheBytes' | 'watching'>

export interface CreateKbRagOptions {
  roots: CorpusRoot[]
  /** 向量缓存落盘路径（userData 下） */
  cachePath: string
  /** 模型下载/缓存目录（userData 下），不传走 xenova 默认 */
  modelsDir?: string
  /** 覆盖默认模型（也可由 KUNYU_EMBED_MODEL 环境变量指定） */
  model?: string
  /** 测试注入：跳过 xenova 直接给 embedder */
  embedder?: Embedder
  /** 单文件块数上限，防御超大文件 */
  maxChunksPerFile?: number
  /**
   * 精确语料清单（如按 manifest 活跃组合挑选模板文件）。
   * 返回 null / 空数组时回退 roots 目录遍历；与遍历结果一样排序后按 maxFiles 截断。
   */
  listFiles?: () => Array<{ alias: string; file: string }> | null
  /** 语料文件数上限（排序后截断），默认 2048（manifest 清单规模 + 余量） */
  maxFiles?: number
  /** 监听语料目录变更并热重载 chunk（fs.watch 递归，平台不支持时静默降级） */
  watch?: boolean
}

export interface CacheShape {
  model: string
  files: Record<string, { mtimeMs: number; count: number; vectors: number[][] }>
}

const DEFAULT_MODEL = 'Xenova/bge-small-zh-v1.5'

/* ------------------------------------------------------------------ */
/* 语料遍历与分块                                                      */
/* ------------------------------------------------------------------ */

/** 递归收集语料文件（结果为 [rootAlias, absolutePath]，排序后截断保证确定性）。 */
export function collectCorpusFiles(roots: CorpusRoot[], maxFiles = MAX_FILES): Array<{ alias: string; file: string }> {
  const out: Array<{ alias: string; file: string }> = []
  const walk = (alias: string, dir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(alias, abs)
      } else if (entry.isFile() && CORPUS_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        out.push({ alias, file: abs })
      }
    }
  }
  for (const root of roots) {
    if (existsSync(root.dir)) walk(root.alias, root.dir)
  }
  // 先排序再截断：readdirSync 枚举顺序不确定，旧实现达上限即停会随机丢弃文件
  out.sort((a, b) => `${a.alias}/${a.file}`.localeCompare(`${b.alias}/${b.file}`))
  return out.slice(0, Math.max(1, maxFiles))
}

/** 去掉 BOM 并规范换行 */
function readText(file: string): string {
  return readFileSync(file, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

/**
 * 分块：先按 markdown 标题切段，超长段再按行打包到 CHUNK_TARGET，
 * 相邻块保留 CHUNK_OVERLAP 字符尾巴，避免代码片段从中间被切断。
 */
export function chunkText(relPath: string, file: string, content: string, maxChunksPerFile = 80): KbChunk[] {
  const sections = splitByHeadings(content)
  const raw: string[] = []
  for (const section of sections) {
    if (section.length <= CHUNK_TARGET) {
      raw.push(section)
      continue
    }
    const lines = section.split('\n')
    let buf = ''
    for (const line of lines) {
      if ((buf + '\n' + line).length > CHUNK_TARGET && buf) {
        raw.push(buf)
        buf = buf.length > CHUNK_OVERLAP ? buf.slice(-CHUNK_OVERLAP) + '\n' + line : buf + '\n' + line
      } else {
        buf = buf ? buf + '\n' + line : line
      }
    }
    if (buf.trim()) raw.push(buf)
  }
  return raw
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, maxChunksPerFile)
    .map((text, index) => ({ id: `${relPath}#${index}`, file, relPath, index, text }))
}

/** markdown 标题切段（非 md 文件整体作为一段，由后续按行兜底切分）。 */
function splitByHeadings(content: string): string[] {
  if (!/^#{1,4}\s/m.test(content)) return [content]
  const lines = content.split('\n')
  const sections: string[] = []
  let current = ''
  for (const line of lines) {
    if (/^#{1,4}\s/.test(line) && current.trim()) {
      sections.push(current.trim())
      current = line + '\n'
    } else {
      current += (current ? '\n' : '') + line
    }
  }
  if (current.trim()) sections.push(current.trim())
  return sections.length > 0 ? sections : [content]
}

/* ------------------------------------------------------------------ */
/* 关键词检索（无模型时的降级路径，也是向量结果为空时的兜底）            */
/* ------------------------------------------------------------------ */

/** 中英文混合分词：英文/数字按词，中文切单字 + 相邻二元组。 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  const wordRe = /[a-z0-9_./:-]+/g
  let m: RegExpExecArray | null
  const cjkRuns: string[] = []
  let lastIndex = 0
  while ((m = wordRe.exec(lower)) !== null) {
    if (m[0].length >= 2) tokens.push(m[0])
    const between = lower.slice(lastIndex, m.index)
    const cjk = between.match(/[\u4e00-\u9fff]+/g)
    if (cjk) cjkRuns.push(...cjk)
    lastIndex = wordRe.lastIndex
  }
  const tail = lower.slice(lastIndex).match(/[\u4e00-\u9fff]+/g)
  if (tail) cjkRuns.push(...tail)
  for (const run of cjkRuns) {
    for (const ch of run) tokens.push(ch)
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

function keywordScore(queryTokens: Set<string>, text: string): number {
  const docTokens = tokenize(text)
  if (docTokens.length === 0 || queryTokens.size === 0) return 0
  let hit = 0
  for (const t of docTokens) if (queryTokens.has(t)) hit++
  // 词频 / 文档长度归一，再按命中文档数加权效果靠短查询已够用
  return hit / Math.sqrt(docTokens.length)
}

/* ------------------------------------------------------------------ */
/* 混合重排：向量召回候选 + 词面信号融合                       */
/* ------------------------------------------------------------------ */

/** 重排时的向量得分权重；词面信号占 1-此值。 */
export const RERANK_VECTOR_WEIGHT = 0.7
/** 候选池扩取倍数：先按余弦取 top k×倍数，再混合重排截回 k。 */
export const RERANK_CANDIDATE_FACTOR = 3
/** 候选池硬上限，防御 k 被工具参数放大后重排成本膨胀 */
export const RERANK_CANDIDATE_CAP = 30

/**
 * 对向量召回的候选做词面融合重排（纯函数，可测）。
 * 两路信号各自在候选池内归一到 0..1（最大值归一），再按权重混合：
 *   final = 0.7 × cosine归一 + 0.3 × 关键词归一
 * 解决「语义相近但词面错位」的 embedding 失配（如 MC 标识符/类名查询），
 * 同时保持语义主导——词面重合只能在小分差内翻盘（cosine 归一差 >0.43 时翻不动）。
 * 某路信号全 0 时该路不贡献，候选不足 k 时如实返回。
 */
export function blendRerank(query: string, candidates: KbHit[], k: number): KbHit[] {
  if (candidates.length <= 1) return candidates.slice(0, k)
  const qTokens = new Set(tokenize(query))
  const kwScores = candidates.map((h) => keywordScore(qTokens, h.chunk.text))
  const maxCos = Math.max(...candidates.map((h) => h.score), 0)
  const maxKw = Math.max(...kwScores, 0)
  return candidates
    .map((h, i) => {
      const cosNorm = maxCos > 0 ? h.score / maxCos : 0
      const kwNorm = maxKw > 0 ? kwScores[i]! / maxKw : 0
      return { chunk: h.chunk, score: RERANK_VECTOR_WEIGHT * cosNorm + (1 - RERANK_VECTOR_WEIGHT) * kwNorm }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

/* ------------------------------------------------------------------ */
/* 向量工具                                                            */
/* ------------------------------------------------------------------ */

function cosine(a: number[], b: number[]): number {
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += a[i] * b[i]
  return dot
}

/** bge 系列中文模型的官方查询前缀（只加在 query 上，不加在语料上）。 */
function queryPrefixFor(model: string): string {
  return /bge/i.test(model) ? '为这个句子生成表示以用于检索相关文章：' : ''
}

/* ------------------------------------------------------------------ */
/* 向量缓存二进制编解码                                                  */
/* ------------------------------------------------------------------ */

/**
 * 二进制缓存格式（小端）：
 *   4B magic 'KYKB' | u32 版本(1) | u16 模型名长 | u32 向量维度 | 模型名 utf8
 *   u32 文件数
 *   逐文件：u16 路径长 | f64 mtimeMs | u32 块数 | 路径 utf8 | 块数×维度 f32
 * 相比 JSON 体积约降为 1/5，启动免去大 JSON parse；损坏/模型不符一律返回 null 重编码。
 */
const CACHE_MAGIC = 'KYKB'
const CACHE_VERSION = 1
/** 维度防御上限（异常文件不至于读出天文数字维度的向量） */
const CACHE_MAX_DIM = 8192

export function serializeCache(cache: CacheShape): Buffer {
  // 维度取首个向量；维度不一致的条目跳过（模型混用防御）
  const entries = Object.entries(cache.files).filter(([, v]) => v.vectors.length > 0)
  const dim = entries[0]?.[1].vectors[0]?.length ?? 0
  const consistent = entries.filter(([, v]) => v.vectors.every((vec) => vec.length === dim))
  const modelBuf = Buffer.from(cache.model, 'utf-8')
  const head = Buffer.alloc(14)
  head.write(CACHE_MAGIC, 0, 'latin1')
  head.writeUInt32LE(CACHE_VERSION, 4)
  head.writeUInt16LE(modelBuf.length, 8)
  head.writeUInt32LE(dim, 10)
  const parts: Buffer[] = [head, modelBuf]
  const countBuf = Buffer.alloc(4)
  countBuf.writeUInt32LE(consistent.length, 0)
  parts.push(countBuf)
  for (const [file, rec] of consistent) {
    const pathBuf = Buffer.from(file, 'utf-8')
    const meta = Buffer.alloc(14)
    meta.writeUInt16LE(pathBuf.length, 0)
    meta.writeDoubleLE(rec.mtimeMs, 2)
    meta.writeUInt32LE(rec.vectors.length, 10)
    parts.push(meta, pathBuf)
    const vecBuf = Buffer.alloc(rec.vectors.length * dim * 4)
    rec.vectors.forEach((vec, i) => {
      for (let d = 0; d < dim; d++) vecBuf.writeFloatLE(vec[d] ?? 0, (i * dim + d) * 4)
    })
    parts.push(vecBuf)
  }
  return Buffer.concat(parts)
}

export function parseCache(buf: Buffer, model: string): CacheShape | null {
  try {
    if (buf.length < 18) return null
    if (buf.subarray(0, 4).toString('latin1') !== CACHE_MAGIC || buf.readUInt32LE(4) !== CACHE_VERSION) return null
    const modelLen = buf.readUInt16LE(8)
    const dim = buf.readUInt32LE(10)
    if (dim <= 0 || dim > CACHE_MAX_DIM) return null
    let off = 14
    if (off + modelLen > buf.length) return null
    const cacheModel = buf.subarray(off, off + modelLen).toString('utf-8')
    off += modelLen
    if (cacheModel !== model) return null
    if (off + 4 > buf.length) return null
    const fileCount = buf.readUInt32LE(off)
    off += 4
    const files: CacheShape['files'] = {}
    for (let f = 0; f < fileCount; f++) {
      if (off + 14 > buf.length) return null
      const pathLen = buf.readUInt16LE(off)
      const mtimeMs = buf.readDoubleLE(off + 2)
      const count = buf.readUInt32LE(off + 10)
      off += 14
      if (off + pathLen > buf.length) return null
      const file = buf.subarray(off, off + pathLen).toString('utf-8')
      off += pathLen
      const need = count * dim * 4
      if (off + need > buf.length) return null
      const vectors: number[][] = []
      for (let i = 0; i < count; i++) {
        const v = new Array<number>(dim)
        for (let d = 0; d < dim; d++) v[d] = buf.readFloatLE(off + (i * dim + d) * 4)
        vectors.push(v)
      }
      off += need
      files[file] = { mtimeMs, count, vectors }
    }
    return { model: cacheModel, files }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 主工厂                                                              */
/* ------------------------------------------------------------------ */

export function createKbRag(options: CreateKbRagOptions) {
  const model = options.model ?? process.env['KUNYU_EMBED_MODEL'] ?? DEFAULT_MODEL
  const maxChunks = options.maxChunksPerFile ?? 80
  const maxFiles = options.maxFiles ?? MAX_FILES

  let currentFiles: Array<{ alias: string; file: string }> = []
  const chunks: KbChunk[] = []
  const fileAlias = new Map<string, string>()

  /** 语料清单：优先调用方精确清单（manifest 活跃组合），缺失回退目录遍历；统一排序截断 */
  function gatherFiles(): Array<{ alias: string; file: string }> {
    const listed = options.listFiles?.()
    if (listed && listed.length > 0) {
      const seen = new Set<string>()
      const deduped = listed.filter((f) => {
        const key = resolve(f.file)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      deduped.sort((a, b) => `${a.alias}/${a.file}`.localeCompare(`${b.alias}/${b.file}`))
      return deduped.slice(0, maxFiles)
    }
    return collectCorpusFiles(options.roots, maxFiles)
  }

  /** 扫语料并重建 chunk（原地替换数组内容，保持对外 chunks 引用不变） */
  function scanCorpus(): void {
    // 缓存文件（含旧 JSON 缓存）可能恰好落在语料目录内（测试或自定义路径），
    // 必须排除，否则缓存会把自己当语料反复重编码
    const cacheAbs = resolve(options.cachePath)
    const legacyAbs = resolve(legacyJsonCachePath())
    currentFiles = gatherFiles().filter((f) => {
      const abs = resolve(f.file)
      return abs !== cacheAbs && abs !== legacyAbs
    })
    fileAlias.clear()
    const next: KbChunk[] = []
    for (const { alias, file } of currentFiles) {
      try {
        const rootDir = options.roots.find((r) => r.alias === alias)?.dir ?? dirname(file)
        const rel = `${alias}/${relative(rootDir, file).replace(/\\/g, '/')}`
        next.push(...chunkText(rel, file, readText(file), maxChunks))
        fileAlias.set(file, alias)
      } catch {
        /* 单个文件读失败跳过 */
      }
    }
    chunks.length = 0
    chunks.push(...next)
  }

  // 启动即扫语料（纯文件 IO，失败不致命）
  scanCorpus()

  /** 文件 → mtime（缓存有效性判定用） */
  function fileMtime(file: string): number {
    try {
      return statSync(file).mtimeMs
    } catch {
      return 0
    }
  }

  let status: CoreStatus = { ready: false, reason: '尚未初始化向量索引', model, chunks: chunks.length, files: currentFiles.length, backend: 'idle' }
  let vectors: Map<string, number[]> | null = null // chunk.id -> 向量
  let initPromise: Promise<void> | null = null
  // 上一次初始化失败的时间戳。失败后的冷却窗口内 ensureReady 直接返回，
  // 不再反复重试——实测模型不可达时每次检索都重新走下载流程（~10.7s/次），成本被反复支付。
  let lastInitFailAt = 0
  /** 初始化失败冷却窗口；窗口过后允许重试（网络/缓存恢复后自愈） */
  const INIT_RETRY_COOLDOWN_MS = 5 * 60 * 1000
  /** 旧 JSON 缓存迁移标记：loadCache 命中旧格式后，saveCache 写二进制并删旧文件 */
  let migratedLegacy = false
  let reloading: Promise<void> | null = null
  let watchers: FSWatcher[] = []
  let watchTimer: ReturnType<typeof setTimeout> | null = null

  function rootStats(): KbRagRootStat[] {
    const stats = new Map<string, KbRagRootStat>()
    for (const { alias, file } of currentFiles) {
      const s = stats.get(alias) ?? { alias, files: 0, chunks: 0 }
      s.files += 1
      stats.set(alias, s)
      void file
    }
    for (const c of chunks) {
      const s = stats.get(fileAlias.get(c.file) ?? '')
      if (s) s.chunks += 1
    }
    return [...stats.values()]
  }

  function statusView(): KbRagStatus {
    let cacheBytes = 0
    try {
      cacheBytes = statSync(options.cachePath).size
    } catch {
      /* 无缓存 */
    }
    return { ...status, roots: rootStats(), cacheBytes, watching: watchers.length > 0 }
  }

  /** 旧 JSON 缓存的历史固定文件名（与 cachePath 同目录） */
  function legacyJsonCachePath(): string {
    return join(dirname(options.cachePath), 'embeddings.json')
  }

  function loadCache(): CacheShape | null {
    try {
      if (existsSync(options.cachePath)) {
        const parsed = parseCache(readFileSync(options.cachePath), model)
        if (parsed) return parsed
      }
      // 旧 JSON 缓存一次性迁移：解析成功即采用，下次 saveCache 写二进制并删旧文件
      const legacy = legacyJsonCachePath()
      if (resolve(legacy) !== resolve(options.cachePath) && existsSync(legacy)) {
        const raw = JSON.parse(readFileSync(legacy, 'utf-8')) as CacheShape
        if (raw && raw.model === model && typeof raw.files === 'object') {
          migratedLegacy = true
          return raw
        }
      }
      return null
    } catch {
      return null
    }
  }

  function saveCache(cache: CacheShape): void {
    try {
      mkdirSync(dirname(options.cachePath), { recursive: true })
      const tmp = `${options.cachePath}.tmp`
      writeFileSync(tmp, serializeCache(cache))
      renameSync(tmp, options.cachePath)
      if (migratedLegacy) {
        migratedLegacy = false
        try {
          unlinkSync(legacyJsonCachePath())
        } catch {
          /* 旧文件删除失败无害 */
        }
      }
    } catch {
      /* 缓存写失败不影响检索 */
    }
  }

  /** 懒加载 xenova 模型；动态 import 让未安装依赖 / 无网络环境都能软降级。 */
  async function createXenovaEmbedder(): Promise<Embedder> {
    if (options.embedder) return options.embedder
    // 国内网络默认走 hf-mirror，用户显式设置过 HF_ENDPOINT 则不覆盖
    process.env['HF_ENDPOINT'] ??= 'https://hf-mirror.com'
    const mod = (await import('@xenova/transformers')) as typeof import('@xenova/transformers')
    if (options.modelsDir) {
      mod.env.cacheDir = options.modelsDir
    }
    const extractor = await mod.pipeline('feature-extraction', model, {
      quantized: true
    })
    return {
      model,
      async embed(texts: string[]): Promise<number[][]> {
        const out: number[][] = []
        for (let i = 0; i < texts.length; i += EMBED_BATCH) {
          const batch = texts.slice(i, i + EMBED_BATCH)
          const tensor = await extractor(batch, { pooling: 'mean', normalize: true })
          // 批输入输出形状 [batch, dim]
          const data = tensor.data as Float32Array
          const dim = tensor.dims[tensor.dims.length - 1] ?? 0
          for (let b = 0; b < batch.length; b++) {
            out.push(Array.from(data.subarray(b * dim, (b + 1) * dim)))
          }
        }
        return out
      }
    }
  }

  async function ensureReady(): Promise<void> {
    if (status.ready) return
    if (initPromise) return initPromise
    // 失败冷却窗口内不重试，直接以当前降级状态返回；
    // 窗口过后允许重试（网络恢复 / 模型缓存补全后自愈）。
    if (Date.now() - lastInitFailAt < INIT_RETRY_COOLDOWN_MS) return
    initPromise = (async () => {
      status = { ...status, ready: false, backend: 'downloading', reason: '正在加载本地 embedding 模型并编码语料（首次需要下载模型）…' }
      const cache = loadCache() ?? { model, files: {} }
      const byFile = new Map<string, KbChunk[]>()
      for (const chunk of chunks) {
        const list = byFile.get(chunk.file) ?? []
        list.push(chunk)
        byFile.set(chunk.file, list)
      }
      const embedder = await createXenovaEmbedder()
      const next: CacheShape = { model, files: {} }
      const pending: KbChunk[] = []
      const restored = new Map<string, number[]>()
      for (const [file, fileChunks] of byFile) {
        const cached = cache.files[file]
        const mtime = fileMtime(file)
        if (cached && cached.mtimeMs === mtime && cached.count === fileChunks.length && cached.vectors.length === fileChunks.length) {
          next.files[file] = cached
          fileChunks.forEach((c, i) => restored.set(c.id, cached.vectors[i]!))
        } else {
          pending.push(...fileChunks)
        }
      }
      const computedVectors = new Map(restored)
      if (pending.length > 0) {
        const vecs = await embedder.embed(pending.map((c) => c.text))
        pending.forEach((c, i) => {
          if (vecs[i]) computedVectors.set(c.id, vecs[i]!)
        })
      }
      // 回写缓存（逐文件组织）；旧 JSON 缓存迁移场景即使零待编码也重写为二进制并删旧文件
      if (pending.length > 0 || migratedLegacy) {
        for (const [file, fileChunks] of byFile) {
          const vecsForFile = fileChunks.map((c) => computedVectors.get(c.id)).filter((v): v is number[] => !!v)
          if (vecsForFile.length === fileChunks.length) {
            next.files[file] = { mtimeMs: fileMtime(file), count: fileChunks.length, vectors: vecsForFile }
          }
        }
        saveCache(next)
      }
      vectors = computedVectors
      status = { ready: true, model, chunks: chunks.length, files: currentFiles.length, backend: 'embedded-ready' }
    })()
    try {
      await initPromise
    } catch (err) {
      lastInitFailAt = Date.now()
      status = {
        ready: false,
        model,
        chunks: chunks.length,
        files: currentFiles.length,
        backend: 'fallback-keyword',
        reason: `向量索引不可用，已降级为关键词检索（${INIT_RETRY_COOLDOWN_MS / 60000} 分钟内不再重试下载模型）：${(err as Error).message}`
      }
      initPromise = null // 冷却窗口过后允许重试（自愈）
    }
  }

  function keywordSearch(query: string, k: number): KbHit[] {
    const qTokens = new Set(tokenize(query))
    return chunks
      .map((chunk) => ({ chunk, score: keywordScore(qTokens, chunk.text) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }

  async function search(query: string, k = 6): Promise<{ hits: KbHit[]; degraded: boolean; reason?: string }> {
    const trimmed = query.trim()
    if (!trimmed) return { hits: [], degraded: false }
    await ensureReady()
    if (!status.ready || !vectors) {
      return { hits: keywordSearch(trimmed, k), degraded: true, reason: status.reason }
    }
    const embedder = await createXenovaEmbedder().catch(() => null)
    if (!embedder) {
      return { hits: keywordSearch(trimmed, k), degraded: true, reason: status.reason }
    }
    const qv = (await embedder.embed([queryPrefixFor(model) + trimmed]))[0]
    if (!qv) return { hits: keywordSearch(trimmed, k), degraded: true }
    const ranked = chunks
      .map((chunk) => ({ chunk, score: vectors!.get(chunk.id) ? cosine(qv, vectors!.get(chunk.id)!) : -1 }))
      .filter((h) => h.score >= 0)
      .sort((a, b) => b.score - a.score)
    // 低相似度门基于原始余弦顶分判定（混合分与 0.2 阈值不可比）
    if (ranked.length === 0 || (ranked[0]?.score ?? 0) < 0.2) {
      const kw = keywordSearch(trimmed, k)
      if (kw.length > 0) return { hits: kw, degraded: true, reason: '向量相似度过低，已改用关键词匹配' }
    }
    // 候选扩取后词面融合重排，遏制「语义相近但词面错位」的 embedding 失配
    const pool = ranked.slice(0, Math.min(k * RERANK_CANDIDATE_FACTOR, RERANK_CANDIDATE_CAP))
    return { hits: blendRerank(trimmed, pool, k), degraded: false }
  }

  /**
   * 热重载：重扫语料重建 chunk；已就绪过则按 mtime 增量重编码（未变更文件命中缓存）。
   * 未初始化过的实例保持懒语义——只重扫 chunk，不触发模型加载。
   */
  async function reload(): Promise<void> {
    if (reloading) return reloading
    reloading = (async () => {
      // 等在途初始化落定，避免 chunks 在编码中途被换掉
      if (initPromise) await initPromise.catch(() => undefined)
      const wasReady = status.ready
      scanCorpus()
      status = {
        ...status,
        ready: false,
        chunks: chunks.length,
        files: currentFiles.length,
        backend: wasReady ? 'downloading' : status.backend,
        reason: wasReady ? '语料变更，正在增量重编码…' : status.reason
      }
      if (wasReady) {
        vectors = null
        initPromise = null
        await ensureReady()
      }
    })()
    try {
      await reloading
    } finally {
      reloading = null
    }
  }

  /** 重建索引：删缓存后全量重编码（用户显式动作，跳过失败冷却窗口） */
  async function rebuild(): Promise<void> {
    if (initPromise) await initPromise.catch(() => undefined)
    try {
      unlinkSync(options.cachePath)
    } catch {
      /* 无缓存可删 */
    }
    lastInitFailAt = 0
    scanCorpus()
    vectors = null
    initPromise = null
    status = {
      ready: false,
      model,
      chunks: chunks.length,
      files: currentFiles.length,
      backend: 'downloading',
      reason: '索引重建中（全量重编码语料）…'
    }
    await ensureReady()
  }

  /** 语料目录监听：变更防抖 800ms 后热重载；不支持递归 watch 的平台静默降级 */
  function setupWatchers(): void {
    if (!options.watch) return
    const trigger = (): void => {
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(() => {
        void reload()
      }, 800)
    }
    for (const root of options.roots) {
      if (!existsSync(root.dir)) continue
      try {
        const w = watch(root.dir, { recursive: true }, trigger)
        w.unref() // 不挂住事件循环（vitest / 应用退出）
        watchers.push(w)
      } catch {
        /* 平台不支持递归 watch 时静默降级为不热重载 */
      }
    }
  }
  setupWatchers()

  function dispose(): void {
    if (watchTimer) clearTimeout(watchTimer)
    for (const w of watchers) w.close()
    watchers = []
  }

  return {
    chunks,
    status: statusView,
    ensureReady,
    search,
    keywordSearch,
    reload,
    rebuild,
    dispose
  }
}
