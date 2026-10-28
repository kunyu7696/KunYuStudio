/**
 * kubejsTools 单测：脚本列表/读写往返、目录与 stem 校验、模板库与落盘、项目门控。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-kj-tool-test-'))
  return {
    app: {
      getPath: () => dir,
      isPackaged: false,
      getVersion: () => '0.0.0-test'
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (b: Buffer) => b,
      decryptString: (b: Buffer) => b
    }
  }
})

import { builtinKubejsTools } from '../fcTools/kubejsTools'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import type { ToolExecContext, ToolRegistryDeps } from '../toolRegistry'

const CTX: ToolExecContext = { loader: 'fabric', mcVersion: '1.20.1' }

let root: string
let deps: ToolRegistryDeps

function tool(name: string) {
  return builtinKubejsTools(deps).find((t) => t.def.function.name === name)!
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-kj-proj-'))
  registerProjectRoot(root)
  deps = { projectRoot: () => root }
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('kubejsTools', () => {
  it('项目未打开时项目类工具拒绝', async () => {
    deps.projectRoot = () => null
    const r = await tool('kubejs_list_scripts').execute({}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有打开的项目')
  })

  it('空项目列表标记三目录缺失', async () => {
    const r = await tool('kubejs_list_scripts').execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('startup')
    expect(r.text).toContain('还没有')
  })

  it('kubejs_write_script → kubejs_read_script 往返；列表收编', async () => {
    const w = await tool('kubejs_write_script').execute(
      { dir: 'server', stem: 'my_recipes', content: "// hi\nonEvent('recipes', e => {})\n" },
      CTX
    )
    expect(w.ok).toBe(true)
    expect(w.text).toContain('kubejs/server_scripts/my_recipes.js')

    const read = await tool('kubejs_read_script').execute({ dir: 'server', stem: 'my_recipes' }, CTX)
    expect(read.ok).toBe(true)
    expect(read.text).toContain("onEvent('recipes'")

    const list = await tool('kubejs_list_scripts').execute({}, CTX)
    expect(list.text).toContain('kubejs/server_scripts/my_recipes.js')
  })

  it('入参校验：非法 dir / 非法 stem / 缺 content', async () => {
    const badDir = await tool('kubejs_write_script').execute({ dir: 'evil', stem: 'a', content: 'x' }, CTX)
    expect(badDir.ok).toBe(false)
    expect(badDir.error).toContain('startup')
    const badStem = await tool('kubejs_write_script').execute({ dir: 'server', stem: '../x', content: 'x' }, CTX)
    expect(badStem.ok).toBe(false)
    expect(badStem.error).toContain('不合法')
    const noContent = await tool('kubejs_write_script').execute({ dir: 'server', stem: 'a' }, CTX)
    expect(noContent.ok).toBe(false)
    expect(noContent.error).toContain('content')
  })

  it('kubejs_read_script 读不存在脚本软失败', async () => {
    const r = await tool('kubejs_read_script').execute({ dir: 'client', stem: 'nope' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })

  it('kubejs_list_templates 无需项目即可列出', async () => {
    deps.projectRoot = () => null
    const r = await tool('kubejs_list_templates').execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('server-recipes')
  })

  it('kubejs_apply_template 落盘；重复应用拒绝；未知模板软失败', async () => {
    const applied = await tool('kubejs_apply_template').execute({ templateId: 'server-recipes' }, CTX)
    expect(applied.ok).toBe(true)
    expect(existsSync(join(root, 'kubejs', 'server_scripts', 'my_recipes.js'))).toBe(true)
    const dup = await tool('kubejs_apply_template').execute({ templateId: 'server-recipes' }, CTX)
    expect(dup.ok).toBe(false)
    expect(dup.error).toContain('已存在')
    const unknown = await tool('kubejs_apply_template').execute({ templateId: 'nope' }, CTX)
    expect(unknown.ok).toBe(false)
    expect(unknown.error).toContain('模板不存在')
  })
})
