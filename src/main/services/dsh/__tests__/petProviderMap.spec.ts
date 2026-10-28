/**
 * kunyu 服务商 ↔ dsh-pet 余额 provider 映射纯函数测试。
 */
import { describe, expect, it } from 'vitest'
import {
  DSH_BALANCE_PROVIDER_DEEPSEEK,
  DSH_CREDENTIAL_DEEPSEEK_API_KEY,
  dshBalanceProviderId,
  isDeepSeekCredentialRef,
  isDeepSeekOfficialBaseUrl,
  kunyuProviderIdForDsh
} from '../petProviderMap'

describe('petProviderMap：DeepSeek 官方端点识别', () => {
  it('官方 baseUrl 各种写法均识别（带 /v1、尾斜杠、大写域）', () => {
    expect(isDeepSeekOfficialBaseUrl('https://api.deepseek.com/v1')).toBe(true)
    expect(isDeepSeekOfficialBaseUrl('https://api.deepseek.com')).toBe(true)
    expect(isDeepSeekOfficialBaseUrl('https://api.deepseek.com/')).toBe(true)
    expect(isDeepSeekOfficialBaseUrl('HTTPS://API.DEEPSEEK.COM/v1')).toBe(true)
  })

  it('中转/第三方/非法 URL 均不识别', () => {
    expect(isDeepSeekOfficialBaseUrl('https://api.deepseek.com.example.com/v1')).toBe(false)
    expect(isDeepSeekOfficialBaseUrl('https://api.moonshot.cn/v1')).toBe(false)
    expect(isDeepSeekOfficialBaseUrl('http://localhost:11434')).toBe(false)
    expect(isDeepSeekOfficialBaseUrl('')).toBe(false)
    expect(isDeepSeekOfficialBaseUrl('not a url')).toBe(false)
  })
})

describe('petProviderMap：provider id 双向映射', () => {
  it('官方 baseUrl → deepseek-official；其余 → null', () => {
    expect(dshBalanceProviderId('https://api.deepseek.com/v1')).toBe(DSH_BALANCE_PROVIDER_DEEPSEEK)
    expect(dshBalanceProviderId('https://api.moonshot.cn/v1')).toBeNull()
  })

  it('deepseek-official 反查 kunyu 随机 id；其余 id 原样返回', () => {
    const providers = [
      { id: 'ai-abc-111', baseUrl: 'https://api.moonshot.cn/v1' },
      { id: 'ai-def-222', baseUrl: 'https://api.deepseek.com/v1' }
    ]
    expect(kunyuProviderIdForDsh('deepseek-official', providers)).toBe('ai-def-222')
    // 没有官方服务商时原样返回，不吞 id
    expect(kunyuProviderIdForDsh('deepseek-official', [{ id: 'x', baseUrl: 'https://example.com' }])).toBe(
      'deepseek-official'
    )
    expect(kunyuProviderIdForDsh('ai-abc-111', providers)).toBe('ai-abc-111')
  })
})

describe('petProviderMap：凭据 ref', () => {
  it('仅 DEEPSEEK_API_KEY 被认可', () => {
    expect(isDeepSeekCredentialRef(DSH_CREDENTIAL_DEEPSEEK_API_KEY)).toBe(true)
    expect(isDeepSeekCredentialRef('OTHER_KEY')).toBe(false)
    expect(isDeepSeekCredentialRef(undefined)).toBe(false)
    expect(isDeepSeekCredentialRef(null)).toBe(false)
  })
})
