/**
 * settingsService 敏感字段加密测试：
 * - 落盘为 enc:v1: 密文、内存缓存保持明文（消费侧零改动）
 * - 旧明文数据首次 init 自动迁移为密文
 * - safeStorage 不可用时退回明文不崩溃
 * electron 的 safeStorage 用 vi.mock 打桩为可逆的伪加密。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 伪 safeStorage：encrypt = base64(反转)，decrypt 逆操作。isEncryptionAvailable 可控。
const encState = { available: true }
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encState.available,
    encryptString: (s: string) => Buffer.from([...s].reverse().join(''), 'utf8'),
    decryptString: (b: Buffer) => [...b.toString('utf8')].reverse().join('')
  }
}))

// electron-store 打桩：内存对象模拟磁盘文件
const disk: Record<string, unknown> = {}
vi.mock('electron-store', () => ({
  default: class MockStore {
    get store() {
      return disk
    }
    set store(v: unknown) {
      Object.keys(disk).forEach((k) => delete disk[k])
      Object.assign(disk, v)
    }
  }
}))

import { getAllSettings, getSection, initSettings, maskSecrets, SECRET_MASK, setSettings } from '../settingsService'

describe('settingsService 敏感字段加密', () => {
  beforeEach(() => {
    Object.keys(disk).forEach((k) => delete disk[k])
    encState.available = true
  })

  it('写入 API Key 后磁盘为密文、内存为明文', async () => {
    await initSettings()
    const next = setSettings({
      ai: { providers: [{ id: 'p1', kind: 'openai-compatible', name: 'DS', baseUrl: '', apiKey: 'sk-secret', apiKeyUrl: '', model: 'm', maxTokens: 4096, temperature: 0.7, enabled: true }] }
    })
    expect(getSection('ai').providers[0].apiKey).toBe('sk-secret')
    expect(next.ai.providers[0].apiKey).toBe('sk-secret')
    const diskKey = (disk as { ai: { providers: Array<{ apiKey: string }> } }).ai.providers[0].apiKey
    expect(diskKey.startsWith('enc:v1:')).toBe(true)
    expect(diskKey).not.toContain('sk-secret')
  })

  it('发布 token 与市场 Key 均加密落盘', async () => {
    await initSettings()
    setSettings({
      publish: { modrinthToken: 'mrp-x', curseforgeToken: 'cf-y' },
      marketplace: { curseforgeApiKey: 'cfk-z' }
    })
    const pub = (disk as { publish: { modrinthToken: string; curseforgeToken: string } }).publish
    expect(pub.modrinthToken.startsWith('enc:v1:')).toBe(true)
    expect(pub.curseforgeToken.startsWith('enc:v1:')).toBe(true)
    expect(
      (disk as { marketplace: { curseforgeApiKey: string } }).marketplace.curseforgeApiKey.startsWith('enc:v1:')
    ).toBe(true)
  })

  it('旧明文数据 init 时解密读出并回写为密文（原地迁移）', async () => {
    // 模拟旧版本落盘的明文
    Object.assign(disk, {
      ai: { providers: [{ id: 'p1', kind: 'openai-compatible', name: 'DS', baseUrl: '', apiKey: 'sk-legacy', apiKeyUrl: '', model: 'm', maxTokens: 4096, temperature: 0.7, enabled: true }] }
    })
    await initSettings()
    expect(getSection('ai').providers[0].apiKey).toBe('sk-legacy')
    const diskKey = (disk as { ai: { providers: Array<{ apiKey: string }> } }).ai.providers[0].apiKey
    expect(diskKey.startsWith('enc:v1:')).toBe(true)
  })

  it('重启后（新 init）密文能解密回明文', async () => {
    await initSettings()
    setSettings({ marketplace: { curseforgeApiKey: 'persist-me' } })
    await initSettings() // 二次 init 模拟重启
    expect(getSection('marketplace').curseforgeApiKey).toBe('persist-me')
  })

  it('safeStorage 不可用时退回明文且不崩溃', async () => {
    encState.available = false
    await initSettings()
    setSettings({ marketplace: { curseforgeApiKey: 'plain-fallback' } })
    expect(
      (disk as { marketplace: { curseforgeApiKey: string } }).marketplace.curseforgeApiKey
    ).toBe('plain-fallback')
    expect(getSection('marketplace').curseforgeApiKey).toBe('plain-fallback')
  })

  it('fail-closed：磁盘密文 + safeStorage 不可用时按空值处理，密文绝不当明文流出', async () => {
    // 先可用态写入密文（模拟在能加密的机器/会话里保存过 Key）
    await initSettings()
    setSettings({ marketplace: { curseforgeApiKey: 'sk-real-key' } })
    const diskKey = (disk as { marketplace: { curseforgeApiKey: string } }).marketplace.curseforgeApiKey
    expect(diskKey.startsWith('enc:v1:')).toBe(true)
    // 模拟切换到无钥匙串环境重启：密文读不出 → 空值而非 enc:v1: 乱码流出
    encState.available = false
    await initSettings()
    expect(getSection('marketplace').curseforgeApiKey).toBe('')
    expect(getSection('marketplace').curseforgeApiKey).not.toContain('enc:v1:')
  })

  it('maskSecrets：非空密钥替换为哨兵、空密钥保持空串、明文不泄出', async () => {
    await initSettings()
    setSettings({
      marketplace: { curseforgeApiKey: 'cfk-real' },
      publish: { modrinthToken: 'mrp-real' },
      ai: { providers: [{ id: 'p1', kind: 'openai-compatible', name: 'DS', baseUrl: '', apiKey: 'sk-real', apiKeyUrl: '', model: 'm', maxTokens: 4096, temperature: 0.7, enabled: true }] }
    })
    const masked = maskSecrets(getAllSettings())
    expect(masked.marketplace.curseforgeApiKey).toBe(SECRET_MASK)
    expect(masked.publish.modrinthToken).toBe(SECRET_MASK)
    expect(masked.publish.curseforgeToken).toBe('')
    expect(masked.ai.providers[0].apiKey).toBe(SECRET_MASK)
    // 掩码副本不影响内存缓存
    expect(getSection('ai').providers[0].apiKey).toBe('sk-real')
  })

  it('setSettings 哨兵还原：回传哨兵视为未修改，真实密钥保留', async () => {
    await initSettings()
    setSettings({ marketplace: { curseforgeApiKey: 'cfk-keep' } })
    // 渲染层改别的字段、密钥原样回传哨兵
    setSettings({ marketplace: { curseforgeApiKey: SECRET_MASK, allowMcimMirror: true } })
    expect(getSection('marketplace').curseforgeApiKey).toBe('cfk-keep')
    // 显式清空仍然生效
    setSettings({ marketplace: { curseforgeApiKey: '' } })
    expect(getSection('marketplace').curseforgeApiKey).toBe('')
  })
})
