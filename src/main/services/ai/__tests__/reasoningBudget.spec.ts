import { describe, expect, it } from 'vitest'
import { isReasoningModel, resolveMaxTokens } from '../reasoningBudget'

describe('isReasoningModel', () => {
  it.each([
    'deepseek-reasoner',
    'deepseek-r1',
    'deepseek-r1-250120',
    'qwen3-thinking',
    'qwq-32b',
    'glm-z1-flash',
    'glm-z1-plus',
    'kimi-k1.5',
    'o3-mini',
    'o1'
  ])('思考型模型命中：%s', (model) => {
    expect(isReasoningModel(model)).toBe(true)
  })

  it.each([
    'deepseek-chat',
    'deepseek-coder',
    'gpt-4o',
    'gpt-4o-mini',
    'claude-3-5-sonnet',
    'gemini-2.0-flash',
    'qwen2.5-72b-instruct',
    'glm-4-plus',
    'moonshot-v1-32k',
    'fake-model'
  ])('非思考型模型不命中：%s', (model) => {
    expect(isReasoningModel(model)).toBe(false)
  })
})

describe('resolveMaxTokens', () => {
  it('调用方显式指定时始终尊重（即使思考型模型 + 小值）', () => {
    expect(resolveMaxTokens(2048, 4096, 'deepseek-reasoner', 'https://api.deepseek.com/v1')).toBe(2048)
  })

  it('DeepSeek 思考型模型：预算永不低于 65536（官方建议 ≥64K），覆盖 4096/16384/32000 常见配置', () => {
    expect(resolveMaxTokens(undefined, 4096, 'deepseek-reasoner', 'https://api.deepseek.com/v1')).toBe(65536)
    expect(resolveMaxTokens(undefined, 16384, 'deepseek-r1', 'https://api.deepseek.com/v1')).toBe(65536)
    expect(resolveMaxTokens(undefined, 32000, 'deepseek-reasoner', 'https://api.deepseek.com/v1')).toBe(65536)
  })

  it('DeepSeek 思考型模型：用户配置超过 65536 时尊重用户值', () => {
    expect(resolveMaxTokens(undefined, 100000, 'deepseek-reasoner', 'https://api.deepseek.com/v1')).toBe(100000)
  })

  it('其他厂商思考型模型：预算下限 16384', () => {
    expect(resolveMaxTokens(undefined, 4096, 'qwen3-thinking', 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(16384)
    expect(resolveMaxTokens(undefined, 8192, 'glm-z1-flash', 'https://open.bigmodel.cn/api/paas/v4')).toBe(16384)
    expect(resolveMaxTokens(undefined, 16384, 'o3-mini', undefined)).toBe(16384)
  })

  it('其他厂商思考型模型：用户配置大于 16384 时尊重用户值', () => {
    expect(resolveMaxTokens(undefined, 32000, 'qwen3-thinking', 'https://dashscope.aliyuncs.com')).toBe(32000)
    expect(resolveMaxTokens(undefined, 64000, 'qwq-32b', 'https://dashscope.aliyuncs.com')).toBe(64000)
  })

  it('非思考型模型始终使用配置预算（不抬升）', () => {
    expect(resolveMaxTokens(undefined, 4096, 'deepseek-chat', 'https://api.deepseek.com/v1')).toBe(4096)
    expect(resolveMaxTokens(undefined, 16384, 'gpt-4o', 'https://api.openai.com/v1')).toBe(16384)
  })
})
