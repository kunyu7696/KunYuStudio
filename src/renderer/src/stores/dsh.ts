/**
 * DSH 社区插件（兼容宿主）渲染层状态。
 */
import { defineStore } from 'pinia'
import type { DshCatalogState, DshOpResult, DshPetStatus } from '../../../shared/types/dsh'

interface DshStoreState {
  state: DshCatalogState | null
  loading: boolean
  /** 安装/卸载中的 npm 包名集合 */
  busy: Set<string>
  error: string
  /** dsh-pet 桌宠运行状态 */
  pet: DshPetStatus | null
  /** 桌宠启停操作进行中 */
  petBusy: boolean
}

export const useDshStore = defineStore('dsh', {
  state: (): DshStoreState => ({
    state: null,
    loading: false,
    busy: new Set<string>(),
    error: '',
    pet: null,
    petBusy: false
  }),
  actions: {
    async load(): Promise<void> {
      this.loading = true
      this.error = ''
      try {
        this.state = await window.api.dsh.getState()
      } catch (err) {
        this.error = (err as Error).message
      } finally {
        this.loading = false
      }
    },
    async petStart(): Promise<void> {
      this.petBusy = true
      try {
        this.pet = await window.api.dsh.petStart()
      } catch (err) {
        this.pet = { ...(this.pet ?? emptyPet()), error: (err as Error).message }
      } finally {
        this.petBusy = false
      }
    },
    async petStop(): Promise<void> {
      this.petBusy = true
      try {
        this.pet = await window.api.dsh.petStop()
      } catch (err) {
        this.pet = { ...(this.pet ?? emptyPet()), error: (err as Error).message }
      } finally {
        this.petBusy = false
      }
    },
    async petStatus(): Promise<void> {
      try {
        this.pet = await window.api.dsh.petStatus()
      } catch {
        /* 状态查询失败保持现值 */
      }
    },
    async install(npmName: string): Promise<DshOpResult> {
      this.busy.add(npmName)
      try {
        const res = await window.api.dsh.install(npmName, 'catalog')
        await this.load()
        return res
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      } finally {
        this.busy.delete(npmName)
      }
    },
    async installCustom(npmName: string): Promise<DshOpResult> {
      this.busy.add(npmName)
      try {
        const res = await window.api.dsh.install(npmName, 'custom')
        await this.load()
        return res
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      } finally {
        this.busy.delete(npmName)
      }
    },
    async remove(npmName: string): Promise<DshOpResult> {
      this.busy.add(npmName)
      try {
        const res = await window.api.dsh.remove(npmName)
        await this.load()
        return res
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      } finally {
        this.busy.delete(npmName)
      }
    },
    async reload(): Promise<void> {
      this.loading = true
      try {
        await window.api.dsh.reload()
        await this.load()
      } finally {
        this.loading = false
      }
    },
    /** 授权 / 撤销插件在主进程内运行（授权绑定包内容指纹，变更后自动失效） */
    async setTrust(npmName: string, approve: boolean): Promise<DshOpResult> {
      this.busy.add(npmName)
      try {
        const res = await window.api.dsh.setTrust(npmName, approve)
        await this.load()
        return res
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      } finally {
        this.busy.delete(npmName)
      }
    }
  }
})

/** 桌宠状态兜底空值（IPC 异常时保持可渲染形状） */
function emptyPet(): DshPetStatus {
  return {
    running: false,
    port: null,
    petInstalled: false,
    petVersion: null,
    electronFound: false,
    sourceAvailable: false
  }
}
