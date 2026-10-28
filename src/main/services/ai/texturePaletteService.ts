/**
 * 贴图工坊 · 项目级色板与像素化偏好服务。
 *
 * 落点：<projectRoot>/.kunyu/texture-palette.json（根级 .kunyu/*.json 不被内容扫描器扫到）。
 * 「项目级一致性」的落点：同项目所有贴图共用一份锁定色板与像素化偏好，
 * 保证导出资产的色板风格统一（代价是超出色板的颜色会被压到最近色）。
 * 读取失败一律回退默认值，绝不抛错；默认值与 pixelize 默认行为一致。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 项目级贴图色板与像素化偏好。 */
export interface TexturePalette {
  /** 锁定色板（"#rrggbb"，空数组=不锁定，回退 median-cut 自动取色） */
  palette: string[]
  maxColors: number
  dither: 'floyd' | 'none'
  outline: boolean
  outlineFactor: number
  downsample: 'area' | 'nearest'
}

/** 默认值（与 pixelize 管线默认行为一致） */
export const DEFAULT_TEXTURE_PALETTE: TexturePalette = {
  palette: [],
  maxColors: 32,
  dither: 'floyd',
  outline: true,
  outlineFactor: 0.5,
  downsample: 'area'
}

function palettePath(root: string): string {
  return join(root, '.kunyu', 'texture-palette.json')
}

/** 把任意未知输入规整为合法 TexturePalette（非法字段回退默认/夹取，绝不抛错）。 */
function normalizePalette(raw: unknown): TexturePalette {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const maxColors =
    typeof o.maxColors === 'number' && Number.isFinite(o.maxColors)
      ? Math.max(2, Math.min(256, Math.round(o.maxColors)))
      : DEFAULT_TEXTURE_PALETTE.maxColors
  const outlineFactor =
    typeof o.outlineFactor === 'number' && Number.isFinite(o.outlineFactor)
      ? Math.max(0, Math.min(1, o.outlineFactor))
      : DEFAULT_TEXTURE_PALETTE.outlineFactor
  return {
    palette: Array.isArray(o.palette)
      ? o.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))
      : [],
    maxColors,
    dither: o.dither === 'none' ? 'none' : 'floyd',
    outline: typeof o.outline === 'boolean' ? o.outline : DEFAULT_TEXTURE_PALETTE.outline,
    outlineFactor,
    downsample: o.downsample === 'nearest' ? 'nearest' : 'area'
  }
}

/** 读取项目级色板；文件不存在/JSON 损坏/字段非法一律回退默认值，绝不抛错。 */
export function readTexturePalette(root: string): TexturePalette {
  const p = palettePath(root)
  if (!existsSync(p)) return { ...DEFAULT_TEXTURE_PALETTE, palette: [] }
  try {
    return normalizePalette(JSON.parse(readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')))
  } catch {
    return { ...DEFAULT_TEXTURE_PALETTE, palette: [] }
  }
}

/**
 * 合并写入项目级色板与像素化偏好（未给的字段保留原值），返回规整后的最新值。
 * .kunyu 目录不存在则创建；pretty JSON 落盘。
 */
export function writeTexturePalette(root: string, patch: Partial<TexturePalette>): TexturePalette {
  const merged: TexturePalette = { ...readTexturePalette(root) }
  if (patch.palette !== undefined) merged.palette = patch.palette
  if (patch.maxColors !== undefined) merged.maxColors = patch.maxColors
  if (patch.dither !== undefined) merged.dither = patch.dither
  if (patch.outline !== undefined) merged.outline = patch.outline
  if (patch.outlineFactor !== undefined) merged.outlineFactor = patch.outlineFactor
  if (patch.downsample !== undefined) merged.downsample = patch.downsample
  const clean = normalizePalette(merged)
  const dir = join(root, '.kunyu')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(palettePath(root), JSON.stringify(clean, null, 2) + '\n', 'utf-8')
  return clean
}
