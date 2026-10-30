import { describe, expect, it } from 'vitest'
import { validateRendererPlugin } from '../rendererPlugin'

/**
 * 渲染层声明式插件的清单校验契约：
 * 主进程扫描与渲染层注册共用同一份校验（双层防御），
 * 这里锁定「合法放行 / 畸形拦截」的边界，尤其是 monarch 引用的目录逃逸。
 */

/** 最小合法清单：内联 monarch */
const VALID_INLINE = {
  id: 'kunyu.snbt-colors',
  name: 'SNBT 语法着色',
  version: '1.0.0',
  description: '官方示例',
  author: 'KunYu Studio',
  contributes: {
    languages: [
      {
        id: 'snbt',
        aliases: ['SNBT'],
        extensions: ['.snbt'],
        monarch: { tokenizer: { root: [] } },
        configuration: { comments: { lineComment: '#' } }
      }
    ]
  }
}

describe('validateRendererPlugin', () => {
  it('合法清单（内联 monarch）通过', () => {
    const r = validateRendererPlugin(VALID_INLINE)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.manifest?.id).toBe('kunyu.snbt-colors')
  })

  it('合法清单（外部 language.json 引用）通过', () => {
    const r = validateRendererPlugin({
      ...VALID_INLINE,
      contributes: { languages: [{ id: 'snbt', extensions: ['.snbt'], monarch: 'language.json' }] }
    })
    expect(r.ok).toBe(true)
  })

  it('非对象直接拒绝', () => {
    expect(validateRendererPlugin(null).ok).toBe(false)
    expect(validateRendererPlugin('x').ok).toBe(false)
    expect(validateRendererPlugin([1]).ok).toBe(false)
  })

  it('缺 id / 坏版本号 / 空 name 逐个报出', () => {
    const r = validateRendererPlugin({ ...VALID_INLINE, id: '!!', version: '1', name: '' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/id 非法/)
    expect(r.errors.join()).toMatch(/version/)
    expect(r.errors.join()).toMatch(/name/)
  })

  it('monarch 引用拒绝目录逃逸与绝对路径', () => {
    for (const bad of ['../evil.json', 'a/b.json', 'C:\\\\evil.json', 'language.txt']) {
      const r = validateRendererPlugin({
        ...VALID_INLINE,
        contributes: { languages: [{ id: 'snbt', monarch: bad }] }
      })
      expect(r.ok).toBe(false)
      expect(r.errors.join()).toMatch(/monarch 引用/)
    }
  })

  it('语言 id 非法 / 扩展名缺前导点被拒绝', () => {
    const r = validateRendererPlugin({
      ...VALID_INLINE,
      contributes: { languages: [{ id: 'SNBT!', extensions: ['snbt'], monarch: {} }] }
    })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/languages\[0\]\.id/)
    expect(r.errors.join()).toMatch(/extensions/)
  })

  it('languages 超出数量上限被拒绝', () => {
    const langs = Array.from({ length: 11 }, (_, i) => ({ id: `lang${i}`, monarch: {} }))
    const r = validateRendererPlugin({ ...VALID_INLINE, contributes: { languages: langs } })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/contributes\.languages/)
  })

  it('缺少 contributes 被拒绝', () => {
    const r = validateRendererPlugin({ id: 'a.b', name: 'x', version: '1.0.0' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/contributes/)
  })
})
