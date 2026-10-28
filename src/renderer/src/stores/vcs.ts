import { defineStore } from 'pinia'
import type {
  BuildArtifact,
  GitBranchInfo,
  GitChangedFile,
  GitCommitDetail,
  GitLogEntry,
  GitRemoteInfo,
  GitStatusSummary,
  GitTagInfo,
  VcsRepoOpResult
} from '../../../shared/types/vcs'

export const useVcsStore = defineStore('vcs', {
  state: () => ({
    /** 当前项目根 */
    projectRoot: '' as string,
    /** Git 提交历史 */
    gitLog: [] as GitLogEntry[],
    /** Git 仓库状态摘要 */
    gitStatus: null as GitStatusSummary | null,
    /** 构建产物列表 */
    artifacts: [] as BuildArtifact[],
    /** 详细变更列表 */
    statusDetail: null as { staged: GitChangedFile[]; modified: GitChangedFile[]; untracked: GitChangedFile[] } | null,
    /** 是否正在初始化仓库 */
    initializing: false,
    /** 分支列表 */
    branches: [] as GitBranchInfo[],
    /** 远程列表 */
    remotes: [] as GitRemoteInfo[],
    /** tag 列表 */
    tags: [] as GitTagInfo[],
    /** 当前选中的提交详情 */
    commitDetail: null as GitCommitDetail | null,
    /** 加载状态 */
    loading: false,
    /** 错误信息 */
    error: ''
  }),

  actions: {
    /** 加载 Git log 与状态 */
    async loadGit(root: string): Promise<void> {
      this.projectRoot = root
      this.loading = true
      this.error = ''
      try {
        const [logResult, statusResult, detailResult, branchesResult, remotesResult, tagsResult] =
          await Promise.all([
            window.api.vcs.getGitLog(root, 50),
            window.api.vcs.getGitStatus(root),
            window.api.vcs.getStatusDetail(root),
            window.api.vcs.branchList(root),
            window.api.vcs.remoteList(root),
            window.api.vcs.tagList(root)
          ])
        const isRepo = statusResult.ok ? statusResult.status.isRepo : statusResult.status?.isRepo === true
        if (logResult.ok) this.gitLog = logResult.entries
        else if (isRepo) this.error = logResult.error ?? 'Git log 加载失败'
        if (statusResult.ok) {
          this.gitStatus = statusResult.status
        } else if (!isRepo) {
          // 非 Git 仓库是正常状态：交给空态卡片引导初始化，不当作错误
          this.gitStatus = statusResult.status
          this.gitLog = []
          this.statusDetail = null
          this.branches = []
          this.remotes = []
          this.tags = []
        } else {
          this.error = statusResult.error ?? 'Git status 加载失败'
        }
        if (detailResult.ok) this.statusDetail = detailResult.detail
        if (branchesResult.ok) this.branches = branchesResult.branches
        if (remotesResult.ok) this.remotes = remotesResult.remotes
        if (tagsResult.ok) this.tags = tagsResult.tags
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.loading = false
      }
    },

    /** 加载构建产物 */
    async loadArtifacts(root: string): Promise<void> {
      try {
        const result = await window.api.vcs.listArtifacts(root)
        if (result.ok) this.artifacts = result.artifacts
      } catch {
        // 产物加载失败不影响 Git 展示
      }
    },

    /** 刷新 Git 相关（log/status/detail/branches/remotes/tags） */
    async refreshGit(root: string): Promise<void> {
      await this.loadGit(root)
    },

    /** 刷新全部 */
    async refresh(root: string): Promise<void> {
      await Promise.all([this.loadGit(root), this.loadArtifacts(root)])
    },

    /** 暂存单文件，成功后刷新状态详情 */
    async stageFile(path: string): Promise<boolean> {
      if (!this.projectRoot) return false
      const r = await window.api.vcs.stageFile(this.projectRoot, path)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '暂存失败'
      return r.ok
    },

    /** 取消暂存单文件 */
    async unstageFile(path: string): Promise<boolean> {
      if (!this.projectRoot) return false
      const r = await window.api.vcs.unstageFile(this.projectRoot, path)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '取消暂存失败'
      return r.ok
    },

    /** 暂存全部 */
    async stageAll(): Promise<boolean> {
      if (!this.projectRoot) return false
      const r = await window.api.vcs.stageAll(this.projectRoot)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '暂存失败'
      return r.ok
    },

    /** 提交 */
    async commit(message: string): Promise<{ ok: boolean; hash?: string; error?: string }> {
      if (!this.projectRoot) return { ok: false, error: '无项目' }
      const r = await window.api.vcs.commit(this.projectRoot, message)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '提交失败'
      return r
    },

    /** 获取文件 diff */
    async getDiff(path: string, staged = false): Promise<string> {
      if (!this.projectRoot) return ''
      const r = await window.api.vcs.getDiff(this.projectRoot, path, staged)
      return r.diff
    },

    /** 切换分支 */
    async checkoutBranch(name: string): Promise<boolean> {
      if (!this.projectRoot) return false
      const r = await window.api.vcs.branchCheckout(this.projectRoot, name)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '切换分支失败'
      return r.ok
    },

    /** 创建分支 */
    async createBranch(name: string, base?: string): Promise<boolean> {
      if (!this.projectRoot) return false
      const r = await window.api.vcs.branchCreate(this.projectRoot, name, base)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '创建分支失败'
      return r.ok
    },

    /** 删除分支 */
    async deleteBranch(name: string): Promise<boolean> {
      if (!this.projectRoot) return false
      const r = await window.api.vcs.branchDelete(this.projectRoot, name)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '删除分支失败'
      return r.ok
    },

    /** 初始化 Git 仓库（成功后重新加载状态） */
    async initRepo(): Promise<VcsRepoOpResult> {
      if (!this.projectRoot) return { ok: false, error: '无项目' }
      this.initializing = true
      try {
        const r = await window.api.vcs.initRepo(this.projectRoot)
        if (r.ok) {
          this.error = ''
          await this.refreshGit(this.projectRoot)
        } else {
          this.error = r.error ?? '初始化仓库失败'
        }
        return r
      } finally {
        this.initializing = false
      }
    },

    /** 添加远程仓库（成功后刷新） */
    async addRemote(name: string, url: string): Promise<VcsRepoOpResult> {
      if (!this.projectRoot) return { ok: false, error: '无项目' }
      const r = await window.api.vcs.remoteAdd(this.projectRoot, name, url)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '添加远程失败'
      return r
    },

    /** 移除远程仓库（成功后刷新） */
    async removeRemote(name: string): Promise<VcsRepoOpResult> {
      if (!this.projectRoot) return { ok: false, error: '无项目' }
      const r = await window.api.vcs.remoteRemove(this.projectRoot, name)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '移除远程失败'
      return r
    },

    /** push */
    async push(remote: string, branch: string, setUpstream = false): Promise<{ ok: boolean; summary?: string; error?: string }> {
      if (!this.projectRoot) return { ok: false, error: '无项目' }
      return await window.api.vcs.push(this.projectRoot, remote, branch, setUpstream)
    },

    /** pull */
    async pull(): Promise<{ ok: boolean; summary?: string; error?: string }> {
      if (!this.projectRoot) return { ok: false, error: '无项目' }
      const r = await window.api.vcs.pull(this.projectRoot)
      if (r.ok) await this.refreshGit(this.projectRoot)
      return r
    },

    /** fetch */
    async fetch(): Promise<{ ok: boolean; summary?: string; error?: string }> {
      if (!this.projectRoot) return { ok: false, error: '无项目' }
      const r = await window.api.vcs.fetch(this.projectRoot)
      if (r.ok) await this.refreshGit(this.projectRoot)
      return r
    },

    /** 加载提交详情 */
    async loadCommitDetail(hash: string): Promise<void> {
      if (!this.projectRoot) return
      const r = await window.api.vcs.commitDetail(this.projectRoot, hash)
      if (r.ok && r.detail) this.commitDetail = r.detail
      else this.error = r.error ?? '加载提交详情失败'
    },

    /** 创建 tag */
    async createTag(name: string, message: string): Promise<boolean> {
      if (!this.projectRoot) return false
      const r = await window.api.vcs.tagCreate(this.projectRoot, name, message)
      if (r.ok) await this.refreshGit(this.projectRoot)
      else this.error = r.error ?? '创建 tag 失败'
      return r.ok
    }
  }
})
