/**
 * Java Block/Item 格式编解码（方案 §4.1 formats/javaBlock.ts）。
 *
 * 产物契约：`ModelAsset`（shared/types/content.ts）——KunYu 内容管线的编译产物/
 * 交换格式；再经 modelCompiler.compileModelToMcJson 落为原版模型 JSON。
 *
 * 能力矩阵：单张贴图变量为主（多贴图变量可导出、物化管线后续扩展）、
 * 立方体无层级、单轴旋转（±45°、22.5° 步进）、坐标 0..16、display 八槽位。
 * 超出能力的文档内容在导出时降级并逐条告警（downgrades），文档本身不被修改。
 *
 * 往返保真：import 把 ModelAsset 原 textures 变量→路径映射存入
 * doc.formatData.javaTextures，export 优先复用原路径，保证「导入→编辑→导出」不丢路径。
 */
import type {
  CubeElement,
  CubeFace,
  CubeFaceName,
  ModelAsset,
  RotationAxis
} from '../../types/content'
import {
  FACE_NAMES,
  type CubeNode,
  type FaceRotation,
  type FormatId,
  type ModelDocument,
  type ModelTexture,
  type Vec3
} from '../types'
import {
  addNode,
  addTexture,
  createCubeNode,
  createDocument
} from '../document'
import { autoFaceUv, cubeSize, effectiveFaceBindings } from '../uv'
import type {
  EncodePixels,
  FormatCapabilities,
  FormatDefinition,
  FormatDowngrade,
  FormatExportResult,
  FormatImportResult,
  ResolvePixels
} from './types'

const FORMAT_ID: FormatId = 'java_block'

/** Java 方块/物品能力矩阵（原版模型 JSON 约束的单一事实来源） */
export const JAVA_BLOCK_CAPABILITIES: FormatCapabilities = {
  nodes: { cube: true, group: false, locator: false, mesh: false },
  textures: { multi: true, maxSize: 32, squareOnly: true },
  uv: { perFace: true, box: false, faceRotation: true },
  rotation: { mode: 'singleAxis', maxAngle: 45, step: 22.5 },
  coordinateRange: { min: 0, max: 16 },
  hierarchy: false,
  pivots: false,
  animations: false,
  display: true
}

export interface JavaBlockExportOptions {
  /** 注入：贴图 data URL → 行优先像素串（缺省时产物 pixels 为空数组并告警） */
  resolvePixels?: ResolvePixels
  /** 注入：固定 updatedAt/createdAt（测试确定性） */
  now?: number
}

export interface JavaBlockImportOptions {
  /** 注入：像素串 → 贴图 data URL（缺省时跳过贴图导入并告警） */
  encodePixels?: EncodePixels
  now?: number
  /** 覆盖文档 format 标记（java_item 薄壳复用同一 codec 时传 'java_item'） */
  format?: FormatId
}

/** 贴图变量名清洗：小写字母/数字/下划线，空名回退 layerN；重复时追加序号 */
function sanitizeVariable(raw: string, used: Set<string>): string {
  const base = raw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'layer'
  let name = base
  let n = 1
  while (used.has(name)) {
    n += 1
    name = `${base}${n}`
  }
  used.add(name)
  return name
}

/** 三轴旋转 → Java 单轴旋转（恰一个非零轴且角度合法时有效；否则返回告警码） */
function toSingleAxisRotation(
  rotation: Vec3
): { axis: RotationAxis; angle: number } | 'multi' | 'illegal' | null {
  const axes: RotationAxis[] = ['x', 'y', 'z']
  const nonZero = axes.filter((_, i) => rotation[i] !== 0)
  if (nonZero.length === 0) return null
  if (nonZero.length > 1) return 'multi'
  const axis = nonZero[0]!
  const angle = rotation[axes.indexOf(axis)]
  const cap = JAVA_BLOCK_CAPABILITIES.rotation
  if (Math.abs(angle) > (cap.maxAngle ?? 45)) return 'illegal'
  const step = cap.step ?? 22.5
  if (Math.abs(angle / step - Math.round(angle / step)) > 1e-6) return 'illegal'
  return { axis, angle }
}

/** 立方体父链上是否存在非恒等组变换（组旋转/缩放无法被 Java 表达） */
function hasGroupTransform(doc: ModelDocument, node: CubeNode): boolean {
  let cursor = node.parent
  while (cursor) {
    const parent = doc.nodes[cursor]
    if (!parent) return false
    if (parent.type === 'group') {
      if (parent.rotation.some((r) => r !== 0)) return true
      if (parent.scale && parent.scale.some((s) => s !== 1)) return true
    }
    cursor = parent.parent
  }
  return false
}

/**
 * ModelDocument → ModelAsset（Java 导出，含降级告警）。
 * 贴图变量：第一张 → 'all'（兼容现有物化管线），其余按贴图名清洗唯一化；
 * 路径优先复用 formatData.javaTextures 原映射，缺省按 textures/model/<id>[ _var].png 约定。
 */
export function documentToModelAsset(
  doc: ModelDocument,
  options?: JavaBlockExportOptions
): FormatExportResult<ModelAsset> {
  const downgrades: FormatDowngrade[] = []
  const now = options?.now ?? Date.now()
  const texList = Object.values(doc.textures)
  const priorPaths = (doc.formatData?.javaTextures ?? {}) as Record<string, string>

  /* 贴图变量映射 */
  const usedVars = new Set<string>()
  const varByTexId = new Map<string, string>()
  const textures: Record<string, string> = {}
  texList.forEach((tex, i) => {
    const variable = i === 0 ? 'all' : sanitizeVariable(tex.name, usedVars)
    if (i === 0) usedVars.add('all')
    varByTexId.set(tex.id, variable)
    textures[variable] =
      priorPaths[variable] ??
      (i === 0 ? `textures/model/${doc.id}.png` : `textures/model/${doc.id}_${variable}.png`)
  })
  if (texList.length === 0) {
    textures.all = priorPaths.all ?? `textures/model/${doc.id}.png`
    downgrades.push({
      severity: 'warning',
      code: 'no_texture',
      message: '文档没有贴图，产物将全部面绑定到空贴图变量 all'
    })
  }

  /* 像素与画布尺寸（主贴图；ModelAsset 契约仅 16/32 正方形，flipbook 帧条见下） */
  const primary = texList[0]
  let textureSize: 16 | 32 = 16
  let pixels: string[] = []
  if (primary) {
    textureSize = primary.width <= 16 ? 16 : 32
    /* B2-1 flipbook：带动画的竖直帧条（height = width × 帧数）不属于尺寸越界，
       不告警；pixels 长度 = width × height 原样保留，生成器按帧条高度落盘 PNG */
    const isStrip = !!primary.animation && primary.height > primary.width && primary.height % primary.width === 0
    if (!isStrip && (primary.width !== primary.height || (primary.width !== 16 && primary.width !== 32))) {
      downgrades.push({
        severity: 'warning',
        code: 'texture_size_clamped',
        message: `贴图「${primary.name}」尺寸 ${primary.width}×${primary.height} 超出资产契约（16/32 正方形），按 ${textureSize} 记录`
      })
    }
    const resolved = options?.resolvePixels?.(primary)
    if (resolved && resolved.length === primary.width * primary.height) {
      pixels = resolved
    } else {
      downgrades.push({
        severity: 'warning',
        code: 'pixels_unresolved',
        message: `贴图「${primary.name}」像素未能解析，产物 pixels 为空（编译前需在主进程补全）`
      })
    }
  }

  /* 元素导出 */
  const elements: CubeElement[] = []
  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'locator') {
      downgrades.push({
        severity: 'info',
        code: 'locator_dropped',
        nodeId: node.id,
        message: `定位器「${node.name}」无法被 Java 模型表达，已跳过`
      })
      continue
    }
    if (node.type === 'mesh') {
      downgrades.push({
        severity: 'warning',
        code: 'mesh_dropped',
        nodeId: node.id,
        message: `网格「${node.name}」无法被 Java 模型表达（仅支持立方体），已跳过`
      })
      continue
    }
    if (node.type !== 'cube') continue
    if (hasGroupTransform(doc, node)) {
      downgrades.push({
        severity: 'warning',
        code: 'group_transform_lost',
        nodeId: node.id,
        message: `立方体「${node.name}」的父组带旋转/缩放，Java 无层级，按未变换坐标导出`
      })
    }

    const range = JAVA_BLOCK_CAPABILITIES.coordinateRange
    if (
      range &&
      [...node.from, ...node.to].some((n) => n < range.min || n > range.max)
    ) {
      downgrades.push({
        severity: 'warning',
        code: 'coord_range',
        nodeId: node.id,
        message: `立方体「${node.name}」坐标超出 ${range.min}..${range.max}，游戏内会被钳制或报错`
      })
    }

    const rot = toSingleAxisRotation(node.rotation)
    const faces: Partial<Record<CubeFaceName, CubeFace>> = {}
    const resolved = effectiveFaceBindings(node, doc.settings.uvMode)
    const size = cubeSize(node)
    for (const face of FACE_NAMES) {
      const binding = resolved[face]
      if (!binding) continue // 未声明的面 = 剔除
      let uv = binding.uv
      if (!uv) {
        uv = autoFaceUv(size, face)
        downgrades.push({
          severity: 'info',
          code: 'uv_auto_filled',
          nodeId: node.id,
          message: `立方体「${node.name}」的 ${face} 面缺少 UV，已按自动 UV 补齐`
        })
      }
      if (binding.cullface !== undefined || binding.tint !== undefined) {
        downgrades.push({
          severity: 'info',
          code: 'face_extra_dropped',
          nodeId: node.id,
          message: `立方体「${node.name}」的 ${face} 面 cullface/tint 不在资产契约内，已丢弃`
        })
      }
      faces[face as CubeFaceName] = {
        uv: [...uv],
        texture: binding.texture ? (varByTexId.get(binding.texture) ?? 'all') : 'all',
        ...(binding.rotation !== undefined ? { rotation: binding.rotation } : {})
      }
    }

    if (rot === 'multi') {
      downgrades.push({
        severity: 'warning',
        code: 'rotation_multi_axis',
        nodeId: node.id,
        message: `立方体「${node.name}」为多轴旋转，Java 仅支持单轴，导出已丢弃旋转`
      })
    } else if (rot === 'illegal') {
      downgrades.push({
        severity: 'warning',
        code: 'rotation_angle',
        nodeId: node.id,
        message: `立方体「${node.name}」旋转角超出单轴 ±45°/22.5° 步进，导出已丢弃旋转`
      })
    }

    elements.push({
      name: node.name,
      from: [...node.from],
      to: [...node.to],
      ...(rot && rot !== 'multi' && rot !== 'illegal'
        ? {
            rotation: {
              origin: [...node.origin] as Vec3,
              axis: rot.axis,
              angle: rot.angle
            }
          }
        : {}),
      ...(node.shade === false ? { shade: false } : {}),
      faces
    })
  }

  const asset: ModelAsset = {
    kind: 'model',
    id: doc.id,
    displayName: doc.name,
    description: '',
    textureSize,
    pixels,
    textures,
    elements,
    ambientOcclusion: true,
    /* B2-1 flipbook：主贴图动画元数据透传（生成器据此写 .png.mcmeta + 帧条 PNG） */
    ...(primary?.animation ? { textureAnimation: { ...primary.animation } } : {}),
    ...(doc.display && Object.keys(doc.display).length > 0 ? { display: { ...doc.display } } : {}),
    createdAt: now,
    updatedAt: now
  }
  return { output: asset, downgrades }
}

/**
 * ModelAsset → ModelDocument（读时兼容导入）。
 * 原 textures 变量→路径映射存入 formatData.javaTextures 供导出还原路径；
 * 多变量资产折叠为一张贴图（像素仅主贴图一张），变量合并记 info 告警。
 */
export function modelAssetToDocument(
  asset: ModelAsset,
  options?: JavaBlockImportOptions
): FormatImportResult {
  const downgrades: FormatDowngrade[] = []
  const size = asset.textureSize === 32 ? 32 : 16
  let doc = createDocument({
    id: asset.id,
    name: asset.displayName || asset.id,
    format: options?.format ?? FORMAT_ID,
    settings: { uvMode: 'per_face', textureSize: [size, size] },
    now: options?.now
  })

  /* 贴图导入（全部变量折叠为一张；无编码器时跳过像素）
     B2-1 flipbook：textureAnimation 存在且 pixels 为帧条（长度 = size² × 帧数）时
     按帧条高度导入并恢复动画元数据 */
  const variables = Object.keys(asset.textures)
  let texId: string | null = null
  if (options?.encodePixels) {
    const stripH =
      asset.textureAnimation && asset.pixels.length > size * size && asset.pixels.length % size === 0
        ? asset.pixels.length / size
        : size
    const data = options.encodePixels(asset.pixels, size, stripH)
    const tex: ModelTexture = {
      id: `tex-${asset.id}`,
      name: variables[0] ?? 'all',
      width: size,
      height: stripH,
      data,
      visible: true,
      ...(asset.textureAnimation ? { animation: { ...asset.textureAnimation } } : {})
    }
    doc = addTexture(doc, tex)
    texId = tex.id
  } else {
    downgrades.push({
      severity: 'warning',
      code: 'texture_not_imported',
      message: '缺少像素编码器，贴图未导入（面 UV 保留，贴图绑定为空）'
    })
  }
  if (variables.length > 1) {
    downgrades.push({
      severity: 'info',
      code: 'textures_merged',
      message: `资产含 ${variables.length} 个贴图变量（${variables.join(', ')}），导入折叠为一张贴图`
    })
  }

  /* 元素导入 */
  for (const el of asset.elements) {
    const node = createCubeNode(el.name || 'cube', { from: el.from, to: el.to })
    if (el.rotation) {
      const idx = el.rotation.axis === 'x' ? 0 : el.rotation.axis === 'y' ? 1 : 2
      node.rotation[idx] = el.rotation.angle
      node.origin = [...el.rotation.origin] as Vec3
    }
    node.shade = el.shade !== false
    const faces: CubeNode['faces'] = {}
    for (const face of FACE_NAMES) {
      const f = el.faces[face as CubeFaceName]
      if (!f) continue
      faces[face] = {
        uv: [...f.uv] as [number, number, number, number],
        ...(texId ? { texture: texId } : {}),
        ...(f.rotation !== undefined ? { rotation: f.rotation as FaceRotation } : {})
      }
    }
    node.faces = faces
    doc = addNode(doc, node, null)
  }

  if (asset.display && Object.keys(asset.display).length > 0) {
    doc = { ...doc, display: { ...asset.display } }
  }
  doc = {
    ...doc,
    formatData: {
      ...(doc.formatData ?? {}),
      javaTextures: { ...asset.textures },
      ...(asset.template ? { javaTemplate: asset.template } : {})
    }
  }
  return { doc, downgrades }
}

/** java_block 格式定义（注册表入口） */
export const javaBlockFormat: FormatDefinition<ModelAsset, ModelAsset> = {
  id: FORMAT_ID,
  name: 'Java 方块',
  capabilities: JAVA_BLOCK_CAPABILITIES,
  exportDocument: (doc, options) =>
    documentToModelAsset(doc, options as JavaBlockExportOptions | undefined),
  importDocument: (input, options) =>
    modelAssetToDocument(input, options as JavaBlockImportOptions | undefined)
}

/** java_item 格式定义（薄壳：复用 java_block codec，仅 formatId 不同） */
export const javaItemFormat: FormatDefinition<ModelAsset, ModelAsset> = {
  id: 'java_item',
  name: 'Java 物品',
  capabilities: JAVA_BLOCK_CAPABILITIES,
  exportDocument: (doc, options) =>
    documentToModelAsset(doc, options as JavaBlockExportOptions | undefined),
  importDocument: (input) => modelAssetToDocument(input, { format: 'java_item' })
}
