/**
 * 贴图工坊 · 项目级画廊服务。
 *
 * 落点：<projectRoot>/.kunyu/gallery/，每张画一份 <id>.json（元数据 + 语义像素）+ <id>.png（缩略图）。
 * 与 .kunyu/texture-palette.json 同级，根级 .kunyu 不被内容扫描器扫到。
 *
 * 设计原则：AI 出图即入库、永不自动删除——候选图也是资产，
 * 开发者可在「画廊」模块里零额度复用（写回资产 / 二次编辑），不必重新调用 AI 烧额度。
 * 读取失败（缺文件 / JSON 损坏 / 字段非法）一律跳过坏项，绝不抛错。
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { EmbeddedCubeModel } from '../../../shared/types/content'
import type {
  GalleryAssetKind,
  GalleryItemDto,
  GalleryModelInfo,
  GalleryOrigin,
  GallerySaveInputDto
} from '../../../shared/types/ipc'
import { parseGeoModelInfo } from '../../../shared/utils/bbmodel'
import { embeddedCubeOf } from '../../../shared/utils/cubeModelAsset'
import { dataUrlToPngBuffer, pixelsToPngDataUrl } from './pixelize'

/** 画廊目录：<root>/.kunyu/gallery */
function galleryDir(root: string): string {
  return join(root, '.kunyu', 'gallery')
}

/** 资产类型 → .kunyu/content 下的目录名（读时汇总与写回共用；entity 只参与模型汇总，不入贴图白名单） */
const ASSET_DIRS: Record<'item' | 'block' | 'model' | 'entity', string> = {
  item: 'items',
  block: 'blocks',
  model: 'models',
  entity: 'entities'
}

/**
 * 资产类型单一白名单（**读写共用**）：item/block/model → 原值，其余（含 undefined）→ free。
 * 归一化只允许有这一处实现——只改读侧或只改写侧，会让绑定在重读时被静默降级成「未绑定资产」。
 */
export function asAssetKind(v: unknown): GalleryAssetKind {
  return v === 'item' || v === 'block' || v === 'model' ? v : 'free'
}

/** 从任意未知 JSON 还原一项画廊条目；不合法（缺 id / 几何摘要残缺 / 像素长度不符）返回 null。 */
function normalizeItem(raw: unknown): GalleryItemDto | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = typeof o.id === 'string' && /^[0-9a-zA-Z-]+$/.test(o.id) ? o.id : null
  if (!id) return null
  const size: 16 | 32 = o.size === 32 ? 32 : 16
  const pixels = Array.isArray(o.pixels)
    ? o.pixels.filter((p): p is string => typeof p === 'string')
    : []
  const assetKind: GalleryAssetKind = asAssetKind(o.assetKind)
  const origin: GalleryOrigin = o.origin === 'workshop' ? 'workshop' : 'agent'
  const base: GalleryItemDto = {
    id,
    createdAt:
      typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : new Date(0).toISOString(),
    assetKind,
    assetId: typeof o.assetId === 'string' ? o.assetId : '',
    size,
    prompt: typeof o.prompt === 'string' ? o.prompt : '',
    ...(typeof o.provider === 'string' && o.provider ? { provider: o.provider } : {}),
    origin,
    ...(typeof o.appliedIndex === 'number' && o.appliedIndex > 0
      ? { appliedIndex: Math.round(o.appliedIndex) }
      : {}),
    palette: Array.isArray(o.palette)
      ? o.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))
      : [],
    pixels,
    pngPath: typeof o.pngPath === 'string' ? o.pngPath : ''
  }
  if (o.entryKind !== 'model') {
    // 贴图条目：像素必须完整，否则写回资产必然失败
    return pixels.length === size * size ? base : null
  }
  // 模型条目：几何摘要必须齐全（定位不到归属就没法预览/导出/写回）；像素可缺（骨骼模型无像素贴图）
  const model = normalizeModelInfo(o.model)
  if (!model) return null
  if (pixels.length !== 0 && pixels.length !== size * size) return null
  return { ...base, entryKind: 'model', model }
}

/** 还原模型几何摘要；字段残缺一律返回 null（宁可整条不显示，也不展示无法操作的空壳） */
function normalizeModelInfo(raw: unknown): GalleryModelInfo | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const geometry: GalleryModelInfo['geometry'] | null =
    o.geometry === 'cube' ? 'cube' : o.geometry === 'blockbench' ? 'blockbench' : null
  const ownerKind: GalleryModelInfo['ownerKind'] | null =
    o.ownerKind === 'model' ||
    o.ownerKind === 'block' ||
    o.ownerKind === 'item' ||
    o.ownerKind === 'entity'
      ? o.ownerKind
      : null
  const ownerId = typeof o.ownerId === 'string' && o.ownerId.trim() ? o.ownerId.trim() : null
  if (!geometry || !ownerKind || !ownerId) return null
  const counts = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null
  const boneCount = counts(o.boneCount)
  const template = typeof o.template === 'string' && o.template.trim() ? o.template.trim() : ''
  const boundModelId =
    typeof o.boundModelId === 'string' && o.boundModelId.trim() ? o.boundModelId.trim() : null
  return {
    geometry,
    ownerKind,
    ownerId,
    textureSize: o.textureSize === 32 ? 32 : 16,
    elementCount: counts(o.elementCount) ?? 0,
    ...(boneCount !== null ? { boneCount } : {}),
    ...(template ? { template } : {}),
    ...(boundModelId ? { boundModelId } : {})
  }
}

/**
 * 列出项目画廊全部条目，按 createdAt 倒序（最新在前）。
 * 目录不存在返回空数组；单个坏项跳过，不影响其余条目。
 */
export function listGallery(root: string): GalleryItemDto[] {
  const dir = galleryDir(root)
  if (!existsSync(dir)) return []
  const items: GalleryItemDto[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    try {
      const item = normalizeItem(
        JSON.parse(readFileSync(join(dir, name), 'utf-8').replace(/^\uFEFF/, ''))
      )
      if (item) items.push(item)
    } catch {
      // 坏项跳过：绝不因单条损坏导致整座画廊不可用
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * 把 AI 候选入库（一张不丢）。非法项（像素长度与 size 不符等）直接丢弃并跳过，
 * 单个写盘失败不影响其余条目。返回实际落盘的条目。
 */
export function saveGalleryItems(root: string, items: GallerySaveInputDto[]): GalleryItemDto[] {
  if (!Array.isArray(items) || items.length === 0) return []
  const dir = galleryDir(root)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const saved: GalleryItemDto[] = []
  for (const raw of items) {
    const size: 16 | 32 = raw?.size === 32 ? 32 : 16
    const pixels = Array.isArray(raw?.pixels)
      ? raw.pixels.filter((p): p is string => typeof p === 'string')
      : []
    // 像素长度必须与 size 严格相符，否则写回资产必然失败——不入库
    if (pixels.length !== size * size) continue
    const id = randomUUID()
    const pngPath = join(dir, `${id}.png`)
    const item: GalleryItemDto = {
      id,
      createdAt: new Date().toISOString(),
      assetKind: asAssetKind(raw.assetKind),
      assetId: typeof raw.assetId === 'string' ? raw.assetId : '',
      size,
      prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 400) : '',
      ...(typeof raw.provider === 'string' && raw.provider ? { provider: raw.provider } : {}),
      origin: raw.origin === 'workshop' ? 'workshop' : 'agent',
      ...(typeof raw.appliedIndex === 'number' && raw.appliedIndex > 0
        ? { appliedIndex: Math.round(raw.appliedIndex) }
        : {}),
      palette: Array.isArray(raw.palette)
        ? raw.palette.filter(
            (c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)
          )
        : [],
      pixels,
      pngPath
    }
    try {
      writeFileSync(pngPath, dataUrlToPngBuffer(pixelsToPngDataUrl(size, pixels)))
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(item, null, 2) + '\n', 'utf-8')
      saved.push(item)
    } catch {
      // 单项写盘失败不影响其余条目
    }
  }
  return saved
}

/**
 * 遍历 .kunyu/content/<dir> 下的语义资产 JSON（逐项 parse + kind 校验，坏项跳过不抛错）。
 * 合成 id 前缀式：归档 id 为 UUID，天然不冲突；允许下划线（MC 注册名常见如 ruby_cube），
 * 项目资产不参与画廊删除，无需套用归档 id 的严格校验。
 */
function eachAsset(
  dir: string,
  kind: 'item' | 'block' | 'model' | 'entity',
  visit: (raw: Record<string, unknown>, id: string, abs: string) => void
): void {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || name === 'generated.json') continue
    const abs = join(dir, name)
    try {
      const raw = JSON.parse(readFileSync(abs, 'utf-8').replace(/^\uFEFF/, '')) as Record<
        string,
        unknown
      >
      if (!raw || typeof raw !== 'object' || raw.kind !== kind) continue
      const id =
        typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : name.replace(/\.json$/, '')
      visit(raw, id, abs)
    } catch {
      // 坏项跳过：绝不因单个损坏语义文件导致整座画廊不可用
    }
  }
}

/** 对象条目的时间：优先语义 updatedAt（ms 时间戳），否则回落到文件 mtime */
function assetCreatedAt(raw: Record<string, unknown>, abs: string): string {
  const ts = raw.updatedAt
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) return new Date(ts).toISOString()
  return new Date(statSync(abs).mtimeMs).toISOString()
}

/** 内嵌模型的可展示像素（长度必须满画布且至少一个非空，否则视为「无画」） */
function embeddedPixels(cm: EmbeddedCubeModel): string[] {
  const size = cm.textureSize
  return cm.pixels.length === size * size && cm.pixels.some((p) => p !== '') ? cm.pixels : []
}

/**
 * 实体骨骼模型条目（GeckoLib geo）：仅 renderer.modelType==='blockbench_geo' 且有 geoJson/modelPath 时成立。
 * 骨骼摘要只读解析，坏 geoJson 只丢摘要（boneCount=0），绝不让整座画廊不可用。
 */
function entityGeoEntry(
  raw: Record<string, unknown>,
  id: string,
  abs: string
): GalleryItemDto | null {
  const rendererRaw = raw.renderer
  const r =
    rendererRaw && typeof rendererRaw === 'object'
      ? (rendererRaw as Record<string, unknown>)
      : null
  if (!r || r.modelType !== 'blockbench_geo') return null
  const geoJson = typeof r.geoJson === 'string' && r.geoJson.trim() ? r.geoJson : ''
  const modelPath = typeof r.modelPath === 'string' && r.modelPath.trim() ? r.modelPath.trim() : ''
  if (!geoJson && !modelPath) return null
  const composedId = `object-entity-${id}-geo`
  if (!/^[0-9A-Za-z_-]+$/.test(composedId)) return null
  let boneCount = 0
  if (geoJson) {
    try {
      boneCount = parseGeoModelInfo(geoJson).boneNames.length
    } catch {
      boneCount = 0
    }
  }
  return {
    id: composedId,
    createdAt: assetCreatedAt(raw, abs),
    entryKind: 'model',
    model: {
      geometry: 'blockbench',
      ownerKind: 'entity',
      ownerId: id,
      textureSize: 16,
      elementCount: 0,
      boneCount
    },
    assetKind: 'model',
    assetId: id,
    size: 16,
    prompt: assetDisplayName(raw, id),
    origin: 'project',
    palette: [],
    pixels: [],
    pngPath: ''
  }
}

/**
 * 项目已有资产合成画廊条目（读时虚拟汇总，不落盘、不入库）。三段：
 * 1. 独立模型资产（.kunyu/content/models/）：有几何元素或有像素画即收录（entryKind='model'）；
 * 2. 对象内嵌 Cube 模型（方块/物品 model.cubeModel、实体 renderer.cubeModel）→ object-<kind>-<id>；
 * 3. 实体 Blockbench 骨骼模型 → object-entity-<id>-geo（与 cube 并列建模，各成一卡）。
 * 另汇总 item/block 的贴图像素画（'' 全透明的不算画）——它们是「已经存在的画」，
 * 同样值得在画廊里被看到并按零额度路径复用，而不是只有本次会话新出图的候选才可见。
 */
export function listAssetGallery(root: string): GalleryItemDto[] {
  const contentDir = join(root, '.kunyu', 'content')
  const items: GalleryItemDto[] = []
  /** id → 独立模型资产条目（镜像场景回填归属对象用） */
  const modelItems = new Map<string, GalleryItemDto>()

  // ---- 段 1：独立模型资产 ----
  eachAsset(join(contentDir, ASSET_DIRS.model), 'model', (raw, id, abs) => {
    const composedId = `asset-model-${id}`
    if (!/^[0-9A-Za-z_-]+$/.test(composedId)) return
    const elements = Array.isArray(raw.elements) ? raw.elements : []
    const art = modelAssetPixels(raw)
    // 放宽：有几何元素即收录（即使贴图全透明），或有像素画；两者皆无才是空壳
    if (elements.length === 0 && !art) return
    const template = typeof raw.template === 'string' && raw.template.trim() ? raw.template.trim() : ''
    const dto: GalleryItemDto = {
      id: composedId,
      createdAt: new Date(statSync(abs).mtimeMs).toISOString(),
      entryKind: 'model',
      model: {
        geometry: 'cube',
        ownerKind: 'model',
        ownerId: id,
        textureSize: art?.size ?? 16,
        elementCount: elements.length,
        ...(template ? { template } : {})
      },
      assetKind: 'model',
      assetId: id,
      size: art?.size ?? 16,
      prompt: assetDisplayName(raw, id),
      origin: 'project',
      palette: art ? uniqueColors(art.pixels) : [],
      pixels: art?.pixels ?? [],
      pngPath: ''
    }
    modelItems.set(id, dto)
    items.push(dto)
  })

  // ---- 段 2：对象内嵌 Cube 模型 / 实体骨骼模型 ----
  for (const kind of ['block', 'item', 'entity'] as const) {
    eachAsset(join(contentDir, ASSET_DIRS[kind]), kind, (raw, id, abs) => {
      const boundId = typeof raw.cubeModelId === 'string' ? raw.cubeModelId.trim() : ''
      const cm = embeddedCubeOf(raw, kind)
      const pixels = cm ? embeddedPixels(cm) : []
      const mirror = cm && boundId === id ? modelItems.get(id) : undefined
      if (cm && mirror) {
        // 工坊建模既有约定：对象内嵌模型已物化为 models/<id>.json 并被自身 cubeModelId 绑定
        // → 只出权威的 asset-model-<id>，把归属回填到该条，避免同一份几何出现两张卡
        if (mirror.model) {
          mirror.model.ownerKind = kind
          mirror.model.ownerId = id
          mirror.model.boundModelId = id
        }
      } else if (cm) {
        const composedId = `object-${kind}-${id}`
        if (/^[0-9A-Za-z_-]+$/.test(composedId)) {
          items.push({
            id: composedId,
            createdAt: assetCreatedAt(raw, abs),
            entryKind: 'model',
            model: {
              geometry: 'cube',
              ownerKind: kind,
              ownerId: id,
              textureSize: cm.textureSize,
              elementCount: cm.elements.length,
              ...(boundId ? { boundModelId: boundId } : {})
            },
            assetKind: 'model',
            assetId: id,
            size: cm.textureSize,
            prompt: assetDisplayName(raw, id),
            origin: 'project',
            palette: uniqueColors(pixels),
            pixels,
            pngPath: ''
          })
        }
      }
      // 实体骨骼模型与 cube 并列建模（生成器两条链），故独立成卡
      if (kind === 'entity') {
        const geo = entityGeoEntry(raw, id, abs)
        if (geo) items.push(geo)
      }
    })
  }

  // ---- 段 3：item / block 的贴图像素画（model 资产已由段 1 以模型卡收录，此处不重复） ----
  for (const kind of ['item', 'block'] as const) {
    eachAsset(join(contentDir, ASSET_DIRS[kind]), kind, (raw, id, abs) => {
      const composedId = `asset-${kind}-${id}`
      if (!/^[0-9A-Za-z_-]+$/.test(composedId)) return
      const art = textureRefPixels(raw)
      if (!art) return
      items.push({
        id: composedId,
        createdAt: new Date(statSync(abs).mtimeMs).toISOString(),
        assetKind: kind,
        assetId: id,
        size: art.size,
        prompt: assetDisplayName(raw, id),
        origin: 'project',
        palette: uniqueColors(art.pixels),
        pixels: art.pixels,
        pngPath: ''
      })
    })
  }
  return items
}

/**
 * 画廊全量条目 = 归档候选（.kunyu/gallery/）+ 项目已有像素资产，统一按 createdAt 倒序。
 * 供 content:gallery-list 一次返回，渲染层无需自行合并。
 */
export function listGalleryAll(root: string): GalleryItemDto[] {
  return [...listGallery(root), ...listAssetGallery(root)].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  )
}

/** item / block 资产：texture.pixels（256 项 = 16×16）且至少一个非空像素才算「有画」 */
function textureRefPixels(raw: Record<string, unknown>): { size: 16 | 32; pixels: string[] } | null {
  const texture = raw.texture
  const pixels =
    texture && typeof texture === 'object' && Array.isArray((texture as Record<string, unknown>).pixels)
      ? ((texture as Record<string, unknown>).pixels as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : []
  if (pixels.length !== 256 || !pixels.some((p) => p !== '')) return null
  return { size: 16, pixels }
}

/** model 资产：顶层 pixels + textureSize（16/32）且至少一个非空像素才算「有画」 */
function modelAssetPixels(raw: Record<string, unknown>): { size: 16 | 32; pixels: string[] } | null {
  const size: 16 | 32 = raw.textureSize === 32 ? 32 : 16
  const pixels = Array.isArray(raw.pixels)
    ? raw.pixels.filter((p): p is string => typeof p === 'string')
    : []
  if (pixels.length !== size * size || !pixels.some((p) => p !== '')) return null
  return { size, pixels }
}

/** 资产显示名（中文→英文→id 回落链），作为画廊条目的「描述」展示 */
function assetDisplayName(raw: Record<string, unknown>, fallback: string): string {
  const dn = raw.displayName
  if (typeof dn === 'string' && dn.trim()) return dn.trim()
  if (dn && typeof dn === 'object') {
    const o = dn as Record<string, unknown>
    if (typeof o.zh_cn === 'string' && o.zh_cn.trim()) return o.zh_cn.trim()
    if (typeof o.en_us === 'string' && o.en_us.trim()) return o.en_us.trim()
  }
  return fallback
}

/** 从像素画取调色板（去重、仅保留合法 "#rrggbb"） */
function uniqueColors(pixels: string[]): string[] {
  const set = new Set<string>()
  for (const p of pixels) {
    if (/^#[0-9a-fA-F]{6}$/.test(p)) set.add(p)
  }
  return [...set]
}

/** 删除单项（含缩略图）。仅用户手动触发，绝不自动清理。 */
export function deleteGalleryItem(root: string, id: string): boolean {
  if (typeof id !== 'string' || !/^[0-9a-zA-Z-]+$/.test(id)) return false
  const dir = galleryDir(root)
  const jsonPath = join(dir, `${id}.json`)
  if (!existsSync(jsonPath)) return false
  let ok = true
  try {
    rmSync(jsonPath, { force: true })
  } catch {
    ok = false
  }
  try {
    rmSync(join(dir, `${id}.png`), { force: true })
  } catch {
    // 缩略图缺失/占用不影响删除判定
  }
  return ok
}
