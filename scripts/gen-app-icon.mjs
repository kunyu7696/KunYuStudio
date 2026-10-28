/**
 * 应用图标生成：去白底（边缘洪水填充，保护主体内部白色元素）→
 * 内容包围盒裁剪 → 透明方形画布居中 → 输出 512 PNG + 多尺寸 ICO。
 *
 * 用法：node scripts/gen-app-icon.mjs <源图路径>
 * 产物：resources/icon.png、resources/build/icon.png、resources/build/icon.ico
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = process.argv[2]
if (!src) throw new Error('用法：node scripts/gen-app-icon.mjs <源图路径>')

/* ---------------- 1. 读原始像素 ---------------- */
const { data, info } = await sharp(resolve(src))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const W = info.width
const H = info.height
const px = new Uint8Array(data) // RGBA
const alpha = new Uint8Array(W * H).fill(255)

/** 类白判定：亮度高且低饱和（保护浅蓝发丝等彩色浅区） */
function whitish(i) {
  const o = i * 4
  const r = px[o], g = px[o + 1], b = px[o + 2]
  const mn = Math.min(r, g, b)
  const mx = Math.max(r, g, b)
  return mn >= 235 && mx - mn <= 28
}

/* ---------------- 2. 从四边 BFS 洪水填充背景 ---------------- */
const visited = new Uint8Array(W * H)
const queue = []
for (let x = 0; x < W; x++) {
  queue.push(x, (H - 1) * W + x)
}
for (let y = 0; y < H; y++) {
  queue.push(y * W, y * W + W - 1)
}
let head = 0
while (head < queue.length) {
  const i = queue[head++]
  if (visited[i]) continue
  visited[i] = 1
  if (!whitish(i)) continue
  alpha[i] = 0
  const x = i % W
  const y = (i / W) | 0
  if (x > 0) queue.push(i - 1)
  if (x < W - 1) queue.push(i + 1)
  if (y > 0) queue.push(i - W)
  if (y < H - 1) queue.push(i + W)
}

/* ---------------- 3. 边缘羽化：贴透明边的半白像素给部分透明，去白边光晕 ---------------- */
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (alpha[i] === 0) continue
    const nearHole =
      (x > 0 && alpha[i - 1] === 0) ||
      (x < W - 1 && alpha[i + 1] === 0) ||
      (y > 0 && alpha[i - W] === 0) ||
      (y < H - 1 && alpha[i + W] === 0)
    if (!nearHole) continue
    const o = i * 4
    const mn = Math.min(px[o], px[o + 1], px[o + 2])
    if (mn > 200) {
      // 越接近纯白越透明：mn=235+ → 0，mn=200 → 保持
      alpha[i] = Math.max(0, Math.min(255, Math.round(((235 - mn) / 35) * 255)))
    }
  }
}

/* ---------------- 4. 写回 alpha 并求内容包围盒 ---------------- */
let minX = W, minY = H, maxX = -1, maxY = -1
for (let i = 0; i < W * H; i++) {
  px[i * 4 + 3] = alpha[i]
  if (alpha[i] > 8) {
    const x = i % W
    const y = (i / W) | 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
}
if (maxX < 0) throw new Error('去背失败：未找到主体')
const bw = maxX - minX + 1
const bh = maxY - minY + 1
console.log(`主体包围盒: ${bw}x${bh} @ (${minX},${minY})，原图 ${W}x${H}`)

/* ---------------- 5. 裁剪 → 方形透明画布居中 → 512 ---------------- */
const cropped = await sharp(px, { raw: { width: W, height: H, channels: 4 } })
  .extract({ left: minX, top: minY, width: bw, height: bh })
  .png()
  .toBuffer()

const side = Math.max(bw, bh)
const canvas = await sharp({
  create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
})
  .composite([{ input: cropped, left: ((side - bw) / 2) | 0, top: ((side - bh) / 2) | 0 }])
  .png()
  .toBuffer()

const png512 = await sharp(canvas).resize(512, 512, { kernel: 'lanczos3' }).png().toBuffer()

/* ---------------- 6. 输出 PNG ---------------- */
writeFileSync('resources/icon.png', png512)
writeFileSync('resources/build/icon.png', png512)
console.log('resources/icon.png / resources/build/icon.png 已写入 (512x512)')

/* ---------------- 7. 生成多尺寸 ICO（PNG 压缩条目，Vista+ 标准） ---------------- */
const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(
  sizes.map((s) => sharp(canvas).resize(s, s, { kernel: 'lanczos3' }).png().toBuffer())
)
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(sizes.length, 4)
const dirLen = 16 * sizes.length
let offset = 6 + dirLen
const dir = Buffer.alloc(dirLen)
for (let k = 0; k < sizes.length; k++) {
  const o = k * 16
  dir.writeUInt8(sizes[k] === 256 ? 0 : sizes[k], o) // 0 表示 256
  dir.writeUInt8(sizes[k] === 256 ? 0 : sizes[k], o + 1)
  dir.writeUInt8(0, o + 2) // 调色板
  dir.writeUInt8(0, o + 3) // reserved
  dir.writeUInt16LE(1, o + 4) // planes
  dir.writeUInt16LE(32, o + 6) // bitcount
  dir.writeUInt32LE(pngs[k].length, o + 8)
  dir.writeUInt32LE(offset, o + 12)
  offset += pngs[k].length
}
writeFileSync('resources/build/icon.ico', Buffer.concat([header, dir, ...pngs]))
console.log(`resources/build/icon.ico 已写入（${sizes.join('/')}px 共 ${sizes.length} 尺寸）`)
