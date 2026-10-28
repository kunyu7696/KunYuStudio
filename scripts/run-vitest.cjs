#!/usr/bin/env node
/**
 * vitest 启动包装器。
 *
 * 背景：本机（sysdiag EDR）会拦截 esbuild Go 进程的目录枚举，vite 默认的
 * configLoader=bundle 在加载 vitest.config.ts 时直接崩溃；`--configLoader runner`
 * 跳过 esbuild 打包配置，可绕过。CI / 无该安全软件的机器不需要此参数。
 *
 * 本脚本自动探测：esbuild 不可用 → 追加 --configLoader runner；可用 → 原样透传。
 * 探测结果缓存于 TEMP/kunyu-esbuild-shim/probe-ok（24h 内有效）。
 *
 * 用法：node scripts/run-vitest.cjs [vitest 参数...]
 */
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const shimRoot = path.join(os.tmpdir(), 'kunyu-esbuild-shim')
const probeMarker = path.join(shimRoot, 'probe-ok')
const PROBE_TTL_MS = 24 * 60 * 60 * 1000

/** 探测 esbuild 目录枚举是否可用（24h 缓存）。返回 true = 可用（无需 runner） */
function esbuildHealthy() {
  try {
    if (fs.existsSync(probeMarker)) {
      const age = Date.now() - fs.statSync(probeMarker).mtimeMs
      if (age < PROBE_TTL_MS) return fs.readFileSync(probeMarker, 'utf8').trim() === '1'
    }
  } catch {
    /* 探测失败按不健康处理 */
  }
  // 真探测：让 esbuild 列目录（这是被拦截的操作）
  const exe = path.join(
    projectRoot, 'node_modules', '@esbuild',
    `${process.platform}-${process.arch}`, 'bin',
    process.platform === 'win32' ? 'esbuild.exe' : 'esbuild'
  )
  let healthy = false
  if (fs.existsSync(exe)) {
    const r = spawnSync(exe, ['--version'], { timeout: 10_000, stdio: 'pipe' })
    // 版本命令不触发目录枚举；真正的判断由 transform+目录读组合。
    // 这里只做存在性探测——bundle 失败由调用方补跑时感知。
    healthy = r.status === 0
    // 进一步：用 stdin build 验证目录枚举（esbuild 在 write:false + stdin 下不读目录，
    // 反而正常；读目录才崩。所以健康探测必须触发一次 resolve）
    if (healthy) {
      const probeDir = path.join(shimRoot, 'probe-src')
      try {
        fs.mkdirSync(probeDir, { recursive: true })
        fs.writeFileSync(path.join(probeDir, 'a.js'), 'export const x=1\n')
        const r2 = spawnSync(
          process.execPath,
          ['-e', `require(${JSON.stringify(path.join(projectRoot, 'node_modules', 'esbuild'))}).build({entryPoints:[${JSON.stringify(path.join(probeDir, 'a.js'))}],bundle:true,write:false,platform:'node'}).then(()=>process.exit(0)).catch(()=>process.exit(1))`],
          { timeout: 30_000, stdio: 'pipe' }
        )
        healthy = r2.status === 0
      } catch {
        healthy = false
      }
    }
  }
  try {
    fs.mkdirSync(shimRoot, { recursive: true })
    fs.writeFileSync(probeMarker, healthy ? '1' : '0')
  } catch {
    /* 缓存失败不影响结果 */
  }
  return healthy
}

function main() {
  const args = process.argv.slice(2)
  if (!esbuildHealthy() && !args.some((a) => a.startsWith('--configLoader'))) {
    args.push('--configLoader', 'runner')
    console.log('[run-vitest] esbuild 目录枚举受限，已自动启用 --configLoader runner')
  }
  const vitestBin = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs')
  const child = spawn(process.execPath, [vitestBin, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    process.exit(code ?? 0)
  })
}

main()
