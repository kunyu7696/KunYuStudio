/**
 * Minecraft 皮肤格式双向编解码（B5-4，v2 格式长尾）。
 *
 * 产物契约：Minecraft 原版皮肤贴图布局（64×64 现代 / 64×32 经典 legacy），
 * 依原版 ModelBox 贴图布局算法推导各部件六面区域，而非硬编码区域表——
 * 给定 texOffs(u,v) 与尺寸(w,h,d)：
 *   u1=u, u2=u+d, u3=u+d+w, u4=u+d+w+d, u5=u+2(d+w)；
 *   面区域（同原版：east/右 与 west/左 分列两侧）：
 *   north/front = [u2, v+d, u3, v+d+h]，south/back = [u4, v+d, u5, v+d+h]，
 *   east = [u1, v+d, u2, v+d+h]，west = [u3, v+d, u4, v+d+h]，
 *   up = [u2, v, u3, v+d]，down = [u3, v, u4, v+d]。
 *   （以头部 texOffs(0,0) 8³ 校验：front=8..16、back=24..32、右=0..8、左=16..24、
 *   上=8..16、下=16..24 @v0..16，与原版皮肤模板逐格一致。）
 * clean-room 红线：仅依据 Minecraft 原版公开皮肤布局与 ModelBox 贴图展开原理独立
 * 实现，不读取、不复制任何第三方编辑器（Blockbench 等）源码。
 *
 * 朝向/几何约定（自定，导入导出对称；golden 测试锁定）：
 * - 角色朝 −Z（= 文档 north = 皮肤 front 区），右手在 +X（east，facing −Z 时
 *   right = f×u = +X，与文档 east 面同侧，故 right 部件占 +X）——east/west 归属
 *   按此推导；往返不依赖该归属（导入自洽即可）。
 * - 12 部件（经典臂宽 4，slim 臂宽 3）：
 *   head(0,0) 8×8×8 / hat(32,0) overlay；body(16,16) 8×12×4 / jacket(16,32)；
 *   rightArm(40,16) 4|3×12×4 / rightSleeve(40,32)；leftArm(32,48) / leftSleeve(48,48)；
 *   rightLeg(0,16) 4×12×4 / rightPants(0,32)；leftLeg(16,48) / leftPants(0,48)。
 * - 几何（对称居中）：head[-4,24,-4]→[4,32,4]；body[-4,12,-2]→[4,24,2]；
 *   rightArm[4,12,-2]→[8,24,2]（slim→[7,24,2]）；leftArm[-8,12,-2]→[-4,24,2]
 *   （slim→[-7,12,-2]→[-4,24,2]）；rightLeg[-4,0,-2]→[0,12,2]；
 *   leftLeg[0,0,-2]→[4,12,2]。overlay = 同几何外扩（hat +0.5，其余 +0.25）。
 *
 * 导入（skinToDocument）：无枢轴层级的 12 个顶层立方体（部件名命名）+ 1 张贴图
 * = 皮肤；逐面 uv = 该部件区域的六面矩形，全部绑定该贴图；formatData.skin 记
 * {kind:'skin', slim, legacy}。导出（documentToSkin）：按部件名匹配顶层立方体，
 * 把逐面 UV 矩形（源贴图）最近邻烘焙进目标皮肤区域（未匹配/越界逐条降级告警）。
 *
 * legacy（64×32）：左肢与除 hat 外的 overlay 区域不存在——导入时左肢复用右肢
 * 矩形（镜像几何）+ info，overlay 跳过 + info；导出时这些部件区域缺失同样跳过
 * （右肢矩形为唯一事实来源，避免左右互相覆盖）。
 *
 * 像素表示：行优先 string[]（'' = 透明，#rrggbb / #rrggbbaa），与格式层
 * ResolvePixels/EncodePixels 契约一致。往返不变量：export(import(skin)) 的
 * 被覆盖区域等于输入，未覆盖像素透明。
 *
 * 与格式注册表的关系：皮肤无对应 FormatId，与 bedrockAnim/gltf 同为独立互操作
 * codec（见 formats/index.ts）；导入产出 format='free' 的整文档，导出产物为
 * {width, height, pixels} 由主进程编码落盘 PNG。
 */
import { addNode, addTexture, createCubeNode, createDocument } from '../document'
import { effectiveFaceBindings } from '../uv'
import type { UvRect } from '../uv'
import { FACE_NAMES } from '../types'
import type {
  CubeNode,
  FaceBinding,
  FaceName,
  FormatId,
  ModelDocument,
  Vec2,
  Vec3
} from '../types'
import type {
  EncodePixels,
  FormatDowngrade,
  FormatExportResult,
  FormatImportResult,
  ResolvePixels
} from './types'

/* ------------------------------------------------------------------ */
/* 产物 / 选项 / formatData                                            */
/* ------------------------------------------------------------------ */

/** 皮肤导出产物：行优先像素串（'' = 透明） */
export interface SkinExport {
  width: number
  height: number
  pixels: string[]
}

/** formatData.skin 透传结构（文档级元数据，往返不丢） */
export interface SkinFormatData {
  kind?: 'skin'
  /** 手臂 3 像素宽（Alex）；缺省 false（经典 4 像素 Steve） */
  slim?: boolean
  /** 经典 64×32；缺省 false（现代 64×64） */
  legacy?: boolean
}

export interface SkinExportOptions {
  /** 注入：贴图 → 行优先像素串（缺省时对应区域不烘焙并告警） */
  resolvePixels?: ResolvePixels
  /** 输出尺寸覆盖；缺省读 doc.formatData.skin.legacy */
  legacy?: boolean
  /** 臂宽覆盖；缺省读 doc.formatData.skin.slim */
  slim?: boolean
}

export interface SkinImportOptions {
  id?: string
  name?: string
  /** 手臂 3 像素宽（Alex）；缺省 false */
  slim?: boolean
  /** 注入：像素串 → 贴图 data URL（缺省时贴图 data 为空并告警） */
  encodePixels?: EncodePixels
  now?: number
}

/* ------------------------------------------------------------------ */
/* 部件布局表                                                          */
/* ------------------------------------------------------------------ */

interface SkinPartDef {
  /** 部件名（导入产物立方体名，导出按此匹配） */
  name: string
  /** 盒式 UV 十字左上角（原版 texOffs） */
  texOffs: Vec2
  /** 经典尺寸 [w, h, d] */
  size: Vec3
  /** slim 尺寸覆盖（仅手臂） */
  slimSize?: Vec3
  /** 经典几何（不含 overlay 外扩） */
  from: Vec3
  to: Vec3
  /** slim 几何覆盖（仅手臂向体侧收窄） */
  slimFrom?: Vec3
  slimTo?: Vec3
  /** overlay 外扩量（0 = 基座，0.5 = hat，0.25 = 其余覆盖层） */
  inflate: number
  /** legacy 无区域时的近似来源（仅左肢；导入用，导出不写回以避免左右互覆） */
  legacyFallback?: string
}

/** 12 部件布局表（顺序 = 导入创建顺序；导出按名匹配与文档顺序无关） */
export const SKIN_PARTS: readonly SkinPartDef[] = [
  { name: 'head', texOffs: [0, 0], size: [8, 8, 8], from: [-4, 24, -4], to: [4, 32, 4], inflate: 0 },
  { name: 'hat', texOffs: [32, 0], size: [8, 8, 8], from: [-4, 24, -4], to: [4, 32, 4], inflate: 0.5 },
  { name: 'body', texOffs: [16, 16], size: [8, 12, 4], from: [-4, 12, -2], to: [4, 24, 2], inflate: 0 },
  { name: 'jacket', texOffs: [16, 32], size: [8, 12, 4], from: [-4, 12, -2], to: [4, 24, 2], inflate: 0.25 },
  {
    name: 'rightArm',
    texOffs: [40, 16],
    size: [4, 12, 4],
    slimSize: [3, 12, 4],
    from: [4, 12, -2],
    to: [8, 24, 2],
    slimFrom: [4, 12, -2],
    slimTo: [7, 24, 2],
    inflate: 0
  },
  {
    name: 'rightSleeve',
    texOffs: [40, 32],
    size: [4, 12, 4],
    slimSize: [3, 12, 4],
    from: [4, 12, -2],
    to: [8, 24, 2],
    slimFrom: [4, 12, -2],
    slimTo: [7, 24, 2],
    inflate: 0.25
  },
  {
    name: 'leftArm',
    texOffs: [32, 48],
    size: [4, 12, 4],
    slimSize: [3, 12, 4],
    from: [-8, 12, -2],
    to: [-4, 24, 2],
    slimFrom: [-7, 12, -2],
    slimTo: [-4, 24, 2],
    inflate: 0,
    legacyFallback: 'rightArm'
  },
  {
    name: 'leftSleeve',
    texOffs: [48, 48],
    size: [4, 12, 4],
    slimSize: [3, 12, 4],
    from: [-8, 12, -2],
    to: [-4, 24, 2],
    slimFrom: [-7, 12, -2],
    slimTo: [-4, 24, 2],
    inflate: 0.25
  },
  { name: 'rightLeg', texOffs: [0, 16], size: [4, 12, 4], from: [-4, 0, -2], to: [0, 12, 2], inflate: 0 },
  { name: 'rightPants', texOffs: [0, 32], size: [4, 12, 4], from: [-4, 0, -2], to: [0, 12, 2], inflate: 0.25 },
  {
    name: 'leftLeg',
    texOffs: [16, 48],
    size: [4, 12, 4],
    from: [0, 0, -2],
    to: [4, 12, 2],
    inflate: 0,
    legacyFallback: 'rightLeg'
  },
  {
    name: 'leftPants',
    texOffs: [0, 48],
    size: [4, 12, 4],
    from: [0, 0, -2],
    to: [4, 12, 2],
    inflate: 0.25
  }
]

/** 皮肤画布尺寸（现代 64×64 / 经典 64×32） */
export const SKIN_ATLAS_WIDTH = 64

/* ------------------------------------------------------------------ */
/* 区域推导（原版 ModelBox 贴图布局）                                     */
/* ------------------------------------------------------------------ */

/** 部件实际尺寸（slim 仅收窄手臂宽） */
function partSize(part: SkinPartDef, slim: boolean): Vec3 {
  return slim && part.slimSize ? part.slimSize : part.size
}

/** 部件几何（含 overlay 外扩） */
function partGeometry(part: SkinPartDef, slim: boolean): { from: Vec3; to: Vec3 } {
  const base = slim && part.slimFrom && part.slimTo
    ? { from: part.slimFrom, to: part.slimTo }
    : { from: part.from, to: part.to }
  const k = part.inflate
  return {
    from: [base.from[0] - k, base.from[1] - k, base.from[2] - k],
    to: [base.to[0] + k, base.to[1] + k, base.to[2] + k]
  }
}

/**
 * 盒式 UV 六面区域（原版 ModelBox 贴图布局算法，公开原理独立实现）。
 * 见文件头注释的面区域映射表（以头部 8³ 逐格校验）。
 */
export function skinBoxFaceRects(texOffs: Vec2, size: Vec3): Record<FaceName, UvRect> {
  const [u, v] = texOffs
  const [w, h, d] = size
  const u1 = u
  const u2 = u + d
  const u3 = u + d + w
  const u4 = u + d + w + d
  const u5 = u + d + w + d + w
  return {
    east: [u1, v + d, u2, v + d + h],
    north: [u2, v + d, u3, v + d + h],
    west: [u3, v + d, u4, v + d + h],
    south: [u4, v + d, u5, v + d + h],
    up: [u2, v, u3, v + d],
    down: [u3, v, u4, v + d]
  }
}

/** 部件区域是否完全落在画布内（legacy 64×32 用于判定区域缺失） */
function partFits(part: SkinPartDef, slim: boolean, width: number, height: number): boolean {
  const rects = skinBoxFaceRects(part.texOffs, partSize(part, slim))
  for (const face of FACE_NAMES) {
    const [, , x2, y2] = rects[face]
    if (x2 > width || y2 > height) return false
  }
  return true
}

/** 部件名单一化匹配键（大小写/分隔符不敏感） */
function normName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/* ------------------------------------------------------------------ */
/* 导出：文档 → 皮肤像素图集                                            */
/* ------------------------------------------------------------------ */

/**
 * 源 UV 矩形 → 目标区域最近邻烘焙（源矩形可越界时夹取，由调用方按需告警）。
 * 空/透明源像素写入 ''（等价透明），不改变图集其余像素。
 */
function bakeRect(
  src: string[],
  srcW: number,
  srcH: number,
  srcRect: UvRect,
  dst: string[],
  dstW: number,
  dstRect: UvRect
): void {
  const [su1, sv1, su2, sv2] = srcRect
  const [du1, dv1, du2, dv2] = dstRect
  const sw = su2 - su1
  const sh = sv2 - sv1
  const dw = du2 - du1
  const dh = dv2 - dv1
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(srcH - 1, Math.max(0, Math.floor(sv1 + ((y + 0.5) * sh) / dh)))
    for (let x = 0; x < dw; x++) {
      const di = (dv1 + y) * dstW + (du1 + x)
      if (di < 0 || di >= dst.length) continue
      const sx = Math.min(srcW - 1, Math.max(0, Math.floor(su1 + ((x + 0.5) * sw) / dw)))
      const si = sy * srcW + sx
      if (si < 0 || si >= src.length) continue
      dst[di] = src[si] ?? ''
    }
  }
}

/**
 * ModelDocument → MC 皮肤像素图集（含降级告警）。
 * 顶层立方体按部件名匹配（大小写/分隔符不敏感），逐面把源 UV 矩形烘焙进目标区域。
 */
export function documentToSkin(
  doc: ModelDocument,
  options?: SkinExportOptions
): FormatExportResult<SkinExport> {
  const downgrades: FormatDowngrade[] = []
  const fd = (doc.formatData?.skin ?? {}) as SkinFormatData
  const legacy = options?.legacy ?? fd.legacy === true
  const slim = options?.slim ?? fd.slim === true
  const width = SKIN_ATLAS_WIDTH
  const height = legacy ? 32 : 64
  const pixels: string[] = new Array(width * height).fill('')

  /* 顶层立方体按归一化名索引 */
  const cubeByNorm = new Map<string, CubeNode>()
  for (const id of doc.root) {
    const n = doc.nodes[id]
    if (!n) continue
    if (n.type !== 'cube') {
      downgrades.push({
        severity: 'info',
        code: 'node_skipped',
        nodeId: id,
        message: `顶层节点「${n.name}」不是立方体（皮肤只含立方体部件），已跳过`
      })
      continue
    }
    const norm = normName(n.name)
    if (cubeByNorm.has(norm)) {
      downgrades.push({
        severity: 'info',
        code: 'duplicate_part',
        nodeId: id,
        message: `同名立方体「${n.name}」重复，仅使用第一个`
      })
      continue
    }
    cubeByNorm.set(norm, n)
  }

  const used = new Set<string>()
  for (const part of SKIN_PARTS) {
    const key = normName(part.name)
    /* legacy 区域缺失：跳过（不写回，右肢矩形为唯一事实来源） */
    if (!partFits(part, slim, width, height)) {
      downgrades.push({
        severity: 'info',
        code: 'legacy_region_missing',
        message: `当前画布 ${width}×${height} 无「${part.name}」区域，该部件未导出`
      })
      continue
    }
    const cube = cubeByNorm.get(key)
    if (!cube) {
      downgrades.push({
        severity: 'info',
        code: 'part_unmapped',
        message: `文档没有名为「${part.name}」的顶层立方体，皮肤对应区域保持透明`
      })
      continue
    }
    used.add(key)
    const rects = skinBoxFaceRects(part.texOffs, partSize(part, slim))
    const eff = effectiveFaceBindings(cube, doc.settings.uvMode)
    for (const face of FACE_NAMES) {
      const rect = rects[face]
      const binding = eff[face]
      if (!binding?.uv) {
        downgrades.push({
          severity: 'info',
          code: 'face_uv_missing',
          nodeId: cube.id,
          message: `「${part.name}」${face} 面没有 UV，已跳过`
        })
        continue
      }
      const tex = binding.texture ? doc.textures[binding.texture] : undefined
      if (!tex) {
        downgrades.push({
          severity: 'warning',
          code: 'face_texture_missing',
          nodeId: cube.id,
          message: `「${part.name}」${face} 面未绑定贴图，该区域保持透明`
        })
        continue
      }
      const src = options?.resolvePixels?.(tex)
      if (!src || src.length !== tex.width * tex.height) {
        downgrades.push({
          severity: 'warning',
          code: 'pixels_unresolved',
          nodeId: cube.id,
          message: `贴图「${tex.name}」像素未能解析，「${part.name}」区域未烘焙`
        })
        continue
      }
      const [su1, sv1, su2, sv2] = binding.uv
      if (su1 < 0 || sv1 < 0 || su2 > tex.width || sv2 > tex.height) {
        downgrades.push({
          severity: 'info',
          code: 'source_uv_clamped',
          nodeId: cube.id,
          message: `「${part.name}」${face} 面 UV 越出贴图「${tex.name}」范围，已夹取到边界`
        })
      }
      bakeRect(src, tex.width, tex.height, binding.uv, pixels, width, rect)
    }
  }

  for (const [norm, cube] of cubeByNorm) {
    if (used.has(norm)) continue
    downgrades.push({
      severity: 'info',
      code: 'cube_not_mapped',
      nodeId: cube.id,
      message: `顶层立方体「${cube.name}」不对应任何皮肤部件，未导出`
    })
  }

  return { output: { width, height, pixels }, downgrades }
}

/* ------------------------------------------------------------------ */
/* 导入：皮肤像素图集 → 文档                                            */
/* ------------------------------------------------------------------ */

/**
 * MC 皮肤像素图集 → ModelDocument（12 个顶层立方体 + 1 张贴图；含降级告警）。
 * 尺寸仅接受 64×64 / 64×32；像素数不符或尺寸非法抛错。
 */
export function skinToDocument(
  width: number,
  height: number,
  pixels: string[],
  options?: SkinImportOptions
): FormatImportResult {
  if (width !== SKIN_ATLAS_WIDTH || (height !== 64 && height !== 32)) {
    throw new Error(`不是有效的 MC 皮肤尺寸：${width}×${height}（仅支持 64×64 / 64×32）`)
  }
  if (!Array.isArray(pixels) || pixels.length !== width * height) {
    throw new Error(`像素数量与尺寸不符：${pixels?.length ?? 0} ≠ ${width * height}`)
  }
  const downgrades: FormatDowngrade[] = []
  const legacy = height === 32
  const slim = options?.slim === true

  const name = options?.name ?? 'MC 皮肤'
  let doc: ModelDocument = createDocument({
    ...(options?.id !== undefined ? { id: options.id } : {}),
    name,
    format: 'free' as FormatId,
    settings: { uvMode: 'per_face' },
    ...(options?.now !== undefined ? { now: options.now } : {})
  })

  /* 单张贴图（皮肤图集） */
  const texId = 'skin'
  let data = ''
  if (options?.encodePixels) {
    data = options.encodePixels(pixels, width, height)
  } else {
    downgrades.push({
      severity: 'warning',
      code: 'pixels_unencoded',
      message: '未注入 encodePixels，皮肤贴图 data 为空（编译前需在渲染层补全）'
    })
  }
  doc = addTexture(doc, {
    id: texId,
    name: 'skin',
    width,
    height,
    data,
    visible: true
  })

  /* 12 部件立方体 */
  for (const part of SKIN_PARTS) {
    let rectPart = part
    if (!partFits(part, slim, width, height)) {
      const fb = part.legacyFallback
        ? SKIN_PARTS.find((x) => x.name === part.legacyFallback)
        : undefined
      if (!fb || !partFits(fb, slim, width, height)) {
        downgrades.push({
          severity: 'info',
          code: 'legacy_region_missing',
          message: `经典画布 ${width}×${height} 无「${part.name}」区域，未创建该部件`
        })
        continue
      }
      rectPart = fb
      downgrades.push({
        severity: 'info',
        code: 'legacy_region_reused',
        message: `经典画布无「${part.name}」区域，「${part.name}」复用「${fb.name}」矩形近似（镜像几何）`
      })
    }
    const geo = partGeometry(part, slim)
    const rects = skinBoxFaceRects(rectPart.texOffs, partSize(rectPart, slim))
    const cube = createCubeNode(part.name, { from: geo.from, to: geo.to })
    const faces: Partial<Record<FaceName, FaceBinding>> = {}
    for (const face of FACE_NAMES) {
      faces[face] = { uv: [...rects[face]] as UvRect, texture: texId }
    }
    cube.faces = faces
    doc = addNode(doc, cube, null)
  }

  doc.formatData = { ...(doc.formatData ?? {}), skin: { kind: 'skin', slim, legacy } }
  return { doc, downgrades }
}
