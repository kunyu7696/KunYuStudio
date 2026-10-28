import { describe, expect, it } from 'vitest'
import { consumeCode, highlightCode, renderMarkdown } from '../markdown'

/**
 * T7.1 Markdown 渲染器契约：
 * - 所有字面量 HTML 转义，javascript: 伪协议不生成可点击链接，不渲染远程图片
 * - 围栏代码块产出语言标签 + 复制按钮 + 高亮 token，原文经 consumeCode 可取回
 * - 标题/列表/粗体/行内代码等基础结构正确
 */
describe('renderMarkdown 安全性', () => {
  it('转义原始 HTML，不产出 script 标签', () => {
    const html = renderMarkdown('恶意 <script>alert(1)</script> 结尾')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('仅允许 http/https 链接，拒绝 javascript: 伪协议', () => {
    const html = renderMarkdown('[点我](javascript:alert(1)) 与 [正常](https://example.com/a)')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('href="https://example.com/a"')
  })

  it('图片降级为文字，不输出 img 标签', () => {
    const html = renderMarkdown('![x](https://example.com/a.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('example.com/a.png')
  })
})

describe('renderMarkdown 代码块', () => {
  it('输出语言标签、复制按钮，原文可通过 consumeCode 取回', () => {
    const code = 'public static final String NAME = "a\\"b";\n// 注释\nint x = 0x1F;'
    const html = renderMarkdown('```java\n' + code + '\n```')
    expect(html).toContain('class="md-code-lang"')
    expect(html).toContain('java')
    const idMatch = html.match(/data-code-id="(\d+)"/)
    expect(idMatch).not.toBeNull()
    expect(consumeCode(Number(idMatch![1]))).toBe(code)
  })

  it('Java 关键字、字符串、数字、注释被分别着色', () => {
    const html = highlightCode('int v = 42; // hi\nString s = "x";\n@Override', 'java')
    expect(html).toContain('tok-keyword') // int
    expect(html).toContain('tok-number') // 42
    expect(html).toContain('tok-comment') // // hi
    expect(html).toContain('tok-string') // "x"
    expect(html).toContain('tok-anno') // @Override
  })

  it('未知语言只转义不乱高亮', () => {
    const html = highlightCode('a < b && c > d', 'weirdlang')
    expect(html).toContain('&lt;')
    expect(html).toContain('&gt;')
    expect(html).not.toContain('tok-keyword')
  })
})

describe('renderMarkdown 基础语法', () => {
  it('标题、列表、粗体、行内代码', () => {
    const md = '# 标题\n\n- 项目 **一**\n- 项目 `code`\n1. 第一\n2. 第二'
    const html = renderMarkdown(md)
    expect(html).toContain('<h1')
    expect(html).toContain('<strong>一</strong>')
    expect(html).toContain('<ul class="md-ul">')
    expect(html).toContain('<ol class="md-ol">')
    expect(html).toContain('<code class="md-inline-code">code</code>')
  })

  it('无围栏的多行文本归入段落并保留换行', () => {
    const html = renderMarkdown('第一行\n第二行')
    expect(html).toContain('第一行<br>第二行')
  })
})
