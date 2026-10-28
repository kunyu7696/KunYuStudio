import { defineStore } from 'pinia'
import type { FileNode } from '../../../shared/types/fs'

interface ExplorerState {
  /** 当前项目根路径 */
  rootPath: string | null
  /** 根节点 */
  rootNode: FileNode | null
  /** 已展开的目录路径集合 */
  expandedPaths: Set<string>
  /** 选中的节点路径 */
  selectedPath: string | null
  loading: boolean
}

/** 递归在树中查找节点 */
function findNode(root: FileNode | null, path: string): FileNode | undefined {
  if (!root) return undefined
  if (root.path === path) return root
  if (root.children) {
    for (const child of root.children) {
      const found = findNode(child, path)
      if (found) return found
    }
  }
  return undefined
}

export const useExplorerStore = defineStore('explorer', {
  state: (): ExplorerState => ({
    rootPath: null,
    rootNode: null,
    expandedPaths: new Set<string>(),
    selectedPath: null,
    loading: false
  }),

  actions: {
    /** 设置项目根并加载根目录的子节点 */
    async setRoot(rootPath: string): Promise<void> {
      this.rootPath = rootPath
      this.expandedPaths = new Set<string>()
      this.selectedPath = null
      this.loading = true
      try {
        const children = await window.api.fs.readDir(rootPath)
        const rootStat = await window.api.fs.stat(rootPath)
        this.rootNode = rootStat ? { ...rootStat, children } : null
        // 根目录默认展开（子节点已在上面 readDir 加载好）
        this.expandedPaths.add(rootPath)
      } finally {
        this.loading = false
      }
    },

    /** 展开目录：懒加载子节点 */
    async expand(path: string): Promise<void> {
      this.expandedPaths.add(path)
      const node = findNode(this.rootNode, path)
      if (node && node.kind === 'directory' && !node.children) {
        try {
          node.children = await window.api.fs.readDir(path)
        } catch (err) {
          console.error('展开目录失败', err)
        }
      }
    },

    collapse(path: string): void {
      this.expandedPaths.delete(path)
    },

    toggle(path: string, kind: 'directory' | 'file'): void {
      if (kind !== 'directory') return
      if (this.expandedPaths.has(path)) {
        this.collapse(path)
      } else {
        void this.expand(path)
      }
    },

    select(path: string): void {
      this.selectedPath = path
    },

    /** 局部刷新某个目录的子节点 */
    async refreshDir(path: string): Promise<void> {
      const node = findNode(this.rootNode, path)
      if (node && node.kind === 'directory') {
        node.children = await window.api.fs.readDir(path)
      }
    },

    /**
     * 整棵树刷新（保留已展开的目录状态）。
     * 早期实现直接 setRoot 会把 expandedPaths 清空——agent 每次写盘刷新都会把文件树折叠回根，
     * 表现为「AI 改代码时左侧文件树不展开」。
     */
    async refreshAll(): Promise<void> {
      if (!this.rootPath) return
      const keep = new Set(this.expandedPaths)
      const root = this.rootPath
      await this.setRoot(root)
      for (const p of keep) {
        if (p === root || !findNode(this.rootNode, p)) continue
        await this.expand(p)
      }
    },

    /**
     * 展开到指定文件并选中（agent 写盘后自动揭示该文件）。
     * 逐段用树中真实 node.path 拼接，避免语义层 '/' 与 Windows '\' 混用导致匹配失败。
     */
    async revealFile(relPath: string): Promise<void> {
      if (!this.rootPath || !this.rootNode) return
      const segs = relPath.replace(/\\/g, '/').split('/').filter(Boolean)
      let cur: FileNode = this.rootNode
      for (const seg of segs) {
        if (cur.kind !== 'directory') return
        if (!cur.children) {
          try {
            cur.children = await window.api.fs.readDir(cur.path)
          } catch {
            return
          }
        }
        this.expandedPaths.add(cur.path)
        const next = cur.children?.find((c) => c.name === seg)
        if (!next) return
        cur = next
      }
      this.selectedPath = cur.path
    }
  }
})
