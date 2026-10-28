/**
 * 版本与产物（M14）：Git 提交历史与构建产物列表。
 * 主进程 vcsService 与渲染层 VcsView 共用。
 */

/** Git 提交摘要（log 表格行） */
export interface GitLogEntry {
  /** 完整 hash */
  hash: string
  /** 短 hash（7位） */
  shortHash: string
  /** 作者名 */
  author: string
  /** 作者邮箱 */
  email: string
  /** 提交时间（ISO） */
  date: string
  /** 提交信息（第一行） */
  message: string
}

/** Git 仓库状态摘要 */
export interface GitStatusSummary {
  /** 是否是 git 仓库 */
  isRepo: boolean
  /** 当前分支名（如 main / feature/xxx；detached 时为 HEAD） */
  branch: string
  /** 工作区是否干净（无未暂存/未提交变更） */
  clean: boolean
  /** 未跟踪文件数 */
  untracked: number
  /** 已修改但未暂存数 */
  modified: number
  /** 已暂存数 */
  staged: number
  /** 提交总数（HEAD 之前的全部历史） */
  totalCommits: number
}

/** 单个变更文件 */
export interface GitChangedFile {
  /** 相对仓库根的路径 */
  path: string
  /** 状态：M=修改 A=新增 D=删除 R=重命名 ??=未跟踪 */
  status: string
  /** 是否已暂存 */
  staged: boolean
}

/** 变更分类（vcs:get-status-detail） */
export interface VcsStatusDetail {
  /** 已暂存 */
  staged: GitChangedFile[]
  /** 未暂存修改 */
  modified: GitChangedFile[]
  /** 未跟踪 */
  untracked: GitChangedFile[]
}

/** 分支信息 */
export interface GitBranchInfo {
  /** 分支名 */
  name: string
  /** 是否当前分支 */
  current: boolean
  /** 指向的短 hash */
  shortHash: string
  /** 上游远程分支名（如 origin/main），无则空串 */
  upstream: string
}

/** 远程仓库信息 */
export interface GitRemoteInfo {
  /** 远程名（origin 等） */
  name: string
  /** fetch URL */
  fetchUrl: string
  /** push URL */
  pushUrl: string
}

/** tag 信息 */
export interface GitTagInfo {
  /** tag 名 */
  name: string
  /** 指向的提交短 hash */
  shortHash: string
  /** tag 消息（附注 tag 有；轻量 tag 为空串） */
  message: string
}

/** 提交详情 */
export interface GitCommitDetail {
  hash: string
  shortHash: string
  author: string
  email: string
  date: string
  message: string
  /** 增行统计（所有文件合计） */
  insertions: number
  /** 删行统计 */
  deletions: number
  /** 变更文件列表（含该文件的增删统计） */
  files: Array<{ path: string; insertions: number; deletions: number; status: string }>
}

/** 构建产物条目（jar / zip / 目录） */
export interface BuildArtifact {
  /** 文件绝对路径 */
  path: string
  /** 文件名 */
  name: string
  /** 类型：jar / zip / dir */
  kind: 'jar' | 'zip' | 'dir'
  /** 大小（字节） */
  size: number
  /** 修改时间（ISO） */
  modifiedAt: string
}

/** vcs:get-git-log 返回 */
export interface VcsGitLogResult {
  ok: boolean
  error?: string
  entries: GitLogEntry[]
}

/** vcs:get-git-status 返回 */
export interface VcsGitStatusResult {
  ok: boolean
  error?: string
  status: GitStatusSummary
}

/** vcs:list-artifacts 返回 */
export interface VcsArtifactsResult {
  ok: boolean
  error?: string
  artifacts: BuildArtifact[]
}

/** vcs:get-status-detail 返回 */
export interface VcsStatusDetailResult {
  ok: boolean
  error?: string
  detail: VcsStatusDetail
}

/** vcs:commit 返回 */
export interface VcsCommitResult {
  ok: boolean
  error?: string
  /** 新提交 hash */
  hash?: string
}

/** vcs:diff 返回 */
export interface VcsDiffResult {
  ok: boolean
  error?: string
  /** diff 文本（统一 diff 格式） */
  diff: string
}

/** vcs:branch-list 返回 */
export interface VcsBranchListResult {
  ok: boolean
  error?: string
  branches: GitBranchInfo[]
}

/** vcs:branch-* 返回 */
export interface VcsBranchOpResult {
  ok: boolean
  error?: string
}

/** 仓库级操作（init / remote add / remote remove） */
export interface VcsRepoOpResult {
  ok: boolean
  error?: string
  /** 成功时的补充说明（如「已在 main 分支初始化」） */
  detail?: string
}

/** vcs:remote-list 返回 */
export interface VcsRemoteListResult {
  ok: boolean
  error?: string
  remotes: GitRemoteInfo[]
}

/** vcs:push/pull/fetch 返回 */
export interface VcsSyncResult {
  ok: boolean
  error?: string
  /** 操作输出摘要 */
  summary: string
}

/** vcs:commit-detail 返回 */
export interface VcsCommitDetailResult {
  ok: boolean
  error?: string
  detail?: GitCommitDetail
}

/** vcs:tag-list 返回 */
export interface VcsTagListResult {
  ok: boolean
  error?: string
  tags: GitTagInfo[]
}

/** vcs:tag-create 返回 */
export interface VcsTagCreateResult {
  ok: boolean
  error?: string
}
