/**
 * 版本与产物服务（M14）。
 * - Git：log/status/branch/remote/tag/diff/commit（读 + 基础写）
 * - 产物：扫描 build/libs/*.jar、dist/*.zip、run/mods/*.jar
 * 安全要点：统一走 execFileSync('git', args[]) 无 shell，
 * 路径/分支名作为独立 argv 元素传入，不经 cmd.exe 解析，
 * 彻底消除 quotePath 对 cmd.exe 元字符（& | % 等）失效导致的命令注入。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type {
  BuildArtifact,
  GitBranchInfo,
  GitCommitDetail,
  GitLogEntry,
  GitRemoteInfo,
  GitStatusSummary,
  GitTagInfo,
  VcsArtifactsResult,
  VcsBranchListResult,
  VcsBranchOpResult,
  VcsCommitDetailResult,
  VcsCommitResult,
  VcsDiffResult,
  VcsGitLogResult,
  VcsGitStatusResult,
  VcsRemoteListResult,
  VcsRepoOpResult,
  VcsStatusDetail,
  VcsStatusDetailResult,
  VcsSyncResult,
  VcsTagCreateResult,
  VcsTagListResult
} from '../../shared/types/vcs'

/** 执行 git 命令并返回 stdout（失败返回 null）。无 shell：args 作为 argv 直传 git.exe */
function gitExec(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
      shell: false
    })
  } catch (err) {
    // 捕获 stderr 以提供更友好的错误信息
    if (err && typeof err === 'object' && 'stderr' in err) {
      const stderr = String((err as { stderr?: unknown }).stderr ?? '')
      if (stderr.trim()) throw new Error(stderr.trim().split('\n')[0])
    }
    return null
  }
}

/** 只读查询：失败返回 null，不抛出（用于读取分支/日志等可预期的空仓库场景） */
function gitQuery(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
      shell: false
    })
  } catch {
    return null
  }
}

/** 读取最近 N 条提交 */
export function getGitLog(root: string, limit = 50): VcsGitLogResult {
  if (!existsSync(join(root, '.git'))) {
    return { ok: false, error: '不是 Git 仓库（缺少 .git 目录）', entries: [] }
  }
  // limit 来自 IPC，钳制为安全整数（无 shell，作为 argv 仍防御）
  const n = Math.min(Math.max(Math.floor(Number(limit) || 50), 1), 500)
  const fmt = '%H|%h|%an|%ae|%aI|%s'
  const out = gitQuery(root, ['log', `-${n}`, `--pretty=format:${fmt}`])
  if (out == null) {
    // 刚 init 的空仓库还没有任何提交，不是错误
    if (gitQuery(root, ['rev-parse', '--verify', 'HEAD']) == null) return { ok: true, entries: [] }
    return { ok: false, error: 'git log 执行失败', entries: [] }
  }

  const entries: GitLogEntry[] = out
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [hash, shortHash, author, email, date, ...msgParts] = line.split('|')
      return {
        hash: hash ?? '',
        shortHash: shortHash ?? '',
        author: author ?? '',
        email: email ?? '',
        date: date ?? '',
        message: msgParts.join('|')
      }
    })
  return { ok: true, entries }
}

/** 读取仓库状态 */
export function getGitStatus(root: string): VcsGitStatusResult {
  if (!existsSync(join(root, '.git'))) {
    return {
      ok: false,
      error: '不是 Git 仓库',
      status: {
        isRepo: false,
        branch: '',
        clean: true,
        untracked: 0,
        modified: 0,
        staged: 0,
        totalCommits: 0
      }
    }
  }

  const branch = gitQuery(root, ['branch', '--show-current'])?.trim() || 'HEAD'
  const statusOut = gitQuery(root, ['status', '--porcelain'])
  const totalCommitsStr = gitQuery(root, ['rev-list', '--count', 'HEAD'])
  const totalCommits = totalCommitsStr ? parseInt(totalCommitsStr.trim(), 10) : 0

  let untracked = 0
  let modified = 0
  let staged = 0
  if (statusOut) {
    for (const line of statusOut.split('\n')) {
      if (!line.trim()) continue
      const xy = line.substring(0, 2)
      if (xy === '??') untracked++
      else {
        if (xy[0] !== ' ' && xy[0] !== '?') staged++
        if (xy[1] !== ' ') modified++
      }
    }
  }

  const status: GitStatusSummary = {
    isRepo: true,
    branch,
    clean: untracked === 0 && modified === 0 && staged === 0,
    untracked,
    modified,
    staged,
    totalCommits
  }
  return { ok: true, status }
}

/** 读取详细变更列表（分类：已暂存/未暂存/未跟踪） */
export function getStatusDetail(root: string): VcsStatusDetailResult {
  if (!existsSync(join(root, '.git'))) {
    return { ok: false, error: '不是 Git 仓库', detail: { staged: [], modified: [], untracked: [] } }
  }
  const out = gitQuery(root, ['status', '--porcelain'])
  const detail: VcsStatusDetail = { staged: [], modified: [], untracked: [] }
  if (out) {
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const xy = line.substring(0, 2)
      const path = line.substring(3).trim()
      if (xy === '??') {
        detail.untracked.push({ path, status: '??', staged: false })
      } else {
        if (xy[0] !== ' ' && xy[0] !== '?') {
          detail.staged.push({ path, status: xy[0], staged: true })
        }
        if (xy[1] !== ' ') {
          detail.modified.push({ path, status: xy[1], staged: false })
        }
      }
    }
  }
  return { ok: true, detail }
}

/** 暂存单个文件 */
export function stageFile(root: string, path: string): { ok: boolean; error?: string } {
  const r = gitExec(root, ['add', '--', path])
  return r != null ? { ok: true } : { ok: false, error: '暂存失败' }
}

/** 取消暂存单个文件 */
export function unstageFile(root: string, path: string): { ok: boolean; error?: string } {
  const r = gitExec(root, ['reset', 'HEAD', '--', path])
  return r != null ? { ok: true } : { ok: false, error: '取消暂存失败' }
}

/** 暂存全部变更（含未跟踪） */
export function stageAll(root: string): { ok: boolean; error?: string } {
  const r = gitExec(root, ['add', '-A'])
  return r != null ? { ok: true } : { ok: false, error: '暂存失败' }
}

/** 提交 */
export function commit(root: string, message: string): VcsCommitResult {
  if (!message.trim()) return { ok: false, error: '提交信息不能为空' }
  // 写入临时提交信息文件，由 git -F 读取，避免多行/特殊字符转义
  const tmp = join(root, '.git', `COMMIT_MSG_${Date.now()}`)
  try {
    writeFileSync(tmp, message, 'utf8')
    const r = gitExec(root, ['commit', '-F', tmp])
    if (r == null) return { ok: false, error: '提交失败（无变更或冲突）' }
    const hash = gitExec(root, ['rev-parse', 'HEAD'])?.trim()
    return { ok: true, hash }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // 忽略
    }
  }
}

/** 获取指定文件的 diff（未暂存）；staged=true 时取已暂存 diff */
export function getDiff(root: string, path: string, staged = false): VcsDiffResult {
  const args = staged ? ['diff', '--cached', '--', path] : ['diff', '--', path]
  const r = gitQuery(root, args)
  return { ok: true, diff: r ?? '' }
}

/** 列出本地分支 */
export function listBranches(root: string): VcsBranchListResult {
  if (!existsSync(join(root, '.git'))) {
    return { ok: false, error: '不是 Git 仓库', branches: [] }
  }
  const out = gitQuery(root, ['branch', '-vv', '--no-color'])
  const branches: GitBranchInfo[] = []
  if (out) {
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const current = line.startsWith('*')
      const rest = line.replace(/^\*?\s+/, '')
      // 形如 main  abc1234 [origin/main] commit message
      const m = rest.match(/^(\S+)\s+(\S+)(?:\s+\[([^\]]+)\])?/)
      if (m) {
        branches.push({
          name: m[1],
          current,
          shortHash: m[2],
          upstream: m[3] ?? ''
        })
      }
    }
  }
  return { ok: true, branches }
}

/** 切换分支 */
export function checkoutBranch(root: string, name: string): VcsBranchOpResult {
  const r = gitExec(root, ['checkout', quoteBranch(name)])
  return r != null ? { ok: true } : { ok: false, error: '切换分支失败' }
}

/** 创建分支（基于当前 HEAD） */
export function createBranch(root: string, name: string, base?: string): VcsBranchOpResult {
  const nameArg = quoteBranch(name)
  const args = base ? ['checkout', '-b', nameArg, quoteBranch(base)] : ['checkout', '-b', nameArg]
  const r = gitExec(root, args)
  return r != null ? { ok: true } : { ok: false, error: '创建分支失败（分支名已存在或非法）' }
}

/** 删除分支（仅非当前分支） */
export function deleteBranch(root: string, name: string): VcsBranchOpResult {
  const r = gitExec(root, ['branch', '-d', quoteBranch(name)])
  return r != null ? { ok: true } : { ok: false, error: '删除分支失败（含未合并提交或为当前分支）' }
}

/** 初始化 Git 仓库（默认分支 main；旧版 git 不支持 -b 时回退普通 init） */
export function initRepo(root: string): VcsRepoOpResult {
  if (!existsSync(root)) return { ok: false, error: '项目目录不存在' }
  if (existsSync(join(root, '.git'))) return { ok: false, error: '该目录已经是 Git 仓库' }

  // git init -b main：2.28+；失败时回退到不带 -b 的写法
  let initialized = gitExec(root, ['init', '-b', 'main']) != null
  if (!initialized) initialized = gitExec(root, ['init']) != null
  if (!initialized) return { ok: false, error: 'git init 失败（请确认已安装 Git 并加入 PATH）' }

  const branch = gitExec(root, ['branch', '--show-current'])?.trim() || 'master'
  return { ok: true, detail: `已初始化，当前分支 ${branch}` }
}

/** 添加远程仓库（name 默认 origin） */
export function addRemote(root: string, name: string, url: string): VcsRepoOpResult {
  if (!existsSync(join(root, '.git'))) return { ok: false, error: '不是 Git 仓库' }
  const remoteName = name.trim() || 'origin'
  const remoteUrl = url.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(remoteName)) {
    return { ok: false, error: '远程名只能包含字母、数字、点、下划线与连字符' }
  }
  if (!remoteUrl) return { ok: false, error: '远程地址不能为空' }
  // URL 作为独立 argv 直传，不经 shell，避免元字符注入
  const r = gitExec(root, ['remote', 'add', remoteName, remoteUrl])
  if (r == null) return { ok: false, error: '添加远程失败（同名远程可能已存在）' }
  return { ok: true, detail: `已添加远程 ${remoteName}` }
}

/** 移除远程仓库 */
export function removeRemote(root: string, name: string): VcsRepoOpResult {
  if (!existsSync(join(root, '.git'))) return { ok: false, error: '不是 Git 仓库' }
  const r = gitExec(root, ['remote', 'remove', name])
  if (r == null) return { ok: false, error: `移除远程 ${name} 失败（远程不存在）` }
  return { ok: true, detail: `已移除远程 ${name}` }
}

/** 列出远程仓库 */
export function listRemotes(root: string): VcsRemoteListResult {
  if (!existsSync(join(root, '.git'))) {
    return { ok: false, error: '不是 Git 仓库', remotes: [] }
  }
  const out = gitQuery(root, ['remote', '-v'])
  const map = new Map<string, GitRemoteInfo>()
  if (out) {
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)/)
      if (m) {
        const [, name, url, type] = m
        if (!map.has(name)) {
          map.set(name, { name, fetchUrl: '', pushUrl: '' })
        }
        const info = map.get(name)!
        if (type === 'fetch') info.fetchUrl = url
        else info.pushUrl = url
      }
    }
  }
  return { ok: true, remotes: [...map.values()] }
}

/** push 到远程 */
export function push(root: string, remote: string, branch: string, setUpstream = false): VcsSyncResult {
  const args = setUpstream ? ['push', '-u', quoteBranch(remote), quoteBranch(branch)] : ['push', quoteBranch(remote), quoteBranch(branch)]
  try {
    const r = gitExec(root, args)
    return { ok: true, summary: (r ?? '').trim().slice(0, 500) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), summary: '' }
  }
}

/** pull 远程 */
export function pull(root: string): VcsSyncResult {
  try {
    const r = gitExec(root, ['pull', '--ff-only'])
    return { ok: true, summary: (r ?? '').trim().slice(0, 500) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), summary: '' }
  }
}

/** fetch 远程 */
export function fetchRemote(root: string): VcsSyncResult {
  try {
    const r = gitExec(root, ['fetch', '--all', '--prune'])
    return { ok: true, summary: (r ?? '').trim().slice(0, 500) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), summary: '' }
  }
}

/** 获取提交详情 */
export function getCommitDetail(root: string, hash: string): VcsCommitDetailResult {
  if (!existsSync(join(root, '.git'))) {
    return { ok: false, error: '不是 Git 仓库' }
  }
  const fmt = '%H|%h|%an|%ae|%aI|%s'
  // hash 来自 IPC，必须是 7-40 位十六进制（SHA 片段/全串），
  // 否则拒绝——防止 `git show <注入>` 经 execSync shell 执行任意命令。
  if (!/^[0-9a-fA-F]{7,40}$/.test(hash)) {
    return { ok: false, error: '非法提交哈希' }
  }
  const out = gitQuery(root, ['show', `--pretty=format:${fmt}`, '--numstat', hash])
  if (out == null) return { ok: false, error: '提交不存在' }

  const lines = out.split('\n')
  const first = lines[0] ?? ''
  const [fullHash, shortHash, author, email, date, ...msgParts] = first.split('|')
  const detail: GitCommitDetail = {
    hash: fullHash ?? '',
    shortHash: shortHash ?? '',
    author: author ?? '',
    email: email ?? '',
    date: date ?? '',
    message: msgParts.join('|'),
    insertions: 0,
    deletions: 0,
    files: []
  }
  // numstat 行：additions\tdeletions\tpath
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/)
    if (m) {
      const add = m[1] === '-' ? 0 : parseInt(m[1], 10)
      const del = m[2] === '-' ? 0 : parseInt(m[2], 10)
      detail.insertions += add
      detail.deletions += del
      detail.files.push({ path: m[3], insertions: add, deletions: del, status: m[1] === '-' ? 'B' : 'M' })
    }
  }
  return { ok: true, detail }
}

/** 列出 tag */
export function listTags(root: string): VcsTagListResult {
  if (!existsSync(join(root, '.git'))) {
    return { ok: false, error: '不是 Git 仓库', tags: [] }
  }
  const out = gitQuery(root, ['tag', '-l', '--format=%(refname:short)|%(objectname:short)|%(contents:subject)'])
  const tags: GitTagInfo[] = []
  if (out) {
    for (const line of out.split('\n')) {
      if (!line.trim()) continue
      const [name, shortHash, message] = line.split('|')
      tags.push({ name: name ?? '', shortHash: shortHash ?? '', message: message ?? '' })
    }
  }
  return { ok: true, tags }
}

/** 创建附注 tag */
export function createTag(root: string, name: string, message: string): VcsTagCreateResult {
  if (!name.trim()) return { ok: false, error: 'tag 名不能为空' }
  const tmp = join(root, '.git', `TAG_MSG_${Date.now()}`)
  try {
    writeFileSync(tmp, message || name, 'utf8')
    const r = gitExec(root, ['tag', '-a', quoteBranch(name), '-F', tmp])
    return r != null ? { ok: true } : { ok: false, error: '创建 tag 失败' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // 忽略
    }
  }
}

/** 扫描构建产物（jar / zip / 目录） */
export function listArtifacts(root: string): VcsArtifactsResult {
  const artifacts: BuildArtifact[] = []
  const scanDirs = [
    { path: join(root, 'build', 'libs'), kind: 'jar' as const },
    { path: join(root, 'dist'), kind: 'zip' as const },
    { path: join(root, 'run', 'mods'), kind: 'jar' as const },
    { path: join(root, 'build', 'distributions'), kind: 'zip' as const }
  ]

  for (const { path, kind } of scanDirs) {
    if (!existsSync(path)) continue
    try {
      for (const name of readdirSync(path)) {
        const full = join(path, name)
        const stat = statSync(full)
        if (stat.isDirectory()) {
          artifacts.push({
            path: full,
            name,
            kind: 'dir',
            size: 0,
            modifiedAt: stat.mtime.toISOString()
          })
        } else if (kind === 'jar' && name.endsWith('.jar')) {
          artifacts.push({
            path: full,
            name,
            kind: 'jar',
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
          })
        } else if (kind === 'zip' && name.endsWith('.zip')) {
          artifacts.push({
            path: full,
            name,
            kind: 'zip',
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
          })
        }
      }
    } catch {
      // 目录不可读时跳过
    }
  }

  artifacts.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
  return { ok: true, artifacts }
}

// ---------- 工具函数 ----------

/** 分支/远程名校验：仅允许字母/数字/._-，拒绝空白和 shell 元字符 */
function quoteBranch(name: string): string {
  if (!/^[\w./-]+$/.test(name)) throw new Error(`非法引用名：${name}`)
  return name
}
