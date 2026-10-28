import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS, type AppSettings, type SettingsPatch } from '../../../shared/types/settings'

/**
 * 应用设置 store：启动时 hydrate() 自主进程拉取；所有修改经 update()
 * 走 IPC 落盘并以主进程返回值为准（主进程做最终校验/钳制）。
 */
export const useSettingsStore = defineStore('settings', {
  state: (): AppSettings => structuredClone(DEFAULT_SETTINGS),

  actions: {
    /** 应用启动时拉取全量设置 */
    async hydrate(): Promise<void> {
      const s = await window.api.settings.getAll()
      this.general = s.general
      this.editor = s.editor
      this.java = s.java
      this.ai = s.ai
      this.network = s.network
      this.marketplace = s.marketplace
      this.integration = s.integration
      this.publish = s.publish
    },

    /**
     * 提交设置更新（可同时包含多个分段）；以主进程校验后的返回值校正本地状态。
     * patch 可能携带 Pinia 响应式代理（如 providers 数组元素），IPC 结构化克隆不支持，
     * 统一先深拷贝为纯对象（设置值均为 JSON 安全类型）。
     */
    async update(patch: SettingsPatch): Promise<AppSettings> {
      const plain = JSON.parse(JSON.stringify(patch)) as SettingsPatch
      const next = await window.api.settings.set(plain)
      this.general = next.general
      this.editor = next.editor
      this.java = next.java
      this.ai = next.ai
      this.network = next.network
      this.marketplace = next.marketplace
      this.integration = next.integration
      this.publish = next.publish
      return next
    },

    /**
     * 单分段部分更新：先乐观写入本地保证控件跟手，再以主进程返回值校正。
     */
    async patchSection<K extends keyof AppSettings>(
      section: K,
      patch: Partial<AppSettings[K]>
    ): Promise<void> {
      Object.assign(this[section], patch)
      const next = await this.update({ [section]: patch } as SettingsPatch)
      Object.assign(this, { [section]: next[section] })
    },

    /** 当前分类恢复默认 */
    async resetSection<K extends keyof AppSettings>(section: K): Promise<void> {
      await this.update({ [section]: DEFAULT_SETTINGS[section] } as SettingsPatch)
    }
  }
})
