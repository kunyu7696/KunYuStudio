/**
 * 贴图缓存纯逻辑（自 ModelerViewport.vue 抽离，行为保持逐字一致）：
 * 贴图 canvas 条目生命周期（显示画布 + 多层模式独立绘画画布）、共享材质缓存、
 * 已删除贴图条目卸载与整体销毁。条目/材质 Map 与文档/活动层快照由宿主注入，
 * 本模块不持有 Vue 响应式状态。
 */
import * as THREE from 'three'
import type { ModelDocument, TextureId } from '../../../../../shared/modeler/types'

/** 贴图缓存条目（跨重建复用；绘画直接在 canvas 上落笔） */
export interface TexEntry {
  id: TextureId
  w: number
  h: number
  /** 显示画布（烘焙结果，THREE.CanvasTexture 绑定） */
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  /** 已加载进 canvas 的 data URL（与文档一致时跳过重载，避免绘画提交后闪烁） */
  loadedData: string
  /** 绘画画布（多层模式 = 活动层像素；单层模式 = 与 canvas 同一对象） */
  paintCanvas: HTMLCanvasElement
  paintCtx: CanvasRenderingContext2D
  /** 绘画画布已加载的 data URL（活动层像素） */
  loadedPaintData: string
}

/** 贴图缓存依赖的宿主上下文（Map 持有于宿主；文档/活动层用 getter 读取实时值） */
export interface TexCacheCtx {
  entries: Map<TextureId, TexEntry>
  mats: Map<TextureId, THREE.MeshLambertMaterial>
  getDoc: () => ModelDocument | null
  getActiveLayerId: () => string | null
}

/** 确保贴图 canvas 条目存在且内容与文档一致（data 变化时异步重载） */
export function ensureTextureEntry(
  ctx: TexCacheCtx,
  tex: { id: TextureId; width: number; height: number; data: string }
): TexEntry {
  let entry = ctx.entries.get(tex.id)
  if (!entry) {
    const canvas = document.createElement('canvas')
    canvas.width = tex.width
    canvas.height = tex.height
    const c2d = canvas.getContext('2d')
    if (!c2d) throw new Error('无法创建贴图画布上下文')
    const t = new THREE.CanvasTexture(canvas)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    t.generateMipmaps = false
    t.colorSpace = THREE.SRGBColorSpace
    entry = {
      id: tex.id,
      w: tex.width,
      h: tex.height,
      canvas,
      ctx: c2d,
      tex: t,
      loadedData: '',
      paintCanvas: canvas,
      paintCtx: c2d,
      loadedPaintData: ''
    }
    ctx.entries.set(tex.id, entry)
  }
  if (entry.loadedData !== tex.data) {
    const dataUrl = tex.data
    const img = new Image()
    img.onload = () => {
      entry.ctx.clearRect(0, 0, entry.w, entry.h)
      entry.ctx.drawImage(img, 0, 0, entry.w, entry.h)
      entry.loadedData = dataUrl
      entry.tex.needsUpdate = true
      // 多层模式下：显示画布更新后，绘画画布同步为活动层像素
      syncPaintCanvas(ctx, entry)
    }
    img.src = dataUrl
  }
  return entry
}

/** 多层模式下同步绘画画布为活动层像素（无层时绘画画布 = 显示画布） */
export function syncPaintCanvas(ctx: TexCacheCtx, entry: TexEntry): void {
  const d = ctx.getDoc()
  if (!d) return
  const tex = d.textures[entry.id]
  if (!tex || !tex.layers || tex.layers.length === 0) {
    // 单层模式：绘画画布与显示画布同一对象
    entry.paintCanvas = entry.canvas
    entry.paintCtx = entry.ctx
    entry.loadedPaintData = entry.loadedData
    return
  }
  // 多层模式：绘画画布独立，加载活动层像素
  if (entry.paintCanvas === entry.canvas) {
    // 首次创建独立绘画画布
    const pc = document.createElement('canvas')
    pc.width = entry.w
    pc.height = entry.h
    const pctx = pc.getContext('2d')
    if (!pctx) return
    entry.paintCanvas = pc
    entry.paintCtx = pctx
  }
  const activeLayer = tex.layers.find((l) => l.id === ctx.getActiveLayerId()) ?? tex.layers[0]
  if (!activeLayer) return
  if (entry.loadedPaintData === activeLayer.data) return
  const img = new Image()
  img.onload = () => {
    entry.paintCtx.clearRect(0, 0, entry.w, entry.h)
    entry.paintCtx.drawImage(img, 0, 0, entry.w, entry.h)
    entry.loadedPaintData = activeLayer.data
  }
  img.src = activeLayer.data
}

/** 共享贴图材质（须在 ensureTextureEntry 之后调用） */
export function textureMaterial(ctx: TexCacheCtx, texId: TextureId): THREE.MeshLambertMaterial | null {
  const cached = ctx.mats.get(texId)
  if (cached) return cached
  const entry = ctx.entries.get(texId)
  if (!entry) return null
  const m = new THREE.MeshLambertMaterial({
    map: entry.tex,
    transparent: true,
    alphaTest: 0.02, // 仅剔除全透明像素，半透明像素正常渲染
    side: THREE.FrontSide
  })
  ctx.mats.set(texId, m)
  return m
}

/** 卸载文档中已删除的贴图条目 */
export function pruneTextures(ctx: TexCacheCtx): void {
  const d = ctx.getDoc()
  const keep = new Set(d ? Object.keys(d.textures) : [])
  for (const [id, entry] of ctx.entries) {
    if (!keep.has(id)) {
      entry.tex.dispose()
      ctx.entries.delete(id)
    }
  }
}

/** 释放全部共享贴图材质（场景模型清理时调用） */
export function disposeTextureMats(ctx: TexCacheCtx): void {
  for (const m of ctx.mats.values()) m.dispose()
  ctx.mats.clear()
}

/** 释放全部贴图条目（组件销毁时调用） */
export function disposeAllTextures(ctx: TexCacheCtx): void {
  for (const entry of ctx.entries.values()) entry.tex.dispose()
  ctx.entries.clear()
}
