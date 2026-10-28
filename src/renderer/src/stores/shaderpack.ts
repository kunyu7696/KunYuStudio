import { defineStore } from 'pinia'
import type { ShaderFileCategory, ShaderPackFile } from '../../../shared/schemas/shaderpack.schema'

/**
 * 光影包编辑器树状态：SideBar 分类树与主编辑区共享。
 */
export const useShaderPackStore = defineStore('shaderpack', {
  state: () => ({
    files: [] as ShaderPackFile[],
    active: null as ShaderPackFile | null,
    createSignal: null as { category: ShaderFileCategory } | null,
    deleteSignal: null as { file: ShaderPackFile } | null
  }),
  actions: {
    setFiles(files: ShaderPackFile[]): void {
      this.files = files
    },
    select(file: ShaderPackFile | null): void {
      this.active = file
    },
    requestCreate(category: ShaderFileCategory): void {
      this.createSignal = { category }
    },
    requestDelete(file: ShaderPackFile): void {
      this.deleteSignal = { file }
    },
    clearSignals(): void {
      this.createSignal = null
      this.deleteSignal = null
    }
  }
})
