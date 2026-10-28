/**
 * texture_paint 贴图落盘单测（run#9 零贴图回归）：
 * - 语义资产不存在时不再报「先 content_upsert」，直接物化 PNG 到约定路径
 *   （model → assets/<modid>/textures/model/<id>.png；item → textures/item/<id>.png）
 * - 语义资产已存在时同步更新像素画并物化 PNG
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

let root: string
let registry: ToolRegistry

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-tp-'))
  registerProjectRoot(root)
  mkdirSync(join(root, 'src/main/resources'), { recursive: true })
  writeFileSync(join(root, 'src/main/resources/fabric.mod.json'), JSON.stringify({ id: 'testmod' }))
  writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.test\n')
  registry = createToolRegistry({ projectRoot: () => root })
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

async function paint(args: Record<string, unknown>): Promise<ToolResult> {
  return registry.executeTool('texture_paint', args, CTX)
}

describe('texture_paint · 落盘闭环', () => {
  it('语义资产不存在：kind=model 直出 PNG 到 textures/model/<id>.png', async () => {
    const r = await paint({ kind: 'model', id: 'solar_furnace_side', shape: 'blob', primary: '#5A5F63' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('textures/model/solar_furnace_side.png')
    const png = join(root, 'src/main/resources/assets/testmod/textures/model/solar_furnace_side.png')
    expect(existsSync(png)).toBe(true)
    // PNG 魔数
    expect(readFileSync(png).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true)
  })

  it('语义资产不存在：kind=item 直出 PNG 到 textures/item/<id>.png', async () => {
    const r = await paint({ kind: 'item', id: 'ruby', shape: 'gem', primary: '#c41e3a' })
    expect(r.ok).toBe(true)
    expect(existsSync(join(root, 'src/main/resources/assets/testmod/textures/item/ruby.png'))).toBe(true)
  })

  it('语义资产已存在：更新像素画并物化 PNG', async () => {
    // 先 content_upsert 建模型骨架（合法最小模型：createTemplateModel 结构）
    const up = await registry.executeTool(
      'content_upsert',
      {
        content: {
          kind: 'model',
          id: 'crate',
          displayName: 'Crate',
          description: '',
          textureSize: 16,
          pixels: Array.from({ length: 256 }, () => ''),
          textures: { all: 'textures/model/crate.png' },
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
      },
      CTX
    )
    expect(up.ok).toBe(true)

    const r = await paint({ kind: 'model', id: 'crate', shape: 'ingot', primary: '#8b5a2b' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('保存到 model/crate')
    expect(existsSync(join(root, 'src/main/resources/assets/testmod/textures/model/crate.png'))).toBe(true)
    // 语义资产里的像素画也被更新（非全空）
    const saved = JSON.parse(
      readFileSync(join(root, '.kunyu/content/models/crate.json'), 'utf-8').replace(/^﻿/, '')
    ) as { pixels: string[] }
    expect(saved.pixels.some((p) => p !== '')).toBe(true)
  })

  it('shape 非法仍拒绝；id 含大写/非法字符时落盘校验拦截', async () => {
    expect((await paint({ kind: 'model', id: 'x', shape: 'nope', primary: '#fff' })).ok).toBe(false)
    const r = await paint({ kind: 'model', id: 'Bad_Id!', shape: 'blob', primary: '#5A5F63' })
    expect(r.ok).toBe(false)
  })
})
