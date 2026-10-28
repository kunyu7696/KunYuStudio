/**
 * B3 agent_memory_* 单测：
 * - appendMemoryEntry 纯逻辑：写入/单行化/去重/单条与总量上限
 * - 三工具出口：read 空态与回读、append、clear、无项目拒绝
 * - 注册表集成：project 可见性 + 命名纪律渲染
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { appendMemoryEntry, builtinMemoryTools, listEntries, normalizeEntry } from '../fcTools/memoryTools'
import { createToolRegistry, type ToolRegistryDeps } from '../toolRegistry'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }
const MEM_REL = join('.kunyu', 'agent-memory.md')

function tool(name: string, deps: ToolRegistryDeps) {
  const t = builtinMemoryTools(deps).find((x) => x.def.function.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

describe('normalizeEntry / listEntries', () => {
  it('换行与多余空白折叠为单空格', () => {
    expect(normalizeEntry('第一行\n第二行\t  缩进')).toBe('第一行 第二行 缩进')
  })

  it('listEntries 去掉 bullet 与标题行', () => {
    const content = '# 标题\n\n- 条目甲\n- 条目乙\n'
    expect(listEntries(content)).toEqual(['条目甲', '条目乙'])
  })
})

describe('appendMemoryEntry', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-mem-'))
  })

  it('首次写入自动创建 .kunyu 目录与文件头', () => {
    const r = appendMemoryEntry(root, '包名统一 com.example.mod')
    expect(r.ok).toBe(true)
    const content = readFileSync(join(root, MEM_REL), 'utf-8')
    expect(content).toContain('# Agent 项目记忆')
    expect(content).toContain('- 包名统一 com.example.mod')
  })

  it('多行输入折叠为单条单行', () => {
    appendMemoryEntry(root, '第一\n第二')
    const content = readFileSync(join(root, MEM_REL), 'utf-8')
    expect(content).toContain('- 第一 第二')
    expect(content.trim().split('\n').filter((l) => l.startsWith('- ')).length).toBe(1)
  })

  it('同内容条目去重不重复写入', () => {
    expect(appendMemoryEntry(root, '盗贼实体方案已确认').duplicate).toBeUndefined()
    const again = appendMemoryEntry(root, '盗贼实体方案已确认')
    expect(again.ok).toBe(true)
    expect(again.duplicate).toBe(true)
    const content = readFileSync(join(root, MEM_REL), 'utf-8')
    expect(content.match(/盗贼实体方案已确认/g)?.length).toBe(1)
  })

  it('空白/超长单条拒绝', () => {
    expect(appendMemoryEntry(root, '   ').ok).toBe(false)
    const long = appendMemoryEntry(root, 'x'.repeat(501))
    expect(long.ok).toBe(false)
    expect(long.reason).toContain('单条记忆超长')
  })

  it('总量超限拒绝并引导精简', () => {
    mkdirSync(join(root, '.kunyu'), { recursive: true })
    writeFileSync(join(root, MEM_REL), `# Agent 项目记忆（.kunyu/agent-memory.md）\n\n- ${'y'.repeat(3_990)}\n`, 'utf-8')
    const r = appendMemoryEntry(root, '再来一条就会超')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('总量上限')
  })
})

describe('agent_memory_* 工具出口', () => {
  let root: string
  let deps: ToolRegistryDeps

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-mem-tool-'))
    deps = { projectRoot: () => root }
  })

  it('read 空记忆时给出引导文案', async () => {
    const r = await tool('agent_memory_read', deps).execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('暂无项目记忆')
  })

  it('append → read 回读一致', async () => {
    await tool('agent_memory_append', deps).execute({ entry: ' mod id 定为 kunyu_mod ' }, CTX)
    const r = await tool('agent_memory_read', deps).execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('- mod id 定为 kunyu_mod')
  })

  it('clear 删除文件，再读回空态', async () => {
    await tool('agent_memory_append', deps).execute({ entry: '待清空' }, CTX)
    const c = await tool('agent_memory_clear', deps).execute({}, CTX)
    expect(c.ok).toBe(true)
    expect(existsSync(join(root, MEM_REL))).toBe(false)
    const r = await tool('agent_memory_read', deps).execute({}, CTX)
    expect(r.text).toContain('暂无项目记忆')
  })

  it('clear 无文件时幂等', async () => {
    const r = await tool('agent_memory_clear', deps).execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('无需清空')
  })

  it('无项目时三工具均拒绝执行', async () => {
    const noProj: ToolRegistryDeps = { projectRoot: () => null }
    for (const name of ['agent_memory_read', 'agent_memory_append', 'agent_memory_clear']) {
      const r = await tool(name, noProj).execute({ entry: 'x' }, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('无打开的项目')
    }
  })
})

describe('agent_memory 注册表集成', () => {
  it('无项目不暴露；有项目暴露且渲染命名纪律', () => {
    const names0 = createToolRegistry({})
      .getToolDefinitions()
      .map((d) => d.function.name)
    expect(names0).not.toContain('agent_memory_read')

    const reg = createToolRegistry({ projectRoot: () => 'D:/p' })
    const defs = reg.getToolDefinitions()
    expect(defs.find((d) => d.function.name === 'agent_memory_read')?.function.description).toMatch(/^【只读】/)
    expect(defs.find((d) => d.function.name === 'agent_memory_append')?.function.description).toMatch(
      /^【写项目盘】/
    )
  })
})
