/**
 * textureSourceCache 单测：命中、LRU 淘汰、未知 token、clear 失效。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { clearTextureSources, getTextureSource, putTextureSource } from '../textureSourceCache'

beforeEach(() => {
  clearTextureSources()
})

describe('textureSourceCache', () => {
  it('put 后 get 命中', () => {
    const token = putTextureSource('data:image/png;base64,AAA')
    expect(getTextureSource(token)).toBe('data:image/png;base64,AAA')
  })

  it('未知 token 返回 null', () => {
    expect(getTextureSource('nope')).toBeNull()
  })

  it('LRU 超 12 张淘汰最旧', () => {
    const tokens = Array.from({ length: 13 }, (_, i) => putTextureSource(`d${i}`))
    expect(getTextureSource(tokens[0]!)).toBeNull() // 最旧（第 1 张）被淘汰
    expect(getTextureSource(tokens[12]!)).toBe('d12') // 最新仍在
  })

  it('get 命中刷新最近使用顺序', () => {
    const tokens = Array.from({ length: 12 }, (_, i) => putTextureSource(`d${i}`))
    getTextureSource(tokens[0]!) // tokens[0] 刷新为最近使用
    putTextureSource('d-new') // 此时最旧是 tokens[1]，应被淘汰
    expect(getTextureSource(tokens[0]!)).toBe('d0')
    expect(getTextureSource(tokens[1]!)).toBeNull()
  })

  it('clear 后失效', () => {
    const token = putTextureSource('d0')
    clearTextureSources()
    expect(getTextureSource(token)).toBeNull()
  })
})
