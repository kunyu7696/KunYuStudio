/**
 * Cube 模型模板系统（建模器重做 P0）。
 *
 * 在既有 ModelAsset 语义资产（content.ts）之上叠加模板层：
 * - 新建模型时按模板预填立方体、贴图变量与 UV，用户只需替换贴图
 * - 模板产出的贴图变量值统一指向 textures/model/<id>.png：
 *   多变量（cube 的六面 / cube_column 的 end/side）共享同一张像素画 PNG，
 *   保证编译产物与 3D 预览立即可用；后续可逐变量导入独立贴图
 * - 不重复定义 Cube 类型，全部复用 content.ts
 */
import {
  CUBE_FACES,
  defaultGuiDisplay,
  validateContentId,
  type CubeElement,
  type CubeFace,
  type CubeFaceName,
  type FaceUv,
  type ModelAsset
} from '../types/content'
import { isLegalRotationAngle } from '../utils/modelMath'
import { formatPixel, parsePixel } from '../utils/pixelColor'
import { sharedT, type SharedLocale } from '../i18n'

/** 模型模板（custom = 空白模型，用户自由拼装） */
export type ModelTemplate =
  | 'cube_all'
  | 'cube'
  | 'cube_column'
  | 'cross'
  | 'slab'
  | 'stairs'
  | 'custom'

function buildModelTemplateOptions(locale?: SharedLocale): {
  value: ModelTemplate
  label: string
  hint: string
}[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'cube_all', label: t('schema.model.templateCubeAll'), hint: t('schema.model.templateCubeAllHint') },
    { value: 'cube', label: t('schema.model.templateCube'), hint: t('schema.model.templateCubeHint') },
    { value: 'cube_column', label: t('schema.model.templateCubeColumn'), hint: t('schema.model.templateCubeColumnHint') },
    { value: 'cross', label: t('schema.model.templateCross'), hint: t('schema.model.templateCrossHint') },
    { value: 'slab', label: t('schema.model.templateSlab'), hint: t('schema.model.templateSlabHint') },
    { value: 'stairs', label: t('schema.model.templateStairs'), hint: t('schema.model.templateStairsHint') },
    { value: 'custom', label: t('schema.model.templateCustom'), hint: t('schema.model.templateCustomHint') }
  ]
}

export const MODEL_TEMPLATE_OPTIONS: {
  value: ModelTemplate
  label: string
  hint: string
}[] = buildModelTemplateOptions()

/** 语言感知版本：组件内 computed(() => getModelTemplateOptions(locale.value)) 使用 */
export function getModelTemplateOptions(locale?: SharedLocale): typeof MODEL_TEMPLATE_OPTIONS {
  return buildModelTemplateOptions(locale)
}

/** 模型语义资产上的模板标记（缺省时由 inferTemplate 推断） */
export type TemplatedModelAsset = ModelAsset & { template?: ModelTemplate }

const FULL_UV: FaceUv = [0, 0, 16, 16]

function face(texture: string, uv: FaceUv = FULL_UV): CubeFace {
  return { uv, texture }
}

function sixFaces(texture: string): Record<CubeFaceName, CubeFace> {
  const faces = {} as Record<CubeFaceName, CubeFace>
  for (const f of CUBE_FACES) faces[f] = face(texture)
  return faces
}

function cube(
  name: string,
  from: [number, number, number],
  to: [number, number, number],
  faces: Partial<Record<CubeFaceName, CubeFace>>,
  rotation?: CubeElement['rotation']
): CubeElement {
  return { name, from, to, shade: true, ...(rotation ? { rotation } : {}), faces }
}

/** 十字薄板（零厚度平面 + Y 轴 ±45° 旋转），4 个侧面 */
function crossPlanes(): CubeElement[] {
  const rotation = (angle: number): CubeElement['rotation'] => ({
    origin: [8, 8, 8],
    axis: 'y',
    angle
  })
  const faces: Partial<Record<CubeFaceName, CubeFace>> = {
    north: face('all'),
    south: face('all'),
    east: face('all'),
    west: face('all')
  }
  return [
    cube('十字板 A', [0.8, 0, 8], [15.2, 16, 8], faces, rotation(45)),
    cube('十字板 B', [0.8, 0, 8], [15.2, 16, 8], faces, rotation(-45))
  ]
}

interface TemplateGeometry {
  /** 贴图变量名 → 变量值（工厂统一为同一张 PNG 路径） */
  textureVars: string[]
  elements: CubeElement[]
}

function templateGeometry(template: ModelTemplate): TemplateGeometry {
  switch (template) {
    case 'cube':
      return {
        textureVars: ['down', 'up', 'north', 'south', 'west', 'east'],
        elements: [
          cube('立方体 1', [0, 0, 0], [16, 16, 16], {
            down: face('down'),
            up: face('up'),
            north: face('north'),
            south: face('south'),
            west: face('west'),
            east: face('east')
          })
        ]
      }
    case 'cube_column':
      return {
        textureVars: ['end', 'side'],
        elements: [
          cube('立柱 1', [0, 0, 0], [16, 16, 16], {
            down: face('end'),
            up: face('end'),
            north: face('side'),
            south: face('side'),
            west: face('side'),
            east: face('side')
          })
        ]
      }
    case 'cross':
      return { textureVars: ['all'], elements: crossPlanes() }
    case 'slab':
      return {
        textureVars: ['all'],
        elements: [cube('下半砖', [0, 0, 0], [16, 8, 16], sixFaces('all'))]
      }
    case 'stairs':
      return {
        textureVars: ['all'],
        elements: [
          cube('踏步基座', [0, 0, 0], [16, 8, 16], sixFaces('all')),
          cube('踏步上层', [8, 8, 0], [16, 16, 8], sixFaces('all'))
        ]
      }
    case 'custom':
      return { textureVars: ['all'], elements: [] }
    case 'cube_all':
    default:
      return {
        textureVars: ['all'],
        elements: [cube('立方体 1', [0, 0, 0], [16, 16, 16], sixFaces('all'))]
      }
  }
}

/** 按模板创建模型资产（默认 cube_all；贴图路径随 id 归一） */
export function createTemplateModel(
  id: string,
  template: ModelTemplate = 'cube_all',
  textureSize: 16 | 32 = 16
): TemplatedModelAsset {
  const geo = templateGeometry(template)
  const now = Date.now()
  const texPath = `textures/model/${id || 'new_model'}.png`
  const textures: Record<string, string> = {}
  for (const variable of geo.textureVars) textures[variable] = texPath
  return {
    kind: 'model',
    template,
    id,
    displayName: id,
    description: '',
    textureSize,
    pixels: Array.from({ length: textureSize * textureSize }, () => ''),
    textures,
    elements: geo.elements,
    ambientOcclusion: true,
    display: { gui: defaultGuiDisplay() },
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 切换模板：重建几何与贴图变量（值统一回落到 id PNG 路径）。
 * 保留 id / 名称 / 描述 / 像素画 / 画布尺寸 / AO / display / 时间戳。
 * 注意：会丢弃当前元素，UI 层必须先取得用户确认。
 */
export function applyTemplate(model: TemplatedModelAsset, template: ModelTemplate): void {
  const geo = templateGeometry(template)
  const texPath = `textures/model/${model.id.trim() || 'new_model'}.png`
  const textures: Record<string, string> = {}
  for (const variable of geo.textureVars) textures[variable] = texPath
  model.template = template
  model.elements = geo.elements
  model.textures = textures
}

/** 缺省模板字段时按几何特征推断（用于旧磁盘模型与 AI upsert 数据） */
export function inferTemplate(model: ModelAsset): ModelTemplate {
  const els = model.elements
  if (!Array.isArray(els)) return 'custom'
  // 已定义的面是否全部绑定同一变量（缺面剔除的十字板同样适用）
  const definedFaceVars = (el: CubeElement): string[] =>
    CUBE_FACES.map((f) => el.faces[f]?.texture).filter((v): v is string => Boolean(v))
  const allFacesUse = (el: CubeElement, variable: string): boolean => {
    const vars = definedFaceVars(el)
    return vars.length > 0 && vars.every((v) => v === variable)
  }
  const isFullCube = (el: CubeElement): boolean =>
    el.from[0] === 0 && el.from[1] === 0 && el.from[2] === 0 &&
    el.to[0] === 16 && el.to[1] === 16 && el.to[2] === 16

  if (els.length === 1) {
    const el = els[0]
    if (isFullCube(el)) {
      if (allFacesUse(el, 'all')) return 'cube_all'
      if (el.faces.up?.texture === 'end' && el.faces.north?.texture === 'side') return 'cube_column'
      if (CUBE_FACES.every((f) => el.faces[f]?.texture === f)) return 'cube'
    }
    if (
      allFacesUse(el, 'all') &&
      el.from[0] === 0 && el.to[0] === 16 &&
      el.from[2] === 0 && el.to[2] === 16 &&
      el.from[1] === 0 && el.to[1] === 8
    ) {
      return 'slab'
    }
  }
  if (els.length === 2 && els.every((el) => Boolean(el.rotation) && allFacesUse(el, 'all'))) {
    return 'cross'
  }
  if (
    els.length === 2 &&
    !els[0].rotation &&
    !els[1].rotation &&
    allFacesUse(els[0], 'all') &&
    allFacesUse(els[1], 'all')
  ) {
    return 'stairs'
  }
  return 'custom'
}

/* ------------------------------------------------------------------ */
/* 归一化 / 校验                                                        */
/* ------------------------------------------------------------------ */

/** 规范化像素值：容忍省略 '#' 的旧写法，保留 8 位透明度，非法值转透明 */
function normalizePixelValue(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const v = raw.trim()
  if (!v) return ''
  const c = parsePixel(v.startsWith('#') ? v : `#${v}`)
  return c ? formatPixel(c) : ''
}

function clampCoord(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.min(16, Math.max(0, n))
}

function round1(n: number): number {
  return Math.round(n * 1000) / 1000
}

function normalizeUv(raw: unknown, size: number): FaceUv {
  const arr = Array.isArray(raw) ? raw : []
  const clampUv = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.min(size, Math.max(0, v)) : fallback
    return round1(n)
  }
  return [clampUv(arr[0], 0), clampUv(arr[1], 0), clampUv(arr[2], size), clampUv(arr[3], size)]
}

/** 归一化模型：尺寸/像素对齐、贴图变量补全、几何坐标合法化；返回新对象 */
export function normalizeModelSchema(input: TemplatedModelAsset): TemplatedModelAsset {
  const size: 16 | 32 = input.textureSize === 32 ? 32 : 16
  const expected = size * size
  const pixels = Array.from({ length: expected }, (_, i) => normalizePixelValue(input.pixels?.[i]))

  const rawElements = Array.isArray(input.elements) ? input.elements : []
  const defaultTexPath = `textures/model/${input.id.trim() || 'new_model'}.png`
  const textures: Record<string, string> = {}
  if (input.textures && typeof input.textures === 'object') {
    for (const [key, value] of Object.entries(input.textures)) {
      if (/^[\w-]+$/.test(key) && typeof value === 'string' && value.trim()) {
        textures[key] = value.trim()
      }
    }
  }

  const elements = rawElements
    .filter((el): el is CubeElement => Boolean(el) && typeof el === 'object')
    .slice(0, 64)
    .map((rawEl, index) => {
      const from: [number, number, number] = [
        round1(clampCoord(rawEl.from?.[0])),
        round1(clampCoord(rawEl.from?.[1])),
        round1(clampCoord(rawEl.from?.[2]))
      ]
      const to: [number, number, number] = [
        round1(clampCoord(rawEl.to?.[0])),
        round1(clampCoord(rawEl.to?.[1])),
        round1(clampCoord(rawEl.to?.[2]))
      ]
      for (let axis = 0; axis < 3; axis++) {
        if (from[axis] > to[axis]) {
          const tmp = from[axis]
          from[axis] = to[axis]
          to[axis] = tmp
        }
      }

      const faces = {} as Partial<Record<CubeFaceName, CubeFace>>
      const rawFaces = rawEl.faces ?? {}
      for (const f of CUBE_FACES) {
        const rawFace = rawFaces[f]
        if (!rawFace || typeof rawFace !== 'object') continue
        const variable =
          typeof rawFace.texture === 'string' && /^[\w-]+$/.test(rawFace.texture)
            ? rawFace.texture
            : 'all'
        if (!(variable in textures)) textures[variable] = defaultTexPath
        const cubeFace: CubeFace = { uv: normalizeUv(rawFace.uv, size), texture: variable }
        if (rawFace.rotation === 0 || rawFace.rotation === 90 || rawFace.rotation === 180 || rawFace.rotation === 270) {
          cubeFace.rotation = rawFace.rotation
        }
        faces[f] = cubeFace
      }

      const el: CubeElement = {
        name: typeof rawEl.name === 'string' && rawEl.name.trim() ? rawEl.name.trim() : `立方体 ${index + 1}`,
        from,
        to,
        shade: rawEl.shade !== false,
        faces
      }
      const r = rawEl.rotation
      if (r && typeof r === 'object') {
        const axis = r.axis === 'x' || r.axis === 'y' || r.axis === 'z' ? r.axis : 'y'
        const angle =
          typeof r.angle === 'number' && isLegalRotationAngle(r.angle) ? r.angle : 0
        const origin: [number, number, number] = [
          round1(clampCoord(r.origin?.[0])),
          round1(clampCoord(r.origin?.[1])),
          round1(clampCoord(r.origin?.[2]))
        ]
        if (angle !== 0) {
          el.rotation = { origin, axis, angle, ...(r.rescale === true ? { rescale: true } : {}) }
        }
      }
      return el
    })

  // 保证至少有 all 变量路径（像素画 PNG 落盘与生成器的既有约定）
  if (!('all' in textures)) textures.all = defaultTexPath
  // all 变量路径始终随 id 归一（与 contentService 历史行为一致）
  textures.all = defaultTexPath

  const template: ModelTemplate = MODEL_TEMPLATE_OPTIONS.some((t) => t.value === input.template)
    ? (input.template as ModelTemplate)
    : inferTemplate({ ...input, elements } as ModelAsset)

  return {
    kind: 'model',
    template,
    id: input.id.trim(),
    displayName: (input.displayName ?? '').trim(),
    description: (input.description ?? '').trim(),
    textureSize: size,
    pixels,
    textures,
    elements,
    ambientOcclusion: input.ambientOcclusion !== false,
    ...(input.display && typeof input.display === 'object' ? { display: input.display } : {}),
    createdAt: input.createdAt ?? Date.now(),
    updatedAt: input.updatedAt ?? Date.now()
  }
}

/** 保存层硬校验；通过返回 null，否则返回错误消息（诊断级警告见 modelCompiler.validateModel） */
export function validateModelSchema(m: TemplatedModelAsset): string | null {
  if (!validateContentId(m.id)) {
    return sharedT('schema.common.errRegistryName')
  }
  if (!(typeof m.displayName === 'string' && m.displayName.trim())) {
    return sharedT('schema.common.errDisplayNamePlain')
  }
  if (m.textureSize !== 16 && m.textureSize !== 32) {
    return sharedT('schema.model.errTextureSize')
  }
  if (!Array.isArray(m.pixels) || m.pixels.length !== m.textureSize * m.textureSize) {
    return sharedT('schema.model.errPixelLength', { n: m.textureSize * m.textureSize })
  }
  if (!Array.isArray(m.elements) || m.elements.length === 0) {
    return sharedT('schema.model.errElementRequired')
  }
  for (let i = 0; i < m.elements.length; i++) {
    const el = m.elements[i]
    const label = sharedT('schema.model.cubeLabel', { i: i + 1 })
    if (!el || typeof el.name !== 'string') {
      return sharedT('schema.model.errCubeNameMissing', { label })
    }
    for (const key of ['from', 'to'] as const) {
      const v = el[key]
      if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
        return sharedT('schema.model.errCubeCoordType', { label, key })
      }
      if (v.some((n) => n < 0 || n > 16)) {
        return sharedT('schema.model.errCubeCoordRange', { label, key })
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      if (el.from[axis] > el.to[axis]) {
        return sharedT('schema.model.errCubeFromTo', { label })
      }
    }
    if (!el.faces || typeof el.faces !== 'object') {
      return sharedT('schema.model.errCubeFacesMissing', { label })
    }
    for (const faceName of CUBE_FACES) {
      const f = el.faces[faceName]
      if (!f) continue
      if (!(f.texture in m.textures)) {
        return sharedT('schema.model.errTextureVarUndefined', { label, face: faceName, var: f.texture })
      }
    }
  }
  return null
}
