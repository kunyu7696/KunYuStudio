/**
 * read_project_file 单文件直读工具单测：
 * 注册暴露、路径安全（盘符/UNC/.. 逃逸）、扩展名白名单、读取成功回执。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

let root: string
let registry: ToolRegistry

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-rpf-'))
  mkdirSync(join(root, 'src/main/java'), { recursive: true })
  writeFileSync(join(root, 'src/main/java/Foo.java'), 'class Foo {}\n')
  registry = createToolRegistry({ projectRoot: () => root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function run(args: Record<string, unknown>): Promise<ToolResult> {
  return registry.executeTool('read_project_file', args, CTX)
}

describe('read_project_file', () => {
  it('已注册；无项目时不暴露', () => {
    expect(registry.getToolDefinitions().map((d) => d.function.name)).toContain('read_project_file')
    const empty = createToolRegistry({})
    expect(empty.getToolDefinitions().map((d) => d.function.name)).not.toContain('read_project_file')
  })

  it('读取成功返回带 FILE 头的原文', async () => {
    const r = await run({ relPath: 'src/main/java/Foo.java' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('class Foo {}')
    expect(r.data).toMatchObject({ path: 'src/main/java/Foo.java' })
  })

  it('反斜杠路径归一化', async () => {
    const r = await run({ relPath: 'src\\main\\java\\Foo.java' })
    expect(r.ok).toBe(true)
  })

  it.each([
    ['盘符', 'C:/x/Foo.java'],
    ['UNC', '//server/x/Foo.java'],
    ['父目录逃逸', 'src/../../Foo.java'],
    ['空', '']
  ])('拒绝非法路径：%s', async (_l, relPath) => {
    expect((await run({ relPath })).ok).toBe(false)
  })

  it('扩展名白名单拒绝 png/txt', async () => {
    expect((await run({ relPath: 'a.png' })).ok).toBe(false)
    expect((await run({ relPath: 'a.txt' })).ok).toBe(false)
  })

  it('文件不存在报错', async () => {
    const r = await run({ relPath: 'src/main/java/Missing.java' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })
})
