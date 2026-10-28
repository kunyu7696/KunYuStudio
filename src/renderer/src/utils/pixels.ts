/**
 * 渲染层像素工具：贴图 data URL → 语义像素数组（canvas 解码为 S×S）。
 * 抽取自画廊预览加载器，供模型/贴图预览复用（非方形贴图均匀挤压）。
 */
import { formatPixel } from '../../../shared/utils/pixelColor'

export async function dataUrlToSquarePixels(dataUrl: string, size: number): Promise<string[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('贴图解码失败'))
    el.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布上下文')
  ctx.drawImage(img, 0, 0, size, size)
  const d = ctx.getImageData(0, 0, size, size).data
  const out: string[] = []
  for (let i = 0; i < size * size; i++) {
    const o = i * 4
    out.push(formatPixel({ r: d[o]!, g: d[o + 1]!, b: d[o + 2]!, a: d[o + 3]! }))
  }
  return out
}

/** 读取 data URL 图片的原始边长（宽；MC 贴图按方形处理） */
export async function dataUrlImageSize(dataUrl: string): Promise<number> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('贴图解码失败'))
    el.src = dataUrl
  })
  return img.naturalWidth || 16
}
