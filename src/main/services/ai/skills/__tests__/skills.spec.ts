/**
 * 技能包端到端链路：安装 → 扫描 → 启停 → run 快照 → 读取。
 *
 * 此前只有 toolInventory 清单一致性守门，没有任何测试验证「技能包真的能被
 * 装进来、被扫到、被快照复制、被只读工具读到」。这里用临时目录驱动真实
 * 文件系统，不 mock store/runSkills 本身。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SkillValidationError,
  importSkillDirectory,
  listSkills,
  parseSkillMarkdown,
  readSkillFile,
  removeSkill,
  setSkillEnabled
} from '../store'
import { createSkillSnapshot, renderSkillSection } from '../runSkills'

const SKILL_MD = `---
name: demo-skill
description: >-
  用于验证技能包安装、扫描、启停
  与 run 快照的端到端链路
version: 1.2.3
license: MIT
---

# Demo

按步骤执行。
`

function writeSkill(dir: string, md = SKILL_MD): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), md, 'utf8')
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-skill-'))
}

const cleanups: string[] = []

function makeTemp(): string {
  const dir = tempDir()
  cleanups.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('parseSkillMarkdown', () => {
  it('解析 name/version/块标量 description，并保留其余字段', () => {
    const parsed = parseSkillMarkdown(SKILL_MD)
    expect(parsed.name).toBe('demo-skill')
    expect(parsed.version).toBe('1.2.3')
    expect(parsed.description).toContain('端到端')
    expect(parsed.extra['license']).toBe('MIT')
    expect(parsed.body).toContain('# Demo')
  })

  it('缺 frontmatter / 缺字段 / 非法 name / 空正文均报中文错误', () => {
    expect(() => parseSkillMarkdown('# no frontmatter')).toThrow(SkillValidationError)
    expect(() => parseSkillMarkdown('---\ndescription: x\n---\nbody\n')).toThrow(/name/)
    expect(() => parseSkillMarkdown('---\nname: Bad_Name\ndescription: x\n---\nbody\n')).toThrow(
      /name/
    )
    expect(() => parseSkillMarkdown('---\nname: demo\ndescription: x\n---\n\n')).toThrow(/正文/)
  })
})

describe('技能包端到端：安装 → 扫描 → 启停 → 快照 → 读取', () => {
  it('完整链路可用，且路径越界/非文本/重名都被拒绝', () => {
    const base = makeTemp()
    const root = join(base, 'workbench-skills')
    const src = join(base, 'src', 'demo-skill')
    writeSkill(src)
    mkdirSync(join(src, 'reference'), { recursive: true })
    writeFileSync(join(src, 'reference', 'api.md'), '# API\n', 'utf8')
    writeFileSync(join(src, 'preview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    // 安装 + 扫描
    expect(importSkillDirectory(root, src)).toEqual({ ok: true, name: 'demo-skill' })
    const listed = listSkills(root)
    expect(listed.skills).toHaveLength(1)
    expect(listed.issues).toEqual([])
    const skill = listed.skills[0]!
    expect(skill.name).toBe('demo-skill')
    expect(skill.version).toBe('1.2.3')
    expect(skill.enabled).toBe(true)
    expect(skill.source).toBe('directory')

    // 只读工具读取：正文可读、附件可读、越界与非文本被拒
    expect(readSkillFile(root, 'demo-skill').ok).toBe(true)
    const nested = readSkillFile(root, 'demo-skill', 'reference/api.md')
    expect(nested.ok && nested.text).toBe('# API\n')
    expect(readSkillFile(root, 'demo-skill', '../outside.md').ok).toBe(false)
    expect(readSkillFile(root, 'demo-skill', '/etc/passwd').ok).toBe(false)
    expect(readSkillFile(root, 'demo-skill', 'preview.png').ok).toBe(false)

    // 重名导入被拒
    expect(importSkillDirectory(root, src).ok).toBe(false)

    // 启停：禁用后不进快照
    expect(setSkillEnabled(root, 'demo-skill', false).ok).toBe(true)
    expect(listSkills(root).skills[0]!.enabled).toBe(false)
    const projectRoot = join(base, 'proj')
    const off = createSkillSnapshot({ storeRoot: root, projectRoot, runId: 'run-off' })
    expect(off.entries).toEqual([])

    // 重新启用：快照复制到 .kunyu/user-skills/<runId>/<name>/，索引只含元数据
    expect(setSkillEnabled(root, 'demo-skill', true).ok).toBe(true)
    const on = createSkillSnapshot({ storeRoot: root, projectRoot, runId: 'run-on' })
    expect(on.entries).toHaveLength(1)
    expect(on.entries[0]!.name).toBe('demo-skill')
    const snapFile = join(projectRoot, '.kunyu', 'user-skills', 'run-on', 'demo-skill', 'SKILL.md')
    expect(existsSync(snapFile)).toBe(true)
    expect(on.entries[0]!.path).toBe(snapFile)

    // 注入段：只有索引，没有正文
    const section = renderSkillSection(on.entries)
    expect(section).toContain('demo-skill')
    expect(section).toContain('1.2.3')
    expect(section).toContain(snapFile)
    expect(section).not.toContain('# Demo')
    expect(renderSkillSection([])).toBe('')

    // 删除后彻底消失
    expect(removeSkill(root, 'demo-skill').ok).toBe(true)
    expect(listSkills(root).skills).toEqual([])
  })

  it('技能根内部目录不可作为导入源', () => {
    const base = makeTemp()
    const root = join(base, 'workbench-skills')
    const inner = join(root, 'demo-skill')
    writeSkill(inner)
    const result = importSkillDirectory(root, inner)
    expect(result.ok).toBe(false)
  })
})
