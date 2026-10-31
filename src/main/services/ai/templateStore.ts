/**
 * AI 参考包模板组合器：磁盘上只存 canonical + 占位符 + 真实差异，
 * 运行时按 manifest 里的虚拟路径还原出与重构前逐字节一致的内容。
 *
 * 新布局（由 scripts/refactor-reference-templates.mjs 产出）：
 * - templates/canonical/<loader>/<slot>      正文，含 {{mcVersion}} 等占位符
 * - templates/vars/<loader>.json             占位符 → 各种子组合取值（缺省回退种子值）
 * - templates/versions/<loader>/<mc>.json    该组合的槽位清单、variants、注释头、换行
 * - templates/variants/<loader>/<mc>/<slot>  真实差异（整文件原字节）
 *
 * manifest 保持原样：template.file 仍是 templates/<loader>/<mc>/<slot> 虚拟路径，
 * 因此检索引用路径、RAG 语料相对路径与重构前完全一致。
 *
 * 旧布局（templates/<loader>/<mc>/<slot> 真实文件）仍可直读：测试夹具与历史参考包
 * 不需要为压缩布局而改写。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { LoaderId } from '../../../shared/types/aiReference'

const COMBO_RE = /^templates\/(fabric|forge|neoforge)\/([^/]+)\/(.+)$/
const PLACEHOLDER_RE = /\{\{([A-Za-z0-9_]+)\}\}/g

/** 迁移警示注释头风格：由扩展名推导，与 refactor 脚本一致 */
export function templateStyleOf(slot: string): string {
  if (slot.endsWith('.java') || slot.endsWith('.gradle')) return 'block'
  if (slot.endsWith('.md')) return 'html'
  if (slot.endsWith('.properties') || slot.endsWith('.toml')) return 'hash'
  return '-'
}

/** 内容指纹（代替文件 mtime，供 RAG 向量缓存判定失效） */
export function contentStamp(text: string): number {
  return Number.parseInt(createHash('sha1').update(text, 'utf-8').digest('hex').slice(0, 12), 16)
}

interface VersionFile {
  loader: LoaderId
  mcVersion: string
  seed: string
  headers: Record<string, string>
  canonical: string[]
  variants: string[]
  crlf: string[]
  /** 无迁移注释头的槽位（不能按扩展名推断头风格） */
  noHeader?: string[]
}

interface VarsFile {
  loader: LoaderId
  seed: string
  vars: Record<string, { seed: string; values: Record<string, string> }>
}

export interface CorpusTemplateFile {
  /** manifest 虚拟路径 templates/<loader>/<mc>/<slot> */
  rel: string
  content: string
  /** 内容指纹（等价 mtime，用于向量缓存失效） */
  mtimeMs: number
}

export interface TemplateStore {
  /** 虚拟路径是否有可组合的实体（旧布局则直接看磁盘） */
  exists(rel: string): boolean
  /** 组合出最终文本；不存在或参考包损坏时返回 null */
  read(rel: string): string | null
  /** 全部可组合模板（含正文与指纹），供 RAG 语料清单使用 */
  list(): CorpusTemplateFile[]
}

export function createTemplateStore(referenceDir: string): TemplateStore {
  const textCache = new Map<string, string | null>()
  const versionCache = new Map<string, VersionFile | null>()
  const varsCache = new Map<string, VarsFile | null>()

  const disk = (rel: string): string | null => {
    const abs = join(referenceDir, rel)
    if (!existsSync(abs)) return null
    try {
      return readFileSync(abs, 'utf-8')
    } catch {
      return null
    }
  }

  const versionOf = (loader: string, mc: string): VersionFile | null => {
    const key = `${loader}/${mc}`
    if (versionCache.has(key)) return versionCache.get(key)!
    let rec: VersionFile | null = null
    const text = disk(`templates/versions/${loader}/${mc}.json`)
    if (text !== null) {
      try {
        rec = JSON.parse(text) as VersionFile
      } catch {
        rec = null
      }
    }
    versionCache.set(key, rec)
    return rec
  }

  const varsOf = (loader: string): VarsFile | null => {
    if (varsCache.has(loader)) return varsCache.get(loader)!
    let rec: VarsFile | null = null
    const text = disk(`templates/vars/${loader}.json`)
    if (text !== null) {
      try {
        rec = JSON.parse(text) as VarsFile
      } catch {
        rec = null
      }
    }
    varsCache.set(loader, rec)
    return rec
  }

  const expand = (loader: string, mc: string, slot: string, body: string): string => {
    const vars = varsOf(loader)?.vars ?? {}
    return body.replace(PLACEHOLDER_RE, (_m, name: string) => {
      const v = vars[name]
      if (!v) throw new Error(`参考包占位符未定义：${name}（${loader}/${slot}）`)
      const val = v.values?.[mc]
      return val !== undefined ? String(val) : String(v.seed)
    })
  }

  const compose = (rel: string): string | null => {
    const m = COMBO_RE.exec(rel)
    const rec = m ? versionOf(m[1]!, m[2]!) : null
    if (!m || !rec) return disk(rel) // 旧布局 / 根级共享文档
    const [, loader, mc, slot] = m
    if (rec.variants?.includes(slot!)) {
      return disk(`templates/variants/${loader}/${mc}/${slot}`)
    }
    if (!rec.canonical?.includes(slot!)) return null
    const canonical = disk(`templates/canonical/${loader}/${slot}`)
    if (canonical === null) return null
    const body = expand(loader!, mc!, slot!, canonical)
    const style = rec.noHeader?.includes(slot!) ? '-' : templateStyleOf(slot!)
    const header = rec.headers?.[style] ?? ''
    const text = header + body
    return rec.crlf?.includes(slot!) ? text.replace(/\n/g, '\r\n') : text
  }

  const safe = (rel: string): string | null =>
    typeof rel === 'string' && rel.startsWith('templates/') && !isAbsolute(rel) && !rel.includes('..')
      ? rel
      : null

  const read = (rel: string): string | null => {
    const key = safe(rel)
    if (key === null) return null
    if (textCache.has(key)) return textCache.get(key)!
    let text: string | null = null
    try {
      text = compose(key)
    } catch (e) {
      console.warn('[ai-reference] 模板组合失败：', (e as Error).message)
      text = null
    }
    textCache.set(key, text)
    return text
  }

  const exists = (rel: string): boolean => {
    const key = safe(rel)
    if (key === null) return false
    const m = COMBO_RE.exec(key)
    const rec = m ? versionOf(m[1]!, m[2]!) : null
    if (!m || !rec) return existsSync(join(referenceDir, key))
    const [, loader, mc, slot] = m
    if (rec.variants?.includes(slot!)) {
      return existsSync(join(referenceDir, 'templates', 'variants', loader!, mc!, slot!))
    }
    if (rec.canonical?.includes(slot!)) {
      return existsSync(join(referenceDir, 'templates', 'canonical', loader!, slot!))
    }
    return false
  }

  const list = (): CorpusTemplateFile[] => {
    const out: CorpusTemplateFile[] = []
    const root = join(referenceDir, 'templates', 'versions')
    if (!existsSync(root)) return out
    for (const loaderEntry of readdirSync(root, { withFileTypes: true })) {
      if (!loaderEntry.isDirectory()) continue
      const loaderDir = join(root, loaderEntry.name)
      for (const fileEntry of readdirSync(loaderDir, { withFileTypes: true })) {
        if (!fileEntry.isFile() || !fileEntry.name.endsWith('.json')) continue
        const mc = fileEntry.name.slice(0, -'.json'.length)
        const rec = versionOf(loaderEntry.name, mc)
        if (!rec) continue
        const slots = [...(rec.canonical ?? []), ...(rec.variants ?? [])].sort()
        for (const slot of slots) {
          const rel = `templates/${loaderEntry.name}/${mc}/${slot}`
          const content = read(rel)
          if (content === null) continue
          out.push({ rel, content, mtimeMs: contentStamp(content) })
        }
      }
    }
    return out
  }

  return { exists, read, list }
}
