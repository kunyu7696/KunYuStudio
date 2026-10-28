#!/usr/bin/env node
/**
 * verify-dist-freshness.cjs
 * =========================
 * 产物陈旧检测：
 * build:win 后自动比对 dist 与工作区的关键标记串 / 资源哈希，
 * 不一致就 exit 1，杜绝"源码修了产物没修"整类问题。
 *
 * 用法：node scripts/verify-dist-freshness.cjs
 *       （由 package.json build:win 在 electron-builder 之后自动调用）
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')

// 各平台 unpacked 目录形态不同：win-unpacked / mac(universal 或 per-arch).app/Contents/Resources / linux-unpacked
function resolveDistResources() {
  const candidates =
    process.platform === 'darwin'
      ? ['mac', 'mac-arm64'].map((d) =>
          path.join(ROOT, 'dist', d, 'KunYu Studio.app', 'Contents', 'Resources')
        )
      : process.platform === 'linux'
        ? [path.join(ROOT, 'dist', 'linux-unpacked', 'resources')]
        : [path.join(ROOT, 'dist', 'win-unpacked', 'resources')]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0]
}
const DIST = resolveDistResources()

function fail(msg) {
  console.error('[verify-dist-freshness] FAIL:', msg)
  process.exit(1)
}

function sha256File(p) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(p))
  return h.digest('hex')
}

// 1. 主进程产物必须包含本轮修复的关键标记串 + app.asar 内副本与工作区一致
// 判别串单一事实源：scripts/dist-freshness-markers.json（
// 判别串必须随修复更新，否则"永久通过、失去鉴别力"；
// 打包前 assert-out-fresh.cjs 对 out/ 消费同一份清单）
const asarPath = path.join(DIST, 'app.asar')
if (!fs.existsSync(asarPath)) fail('app.asar 不存在：' + asarPath)
const localIndex = path.join(ROOT, 'out', 'main', 'index.js')
if (!fs.existsSync(localIndex)) fail('out/main/index.js 不存在（需先跑 electron-vite build）')
const indexJs = fs.readFileSync(localIndex, 'utf-8')
const requiredMarkers = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'dist-freshness-markers.json'), 'utf-8')
).requiredMarkers
for (const m of requiredMarkers) {
  if (!indexJs.includes(m)) fail('out/main/index.js 缺失标记串：' + m + '（源码已修但 vite build 未跑）')
}
// 比对 app.asar 内 out/main/index.js 的 integrity 与工作区 SHA256
const asar = require('@electron/asar')
const asarHeader = asar.getRawHeader(asarPath).header
const asarIndex = asarHeader.files.out.files.main.files['index.js']
const localHash = sha256File(localIndex)
if (asarIndex?.integrity?.hash !== localHash) {
  fail('app.asar/out/main/index.js 与工作区不一致（electron-builder 未用最新 out/ 重新打包）')
}

// 2. dsh-pet-kunyu/lib 必须随包分发（petService 打包态动态 import 依赖）
const petHost = path.join(DIST, 'dsh-pet-kunyu', 'lib', 'pet-host.js')
const petBridge = path.join(DIST, 'dsh-pet-kunyu', 'lib', 'agent-event-bridge.js')
if (!fs.existsSync(petHost)) fail('dsh-pet-kunyu/lib/pet-host.js 未进 dist（extraResources 未生效）')
if (!fs.existsSync(petBridge)) fail('dsh-pet-kunyu/lib/agent-event-bridge.js 未进 dist')

// 3. observer agent jar 必须与工作区一致（构建前置已由 build-observer-agent.cjs 重建）
// 注意：观察器已从 Fabric mod 迁移为 javaagent 通用探针，
// 打包路径为 resources/observer-agent/kunyu-observer-agent.jar（见 electron-builder.yml）。
const distJar = path.join(DIST, 'observer-agent', 'kunyu-observer-agent.jar')
const srcJar = path.join(ROOT, 'resources', 'observer-agent', 'dist', 'kunyu-observer-agent.jar')
if (!fs.existsSync(distJar)) fail('dist 缺失 observer agent jar')
if (!fs.existsSync(srcJar)) fail('工作区缺失 observer agent jar（需先跑 build-observer-agent.cjs）')
if (sha256File(distJar) !== sha256File(srcJar)) {
  fail('dist observer agent jar 与工作区不一致（需重建 observer jar 后重新打包）')
}

// 4. manifest.json generatedAt 不得早于 7 天前（防止手改未重新生成）
const manifestPath = path.join(DIST, 'ai-reference', 'manifest.json')
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  const generatedAt = new Date(manifest.generatedAt).getTime()
  if (Date.now() - generatedAt > 7 * 24 * 3600 * 1000) {
    fail(`manifest.json generatedAt 过旧：${manifest.generatedAt}（需重新生成）`)
  }
  if (!Array.isArray(manifest.versionFingerprints) || manifest.versionFingerprints.length < 20) {
    fail(`manifest.json versionFingerprints 数量异常：${manifest.versionFingerprints?.length}`)
  }
}

console.log('[verify-dist-freshness] PASS: dist 产物与工作区一致')
