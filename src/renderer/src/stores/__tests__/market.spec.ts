/**
 * 模组市场 store 组件级测试（此前 21 个 store 仅 2 个有测试）。
 * 覆盖搜索/详情/安装/翻译分波与标签剥离/自动翻译持久化/社区桥接。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMarketStore } from '../market'
import type { MarketModSummary, MarketSearchResult } from '../../../../shared/types/market'

const searchMock = vi.fn()
const getDetailMock = vi.fn()
const installMock = vi.fn()
const toZhMock = vi.fn()

function stubApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    market: { search: searchMock, getDetail: getDetailMock, install: installMock },
    translate: { toZh: toZhMock }
  }
}

function item(id: string, name = `Mod ${id}`): MarketModSummary {
  return {
    id,
    slug: id,
    modId: id,
    platform: 'modrinth',
    projectType: 'mod',
    name,
    summary: `summary of ${id}`,
    downloads: 1,
    iconUrl: null,
    authors: [],
    author: null,
    loaders: [],
    gameVersions: [],
    updatedAt: '2026-10-12T00:00:00.000Z'
  } as unknown as MarketModSummary
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  stubApi()
  toZhMock.mockResolvedValue({ provider: 'cache', translations: [] })
})

describe('search', () => {
  it('成功路径：结果与翻译词条落库，默认分页参数注入', async () => {
    const res: MarketSearchResult = {
      items: [item('a'), item('b')],
      total: 2,
      hasMore: false,
      translatedTerms: [{ zh: '传送门', en: 'Portal', kind: 'term' }],
      untranslatedZh: []
    } as MarketSearchResult
    searchMock.mockResolvedValue(res)
    const s = useMarketStore()
    await s.search({ query: 'portal' })
    expect(s.items).toHaveLength(2)
    expect(s.total).toBe(2)
    expect(s.translatedTerms).toHaveLength(1)
    expect(s.loading).toBe(false)
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'modrinth', projectType: 'mod', page: 0, pageSize: 20 })
    )
  })

  it('失败路径：error 写入、items 清空', async () => {
    searchMock.mockRejectedValue(new Error('网络错误'))
    const s = useMarketStore()
    await s.search({ query: 'x' })
    expect(s.error).toBe('网络错误')
    expect(s.items).toHaveLength(0)
  })
})

describe('setProjectType', () => {
  it('同类型 no-op，换类型清空结果与详情', () => {
    const s = useMarketStore()
    s.items = [item('a')]
    s.total = 1
    s.setProjectType('mod')
    expect(s.items).toHaveLength(1)
    s.setProjectType('datapack')
    expect(s.projectType).toBe('datapack')
    expect(s.items).toHaveLength(0)
    expect(s.total).toBeNull()
    expect(s.activeDetail).toBeNull()
  })
})

describe('install', () => {
  it('installing 键进出、lastInstall 落地、默认携带当前平台/类型', async () => {
    installMock.mockResolvedValue({ ok: true, message: 'done' })
    const s = useMarketStore()
    const p = s.install({ modId: 'm1', versionId: 'v1', projectType: 'mod', projectPath: 'D:\\proj' })
    expect(s.installing.has('modrinth:m1:v1')).toBe(true)
    const r = await p
    expect(r.ok).toBe(true)
    expect(s.lastInstall).toEqual({ ok: true, message: 'done' })
    expect(s.installing.has('modrinth:m1:v1')).toBe(false)
    expect(installMock).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'modrinth', projectType: 'mod', modId: 'm1' })
    )
  })
})

describe('translateVisible', () => {
  it('分波翻译前 8 个卡片并剥离标签残片；已翻译卡片跳过', async () => {
    toZhMock.mockResolvedValue({
      provider: 'ai',
      translations: ['<b>盒子</b>', 'ok', '<span></span>', '', '岩浆', 'fine', 'TNT', 'x', '红石', 'y']
    })
    const s = useMarketStore()
    s.items = [item('1'), item('2'), item('3'), item('4'), item('5')]
    await s.translateVisible()
    // 5 张卡片 → 10 条文本一次请求
    expect(toZhMock).toHaveBeenCalledTimes(1)
    expect(toZhMock.mock.calls[0]?.[0]).toHaveLength(10)
    // <b>盒子</b> 剥成 盒子；纯标签 <g>★</g> 剥完为空 → null（无需翻译，不重复请求）
    expect(s.items[0]?.nameZh).toBe('盒子')
    expect(s.items[1]?.nameZh).toBeNull()
    expect(s.items[2]?.nameZh).toBe('岩浆')
  })

  it('autoTranslate 关闭时 no-op', async () => {
    const s = useMarketStore()
    s.autoTranslate = false
    s.items = [item('1')]
    await s.translateVisible()
    expect(toZhMock).not.toHaveBeenCalled()
  })
})

describe('setAutoTranslate', () => {
  it('持久化到 localStorage；开启时立即触发翻译', async () => {
    const s = useMarketStore()
    s.items = [item('1')]
    s.setAutoTranslate(false)
    expect(localStorage.getItem('kunyu.market.autoTranslate')).toBe('0')
    s.setAutoTranslate(true)
    expect(localStorage.getItem('kunyu.market.autoTranslate')).toBe('1')
    await vi.waitFor(() => expect(toZhMock).toHaveBeenCalled())
  })

  it('无持久化记录时默认开启', () => {
    const s = useMarketStore()
    expect(s.autoTranslate).toBe(true)
  })
})

describe('requestCommunitySearch', () => {
  it('携带查询词并递增 nonce 驱动 CommunityView watch', () => {
    const s = useMarketStore()
    const n0 = s.communityNonce
    s.requestCommunitySearch('匠魂')
    expect(s.communityQuery).toBe('匠魂')
    expect(s.communityNonce).toBe(n0 + 1)
  })
})
