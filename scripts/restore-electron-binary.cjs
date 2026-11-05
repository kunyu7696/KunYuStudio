#!/usr/bin/env node
/**
 * 还原 electron 真实二进制（CI 打包前必须执行）。
 *
 * 背景：stub-electron-binary.cjs 为了让单测不被惰性下载卡住，在 npm ci 之后
 * 铺了 0 字节的 dist/<exe> 与 path.txt。但打包链路是
 * `electron-builder -c.electronDist=node_modules/electron/dist`：
 *   1. electron-builder 读 dist/version 判定 electron 版本，桩里没有这个文件；
 *   2. 整个 dist 会被打进安装包，桩里只有空 exe，没有 locales / *.dll / resources。
 * 桩没清就用它打包必然失败（v0.1.8 的 Windows 构建即失败于此）。
 *
 * 本脚本检测到桩就清掉 path.txt 与 dist，再调用 electron 自带 install.js
 * 下载真实二进制，最后校验体积与 version 文件；还原不成就明确失败，
 * 避免把空壳打进安装包。
 */
'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
const distDir = path.join(electronDir, 'dist')
const pathFile = path.join(electronDir, 'path.txt')
const versionFile = path.join(distDir, 'version')

/** 真实二进制远大于 50MB（约 240MB），桩是 0 字节 */
const MIN_BYTES = 50 * 1024 * 1024

function exeRelPath() {
  if (process.platform === 'win32') return 'electron.exe'
  if (process.platform === 'darwin') return path.join('Electron.app', 'Contents', 'MacOS', 'Electron')
  return 'electron'
}

function binarySize() {
  try {
    return fs.statSync(path.join(distDir, exeRelPath())).size
  } catch {
    return 0
  }
}

function installed() {
  return binarySize() >= MIN_BYTES && fs.existsSync(versionFile)
}

if (!fs.existsSync(electronDir)) {
  console.error('[restore-electron-binary] node_modules/electron 不存在，请先 npm ci')
  process.exit(1)
}

if (installed()) {
  console.log('[restore-electron-binary] 已是真实二进制，跳过')
  process.exit(0)
}

console.log('[restore-electron-binary] 检测到桩二进制，开始还原（下载约 100MB）…')
fs.rmSync(pathFile, { force: true })
fs.rmSync(distDir, { recursive: true, force: true })
execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' })

if (!installed()) {
  console.error(
    `[restore-electron-binary] 还原失败：dist 仍不完整（二进制 ${binarySize()} 字节，version ${fs.existsSync(versionFile) ? '存在' : '缺失'}）`
  )
  process.exit(1)
}

console.log(`[restore-electron-binary] 还原完成（${(binarySize() / 1024 / 1024).toFixed(0)} MB）`)
