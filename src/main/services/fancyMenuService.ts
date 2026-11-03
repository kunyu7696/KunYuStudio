/**
 * FancyMenu 开始菜单——主进程服务。
 *
 * - Fabric 路径：config/fancymenu/layout.json
 * - Forge  路径：config/fancymenu_forge/layout.json（部分 Forge 整合包仍用 config/fancymenu/layout.json）
 *
 * 读取 JSON 后抽取 elements 数组，只解析 P1 支持的四种元素（button/image/text/rect），
 * 其余类型原样保留在 raw 里；保存时整份 raw 回写，覆盖 elements 字段。
 *
 * 关键：Fabric/Forge 探测——优先 Forge 专用路径，没找到再查 Fabric 路径；
 * 两边都没有时，按 loader 类型选定初始创建的目录。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  FancyMenuLayout,
  FancyMenuReadResult,
  FmElement,
  FmElementBase
} from '../../shared/types/fancymenu'

/** P1+P2 支持的元素类型白名单 */
const SUPPORTED_TYPES = new Set(['button', 'image', 'text', 'rect', 'slides', 'particles'])

/** 按 loader 类型返回候选路径（先 Forge 专用，再 Fabric） */
function candidatePaths(root: string): string[] {
  const fabric = join(root, 'config', 'fancymenu', 'layout.json')
  const forge = join(root, 'config', 'fancymenu_forge', 'layout.json')
  return [forge, fabric]
}

/** 探测实际存在的文件路径；都不存在返回 null */
function detectPath(root: string): string | null {
  for (const p of candidatePaths(root)) {
    if (existsSync(p)) return p
  }
  return null
}

/** 从 loader 推断默认创建路径（未知 loader 时回退 Fabric） */
function defaultPath(root: string, loader?: string): string {
  if (loader === 'forge' || loader === 'neoforge')
    return join(root, 'config', 'fancymenu_forge', 'layout.json')
  return join(root, 'config', 'fancymenu', 'layout.json')
}

// ---------------------------------------------------------------------------
// 解析 / 序列化
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function pick<T>(obj: Record<string, unknown>, key: string, fallback: T): T {
  const v = obj[key]
  return v === undefined || v === null ? fallback : (v as T)
}

function parseElement(raw: Record<string, unknown>): FmElement | null {
  const type = pick<string>(raw, 'type', '')
  if (!SUPPORTED_TYPES.has(type)) return null
  const base: FmElementBase = {
    id: pick<string>(raw, 'id', `el_${Math.random().toString(36).slice(2, 9)}`),
    name: pick<string>(raw, 'name', type),
    anchor: pick<string>(raw, 'anchor', 'top_left') as FmElement['anchor'],
    x: pick<number>(raw, 'x', 0),
    y: pick<number>(raw, 'y', 0),
    width: pick<number>(raw, 'width', 100),
    height: pick<number>(raw, 'height', 20),
    z: pick<number>(raw, 'z', 0)
  }
  switch (type) {
    case 'button': {
      const act = isRecord(raw.action) ? raw.action : null
      const action = act
        ? {
            type: (act.type === 'url' ? 'url' : 'command') as 'command' | 'url',
            value: pick<string>(act as Record<string, unknown>, 'value', '')
          }
        : undefined
      return {
        ...base,
        type: 'button',
        text: pick<string>(raw, 'text', '按钮'),
        color: pick<string | undefined>(raw, 'color', undefined),
        hoverColor: pick<string | undefined>(raw, 'hoverColor', undefined),
        texture: pick<string | undefined>(raw, 'texture', undefined),
        action
      }
    }
    case 'image':
      return {
        ...base,
        type: 'image',
        url: pick<string>(raw, 'url', '')
      }
    case 'text':
      return {
        ...base,
        type: 'text',
        text: pick<string>(raw, 'text', ''),
        color: pick<string | undefined>(raw, 'color', undefined),
        size: pick<number | undefined>(raw, 'size', undefined)
      }
    case 'rect':
      return {
        ...base,
        type: 'rect',
        color: pick<string>(raw, 'color', '#FFFFFF')
      }
    case 'slides': {
      const rawSlides = Array.isArray(raw.slides) ? raw.slides : []
      const slides = rawSlides
        .filter((s) => isRecord(s))
        .map((s) => {
          const rec = s as Record<string, unknown>
          return {
            type: (rec.type === 'local' ? 'local' : 'image') as 'image' | 'local',
            path: pick<string>(rec, 'path', '')
          }
        })
      const fitRaw = pick<string>(raw, 'fitType', 'stretch')
      return {
        ...base,
        type: 'slides',
        slides,
        duration: pick<number>(raw, 'duration', 5000),
        fadeTime: pick<number>(raw, 'fadeTime', 1000),
        fitType: (fitRaw === 'crop' || fitRaw === 'fill' ? fitRaw : 'stretch') as
          | 'stretch'
          | 'crop'
          | 'fill'
      }
    }
    case 'particles':
      return {
        ...base,
        type: 'particles',
        particleId: pick<string>(raw, 'particleId', 'minecraft:flame'),
        amount: pick<number>(raw, 'amount', 20),
        originX: pick<number>(raw, 'originX', 0.5),
        originY: pick<number>(raw, 'originY', 0.5),
        spreadX: pick<number>(raw, 'spreadX', 1),
        spreadY: pick<number>(raw, 'spreadY', 1),
        speedX: pick<number>(raw, 'speedX', 0.1),
        speedY: pick<number>(raw, 'speedY', 0.1),
        size: pick<number | undefined>(raw, 'size', undefined)
      }
    default:
      return null
  }
}

/** element 转 JSON（只输出支持字段；不保留未知字段，因为 FancyMenu 本体也没有） */
function serializeElement(el: FmElement): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    name: el.name,
    anchor: el.anchor,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    z: el.z
  }
  switch (el.type) {
    case 'button':
      Object.assign(base, {
        text: el.text,
        color: el.color,
        hoverColor: el.hoverColor,
        texture: el.texture,
        action: el.action
      })
      break
    case 'image':
      Object.assign(base, { url: el.url })
      break
    case 'text':
      Object.assign(base, { text: el.text, color: el.color, size: el.size })
      break
    case 'rect':
      Object.assign(base, { color: el.color })
      break
    case 'slides':
      Object.assign(base, {
        slides: el.slides.map((s) => ({ type: s.type, path: s.path })),
        duration: el.duration,
        fadeTime: el.fadeTime,
        fitType: el.fitType
      })
      break
    case 'particles':
      Object.assign(base, {
        particleId: el.particleId,
        amount: el.amount,
        originX: el.originX,
        originY: el.originY,
        spreadX: el.spreadX,
        spreadY: el.spreadY,
        speedX: el.speedX,
        speedY: el.speedY,
        size: el.size
      })
      break
  }
  // 清理 undefined 字段（JSON 序列化会自动过滤，但显式清理更干净）
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k]
  return base
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/** 探测路径不存在时，返回带默认空白 elements 的 result；不写磁盘 */
export function readFancyMenu(
  root: string,
  loader?: string
): FancyMenuReadResult | { filePath: null; error: string } {
  const path = detectPath(root) ?? defaultPath(root, loader)
  if (!existsSync(path)) {
    return { filePath: path, raw: {}, elements: [] }
  }
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch (err) {
    return { filePath: path, error: `读取失败: ${(err as Error).message}` }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    return { filePath: path, error: `layout.json 解析失败: ${(err as Error).message}` }
  }
  if (!isRecord(json)) {
    return { filePath: path, error: 'layout.json 顶层不是 JSON 对象' }
  }
  const raw = json as Record<string, unknown>
  const elements: FmElement[] = Array.isArray(raw.elements)
    ? raw.elements
        .filter((e) => isRecord(e))
        .map((e) => parseElement(e as Record<string, unknown>))
        .filter((e): e is FmElement => !!e)
    : []
  return { filePath: path, raw, elements }
}

/** 保存：覆盖 elements 字段，保留 raw 里其他未知字段（FancyMenu 未来版本可能加） */
export function writeFancyMenu(
  root: string,
  elements: FmElement[],
  loader?: string
): { ok: true; filePath: string } | { ok: false; error: string } {
  const detected = detectPath(root)
  const path = detected ?? defaultPath(root, loader)

  // 读旧文件保留未知字段；不存在时构造最小外壳
  let raw: Record<string, unknown> = {}
  if (detected && existsSync(path)) {
    try {
      const json = JSON.parse(readFileSync(path, 'utf-8'))
      if (isRecord(json)) raw = json
    } catch {
      // 读/解析失败就当作新文件覆盖，用户已经知道自己在干什么
      raw = {}
    }
  }
  raw.elements = elements.map(serializeElement)

  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(raw, null, 2), 'utf-8')
  } catch (err) {
    return { ok: false, error: `写入失败: ${(err as Error).message}` }
  }
  return { ok: true, filePath: path }
}

/** 构造一个最小合法的空白 layout（用于新建） */
export function emptyLayout(): FancyMenuLayout {
  return { elements: [] }
}
