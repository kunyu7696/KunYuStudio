/**
 * 材质编辑器语义结构（P0：单层像素画 + PNG 导出）。
 * 贴图属于版无关资产：语义 JSON 记录像素与类别，导出由主进程写
 * assets/<modid>/textures/<category>/<id>.png，生成器不消费本类型。
 * pixels 沿用 ModelAsset 约定：行优先数组，'' = 透明，#rrggbb 不透明，#rrggbbaa 带透明度。
 * P0 为单图层；图层系统（P1）将在 layers 字段上扩展，pixels 始终为合成结果。
 */
import { validateContentId } from '../types/content'
import { formatPixel, parsePixel } from '../utils/pixelColor'
import { sharedT, type SharedLocale } from '../i18n'

export type TextureCategory = 'block' | 'item' | 'entity' | 'gui'

/** 材质语义资产 */
export interface TextureSchema {
  kind: 'texture'
  id: string
  /** 单语显示名（对齐 model / recipe 模式） */
  displayName: string
  description: string
  /** 导出子目录：textures/<category>/<id>.png */
  category: TextureCategory
  /** 画布宽（像素） */
  width: number
  /** 画布高（像素） */
  height: number
  /** 行优先像素，长度 width*height；'' = 透明，#rrggbb */
  pixels: string[]
  /** 最近一次导出的 assets 相对路径（如 textures/block/ruby.png） */
  exportPath?: string
  createdAt: number
  updatedAt: number
}

/** 类别目录（含提示） */
function buildTextureCategoryOptions(locale?: SharedLocale): { value: TextureCategory; label: string; hint: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'block', label: t('schema.texture.catBlock'), hint: t('schema.texture.catBlockHint') },
    { value: 'item', label: t('schema.texture.catItem'), hint: t('schema.texture.catItemHint') },
    { value: 'entity', label: t('schema.texture.catEntity'), hint: t('schema.texture.catEntityHint') },
    { value: 'gui', label: t('schema.texture.catGui'), hint: t('schema.texture.catGuiHint') }
  ]
}

export const TEXTURE_CATEGORY_OPTIONS: { value: TextureCategory; label: string; hint: string }[] =
  buildTextureCategoryOptions()

/** 语言感知版本：组件内 computed(() => getTextureCategoryOptions(locale.value)) 使用 */
export function getTextureCategoryOptions(locale?: SharedLocale): typeof TEXTURE_CATEGORY_OPTIONS {
  return buildTextureCategoryOptions(locale)
}

/** 预设尺寸（宽×高）；GUI 提供非方形 176×166 */
function buildTextureSizeOptions(locale?: SharedLocale): {
  width: number
  height: number
  label: string
  hint: string
}[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { width: 16, height: 16, label: '16×16', hint: t('schema.texture.size16Hint') },
    { width: 32, height: 32, label: '32×32', hint: t('schema.texture.size32Hint') },
    { width: 64, height: 64, label: '64×64', hint: t('schema.texture.size64Hint') },
    { width: 128, height: 128, label: '128×128', hint: t('schema.texture.size128Hint') },
    { width: 176, height: 166, label: '176×166', hint: t('schema.texture.sizeGuiHint') }
  ]
}

export const TEXTURE_SIZE_OPTIONS: {
  width: number
  height: number
  label: string
  hint: string
}[] = buildTextureSizeOptions()

export function getTextureSizeOptions(locale?: SharedLocale): typeof TEXTURE_SIZE_OPTIONS {
  return buildTextureSizeOptions(locale)
}

/** 缩放范围（显示倍率） */
export const TEXTURE_ZOOM_MIN = 1
export const TEXTURE_ZOOM_MAX = 16
export const TEXTURE_ZOOM_DEFAULT = 12

/** 规范化单个像素值：容忍省略 '#' 的旧写法，保留 8 位透明度，非法值一律转透明 */
export function normalizePixel(value: string): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  const c = parsePixel(trimmed.startsWith('#') ? trimmed : `#${trimmed}`)
  return c ? formatPixel(c) : ''
}

/** 新建一个全透明的 16×16 材质 */
export function createDefaultTexture(id: string): TextureSchema {
  const now = Date.now()
  const width = 16
  const height = 16
  return {
    kind: 'texture',
    id: id || 'new_texture',
    displayName: id || sharedT('schema.texture.newTexture'),
    description: '',
    category: 'block',
    width,
    height,
    pixels: new Array(width * height).fill(''),
    createdAt: now,
    updatedAt: now
  }

}

/**
 * 存盘前规范化：像素值统一 #rrggbb 小写、非法值清透明、长度校正到 width*height。
 * 尺寸异常时按 width*height 重建全透明画布（防御手改 JSON）。
 */
export function normalizeTextureSchema(def: TextureSchema): TextureSchema {
  const width = clampSize(def.width, 16)
  const height = clampSize(def.height, 16)
  const pixels: string[] = new Array(width * height).fill('')
  if (Array.isArray(def.pixels)) {
    for (let i = 0; i < Math.min(def.pixels.length, pixels.length); i++) {
      pixels[i] = normalizePixel(def.pixels[i])
    }
  }
  return {
    ...def,
    width,
    height,
    pixels,
    exportPath: typeof def.exportPath === 'string' && def.exportPath.trim() ? def.exportPath : undefined
  }
}

/** 校验；返回错误消息，合法返回 null */
export function validateTextureSchema(def: TextureSchema): string | null {
  if (!validateContentId(def.id)) {
    return sharedT('schema.common.errRegistryName')
  }
  if (!(def.displayName || '').trim()) {
    return sharedT('schema.common.errDisplayNamePlain')
  }
  if (!TEXTURE_CATEGORY_OPTIONS.some((o) => o.value === def.category)) {
    return sharedT('schema.texture.errCategoryInvalid')
  }
  if (!Number.isInteger(def.width) || def.width < 1 || def.width > 1024) {
    return sharedT('schema.texture.errWidthRange')
  }
  if (!Number.isInteger(def.height) || def.height < 1 || def.height > 1024) {
    return sharedT('schema.texture.errHeightRange')
  }
  if (!Array.isArray(def.pixels) || def.pixels.length !== def.width * def.height) {
    return sharedT('schema.texture.errPixelLength', { n: def.width * def.height })
  }
  return null
}

/** 尺寸白名单：方形 16/32/64/128/256 与 GUI 176×166，其余按 16 处理 */
function clampSize(value: number, fallback: number): number {
  const allowed = [16, 32, 64, 128, 256, 166, 176]
  return allowed.includes(value) ? value : fallback
}

/**
 * 调整画布尺寸：保留左上角重叠区域的已有像素。
 * 返回新像素数组；尺寸不变时返回原引用。
 */
export function resizePixels(
  pixels: string[],
  from: { width: number; height: number },
  to: { width: number; height: number }
): string[] {
  if (from.width === to.width && from.height === to.height) return pixels
  const next: string[] = new Array(to.width * to.height).fill('')
  const copyW = Math.min(from.width, to.width)
  const copyH = Math.min(from.height, to.height)
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      next[y * to.width + x] = normalizePixel(pixels[y * from.width + x])
    }
  }
  return next
}
