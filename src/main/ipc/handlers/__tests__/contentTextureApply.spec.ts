/**
 * content:texture-apply-candidate 单测（聊天「产物」卡点选候选后写回资产）：
 * - model：写 pixels + textureSize 并物化 PNG
 * - item：texture.path 为空 → 写 pixels 并物化 PNG；path 非空 → 只写 pixels（pngWritten:false）
 * - block：与 item 同规则，PNG 落 textures/block/<id>.png；32 画布拒绝
 * - 入参非法（根路径/类型/id/像素长度）时一律 ok:false，不落盘
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() }
}))

import { ipcMain } from 'electron'
import { IpcChannels } from '../../../../shared/types/ipc'
import type { TextureApplyCandidateResponse } from '../../../../shared/types/ipc'
import type { ModelAsset } from '../../../../shared/types/content'
import { createDefaultBlock } from '../../../../shared/schemas/block.schema'
import { createDefaultItem } from '../../../../shared/schemas/item.schema'
import { registerContentHandlers } from '../contentHandlers'
import { saveContent } from '../../../services/contentService'
import { registerProjectRoot, unregisterProjectRoot } from '../../../services/fsService'

let root: string
let apply: (root: string, kind: unknown, id: unknown, pixels: unknown, size: unknown) =>
  Promise<TextureApplyCandidateResponse>

/** 建一个合法的最小 Cube 模型资产 */
function crateModel(): ModelAsset {
  return {
    kind: 'model',
    id: 'crate',
    displayName: 'Crate',
    description: '',
    textureSize: 16,
    pixels: Array.from({ length: 256 }, () => ''),
    textures: { all: 'textures/model/crate.png' },
    createdAt: 0,
    updatedAt: 0,
    elements: [
      {
        name: '立方体 1',
        from: [0, 0, 0],
        to: [16, 16, 16],
        shade: true,
        faces: {
          down: { uv: [0, 0, 16, 16], texture: 'all' },
          up: { uv: [0, 0, 16, 16], texture: 'all' },
          north: { uv: [0, 0, 16, 16], texture: 'all' },
          south: { uv: [0, 0, 16, 16], texture: 'all' },
          west: { uv: [0, 0, 16, 16], texture: 'all' },
          east: { uv: [0, 0, 16, 16], texture: 'all' }
        }
      }
    ]
  }
}

function pixels256(color = '#ff0000'): string[] {
  return Array.from({ length: 256 }, (_, i) => (i % 2 === 0 ? color : ''))
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, rel), 'utf-8').replace(/^\ufeff/, '')) as Record<
    string,
    unknown
  >
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-tac-'))
  registerProjectRoot(root)
  mkdirSync(join(root, 'src/main/resources'), { recursive: true })
  writeFileSync(join(root, 'src/main/resources/fabric.mod.json'), JSON.stringify({ id: 'testmod' }))
  writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.test\n')

  const map = new Map<string, (...a: unknown[]) => unknown>()
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, fn: (...a: unknown[]) => unknown) => {
    map.set(channel, fn)
  }) as never)
  registerContentHandlers({} as never)
  const fn = map.get(IpcChannels.CONTENT_TEXTURE_APPLY_CANDIDATE)
  expect(fn).toBeTruthy()
  // 捕获到的是完整 handler：首个入参是 IpcMainInvokeEvent
  apply = (r, kind, id, px, size) =>
    fn!({} as never, r, kind, id, px, size) as Promise<TextureApplyCandidateResponse>
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('content:texture-apply-candidate', () => {
  it('model：写像素 + textureSize 并物化 PNG', async () => {
    saveContent(root, crateModel())
    const res = await apply(root, 'model', 'crate', pixels256(), 16)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.pngWritten).toBe(true)
    expect(res.relPath).toBe('textures/model/crate.png')
    expect(existsSync(join(root, 'src/main/resources/assets/testmod/textures/model/crate.png'))).toBe(
      true
    )
    const saved = readJson('.kunyu/content/models/crate.json')
    expect(saved.textureSize).toBe(16)
    expect((saved.pixels as string[]).filter((p) => p !== '').length).toBe(128)
  })

  it('item（texture.path 为空）：写像素并物化 PNG', async () => {
    saveContent(root, createDefaultItem('ruby', 'simple'))
    const res = await apply(root, 'item', 'ruby', pixels256('#00ff00'), 16)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.pngWritten).toBe(true)
    expect(res.relPath).toBe('textures/item/ruby.png')
    expect(existsSync(join(root, 'src/main/resources/assets/testmod/textures/item/ruby.png'))).toBe(
      true
    )
    const saved = readJson('.kunyu/content/items/ruby.json') as {
      texture: { pixels?: string[] }
    }
    expect(saved.texture.pixels?.length).toBe(256)
  })

  it('item（texture.path 非空）：只写像素，PNG 仍由生成阶段产出（pngWritten:false）', async () => {
    const item = createDefaultItem('ruby', 'simple')
    item.texture.path = 'textures/item/custom_ruby.png'
    saveContent(root, item)
    const res = await apply(root, 'item', 'ruby', pixels256(), 16)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.pngWritten).toBe(false)
    expect(res.relPath).toBe('textures/item/custom_ruby.png')
    expect(existsSync(join(root, 'src/main/resources/assets/testmod/textures/item/ruby.png'))).toBe(
      false
    )
    const saved = readJson('.kunyu/content/items/ruby.json') as { texture: { pixels?: string[] } }
    expect(saved.texture.pixels?.length).toBe(256)
  })

  it('block（texture.path 为空）：写 texture.pixels 并物化 textures/block/<id>.png', async () => {
    saveContent(root, createDefaultBlock('ruby_ore'))
    const res = await apply(root, 'block', 'ruby_ore', pixels256('#3366ff'), 16)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.pngWritten).toBe(true)
    expect(res.relPath).toBe('textures/block/ruby_ore.png')
    expect(
      existsSync(join(root, 'src/main/resources/assets/testmod/textures/block/ruby_ore.png'))
    ).toBe(true)
    const saved = readJson('.kunyu/content/blocks/ruby_ore.json') as {
      texture: { pixels?: string[] }
    }
    expect(saved.texture.pixels?.length).toBe(256)
  })

  it('block（texture.path 非空）：只写像素；32 画布一律拒绝（方块贴图契约 16×16）', async () => {
    const block = createDefaultBlock('ruby_ore')
    block.texture.path = 'textures/block/custom_ore.png'
    saveContent(root, block)
    const res = await apply(root, 'block', 'ruby_ore', pixels256(), 16)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.pngWritten).toBe(false)
    expect(res.relPath).toBe('textures/block/custom_ore.png')
    expect(
      existsSync(join(root, 'src/main/resources/assets/testmod/textures/block/ruby_ore.png'))
    ).toBe(false)

    const big = await apply(
      root,
      'block',
      'ruby_ore',
      Array.from({ length: 1024 }, () => '#000000'),
      32
    )
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.errorMessage).toContain('16×16')
  })

  it('入参非法一律拒绝且不落盘', async () => {
    saveContent(root, crateModel())
    expect((await apply('', 'model', 'crate', pixels256(), 16)).ok).toBe(false)
    // 白名单外类型（entity 不可写回贴图像素）
    expect((await apply(root, 'entity', 'crate', pixels256(), 16)).ok).toBe(false)
    expect((await apply(root, 'model', '', pixels256(), 16)).ok).toBe(false)
    // 像素长度与尺寸不匹配
    const bad = await apply(root, 'model', 'crate', pixels256().slice(0, 100), 16)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errorMessage).toContain('256')
    // 类型不匹配（资产存在但不是 model）
    saveContent(root, createDefaultItem('gem', 'simple'))
    const wrong = await apply(root, 'model', 'gem', pixels256(), 16)
    expect(wrong.ok).toBe(false)
    // 资产不存在
    expect((await apply(root, 'model', 'nope', pixels256(), 16)).ok).toBe(false)
  })

  it('32×32：尺寸合法时长度须为 1024', async () => {
    const model = crateModel()
    model.textureSize = 32
    model.pixels = Array.from({ length: 1024 }, () => '')
    saveContent(root, model)
    expect((await apply(root, 'model', 'crate', pixels256(), 32)).ok).toBe(false)
    const res = await apply(root, 'model', 'crate', Array.from({ length: 1024 }, () => '#123456'), 32)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.size).toBe(32)
    expect(readJson('.kunyu/content/models/crate.json').textureSize).toBe(32)
  })
})
