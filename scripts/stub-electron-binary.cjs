/**
 * electron 44 起移除了 postinstall 与 ELECTRON_SKIP_BINARY_DOWNLOAD 支持：
 * npm ci 只装 JS 壳，二进制在首次 require('electron') 时由 index.js 惰性
 * spawnSync 下载（同步阻塞事件循环，~100MB）。CI 冷缓存下该下载需几十秒，
 * vitest 按墙钟判 5s 测试超时；多 worker 并发下载还会互踩 dist 解压目录
 * （File exists, os error 17）。
 *
 * 单测从不启动 electron，只需要 require('electron') 秒回路径字符串——
 * index.js 的快路径只检查 path.txt 与 dist/<exe> 的存在性。本脚本在
 * npm ci 后预置这两个桩文件，彻底掐断惰性下载链路。
 * path.txt 已存在（本地 dev、electron ≤43 或缓存恢复）时直接跳过，零影响。
 */
const fs = require('node:fs')
const path = require('node:path')

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
const pathFile = path.join(electronDir, 'path.txt')

if (!fs.existsSync(electronDir)) {
  console.error('[stub-electron-binary] node_modules/electron 不存在，请先 npm ci')
  process.exit(1)
}

if (fs.existsSync(pathFile)) {
  console.log('[stub-electron-binary] path.txt 已存在，跳过')
  process.exit(0)
}

const exe =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron'

const fullPath = path.join(electronDir, 'dist', exe)
fs.mkdirSync(path.dirname(fullPath), { recursive: true })
fs.writeFileSync(fullPath, '')
fs.writeFileSync(pathFile, exe)
console.log(`[stub-electron-binary] 已预置桩：path.txt → ${exe}`)
