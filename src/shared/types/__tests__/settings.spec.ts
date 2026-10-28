import { describe, expect, it } from 'vitest'
import { applyPatch, DEFAULT_SETTINGS, mergeWithDefaults, type AppSettings } from '../settings'

/**
 * 回归测试：启动恢复相关默认值。
 * - 0.1.1 起默认值以维护者实测配置为基准：restoreLastProject 默认关闭（用户显式开启才恢复）。
 */
describe('设置默认值', () => {
  it('restoreLastProject 默认为 false', () => {
    expect(DEFAULT_SETTINGS.general.restoreLastProject).toBe(false)
  })

  it('空配置回退到默认值（restoreLastProject=false）', () => {
    const parsed = mergeWithDefaults({})
    expect(parsed.general.restoreLastProject).toBe(false)
  })

  it('用户显式 false 时尊重用户配置', () => {
    const parsed = mergeWithDefaults({ general: { restoreLastProject: false } })
    expect(parsed.general.restoreLastProject).toBe(false)
  })

  it('用户显式 true 时保持开启', () => {
    const parsed = mergeWithDefaults({ general: { restoreLastProject: true } })
    expect(parsed.general.restoreLastProject).toBe(true)
  })

  it('DEFAULT_SETTINGS 结构完整（无意外变更）', () => {
    // 快照关键顶层 section，防止默认值被无意删除
    const keys = Object.keys(DEFAULT_SETTINGS).sort()
    expect(keys).toEqual(['ai', 'editor', 'general', 'integration', 'java', 'marketplace', 'network', 'publish'])
  })
})

describe('general.themeMode 主题模式', () => {
  it('默认跟随系统（0.1.1 起）', () => {
    expect(DEFAULT_SETTINGS.general.themeMode).toBe('system')
  })

  it('空配置回退 system', () => {
    expect(mergeWithDefaults({}).general.themeMode).toBe('system')
  })

  it('合法值 light/dark 被保留', () => {
    expect(mergeWithDefaults({ general: { themeMode: 'light' } }).general.themeMode).toBe('light')
    expect(mergeWithDefaults({ general: { themeMode: 'dark' } }).general.themeMode).toBe('dark')
  })

  it('非法值回退 system', () => {
    expect(mergeWithDefaults({ general: { themeMode: 'neon' } }).general.themeMode).toBe('system')
    expect(mergeWithDefaults({ general: { themeMode: 1 } }).general.themeMode).toBe('system')
  })

  it('applyPatch 可更新 themeMode', () => {
    const patched = applyPatch(DEFAULT_SETTINGS, { general: { themeMode: 'light' } })
    expect(patched.general.themeMode).toBe('light')
  })
})

describe('integration 分段', () => {
  it('默认桥接开启、端口 0（随机）、总是授权模式（0.1.1 起）', () => {
    const d = DEFAULT_SETTINGS.integration
    expect(d.mcpBridgeEnabled).toBe(true)
    // 默认随机端口，避免固定端口被本机任意进程扫描定位
    expect(d.mcpBridgePort).toBe(0)
    expect(d.mcpAuthMode).toBe('always')
    expect(d.codexPath).toBe('')
    expect(d.claudeCodePath).toBe('')
  })

  it('缺失分段整段回退默认', () => {
    const parsed = mergeWithDefaults({})
    expect(parsed.integration).toEqual(DEFAULT_SETTINGS.integration)
  })

  it('非法端口钳制到 1024-65535（0 = 随机合法），非法授权模式回退 always', () => {
    const parsed = mergeWithDefaults({
      integration: { mcpBridgePort: 80, mcpAuthMode: 'never' }
    })
    expect(parsed.integration.mcpBridgePort).toBe(1024)
    expect(parsed.integration.mcpAuthMode).toBe('always')
  })

  it('合法值完整保留', () => {
    const parsed = mergeWithDefaults({
      integration: {
        codexPath: 'D:/tools/codex.cmd',
        claudeCodePath: '/usr/local/bin/claude',
        mcpBridgeEnabled: true,
        mcpBridgePort: 19280,
        mcpAuthMode: 'always'
      }
    })
    expect(parsed.integration.codexPath).toBe('D:/tools/codex.cmd')
    expect(parsed.integration.claudeCodePath).toBe('/usr/local/bin/claude')
    expect(parsed.integration.mcpBridgeEnabled).toBe(true)
    expect(parsed.integration.mcpBridgePort).toBe(19280)
    expect(parsed.integration.mcpAuthMode).toBe('always')
  })
})

describe('publish 分段', () => {
  it('默认全空 + release', () => {
    const d = DEFAULT_SETTINGS.publish
    expect(d.modrinthToken).toBe('')
    expect(d.modrinthProjectId).toBe('')
    expect(d.curseforgeToken).toBe('')
    expect(d.curseforgeProjectId).toBe('')
    expect(d.defaultReleaseType).toBe('release')
  })

  it('缺失分段整段回退默认', () => {
    const parsed = mergeWithDefaults({})
    expect(parsed.publish).toEqual(DEFAULT_SETTINGS.publish)
  })

  it('非法 releaseType 回退 release，超长 token 截断', () => {
    const parsed = mergeWithDefaults({
      publish: {
        modrinthToken: 'x'.repeat(600),
        defaultReleaseType: 'nightly'
      }
    })
    expect(parsed.publish.modrinthToken.length).toBe(500)
    expect(parsed.publish.defaultReleaseType).toBe('release')
  })

  it('合法值完整保留', () => {
    const parsed = mergeWithDefaults({
      publish: {
        modrinthToken: 'mrp_abc',
        modrinthProjectId: 'my-pack',
        curseforgeToken: 'cf_tok',
        curseforgeProjectId: '123456',
        defaultReleaseType: 'beta'
      }
    })
    expect(parsed.publish.modrinthToken).toBe('mrp_abc')
    expect(parsed.publish.modrinthProjectId).toBe('my-pack')
    expect(parsed.publish.curseforgeToken).toBe('cf_tok')
    expect(parsed.publish.curseforgeProjectId).toBe('123456')
    expect(parsed.publish.defaultReleaseType).toBe('beta')
  })
})

/** 类型层断言：确保 restoreLastProject 在类型系统中为必填布尔 */
function _typeCheck(_s: AppSettings): boolean {
  return _s.general.restoreLastProject
}
void _typeCheck

/**
 * （设置层）：defaultProviderId 部分更新不得被静默清空。
 * patch 显式携带非法 id 时回退到已持久化值（仍对 providers 列表合法才回退）。
 */
describe('applyPatch · defaultProviderId 部分更新', () => {
  const withProvider = (): AppSettings =>
    applyPatch(mergeWithDefaults(undefined), {
      ai: {
        providers: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            kind: 'openai-compatible',
            baseUrl: 'https://api.deepseek.com',
            apiKey: 'k',
            apiKeyUrl: '',
            model: 'deepseek-flash',
            maxTokens: 4096,
            temperature: 0.7,
            enabled: true
          }
        ],
        defaultProviderId: 'deepseek'
      }
    })

  it('patch 只含合法 defaultProviderId（不带 providers）→ 保留', () => {
    const next = applyPatch(withProvider(), { ai: { defaultProviderId: 'deepseek' } })
    expect(next.ai.defaultProviderId).toBe('deepseek')
    expect(next.ai.providers).toHaveLength(1)
  })

  it('patch 显式携带非法 id → 回退到已持久化的默认厂商（不再静默清空）', () => {
    const next = applyPatch(withProvider(), { ai: { defaultProviderId: 'x' } })
    expect(next.ai.defaultProviderId).toBe('deepseek')
  })

  it('patch 删除了默认厂商且未显式更新 defaultProviderId → 清空（不悬挂指向已删除项）', () => {
    const next = applyPatch(withProvider(), { ai: { providers: [] } })
    expect(next.ai.defaultProviderId).toBe(null)
  })

  it('非法 id 回落已持久化默认厂商（0.1.1 起为预置 DeepSeek）', () => {
    const next = applyPatch(mergeWithDefaults(undefined), { ai: { defaultProviderId: 'x' } })
    expect(next.ai.defaultProviderId).toBe('preset-deepseek')
  })
})

/**
 * 0.1.1 预置默认值（维护者实测配置为默认）的回退语义：
 * 字段缺省（首启/旧版升级）→ 注入预置；显式空数组 = 用户删光，尊重不回灌；
 * 预置项永不含密钥（apiKey 空串，密钥仅存各机 userData）。
 */
describe('ai 预置默认值回退（0.1.1）', () => {
  it('首启缺省 → 预置 DeepSeek + 五档指向 + 默认厂商', () => {
    const parsed = mergeWithDefaults(undefined)
    expect(parsed.ai.providers.map((p) => p.id)).toEqual(['preset-deepseek'])
    expect(parsed.ai.defaultProviderId).toBe('preset-deepseek')
    for (const tier of Object.values(parsed.ai.tierModels)) {
      expect(tier.providerId).toBe('preset-deepseek')
    }
    // 预置厂商不得携带任何密钥
    expect(parsed.ai.providers[0].apiKey).toBe('')
  })

  it('首启缺省 → 预置 7 个 MCP 服务且 env 无密文', () => {
    const parsed = mergeWithDefaults(undefined)
    expect(parsed.ai.customMcpServers).toHaveLength(7)
    for (const s of parsed.ai.customMcpServers) {
      for (const v of Object.values(s.env)) {
        expect(v.startsWith('enc:v1:')).toBe(false)
      }
    }
  })

  it('用户显式删光 providers → 尊重空数组，默认厂商清空不悬挂', () => {
    const parsed = mergeWithDefaults({ ai: { providers: [] } })
    expect(parsed.ai.providers).toEqual([])
    expect(parsed.ai.defaultProviderId).toBe(null)
  })

  it('用户显式删光 customMcpServers → 尊重空数组不回灌', () => {
    const parsed = mergeWithDefaults({ ai: { customMcpServers: [] } })
    expect(parsed.ai.customMcpServers).toEqual([])
  })

  it('实体自由编码开关：首启缺省关闭，持久化读取', () => {
    // 首启默认关
    expect(mergeWithDefaults(undefined).ai.entityFreeformEnabled).toBe(false)
    // 显式开启
    expect(mergeWithDefaults({ ai: { entityFreeformEnabled: true } }).ai.entityFreeformEnabled).toBe(true)
    // 显式关闭
    expect(mergeWithDefaults({ ai: { entityFreeformEnabled: false } }).ai.entityFreeformEnabled).toBe(false)
    // 非法值回落默认
    expect(mergeWithDefaults({ ai: { entityFreeformEnabled: 'yes' } }).ai.entityFreeformEnabled).toBe(false)
  })

  it('全局自由编码开关：首启缺省关闭，持久化读取', () => {
    // 首启默认关
    expect(mergeWithDefaults(undefined).ai.globalFreeformEnabled).toBe(false)
    // 显式开启
    expect(mergeWithDefaults({ ai: { globalFreeformEnabled: true } }).ai.globalFreeformEnabled).toBe(true)
    // 显式关闭
    expect(mergeWithDefaults({ ai: { globalFreeformEnabled: false } }).ai.globalFreeformEnabled).toBe(false)
    // 非法值回落默认
    expect(mergeWithDefaults({ ai: { globalFreeformEnabled: 'yes' } }).ai.globalFreeformEnabled).toBe(false)
  })
})
