/**
 * 纹理层烘焙工具（B2-2，v2）：canvas 2D 按层序 normal 混合 + globalAlpha=opacity。
 *
 * 设计要点：
 * - 仅渲染层使用（依赖 DOM canvas）；shared 层不引用；
 * - Image 缓存：dataURL 解码异步，缓存避免每笔画重复解码；
 * - 烘焙结果 = 单张 PNG dataURL（写回 texture.data，导出/渲染/生成全部不动）。
 */
import type { TextureLayer } from '../../../../shared/modeler/types'

/** dataURL → HTMLImageElement 缓存（避免重复解码） */
const imgCache = new Map<string, HTMLImageElement>()

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = imgCache.get(dataUrl)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      imgCache.set(dataUrl, img)
      resolve(img)
    }
    img.onerror = () => reject(new Error('贴图解码失败'))
    img.src = dataUrl
  })
}

/** 清空缓存（文档关闭/贴图删除时调用，避免内存泄漏） */
export function clearBakeCache(): void {
  imgCache.clear()
}

/**
 * 烘焙层栈为单张 PNG dataURL。
 * 层序：数组索引 0 = 最底层，依次向上叠加。
 */
export async function bakeLayers(
  layers: readonly TextureLayer[],
  width: number,
  height: number
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')

  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    const img = await loadImage(layer.data)
    ctx.globalAlpha = Math.min(1, Math.max(0, layer.opacity))
    ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(img, 0, 0, width, height)
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  return canvas.toDataURL('image/png')
}

/** 生成全透明 PNG dataURL（层初始内容） */
export function transparentPng(width: number, height: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas.toDataURL('image/png')
}
