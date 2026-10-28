/**
 * extractUsage 单测（usage 落库）：OpenAI usage / Ollama eval_count 归一化，
 * 字段缺失或非法时如实返回 undefined，调用方按无用量处理。
 */
import { describe, expect, it } from 'vitest'
import { extractUsage } from '../aiService'

describe('extractUsage', () => {
  it('OpenAI 兼容响应：解析顶层 usage 三元组', () => {
    expect(
      extractUsage('openai', { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    ).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })
  })

  it('OpenAI 兼容响应：usage 缺失返回 undefined', () => {
    expect(extractUsage('openai', { choices: [] })).toBeUndefined()
    expect(extractUsage('openai', null)).toBeUndefined()
    expect(extractUsage('openai', {})).toBeUndefined()
  })

  it('OpenAI 兼容响应：字段非数字按缺省处理，全缺省整体 undefined', () => {
    expect(extractUsage('openai', { usage: { prompt_tokens: 'x' } })).toBeUndefined()
    expect(extractUsage('openai', { usage: {} })).toBeUndefined()
  })

  it('Ollama 响应：解析 prompt_eval_count / eval_count', () => {
    expect(extractUsage('ollama', { prompt_eval_count: 8, eval_count: 3 })).toEqual({
      promptTokens: 8,
      completionTokens: 3
    })
  })

  it('Ollama 响应：无计数返回 undefined', () => {
    expect(extractUsage('ollama', { message: { content: 'hi' } })).toBeUndefined()
  })
})
