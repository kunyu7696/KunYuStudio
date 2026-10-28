/**
 * MC 皮肤格式编解码 golden 测试（B5-4）。
 *
 * 核心不变量：
 * - 区域 UV 正确性：以头部 8³ 校验 ModelBox 六面区域（front=8..16 / back=24..32 /
 *   右=0..8 / 左=16..24 / 上=8..16 / 下=16..24 @v0..16），slim 手臂收窄后区域随之变化；
 * - 往返：skinToDocument → documentToSkin 在被覆盖区域逐像素等于输入，未覆盖像素透明
 *   （现代 64×64 / slim 64×64 / 经典 64×32 三态）；
 * - 降级告警：legacy 左肢复用右肢矩形（info）、其余区域缺失跳过（info）、
 *   顶层非立方体跳过、部件未匹配、贴图像素未解析、面 UV 缺失、无贴图、重复同名。
 */
import { describe, expect, it } from 'vitest'
import { addNode, addTexture, createCubeNode, createDocument, createGroupNode, validateDocument } from '../document'
import { FACE_NAMES } from '../types'
import type { CubeNode, FaceName, ModelTexture } from '../types'
import {
  SKIN_ATLAS_WIDTH,
  SKIN_PARTS,
  documentToSkin,
  skinBoxFaceRects,
  skinToDocument
} from '../formats/skin'

/* ------------------------------------------------------------------ */
/* 测试替身：像素串 ↔ 贴图 data（合成 key，非真实 PNG）                  */
/* ------------------------------------------------------------------ */

/** 确定性像素图（全不透明，避免与「未覆盖 = 透明」的期望混淆） */
function makePixels(w: number, h: number): string[] {
  const out: string[] = []
  for (let i = 0; i < w * h; i++) out.push(`#${(i & 0xffffff).toString(16).padStart(6, '0')}`)
  return out
}

interface PixelStore {
  map: Map<string, string[]>
  encodePixels: (px: string[], w: number, h: number) => string
  resolvePixels: (tex: ModelTexture) => string[] | null
}

function makeStore(): PixelStore {
  const map = new Map<string, string[]>()
  let n = 0
  return {
    map,
    encodePixels: (px, w, h) => {
      const key = `png:${w}x${h}:${n++}`
      map.set(key, px)
      return key
    },
    resolvePixels: (tex) => map.get(tex.data) ?? null
  }
}

/** 皮肤区域覆盖掩码（与 codec 的 partFits 同判定：区域整体落画布才计入） */
function coverage(slim: boolean, legacy: boolean): boolean[] {
  const W = SKIN_ATLAS_WIDTH
  const H = legacy ? 32 : 64
  const cov = new Array<boolean>(W * H).fill(false)
  for (const part of SKIN_PARTS) {
    const size = slim && part.slimSize ? part.slimSize : part.size
    const rects = skinBoxFaceRects(part.texOffs, size)
    let fits = true
    for (const f of FACE_NAMES) {
      const r = rects[f]
      if (r[2] > W || r[3] > H) fits = false
    }
    if (!fits) continue
    for (const f of FACE_NAMES) {
      const [x1, y1, x2, y2] = rects[f]
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) cov[y * W + x] = true
    }
  }
  return cov
}

/** 断言往返：out 在被覆盖区域等于 input，未覆盖像素为 '' */
function expectRoundTrip(legacy: boolean, slim: boolean): void {
  const store = makeStore()
  const W = SKIN_ATLAS_WIDTH
  const H = legacy ? 32 : 64
  const input = makePixels(W, H)
  const { doc, downgrades } = skinToDocument(W, H, input, {
    encodePixels: store.encodePixels,
    slim,
    now: 1000
  })
  expect(validateDocument(doc)).toEqual([])
  expect(doc.formatData?.skin).toEqual({ kind: 'skin', slim, legacy })
  // 导入不得因尺寸/像素问题报 warning（legacy 缺区域是 info）
  expect(downgrades.filter((d) => d.severity === 'warning')).toEqual([])

  const { output } = documentToSkin(doc, { resolvePixels: store.resolvePixels })
  expect(output.width).toBe(W)
  expect(output.height).toBe(H)
  const cov = coverage(slim, legacy)
  const mism: number[] = []
  for (let i = 0; i < W * H; i++) {
    const want = cov[i] ? input[i] : ''
    if (output.pixels[i] !== want) mism.push(i)
  }
  expect(mism.slice(0, 8)).toEqual([])
}

/* ------------------------------------------------------------------ */
/* 区域 UV                                                             */
/* ------------------------------------------------------------------ */

describe('skinBoxFaceRects 区域推导', () => {
  it('头部 8³ = 原版皮肤模板六面区域（front/back/右/左/上/下）', () => {
    const r = skinBoxFaceRects([0, 0], [8, 8, 8])
    expect(r.north).toEqual([8, 8, 16, 16]) // front
    expect(r.south).toEqual([24, 8, 32, 16]) // back
    expect(r.east).toEqual([0, 8, 8, 16]) // 模型右侧
    expect(r.west).toEqual([16, 8, 24, 16]) // 模型左侧
    expect(r.up).toEqual([8, 0, 16, 8])
    expect(r.down).toEqual([16, 0, 24, 8])
  })

  it('右臂 texOffs(40,16)：经典 4 宽占 u40..56，slim 3 宽占 u40..54', () => {
    const classic = skinBoxFaceRects([40, 16], [4, 12, 4])
    expect(classic.north).toEqual([44, 20, 48, 32])
    expect(classic.south).toEqual([52, 20, 56, 32])
    const slim = skinBoxFaceRects([40, 16], [3, 12, 4])
    expect(slim.north).toEqual([44, 20, 47, 32])
    expect(slim.south).toEqual([51, 20, 54, 32]) // 右侧 2 像素留白
  })

  it('部件表 §12 项与 texOffs/尺寸一致（回归守卫）', () => {
    const byName = new Map(SKIN_PARTS.map((p) => [p.name, p]))
    expect([...byName.keys()]).toEqual([
      'head',
      'hat',
      'body',
      'jacket',
      'rightArm',
      'rightSleeve',
      'leftArm',
      'leftSleeve',
      'rightLeg',
      'rightPants',
      'leftLeg',
      'leftPants'
    ])
    expect(byName.get('head')!.texOffs).toEqual([0, 0])
    expect(byName.get('hat')!.texOffs).toEqual([32, 0])
    expect(byName.get('body')!.texOffs).toEqual([16, 16])
    expect(byName.get('leftArm')!.texOffs).toEqual([32, 48])
    expect(byName.get('leftPants')!.texOffs).toEqual([0, 48])
  })
})

/* ------------------------------------------------------------------ */
/* 往返                                                                */
/* ------------------------------------------------------------------ */

describe('皮肤往返（导入 → 导出）', () => {
  it('现代 64×64 经典：被覆盖区域逐像素保持，未覆盖透明', () => {
    expectRoundTrip(false, false)
  })

  it('现代 64×64 slim：手臂区域随 3 宽收窄，往返全等', () => {
    expectRoundTrip(false, true)
  })

  it('经典 64×32 legacy：可用区域往返全等', () => {
    expectRoundTrip(true, false)
  })

  it('slim 覆盖掩码与经典不同（回归守卫：宽度变化确被计入）', () => {
    const classic = coverage(false, false)
    const slim = coverage(true, false)
    expect(classic).not.toEqual(slim)
    expect(classic.filter(Boolean).length).toBeGreaterThan(slim.filter(Boolean).length)
  })

  it('legacy 覆盖掩码小于现代（16×16 行区不存在）', () => {
    const modern = coverage(false, false)
    const legacy = coverage(false, true)
    expect(legacy.filter(Boolean).length).toBeLessThan(modern.filter(Boolean).length)
  })
})

/* ------------------------------------------------------------------ */
/* 导入降级                                                            */
/* ------------------------------------------------------------------ */

describe('skinToDocument 降级', () => {
  it('legacy：左肢复用右肢矩形（info），其余缺失区域跳过（info）', () => {
    const store = makeStore()
    const { doc, downgrades } = skinToDocument(64, 32, makePixels(64, 32), {
      encodePixels: store.encodePixels
    })
    const reused = downgrades.filter((d) => d.code === 'legacy_region_reused').map((d) => d.message)
    expect(reused.some((m) => m.includes('leftArm'))).toBe(true)
    expect(reused.some((m) => m.includes('leftLeg'))).toBe(true)
    const missing = downgrades.filter((d) => d.code === 'legacy_region_missing')
    expect(missing.length).toBe(5) // jacket / rightSleeve / rightPants / leftSleeve / leftPants
    expect(downgrades.every((d) => d.severity === 'info')).toBe(true)

    // 左肢存在且复用右肢矩形；jacket/rightSleeve 等 overlay 不存在
    const names = doc.root.map((id) => doc.nodes[id]!.name)
    expect(names).toContain('leftArm')
    expect(names).not.toContain('jacket')
    expect(names).not.toContain('rightSleeve')
    const leftArm = doc.nodes[doc.root.find((id) => doc.nodes[id]!.name === 'leftArm')!] as CubeNode
    const rightArm = doc.nodes[doc.root.find((id) => doc.nodes[id]!.name === 'rightArm')!] as CubeNode
    expect(leftArm.faces.north?.uv).toEqual(rightArm.faces.north?.uv)
  })

  it('生成 12 部件 + 1 贴图，逐面 uv 绑定该贴图（现代 64×64）', () => {
    const store = makeStore()
    const { doc } = skinToDocument(64, 64, makePixels(64, 64), { encodePixels: store.encodePixels })
    expect(doc.root.length).toBe(12)
    expect(Object.keys(doc.textures)).toEqual(['skin'])
    expect(doc.textures.skin!.width).toBe(64)
    const body = doc.nodes[doc.root.find((id) => doc.nodes[id]!.name === 'body')!] as CubeNode
    for (const f of FACE_NAMES) {
      expect(body.faces[f]?.texture).toBe('skin')
      expect(body.faces[f]?.uv).toBeDefined()
    }
    // body 几何（-4..4, 12..24, -2..2）
    expect(body.from).toEqual([-4, 12, -2])
    expect(body.to).toEqual([4, 24, 2])
    // hat 覆盖层外扩 0.5
    const hat = doc.nodes[doc.root.find((id) => doc.nodes[id]!.name === 'hat')!] as CubeNode
    expect(hat.from).toEqual([-4.5, 23.5, -4.5])
    expect(hat.to).toEqual([4.5, 32.5, 4.5])
  })

  it('未注入 encodePixels：贴图 data 为空并告警', () => {
    const { doc, downgrades } = skinToDocument(64, 64, makePixels(64, 64))
    expect(doc.textures.skin!.data).toBe('')
    expect(downgrades.some((d) => d.code === 'pixels_unencoded')).toBe(true)
  })

  it('非法尺寸 / 像素数不符抛错', () => {
    expect(() => skinToDocument(32, 32, [])).toThrow(/皮肤尺寸/)
    expect(() => skinToDocument(64, 64, ['#000000'])).toThrow(/像素数量/)
  })
})

/* ------------------------------------------------------------------ */
/* 导出降级                                                            */
/* ------------------------------------------------------------------ */

/** 只含 head 立方体的文档（六面绑同一贴图，uv = 全贴图） */
function docWithHead(): { doc: ReturnType<typeof createDocument>; store: PixelStore } {
  const store = makeStore()
  let doc = createDocument({ id: 'd1', name: 'x', format: 'free' })
  doc = addTexture(doc, { id: 't', name: 'src', width: 16, height: 16, data: '', visible: true })
  doc.textures.t = { ...doc.textures.t!, data: store.encodePixels(makePixels(16, 16), 16, 16) }
  const head = createCubeNode('head', { from: [-4, 24, -4], to: [4, 32, 4] })
  const faces = {} as Record<FaceName, { uv: [number, number, number, number]; texture: string }>
  for (const f of FACE_NAMES) faces[f] = { uv: [0, 0, 16, 16], texture: 't' }
  head.faces = faces
  doc = addNode(doc, head, null)
  return { doc, store }
}

describe('documentToSkin 导出', () => {
  it('部件未匹配逐条告警，已匹配区域烘焙进图集', () => {
    const { doc, store } = docWithHead()
    const { output, downgrades } = documentToSkin(doc, { resolvePixels: store.resolvePixels })
    expect(output.width).toBe(64)
    expect(output.height).toBe(64)
    expect(downgrades.filter((d) => d.code === 'part_unmapped').length).toBe(11)
    expect(downgrades.some((d) => d.code === 'cube_not_mapped')).toBe(false)
    // head 的 front 区域已写入（非透明）
    const r = skinBoxFaceRects([0, 0], [8, 8, 8]).north
    expect(output.pixels[r[1] * 64 + r[0]]).not.toBe('')
  })

  it('未注入 resolvePixels：逐面 pixels_unresolved（warning），区域保持透明', () => {
    const { doc } = docWithHead()
    const { output, downgrades } = documentToSkin(doc)
    const unresolved = downgrades.filter((d) => d.code === 'pixels_unresolved')
    expect(unresolved.length).toBe(6)
    expect(unresolved.every((d) => d.severity === 'warning')).toBe(true)
    const r = skinBoxFaceRects([0, 0], [8, 8, 8]).north
    expect(output.pixels[r[1] * 64 + r[0]]).toBe('')
  })

  it('顶层非立方体（组）跳过（info），未映射立方体逐条告警', () => {
    const { doc, store } = docWithHead()
    const withGroup = addNode(doc, createGroupNode('bone'), null)
    const { downgrades } = documentToSkin(withGroup, { resolvePixels: store.resolvePixels })
    expect(downgrades.some((d) => d.code === 'node_skipped')).toBe(true)
  })

  it('重复同名部件仅用第一个（info）', () => {
    const { doc, store } = docWithHead()
    const dup = createCubeNode('head', { from: [-4, 24, -4], to: [4, 32, 4] })
    const withDup = addNode(doc, dup, null)
    const { downgrades } = documentToSkin(withDup, { resolvePixels: store.resolvePixels })
    expect(downgrades.some((d) => d.code === 'duplicate_part')).toBe(true)
  })

  it('面缺 UV / 未绑贴图逐面告警', () => {
    const { doc } = docWithHead()
    const head = doc.nodes[doc.root[0]!] as CubeNode
    delete head.faces.north
    head.faces.south = { uv: [0, 0, 16, 16] } // 无 texture
    const { downgrades } = documentToSkin(doc)
    expect(downgrades.some((d) => d.code === 'face_uv_missing')).toBe(true)
    expect(downgrades.some((d) => d.code === 'face_texture_missing')).toBe(true)
  })

  it('导出 legacy 时区域缺失部件跳过（info），右肢矩形仍写入', () => {
    const { doc, store } = docWithHead()
    const { output, downgrades } = documentToSkin(doc, { legacy: true, resolvePixels: store.resolvePixels })
    expect(output.height).toBe(32)
    const missing = downgrades.filter((d) => d.code === 'legacy_region_missing').map((d) => d.message)
    expect(missing.some((m) => m.includes('head'))).toBe(false) // head 存在于经典画布
    expect(missing.length).toBeGreaterThan(0)
    const r = skinBoxFaceRects([0, 0], [8, 8, 8]).north
    expect(output.pixels[r[1] * 32 + r[0]]).not.toBe('')
  })

  it('formatData.skin 决定默认 slim/legacy（覆盖选项优先）', () => {
    const { doc, store } = docWithHead()
    const slimDoc = { ...doc, formatData: { skin: { kind: 'skin', slim: true, legacy: false } } }
    const viaMeta = documentToSkin(slimDoc, { resolvePixels: store.resolvePixels })
    expect(viaMeta.output.pixels.length).toBe(4096)

    const legacyDoc = { ...doc, formatData: { skin: { kind: 'skin', slim: false, legacy: true } } }
    const viaLegacyMeta = documentToSkin(legacyDoc, { resolvePixels: store.resolvePixels })
    expect(viaLegacyMeta.output.height).toBe(32)
    const viaOverride = documentToSkin(legacyDoc, { legacy: false, resolvePixels: store.resolvePixels })
    expect(viaOverride.output.height).toBe(64)
  })
})
