/**
 * 版本与产物服务：仓库初始化 / 空仓库读取 / 远程管理。
 * 覆盖「非 Git 仓库 → 初始化 → 空仓库可用」这条主链，防止空仓库被误判为错误。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  addRemote,
  getGitLog,
  getGitStatus,
  initRepo,
  listRemotes,
  removeRemote
} from '../vcsService'

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const created: string[] = []

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-vcs-'))
  created.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.skipIf(!gitAvailable())('vcsService 仓库初始化与远程管理', () => {
  it('initRepo 创建 .git 并回到 main 分支', () => {
    const root = tmpDir()
    const r = initRepo(root)
    expect(r.ok).toBe(true)
    expect(existsSync(join(root, '.git'))).toBe(true)
    expect(r.detail).toContain('main')
  })

  it('重复初始化返回可读错误而不是抛异常', () => {
    const root = tmpDir()
    initRepo(root)
    const r = initRepo(root)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('已经是 Git 仓库')
  })

  it('空仓库的 git log 视为空历史而非错误', () => {
    const root = tmpDir()
    initRepo(root)
    expect(getGitLog(root)).toMatchObject({ ok: true, entries: [] })
  })

  it('空仓库的 git status 可正常读取（totalCommits 为 0）', () => {
    const root = tmpDir()
    initRepo(root)
    const r = getGitStatus(root)
    expect(r.ok).toBe(true)
    expect(r.status.isRepo).toBe(true)
    expect(r.status.totalCommits).toBe(0)
  })

  it('非 Git 仓库的 git status 返回 isRepo=false', () => {
    const r = getGitStatus(tmpDir())
    expect(r.ok).toBe(false)
    expect(r.status.isRepo).toBe(false)
  })

  it('addRemote / removeRemote 往返', () => {
    const root = tmpDir()
    initRepo(root)
    expect(addRemote(root, 'origin', 'https://example.com/a.git').ok).toBe(true)
    expect(listRemotes(root).remotes.map((x) => x.name)).toContain('origin')
    expect(removeRemote(root, 'origin').ok).toBe(true)
    expect(listRemotes(root).remotes).toHaveLength(0)
  })

  it('远程名含非法字符时拒绝', () => {
    const root = tmpDir()
    initRepo(root)
    expect(addRemote(root, 'bad name', 'https://example.com/a.git').ok).toBe(false)
  })

  it('远程地址为空时拒绝', () => {
    const root = tmpDir()
    initRepo(root)
    expect(addRemote(root, 'origin', '   ').ok).toBe(false)
  })
})
