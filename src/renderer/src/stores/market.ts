import { defineStore } from 'pinia'
import type {
  MarketInstallInput,
  MarketInstallResult,
  MarketModDetail,
  MarketModSummary,
  MarketProjectType,
  MarketSearchQuery,
  MarketSearchResult,
  ModPlatform,
  TranslatedTerm
} from '../../../shared/types/market'

/** 自动翻译开关持久化 key（渲染层 UI 偏好，不进 settings.json） */
const AUTO_TRANSLATE_KEY = 'kunyu.market.autoTranslate'

function loadAutoTranslate(): boolean {
  try {
    const v = localStorage.getItem(AUTO_TRANSLATE_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

/**
 * 翻译结果偶发夹带平台侧 HTML/SVG 残片（如 <g id="1070">★</g>），展示前剥掉标签。
 * null 透传（表示无需翻译/失败），空串归一为 null。
 */
function stripMarkup(s: string | null): string | null {
  if (s == null) return s
  const clean = s.replace(/<[^>]*>/g, '').trim()
  return clean || null
}

/**
 * M9 模组市场状态：搜索结果缓存、详情缓存、加载/错误状态。
 * M16：五类内容（mod/datapack/resourcepack/shader/modpack）+ en→zh 自动中文翻译。
 * 渲染层 MarketView 与 CommunityView 共用此 store。
 */
export const useMarketStore = defineStore('market', {
  state: () => ({
    platform: 'modrinth' as ModPlatform,
    /** 当前内容类型（默认模组） */
    projectType: 'mod' as MarketProjectType,
    query: '' as string,
    items: [] as MarketModSummary[],
    total: null as number | null,
    hasMore: false,
    loading: false,
    error: '' as string,
    /** M12 中文搜索：本次查询命中的中→英词条（空表示未发生翻译） */
    translatedTerms: [] as TranslatedTerm[],
    /** M12 中文搜索：词典未收录、原样检索的中文片段（召回可能有限） */
    untranslatedZh: [] as string[],
    /** 详情抽屉当前选中的模组 */
    activeDetail: null as MarketModDetail | null,
    detailLoading: false,
    /** 安装中（按 modId:versionId 标记） */
    installing: new Set<string>(),
    /** 最近一次安装结果（toast 用） */
    lastInstall: null as MarketInstallResult | null,
    /** 社区桥接：模组市场「去 MC百科中文搜索」携带的查询词 */
    communityQuery: '' as string,
    /** 社区桥接：搜索请求序号（每次请求 +1，CommunityView watch 此值触发应用内搜索） */
    communityNonce: 0,
    /** M16 自动中文翻译开关（默认开；失败回退原文不阻断） */
    autoTranslate: loadAutoTranslate(),
    /** 翻译进行中（toolbar 指示用） */
    translating: false,
    /** 最近一次翻译来源（ai/free/cache/none），UI 提示用 */
    translateProvider: '' as string
  }),

  actions: {
    async search(q: Partial<MarketSearchQuery> & { platform?: ModPlatform }): Promise<void> {
      this.platform = q.platform ?? this.platform
      this.projectType = q.projectType ?? this.projectType
      this.query = q.query ?? this.query
      this.loading = true
      this.error = ''
      this.translatedTerms = []
      this.untranslatedZh = []
      try {
        const res: MarketSearchResult = await window.api.market.search({
          platform: this.platform,
          query: this.query,
          projectType: this.projectType,
          gameVersion: q.gameVersion,
          loader: q.loader,
          category: q.category,
          page: q.page ?? 0,
          pageSize: q.pageSize ?? 20,
          sort: q.sort
        })
        this.items = res.items
        this.total = res.total
        this.hasMore = res.hasMore
        this.translatedTerms = res.translatedTerms ?? []
        this.untranslatedZh = res.untranslatedZh ?? []
        void this.translateVisible()
      } catch (err) {
        this.error = (err as Error).message
        this.items = []
      } finally {
        this.loading = false
      }
    },

    /** 切换内容类型（清空旧结果与翻译状态，由调用方触发重新搜索） */
    setProjectType(t: MarketProjectType): void {
      if (this.projectType === t) return
      this.projectType = t
      this.items = []
      this.total = null
      this.activeDetail = null
    },

    async loadDetail(modId: string): Promise<void> {
      this.detailLoading = true
      this.activeDetail = null
      try {
        this.activeDetail = await window.api.market.getDetail(this.platform, modId, this.projectType)
        void this.translateDetail()
      } catch (err) {
        this.error = (err as Error).message
      } finally {
        this.detailLoading = false
      }
    },

    async install(input: Omit<MarketInstallInput, 'platform'> & { platform?: ModPlatform }): Promise<MarketInstallResult> {
      const platform = input.platform ?? this.platform
      const projectType = input.projectType ?? this.projectType
      const key = `${platform}:${input.modId}:${input.versionId}`
      this.installing.add(key)
      this.lastInstall = null
      try {
        const result = await window.api.market.install({ ...input, platform, projectType })
        this.lastInstall = result
        return result
      } finally {
        this.installing.delete(key)
      }
    },

    clearDetail(): void {
      this.activeDetail = null
    },

    setAutoTranslate(v: boolean): void {
      this.autoTranslate = v
      try {
        localStorage.setItem(AUTO_TRANSLATE_KEY, v ? '1' : '0')
      } catch { /* 隐私模式等场景忽略 */ }
      if (v) void this.translateVisible()
    },

    /**
     * 翻译当前结果卡片的名称/简介（en→zh）。
     * 分波渐进：先翻前 8 个卡片（首屏立刻可见），再翻剩余；
     * 每波内部由主进程去重/缓存/切块并发。失败静默回退原文。
     */
    async translateVisible(): Promise<void> {
      if (!this.autoTranslate || this.translating) return
      // undefined = 尚未尝试；null = 已尝试（无需翻译/失败），不重复请求
      const targets = this.items.filter((it) => it.nameZh === undefined || it.summaryZh === undefined)
      if (targets.length === 0) return
      this.translating = true
      try {
        const FIRST_WAVE = 8
        for (let from = 0; from < targets.length; from += FIRST_WAVE) {
          const wave = targets.slice(from, from + FIRST_WAVE)
          const texts: string[] = []
          for (const it of wave) {
            texts.push(it.name, it.summary)
          }
          const res = await window.api.translate.toZh(texts)
          this.translateProvider = res.provider
          let i = 0
          for (const it of wave) {
            const nameZh = res.translations[i++]
            const summaryZh = res.translations[i++]
            // null = 无需翻译/翻译失败，写入 null 防止重复请求；剥掉夹带的标签残片
            it.nameZh = stripMarkup(nameZh)
            it.summaryZh = stripMarkup(summaryZh)
          }
        }
      } catch {
        /* 翻译失败不阻断浏览，保留原文；未翻译卡片下次仍会重试 */
      } finally {
        this.translating = false
      }
    },

    /** 翻译详情抽屉的名称/简介 */
    async translateDetail(): Promise<void> {
      const d = this.activeDetail
      if (!this.autoTranslate || !d) return
      if (d.nameZh !== undefined && d.summaryZh !== undefined) return
      try {
        const res = await window.api.translate.toZh([d.name, d.summary])
        this.translateProvider = res.provider
        d.nameZh = stripMarkup(res.translations[0])
        d.summaryZh = stripMarkup(res.translations[1])
      } catch { /* 回退原文 */ }
    },

    /** 模组市场请求在社区桥接内做 MC百科中文搜索（应用内导航，不跳系统浏览器） */
    requestCommunitySearch(key: string): void {
      this.communityQuery = key
      this.communityNonce += 1
    }
  }
})
