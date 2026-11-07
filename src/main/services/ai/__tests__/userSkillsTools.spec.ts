/**
 * 用户技能只读工具单测：
 * - skills_list 只返回索引元数据，不含正文；
 * - skills_read 读取正文/附件，拒绝未知技能、越界路径、二进制与超限文件；
 * - 工具通过 skillsDir 端口读取本轮快照，无快照时软失败。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { builtinSkillTools } from '../fcTools/skills'
import type { RegisteredTool, ToolExecContext, ToolRegistryDeps } from '../toolRegistry'
import { SKILL_LIMITS } from '../../../../shared/types/skill'

const BODY = 'READ_BODY_MARKER'
/** 技能工具不依赖 loader/mcVersion，直调时给最小上下文 */
const CTX = { loader: 'fabric', mcVersion: '1.20.1' } as ToolExecContext

function skillMarkdown(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} 的说明`,
    'version: 2.0.0',
    '---',
    '',
    BODY
  ].join('\n')
}

function tool(name: string, deps: ToolRegistryDeps): RegisteredTool {
  const found = builtinSkillTools(deps).find((t) => t.def.function.name === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

describe('skills_* 只读工具', () => {
  let snapshotRoot: string

  beforeEach(() => {
    snapshotRoot = mkdtempSync(join(tmpdir(), 'kunyu-skill-snapshot-'))
    mkdirSync(join(snapshotRoot, 'demo-skill'))
    writeFileSync(join(snapshotRoot, 'demo-skill', 'SKILL.md'), skillMarkdown('demo-skill'))
  })

  afterEach(() => {
    rmSync(snapshotRoot, { recursive: true, force: true })
  })

  const deps = (): ToolRegistryDeps => ({ skillsDir: () => snapshotRoot })

  it('skills_list 只给元数据，不给正文', async () => {
    const res = await tool('skills_list', deps()).execute({}, CTX)
    expect(res.ok).toBe(true)
    expect(res.text).toContain('demo-skill')
    expect(res.text).toContain('2.0.0')
    expect(res.text).not.toContain(BODY)
  })

  it('skills_read 读取 SKILL.md 正文', async () => {
    const res = await tool('skills_read', deps()).execute({ name: 'demo-skill' }, CTX)
    expect(res.ok).toBe(true)
    expect(res.text).toContain(BODY)
  })

  it('skills_read 读取文本附件，拒绝二进制与越界路径', async () => {
    mkdirSync(join(snapshotRoot, 'demo-skill', 'references'))
    writeFileSync(join(snapshotRoot, 'demo-skill', 'references', 'style.md'), '# STYLE')
    writeFileSync(join(snapshotRoot, 'demo-skill', 'references', 'icon.png'), Buffer.from([1, 2]))

    const read = tool('skills_read', deps())
    expect((await read.execute({ name: 'demo-skill', file: 'references/style.md' }, CTX)).ok).toBe(
      true
    )
    expect(
      (await read.execute({ name: 'demo-skill', file: 'references/icon.png' }, CTX)).ok
    ).toBe(false)
    expect((await read.execute({ name: 'demo-skill', file: '../outside.md' }, CTX)).ok).toBe(false)
  })

  it('拒绝未知技能名与非法技能名', async () => {
    const read = tool('skills_read', deps())
    expect((await read.execute({ name: 'not-installed' }, CTX)).ok).toBe(false)
    expect((await read.execute({ name: 'Bad Name' }, CTX)).ok).toBe(false)
    expect((await read.execute({}, CTX)).ok).toBe(false)
  })

  it('单次读取超过 256 KiB 软失败', async () => {
    writeFileSync(
      join(snapshotRoot, 'demo-skill', 'huge.md'),
      'a'.repeat(SKILL_LIMITS.maxReadBytes + 1)
    )
    const res = await tool('skills_read', deps()).execute(
      { name: 'demo-skill', file: 'huge.md' },
      CTX
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('超长')
  })

  it('无快照时软失败（不抛异常）', async () => {
    const res = await tool('skills_list', { skillsDir: () => null }).execute({}, CTX)
    expect(res.ok).toBe(false)
  })
})
