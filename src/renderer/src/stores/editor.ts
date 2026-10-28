import { defineStore } from 'pinia'
import type { FileNode } from '../../../shared/types/fs'
import { useSettingsStore } from './settings'

/** 编辑器标签页状态 */
export interface EditorTab {
  /** 文件绝对路径，作为唯一标识（T2 对比标签为 `diff://<项目相对路径>` 前缀） */
  path: string
  /** 显示名称 */
  name: string
  /** 扩展名 */
  ext: string
  /** 文件内容（已加载）；对比标签为「当前磁盘内容」（右侧）；图片标签为空串 */
  content: string
  /** 是否已修改未保存 */
  dirty: boolean
  /** 最近一次保存的 mtime */
  mtime: number
  /** 语言 id（monaco language id） */
  language: string
  /** T2：对比标签的 run 前原文快照（左侧面板）；普通标签为 undefined */
  diff?: { original: string }
  /** 图片标签：data URL（存在即按图片预览渲染，不加载 Monaco，永不 dirty） */
  imageDataUrl?: string
}

/** 编辑器中的非空选区（供 AI 解释选区/上下文注入） */
export interface EditorSelection {
  path: string
  startLine: number
  endLine: number
  /** 选中的原文 */
  text: string
}

interface EditorState {
  tabs: EditorTab[]
  activePath: string | null
  /** 编辑位置导航历史（前进/后退），只记文件路径 */
  navHistory: string[]
  /** 当前位于 navHistory 的索引；-1 表示空历史 */
  navIndex: number
  /** 自动保存防抖定时器句柄 */
  _saveTimers: Record<string, ReturnType<typeof setTimeout>>
  /** 外部（问题列表/崩溃报告）请求跳转的行列，CodeEditor 挂载/激活后消费 */
  pendingReveal: { path: string; line: number; column: number } | null
  /** 最近一次非空选区（光标折叠或为空时清空） */
  activeSelection: EditorSelection | null
  /**
   * T2.5 伪流式：agent 写入的文件待做「按行渐进铺开」动画的标记（path → 请求时间戳）。
   * CodeEditor 挂载/内容更新时消费；超过 TTL 未消费视为过期丢弃（防残留标记误播）。
   */
  streamReveal: Record<string, number>
}

/** T2.5：流式揭示标记的有效期（毫秒）。file-written 防抖与 FS 事件竞态下，过期标记不再播动画 */
const STREAM_REVEAL_TTL_MS = 4000

/** 根据扩展名推断 Monaco 语言 id */
export function extToLanguage(ext: string): string {
  switch (ext) {
    case 'java':
      return 'java'
    case 'json':
      return 'json'
    case 'js':
      return 'javascript'
    case 'ts':
      return 'typescript'
    case 'css':
      return 'css'
    case 'html':
    case 'htm':
      return 'html'
    case 'xml':
      return 'xml'
    case 'md':
      return 'markdown'
    case 'gradle':
      return 'groovy'
    case 'properties':
      return 'ini'
    case 'txt':
    default:
      return 'plaintext'
  }
}

/** 支持图片预览的扩展名（与 fsService extToMime 对应） */
export const IMAGE_PREVIEW_EXTS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    tabs: [],
    activePath: null,
    navHistory: [],
    navIndex: -1,
    _saveTimers: {},
    pendingReveal: null,
    activeSelection: null,
    streamReveal: {}
  }),

  getters: {
    activeTab: (state): EditorTab | undefined =>
      state.tabs.find((t) => t.path === state.activePath),
    canGoBack: (state): boolean => state.navIndex > 0,
    canGoForward: (state): boolean =>
      state.navIndex >= 0 && state.navIndex < state.navHistory.length - 1
  },

  actions: {
    /** 打开文件：已打开则激活；未打开则读取内容并新建标签（图片走二进制预览） */
    async openFile(node: FileNode): Promise<void> {
      const existing = this.tabs.find((t) => t.path === node.path)
      if (existing) {
        this.setActive(node.path)
        return
      }
      // 图片：读二进制转 data URL，建只读预览标签（避免 utf-8 读出的乱码进 Monaco）
      if (IMAGE_PREVIEW_EXTS.includes(node.ext)) {
        const bin = await window.api.fs.readBinary(node.path)
        this.tabs.push({
          path: node.path,
          name: node.name,
          ext: node.ext,
          content: '',
          dirty: false,
          mtime: bin.mtime,
          language: 'plaintext',
          imageDataUrl: `data:${bin.mime};base64,${bin.dataBase64}`
        })
        this.setActive(node.path)
        return
      }
      const content = await window.api.fs.readFile(node.path)
      this.tabs.push({
        path: node.path,
        name: node.name,
        ext: node.ext,
        content: content.content,
        dirty: false,
        mtime: content.mtime,
        language: extToLanguage(node.ext)
      })
      this.setActive(node.path)
    },

    /** 按绝对路径打开文件（统一编辑器产物跳转用；自行从路径推导文件名/扩展名） */
    async openByPath(absPath: string): Promise<void> {
      const name = absPath.split(/[\\/]/).pop() ?? absPath
      const dot = name.lastIndexOf('.')
      const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
      await this.openFile({ path: absPath, name, kind: 'file', ext, size: 0, mtime: 0 })
    },

    /**
     * T2：打开「run 前原文快照 ↔ 当前磁盘」对比标签（只读 DiffEditor）。
     * 标签 path 用 `diff://<项目相对路径>` 区别于普通文件标签；
     * 再次打开同一文件的对比时刷新内容并激活。
     */
    async openDiff(opts: { relPath: string; absPath: string; original: string }): Promise<void> {
      const diffPath = `diff://${opts.relPath}`
      const name = opts.relPath.split('/').pop() ?? opts.relPath
      const dot = name.lastIndexOf('.')
      const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
      // 当前磁盘内容（create 已回滚/被外部删除时置空右侧）
      let modified = ''
      try {
        modified = (await window.api.fs.readFile(opts.absPath)).content
      } catch {
        /* 文件不存在：右侧空文档 */
      }
      const existing = this.tabs.find((t) => t.path === diffPath)
      if (existing) {
        existing.content = modified
        existing.diff = { original: opts.original }
        this.activePath = diffPath
        return
      }
      this.tabs.push({
        path: diffPath,
        name: `${name}（对比）`,
        ext,
        content: modified,
        dirty: false,
        mtime: 0,
        language: extToLanguage(ext),
        diff: { original: opts.original }
      })
      this.activePath = diffPath
    },

    /** 更新标签内容（用户编辑时调用，触发脏标记与自动保存） */
    updateContent(path: string, content: string): void {
      const tab = this.tabs.find((t) => t.path === path)
      if (!tab) return
      tab.content = content
      tab.dirty = true
      this.scheduleAutoSave(path)
    },

    /** 防抖自动保存（间隔取自设置；关闭自动保存后不调度） */
    scheduleAutoSave(path: string): void {
      const appSettings = useSettingsStore()
      if (!appSettings.general.autosaveEnabled) return
      if (this._saveTimers[path]) clearTimeout(this._saveTimers[path])
      this._saveTimers[path] = setTimeout(() => {
        delete this._saveTimers[path]
        // 排队期间关闭自动保存时，残留定时器不落盘
        if (!useSettingsStore().general.autosaveEnabled) return
        void this.save(path)
      }, appSettings.general.autosaveIntervalSec * 1000)
    },

    /** 立即保存指定文件（图片标签只读，直接跳过） */
    async save(path: string): Promise<void> {
      const tab = this.tabs.find((t) => t.path === path)
      if (!tab || tab.imageDataUrl !== undefined) return
      try {
        const mtime = await window.api.fs.writeFile(path, tab.content)
        tab.mtime = mtime
        tab.dirty = false
      } catch (err) {
        console.error('保存失败', err)
      }
    },

    /** 保存当前激活标签 */
    async saveActive(): Promise<void> {
      if (this.activePath) await this.save(this.activePath)
    },

    /** 保存全部脏标签（工作流「保存」按钮用）；返回保存的文件数 */
    async saveAll(): Promise<number> {
      const dirty = this.tabs.filter((t) => t.dirty)
      for (const t of dirty) await this.save(t.path)
      return dirty.length
    },

    /** 关闭标签，若有未保存修改先保存 */
    async closeTab(path: string): Promise<void> {
      const idx = this.tabs.findIndex((t) => t.path === path)
      if (idx < 0) return
      const tab = this.tabs[idx]
      if (tab.dirty) await this.save(path)
      if (this._saveTimers[path]) {
        clearTimeout(this._saveTimers[path])
        delete this._saveTimers[path]
      }
      this.tabs.splice(idx, 1)
      this.clearSelection(path)
      // 同步清理导航历史，避免后退到已关闭的标签
      const current = this.navHistory[this.navIndex]
      this.navHistory = this.navHistory.filter((p) => p !== path)
      if (current && current !== path && this.navHistory.includes(current)) {
        this.navIndex = this.navHistory.lastIndexOf(current)
      } else {
        this.navIndex = Math.min(this.navIndex, this.navHistory.length - 1)
      }
      if (this.activePath === path) {
        this.activePath = this.tabs.length > 0 ? this.tabs[Math.max(0, idx - 1)].path : null
      }
    },

    /** 切换激活标签 */
    setActive(path: string): void {
      if (this.activePath !== path) this.pushNav(path)
      this.activePath = path
    },

    /** 记录一个编辑位置；前进历史在分叉时丢弃，最多保留 50 条 */
    pushNav(path: string): void {
      if (this.navIndex >= 0 && this.navHistory[this.navIndex] === path) return
      this.navHistory = this.navHistory.slice(0, this.navIndex + 1)
      this.navHistory.push(path)
      if (this.navHistory.length > 50) this.navHistory.shift()
      this.navIndex = this.navHistory.length - 1
    },

    /** 后退到上一个编辑位置（不产生新的历史记录） */
    goBack(): void {
      if (!this.canGoBack) return
      this.navIndex -= 1
      this.activePath = this.navHistory[this.navIndex] ?? this.activePath
    },

    /** 前进到下一个编辑位置 */
    goForward(): void {
      if (!this.canGoForward) return
      this.navIndex += 1
      this.activePath = this.navHistory[this.navIndex] ?? this.activePath
    },

    /**
     * 切项目事务的一部分：关闭不属于新项目根的所有标签，
     * 脏标签经 closeTab 先落盘（旧项目文件仍在磁盘上，保存是安全的）
     */
    async closeTabsOutside(rootPath: string): Promise<void> {
      const norm = rootPath.replace(/\\/g, '/').replace(/\/+$/, '') + '/'
      const victims = this.tabs.filter((t) => !t.path.replace(/\\/g, '/').startsWith(norm))
      for (const v of [...victims]) await this.closeTab(v.path)
    },

    /** 更新当前非空选区（空文本/零长度选区一律清空，避免向 AI 注入无意义片段） */
    setSelection(sel: EditorSelection): void {
      if (!sel.text || sel.text.trim().length === 0 || sel.endLine < sel.startLine) {
        this.clearSelection(sel.path)
        return
      }
      this.activeSelection = { ...sel }
    },

    /** 清空选区；传入 path 时仅当选区属于该文件才清 */
    clearSelection(path?: string): void {
      if (!path || this.activeSelection?.path === path) this.activeSelection = null
    },

    /** 重新加载指定标签的磁盘内容（外部变更时；图片标签重读二进制） */
    async reloadTab(path: string): Promise<void> {
      const tab = this.tabs.find((t) => t.path === path)
      if (!tab) return
      if (tab.imageDataUrl !== undefined) {
        const bin = await window.api.fs.readBinary(path)
        tab.imageDataUrl = `data:${bin.mime};base64,${bin.dataBase64}`
        tab.mtime = bin.mtime
        tab.dirty = false
        return
      }
      const content = await window.api.fs.readFile(path)
      tab.content = content.content
      tab.mtime = content.mtime
      tab.dirty = false
    },

    /**
     * 从构建问题/崩溃报告跳转到指定文件行列：
     * stat → 打开标签 → 记录待跳转位置（CodeEditor 挂载/激活后消费）。
     * @returns 错误消息，成功为 null
     */
    async openAtLocation(path: string, line?: number, column?: number): Promise<string | null> {
      try {
        const node = await window.api.fs.stat(path)
        if (!node || node.kind !== 'file') return `文件不存在：${path}`
        await this.openFile(node)
        this.pendingReveal = { path: node.path, line: line ?? 1, column: column ?? 1 }
        return null
      } catch (err) {
        return (err as Error).message
      }
    },

    /** CodeEditor 消费跳转请求（仅匹配路径时生效） */
    consumePendingReveal(path: string): { line: number; column: number } | null {
      const pending = this.pendingReveal
      if (pending && pending.path === path) {
        this.pendingReveal = null
        return { line: pending.line, column: pending.column }
      }
      return null
    },

    /** T2.5：标记某文件下次在 Monaco 呈现时按行渐进铺开（agent file-written 专用） */
    requestStreamReveal(path: string): void {
      this.streamReveal[path] = Date.now()
    },

    /** T2.5：查看标记是否存在且未过期（不消费；createEditor 决定初始值用） */
    peekStreamReveal(path: string): boolean {
      const ts = this.streamReveal[path]
      return ts !== undefined && Date.now() - ts < STREAM_REVEAL_TTL_MS
    },

    /** T2.5：消费流式揭示标记；过期标记丢弃并返回 false */
    consumeStreamReveal(path: string): boolean {
      const ts = this.streamReveal[path]
      if (ts === undefined) return false
      delete this.streamReveal[path]
      return Date.now() - ts < STREAM_REVEAL_TTL_MS
    }
  }
})
