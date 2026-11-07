/**
 * 每轮技能快照单测：
 * - 只复制启用技能，索引只含元数据；
 * - run 级隔离：全局改动不影响已建立的旧快照；
 * - 旧快照清理：保留最近窗口，过期才删除；
 * - 注入段明确要求先 skills_read，且不泄露正文。
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importSkillFile, setSkillEnabled } from '../skills/store'
import { createSkillSnapshot, renderSkillSection } from '../skills/runSkills'

function skillMarkdown(name: string, body: string): string {
  return ['---', `name: ${name}`, `description: ${name} 技能`, 'version: 1.0.0', '---', '', body].join(
    '\n'
  )
}

describe('createSkillSnapshot', () => {
  let storeRoot: string
  let projectRoot: string
  let src: string

  beforeEach(() => {
    storeRoot = mkdtempSync(join(tmpdir(), 'kunyu-skill-store-'))
    projectRoot = mkdtempSync(join(tmpdir(), 'kunyu-skill-proj-'))
    src = mkdtempSync(join(tmpdir(), 'kunyu-skill-file-'))
  })

  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true })
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  })

  function install(name: string, body: string): void {
    const file = join(src, `${name}.md`)
    writeFileSync(file, skillMarkdown(name, body))
    expect(importSkillFile(storeRoot, file).ok).toBe(true)
  }

  it('只复制启用技能，索引仅含元数据', () => {
    install('alpha', 'ALPHA_BODY_SECRET')
    install('beta', 'BETA_BODY_SECRET')
    setSkillEnabled(storeRoot, 'beta', false)

    const snap = createSkillSnapshot({ storeRoot, projectRoot, runId: 'run-1' })
    expect(snap.root).toBeTruthy()
    expect(snap.entries).toHaveLength(1)
    expect(snap.entries[0]).toMatchObject({ name: 'alpha', version: '1.0.0' })
    expect(snap.entries[0].path.endsWith(join('run-1', 'alpha', 'SKILL.md'))).toBe(true)
    // 索引对象本身不含正文
    expect(JSON.stringify(snap.entries)).not.toContain('ALPHA_BODY_SECRET')
    expect(readdirSync(snap.root as string)).toEqual(['alpha'])
  })

  it('run 级隔离：全局改动不影响已建立的旧快照', () => {
    install('isolated', 'OLD_BODY')
    const first = createSkillSnapshot({ storeRoot, projectRoot, runId: 'run-old' })
    const firstFile = first.entries[0].path

    // 直接改全局快照源：新 run 拿到新内容，旧 run 仍是旧内容
    writeFileSync(
      join(storeRoot, 'isolated', 'SKILL.md'),
      skillMarkdown('isolated', 'NEW_BODY')
    )
    const second = createSkillSnapshot({ storeRoot, projectRoot, runId: 'run-new' })
    expect(readFileSync(firstFile, 'utf-8')).toContain('OLD_BODY')
    expect(readFileSync(second.entries[0].path, 'utf-8')).toContain('NEW_BODY')
    expect(firstFile).not.toBe(second.entries[0].path)
  })

  it('注入段只包含元数据与读取指令，不含正文', () => {
    install('render-me', 'RENDER_BODY_SECRET')
    const snap = createSkillSnapshot({ storeRoot, projectRoot, runId: 'run-render' })
    const section = renderSkillSection(snap.entries)
    expect(section).toContain('用户技能索引')
    expect(section).toContain('render-me')
    expect(section).toContain('skills_read')
    expect(section).not.toContain('RENDER_BODY_SECRET')
    expect(renderSkillSection([])).toBe('')
  })

  it('清理超过保留窗口且 24h 前的旧快照', () => {
    const base = join(projectRoot, '.kunyu', 'user-skills')
    const old = Date.now() / 1000 - 2 * 24 * 60 * 60
    for (let i = 0; i < 11; i++) {
      const dir = join(base, `old-${i}`)
      mkdirSync(dir, { recursive: true })
      utimesSync(dir, old, old)
    }
    const snap = createSkillSnapshot({ storeRoot, projectRoot, runId: 'fresh' })
    expect(snap.root).toBeTruthy()
    const remain = readdirSync(base)
    expect(remain).toContain('fresh')
    // 保留窗口 10 个（含当前 run）：11 个旧目录删掉最老的 2 个
    expect(remain.filter((n) => n.startsWith('old-')).length).toBe(9)
  })
})
