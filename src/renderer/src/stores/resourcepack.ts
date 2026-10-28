import { defineStore } from 'pinia'
import type { PackLayoutMode } from '../../../shared/types/ipc'
import type { ResourceFileCategory, ResourcePackFile } from '../../../shared/schemas/resourcepack.schema'

/**
 * 资源包编辑器树状态：SideBar 中的分类树与主编辑区共享。
 * files 由视图加载后写入；active / createSignal / deleteSignal / importSignal 由树触发、视图消费。
 * root/mode 由视图在初始化后写入（树自身拿不到项目上下文）；
 * thumbs 为贴图缩略图 data URL 缓存（key=relPath），由树内 TreeThumb 懒加载填充。
 */
export const useResourcePackStore = defineStore('resourcepack', {
  state: () => ({
    files: [] as ResourcePackFile[],
    active: null as ResourcePackFile | null,
    createSignal: null as { category: ResourceFileCategory } | null,
    deleteSignal: null as { file: ResourcePackFile } | null,
    importSignal: null as { category: ResourceFileCategory } | null,
    root: '' as string,
    mode: 'embedded' as PackLayoutMode,
    thumbs: {} as Record<string, string>
  }),
  actions: {
    setFiles(files: ResourcePackFile[]): void {
      this.files = files
    },
    select(file: ResourcePackFile | null): void {
      this.active = file
    },
    requestCreate(category: ResourceFileCategory): void {
      this.createSignal = { category }
    },
    requestDelete(file: ResourcePackFile): void {
      this.deleteSignal = { file }
    },
    requestImport(category: ResourceFileCategory): void {
      this.importSignal = { category }
    },
    clearSignals(): void {
      this.createSignal = null
      this.deleteSignal = null
      this.importSignal = null
    },
    /** 视图初始化后写入项目上下文（供树内缩略图懒加载走 IPC） */
    setContext(root: string, mode: PackLayoutMode): void {
      this.root = root
      this.mode = mode
      this.thumbs = {}
    },
    /** 懒加载贴图缩略图（幂等：已缓存或加载中不重复请求） */
    async ensureThumb(relPath: string): Promise<void> {
      if (!this.root || this.thumbs[relPath] !== undefined) return
      // 占位防重入（失败也落空串，避免每次渲染都重试）
      this.thumbs[relPath] = ''
      try {
        this.thumbs[relPath] = await window.api.resourcepack.readTexture(this.root, relPath, this.mode)
      } catch {
        this.thumbs[relPath] = ''
      }
    }
  }
})
