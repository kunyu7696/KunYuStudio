import { defineStore } from 'pinia'
import type { CreateProjectInput, Project } from '../../../shared/types/project'
import { useExplorerStore } from './explorer'
import { useEditorStore } from './editor'
import { useUiStore } from './ui'

/** 最近成功打开的项目 id（供"启动恢复"使用；M6 设置项） */
const LAST_PROJECT_KEY = 'kunyu:last-project-id'

export function readLastProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_KEY)
}

export const useProjectStore = defineStore('project', {
  state: () => ({
    projects: [] as Project[],
    currentProjectId: null as string | null,
    loading: false
  }),

  getters: {
    currentProject: (state): Project | undefined =>
      state.projects.find((p) => p.id === state.currentProjectId)
  },

  actions: {
    async refresh(): Promise<void> {
      this.loading = true
      try {
        this.projects = await window.api.project.list()
      } finally {
        this.loading = false
      }
    },

    async create(input: CreateProjectInput): Promise<Project> {
      const project = await window.api.project.create(input)
      this.projects.unshift(project)
      return project
    },

    /**
     * 打开项目（事务化）：
     * 主进程在同一调用里完成路径校验 + watcher 切换 + MCP 重连；
     * 渲染层随后统一切换 文件树根 + 关闭越界标签 + 模块跳转，
     * 调用方（侧栏列表 / 启动恢复 / 向导 / VCS）不再需要各自补 setRoot。
     */
    async open(id: string): Promise<Project | undefined> {
      const project = await window.api.project.open(id)
      if (project) {
        this.currentProjectId = id
        localStorage.setItem(LAST_PROJECT_KEY, id)
        // 更新列表中的 lastOpenedAt 并重排；新建后首次打开时列表尚无该项，补入
        const idx = this.projects.findIndex((p) => p.id === id)
        if (idx >= 0) this.projects.splice(idx, 1)
        this.projects.unshift({ ...project, pathExists: true })
        // 文件树与编辑器标签跟随新项目（顺序：先关旧标签，再切根）
        await useEditorStore().closeTabsOutside(project.path)
        await useExplorerStore().setRoot(project.path)
        // 独立包项目默认进入对应编辑器（模块 id 与项目类型同名）
        if (
          project.type === 'resourcepack' ||
          project.type === 'datapack' ||
          project.type === 'shaderpack' ||
          project.type === 'modpack'
        ) {
          useUiStore().setActiveModule(project.type)
        }
      }
      return project
    },

    /**
     * 重新定位：目录被移动/改名后把记录指向新路径。
     * 新路径由主进程弹 OS 对话框选取（拒绝系统目录），不信任渲染层传入的 path。
     * 用户在对话框取消返回 undefined，调用方据此静默退出。
     */
    async relocate(id: string): Promise<Project | undefined> {
      const project = await window.api.project.relocate(id)
      if (!project) return undefined
      const idx = this.projects.findIndex((p) => p.id === id)
      if (idx >= 0) this.projects[idx] = { ...project, pathExists: true }
      return project
    },

    async delete(id: string, deleteFiles: boolean): Promise<boolean> {
      const ok = await window.api.project.delete(id, deleteFiles)
      if (ok) {
        this.projects = this.projects.filter((p) => p.id !== id)
        if (this.currentProjectId === id) this.currentProjectId = null
      }
      return ok
    },

    async importProject(path: string): Promise<Project> {
      const project = await window.api.project.import(path)
      const exists = this.projects.some((p) => p.id === project.id)
      if (!exists) this.projects.unshift(project)
      return project
    },

    /** 返回按钮：关闭当前项目，清文件树根，回卡片列表 */
    closeCurrent(): void {
      this.currentProjectId = null
      localStorage.removeItem(LAST_PROJECT_KEY)
      const explorer = useExplorerStore()
      explorer.rootPath = null
      explorer.rootNode = null
      explorer.expandedPaths = new Set<string>()
      explorer.selectedPath = null
    }
  }
})
