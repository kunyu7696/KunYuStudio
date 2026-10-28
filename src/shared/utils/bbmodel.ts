/**
 * Blockbench .bbmodel ↔ 我们的 Cube 模型语义资产双向转换（建模工坊 B1）。
 *
 * 坐标/UV 体系与 Minecraft 模型 JSON 一致（Blockbench 同体系）：
 * - from/to：0..16 立方体角点；face uv：[u1,v1,u2,v2] 贴图像素坐标
 * - 差异仅在：旋转表示（BB 三轴角度数组 → MC 单轴 {axis,angle,origin}）、
 *   贴图引用（BB 是 textures 数组下标 → MC 是 "#变量名"）
 *
 * 纯函数，不解析 PNG（嵌入贴图以 data URL 原样返回，由主进程服务解码填 pixels）。
 */
import type {
  CubeElement,
  CubeFace,
  CubeFaceName,
  ModelAsset,
  RotationAxis
} from '../types/content'
import type { TemplatedModelAsset } from '../schemas/model.schema'

const FACES: CubeFaceName[] = ['north', 'south', 'east', 'west', 'up', 'down']

/** Blockbench 4.x 文档最小结构（仅取转换所需字段） */
export interface BbmodelTexture {
  path?: string
  name?: string
  /** data:image/png;base64,...（Blockbench 内嵌贴图） */
  origin?: string
  id?: string
  visible?: boolean
}

export interface BbmodelFace {
  uv?: [number, number, number, number]
  /** textures 数组下标；null = 无贴图 */
  texture?: number | null
  rotation?: 0 | 90 | 180 | 270
}

export interface BbmodelElement {
  name?: string
  from?: [number, number, number]
  to?: [number, number, number]
  /** 旋转中心，默认 [8,8,8] */
  origin?: [number, number, number]
  /** 三轴角度（度）；MC 仅能表达单轴 */
  rotation?: [number, number, number]
  rescale?: boolean
  faces?: Partial<Record<CubeFaceName, BbmodelFace>>
}

export interface BbmodelDoc {
  meta?: { format_version?: string; model_format?: string }
  box_uv?: boolean
  resolution?: { width: number; height: number }
  elements?: BbmodelElement[]
  textures?: BbmodelTexture[]
  name?: string
}

export interface BbmodelConversion {
  /** 转换得到的模型资产（pixels 为空画布，嵌入贴图由服务层解码回填） */
  model: TemplatedModelAsset
  /** 转换降级告警（多轴旋转被取舍、缺 UV 等），展示给用户 */
  warnings: string[]
  /** 文档内嵌贴图 data URL（按下标） */
  embeddedTextures: string[]
}

function isNum3(v: unknown): v is [number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/** bbmodel 虽声明四元组，实际来自外部 JSON，运行时仍需校验 */
function isNum4(v: unknown): v is [number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/** 角度吸附到 22.5° 倍数并限制 ±45（MC 原版约束） */
function snapAngle(deg: number): number {
  const snapped = Math.round(deg / 22.5) * 22.5
  return Math.max(-45, Math.min(45, snapped))
}

/**
 * 导入 bbmodel。id 为目标资产 id；调用方随后可用 normalizeModelSchema 校验。
 * 多轴旋转只保留绝对值最大的轴；缺 UV 的面按立方体尺寸补默认整图 UV。
 */
export function bbmodelToAsset(doc: BbmodelDoc, id: string): BbmodelConversion {
  const warnings: string[] = []
  if (!doc || typeof doc !== 'object') throw new Error('bbmodel 不是合法对象')
  const rawElements = Array.isArray(doc.elements) ? doc.elements : []
  if (rawElements.length === 0) throw new Error('bbmodel 中没有任何元素（elements 为空）')

  const resolution = doc.resolution ?? { width: 16, height: 16 }
  const textureSize: 16 | 32 = resolution.width >= 32 || resolution.height >= 32 ? 32 : 16
  const textures = Array.isArray(doc.textures) ? doc.textures : []
  const embeddedTextures = textures
    .map((t) => (typeof t.origin === 'string' && t.origin.startsWith('data:') ? t.origin : ''))
  // 贴图下标 → 变量名：0 → all，其余 → layerN
  const variableOf = (texIndex: number): string => (texIndex === 0 ? 'all' : `layer${texIndex}`)
  const usedVariables = new Set<string>()

  const elements: CubeElement[] = rawElements.map((el, idx) => {
    if (!isNum3(el.from) || !isNum3(el.to)) {
      throw new Error(`元素 ${idx + 1} 缺少合法的 from/to（必须是 3 个数字）`)
    }
    const faces: Partial<Record<CubeFaceName, CubeFace>> = {}
    for (const faceName of FACES) {
      const f = el.faces?.[faceName]
      if (!f) continue // 缺面 = 剔除
      const texIndex = typeof f.texture === 'number' && f.texture >= 0 ? f.texture : 0
      const variable = variableOf(texIndex)
      usedVariables.add(variable)
      let uv: [number, number, number, number]
      if (!isNum4(f.uv)) {
        // BB box_uv 模型常省略每面 UV：回退整图 [0,0,size,size]
        uv = [0, 0, textureSize, textureSize]
        warnings.push(`元素「${el.name ?? idx + 1}」的 ${faceName} 面缺少 UV，已回退为整图映射`)
      } else {
        uv = f.uv
      }
      faces[faceName] = {
        uv: [uv[0], uv[1], uv[2], uv[3]],
        texture: variable,
        ...(f.rotation === 90 || f.rotation === 180 || f.rotation === 270 ? { rotation: f.rotation } : {})
      }
    }
    if (Object.keys(faces).length === 0) {
      warnings.push(`元素「${el.name ?? idx + 1}」没有任何面，将不可见`)
    }

    const element: CubeElement = {
      name: el.name || `立方体 ${idx + 1}`,
      from: [el.from[0], el.from[1], el.from[2]],
      to: [el.to[0], el.to[1], el.to[2]],
      faces
    }

    const rot = el.rotation
    if (isNum3(rot) && rot.some((a) => Math.abs(a) > 0.001)) {
      const axes: RotationAxis[] = ['x', 'y', 'z']
      let dominant = 0
      for (let i = 1; i < 3; i++) {
        if (Math.abs(rot[i]) > Math.abs(rot[dominant])) dominant = i
      }
      const others = axes.filter((_, i) => i !== dominant && Math.abs(rot[i]) > 0.001)
      if (others.length > 0) {
        warnings.push(
          `元素「${element.name}」含多轴旋转，Minecraft 仅支持单轴：已保留 ${axes[dominant].toUpperCase()} 轴，丢弃 ${others
            .map((a) => a.toUpperCase())
            .join('/')} 轴旋转`
        )
      }
      element.rotation = {
        origin: isNum3(el.origin) ? [el.origin[0], el.origin[1], el.origin[2]] : [8, 8, 8],
        axis: axes[dominant],
        angle: snapAngle(rot[dominant]),
        ...(el.rescale ? { rescale: true } : {})
      }
    }
    return element
  })

  if (usedVariables.size === 0) usedVariables.add('all')
  const texPath = `textures/model/${id || 'imported_model'}.png`
  const textureMap: Record<string, string> = {}
  for (const v of usedVariables) textureMap[v] = texPath

  const now = Date.now()
  const model: TemplatedModelAsset = {
    kind: 'model',
    template: 'custom',
    id,
    displayName: doc.name || id,
    description: '',
    textureSize,
    pixels: Array.from({ length: textureSize * textureSize }, () => ''),
    textures: textureMap,
    elements,
    ambientOcclusion: true,
    createdAt: now,
    updatedAt: now
  }
  return { model, warnings, embeddedTextures }
}

/**
 * 导出 bbmodel（Blockbench 4.5 格式）。
 * 单贴图内嵌：textureDataUrl 为空时 Blockbench 显示为缺失贴图（几何仍可编辑）。
 */
export function assetToBbmodel(model: ModelAsset, textureDataUrl?: string): BbmodelDoc {
  const texId = 'kunyu-tex-0'
  const bbElements: BbmodelElement[] = model.elements.map((el) => {
    const faces: Partial<Record<CubeFaceName, BbmodelFace>> = {}
    for (const faceName of FACES) {
      const f = el.faces[faceName]
      if (!f) continue
      // 我们只导出单贴图（下标 0）；多变量模型统一映射到 0
      faces[faceName] = {
        uv: [f.uv[0], f.uv[1], f.uv[2], f.uv[3]],
        texture: 0,
        ...(f.rotation ? { rotation: f.rotation } : {})
      }
    }
    const out: BbmodelElement = {
      name: el.name,
      from: [el.from[0], el.from[1], el.from[2]],
      to: [el.to[0], el.to[1], el.to[2]],
      origin: [8, 8, 8],
      faces
    }
    if (el.rotation) {
      const r = el.rotation
      out.origin = [r.origin[0], r.origin[1], r.origin[2]]
      out.rotation =
        r.axis === 'x' ? [r.angle, 0, 0] : r.axis === 'y' ? [0, r.angle, 0] : [0, 0, r.angle]
      if (r.rescale) out.rescale = true
    }
    return out
  })

  const textures: BbmodelTexture[] = [
    {
      path: '',
      name: `${model.id}.png`,
      origin: textureDataUrl ?? '',
      id: texId,
      visible: true
    }
  ]

  return {
    meta: {
      format_version: '4.5',
      model_format: 'free'
    },
    box_uv: false,
    name: model.displayName || model.id,
    resolution: { width: model.textureSize, height: model.textureSize },
    elements: bbElements,
    textures
  }
}

/* ------------------------------------------------------------------ */
/* GeckoLib / Bedrock 动画（P2 骨骼动画实体）                              */
/* ------------------------------------------------------------------ */

/** bedrock/GeckoLib 关键帧表：时间字符串 → [x,y,z] */
export type GeckoKeyframeMap = Record<string, [number, number, number]>

export interface GeckoBoneAnim {
  /** catmullrom 平滑（正弦采样关键帧需要）；缺省 linear */
  lerp_mode?: 'catmullrom' | 'linear'
  rotation?: GeckoKeyframeMap
  position?: GeckoKeyframeMap
  scale?: GeckoKeyframeMap
}

export interface GeckoAnimation {
  /** true=循环；'hold_on_last_frame'=定格末帧；缺省=播放一次 */
  loop?: boolean | 'hold_on_last_frame'
  animation_length?: number
  bones?: Record<string, GeckoBoneAnim>
}

/** .animation.json 顶层结构 */
export interface GeckoAnimationFile {
  format_version: '1.8.0'
  animations: Record<string, GeckoAnimation>
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** 时间点 → bedrock 键名字符串（0 / 0.5 / 1） */
function timeKey(t: number): string {
  return String(round3(t))
}

/** 数值三元组（molang 字符串等非法值返回 null） */
function vec3Of(raw: unknown): [number, number, number] | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const x = Number(o.x)
  const y = Number(o.y)
  const z = Number(o.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [round3(x), round3(y), round3(z)]
}

/** Blockbench 动画文档最小结构（animations + outliner 骨骼名映射） */
export interface BbmodelAnimator {
  name?: string
  keyframes?: {
    channel?: string
    time?: number
    interpolation?: string
    data_points?: unknown[]
  }[]
}

export interface BbmodelAnimation {
  uuid?: string
  name?: string
  loop?: 'once' | 'loop' | 'hold'
  length?: number
  animators?: Record<string, BbmodelAnimator>
}

export interface BbmodelOutlinerNode {
  uuid?: string
  name?: string
  children?: BbmodelOutlinerNode[]
}

/** bbmodel 动画 → GeckoLib animation.json 动画表（骨骼名/关键帧/插值映射） */
export function bbmodelToGeckolibAnimations(
  doc: BbmodelDoc & { animations?: BbmodelAnimation[]; outliner?: BbmodelOutlinerNode[] },
  entityId: string
): { animations: Record<string, GeckoAnimation>; warnings: string[] } {
  const warnings: string[] = []
  const out: Record<string, GeckoAnimation> = {}
  const rawList = Array.isArray(doc.animations) ? doc.animations : []
  if (rawList.length === 0) return { animations: out, warnings }

  // outliner uuid → 骨骼名（animator 的键是骨骼 uuid，bbmodel 另存 name 兜底）
  const boneNameByUuid = new Map<string, string>()
  const walkOutliner = (nodes: BbmodelOutlinerNode[]): void => {
    for (const n of nodes) {
      if (n.uuid && n.name) boneNameByUuid.set(n.uuid, n.name)
      if (Array.isArray(n.children)) walkOutliner(n.children)
    }
  }
  if (Array.isArray(doc.outliner)) walkOutliner(doc.outliner)

  for (const anim of rawList) {
    const rawName = (anim.name ?? '').trim() || 'animation.unnamed'
    // Blockbench 导出名可能已带 animation.<id>. 前缀；裸名则补全
    const name = rawName.includes('.') ? rawName : `animation.${entityId}.${rawName}`
    const target: GeckoAnimation = {}
    if (anim.loop === 'loop') target.loop = true
    else if (anim.loop === 'hold') target.loop = 'hold_on_last_frame'
    if (typeof anim.length === 'number' && Number.isFinite(anim.length) && anim.length > 0) {
      target.animation_length = round3(anim.length)
    }
    const bones: Record<string, GeckoBoneAnim> = {}
    for (const [uuid, animator] of Object.entries(anim.animators ?? {})) {
      const boneName = boneNameByUuid.get(uuid) ?? animator?.name ?? ''
      if (!boneName) {
        warnings.push(`动画「${rawName}」的骨骼 ${uuid} 无法解析名称，已跳过`)
        continue
      }
      const bone: GeckoBoneAnim = {}
      let usesCatmullrom = false
      for (const kf of animator.keyframes ?? []) {
        const channel = kf.channel
        if (channel !== 'rotation' && channel !== 'position' && channel !== 'scale') continue
        const t = typeof kf.time === 'number' && Number.isFinite(kf.time) ? kf.time : 0
        const points = Array.isArray(kf.data_points) ? kf.data_points : []
        if (points.length === 0) continue
        if (points.length > 1) {
          warnings.push(`动画「${rawName}」骨骼「${boneName}」含多数据点关键帧，仅取首点`)
        }
        const vec = vec3Of(points[0])
        if (!vec) {
          warnings.push(`动画「${rawName}」骨骼「${boneName}」含 molang/非数值关键帧，已跳过`)
          continue
        }
        if (kf.interpolation === 'catmullrom') usesCatmullrom = true
        else if (kf.interpolation === 'step') {
          warnings.push(`动画「${rawName}」骨骼「${boneName}」的 step 插值降级为 linear`)
        }
        const map = (bone[channel] ??= {})
        map[timeKey(t)] = vec
      }
      if (usesCatmullrom) bone.lerp_mode = 'catmullrom'
      if (bone.rotation || bone.position || bone.scale) bones[boneName] = bone
    }
    if (Object.keys(bones).length > 0) target.bones = bones
    out[name] = target
  }
  return { animations: out, warnings }
}

/* ------------------------------------------------------------------ */
/* 参数化 idle/walk/attack 模板（geo 骨骼名驱动）                          */
/* ------------------------------------------------------------------ */

export interface GeckoTemplateAnimOptions {
  /** 摆幅倍率（默认 1） */
  amplitude?: number
  /** 速度倍率（默认 1；越大动画周期越短） */
  speed?: number
}

/** .geo.json 摘要：骨骼名列表 + 贴图尺寸（texture_paint/占位贴图用） */
export interface GeoModelInfo {
  boneNames: string[]
  textureWidth: number
  textureHeight: number
}

/** 解析 Blockbench GeckoLib .geo.json 文本；不合法时抛错 */
export function parseGeoModelInfo(geoJson: string): GeoModelInfo {
  let doc: unknown
  try {
    doc = JSON.parse(geoJson)
  } catch {
    throw new Error('geoJson 不是合法 JSON')
  }
  const entries = (doc as Record<string, unknown>)?.['minecraft:geometry']
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('geoJson 缺少 minecraft:geometry 数组（不是 Blockbench 几何导出）')
  }
  const boneNames: string[] = []
  let textureWidth = 64
  let textureHeight = 64
  entries.forEach((entry, i) => {
    const desc = (entry as Record<string, unknown>)?.description as
      | Record<string, unknown>
      | undefined
    if (i === 0 && desc) {
      const w = Number(desc.texture_width)
      const h = Number(desc.texture_height)
      if (Number.isFinite(w) && w > 0) textureWidth = w
      if (Number.isFinite(h) && h > 0) textureHeight = h
    }
    const bones = (entry as Record<string, unknown>)?.bones
    if (Array.isArray(bones)) {
      for (const b of bones) {
        const n = (b as Record<string, unknown>)?.name
        if (typeof n === 'string' && n) boneNames.push(n)
      }
    }
  })
  return { boneNames, textureWidth, textureHeight }
}

/** 正弦采样一个周期的 5 点旋转关键帧（仅 X 轴），catmullrom 平滑播放 */
function sineKeysX(deg: number, length: number, phase = 0): GeckoKeyframeMap {
  const out: GeckoKeyframeMap = {}
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    out[timeKey(p * length)] = [Math.round(deg * Math.sin((p + phase) * Math.PI * 2) * 100) / 100, 0, 0]
  }
  return out
}

function lowerBones(bones: string[]): { raw: string; low: string }[] {
  return bones.map((b) => ({ raw: b, low: b.toLowerCase() }))
}

/**
 * 按骨骼名参数化生成 idle/walk/attack 三件套（P2 首期：内置人形/四足两套模板）。
 * - 人形（≥2 arm 且 ≥2 leg）：walk 四肢对摆，attack 右臂挥击；
 * - 四足（≥4 leg 且无 arm）：walk 对角步态，attack 头部撕咬；
 * - 兜底（无法归类）：所有骨骼轻摆 idle，walk/attack 省略（避免怪异抽动）。
 */
export function buildTemplateAnimations(
  boneNames: string[],
  entityId: string,
  opts: GeckoTemplateAnimOptions = {}
): Record<string, GeckoAnimation> {
  const amplitude = opts.amplitude && opts.amplitude > 0 ? opts.amplitude : 1
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1
  const bones = lowerBones(boneNames)
  const legs = bones.filter((b) => b.low.includes('leg'))
  const arms = bones.filter((b) => b.low.includes('arm'))
  const head = bones.find((b) => b.low.includes('head'))
  const body = bones.find((b) => /(^|_)(body|torso)($|_)/.test(b.low))

  const animations: Record<string, GeckoAnimation> = {}
  const idleLen = round3(2 / speed)
  const walkLen = round3(1 / speed)
  const attackLen = round3(0.5 / speed)

  // idle：头部轻摆 + 躯干呼吸浮动（无头则第一根骨骼代摆）
  const idleBones: Record<string, GeckoBoneAnim> = {}
  const swayBone = head ?? body ?? bones[0]
  if (swayBone) {
    idleBones[swayBone.raw] = {
      lerp_mode: 'catmullrom',
      rotation: sineKeysX(4 * amplitude, idleLen)
    }
  }
  if (body) {
    idleBones[body.raw] = {
      lerp_mode: 'catmullrom',
      position: {
        [timeKey(0)]: [0, 0, 0],
        [timeKey(idleLen / 2)]: [0, Math.round(-0.4 * amplitude * 100) / 100, 0],
        [timeKey(idleLen)]: [0, 0, 0]
      }
    }
  }
  animations[`animation.${entityId}.idle`] = {
    loop: true,
    animation_length: idleLen,
    bones: idleBones
  }

  if (arms.length >= 2 && legs.length >= 2) {
    // 人形 walk：同侧腿臂反相，左右相差半周期
    const walkBones: Record<string, GeckoBoneAnim> = {}
    legs.forEach((leg, i) => {
      walkBones[leg.raw] = {
        lerp_mode: 'catmullrom',
        rotation: sineKeysX(25 * amplitude, walkLen, i % 2 === 0 ? 0 : 0.5)
      }
    })
    arms.forEach((arm, i) => {
      walkBones[arm.raw] = {
        lerp_mode: 'catmullrom',
        rotation: sineKeysX(20 * amplitude, walkLen, i % 2 === 0 ? 0.5 : 0)
      }
    })
    animations[`animation.${entityId}.walk`] = {
      loop: true,
      animation_length: walkLen,
      bones: walkBones
    }
    // 人形 attack：右臂（取含 right 者，否则首条）挥击 0→-90→20→0
    const strikeArm = arms.find((a) => a.low.includes('right')) ?? arms[0]
    animations[`animation.${entityId}.attack`] = {
      animation_length: attackLen,
      bones: {
        [strikeArm.raw]: {
          rotation: {
            [timeKey(0)]: [0, 0, 0],
            [timeKey(attackLen * 0.4)]: [-90 * amplitude, 0, 0],
            [timeKey(attackLen * 0.7)]: [20 * amplitude, 0, 0],
            [timeKey(attackLen)]: [0, 0, 0]
          }
        }
      }
    }
  } else if (arms.length === 0 && legs.length >= 4) {
    // 四足 walk：对角步态（0/3 相、1/2 反相）
    const walkBones: Record<string, GeckoBoneAnim> = {}
    legs.forEach((leg, i) => {
      walkBones[leg.raw] = {
        lerp_mode: 'catmullrom',
        rotation: sineKeysX(25 * amplitude, walkLen, i % 4 === 0 || i % 4 === 3 ? 0 : 0.5)
      }
    })
    animations[`animation.${entityId}.walk`] = {
      loop: true,
      animation_length: walkLen,
      bones: walkBones
    }
    // 四足 attack：头部撕咬（无头则首条腿前踢）
    const biteBone = head ?? legs[0]
    animations[`animation.${entityId}.attack`] = {
      animation_length: attackLen,
      bones: {
        [biteBone.raw]: {
          rotation: {
            [timeKey(0)]: [0, 0, 0],
            [timeKey(attackLen * 0.4)]: [25 * amplitude, 0, 0],
            [timeKey(attackLen * 0.7)]: [-15 * amplitude, 0, 0],
            [timeKey(attackLen)]: [0, 0, 0]
          }
        }
      }
    }
  }
  return animations
}

/** 组装完整 .animation.json 文档 */
export function geckoAnimationFile(
  animations: Record<string, GeckoAnimation>
): GeckoAnimationFile {
  return { format_version: '1.8.0', animations }
}
