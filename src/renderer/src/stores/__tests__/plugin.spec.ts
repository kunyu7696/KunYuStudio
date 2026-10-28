/**
 * 插件（MCP）store 组件级测试。
 * 覆盖市场搜索去重/分页游标、安装载荷克隆与刷新、开关乐观更新。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePluginStore } from '../plugin'
import type { CustomMcpServer } from '../../../../shared/types/settings'
import type { MarketPlugin } from '../../../../shared/types/plugin'

const listMcpServersMock = vi.fn()
const toggleMcpMock = vi.fn()
const testMcpMock = vi.fn()
const listMarketMock = vi.fn()
const installMarketMock = vi.fn()

function stubApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    plugin: {
      listMcpServers: listMcpServersMock,
      toggleMcp: toggleMcpMock,
      testMcp: testMcpMock,
      listMarket: listMarketMock,
      installMarket: installMarketMock
    }
  }
}

function server(id: string, args: string[]): CustomMcpServer {
  return { id, name: id, command: 'npx', args, enabled: true } as CustomMcpServer
}

function marketPlugin(id: string, identifier: string): MarketPlugin {
  return {
    id,
    identifier,
    name: `插件 ${id}`,
    description: 'desc',
    registryId: `registry/${id}`,
    version: '1.0.0',
    author: 'tester',
    category: 'tool',
    permission: 'none'
  } as unknown as MarketPlugin
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  stubApi()
})

describe('getters', () => {
  it('installedSignatures 按 command+args 聚合；installedIdentifiers 提取包名', () => {
    const s = usePluginStore()
    s.mcpServers = [
      server('a', ['-y', '@scope/alpha@1.2.0']),
      server('b', ['--port', '3000', '-p', '@scope/beta'])
    ]
    expect([...s.installedSignatures]).toEqual([
      'npx -y @scope/alpha@1.2.0',
      'npx --port 3000 -p @scope/beta'
    ])
    expect(s.installedIdentifiers.has('@scope/alpha')).toBe(true)
    expect(s.installedIdentifiers.has('@scope/beta')).toBe(true)
  })

  it('isInstalled 按 identifier 粗匹配市场插件', () => {
    const s = usePluginStore()
    s.mcpServers = [server('a', ['-y', '@scope/alpha'])]
    expect(s.isInstalled(marketPlugin('p1', '@scope/alpha'))).toBe(true)
    expect(s.isInstalled(marketPlugin('p2', '@scope/other'))).toBe(false)
  })
})

describe('searchMarket / loadMoreMarket', () => {
  it('搜索重置分页并按 id 去重；回退提示写入 marketNotice', async () => {
    listMarketMock.mockResolvedValue({
      ok: true,
      plugins: [marketPlugin('p1', '@scope/a'), marketPlugin('p1', '@scope/a')],
      nextCursor: 'cur-1',
      source: 'bundled',
      error: '官方目录不可达，已回退内置精选'
    })
    const s = usePluginStore()
    await s.searchMarket('  alpha  ')
    expect(s.marketEntries).toHaveLength(1) // 重复 id 去重
    expect(s.marketNextCursor).toBe('cur-1')
    expect(s.marketSource).toBe('bundled')
    expect(s.marketNotice).toContain('回退')
    expect(listMarketMock).toHaveBeenCalledWith({ search: 'alpha' })
  })

  it('无游标时 loadMoreMarket no-op；有游标时追加且继续去重', async () => {
    listMarketMock.mockResolvedValue({
      ok: true,
      plugins: [marketPlugin('p1', '@scope/a')],
      nextCursor: 'cur-1',
      source: 'official'
    })
    const s = usePluginStore()
    await s.loadMoreMarket()
    expect(listMarketMock).not.toHaveBeenCalled()
    await s.searchMarket('alpha')
    listMarketMock.mockResolvedValue({
      ok: true,
      plugins: [marketPlugin('p1', '@scope/a'), marketPlugin('p2', '@scope/b')],
      nextCursor: '',
      source: 'official'
    })
    await s.loadMoreMarket()
    expect(s.marketEntries.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(s.hasMoreMarket).toBe(false)
  })

  it('listMarket 抛错时 error 写入、条目清空', async () => {
    listMarketMock.mockRejectedValue(new Error('网络错误'))
    const s = usePluginStore()
    await s.searchMarket('x')
    expect(s.error).toBe('网络错误')
    expect(s.marketEntries).toHaveLength(0)
  })
})

describe('installFromMarket / toggleMcp / loadMcpServers', () => {
  it('安装：installingIds 进出、载荷为可结构化克隆的普通对象、成功后刷新 server 列表', async () => {
    listMcpServersMock.mockResolvedValue({ ok: true, servers: [] })
    installMarketMock.mockResolvedValue({ ok: true })
    const s = usePluginStore()
    const plugin = marketPlugin('p1', '@scope/a')
    const p = s.installFromMarket(plugin, { API_KEY: 'k' })
    expect(s.installingIds.has('p1')).toBe(true)
    await p
    expect(s.installingIds.has('p1')).toBe(false)
    const payload = installMarketMock.mock.calls[0]?.[0] as { plugin: MarketPlugin; envValues: Record<string, string> }
    expect(payload.plugin.id).toBe('p1')
    expect(payload.envValues).toEqual({ API_KEY: 'k' })
    expect(JSON.stringify(payload.plugin) === JSON.stringify(plugin)).toBe(true)
    expect(listMcpServersMock).toHaveBeenCalled() // 成功后刷新
  })

  it('toggleMcp：成功乐观更新 enabled；失败写 error 并返回 false', async () => {
    const s = usePluginStore()
    s.mcpServers = [server('a', ['-y', '@scope/alpha'])]
    toggleMcpMock.mockResolvedValue({ ok: true })
    await expect(s.toggleMcp('a', false)).resolves.toBe(true)
    expect(s.mcpServers[0]?.enabled).toBe(false)
    toggleMcpMock.mockResolvedValue({ ok: false, error: '重连失败' })
    await expect(s.toggleMcp('a', true)).resolves.toBe(false)
    expect(s.error).toBe('重连失败')
    expect(s.mcpServers[0]?.enabled).toBe(false) // 失败不乐观翻转
  })

  it('loadMcpServers：ok 时填充列表，异常时写 error', async () => {
    const s = usePluginStore()
    listMcpServersMock.mockResolvedValue({ ok: true, servers: [server('a', ['-y', 'pkg'])] })
    await s.loadMcpServers()
    expect(s.mcpServers).toHaveLength(1)
    listMcpServersMock.mockRejectedValue(new Error('boom'))
    await s.loadMcpServers()
    expect(s.error).toBe('boom')
  })
})
