import { defineStore } from 'pinia'
import type { DataPackCategory, DataPackEntry } from '../../../shared/schemas/datapack.schema'

/**
 * 数据包编辑器树状态：SideBar 分类树与主编辑区共享。
 */
export const useDataPackStore = defineStore('datapack', {
  state: () => ({
    entries: [] as DataPackEntry[],
    active: null as DataPackEntry | null,
    createSignal: null as { category: DataPackCategory } | null,
    deleteSignal: null as { entry: DataPackEntry } | null
  }),
  actions: {
    setEntries(entries: DataPackEntry[]): void {
      this.entries = entries
    },
    select(entry: DataPackEntry | null): void {
      this.active = entry
    },
    requestCreate(category: DataPackCategory): void {
      this.createSignal = { category }
    },
    requestDelete(entry: DataPackEntry): void {
      this.deleteSignal = { entry }
    },
    clearSignals(): void {
      this.createSignal = null
      this.deleteSignal = null
    }
  }
})
