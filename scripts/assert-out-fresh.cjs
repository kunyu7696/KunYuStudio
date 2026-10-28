#!/usr/bin/env node
/**
 * assert-out-fresh.cjs
 * ====================
 * 打包前置：断言 out/ 产物不落后于 src/ 源码（含 out/main 与 out/renderer）。
 *
 * 背景（第九轮 P0）：6658529 修好了 Fabric 模板，但 out/ 停留在上一提交，
 * 三条自检全部放行"一致地陈旧"的产物，导致用户新建 Fabric 工程开箱构建失败。
 * 本脚本由 package.json 的 build:win 在 electron-vite build 之后、
 * electron-builder 之前自动调用，三重拦截：
 *   1) mtime 门：out/main 与 out/renderer 产物 mtime 均不得早于对应 src 源码最新 mtime
 *      （原版只比对 out/main，renderer 陈旧产物永远检测不到）
 *   2) 判别串门：dist-freshness-markers.json 的 requiredMarkers 必须出现在
 *      out/main/index.js 字节里（判别串随每轮修复更新，源码修了产物没修即失败）
 *   3) 渲染层判别串门：rendererMarkers（可选）必须出现在 out/renderer 的 JS 产物拼接里
 *
 * 用法：node scripts/assert-out-fresh.cjs
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUT_INDEX = path.join(ROOT, 'out', 'main', 'index.js')
const OUT_RENDERER = path.join(ROOT, 'out', 'renderer')
const MARKERS_FILE = path.join(__dirname, 'dist-freshness-markers.json')
const SRC_DIRS = ['src/main', 'src/shared', 'src/preload'].map((d) => path.join(ROOT, d))
const SRC_RENDERER = path.join(ROOT, 'src', 'renderer')
/** 文件系统时间戳精度/拷贝延迟宽限 */
const MTIME_SLACK_MS = 2000

function fail(msg) {
  console.error('[assert-out-fresh] FAIL:', msg)
  process.exit(1)
}

function walk(dir, acc, exts) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc, exts)
    else if (exts.test(e.name)) acc.push(p)
  }
  return acc
}

function newestMtime(files) {
  let m = 0
  for (const f of files) {
    const t = fs.statSync(f).mtimeMs
    if (t > m) m = t
  }
  return m
}

// ---- 1. mtime 门（main + renderer）----
if (!fs.existsSync(OUT_INDEX)) fail('out/main/index.js 不存在（需先跑 electron-vite build）')
const srcFiles = SRC_DIRS.flatMap((d) => walk(d, [], /\.(ts|tsx|vue|js|cjs|mjs|json)$/))
if (srcFiles.length === 0) fail('未找到任何 src 源码文件（目录结构异常）')
const outMtime = fs.statSync(OUT_INDEX).mtimeMs
const srcMtime = newestMtime(srcFiles)
if (outMtime + MTIME_SLACK_MS < srcMtime) {
  fail(
    `out/main/index.js（${new Date(outMtime).toISOString()}）落后于 src 最新源码` +
      `（${new Date(srcMtime).toISOString()}）——electron-vite build 未生效或被跳过，禁止打包陈旧产物`
  )
}

// 渲染层 mtime 门：out/renderer 任一产物均不得落后于 src/renderer 最新源码
if (!fs.existsSync(OUT_RENDERER)) fail('out/renderer 不存在（需先跑 electron-vite build）')
const rendererOutFiles = walk(OUT_RENDERER, [], /\.(js|css|html)$/)
if (rendererOutFiles.length === 0) fail('out/renderer 为空（需先跑 electron-vite build）')
const rendererSrcFiles = walk(SRC_RENDERER, [], /\.(ts|tsx|vue|css|scss)$/)
const rendererOutMtime = newestMtime(rendererOutFiles)
const rendererSrcMtime = rendererSrcFiles.length > 0 ? newestMtime(rendererSrcFiles) : 0
if (rendererSrcMtime > 0 && rendererOutMtime + MTIME_SLACK_MS < rendererSrcMtime) {
  fail(
    `out/renderer（最新 ${new Date(rendererOutMtime).toISOString()}）落后于 src/renderer 最新源码` +
      `（${new Date(rendererSrcMtime).toISOString()}）——渲染层产物陈旧，禁止打包`
  )
}

// ---- 2. 判别串门（main）----
const { requiredMarkers, rendererMarkers } = JSON.parse(fs.readFileSync(MARKERS_FILE, 'utf-8'))
const bundle = fs.readFileSync(OUT_INDEX, 'utf-8')
for (const m of requiredMarkers) {
  if (!bundle.includes(m)) {
    fail(`out/main/index.js 缺失判别串：${m}（源码已修但产物未重建，禁止打包陈旧产物）`)
  }
}

// ---- 3. 渲染层判别串门 ----
let rendererHit = 0
if (Array.isArray(rendererMarkers) && rendererMarkers.length > 0) {
  const rendererBundle = rendererOutFiles
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(f, 'utf-8'))
    .join('\n')
  for (const m of rendererMarkers) {
    if (!rendererBundle.includes(m)) {
      fail(`out/renderer 缺失渲染层判别串：${m}（源码已修但产物未重建，禁止打包陈旧产物）`)
    }
    rendererHit++
  }
}

console.log(
  `[assert-out-fresh] PASS: out 产物不落后于 src（main ${new Date(outMtime).toISOString()} / renderer ${new Date(
    rendererOutMtime
  ).toISOString()}，判别串 ${requiredMarkers.length}/${requiredMarkers.length} 命中，渲染层 ${rendererHit} 条）`
)
