/**
 * 用户技能包存储单测：
 * - frontmatter 解析与 name/description/正文校验；
 * - 单文件 / 目录安装、重复名拒绝、启停持久化、删除；
 * - 路径越界、符号链接、体积超限、目录限额等安全边界；
 * - 状态文件版本号随变更递增（防并发覆盖）。
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  importSkillDirectory,
  importSkillFile,
  listSkills,
  parseSkillMarkdown,
  readSkillFile,
  reloadSkills,
  removeSkill,
  setSkillEnabled
} from '../skills/store'
import { SKILL_LIMITS } from '../../../../shared/types/skill'

const BODY = '# 使用说明\n\nSECRET_BODY_MARKER\n'

function skillMarkdown(name: string, opts: { description?: string; version?: string; body?: string } = {}) {
  return [
    '---',
    `name: ${name}`,
    `description: ${opts.description ?? `demo ${name}`}`,
    `version: ${opts.version ?? '1.2.3'}`,
    'license: Apache-2.0',
    '---',
    '',
    opts.body ?? BODY
  ].join('\n')
}

function writeSkill(dir: string, name: string, opts?: Parameters<typeof skillMarkdown>[1]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), skillMarkdown(name, opts))
}

describe('parseSkillMarkdown', () => {
  it('解析 name/description/version 与正文，保留其它字段', () => {
    const parsed = parseSkillMarkdown(skillMarkdown('my-skill'))
    expect(parsed.name).toBe('my-skill')
    expect(parsed.description).toBe('demo my-skill')
    expect(parsed.version).toBe('1.2.3')
    expect(parsed.extra['license']).toBe('Apache-2.0')
    expect(parsed.body).toContain('SECRET_BODY_MARKER')
  })

  it('支持引号与块标量描述', () => {
    const raw = ['---', 'name: quoted', 'description: "带 空格 的描述"', '---', '正文'].join('\n')
    expect(parseSkillMarkdown(raw).description).toBe('带 空格 的描述')
    const folded = [
      '---',
      'name: folded',
      'description: >',
      '  第一行',
      '  第二行',
      '---',
      '正文'
    ].join('\n')
    expect(parseSkillMarkdown(folded).description).toBe('第一行 第二行')
  })

  it('缺少 frontmatter / 名称非法 / 描述缺失 / 正文为空都拒绝', () => {
    expect(() => parseSkillMarkdown('# 没有 frontmatter')).toThrow(/frontmatter/)
    expect(() =>
      parseSkillMarkdown(['---', 'name: Bad Name', 'description: x', '---', '正文'].join('\n'))
    ).toThrow(/name/)
    expect(() =>
      parseSkillMarkdown(['---', 'name: no-desc', '---', '正文'].join('\n'))
    ).toThrow(/description/)
    expect(() =>
      parseSkillMarkdown(['---', 'name: empty-body', 'description: x', '---', '  '].join('\n'))
    ).toThrow(/正文为空/)
  })
})

describe('技能安装与生命周期', () => {
  let root: string
  let work: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-skills-'))
    work = mkdtempSync(join(tmpdir(), 'kunyu-skill-src-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  it('导入单个 SKILL.md 并进入启用列表', () => {
    const src = join(work, 'SKILL.md')
    writeFileSync(src, skillMarkdown('single-file'))
    const res = importSkillFile(root, src)
    expect(res).toEqual({ ok: true, name: 'single-file' })

    const list = listSkills(root)
    expect(list.issues).toEqual([])
    expect(list.skills).toHaveLength(1)
    expect(list.skills[0]).toMatchObject({
      name: 'single-file',
      version: '1.2.3',
      enabled: true,
      source: 'file',
      dirName: 'single-file'
    })
  })

  it('导入目录时复制附件并统计项数', () => {
    const src = join(work, 'pack')
    writeSkill(src, 'pack-skill')
    mkdirSync(join(src, 'references'))
    writeFileSync(join(src, 'references', 'style.md'), '# style')
    const res = importSkillDirectory(root, src)
    expect(res.ok).toBe(true)
    const meta = listSkills(root).skills[0]
    expect(meta.entryCount).toBe(3) // SKILL.md + references + style.md
    expect(readSkillFile(root, meta.dirName, 'references/style.md')).toMatchObject({
      ok: true,
      text: '# style'
    })
  })

  it('拒绝重名技能', () => {
    writeSkill(join(work, 'a'), 'dup')
    writeSkill(join(work, 'b'), 'dup')
    expect(importSkillDirectory(root, join(work, 'a')).ok).toBe(true)
    const res = importSkillDirectory(root, join(work, 'b'))
    expect(res.ok).toBe(false)
    expect(res.error).toContain('已存在同名技能')
  })

  it('扫描时同名目录记为问题而非重复注入', () => {
    writeSkill(join(root, 'a'), 'same')
    writeSkill(join(root, 'b'), 'same')
    const list = listSkills(root)
    expect(list.skills).toHaveLength(1)
    expect(list.issues[0]?.message).toContain('重复')
  })

  it('启停持久化且状态版本递增', () => {
    const src = join(work, 'SKILL.md')
    writeFileSync(src, skillMarkdown('toggle'))
    importSkillFile(root, src)

    const before = JSON.parse(readFileSync(join(root, '.skill-state.json'), 'utf-8'))
    expect(setSkillEnabled(root, 'toggle', false).ok).toBe(true)
    const after = JSON.parse(readFileSync(join(root, '.skill-state.json'), 'utf-8'))
    expect(after.version).toBe(before.version + 1)
    expect(after.enabled['toggle']).toBe(false)

    // 扫描缓存已失效，禁用状态立刻可见
    expect(listSkills(root).skills[0].enabled).toBe(false)
    reloadSkills(root)
    expect(listSkills(root).skills[0].enabled).toBe(false)
  })

  it('删除技能目录并清理状态', () => {
    const src = join(work, 'SKILL.md')
    writeFileSync(src, skillMarkdown('gone'))
    importSkillFile(root, src)
    expect(removeSkill(root, 'gone').ok).toBe(true)
    expect(listSkills(root).skills).toHaveLength(0)
    expect(listSkills(root).skills).toHaveLength(0)
  })
})

describe('安全边界', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-skills-safe-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('SKILL.md 超过 256 KiB 被拒绝', () => {
    const dir = join(root, 'huge')
    mkdirSync(dir)
    const file = join(dir, 'SKILL.md')
    writeFileSync(file, skillMarkdown('huge'))
    truncateSync(file, SKILL_LIMITS.maxSkillFileBytes + 1)
    const list = listSkills(root)
    expect(list.skills).toHaveLength(0)
    expect(list.issues[0]?.message).toContain('超长')
  })

  it('符号链接目录被跳过（无权限创建时视为通过）', () => {
    const real = join(root, 'real')
    writeSkill(real, 'real-skill')
    try {
      symlinkSync(real, join(root, 'link'), 'junction')
    } catch {
      return // Windows 无符号链接权限：跳过
    }
    const list = listSkills(root)
    expect(list.skills.map((s) => s.name)).toEqual(['real-skill'])
    expect(list.issues.some((i) => i.message.includes('符号链接'))).toBe(true)
  })

  it('拒绝版本目录内的符号链接', () => {
    const dir = join(root, 'with-link')
    writeSkill(dir, 'with-link')
    try {
      symlinkSync(join(dir, 'SKILL.md'), join(dir, 'link.md'), 'file')
    } catch {
      return
    }
    const list = listSkills(root)
    expect(list.skills).toHaveLength(0)
    expect(list.issues[0]?.message).toContain('符号链接')
  })

  it('读取路径越界与绝对路径被拒绝', () => {
    writeSkill(join(root, 'safe'), 'safe')
    expect(readSkillFile(root, 'safe', '../outside.md').ok).toBe(false)
    expect(readSkillFile(root, 'safe', 'C:/Windows/win.ini').ok).toBe(false)
    expect(readSkillFile(root, 'safe', '/etc/passwd').ok).toBe(false)
  })

  it('读取二进制附件被拒绝，单次读取上限生效', () => {
    const dir = join(root, 'assets')
    writeSkill(dir, 'assets')
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'x.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(readSkillFile(root, 'assets', 'assets/x.png').ok).toBe(false)

    writeFileSync(join(dir, 'assets', 'big.md'), 'a'.repeat(SKILL_LIMITS.maxReadBytes + 1))
    const res = readSkillFile(root, 'assets', 'assets/big.md')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('超长')
  })

  it('拒绝非法目录名（含路径分隔符）', () => {
    expect(setSkillEnabled(root, '../escape', false).ok).toBe(false)
    expect(removeSkill(root, 'a/b').ok).toBe(false)
    writeSkill(join(root, 'ok'), 'ok-skill')
    expect(readSkillFile(root, '../ok', 'SKILL.md').ok).toBe(false)
  })
})
