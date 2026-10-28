/**
 * en→zh 自动翻译服务（M16 市场/社区内容中文化）。
 *
 * 翻译链路：
 *  1. 已配置默认 AI 提供商（settings.ai.defaultProviderId）→ 批量 chat 翻译（JSON 数组协议）；
 *  2. 未配置或 AI 失败 → MyMemory 免费接口兜底（免 Key，逐条限速）；
 *  3. 再失败 → 该条返回 null，UI 展示原文（永不阻断浏览）。
 *
 * 缓存：内存 Map + userData/translate-cache.json 持久化（防抖落盘），
 * 命中缓存的文本零网络开销；只缓存成功结果，失败下次仍可重试。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { httpGetJson } from './httpUtil'
import { getSection } from './settingsService'
import { chat } from './aiService'

export type TranslateProvider = 'ai' | 'free' | 'cache' | 'none'

export interface TranslateBatchResult {
  /** 与输入等长；null 表示未翻译（UI 展示原文） */
  translations: (string | null)[]
  provider: TranslateProvider
}

/** 已含中文 / 太短 / 纯符号数字的文本不翻译 */
export function needsTranslation(text: string): boolean {
  const t = text.trim()
  if (t.length < 2) return false
  if (/[㐀-䶿一-鿿]/.test(t)) return false
  if (!/[a-zA-Z]/.test(t)) return false
  return true
}

/** 按条数与总字符数切块（控制单次 AI 调用体量） */
export function chunkTexts(texts: string[], maxItems = 20, maxChars = 3600): string[][] {
  const chunks: string[][] = []
  let cur: string[] = []
  let curChars = 0
  for (const t of texts) {
    if (cur.length >= maxItems || curChars + t.length > maxChars) {
      if (cur.length) chunks.push(cur)
      cur = []
      curChars = 0
    }
    cur.push(t)
    curChars += t.length
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/**
 * 解析 AI 翻译响应：容错去围栏后取首个 JSON 数组；
 * 长度不符时按位置对齐，缺位补 null（调用方兜底）。
 */
export function parseAiTranslateResponse(content: string, expectedCount: number): (string | null)[] | null {
  let text = content.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1]!.trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const arr: unknown = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr) || arr.length === 0) return null
    const out: (string | null)[] = []
    for (let i = 0; i < expectedCount; i++) {
      const v = arr[i]
      out.push(typeof v === 'string' && v.trim() ? v.trim() : null)
    }
    return out
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 缓存（内存 + 持久化，防抖写盘）
// ---------------------------------------------------------------------------
const memCache = new Map<string, string>()
let cacheFile: string | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let dirty = false

function cacheKey(text: string): string {
  return createHash('sha1').update(`en2zh:${text.trim()}`).digest('hex')
}

/** 惰性定位缓存文件；无 app 环境（单测）时仅内存缓存 */
function resolveCacheFile(): string | null {
  if (cacheFile !== null) return cacheFile || null
  try {
    const file = join(app.getPath('userData'), 'translate-cache.json')
    cacheFile = file
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>
      for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') memCache.set(k, v)
    }
  } catch {
    cacheFile = '' // 无 electron 环境或缓存损坏：仅内存
  }
  return cacheFile || null
}

function schedulePersist(): void {
  dirty = true
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    if (!dirty) return
    dirty = false
    const file = resolveCacheFile()
    if (!file) return
    try {
      mkdirSync(dirname(file), { recursive: true })
      const obj: Record<string, string> = {}
      for (const [k, v] of memCache) obj[k] = v
      writeFileSync(file, JSON.stringify(obj), 'utf-8')
    } catch { /* 缓存落盘失败不影响功能 */ }
  }, 2000)
}

function cachePut(text: string, zh: string): void {
  memCache.set(cacheKey(text), zh)
  schedulePersist()
}

// ---------------------------------------------------------------------------
// AI 批量翻译
// ---------------------------------------------------------------------------
const AI_SYSTEM =
  '你是 Minecraft 社区内容的专业翻译。把用户给出的 JSON 字符串数组（英文）逐条翻译成简体中文，' +
  '保持数组长度与顺序一致。规则：专有名词（模组名、作者名、版本号）保留原文；' +
  '不要添加解释；只输出 JSON 数组本身。'

async function aiTranslateBatch(texts: string[]): Promise<(string | null)[] | null> {
  const ai = getSection('ai')
  const provider = ai.providers.find((p) => p.id === ai.defaultProviderId && p.enabled)
  if (!provider) return null
  if (provider.kind !== 'ollama' && !provider.apiKey) return null
  const res = await chat({
    providerId: provider.id,
    model: provider.model,
    messages: [
      { role: 'system', content: AI_SYSTEM },
      { role: 'user', content: JSON.stringify(texts) }
    ],
    temperature: 0,
    maxTokens: Math.min(4000, Math.max(800, texts.join('').length * 2))
  })
  return parseAiTranslateResponse(res.content ?? '', texts.length)
}

// ---------------------------------------------------------------------------
// MyMemory 免费兜底（免 Key；匿名额度有限，逐条限速）
// ---------------------------------------------------------------------------
const MYMEMORY_URL = 'https://api.mymemory.translated.net/get'

async function freeTranslateOne(text: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(text.slice(0, 450))
    const { data } = await httpGetJson<{ responseData?: { translatedText?: string } }>(
      `${MYMEMORY_URL}?q=${q}&langpair=en|zh-CN`,
      { timeoutMs: 10000 }
    )
    const t = data.responseData?.translatedText?.trim()
    // MyMemory 失败时常原样回显或回大写提示句
    if (!t || t === text.trim() || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) return null
    return t
  } catch {
    return null
  }
}

/** 单次调用允许走免费接口的最大条数（限速逐条，避免长阻塞） */
const FREE_MAX_PER_CALL = 24
/** 免费接口并发 worker 数（保守，防触发 MyMemory 匿名限流） */
const FREE_CONCURRENCY = 4
/** 免费接口每个 worker 内相邻请求的最小间隔 */
const FREE_INTERVAL_MS = 250
/** AI 分块并发数（保守，防触发提供商限流） */
const AI_CONCURRENCY = 3

/**
 * 简易并发池：按固定 worker 数消费 items，结果与输入顺序对齐。
 * 单个 item 失败由 fn 内部兜底（返回 null），不中断其他项。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  workers: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i]!, i)
    }
  }
  const n = Math.max(1, Math.min(workers, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------
/**
 * 批量翻译为简体中文。输入去重 + 跳过无需翻译文本；
 * 返回与输入等长的数组（null = 展示原文）。
 */
export async function translateToZh(texts: string[]): Promise<TranslateBatchResult> {
  const out: (string | null)[] = new Array<string | null>(texts.length).fill(null)
  let provider: TranslateProvider = 'none'

  // 去重收集待翻译项
  let cacheHits = 0
  const pending = new Map<string, number[]>()
  texts.forEach((raw, i) => {
    const t = (raw ?? '').trim()
    if (!t || !needsTranslation(t)) return
    const hit = memCache.get(cacheKey(t))
    if (hit) {
      out[i] = hit
      cacheHits++
      return
    }
    const idxs = pending.get(t)
    if (idxs) idxs.push(i)
    else pending.set(t, [i])
  })
  if (pending.size === 0) {
    return { translations: out, provider: cacheHits > 0 ? 'cache' : 'none' }
  }

  const uniqueTexts = [...pending.keys()]
  const remaining = new Set<string>(uniqueTexts)

  // 第一棒：AI 批量（分块后并发执行，整体耗时≈最慢单块而非逐块累加）
  try {
    const aiChunks = chunkTexts(uniqueTexts)
    const aiResults = new Map<string, string>()
    const chunkResults = await mapWithConcurrency(aiChunks, AI_CONCURRENCY, (chunk) =>
      aiTranslateBatch(chunk).catch(() => null)
    )
    let aiOk = false
    aiChunks.forEach((chunk, ci) => {
      const r = chunkResults[ci]
      if (!r) return
      aiOk = true
      chunk.forEach((t, i) => {
        const zh = r[i]
        if (zh) aiResults.set(t, zh)
      })
    })
    if (aiOk) {
      provider = 'ai'
      for (const [t, zh] of aiResults) {
        cachePut(t, zh)
        for (const i of pending.get(t)!) out[i] = zh
        remaining.delete(t)
      }
    }
  } catch { /* AI 链路整体失败 → 走免费兜底 */ }

  // 第二棒：免费接口兜底（限量 + 小并发，worker 内保持间隔防限流）
  if (remaining.size > 0) {
    const freeTargets = [...remaining].slice(0, FREE_MAX_PER_CALL)
    const zhList = await mapWithConcurrency(freeTargets, FREE_CONCURRENCY, async (t) => {
      const zh = await freeTranslateOne(t)
      await new Promise((r) => setTimeout(r, FREE_INTERVAL_MS))
      return zh
    })
    freeTargets.forEach((t, i) => {
      const zh = zhList[i]
      if (!zh) return
      if (provider === 'none') provider = 'free'
      cachePut(t, zh)
      for (const idx of pending.get(t)!) out[idx] = zh
      remaining.delete(t)
    })
  }

  return { translations: out, provider }
}
