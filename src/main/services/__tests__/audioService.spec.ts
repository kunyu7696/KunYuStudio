/**
 * 音效工坊主进程服务测试。
 * 覆盖：FFmpeg URL 镜像排序、工具状态、sounds.json 解析/序列化往返、
 * 事件注册/注销、音效删除联动、声音库引用映射、目标解析（模组/资源包）。
 * 不触发真实下载与 FFmpeg 转码（网络与外部进程由集成验证）。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-audio-test-'))
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

import {
  buildFfmpegUrls,
  ffmpegStatus,
  listAudioLibrary,
  parseSoundsJson,
  readSoundEvents,
  registerSoundEvent,
  removeSound,
  resolveAudioTarget,
  serializeSoundsJson,
  unregisterSoundEvent
} from '../audioService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { initResourcePack } from '../resourcepackService'

let projectRoot: string

/** 建一个最小 Fabric 模组项目骨架（resolveModContext 可识别） */
function makeModProject(root: string, modId = 'testmod'): void {
  const res = join(root, 'src', 'main', 'resources')
  mkdirSync(res, { recursive: true })
  writeFileSync(join(res, 'fabric.mod.json'), JSON.stringify({ id: modId, entrypoints: {} }))
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'kunyu-audio-proj-'))
  registerProjectRoot(projectRoot)
})

afterEach(() => {
  unregisterProjectRoot(projectRoot)
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('buildFfmpegUrls', () => {
  it('china 镜像优先 gyan.dev，official 优先 BtbN', () => {
    expect(buildFfmpegUrls('china')[0]).toContain('gyan.dev')
    expect(buildFfmpegUrls('official')[0]).toContain('github.com/BtbN')
    expect(buildFfmpegUrls('china')).toHaveLength(2)
  })
})

describe('ffmpegStatus', () => {
  it('未安装时 installed=false 且路径指向 userData/tools/ffmpeg/bin', () => {
    const st = ffmpegStatus()
    expect(st.installed).toBe(false)
    expect(st.path.replace(/\\/g, '/')).toContain('tools/ffmpeg/bin/ffmpeg.exe')
  })
})

describe('sounds.json 解析与序列化', () => {
  it('字符串与对象条目混排均可解析，subtitle 透传', () => {
    const events = parseSoundsJson(
      JSON.stringify({
        'mymod.chime': { sounds: ['mymod:chime_1', { name: 'mymod:chime_2' }], subtitle: 'sub.x' },
        'mymod.empty': { sounds: [] }
      })
    )
    expect(events).toEqual([
      { name: 'mymod.chime', sounds: ['mymod:chime_1', 'mymod:chime_2'], subtitle: 'sub.x' },
      { name: 'mymod.empty', sounds: [] }
    ])
  })

  it('序列化→解析往返一致（对象条目形式输出，事件名排序）', () => {
    const src = [
      { name: 'b.ev', sounds: ['mymod:x'], subtitle: 'sub.b' },
      { name: 'a.ev', sounds: ['mymod:y', 'mymod:z'] }
    ]
    const round = parseSoundsJson(serializeSoundsJson(src))
    expect(round).toEqual([
      { name: 'a.ev', sounds: ['mymod:y', 'mymod:z'] },
      { name: 'b.ev', sounds: ['mymod:x'], subtitle: 'sub.b' }
    ])
  })

  it('顶层非对象抛错；带 BOM 可解析', () => {
    expect(() => parseSoundsJson('[1,2]')).toThrow('顶层必须是对象')
    expect(parseSoundsJson('﻿' + JSON.stringify({}))).toEqual([])
  })
})

describe('resolveAudioTarget', () => {
  it('模组项目解析到 src/main/resources/assets/<modid>', () => {
    makeModProject(projectRoot)
    const t = resolveAudioTarget(projectRoot)
    expect(t.namespace).toBe('testmod')
    expect(t.soundsRelDir).toBe('assets/testmod/sounds')
  })

  it('独立资源包项目解析到项目根 assets/<namespace>', () => {
    initResourcePack(
      projectRoot,
      { name: 'p', mcVersion: '1.20.1', description: 'd', namespace: 'mypack' },
      'standalone'
    )
    const t = resolveAudioTarget(projectRoot)
    expect(t.namespace).toBe('mypack')
    expect(t.soundsDir).toBe(join(projectRoot, 'assets', 'mypack', 'sounds'))
  })

  it('无模组描述文件也无 pack.mcmeta 时抛错', () => {
    expect(() => resolveAudioTarget(projectRoot)).toThrow('未识别的项目结构')
  })
})

describe('事件注册与声音库', () => {
  beforeEach(() => {
    makeModProject(projectRoot)
    const soundsDir = join(projectRoot, 'src', 'main', 'resources', 'assets', 'testmod', 'sounds')
    mkdirSync(soundsDir, { recursive: true })
    writeFileSync(join(soundsDir, 'chime.ogg'), Buffer.from([1, 2, 3]))
    writeFileSync(join(soundsDir, 'hit.ogg'), Buffer.from([4, 5]))
  })

  it('注册事件：裸 stem 自动补命名空间前缀，写盘可读回', () => {
    registerSoundEvent(projectRoot, { name: 'ui.chime', sounds: ['chime'], subtitle: 'sub.ui' })
    const events = readSoundEvents(projectRoot)
    expect(events).toEqual([{ name: 'ui.chime', sounds: ['testmod:chime'], subtitle: 'sub.ui' }])
  })

  it('同名事件覆盖更新；注销后消失', () => {
    registerSoundEvent(projectRoot, { name: 'ui.chime', sounds: ['chime'] })
    registerSoundEvent(projectRoot, { name: 'ui.chime', sounds: ['hit'] })
    expect(readSoundEvents(projectRoot)[0]!.sounds).toEqual(['testmod:hit'])
    unregisterSoundEvent(projectRoot, 'ui.chime')
    expect(readSoundEvents(projectRoot)).toEqual([])
  })

  it('非法事件名 / 空引用被拒', () => {
    expect(() => registerSoundEvent(projectRoot, { name: 'Bad Name', sounds: ['chime'] })).toThrow(
      '事件名不合法'
    )
    expect(() => registerSoundEvent(projectRoot, { name: 'ok.ev', sounds: [] })).toThrow(
      '至少引用一个'
    )
  })

  it('listAudioLibrary 建立文件→事件引用映射', () => {
    registerSoundEvent(projectRoot, { name: 'ui.chime', sounds: ['chime'] })
    const lib = listAudioLibrary(projectRoot)
    expect(lib.namespace).toBe('testmod')
    expect(lib.files.map((f) => f.stem).sort()).toEqual(['chime', 'hit'])
    expect(lib.files.find((f) => f.stem === 'chime')!.events).toEqual(['ui.chime'])
    expect(lib.files.find((f) => f.stem === 'hit')!.events).toEqual([])
  })

  it('removeSound 删除文件并摘除事件引用（事件保留）', () => {
    registerSoundEvent(projectRoot, { name: 'ui.chime', sounds: ['chime', 'hit'] })
    removeSound(projectRoot, 'chime')
    const lib = listAudioLibrary(projectRoot)
    expect(lib.files.map((f) => f.stem)).toEqual(['hit'])
    expect(lib.events[0]).toEqual({ name: 'ui.chime', sounds: ['testmod:hit'] })
  })

  it('非法 stem 被拒（防路径穿越）', () => {
    expect(() => removeSound(projectRoot, '../evil')).toThrow('不合法')
  })
})
