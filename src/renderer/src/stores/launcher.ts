import { defineStore } from 'pinia'
import type {
  AddLauncherInput,
  AutoIntegrateCandidate,
  AutoIntegrateInput,
  AutoIntegrateResult,
  DetectResult,
  ImportInput,
  ImportRecord,
  ImportResult,
  LauncherInfo,
  LauncherInstance,
  LauncherPersistedState
} from '../../../shared/types/launcher'

/**
 * M11 启动器集成状态。
 * launchers/instances 来自主进程 detect/listInstances；records 与激活实例在
 * detect 后由 getState 从主进程恢复，重启应用不丢。autoIntegrate 一次完成
 * 「扫描 → 选实例 → 持久化」。
 * 事件订阅走通用 api.on(LAUNCHER_EVENT)，UI 自行决定是否监听进度。
 */
export const useLauncherStore = defineStore('launcher', {
  state: () => ({
    /** 检测到的启动器（含手动添加） */
    launchers: [] as LauncherInfo[],
    /** 当前选中启动器的实例列表 */
    instances: [] as LauncherInstance[],
    /** 当前选中的启动器 ID */
    selectedLauncherId: '' as string,
    /** 当前激活实例 ID（用于版本切换 / 启动） */
    activeInstanceId: null as string | null,
    /** 导入记录（从主进程恢复 + 本次会话累积） */
    records: [] as ImportRecord[],
    /** 最近一次自动集成的候选（按匹配度降序） */
    candidates: [] as AutoIntegrateCandidate[],
    /** 最近一次自动集成的命中理由 */
    integrateReason: '' as string,
    detecting: false,
    integrating: false,
    importing: false,
    launching: false,
    /** 最近一次错误信息（null 表示无错误） */
    error: null as string | null
  }),

  getters: {
    /** 当前选中启动器对象 */
    selectedLauncher(state): LauncherInfo | undefined {
      return state.launchers.find((l) => l.id === state.selectedLauncherId)
    },
    /** 当前激活实例对象 */
    activeInstance(state): LauncherInstance | undefined {
      return state.instances.find((i) => i.id === state.activeInstanceId) ?? undefined
    }
  },

  actions: {
    /** 扫描本机启动器；成功后优先恢复上次的激活实例，否则默认选中第一个 */
    async detect(): Promise<void> {
      this.detecting = true
      this.error = null
      try {
        const result: DetectResult = await window.api.launcher.detect()
        this.launchers = result.launchers
        if (result.errors.length) {
          this.error = result.errors.join('; ')
        }
        // 恢复持久化状态：导入记录与上次激活的启动器/实例
        let persisted: LauncherPersistedState | null = null
        try {
          persisted = await window.api.launcher.getState()
        } catch {
          // 状态文件缺失或不可读：按首次使用处理
        }
        if (persisted) this.records = persisted.records

        const persistedLauncherId =
          persisted?.activeLauncherId &&
          this.launchers.some((l) => l.id === persisted?.activeLauncherId)
            ? persisted.activeLauncherId
            : ''
        const stillExists = this.launchers.some((l) => l.id === this.selectedLauncherId)
        if (persistedLauncherId) {
          this.selectedLauncherId = persistedLauncherId
          this.activeInstanceId = persisted?.activeInstanceId ?? null
          await this.listInstances()
        } else if (!stillExists && this.launchers.length) {
          this.selectedLauncherId = this.launchers[0].id
          await this.listInstances()
        } else if (!stillExists) {
          this.instances = []
          this.selectedLauncherId = ''
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.detecting = false
      }
    },

    /**
     * 自动扫描并集成：检测本机启动器 → 挑选与目标版本/加载器最匹配的实例 →
     * 持久化为激活实例。指定 projectId 时同时记录项目映射，便于重启后恢复。
     */
    async autoIntegrate(input: AutoIntegrateInput = {}): Promise<AutoIntegrateResult | null> {
      this.integrating = true
      this.error = null
      try {
        const result = await window.api.launcher.autoIntegrate(input)
        this.candidates = result.candidates
        if (!result.ok) {
          this.error = result.error ?? '自动集成失败'
          return result
        }
        this.integrateReason = result.reason ?? ''
        // 同步刷新界面状态：选中命中的启动器并加载实例
        if (result.launcher) {
          this.selectedLauncherId = result.launcher.id
          await this.listInstances()
        }
        this.activeInstanceId = result.activeInstanceId ?? null
        return result
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
        return null
      } finally {
        this.integrating = false
      }
    },

    /** 刷新当前选中启动器的实例列表 */
    async listInstances(): Promise<void> {
      if (!this.selectedLauncherId) {
        this.instances = []
        return
      }
      this.error = null
      try {
        this.instances = await window.api.launcher.listInstances(this.selectedLauncherId)
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
        this.instances = []
      }
    },

    /** 切换选中启动器并加载实例 */
    async selectLauncher(id: string): Promise<void> {
      if (id === this.selectedLauncherId) return
      this.selectedLauncherId = id
      this.activeInstanceId = null
      await this.listInstances()
    },

    /** 设置激活实例（持久化到主进程） */
    async setActive(instanceId: string): Promise<void> {
      this.activeInstanceId = instanceId
      try {
        await window.api.launcher.setActive(instanceId)
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      }
    },

    /** 一键导入构建产物到指定实例的 mods 目录 */
    async import(artifactPath: string, instanceId: string, overwrite = false): Promise<ImportResult | null> {
      if (!this.selectedLauncherId) {
        this.error = '请先选择启动器'
        return null
      }
      this.importing = true
      this.error = null
      const input: ImportInput = {
        launcherId: this.selectedLauncherId,
        instanceId,
        artifactPath,
        overwrite
      }
      try {
        const result = await window.api.launcher.import(input)
        if (result.ok && result.record) {
          this.records.push(result.record)
        } else if (result.error) {
          this.error = result.error
        }
        return result
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
        return null
      } finally {
        this.importing = false
      }
    },

    /** 启动激活实例对应的启动器 */
    async launch(): Promise<void> {
      if (!this.activeInstanceId) {
        this.error = '请先选择要启动的实例'
        return
      }
      this.launching = true
      this.error = null
      try {
        const ok = await window.api.launcher.launch(this.activeInstanceId)
        if (!ok) {
          this.error = '启动失败：实例未找到或启动器缺失'
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.launching = false
      }
    },

    /** 手动添加启动器 */
    async add(input: AddLauncherInput): Promise<void> {
      this.error = null
      try {
        const launcher = await window.api.launcher.add(input)
        this.launchers.push(launcher)
        if (!this.selectedLauncherId) {
          this.selectedLauncherId = launcher.id
          await this.listInstances()
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      }
    }
  }
})
