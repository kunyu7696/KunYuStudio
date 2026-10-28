/**
 * audioTools 单测：声音库列举、事件注册/注销、入参与项目门控。
 * 不触发 FFmpeg 下载与转码（外部进程由集成验证）。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-au-tool-test-'))
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

import { builtinAudioTools } from '../fcTools/audioTools'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import type { ToolExecContext, ToolRegistryDeps } from '../toolRegistry'

const CTX: ToolExecContext = { loader: 'fabric', mcVersion: '1.20.1' }

let root: string
let deps: ToolRegistryDeps

/** 最小 Fabric 模组项目骨架（resolveModContext 可识别） */
function makeModProject(dir: string, modId = 'testmod'): void {
  const res = join(dir, 'src', 'main', 'resources')
  mkdirSync(res, { recursive: true })
  writeFileSync(join(res, 'fabric.mod.json'), JSON.stringify({ id: modId, entrypoints: {} }))
}

function tool(name: string) {
  return builtinAudioTools(deps).find((t) => t.def.function.name === name)!
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-au-proj-'))
  registerProjectRoot(root)
  makeModProject(root)
  deps = { projectRoot: () => root }
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('audioTools', () => {
  it('项目未打开时拒绝', async () => {
    deps.projectRoot = () => null
    const r = await tool('audio_list_library').execute({}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有打开的项目')
  })

  it('空库列出命名空间与零计数', async () => {
    const r = await tool('audio_list_library').execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('testmod')
    expect(r.text).toContain('0 个')
  })

  it('注册事件后列表可见；注销后消失', async () => {
    const reg = await tool('audio_register_event').execute(
      { name: 'testmod.chime', sounds: ['chime_1'], subtitle: 'sub.chime' },
      CTX
    )
    expect(reg.ok).toBe(true)
    const lib = await tool('audio_list_library').execute({}, CTX)
    expect(lib.text).toContain('testmod.chime')
    expect(lib.text).toContain('testmod:chime_1')
    const un = await tool('audio_unregister_event').execute({ name: 'testmod.chime' }, CTX)
    expect(un.ok).toBe(true)
    const lib2 = await tool('audio_list_library').execute({}, CTX)
    expect(lib2.text).not.toContain('testmod.chime')
  })

  it('注册入参校验：缺 name / 空 sounds / 非法事件名', async () => {
    const noName = await tool('audio_register_event').execute({ sounds: ['a'] }, CTX)
    expect(noName.ok).toBe(false)
    expect(noName.error).toContain('name')
    const noSounds = await tool('audio_register_event').execute({ name: 'testmod.x', sounds: [] }, CTX)
    expect(noSounds.ok).toBe(false)
    expect(noSounds.error).toContain('sounds')
    const badName = await tool('audio_register_event').execute({ name: 'BAD NAME', sounds: ['a'] }, CTX)
    expect(badName.ok).toBe(false)
    expect(badName.error).toContain('不合法')
  })
})
