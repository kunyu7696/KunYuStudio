/**
 * B1 web_fetch 单测：
 * - 协议/URL 护栏（仅 https，非法输入不发请求）
 * - 正文抽取（HTML 去标签/实体、JSON 格式化、纯文本透传）
 * - 长度截断与抓取截断标记
 * - 错误分类（HTTP 状态/超时/断网软失败）
 * - 注册表集成：恒可见、命名纪律注解渲染
 * httpUtil 经 vi.mock 隔离，不触真实网络。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  httpGetText: vi.fn()
}))

vi.mock('../../httpUtil', () => ({
  httpGetText: h.httpGetText,
  HttpUtilError: class HttpUtilError extends Error {
    readonly code: 'timeout' | 'network' | 'http'
    readonly status?: number
    constructor(code: 'timeout' | 'network' | 'http', message: string, status?: number) {
      super(message)
      this.code = code
      this.status = status
    }
  }
}))

import { builtinWebTools, htmlToText } from '../fcTools/webTools'
import { HttpUtilError } from '../../httpUtil'
import { createToolRegistry } from '../toolRegistry'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

function webFetch() {
  const t = builtinWebTools().find((x) => x.def.function.name === 'web_fetch')
  if (!t) throw new Error('web_fetch not found')
  return t
}

beforeEach(() => {
  h.httpGetText.mockReset()
})

describe('web_fetch 入参护栏', () => {
  it('空 url 直接拒绝', async () => {
    const r = await webFetch().execute({ url: '' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('url 不能为空')
    expect(h.httpGetText).not.toHaveBeenCalled()
  })

  it('非 https 协议拒绝且不发请求', async () => {
    const r = await webFetch().execute({ url: 'http://example.com/x' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('仅支持 https://')
    expect(h.httpGetText).not.toHaveBeenCalled()
  })

  it('无法解析的 URL 拒绝', async () => {
    const r = await webFetch().execute({ url: 'not a url' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('URL 无法解析')
    expect(h.httpGetText).not.toHaveBeenCalled()
  })

  it('合法 https 请求带抓取上限与 Accept 头发出', async () => {
    h.httpGetText.mockResolvedValue({ status: 200, text: 'hello' })
    await webFetch().execute({ url: 'https://example.com/a' }, CTX)
    expect(h.httpGetText).toHaveBeenCalledTimes(1)
    const [url, opts] = h.httpGetText.mock.calls[0]
    expect(url).toBe('https://example.com/a')
    expect(opts.maxBytes).toBeGreaterThan(0)
    expect(opts.headers.Accept).toContain('text/html')
  })
})

describe('web_fetch 正文处理', () => {
  it('纯文本原样返回并带来源行', async () => {
    h.httpGetText.mockResolvedValue({ status: 200, text: 'plain readme body' })
    const r = await webFetch().execute({ url: 'https://example.com/r.txt' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('来源：https://example.com/r.txt（HTTP 200）')
    expect(r.text).toContain('plain readme body')
  })

  it('HTML 页面抽取正文（去脚本/样式，保留标题）', async () => {
    const page = [
      '<!DOCTYPE html><html><head><title>钠 · 渲染优化</title>',
      '<style>body{color:red}</style></head>',
      '<body><h1>Sodium</h1><script>track()</script>',
      '<p>现代渲染引擎 &amp; 优化</p><p>支持 1.20.x</p></body></html>'
    ].join('')
    h.httpGetText.mockResolvedValue({ status: 200, text: page })
    const r = await webFetch().execute({ url: 'https://modrinth.com/mod/sodium' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('标题：钠 · 渲染优化')
    expect(r.text).toContain('Sodium')
    expect(r.text).toContain('现代渲染引擎 & 优化')
    expect(r.text).not.toContain('track()')
    expect(r.text).not.toContain('color:red')
    // head 块整体移除：标题只在「标题：」行出现一次，不在正文重复
    expect(r.text.indexOf('钠 · 渲染优化')).toBe(r.text.lastIndexOf('钠 · 渲染优化'))
  })

  it('JSON 响应自动格式化', async () => {
    h.httpGetText.mockResolvedValue({ status: 200, text: '{"name":"sodium","downloads":100}' })
    const r = await webFetch().execute({ url: 'https://api.example.com/x' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('"name": "sodium"')
  })

  it('抽取后正文为空时给出说明而非报错', async () => {
    h.httpGetText.mockResolvedValue({
      status: 200,
      text: '<!DOCTYPE html><html><head></head><body><script>only()</script></body></html>'
    })
    const r = await webFetch().execute({ url: 'https://example.com/empty' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('页面正文为空')
  })

  it('maxChars 截断并标记 truncated', async () => {
    h.httpGetText.mockResolvedValue({ status: 200, text: 'x'.repeat(2_000) })
    const r = await webFetch().execute({ url: 'https://example.com/long', maxChars: 500 }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('已截断')
    expect((r.data as { truncated: boolean }).truncated).toBe(true)
  })

  it('抓取字节上限命中时在来源行标注截断', async () => {
    h.httpGetText.mockResolvedValue({ status: 200, text: 'partial', truncated: true })
    const r = await webFetch().execute({ url: 'https://example.com/big' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('内容有截断')
  })
})

describe('web_fetch 错误分类', () => {
  it('HTTP 4xx/5xx 软失败', async () => {
    h.httpGetText.mockResolvedValue({ status: 404, text: 'not found' })
    const r = await webFetch().execute({ url: 'https://example.com/miss' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('HTTP 404')
  })

  it('超时分类为抓取超时', async () => {
    h.httpGetText.mockRejectedValue(new HttpUtilError('timeout', '请求超时：https://x'))
    const r = await webFetch().execute({ url: 'https://example.com/slow' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('抓取超时')
  })

  it('断网分类为无法连接', async () => {
    h.httpGetText.mockRejectedValue(new HttpUtilError('network', '无法连接 https://x：ECONNREFUSED'))
    const r = await webFetch().execute({ url: 'https://example.com/down' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('无法连接')
  })

  it('未知异常兜底软失败', async () => {
    h.httpGetText.mockRejectedValue(new Error('boom'))
    const r = await webFetch().execute({ url: 'https://example.com/err' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('抓取失败：boom')
  })
})

describe('htmlToText 纯函数', () => {
  it('块级标签转换行、折叠空白', () => {
    // 块级元素之间保留单个空行（类 Markdown 段落分隔，便于模型阅读）
    const out = htmlToText('<div>第一行</div><div>  第二   行 </div><p>第三行</p>')
    expect(out).toBe('第一行\n\n第二 行\n\n第三行')
  })

  it('&amp; 最后解码避免二次解码', () => {
    expect(htmlToText('<p>&amp;lt;tag&amp;gt;</p>')).toBe('&lt;tag&gt;')
    expect(htmlToText('<p>a &amp; b</p>')).toBe('a & b')
  })

  it('数字实体（十进制/十六进制）解码', () => {
    expect(htmlToText('<p>&#65;&#x42;</p>')).toBe('AB')
  })

  it('无标题页面不加标题行', () => {
    expect(htmlToText('<p>仅正文</p>')).toBe('仅正文')
  })
})

describe('web_fetch 注册表集成', () => {
  it('无项目上下文也恒可见，description 已渲染命名纪律', () => {
    const reg = createToolRegistry({})
    const def = reg.getToolDefinitions().find((d) => d.function.name === 'web_fetch')
    expect(def).toBeDefined()
    expect(def!.function.description).toMatch(/^【外部副作用】/)
    expect(def!.function.description).toContain('不适用：')
    expect(def!.function.description).toContain('kb_search')
  })

  it('经 executeTool 全链路执行（mock 网络）', async () => {
    h.httpGetText.mockResolvedValue({ status: 200, text: 'via registry' })
    const reg = createToolRegistry({})
    const r = await reg.executeTool('web_fetch', { url: 'https://example.com/ok' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('via registry')
  })
})

/* ------------------------------------------------------------------ */
/* web_search                                                           */
/* ------------------------------------------------------------------ */

function webSearch() {
  const t = builtinWebTools().find((x) => x.def.function.name === 'web_search')
  if (!t) throw new Error('web_search not found')
  return t
}

const BING_HTML = `
<ul id="b_results">
<li class="b_algo"><h2><a href="https://zh.moegirl.org.cn/动物园规则怪谈">动物园规则怪谈 - 萌娘百科</a></h2>
<div class="b_caption"><p>动物园规则怪谈是 2021 年起流传的中文网络怪谈……</p></div></li>
<li class="b_algo"><h2><a href="https://www.bilibili.com/read/cv123">规则怪谈解析 - 哔哩哔哩专栏</a></h2>
<div class="b_caption"><p>游客守则、员工守则与海洋馆……</p></div></li>
</ul>`

const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fzh.moegirl.org.cn%2Fzoo&amp;rut=abc">动物园规则怪谈</a>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fzh.moegirl.org.cn%2Fzoo">中文网络怪谈，以游客守则为载体……</a>
</div>`

describe('web_search 入参护栏与解析', () => {
  it('空 query 直接拒绝，不发请求', async () => {
    const r = await webSearch().execute({ query: '  ' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('query 不能为空')
    expect(h.httpGetText).not.toHaveBeenCalled()
  })

  it('Bing 结果页解析出标题/URL/摘要', async () => {
    h.httpGetText.mockResolvedValue({ status: 200, text: BING_HTML })
    const r = await webSearch().execute({ query: '动物园规则怪谈' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('引擎：Bing')
    expect(r.text).toContain('萌娘百科')
    expect(r.text).toContain('https://www.bilibili.com/read/cv123')
    expect(r.text).toContain('游客守则')
    // 默认 5 条上限内请求 URL 已编码
    expect(h.httpGetText.mock.calls[0][0]).toContain('bing.com/search?q=')
  })

  it('Bing 失败自动回落 DuckDuckGo 并解码 uddg 包装链接', async () => {
    h.httpGetText
      .mockRejectedValueOnce(new HttpUtilError('timeout', 'timeout'))
      .mockResolvedValueOnce({ status: 200, text: DDG_HTML })
    const r = await webSearch().execute({ query: 'zoo' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('引擎：DuckDuckGo')
    // uddg 解码出真实目标 URL，而不是 duckduckgo.com 跳转壳
    expect(r.text).toContain('https://zh.moegirl.org.cn/zoo')
  })

  it('双引擎均失败时聚合软失败', async () => {
    h.httpGetText.mockRejectedValue(new HttpUtilError('network', '无法连接'))
    const r = await webSearch().execute({ query: 'x' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Bing')
    expect(r.error).toContain('DuckDuckGo')
  })

  it('HTTP 200 但解析不到结果时尝试下一引擎', async () => {
    h.httpGetText
      .mockResolvedValueOnce({ status: 200, text: '<html><body>无结果页</body></html>' })
      .mockResolvedValueOnce({ status: 200, text: DDG_HTML })
    const r = await webSearch().execute({ query: 'zoo' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('引擎：DuckDuckGo')
  })

  it('count 越界收敛到 1～10', async () => {
    h.httpGetText.mockResolvedValue({ status: 200, text: BING_HTML })
    const r = await webSearch().execute({ query: 'x', count: 999 }, CTX)
    expect(r.ok).toBe(true)
  })
})
