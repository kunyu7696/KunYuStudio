import { describe, expect, it } from 'vitest'
import { StreamLineFramer } from '../ai/streamFramer'

/**
 * t71s 流式分帧契约：
 * - SSE：剥 data: 前缀、忽略注释/空行/非 data 字段、透传 [DONE]、TCP 跨包切断行可拼接
 * - NDJSON（Ollama）：每行一个 JSON，空行忽略
 */
describe('StreamLineFramer SSE (OpenAI 兼容)', () => {
  it('剥除 data: 前缀并逐帧返回，忽略事件字段与空行', () => {
    const f = new StreamLineFramer(true)
    const raw =
      ': comment\n' +
      'event: message\n' +
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
      'data: [DONE]\n\n'
    const frames = f.push(raw)
    expect(frames).toEqual([
      '{"choices":[{"delta":{"content":"你"}}]}',
      '{"choices":[{"delta":{"content":"好"}}]}',
      '[DONE]'
    ])
  })

  it('支持任意字节边界的跨包拼接', () => {
    const f = new StreamLineFramer(true)
    const full = 'data: {"choices":[{"delta":{"content":"hello world"}}]}\n\n'
    const got: string[] = []
    // 逐字符切包（最极端的分包情形）
    for (const ch of full) got.push(...f.push(ch))
    got.push(...f.flush())
    expect(got).toEqual(['{"choices":[{"delta":{"content":"hello world"}}]}'])
  })

  it('flush 返回未以换行结束的残余 data 帧', () => {
    const f = new StreamLineFramer(true)
    expect(f.push('data: {"a":1}')).toEqual([])
    expect(f.flush()).toEqual(['{"a":1}'])
    expect(f.flush()).toEqual([])
  })
})

describe('StreamLineFramer NDJSON (Ollama)', () => {
  it('逐行返回 JSON，忽略空行', () => {
    const f = new StreamLineFramer(false)
    const frames = f.push(
      '{"model":"llama3","message":{"content":"Hi"}}\n' +
        '\n' +
        '{"model":"llama3","message":{"content":"!"},"done":true}\n'
    )
    expect(frames).toHaveLength(2)
    expect(JSON.parse(frames[0]).message.content).toBe('Hi')
    expect(JSON.parse(frames[1]).done).toBe(true)
  })

  it('半包缓存到下一帧才输出', () => {
    const f = new StreamLineFramer(false)
    expect(f.push('{"message":{"content":"ab')).toEqual([])
    const frames = f.push('cd"}}\n')
    expect(JSON.parse(frames[0]).message.content).toBe('abcd')
  })
})
