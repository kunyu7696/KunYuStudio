import { describe, expect, it, vi, beforeEach } from 'vitest'

// mock httpUtil：免费兜底接口拦截；AI 链路因默认设置无 provider 自然短路
vi.mock('../httpUtil', () => ({
  httpGetJson: vi.fn(),
  httpDownload: vi.fn()
}))

import { httpGetJson } from '../httpUtil'
import {
  needsTranslation,
  chunkTexts,
  parseAiTranslateResponse,
  translateToZh
} from '../translateService'

describe('needsTranslation', () => {
  it('含中文的文本不翻译', () => {
    expect(needsTranslation('已经中文')).toBe(false)
    expect(needsTranslation('JEI 中文混合')).toBe(false)
  })

  it('太短 / 无字母的文本不翻译', () => {
    expect(needsTranslation('a')).toBe(false)
    expect(needsTranslation('12345')).toBe(false)
    expect(needsTranslation('!!! ---')).toBe(false)
    expect(needsTranslation('  ')).toBe(false)
  })

  it('正常英文文本需要翻译', () => {
    expect(needsTranslation('JEI')).toBe(true)
    expect(needsTranslation('A rendering engine')).toBe(true)
  })
})

describe('chunkTexts', () => {
  it('空数组返回空', () => {
    expect(chunkTexts([])).toEqual([])
  })

  it('按条数切块（默认 20 条/块）', () => {
    const texts = Array.from({ length: 21 }, (_, i) => `t${i}`)
    const chunks = chunkTexts(texts)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(20)
    expect(chunks[1]).toEqual(['t20'])
  })

  it('自定义条数上限', () => {
    const chunks = chunkTexts(['a', 'b', 'c', 'd', 'e'], 2, 99999)
    expect(chunks).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('按总字符数切块', () => {
    const chunks = chunkTexts(['aaaaa', 'bbbbb', 'c'], 12, 10)
    expect(chunks).toEqual([['aaaaa', 'bbbbb'], ['c']])
  })

  it('单条超长文本独占一块', () => {
    const long = 'x'.repeat(5000)
    const chunks = chunkTexts([long, 'short'])
    expect(chunks[0]).toEqual([long])
    expect(chunks.flat()).toContain('short')
  })
})

describe('parseAiTranslateResponse', () => {
  it('解析纯 JSON 数组', () => {
    expect(parseAiTranslateResponse('["你好","世界"]', 2)).toEqual(['你好', '世界'])
  })

  it('容错去除 markdown 围栏', () => {
    expect(parseAiTranslateResponse('```json\n["你好"]\n```', 1)).toEqual(['你好'])
    expect(parseAiTranslateResponse('```\n["你好"]\n```', 1)).toEqual(['你好'])
  })

  it('提取散文包裹的首个数组', () => {
    expect(parseAiTranslateResponse('翻译结果如下：["你好"] 以上是结果', 1)).toEqual(['你好'])
  })

  it('长度不足时缺位补 null', () => {
    expect(parseAiTranslateResponse('["你好"]', 3)).toEqual(['你好', null, null])
  })

  it('非字符串或空白项置 null', () => {
    expect(parseAiTranslateResponse('["", "  ", null, 42, "好"]', 5)).toEqual([
      null,
      null,
      null,
      null,
      '好'
    ])
  })

  it('非法输入返回 null', () => {
    expect(parseAiTranslateResponse('not json', 1)).toBeNull()
    expect(parseAiTranslateResponse('[]', 1)).toBeNull()
    expect(parseAiTranslateResponse('{"a":1}', 1)).toBeNull()
    expect(parseAiTranslateResponse('', 1)).toBeNull()
  })
})

describe('translateToZh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无需翻译的文本全部置 null，不发起网络请求', async () => {
    const r = await translateToZh(['已经中文', '12345', ''])
    expect(r.translations).toEqual([null, null, null])
    expect(r.provider).toBe('none')
    expect(httpGetJson).not.toHaveBeenCalled()
  })

  it('未配置 AI 时走免费接口兜底（provider=free）', async () => {
    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: { responseData: { translatedText: '渲染引擎优化' } }
    })
    const r = await translateToZh(['rendering engine optimization m16t1'])
    expect(r.translations).toEqual(['渲染引擎优化'])
    expect(r.provider).toBe('free')
    const [url] = vi.mocked(httpGetJson).mock.calls[0]!
    expect(url).toContain('api.mymemory.translated.net')
    expect(url).toContain('langpair=en|zh-CN')
  }, 15000)

  it('命中缓存时 provider=cache 且零网络开销', async () => {
    // 上一条用例已把 'rendering engine optimization m16t1' 写入缓存
    const r = await translateToZh(['rendering engine optimization m16t1'])
    expect(r.translations).toEqual(['渲染引擎优化'])
    expect(r.provider).toBe('cache')
    expect(httpGetJson).not.toHaveBeenCalled()
  })

  it('免费接口失败时该条返回 null（展示原文），provider=none', async () => {
    vi.mocked(httpGetJson).mockRejectedValueOnce(new Error('network down'))
    const r = await translateToZh(['unique failure probe m16t2'])
    expect(r.translations).toEqual([null])
    expect(r.provider).toBe('none')
  }, 15000)

  it('MyMemory 回显原文或警告时视为失败', async () => {
    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: { responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } }
    })
    const r = await translateToZh(['warning echo probe m16t3'])
    expect(r.translations).toEqual([null])
  }, 15000)

  it('重复文本去重：相同内容只请求一次', async () => {
    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: { responseData: { translatedText: '去重条目' } }
    })
    const r = await translateToZh(['dedupe probe m16t4', 'dedupe probe m16t4'])
    expect(r.translations).toEqual(['去重条目', '去重条目'])
    expect(httpGetJson).toHaveBeenCalledTimes(1)
  }, 15000)

  it('混合输入：中文/短文本跳过，英文走翻译', async () => {
    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: { responseData: { translatedText: '混合探测译文' } }
    })
    const r = await translateToZh(['已经中文', 'mixed probe m16t5', '1'])
    expect(r.translations[0]).toBeNull()
    expect(r.translations[1]).toBe('混合探测译文')
    expect(r.translations[2]).toBeNull()
  }, 15000)
})
