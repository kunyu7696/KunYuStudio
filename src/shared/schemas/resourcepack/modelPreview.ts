/**
 * 资源包模型 JSON → 只读预览的纯函数适配层。
 *
 * MC Java 模型 JSON 的 elements[] 与 KunYu 内容管线的 CubeElement 同构
 * （from/to/faces.{uv,texture,rotation}/rotation/shade），可直接喂给
 * ModelPreview；这里只负责解析、主贴图变量选择与贴图引用 → 包内路径换算。
 * 父模型（parent）继承的元素不解析（原版父模型不在包内），UI 层注明即可。
 */
import type { CubeElement } from '../../types/content'

/** 资源包模型 JSON 的相关子集（其余字段 display/gui_light 等忽略） */
export interface JavaModelJson {
  parent?: string
  textures?: Record<string, string>
  elements?: CubeElement[]
}

/** 解析模型 JSON 文本；非法返回 null */
export function parseJavaModel(text: string): JavaModelJson | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const out: JavaModelJson = {}
  if (typeof obj.parent === 'string') out.parent = obj.parent
  if (typeof obj.textures === 'object' && obj.textures !== null && !Array.isArray(obj.textures)) {
    const textures: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj.textures as Record<string, unknown>)) {
      if (typeof v === 'string') textures[k] = v
    }
    out.textures = textures
  }
  if (Array.isArray(obj.elements)) {
    // elements 结构信任 MC 格式（预览只读，不做深校验；坏元素由预览层兜底）
    out.elements = obj.elements as CubeElement[]
  }
  return out
}

/**
 * 选主贴图引用：优先 all / layer0 / texture / particle / side，否则取首个可解析值。
 * 支持一跳 '#var' 间接引用（MC 惯例：值以 # 开头表示引用另一个贴图变量）。
 * 全部不可解析返回 null。
 */
export function resolveMainTextureRef(textures: Record<string, string> | undefined): string | null {
  if (!textures) return null
  const lookup = (key: string): string | null => {
    const v = textures[key]
    if (!v) return null
    return v.startsWith('#') ? (textures[v.slice(1)] ?? null) : v
  }
  for (const key of ['all', 'layer0', 'texture', 'particle', 'side']) {
    const hit = lookup(key)
    if (hit && !hit.startsWith('#')) return hit
  }
  for (const key of Object.keys(textures)) {
    const hit = lookup(key)
    if (hit && !hit.startsWith('#')) return hit
  }
  return null
}

/**
 * 贴图引用 → 包内相对路径。
 * 'mymod:block/ruby' → 'assets/mymod/textures/block/ruby.png'；
 * 缺命名空间按 minecraft 处理；非法引用返回 null。
 */
export function textureRefToPackPath(ref: string): string | null {
  const m = /^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.exec(ref)
  const ns = m ? m[1] : 'minecraft'
  const path = m ? m[2] : /^[a-z0-9_./-]+$/.test(ref) ? ref : null
  if (!path) return null
  return `assets/${ns}/textures/${path}.png`
}
