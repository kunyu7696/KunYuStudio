/**
 * Cube 模型编译器（M12）：ModelAsset 语义 JSON ⇄ Minecraft 原版模型 JSON / PNG。
 *
 * 本文件全部为纯函数（仅依赖 node 内置 zlib/crypto），可直接 vitest。
 * - compileModelToMcJson：语义模型 → 原版模型 JSON 对象（T2）
 * - validateModel：结构校验诊断（T2）
 * - pixelsToPng：像素画数据 → 最小合法 RGBA PNG（无第三方依赖）
 */
import { deflateSync } from 'node:zlib'
import type {
  CubeElement,
  CubeFaceName,
  ModelAsset
} from '../../shared/types/content'
import { CUBE_FACES } from '../../shared/types/content'
import {
  FACE_ROTATIONS,
  isLegalRotationAngle,
  type Vec3
} from '../../shared/utils/modelMath'
import { parsePixel } from '../../shared/utils/pixelColor'

/* ------------------------------------------------------------------ */
/* 语义模型 → 原版模型 JSON                                             */
/* ------------------------------------------------------------------ */

/** 原版模型 JSON（仅包含本工具产出的字段，宽松记录便于序列化） */
export interface McModelJson {
  parent?: string
  ambientocclusion?: boolean
  texture_size?: [number, number]
  textures: Record<string, string>
  elements: Record<string, unknown>[]
  display?: ModelAsset['display']
}

/** assets 相对路径（textures/model/x.png）→ 原版纹理引用（modid:model/x） */
export function toTextureRef(modId: string, relPath: string): string {
  const stripped = relPath.replace(/^textures\//, '').replace(/\.png$/i, '')
  return `${modId}:${stripped}`
}

/**
 * 编译为 Minecraft 原版模型 JSON 对象（字段映射，无结构转换）。
 * - faces.texture 加 `#` 前缀；textures 值加 `<modId>:` 前缀
 * - 剔面（faces 缺键）保持缺键；name/shade=true 等默认值不输出
 * - textureSize 非 16 时输出 texture_size
 * - 不输出 parent：parent 链顶为 builtin/generated（item/generated、item/handheld）时，
 *   ModelLoader 会走 ItemModelGenerator 从 layer0 重新生成几何并丢弃 elements，
 *   导致 cube 物品模型全场景隐形。手持朝向用 applyItemHeldDisplay 内联 display 替代
 */
export function compileModelToMcJson(model: ModelAsset, modId: string): McModelJson {
  const textures: Record<string, string> = {}
  for (const [variable, rel] of Object.entries(model.textures)) {
    textures[variable] = toTextureRef(modId, rel)
  }
  // particle 贴图兜底：原版粒子/破坏动效引用，缺失时回退到主贴图
  if (!textures.particle && textures.all) textures.particle = textures.all

  const elements = model.elements.map((el) => {
    const out: Record<string, unknown> = {
      from: roundVec(el.from),
      to: roundVec(el.to)
    }
    if (el.rotation) {
      const rot: Record<string, unknown> = {
        origin: roundVec(el.rotation.origin),
        axis: el.rotation.axis,
        angle: el.rotation.angle
      }
      if (el.rotation.rescale) rot.rescale = true
      out.rotation = rot
    }
    if (el.shade === false) out.shade = false
    const faces: Record<string, unknown> = {}
    for (const face of CUBE_FACES) {
      const f = el.faces[face]
      if (!f) continue
      const faceOut: Record<string, unknown> = {
        uv: f.uv.map((n) => Math.round(n * 1000) / 1000),
        texture: `#${f.texture}`
      }
      if (f.rotation) faceOut.rotation = f.rotation
      faces[face] = faceOut
    }
    out.faces = faces
    return out
  })

  const json: McModelJson = { textures, elements }
  if (model.ambientOcclusion === false) json.ambientocclusion = false
  if (model.textureSize !== 16) json.texture_size = [model.textureSize, model.textureSize]
  if (model.display && Object.keys(model.display).length > 0) json.display = model.display
  return json
}

/* ------------------------------------------------------------------ */
/* 物品手持 display（替代 parent: item/handheld）                        */
/* ------------------------------------------------------------------ */

type DisplaySlot = { rotation?: Vec3; translation?: Vec3; scale?: Vec3 }

/**
 * 原版 item/generated + item/handheld 的全部 display 槽位合并值
 * （1.20.1 原版 assets/minecraft/models/item/handheld.json 与其父 item/generated.json）。
 * cube 物品模型内联这些值即可获得与原版工具一致的手持/GUI 朝向，无需 parent 继承
 */
export const ITEM_HELD_DISPLAY: Record<string, DisplaySlot> = {
  thirdperson_righthand: { rotation: [0, -90, 55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
  thirdperson_lefthand: { rotation: [0, 90, -55], translation: [0, 4, 0.5], scale: [0.85, 0.85, 0.85] },
  firstperson_righthand: { rotation: [0, -90, 25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
  firstperson_lefthand: { rotation: [0, 90, -25], translation: [1.13, 3.2, 1.13], scale: [0.68, 0.68, 0.68] },
  gui: { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] },
  ground: { rotation: [0, 0, 0], translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
  fixed: { rotation: [0, 0, 0], translation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
  head: { rotation: [0, 180, 0], translation: [0, 13, 7], scale: [1, 1, 1] }
}

/**
 * 为物品模型 JSON 内联手持 display：槽位级浅合并，用户模型自带的 display 槽位覆盖默认值。
 * 武器等大模型只需在 display 里写要覆盖的槽位（如 thirdperson_righthand 放大）
 */
export function applyItemHeldDisplay(
  json: McModelJson,
  display?: ModelAsset['display']
): McModelJson {
  const merged: Record<string, DisplaySlot> = { ...ITEM_HELD_DISPLAY }
  for (const [slot, value] of Object.entries(display ?? {})) {
    if (value) merged[slot] = { ...merged[slot], ...value }
  }
  json.display = merged as McModelJson['display']
  return json
}

function roundVec(v: Vec3): Vec3 {
  return [Math.round(v[0] * 1000) / 1000, Math.round(v[1] * 1000) / 1000, Math.round(v[2] * 1000) / 1000]
}

/* ------------------------------------------------------------------ */
/* 结构校验（供保存前提示 / 大师 Agent 诊断）                            */
/* ------------------------------------------------------------------ */

export interface ModelDiagnostic {
  severity: 'error' | 'warning'
  /** 机器可读代码 */
  code: string
  message: string
  elementIndex?: number
  face?: CubeFaceName
}

export function validateModel(model: ModelAsset): ModelDiagnostic[] {
  const diags: ModelDiagnostic[] = []
  const size = model.textureSize

  if (size !== 16 && size !== 32) {
    diags.push({ severity: 'error', code: 'texture_size', message: `不支持的贴图尺寸：${size}（仅 16/32）` })
  }
  if (!Array.isArray(model.pixels) || model.pixels.length !== size * size) {
    /* B2-1 flipbook：带动画的资产允许竖直帧条（长度 = size² × 帧数，≥2 帧） */
    const isStrip =
      Array.isArray(model.pixels) &&
      !!model.textureAnimation &&
      model.pixels.length % (size * size) === 0 &&
      model.pixels.length >= size * size * 2
    if (!isStrip) {
      diags.push({
        severity: 'error',
        code: 'pixels_length',
        message: `像素数据长度应为 ${size * size}，实际 ${Array.isArray(model.pixels) ? model.pixels.length : '非数组'}`
      })
    }
  }
  if (!Array.isArray(model.elements) || model.elements.length === 0) {
    diags.push({ severity: 'error', code: 'no_elements', message: '模型至少需要一个立方体元素' })
    return diags
  }

  model.elements.forEach((el, i) => validateElement(el, i, model, diags))
  return diags
}

function validateElement(
  el: CubeElement,
  index: number,
  model: ModelAsset,
  diags: ModelDiagnostic[]
): void {
  const label = `立方体「${el.name || index + 1}」`

  for (let axis = 0; axis < 3; axis++) {
    const axisName = ['X', 'Y', 'Z'][axis]
    const a = el.from[axis]
    const b = el.to[axis]
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
      diags.push({ severity: 'error', code: 'coord_nan', message: `${label} 的 ${axisName} 轴坐标不是数字`, elementIndex: index })
      continue
    }
    if (a < 0 || a > 16 || b < 0 || b > 16) {
      diags.push({ severity: 'error', code: 'coord_range', message: `${label} 的 ${axisName} 轴坐标超出 0-16`, elementIndex: index })
    }
    if (a > b) {
      diags.push({ severity: 'error', code: 'coord_order', message: `${label} 的 ${axisName} 轴 from 大于 to`, elementIndex: index })
    }
  }

  if (el.rotation) {
    const r = el.rotation
    if (!isLegalRotationAngle(r.angle)) {
      diags.push({
        severity: 'error',
        code: 'rotation_angle',
        message: `${label} 的旋转角 ${r.angle} 不合法（需为 22.5° 倍数且在 ±45° 内）`,
        elementIndex: index
      })
    }
    if (r.origin.some((n) => typeof n !== 'number' || n < -16 || n > 32)) {
      diags.push({ severity: 'error', code: 'rotation_origin', message: `${label} 的旋转原点异常`, elementIndex: index })
    }
  }

  const faceNames = Object.keys(el.faces) as CubeFaceName[]
  for (const face of faceNames) {
    const f = el.faces[face]
    if (!f) continue
    if (!(f.texture in model.textures)) {
      diags.push({
        severity: 'error',
        code: 'unknown_texture',
        message: `${label} 的${face}面引用了未定义的贴图变量「${f.texture}」`,
        elementIndex: index,
        face
      })
    }
    const [u1, v1, u2, v2] = f.uv
    for (const n of [u1, v1, u2, v2]) {
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        diags.push({ severity: 'error', code: 'uv_nan', message: `${label} 的${face}面 UV 不是数字`, elementIndex: index, face })
      }
    }
    if ([u1, v1, u2, v2].some((n) => n < 0 || n > model.textureSize)) {
      diags.push({
        severity: 'error',
        code: 'uv_range',
        message: `${label} 的${face}面 UV [${f.uv.join(', ')}] 超出贴图范围 0-${model.textureSize}`,
        elementIndex: index,
        face
      })
    }
    if (u2 <= u1 || v2 <= v1) {
      diags.push({
        severity: 'warning',
        code: 'uv_order',
        message: `${label} 的${face}面 UV 终点不大于起点，该面可能不可见`,
        elementIndex: index,
        face
      })
    }
    if (f.rotation !== undefined && !FACE_ROTATIONS.includes(f.rotation as (typeof FACE_ROTATIONS)[number])) {
      diags.push({
        severity: 'error',
        code: 'face_rotation',
        message: `${label} 的${face}面旋转角必须是 0/90/180/270`,
        elementIndex: index,
        face
      })
    }
  }

  if (faceNames.length === 0) {
    diags.push({
      severity: 'warning',
      code: 'all_faces_culled',
      message: `${label} 的六个面全部被剔除，游戏内不可见`,
      elementIndex: index
    })
  }
}

export function hasModelError(diags: ModelDiagnostic[]): boolean {
  return diags.some((d) => d.severity === 'error')
}

/* ------------------------------------------------------------------ */
/* 像素 → PNG（最小 RGBA 编码器）                                       */
/* ------------------------------------------------------------------ */

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** 宽松解析像素值：容忍省略 '#' 的旧写法；非法/空返回 null（渲染为全透明） */
function pixelOf(value: string): { r: number; g: number; b: number; a: number } | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v) return null
  return parsePixel(v.startsWith('#') ? v : `#${v}`)
}

/**
 * 把行优先像素数组编码为 PNG（8-bit RGBA）。
 * @param pixels 长度 size²；'' = 透明，'#rrggbb' = 不透明，'#rrggbbaa' = 带透明度
 * @param size 正方形边长
 */
export function pixelsToPng(pixels: string[], size: number): Buffer {
  return pixelsToPngRect(pixels, size, size)
}

/**
 * 把行优先像素数组编码为非正方形 PNG（8-bit RGBA，材质编辑器 GUI 176×166 等）。
 * @param pixels 长度 width*height；'' = 透明，'#rrggbb' / '#rrggbbaa'（大小写不限）
 */
export function pixelsToPngRect(pixels: string[], width: number, height: number): Buffer {
  if (pixels.length !== width * height) {
    throw new Error(`像素数量 ${pixels.length} 与画布尺寸 ${width}×${height} 不符`)
  }
  // IHDR：宽、高、位深 8、颜色类型 6（RGBA）、压缩 0、滤镜 0、隔行 0
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // 原始扫描线：每行前置 filter 字节 0
  const raw = Buffer.alloc((width * 4 + 1) * height)
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0
    for (let x = 0; x < width; x++) {
      const hex = pixels[y * width + x]
      const c = pixelOf(hex)
      if (c) {
        raw[p++] = c.r
        raw[p++] = c.g
        raw[p++] = c.b
        raw[p++] = c.a
        continue
      }
      raw[p++] = 0
      raw[p++] = 0
      raw[p++] = 0
      raw[p++] = 0
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}
