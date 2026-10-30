/**
 * 整合包组装 store：干跑预览（组装计划 / 排除项 / 告警）+ 真实组装 + 来源记录。
 * 组装元数据一律由主进程从项目记录读取，这里只传项目路径。
 */
import { defineStore } from 'pinia'
import type {
  CrossLinkReport,
  LaunchTestInput,
  LaunchTestResult,
  ModJarPlan,
  ModSourceEntry,
  ModpackAssembleResult,
  ModpackExclusion,
  ModpackPlan
} from '../../../shared/types/modpack'
import type { ContentPackSummary, CreatePackInput } from '../../../shared/types/contentPack'

export interface ModpackState {
  plan: ModpackPlan | null
  sources: ModSourceEntry[]
  /** 内容包概要（modpack:list-packs 扫描，与 plan.packs 独立：含坏包） */
  packs: ContentPackSummary[]
  /** 预览失败原因（如缺 MC 版本、run/mods 为空），直接展示 */
  error: string | null
  loading: boolean
  assembling: boolean
  /** 最近一次组装产物 */
  lastZipPath: string | null
  /** CurseForge 版产物路径（P1-4 分平台出包） */
  lastCfZipPath: string | null
  lastEntryCount: number | null
  /** 启动测试：进行中与最近一次回执 */
  testing: boolean
  launchResult: LaunchTestResult | null
  /** 跨平台联动报告（P3-3；手动触发，逐模组联网，不随预览自动刷新） */
  crossLink: CrossLinkReport | null
  crossLinkLoading: boolean
}

export const useModpackStore = defineStore('modpack', {
  state: (): ModpackState => ({
    plan: null,
    sources: [],
    packs: [],
    error: null,
    loading: false,
    assembling: false,
    lastZipPath: null,
    lastCfZipPath: null,
    lastEntryCount: null,
    testing: false,
    launchResult: null,
    crossLink: null,
    crossLinkLoading: false
  }),

  getters: {
    jars(state): ModJarPlan[] {
      return state.plan ? state.plan.jars : []
    },
    exclusions(state): ModpackExclusion[] {
      return state.plan ? state.plan.exclusions : []
    },
    warnings(state): string[] {
      return state.plan ? state.plan.warnings : []
    },
    /** 进双平台清单的模组总数（不含只随包的） */
    manifestCount(state): number {
      if (!state.plan) return 0
      return state.plan.curseforgeFiles.length + state.plan.modrinthFiles.length
    },
    bundledCount(state): number {
      return state.plan ? state.plan.jars.filter((j) => j.bundledInOverrides).length : 0
    },
    /** 启用中的内容包数 */
    enabledPackCount(state): number {
      return state.packs.filter((p) => p.enabled && p.valid).length
    },
    /** 是否有可组装内容 */
    ready(state): boolean {
      return state.plan !== null && state.plan.jars.length > 0
    }
  },

  actions: {
    /** 重新扫描并干跑预览（不落盘）；跨平台报告按项目维度作废弃置，需手动重新比对 */
    async refresh(projectPath: string): Promise<void> {
      this.loading = true
      this.crossLink = null
      try {
        const [preview, sources, packs] = await Promise.all([
          window.api.modpack.preview(projectPath),
          window.api.modpack.listSources(projectPath),
          window.api.modpack.listPacks(projectPath)
        ])
        this.sources = sources
        this.packs = packs
        if (preview.ok && preview.plan) {
          this.plan = preview.plan
          this.error = null
        } else {
          this.plan = null
          this.error = preview.error ?? '组装计划生成失败'
        }
      } catch (err) {
        this.plan = null
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.loading = false
      }
    },

    /** 真实组装：成功记录产物路径并刷新计划（告警可能变化） */
    async assemble(projectPath: string): Promise<ModpackAssembleResult> {
      this.assembling = true
      try {
        const result = await window.api.modpack.assemble(projectPath)
        if (result.ok && result.zipPath) {
          this.lastZipPath = result.zipPath
          this.lastCfZipPath = result.cfZipPath ?? null
          this.lastEntryCount = result.entryCount ?? null
          if (result.plan) this.plan = result.plan
        }
        return result
      } finally {
        this.assembling = false
      }
    },

    reset(): void {
      this.plan = null
      this.sources = []
      this.packs = []
      this.error = null
      this.lastZipPath = null
      this.lastCfZipPath = null
      this.lastEntryCount = null
      this.launchResult = null
      this.crossLink = null
    },

    /** P3-3 跨平台联动：手动触发（逐模组联网，模组多时需要数十秒） */
    async refreshCrossLink(projectPath: string): Promise<void> {
      this.crossLinkLoading = true
      try {
        this.crossLink = await window.api.modpack.crossLink(projectPath)
      } catch (err) {
        this.crossLink = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          generatedAt: '',
          items: [],
          duplicates: [],
          missingDeps: [],
          matchedCount: 0,
          updateCount: 0,
          cfUnavailable: false
        }
      } finally {
        this.crossLinkLoading = false
      }
    },

    /** 切换内容包启用状态（主进程改写 pack.json），成功后刷新概要 */
    async togglePack(projectPath: string, packId: string, enabled: boolean): Promise<string | null> {
      const r = await window.api.modpack.setPackEnabled(projectPath, packId, enabled)
      if (r.ok) this.packs = await window.api.modpack.listPacks(projectPath)
      return r.ok ? null : (r.error ?? '切换失败')
    },

    /** 新建内容包骨架，成功后刷新概要 */
    async createPack(projectPath: string, input: CreatePackInput): Promise<string | null> {
      const r = await window.api.modpack.createPack(projectPath, input)
      if (r.ok) this.packs = await window.api.modpack.listPacks(projectPath)
      return r.ok ? null : (r.error ?? '新建失败')
    },

    /**
     * 启动测试：装入实例 → 目录断言 → 启动 → 日志增量判定。
     * 版本与加载器由主进程从项目记录补齐，这里只传定位实例所需字段。
     */
    async launchTest(input: LaunchTestInput): Promise<LaunchTestResult> {
      this.testing = true
      this.launchResult = null
      try {
        const result = await window.api.modpack.launchTest(input)
        this.launchResult = result
        return result
      } finally {
        this.testing = false
      }
    }
  }
})