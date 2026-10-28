/**
 * texture_repaint 候选上报单测：
 * - 默认一次出 4 张候选（此前未传 n，repaintTexture 默认只出 1 张，画廊必然空）
 * - variants[0] 仍照旧写回资产（全流程自动化不破）
 * - 全部候选经 ctx.reportArtifact 上报为 kind=texture-candidates 的 artifact，供聊天「产物」卡展示
 * - 显式 candidates=1 时只出 1 张；未注入 reportArtifact（集成桥/直调）时不抛错
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRepaint } = vi.hoisted(() => ({ mockRepaint: vi.fn() }))
vi.mock('../textureRepaint', () => ({ repaintTexture: mockRepaint }))

import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import type { AgentArtifact } from '../../../../shared/types/agent'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

let root: string
let registry: ToolRegistry
let captured: AgentArtifact[]

/** 伪候选：256 项像素 + 小 PNG data URL + 调色板 + ASCII + sourceToken */
function fakeVariant(color: string): Record<string, unknown> {
  return {
    pixels: Array.from({ length: 256 }, (_, k) => (k % 2 === 0 ? color : '')),
    dataUrl: 'data:image/png;base64,AAAA',
    palette: [color, '#ffffff'],
    ascii: '##\n##',
    sourceToken: `tex-${color}`
  }
}

function stubRepaint(count: number): void {
  mockRepaint.mockResolvedValue({
    ok: true,
    data: {
      size: 16,
      model: 'fake-image-model',
      warnings: [],
      variants: Array.from({ length: count }, (_, i) => fakeVariant(i === 0 ? '#ff0000' : '#0000ff'))
    }
  })
}

/** 建一个合法的最小 Cube 模型骨架作为贴图目标 */
async function seedModel(): Promise<void> {
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
}

function run(args: Record<string, unknown>, ctx: Record<string, unknown> = {}): Promise<ToolResult> {
  return registry.executeTool('texture_repaint', args, { ...CTX, ...ctx })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-tr-'))
  registerProjectRoot(root)
  mkdirSync(join(root, 'src/main/resources'), { recursive: true })
  writeFileSync(join(root, 'src/main/resources/fabric.mod.json'), JSON.stringify({ id: 'testmod' }))
  writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.test\n')
  registry = createToolRegistry({ projectRoot: () => root })
  captured = []
  mockRepaint.mockReset()
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('texture_repaint · 候选上报', () => {
  it('默认出 4 张候选并全部上报，variants[0] 照旧写回资产', async () => {
    stubRepaint(4)
    await seedModel()
    const r = await run({ kind: 'model', id: 'crate', prompt: '寒冰符文' }, {
      toolCallId: 'call-1',
      reportArtifact: (a: AgentArtifact) => captured.push(a)
    })
    expect(r.ok).toBe(true)
    // 默认张数：不再只出 1 张
    expect((mockRepaint.mock.calls[0][0] as { n: number }).n).toBe(4)
    expect((r.data as { variantCount: number }).variantCount).toBe(4)
    expect(r.text).toContain('4 个候选')

    // 全部候选进 artifact
    expect(captured.length).toBe(1)
    const art = captured[0]
    expect(art.kind).toBe('texture-candidates')
    expect(art.id).toBe('tex-cand-call-1')
    expect(art.title).toContain('贴图候选 · model/crate（4 个）')
    const set = art.textureCandidates
    expect(set?.assetKind).toBe('model')
    expect(set?.assetId).toBe('crate')
    expect(set?.size).toBe(16)
    expect(set?.appliedIndex).toBe(1)
    expect(set?.variants.length).toBe(4)
    expect(set?.variants[0].index).toBe(1)
    expect(set?.variants[0].dataUrl).toContain('data:image/png')
    expect(set?.variants[0].pixels.length).toBe(256)
    expect(set?.variants[0].colorCount).toBe(2)
    expect(set?.variants[0].sourceToken).toBe('tex-#ff0000')

    // 第 1 张仍写回资产（自动化不破）
    const saved = JSON.parse(
      readFileSync(join(root, '.kunyu/content/models/crate.json'), 'utf-8').replace(/^\ufeff/, '')
    ) as { pixels: string[]; textureSize: 16 | 32 }
    expect(saved.textureSize).toBe(16)
    expect(saved.pixels.filter((p) => p !== '').length).toBe(128)
  })

  it('显式 candidates=1 时只出 1 张，返回文本不提示候选', async () => {
    stubRepaint(1)
    await seedModel()
    const r = await run({ kind: 'model', id: 'crate', prompt: '寒冰符文', candidates: 1 }, {
      reportArtifact: (a: AgentArtifact) => captured.push(a)
    })
    expect(r.ok).toBe(true)
    expect((mockRepaint.mock.calls[0][0] as { n: number }).n).toBe(1)
    expect(r.text).not.toContain('个候选已展示')
    expect(captured[0].textureCandidates?.variants.length).toBe(1)
  })

  it('candidates 越界值夹取到 1-4', async () => {
    stubRepaint(1)
    await seedModel()
    await run({ kind: 'model', id: 'crate', prompt: 'x', candidates: 99 })
    expect((mockRepaint.mock.calls[0][0] as { n: number }).n).toBe(4)
    await run({ kind: 'model', id: 'crate', prompt: 'x', candidates: -3 })
    expect((mockRepaint.mock.calls[1][0] as { n: number }).n).toBe(1)
  })

  it('未注入 reportArtifact（集成桥/直调）时正常返回不抛错', async () => {
    stubRepaint(2)
    await seedModel()
    const r = await run({ kind: 'model', id: 'crate', prompt: '寒冰符文' })
    expect(r.ok).toBe(true)
    expect(captured.length).toBe(0)
  })

  it('artifact id 回退到资产 id（无 toolCallId 时）', async () => {
    stubRepaint(1)
    await seedModel()
    await run({ kind: 'model', id: 'crate', prompt: 'x' }, {
      reportArtifact: (a: AgentArtifact) => captured.push(a)
    })
    expect(captured[0].id).toBe('tex-cand-crate')
  })
})
