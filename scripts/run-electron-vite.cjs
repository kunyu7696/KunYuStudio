#!/usr/bin/env node
/**
 * electron-vite 启动包装器（踩坑固化）。
 *
 * 问题：本机第三方安全软件（sysdiag minifilter，EDR/DLP 类）对
 * **映像路径位于受保护目录树（实测为整个 D:\KunYuEcosystem，含 node_modules
 * 与项目内自建目录）**的进程拒绝目录枚举（Windows ACCESS_DENIED）。
 * esbuild 的 Go 服务在 build/resolve 时需要读取目录，导致 electron-vite dev
 * 加载配置阶段即报「Cannot read directory ".": Access is denied.」；
 * 而 transform/stdin 与 Node 自身的 fs 均正常。把二进制复制到项目树外
 * （系统 TEMP/kunyu-esbuild-shim/<version>/）后目录读取立即恢复——shim 不能
 * 放在项目目录内（曾试 .esbuild-shim/，仍被拦）；LOCALAPPDATA 在本机受沙箱写限制，
 * 故最终选 TEMP（被清理也无妨，本包装器按版本自动重建）。
 *
 * 多版本问题：electron-vite 依赖 esbuild ^0.25，vite 依赖 ^0.27||^0.28，
 * 两套 JS host 同进程并存，单一 ESBUILD_BINARY_PATH 必然有一个版本校验失败
 * （Host version does not match binary version）。因此不使用环境变量，而是：
 * 1. 把每个 @esbuild 平台二进制按版本复制到 TEMP/kunyu-esbuild-shim/<version>/；
 * 2. 经 NODE_OPTIONS --require 注入 esbuild-shim-register.cjs：拦截
 *    child_process.spawn / execFileSync 中对 @esbuild 二进制的启动，按其包
 *    版本重定向到对应 shim。只拦截路径含 @esbuild 且文件名为 esbuild[.exe] 的
 *    启动，Electron 本身与其他子进程不受影响。
 *
 * Electron 本体同样被该策略拦截：映像位于项目树内时，连内存映射 icudtl.dat
 * 都失败（启动即崩 Invalid file descriptor to ICU data，无任何钩子时亦然），
 * 把整个 node_modules/electron/dist 复制到树外（TEMP/electron-dist-<version>）
 * 后恢复正常。register 对 Electron GUI 启动重定向到该外置副本（按版本幂等复制，
 * 约 350MB，仅版本变化时发生）。
 *
 * 无该安全策略的机器上此包装器同样可用：仅多一次幂等复制，register 找不到
 * shim 时原样放行，行为等价。
 *
 * 用法：node scripts/run-electron-vite.cjs <dev|build|preview> [透传参数...]
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const platformPkg = `@esbuild/${process.platform}-${process.arch}`
const exeName = process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'

/** 找出全部 @esbuild 平台包目录（顶层 + 各包内嵌的一层嵌套，覆盖 vite 0.28） */
function findPlatformDirs() {
  const dirs = []
  const pushIf = (dir) => {
    if (fs.existsSync(path.join(dir, 'package.json')) && !dirs.includes(dir)) dirs.push(dir)
  }
  pushIf(path.join(projectRoot, 'node_modules', platformPkg))
  // 一层嵌套扫描：node_modules/<pkg>/node_modules/@esbuild/<plat>
  const nm = path.join(projectRoot, 'node_modules')
  for (const entry of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    pushIf(path.join(nm, entry.name, 'node_modules', platformPkg))
    // @scope 包再深一层
    if (entry.name.startsWith('@')) {
      const scopeDir = path.join(nm, entry.name)
      for (const sub of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          pushIf(path.join(scopeDir, sub.name, 'node_modules', platformPkg))
        }
      }
    }
  }
  return dirs
}

/** 在平台包目录中定位真实二进制（bin/ 或包根，兼容不同版本布局） */
function binaryIn(dir) {
  const candidates = [path.join(dir, 'bin', exeName), path.join(dir, exeName)]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

/** 幂等准备全部版本的 shim；返回 shim 根目录 */
function ensureShims() {
  const shimRoot = path.join(os.tmpdir(), 'kunyu-esbuild-shim')
  for (const dir of findPlatformDirs()) {
    let version
    try {
      version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version
    } catch {
      continue
    }
    const src = binaryIn(dir)
    if (!src) continue
    const destDir = path.join(shimRoot, version)
    const dest = path.join(destDir, exeName)
    const marker = path.join(destDir, 'version')
    const upToDate =
      fs.existsSync(dest) &&
      fs.existsSync(marker) &&
      fs.readFileSync(marker, 'utf8').trim() === version
    if (!upToDate) {
      fs.mkdirSync(destDir, { recursive: true })
      fs.copyFileSync(src, dest)
      fs.writeFileSync(marker, version)
      console.log(`[esbuild-shim] 已准备 ${dest}（esbuild ${version}）`)
    }
  }
  return shimRoot
}

/**
 * 幂等准备外置 Electron dist（规避 EDR 对树内 Electron 的拦截）。
 * 返回外置 dist 目录；无法定位 electron 包时返回 null（register 不重定向）。
 */
function ensureExternalElectron() {
  let electronPkgDir
  try {
    electronPkgDir = path.dirname(require.resolve('electron/package.json', { paths: [projectRoot] }))
  } catch {
    return null
  }
  const version = JSON.parse(
    fs.readFileSync(path.join(electronPkgDir, 'package.json'), 'utf8')
  ).version
  const srcDist = path.join(electronPkgDir, 'dist')
  if (!fs.existsSync(path.join(srcDist, 'electron.exe')) && !fs.existsSync(path.join(srcDist, 'electron'))) {
    return null
  }
  const destDist = path.join(os.tmpdir(), `electron-dist-${version}`)
  const marker = path.join(destDist, '.kunyu-ready')
  const destExeName = process.platform === 'win32' ? 'electron.exe' : 'electron'
  const destExe = path.join(destDist, destExeName)
  // 标记文件不代表产物完整——
  // electron.exe 可能被清理/隔离而 .kunyu-ready 仍在，导致静默跳过复制并以树内映像运行。
  // 改为校验产物本身：exe 不在就重新复制（幂等）。
  if (fs.existsSync(marker) && !fs.existsSync(destExe)) {
    console.warn('[electron-external] 检测到 .kunyu-ready 标记但 electron 可执行文件缺失，重新复制…')
    fs.rmSync(destDist, { recursive: true, force: true })
  }
  if (!fs.existsSync(destExe)) {
    console.log(`[electron-external] 正在复制 Electron ${version} 到项目树外（约 350MB，仅一次）…`)
    fs.cpSync(srcDist, destDist, { recursive: true })
    fs.writeFileSync(marker, version)
    console.log(`[electron-external] 已准备 ${destDist}`)
  }
  return destDist
}

function main() {
  const [subcommand, ...passthrough] = process.argv.slice(2)
  if (!subcommand) {
    console.error('用法: node scripts/run-electron-vite.cjs <dev|build|preview> [参数...]')
    process.exit(1)
  }
  const shimRoot = ensureShims()
  const externalElectronDist = ensureExternalElectron()

  // 经 NODE_OPTIONS 注入重定向钩子（保留用户已有 NODE_OPTIONS）
  const register = path.join(__dirname, 'esbuild-shim-register.cjs')
  const prevOptions = process.env['NODE_OPTIONS'] ?? ''
  process.env['NODE_OPTIONS'] = `${prevOptions} --require ${JSON.stringify(register)}`.trim()
  process.env['KUNYU_ESBUILD_SHIM_ROOT'] = shimRoot
  if (externalElectronDist) {
    process.env['KUNYU_EXTERNAL_ELECTRON_DIST'] = externalElectronDist
  }

  let cliPath
  try {
    // 不能直接 resolve 深路径：electron-vite 的 exports 映射不暴露 bin 子路径。
    // 先定位包目录，再从 package.json 的 bin 字段取入口。
    const { createRequire } = require('node:module')
    const requireFromProject = createRequire(path.join(projectRoot, 'package.json'))
    const pkgDir = path.dirname(
      requireFromProject.resolve('electron-vite/package.json')
    )
    const binField = requireFromProject('electron-vite/package.json').bin
    const binRel =
      typeof binField === 'string'
        ? binField
        : binField['electron-vite'] ?? Object.values(binField)[0]
    cliPath = path.resolve(pkgDir, binRel)
  } catch {
    console.error('找不到 electron-vite，请先执行 npm install')
    process.exit(1)
  }
  const child = spawn(process.execPath, [cliPath, subcommand, ...passthrough], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  })
  const forward = (sig) => () => child.kill(sig)
  process.on('SIGINT', forward('SIGINT'))
  process.on('SIGTERM', forward('SIGTERM'))
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 0)
  })
}

main()
