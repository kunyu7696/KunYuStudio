/**
 * esbuild 二进制重定向钩子（由 run-electron-vite.cjs 经 NODE_OPTIONS --require 注入）。
 *
 * 拦截 child_process.spawn / spawnSync / execFileSync：当启动的是 @esbuild
 * 平台包内的 esbuild[.exe] 时，按其包版本把命令重定向到项目树外的 shim
 * （TEMP/kunyu-esbuild-shim/<version>/esbuild[.exe]），以规避本机 EDR 对
 * 受保护目录树内进程的目录枚举拦截。
 *
 * 仅匹配路径含 @esbuild 且文件名为 esbuild[.exe] 的启动；目标 shim 不存在时
 * （未准备/非本机构建）原样放行，保证无该安全策略环境下零行为差异。
 */
const cp = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const shimRoot = process.env['KUNYU_ESBUILD_SHIM_ROOT']
const exeName = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'

/** 命令 → shim 路径的解析缓存（每个 esbuild 进程只在启动时命中几次） */
const redirectCache = new Map()

function resolveRedirect(command) {
  if (redirectCache.has(command)) return redirectCache.get(command)
  let result = command
  try {
    if (path.basename(command) === exeName && command.includes(`${path.sep}@esbuild${path.sep}`)) {
      // 二进制可能位于平台包根或其 bin/ 下：取最近的平台包目录
      const dir = path.dirname(command)
      const pkgDir = fs.existsSync(path.join(dir, 'package.json')) ? dir : path.dirname(dir)
      const version = JSON.parse(
        fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')
      ).version
      const target = path.join(shimRoot, version, exeName)
      if (version && fs.existsSync(target)) result = target
    }
  } catch {
    // 任何意外都退回原命令，不阻塞构建
    result = command
  }
  redirectCache.set(command, result)
  return result
}

const origSpawn = cp.spawn
cp.spawn = function patchedSpawn(command, args, options) {
  if (typeof command === 'string') {
    if (isElectronGui(command, options)) {
      command = redirectElectron(command, options)
    } else {
      command = resolveRedirect(command)
    }
  }
  return origSpawn.call(this, command, args, options)
}

const origSpawnSync = cp.spawnSync
cp.spawnSync = function patchedSpawnSync(command, args, options) {
  if (typeof command === 'string') command = resolveRedirect(command)
  return origSpawnSync.call(this, command, args, options)
}

const origExecFileSync = cp.execFileSync
cp.execFileSync = function patchedExecFileSync(command, args, options) {
  if (typeof command === 'string') command = resolveRedirect(command)
  return origExecFileSync.call(this, command, args, options)
}

/** 判断是否为 Electron GUI 启动（node_modules/electron/dist/electron.exe，且非 RUN_AS_NODE）。
 *  ELECTRON_RUN_AS_NODE 判断只看 spawn 调用方显式传入的 env（options.env），
 *  不看 process.env——后者会被外部终端环境（VS Code 等）污染，导致误判跳过重定向。 */
function isElectronGui(command, options) {
  if (options?.env?.['ELECTRON_RUN_AS_NODE']) {
    return false
  }
  const normalized = command.replace(/\//g, path.sep)
  return (
    path.basename(normalized) === 'electron.exe' ||
    normalized.includes(`${path.sep}electron${path.sep}dist${path.sep}`)
  )
}

/**
 * Electron GUI 启动重定向：
 * 1. 命令改指外置 dist 的 electron.exe（EDR 只拦树内映像；外置副本实测正常）；
 * 2. 从（实际生效的）NODE_OPTIONS 中移除本钩子的 --require 段，并通过 options.env
 *    显式传入——外置 GUI 不需要该钩子，也避免早期 Node 选项干扰
 *    （startElectron 原本省略 env = 继承 process.env）。
 * 未提供外置目录时仅做 NODE_OPTIONS 清洗并保留原命令。
 */
function redirectElectron(command, options) {
  const sourceEnv = options?.env ?? process.env
  const nodeOptions = sourceEnv['NODE_OPTIONS'] ?? ''
  const cleaned = nodeOptions
    .replace(/--require(?:=|\s+)(?:"[^"]*esbuild-shim-register[^"]*"|\S*esbuild-shim-register\S*)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const env = { ...sourceEnv, NODE_OPTIONS: cleaned }
  // v1.4.1 只修了一半：上面的判断（是否套用 shim）已不看 process.env，
  // 但这里把 sourceEnv 整个透传给 Electron——若外部终端（VS Code 扩展宿主、
  // 各类 Electron 系 AI 工具、CI agent）带着 ELECTRON_RUN_AS_NODE=1，
  // Electron 会被当成纯 Node 启动，主进程 import 'electron' 没有 BrowserWindow 直接崩。
  // 真正喂给 Electron 的环境里必须剔除该变量（真机反馈）。
  delete env['ELECTRON_RUN_AS_NODE']
  if (options && typeof options === 'object') {
    options.env = env
  }
  const externalDist = sourceEnv['KUNYU_EXTERNAL_ELECTRON_DIST']
  if (externalDist) {
    const exeName = process.platform === 'win32' ? 'electron.exe' : 'electron'
    const externalExe = path.join(externalDist, exeName)
    if (fs.existsSync(externalExe)) return externalExe
    // 回退到树内映像绝不能静默——
    // EDR 会拒绝树内映像写树外文件，应用将表现为"一切正常但所有保存 EPERM"。
    process.stderr.write(
      `[electron-external] 警告：外置 Electron 目录不可用（${externalDist} 中无 ${exeName}），` +
      `已回退到项目树内映像（${command}）。\n` +
      '[electron-external] 该映像可能被安全软件限制写盘，保存/导出将 EPERM。' +
      '请删除 %TEMP%\\electron-dist-* 后重跑 npm run dev，或显式设置 KUNYU_EXTERNAL_ELECTRON_DIST。\n'
    )
  }
  return command
}
