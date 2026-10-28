/**
 * decompileTools 单测：工作区列表/类搜索/文件读取/越界守卫/启动前校验。
 * 不触发真实下载与 Vineflower 进程（网络与外部进程由集成验证）。
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-dc-tool-test-'))
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

import { builtinDecompileTools } from '../fcTools/decompileTools'
import { decompileRoot } from '../../decompileService'
import type { ToolExecContext } from '../toolRegistry'

const CTX: ToolExecContext = { loader: 'fabric', mcVersion: '1.20.1' }

function tool(name: string) {
  return builtinDecompileTools().find((t) => t.def.function.name === name)!
}

describe('decompileTools', () => {
  let wsName: string

  beforeEach(() => {
    wsName = `demo-${Date.now().toString(36)}`
    mkdirSync(join(decompileRoot(), wsName, 'com', 'example'), { recursive: true })
    writeFileSync(
      join(decompileRoot(), wsName, 'com', 'example', 'Demo.java'),
      'package com.example; public class Demo {}'
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('decompile_list_workspaces 列出工作区', async () => {
    const r = await tool('decompile_list_workspaces').execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain(wsName)
  })

  it('decompile_search 按类名子串命中；缺参拒绝', async () => {
    const hit = await tool('decompile_search').execute({ workspace: wsName, query: 'demo' }, CTX)
    expect(hit.ok).toBe(true)
    expect(hit.text).toContain('Demo.java')
    const miss = await tool('decompile_search').execute({ workspace: wsName, query: '' }, CTX)
    expect(miss.ok).toBe(false)
    expect(miss.error).toContain('query')
  })

  it('decompile_read_file 读全文；越界路径软失败', async () => {
    const ok = await tool('decompile_read_file').execute(
      { workspace: wsName, path: 'com/example/Demo.java' },
      CTX
    )
    expect(ok.ok).toBe(true)
    expect(ok.text).toContain('class Demo')
    const evil = await tool('decompile_read_file').execute(
      { workspace: wsName, path: '../../outside.txt' },
      CTX
    )
    expect(evil.ok).toBe(false)
    expect(evil.error).toMatch(/越出|越界/)
  })

  it('decompile_search 非法工作区软失败', async () => {
    const r = await tool('decompile_search').execute({ workspace: 'D:/not-a-workspace', query: 'x' }, CTX)
    expect(r.ok).toBe(false)
  })

  it('decompile_start 源 jar 不存在时软失败', async () => {
    const r = await tool('decompile_start').execute({ jarPath: 'D:/no/such.jar' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })

  it('decompile_start 缺 jarPath 拒绝', async () => {
    const r = await tool('decompile_start').execute({}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('jarPath')
  })
})
