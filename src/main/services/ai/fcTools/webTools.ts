/**
 * B1 联网检索能力：web_fetch。
 *
 * 背景：KunYuStudio Agent 此前的检索全部离线（参考包/知识库/mcdata），超出本地语料
 * （上游 API 变更、社区新模组教程、Wiki 新页面）即失能。本片段给模型一个
 * 零配置的联网抓取出口——undici 已是依赖，代理/超时语义复用 httpUtil，
 * 无需用户装任何 MCP 或 Python 环境。
 *
 * 护栏：
 * - 仅 https://；http/其他协议直接拒绝，不发起请求。
 * - 响应体抓取上限 1MB（流式截断），返回正文再按 maxChars 截断。
 * - 超时/断网/HTTP 错误分类软失败（ok:false + 中文说明），不阻断流水线。
 *
 * 正文抽取：无第三方依赖的轻量实现——去 script/style/注释、块级标签转换行、
 * 解码常见 HTML 实体、折叠空白；JSON 自动格式化，其余按纯文本返回。
 */
import { httpGetText, HttpUtilError } from '../../httpUtil'
import type { RegisteredTool } from '../toolRegistry'
import { clipToolText } from './textClip'

/** 单页抓取字节上限（防超大页面撑爆内存） */
const FETCH_MAX_BYTES = 1_000_000
/** 返回正文默认/最大字符数（TOOL_RESULT_CLIP 8_000 之内） */
const DEFAULT_MAX_CHARS = 6_000
const MAX_CHARS_CAP = 8_000

export function htmlToText(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '')).trim() : ''
  let s = html
    // 注释与无需阅读的内容块整体移除（head 含 title/meta，标题已单独提取）
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // 块级标签（开/闭）转换行
    .replace(
      /<\s*\/?\s*(p|div|li|tr|td|th|h[1-6]|section|article|header|footer|table|ul|ol|dl|dd|dt|blockquote|pre|nav|main|aside|figure|figcaption|form|br|hr)\b[^>]*>/gi,
      '\n'
    )
    // 剩余标签去壳
    .replace(/<[^>]+>/g, ' ')
  s = decodeEntities(s)
  // 空白折叠：行内空格归一、空行去重、去首尾空行
  const lines = s
    .split('\n')
    .map((l) => l.replace(/[ \t　]+/g, ' ').trim())
  const out: string[] = []
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(line)
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  const body = out.join('\n')
  return title ? `标题：${title}\n\n${body}` : body
}

/** 解码常见 HTML 实体（&amp; 必须最后解码，避免二次解码） */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/gi, '&')
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
  } catch {
    return ''
  }
}

/** 嗅探响应体是否为 HTML（无 content-type 依赖，看头部特征标签） */
function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 2_000).toLowerCase()
  return /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/.test(head)
}

/* ------------------------------------------------------------------ */
/* web_search：关键词 → 候选页面列表（标题 + URL + 摘要）                */
/* ------------------------------------------------------------------ */

/** 单条搜索结果 */
export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** 结果条数默认/上限 */
const SEARCH_DEFAULT_COUNT = 5
const SEARCH_MAX_COUNT = 10

/** 按「块起始标记」切分 HTML：每块 = 标记处 → 下一标记/文末（不依赖嵌套标签闭合配对） */
function extractSections(html: string, markerRe: RegExp): string[] {
  const marks = [...html.matchAll(markerRe)]
  const out: string[] = []
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index ?? 0
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? html.length) : html.length
    out.push(html.slice(start, end))
  }
  return out
}

function firstMatch(text: string, re: RegExp): string {
  const m = text.match(re)
  return m?.[1] ?? ''
}

/** 去标签 + 实体解码 + 空白折叠（复用正文抽取的解码器） */
function cleanSnippet(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]+>/g, ' '))
    .replace(/[ \t　]+/g, ' ')
    .trim()
}

/**
 * 解析 Bing 结果页：每个结果在 <li class="b_algo"> 块内，
 * 标题/链接在 h2>a，摘要在 .b_caption 的 <p>。
 */
export function parseBingResults(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = []
  for (const block of extractSections(html, /<li class="b_algo"/g)) {
    const url = firstMatch(block, /<h2[^>]*>\s*<a[^>]*href="([^"]+)"/i)
    const title = cleanSnippet(firstMatch(block, /<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i))
    const snippet = cleanSnippet(firstMatch(block, /<p[^>]*>([\s\S]*?)<\/p>/i))
    if (url.startsWith('http') && title) out.push({ title, url, snippet })
    if (out.length >= limit) break
  }
  return out
}

/**
 * 解析 DuckDuckGo html 端点：结果块 class="result"，
 * 链接是 //duckduckgo.com/l/?uddg=<编码目标> 包装，需解码取 uddg。
 */
export function parseDdgResults(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = []
  for (const block of extractSections(html, /<div[^>]*class="[^"]*results_links[^"]*"/g)) {
    const rawHref = firstMatch(block, /class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"/i)
    const title = cleanSnippet(firstMatch(block, /class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/i))
    const snippet = cleanSnippet(firstMatch(block, /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i))
    let url = rawHref
    // uddg 包装解码；直链原样保留
    const uddgMatch = rawHref.match(/[?&]uddg=([^&]+)/)
    if (uddgMatch) {
      try {
        url = decodeURIComponent(uddgMatch[1])
      } catch {
        url = rawHref
      }
    }
    if (url.startsWith('http') && title) out.push({ title, url, snippet })
    if (out.length >= limit) break
  }
  return out
}

interface SearchEngine {
  name: string
  url: (query: string) => string
  parse: (html: string, limit: number) => SearchResult[]
}

/** 主 Bing（国内直连可达）；备 DuckDuckGo html（无 JS 纯表单端点） */
const SEARCH_ENGINES: SearchEngine[] = [
  {
    name: 'Bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-hans&mkt=zh-CN`,
    parse: parseBingResults
  },
  {
    name: 'DuckDuckGo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDdgResults
  }
]

function clampCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return SEARCH_DEFAULT_COUNT
  return Math.min(SEARCH_MAX_COUNT, Math.max(1, Math.trunc(v)))
}

function formatResults(query: string, engine: string, results: SearchResult[]): string {
  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.title}\n${r.url}${r.snippet ? `\n${r.snippet}` : ''}`
  )
  return (
    `搜索：${query}（引擎：${engine}，${results.length} 条）\n\n` +
    lines.join('\n\n') +
    '\n\n提示：用 web_fetch 抓取其中 URL 可阅读正文。'
  )
}

/** JSON 美化（便于模型阅读）；非 JSON 原样返回 */
function prettyJsonIfPossible(text: string): string {
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return text
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return text
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function clampMaxChars(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_MAX_CHARS
  return Math.min(MAX_CHARS_CAP, Math.max(500, Math.trunc(v)))
}

export function builtinWebTools(): RegisteredTool[] {
  return [
    {
      kind: 'chat',
      def: {
        type: 'function',
        function: {
          name: 'web_search',
          description:
            '联网关键词搜索，返回候选页面列表（标题 + URL + 摘要）。' +
            '当你对用户提到的概念/梗/设定/模组/事件不了解时（例如用户给出一个灵感词想做成模组），' +
            '先用本工具搜索搞清它是什么，再用 web_fetch 抓取结果页正文深入阅读，然后才动手设计。' +
            '关键词纪律：直接用用户给的原始词（如「动物园规则怪谈」），不要自造长尾组合词；' +
            '结果不理想最多换 1~2 次关键词，随后从已拿到的结果里挑最相关的用 web_fetch 深读，不要反复重搜。' +
            '主用 Bing（国内直连），失败自动回落 DuckDuckGo；需本机联网，免 API key。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词（中文/英文均可）' },
              count: {
                type: 'number',
                description: `返回条数，默认 ${SEARCH_DEFAULT_COUNT}，范围 1～${SEARCH_MAX_COUNT}`
              }
            },
            required: ['query']
          }
        }
      },
      visibility: 'always',
      execute: async (args) => {
        const query = asString(args['query']).trim()
        if (!query) return { ok: false, text: '', error: 'query 不能为空' }
        const count = clampCount(args['count'])
        const failures: string[] = []
        for (const engine of SEARCH_ENGINES) {
          const url = engine.url(query)
          try {
            const res = await httpGetText(url, {
              maxBytes: FETCH_MAX_BYTES,
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9'
              }
            })
            if (res.status >= 400) {
              failures.push(`${engine.name}: HTTP ${res.status}`)
              continue
            }
            const results = engine.parse(res.text, count)
            if (results.length === 0) {
              failures.push(`${engine.name}: 未解析到结果（页面结构可能已变化）`)
              continue
            }
            return {
              ok: true,
              text: clipToolText(formatResults(query, engine.name, results)),
              data: { engine: engine.name, count: results.length }
            }
          } catch (e) {
            if (e instanceof HttpUtilError) {
              failures.push(`${engine.name}: ${e.code === 'timeout' ? '超时' : e.message}`)
            } else {
              failures.push(`${engine.name}: ${(e as Error).message}`)
            }
          }
        }
        return {
          ok: false,
          text: '',
          error: `搜索失败（已尝试 ${SEARCH_ENGINES.map((e) => e.name).join('/')}）：${failures.join('；')}`
        }
      }
    },
    {
      kind: 'chat',
      def: {
        type: 'function',
        function: {
          name: 'web_fetch',
          description:
            '抓取一个 https 网页并返回正文文本（HTML 自动去脚本/标签抽取正文，JSON 自动格式化）。' +
            '用于查阅本地参考包没有的在线资料：模组 API 文档、Wiki 新页面、GitHub 发布日志、社区教程等。' +
            '仅支持 https，单页有抓取大小与返回长度上限，需本机联网。',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '完整 https:// 链接' },
              maxChars: {
                type: 'number',
                description: `返回正文最大字符数，默认 ${DEFAULT_MAX_CHARS}，范围 500～${MAX_CHARS_CAP}`
              }
            },
            required: ['url']
          }
        }
      },
      visibility: 'always',
      execute: async (args) => {
        const url = asString(args['url']).trim()
        if (!url) return { ok: false, text: '', error: 'url 不能为空' }
        let parsed: URL
        try {
          parsed = new URL(url)
        } catch {
          return { ok: false, text: '', error: `URL 无法解析：${url}` }
        }
        if (parsed.protocol !== 'https:') {
          return { ok: false, text: '', error: `仅支持 https:// 链接（收到 ${parsed.protocol}//）` }
        }
        const maxChars = clampMaxChars(args['maxChars'])
        try {
          const res = await httpGetText(url, {
            maxBytes: FETCH_MAX_BYTES,
            headers: {
              'User-Agent': 'KunYu-Studio/0.1 (web_fetch)',
              Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*;q=0.8'
            }
          })
          if (res.status >= 400) {
            return { ok: false, text: '', error: `HTTP ${res.status}：${url}` }
          }
          const body = looksLikeHtml(res.text) ? htmlToText(res.text) : prettyJsonIfPossible(res.text)
          if (!body.trim()) {
            return { ok: true, text: `来源：${url}（HTTP ${res.status}）\n\n页面正文为空或无法抽取。`, data: { status: res.status, chars: 0 } }
          }
          const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}…（已截断）` : body
          const truncated = body.length > maxChars || res.truncated === true
          const text = `来源：${url}（HTTP ${res.status}${truncated ? '，内容有截断' : ''}）\n\n${clipped}`
          return {
            ok: true,
            text: clipToolText(text),
            data: { status: res.status, chars: clipped.length, truncated }
          }
        } catch (e) {
          if (e instanceof HttpUtilError) {
            if (e.code === 'timeout') return { ok: false, text: '', error: `抓取超时：${url}` }
            if (e.code === 'http') return { ok: false, text: '', error: e.message }
            return { ok: false, text: '', error: `无法连接：${e.message}` }
          }
          return { ok: false, text: '', error: `抓取失败：${(e as Error).message}` }
        }
      }
    }
  ]
}
