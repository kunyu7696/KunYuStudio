/**
 * 离线 Markdown 语料检索（P0 知识源②③）。
 *
 * 供 fabric_docs_search（resources/knowledge/fabric）与
 * mc_wiki_search（resources/knowledge/mcwiki）共用：
 * - 按 markdown 标题切分 chunk（保留文件路径与标题层级）
 * - 混合分词：英文/标识符按词，中文按 2-gram；标题命中加权
 * - 零依赖、零网络、零模型，结果可解释（返回命中词与片段）
 *
 * 语料为 KunYuStudio 原创中文摘要（非第三方文档转载），随包离线分发。
 */
import { existsSync, readdirSync, readFileSync, watch } from 'node:fs'
import { join, extname } from 'node:path'
import { isPackagedRuntime } from '../runtimeEnv'

/** dev：resources/knowledge；prod：process.resourcesPath/knowledge */
export function defaultKnowledgeRoot(): string {
  try {
    const { app } = require('electron') as typeof import('electron')
    if (isPackagedRuntime(app)) return join(process.resourcesPath, 'knowledge')
  } catch {
    /* 非 electron 环境 */
  }
  return join(process.cwd(), 'resources', 'knowledge')
}

export type KnowledgeCorpus = 'fabric' | 'mcwiki' | 'kubejs'

const corpusLabels: Record<KnowledgeCorpus, string> = {
  fabric: 'Fabric 开发文档',
  mcwiki: 'Minecraft 中文百科',
  kubejs: 'KubeJS 脚本文档'
}

export function corpusLabel(corpus: KnowledgeCorpus): string {
  return corpusLabels[corpus]
}

export interface KnowledgeChunk {
  file: string
  /** 标题路径，如「注册 / 方块与物品」 */
  title: string
  /** 层级（# =1） */
  level: number
  text: string
}

export interface KnowledgeHit {
  chunk: KnowledgeChunk
  score: number
  /** 命中的检索词（调试/可解释） */
  matched: string[]
}

/** 语料库：一次扫描目录全部 .md 并切 chunk（缓存） */
export class MarkdownKnowledgeBase {
  private chunks: KnowledgeChunk[] | null = null
  constructor(private readonly dir: string) {}

  available(): boolean {
    return existsSync(this.dir)
  }

  /** 语料变更后使 chunk 缓存失效（下次检索重扫）；热重载由 wireCorpusWatch 驱动 */
  invalidate(): void {
    this.chunks = null
  }

  private load(): KnowledgeChunk[] {
    if (this.chunks) return this.chunks
    const out: KnowledgeChunk[] = []
    if (!existsSync(this.dir)) {
      this.chunks = []
      return out
    }
    const files = readdirSync(this.dir).filter((f) => extname(f).toLowerCase() === '.md')
    for (const file of files.sort()) {
      const raw = readFileSync(join(this.dir, file), 'utf-8').replace(/^﻿/, '')
      out.push(...splitMarkdown(raw, file))
    }
    this.chunks = out
    return out
  }

  search(query: string, limit = 6): KnowledgeHit[] {
    const q = query.trim()
    if (!q) return []
    const terms = tokenize(q)
    if (terms.length === 0) return []
    const hits: KnowledgeHit[] = []
    for (const chunk of this.load()) {
      const hay = chunk.text.toLowerCase()
      const titleHay = chunk.title.toLowerCase()
      let score = 0
      const matched: string[] = []
      for (const t of terms) {
        const tt = t.toLowerCase()
        const bodyCount = countOccurrences(hay, tt)
        if (bodyCount > 0) {
          score += Math.min(bodyCount, 5)
          matched.push(t)
        }
        if (titleHay.includes(tt)) {
          score += 6
          if (!matched.includes(t)) matched.push(t)
        }
      }
      // 全部检索词都命中时加权（短语整体命中再加成）
      if (matched.length === terms.length) score += 4
      if (haystackPhrase(hay, q)) score += 5
      if (score > 0) hits.push({ chunk, score, matched })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, Math.max(1, Math.min(15, limit)))
  }
}

const corpusSingletons = new Map<KnowledgeCorpus, MarkdownKnowledgeBase>()
const corpusWatched = new Set<KnowledgeCorpus>()

/** 语料目录热重载：文件变更防抖 500ms 后失效缓存（目录缺失/平台不支持时静默降级） */
function wireCorpusWatch(corpus: KnowledgeCorpus, kb: MarkdownKnowledgeBase, dir: string): void {
  if (corpusWatched.has(corpus) || !existsSync(dir)) return
  corpusWatched.add(corpus)
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const w = watch(dir, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => kb.invalidate(), 500)
    })
    w.unref() // 不挂住事件循环（vitest / 应用退出）
  } catch {
    /* 不支持 watch 的环境静默降级 */
  }
}

/** 语料库懒单例（corpus → resources/knowledge/<corpus>）；目录变更自动失效缓存 */
export function getKnowledgeBase(corpus: KnowledgeCorpus): MarkdownKnowledgeBase {
  const hit = corpusSingletons.get(corpus)
  if (hit) return hit
  const dir = join(defaultKnowledgeRoot(), corpus)
  const kb = new MarkdownKnowledgeBase(dir)
  wireCorpusWatch(corpus, kb, dir)
  corpusSingletons.set(corpus, kb)
  return kb
}

/** markdown 按 ATX 标题切分；文件级前言归入一级虚拟标题 */
export function splitMarkdown(raw: string, file: string): KnowledgeChunk[] {
  const lines = raw.split(/\r?\n/)
  const chunks: KnowledgeChunk[] = []
  const stack: { level: number; title: string }[] = []
  let buf: string[] = []
  let currentLevel = 0
  let currentTitle = file.replace(/\.md$/, '')

  const flush = (): void => {
    const text = buf.join('\n').trim()
    if (text) {
      chunks.push({ file, title: stack.map((s) => s.title).join(' / ') || currentTitle, level: currentLevel, text })
    }
    buf = []
  }

  for (const line of lines) {
    const m = /^(#{1,4})\s+(.+?)\s*$/.exec(line)
    if (m) {
      flush()
      const level = m[1].length
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
      stack.push({ level, title: m[2].trim() })
      currentLevel = level
      currentTitle = m[2].trim()
    } else {
      buf.push(line)
    }
  }
  flush()
  return chunks
}

/** 混合分词：英文标识符（含 . _ / -）整体保留；连续中文按 2-gram 切分；单字保留 */
export function tokenize(q: string): string[] {
  const terms = new Set<string>()
  // 标识符匹配必须在原始大小写文本上做（保留驼峰边界）
  const identRe = /[A-Za-z0-9_./-]{2,}/g
  let m: RegExpExecArray | null
  while ((m = identRe.exec(q)) !== null) {
    const word = m[0]
    terms.add(word.toLowerCase())
    // 分隔符拆词（entity_type → entity, type）
    for (const part of word.split(/[._/-]+/)) {
      if (part.length >= 3) terms.add(part.toLowerCase())
    }
    // 驼峰拆分（EntityType → entity, type；GeoEntityRenderer → geo/entity/renderer）
    const camelParts = word.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[0-9]+/g)
    if (camelParts) {
      for (const p of camelParts) {
        const lp = p.toLowerCase()
        if (lp.length >= 3) terms.add(lp)
      }
    }
  }
  const cjkRe = /[\u4e00-\u9fff]+/g
  while ((m = cjkRe.exec(q)) !== null) {
    const seg = m[0]
    if (seg.length <= 2) {
      terms.add(seg)
    } else {
      // 2-gram + 3-gram（3-gram 保证"战利品表"这类词命中）
      for (let i = 0; i < seg.length - 1; i++) terms.add(seg.slice(i, i + 2))
      for (let i = 0; i < seg.length - 2; i++) terms.add(seg.slice(i, i + 3))
    }
  }
  return [...terms].filter((t) => t.length >= 2)
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = hay.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = hay.indexOf(needle, idx + needle.length)
    if (count > 20) break
  }
  return count
}

/** 英文短语/中文整串连续命中 */
function haystackPhrase(hay: string, q: string): boolean {
  const phrase = q.trim().toLowerCase()
  if (phrase.length < 3) return false
  if (/^[a-z0-9_./\s-]+$/.test(phrase)) return hay.includes(phrase)
  const cjk = q.match(/[\u4e00-\u9fff]{3,}/)
  return cjk ? hay.includes(cjk[0]) : false
}

/** 渲染命中结果为模型可读文本 */
export function formatHits(hits: KnowledgeHit[], corpusName: string): string {
  if (hits.length === 0) {
    return `${corpusName}未命中；请改用 mc_data_lookup 查结构化数据，或显式声明“无本地依据”，避免编造 API。`
  }
  return hits
    .map(
      (h, i) =>
        `===== ${corpusName} 片段 ${i + 1}《${h.chunk.title}》（${h.chunk.file}，命中：${h.matched.join('、')}）=====\n${h.chunk.text}`
    )
    .join('\n\n')
}
