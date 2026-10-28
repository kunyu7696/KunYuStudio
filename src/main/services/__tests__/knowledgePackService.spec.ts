import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_STALE_DAYS,
  computeFingerprint,
  getKnowledgePackStatus,
  readPackManifest,
  scanLocalPack
} from '../knowledgePackService'

const dirs: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-kb-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'fabric'), { recursive: true })
  mkdirSync(join(dir, 'mcwiki'), { recursive: true })
  return dir
}

function writeManifest(root: string, corpusVersion = '2026.10.1', generatedAt = '2026-10-01'): void {
  const scan = scanLocalPack(root)
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      corpusVersion,
      generatedAt,
      files: scan.files,
      fingerprint: scan.fingerprint
    })
  )
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('knowledgePackService', () => {
  it('指纹一致时为 ok', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), '# A\n内容')
    writeFileSync(join(root, 'mcwiki', 'b.md'), '# B\n内容')
    writeManifest(root)
    const status = getKnowledgePackStatus(root, Date.parse('2026-10-10T00:00:00Z'))
    expect(status.state).toBe('ok')
    expect(status.fileCount).toBe(2)
    expect(status.changedFiles).toEqual([])
  })

  it('文件内容改动 → drifted 并列出改动项', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'v1')
    writeManifest(root)
    writeFileSync(join(root, 'fabric', 'a.md'), 'v2')
    const status = getKnowledgePackStatus(root)
    expect(status.state).toBe('drifted')
    expect(status.changedFiles).toEqual(['fabric/a.md'])
  })

  it('新增/缺失文件都能识别', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'same')
    writeManifest(root)
    writeFileSync(join(root, 'fabric', 'new.md'), 'new')
    unlinkSync(join(root, 'fabric', 'a.md'))
    const status = getKnowledgePackStatus(root)
    expect(status.state).toBe('drifted')
    expect(status.extraFiles).toEqual(['fabric/new.md'])
    expect(status.missingFiles).toEqual(['fabric/a.md'])
  })

  it('无清单 → missing-manifest；空目录 → empty', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'x')
    expect(getKnowledgePackStatus(root).state).toBe('missing-manifest')
    rmSync(join(root, 'fabric', 'a.md'))
    expect(getKnowledgePackStatus(root).state).toBe('empty')
  })

  it('超过保鲜阈值 → outdated（指纹仍一致）', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'x')
    writeManifest(root, '2026.1.1', '2026-01-01')
    const now = Date.parse('2026-01-01T00:00:00Z') + (KNOWLEDGE_STALE_DAYS + 1) * 86_400_000
    const status = getKnowledgePackStatus(root, now)
    expect(status.state).toBe('outdated')
    expect(status.ageDays).toBe(KNOWLEDGE_STALE_DAYS + 1)
  })

  it('清单结构非法时按未登记处理', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'x')
    writeFileSync(join(root, 'manifest.json'), '{"schemaVersion":2}')
    expect(readPackManifest(root)).toBeNull()
    expect(getKnowledgePackStatus(root).state).toBe('missing-manifest')
  })

  it('指纹对文件顺序不敏感', () => {
    const a = computeFingerprint([
      { path: 'b.md', sha256: '2' },
      { path: 'a.md', sha256: '1' }
    ])
    const b = computeFingerprint([
      { path: 'a.md', sha256: '1' },
      { path: 'b.md', sha256: '2' }
    ])
    expect(a).toBe(b)
  })

  it('autoRefresh：语料改动后自动重写指纹并返回 ok', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'v1')
    writeManifest(root)
    writeFileSync(join(root, 'fabric', 'a.md'), 'v2')
    const now = Date.parse('2026-10-23T00:00:00Z')
    const status = getKnowledgePackStatus(root, now, { autoRefresh: true })
    expect(status.state).toBe('ok')
    expect(status.autoRefreshed).toBe(true)
    // 落盘后的清单与磁盘一致，二次检测不再漂移
    expect(getKnowledgePackStatus(root, now).state).toBe('ok')
    expect(readPackManifest(root)?.fingerprint).toBe(status.fingerprint)
  })

  it('autoRefresh：无清单时自动登记', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'x')
    const status = getKnowledgePackStatus(root, Date.parse('2026-10-23T00:00:00Z'), {
      autoRefresh: true
    })
    expect(status.state).toBe('ok')
    expect(status.autoRefreshed).toBe(true)
    expect(readPackManifest(root)?.files.length).toBe(1)
  })

  it('autoRefresh：语料未变时不重写清单', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'x')
    writeManifest(root)
    const status = getKnowledgePackStatus(root, Date.parse('2026-10-23T00:00:00Z'), {
      autoRefresh: true
    })
    expect(status.state).toBe('ok')
    expect(status.autoRefreshed).toBeUndefined()
  })

  it('autoRefresh：过期状态不会被自动刷新掩盖', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'fabric', 'a.md'), 'x')
    writeManifest(root, '2026.1.1', '2026-01-01')
    const now = Date.parse('2026-01-01T00:00:00Z') + (KNOWLEDGE_STALE_DAYS + 5) * 86_400_000
    const status = getKnowledgePackStatus(root, now, { autoRefresh: true })
    expect(status.state).toBe('outdated')
    expect(status.autoRefreshed).toBeUndefined()
  })

  it('仓库随包语料与登记清单一致（改动语料后需重跑 build-knowledge-manifest）', () => {
    const root = join(process.cwd(), 'resources', 'knowledge')
    const status = getKnowledgePackStatus(root, Date.parse('2026-10-23T00:00:00Z'))
    expect(status.changedFiles).toEqual([])
    expect(status.missingFiles).toEqual([])
    expect(status.extraFiles).toEqual([])
    expect(status.state === 'ok' || status.state === 'outdated').toBe(true)
  })
})
