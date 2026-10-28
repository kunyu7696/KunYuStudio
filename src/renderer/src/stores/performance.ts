/**
 * 模组性能画像 store：加载排行榜、打开画像详情、模组对比选择。
 * 排序 / 筛选复用纯视图逻辑 leaderboardView。
 */
import { defineStore } from 'pinia'
import type {
  LeaderboardEntry,
  ModPerformanceProfile,
  ProfileKey,
  ProfileSeverity,
  ScoreOrderKey
} from '../../../shared/schemas/performance/profile'
import { profileKeyText } from '../../../shared/schemas/performance/profile'
import {
  applyView,
  buildComparison,
  distinctValues,
  type LeaderboardFilter
} from '../modules/performance/leaderboardView'

export interface PerformanceState {
  entries: LeaderboardEntry[]
  loading: boolean
  error: string | null
  detail: ModPerformanceProfile | null
  detailLoading: boolean
  orderBy: ScoreOrderKey
  filter: LeaderboardFilter
  compareKeys: ProfileKey[]
}

export const usePerformanceStore = defineStore('performance', {
  state: (): PerformanceState => ({
    entries: [],
    loading: false,
    error: null,
    detail: null,
    detailLoading: false,
    orderBy: 'overall',
    filter: { loader: null, mcVersion: null, severity: null },
    compareKeys: []
  }),
  getters: {
    rows(state): LeaderboardEntry[] {
      return applyView(state.entries, state.filter, state.orderBy)
    },
    loaders(state): string[] {
      return distinctValues(state.entries, 'loader')
    },
    mcVersions(state): string[] {
      return distinctValues(state.entries, 'mcVersion')
    },
    comparison(state): LeaderboardEntry[] {
      return buildComparison(state.entries, state.compareKeys)
    },
    isComparing(state): (key: ProfileKey) => boolean {
      return (key: ProfileKey) =>
        state.compareKeys.some((k) => profileKeyText(k) === profileKeyText(key))
    }
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true
      this.error = null
      try {
        this.entries = await window.api.profile.leaderboard({
          orderBy: 'overall',
          limit: 500
        })
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.loading = false
      }
    },
    async openDetail(entry: LeaderboardEntry): Promise<void> {
      this.detailLoading = true
      try {
        const key: ProfileKey = {
          modId: entry.modId,
          version: entry.version,
          loader: entry.loader,
          mcVersion: entry.mcVersion
        }
        this.detail = await window.api.profile.get(key)
      } finally {
        this.detailLoading = false
      }
    },
    closeDetail(): void {
      this.detail = null
    },
    setOrderBy(orderBy: ScoreOrderKey): void {
      this.orderBy = orderBy
    },
    setFilter(patch: Partial<LeaderboardFilter>): void {
      this.filter = { ...this.filter, ...patch }
    },
    resetFilter(): void {
      this.filter = { loader: null, mcVersion: null, severity: null }
    },
    toggleCompare(key: ProfileKey): void {
      const text = profileKeyText(key)
      const exists = this.compareKeys.some((k) => profileKeyText(k) === text)
      if (exists) {
        this.compareKeys = this.compareKeys.filter(
          (k) => profileKeyText(k) !== text
        )
      } else if (this.compareKeys.length < 4) {
        this.compareKeys.push(key)
      }
    },
    clearComparison(): void {
      this.compareKeys = []
    },
    severityLabel(): Record<ProfileSeverity, string> {
      return { good: '良好', warn: '注意', bad: '较差' }
    }
  }
})
