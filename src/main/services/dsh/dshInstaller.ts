/**
 * DSH 插件安装器：把 DSH 社区插件 npm 包装进 <userData>/dsh-plugins。
 *
 * 安装策略（关键）：
 * - `--legacy-peer-deps`：DSH 服务包（dsh-settings 等）不在公共 npm，跳过 peer 自动安装
 * - 显式同装公开的官方包：@deepseek-ai/cordis / cosmokit / schemastery（插件 import 可解析）
 * - 非公开服务包按清单 `shims` 写本地桩（仅 @deepseek-ai/dsh-tools 的 defineTool 有明确约定）
 *
 * 安全：包名 npm 正则校验；npm-cli 经 node execFile 参数数组执行，禁止 shell。
 *
 * Node/npm 工具链（整改）：机器上可能只有精简 node（无 npm，如某些
 * 应用内嵌运行时）或完全没有 node。npm 作为应用生产依赖内置（bundled 自包含），
 * 工具链解析三级回退：① 系统完整 node（旁挂 npm）→ ② 任意系统 node 跑内置
 * npm-cli → ③ kunyu 自身 Electron 以 ELECTRON_RUN_AS_NODE 跑内置 npm-cli。
 * 打包后内置 npm 位于 app.asar.unpacked（外部 node 进程无 asar FS，必须实体文件）。
 * registry：读取用户 npm 配置；当前源不可达（探针）或安装失败时回退 npmmirror。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { app } from 'electron'
import type { DshEnvStatus, DshOpResult, DshInstalledRecord } from '../../../shared/types/dsh'
import { dshPluginsRoot, dropRecord, publicSiblingDeps, readManifest, upsertRecord } from './dshCatalog'
import { revokePlugin } from './dshTrust'
import { isPackagedRuntime } from '../../runtimeEnv'
import { DSH_PET_SHIMS, shimIndexSource } from './shims'

export { DSH_PET_SHIMS }

const requireFromHere = createRequire(import.meta.url)

const INSTALL_TIMEOUT_MS = 300_000
const NPM_DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const NPM_FALLBACK_REGISTRY = 'https://registry.npmmirror.com'
/** registry 连通性探针超时（国内直连官方源常见 15s+ 黑洞，5s 判死） */
const REGISTRY_PROBE_MS = 5_000
/** 明确的网络类错误码（其余未知错误也按不可达处理，触发镜像回退） */
const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT'
])

/** npm 包名白名单正则（scoped + 非法元字符拒绝，防参数注入/路径穿越） */
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export function isSafeNpmName(name: string): boolean {
  return name.length <= 214 && !name.startsWith('-') && NPM_NAME_RE.test(name)
}

async function execFileCapture(
  cmd: string,
  args: string[],
  timeoutMs: number,
  env?: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number | null; failed: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false, windowsHide: true, ...(env ? { env } : {}) })
    let stdout = ''
    let stderr = ''
    let failed = false
    const timer = setTimeout(() => {
      failed = true
      child.kill()
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', () => {
      clearTimeout(timer)
      failed = true
      resolve({ stdout, stderr, code: null, failed })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code, failed })
    })
  })
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? ''
}

/** 可执行的 npm 工具链：node 运行时 + npm-cli 入口（+可能的 ELECTRON_RUN_AS_NODE 环境） */
export interface NpmToolchain {
  nodeExe: string
  npmCli: string
  extraEnv?: NodeJS.ProcessEnv
  nodeVersion: string
  /** true=npm-cli 来自坤宇内置；false=node 安装自带 */
  bundled: boolean
}

/**
 * 坤宇内置的 npm-cli 实体路径。
 * dev=项目 node_modules/npm（createRequire 解析，cwd 兜底）；
 * 打包=app.asar.unpacked/node_modules/npm（require 会给出 asar 路径，统一改写，
 * 外部 node 进程没有 Electron 的 asar FS 补丁）。
 */
export function bundledNpmCli(): string | null {
  const candidates: string[] = []
  try {
    candidates.push(requireFromHere.resolve('npm/bin/npm-cli.js'))
  } catch {
    // 开发态未安装依赖时落到显式候选
  }
  if (isPackagedRuntime(app)) {
    candidates.push(
      join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin', 'npm-cli.js')
    )
  } else {
    candidates.push(join(process.cwd(), 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  }
  const hit = candidates.find((p) => existsSync(p.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)))
  return hit ? hit.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`) : null
}

/**
 * 枚举系统里可用的 node：PATH 上的**全部**命中（where 不只取第一行——精简 node
 * 可能排在官方安装前面），再补常见安装目录。
 */
async function enumerateSystemNodes(): Promise<string[]> {
  const out: string[] = []
  const push = (p: string): void => {
    if (p && existsSync(p) && !out.includes(p)) out.push(p)
  }
  const probe = await execFileCapture(
    process.platform === 'win32' ? 'where' : 'which',
    ['node'],
    3_000
  )
  if (!probe.failed && probe.code === 0) {
    for (const line of probe.stdout.split(/\r?\n/)) push(line.trim())
  }
  const extra =
    process.platform === 'win32'
      ? ['C:\\Program Files\\nodejs\\node.exe', join(process.env.LOCALAPPDATA ?? '', 'Programs', 'nodejs', 'node.exe')]
      : ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/usr/bin/node']
  for (const p of extra) push(p)
  return out
}

async function readNodeVersion(exe: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const r = await execFileCapture(exe, ['-v'], 3_000, env)
  return r.code === 0 ? firstLine(r.stdout) : ''
}

/**
 * 解析可用 npm 工具链，三级回退（均不可用抛错，错误文案直接面向用户）：
 * 1. 系统完整 node（旁挂 node_modules/npm）；
 * 2. 任意系统 node（含精简运行时）+ 坤宇内置 npm-cli；
 * 3. kunyu 自身 Electron 以 ELECTRON_RUN_AS_NODE=1 + 内置 npm-cli（零外部依赖）。
 */
export async function resolveNpmToolchain(): Promise<NpmToolchain> {
  const systemNodes = await enumerateSystemNodes()
  for (const exe of systemNodes) {
    const cli = join(dirname(exe), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(cli)) {
      return { nodeExe: exe, npmCli: cli, nodeVersion: await readNodeVersion(exe), bundled: false }
    }
  }
  const bundled = bundledNpmCli()
  if (bundled) {
    const bare = systemNodes[0]
    if (bare) {
      return { nodeExe: bare, npmCli: bundled, nodeVersion: await readNodeVersion(bare), bundled: true }
    }
    if (process.versions.electron && existsSync(process.execPath)) {
      return {
        nodeExe: process.execPath,
        npmCli: bundled,
        // 只带运行模式开关；系统级 env 由 runNpm 的白名单统一注入
        extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
        nodeVersion: process.versions.node,
        bundled: true
      }
    }
  }
  throw new Error('未找到 npm（系统 Node.js 不完整且坤宇内置 npm 不可用），请安装 Node.js ≥ 22（https://nodejs.org）')
}

function runNpm(tc: NpmToolchain, rest: string[], timeoutMs: number) {
  // 子进程 env 换白名单，不继承主进程全量 env（含 API token/代理凭证）
  return execFileCapture(tc.nodeExe, [tc.npmCli, '--no-update-notifier', ...rest], timeoutMs, buildNpmEnv(tc.extraEnv))
}

/** npm/node 子进程需要的系统级环境变量（白名单外一律不透传） */
const NPM_ENV_WHITELIST = [
  'PATH',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PROGRAMFILES',
  'NUMBER_OF_PROCESSORS',
  'OS'
] as const

/** extra 里允许合并的键（白名单外的显式内部控制项，如运行模式开关） */
const NPM_ENV_EXTRA_ALLOWED = new Set(['ELECTRON_RUN_AS_NODE'])

/**
 * npm 子进程环境白名单。
 * Windows 环境块键名大小写不敏感：命中 process.env 的实际键名后原样写入，
 * 保证 Path 类键只出现一份（同时写 Path 与 PATH 会生成损坏环境块导致
 * CreateProcess 失败）。extra 仅放行 NPM_ENV_EXTRA_ALLOWED 中的键，
 * 其余（含误传全量 env）一律丢弃，防凭据泄漏。
 */
export function buildNpmEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of NPM_ENV_WHITELIST) {
    const hit = Object.keys(process.env).find((k) => k.toLowerCase() === key.toLowerCase())
    if (hit === undefined) continue
    const value = process.env[hit]
    if (value !== undefined) env[hit] = value
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (!NPM_ENV_EXTRA_ALLOWED.has(k) || v === undefined) continue
      env[k] = v
    }
  }
  return env
}

/** 读取用户 npm 配置的 registry（无配置/读取失败 → 官方默认源） */
async function readConfiguredRegistry(tc: NpmToolchain): Promise<string> {
  const r = await runNpm(tc, ['config', 'get', 'registry'], 15_000)
  const line = firstLine(r.stdout)
  return /^https?:\/\/\S+$/i.test(line) ? line.replace(/\/$/, '') : NPM_DEFAULT_REGISTRY
}

/**
 * registry 连通性探针：任意 HTTP 应答（含 404/500）都算可达；超时与网络错误算不可达。
 * 不跟随重定向到无关主机也无影响——/-/ping 是 npm registry 标准探活端点。
 */
async function isRegistryReachable(registry: string): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REGISTRY_PROBE_MS)
  try {
    await fetch(`${registry}/-/ping`, { signal: ctrl.signal })
    return true
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return false
    const code =
      (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code ?? ''
    if (NETWORK_ERROR_CODES.has(String(code))) return false
    return false // 未知错误同样按不可达处理（回退镜像代价低，卡住代价高）
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 当前 registry 不可达时决定是否覆盖为镜像源（纯函数，便于测试）：
 * 已配置的就是镜像 → 不重复指定（让失败原样暴露，避免无效重试）。
 */
export function chooseRegistryOverride(currentRegistry: string, reachable: boolean): string | null {
  if (reachable) return null
  return currentRegistry === NPM_FALLBACK_REGISTRY ? null : NPM_FALLBACK_REGISTRY
}

/** 探测 DSH 插件安装环境：kunyu 内置 npm 后，Electron 内恒为可用（除非依赖打包缺失） */
export async function detectDshEnv(): Promise<DshEnvStatus> {
  try {
    const tc = await resolveNpmToolchain()
    return {
      nodeOk: true,
      nodeVersion: tc.nodeVersion || process.versions.node || '',
      npmOk: true
    }
  } catch (err) {
    return {
      nodeOk: false,
      nodeVersion: '',
      npmOk: false,
      message: err instanceof Error ? err.message : '未检测到 Node.js/npm，请安装 Node.js ≥ 22（https://nodejs.org）后重启坤宇'
    }
  }
}

function writeShimsIfAbsent(shims: string[]): void {
  const nm = join(dshPluginsRoot(), 'node_modules')
  for (const name of shims) {
    const pkgDir = join(nm, name)
    const pkgFile = join(pkgDir, 'package.json')
    if (existsSync(pkgFile)) continue
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(
      pkgFile,
      JSON.stringify(
        { name, version: '0.0.0-kunyu-shim', type: 'module', main: 'index.js', exports: { '.': './index.js' } },
        null,
        2
      ),
      'utf-8'
    )
    writeFileSync(join(pkgDir, 'index.js'), shimIndexSource(name), 'utf-8')
  }
}

function readInstalledVersion(npmName: string): string | null {
  const pkgFile = join(dshPluginsRoot(), 'node_modules', npmName, 'package.json')
  if (!existsSync(pkgFile)) return null
  try {
    return (JSON.parse(readFileSync(pkgFile, 'utf-8')) as { version?: string }).version ?? null
  } catch {
    return null
  }
}

/**
 * 把暂存树的 node_modules 合并拷入共享树：
 * - 只增不覆盖（共享树里手工放置的 shim 包、dsh-pet 等优先保留）；
 * - forcePkgs 中的包强制覆盖（本次安装的目标包，支持重装/升级）；
 * - 跳过 .bin 与隐藏目录（require 解析不需要 npm 的 cmd shim）。
 * npm reify 会把共享树里不在 manifest 中的包当外来物改名挪走（无共享
 * package.json 时必然发生），若该包正被运行中的桌宠进程加载即 EBUSY——
 * 因此 npm 只允许在隔离暂存目录里解析依赖树，再由这里合并进共享树。
 */
export function mergeNodeModules(srcRoot: string, destRoot: string, forcePkgs: string[]): void {
  const copyPkg = (src: string, dest: string, force: boolean): void => {
    if (force) rmSync(dest, { recursive: true, force: true })
    else if (existsSync(dest)) return
    cpSync(src, dest, { recursive: true })
  }
  for (const entry of readdirSync(srcRoot)) {
    if (entry.startsWith('.')) continue
    const src = join(srcRoot, entry)
    if (!statSync(src).isDirectory()) continue
    if (entry.startsWith('@')) {
      for (const child of readdirSync(src)) {
        copyPkg(join(src, child), join(destRoot, entry, child), forcePkgs.includes(`${entry}/${child}`))
      }
    } else {
      copyPkg(src, join(destRoot, entry), forcePkgs.includes(entry))
    }
  }
}

export async function installDshPlugin(
  npmName: string,
  source: 'catalog' | 'custom'
): Promise<DshOpResult> {
  if (!isSafeNpmName(npmName)) {
    return { ok: false, error: `非法的 npm 包名：${npmName}` }
  }
  const entry = readManifest().plugins.find((p) => p.npm === npmName)
  if (source === 'catalog' && !entry) {
    return { ok: false, error: '该包不在精选清单中' }
  }
  // dsh-pet 不在 catalog 但有专用 peer 包 shim 集（5 个未公开 @deepseek-ai/* + @electron/*）
  const shims = npmName === 'dsh-pet' && !entry ? [...DSH_PET_SHIMS] : (entry?.shims ?? [])
  // 隔离暂存目录：自带 package.json，npm 只 reify 暂存树，绝不触碰共享树
  const staging = join(dshPluginsRoot(), `.staging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  try {
    mkdirSync(dshPluginsRoot(), { recursive: true })
    mkdirSync(staging, { recursive: true })
    writeFileSync(
      join(staging, 'package.json'),
      JSON.stringify({ name: 'kunyu-dsh-staging', version: '0.0.0', private: true }),
      'utf-8'
    )
    const tc = await resolveNpmToolchain()
    const args = [
      'install',
      '--prefix',
      staging,
      '--legacy-peer-deps',
      // 拒绝执行被安装包的 postinstall 等生命周期脚本
      //（postinstall 会以用户身份跑任意代码；DSH 插件为纯 JS 包，不需要脚本）
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      npmName,
      ...publicSiblingDeps()
    ]
    // registry 策略：尊重用户 npm 配置；当前源 5s 内无应答则预挂镜像参数；
    // 首轮失败且生效源不是镜像时，强制 npmmirror 再试一次（兜底探针误判/中途断网）
    const configured = await readConfiguredRegistry(tc)
    const override = chooseRegistryOverride(configured, await isRegistryReachable(configured))
    const effectiveRegistry = override ?? configured
    let run = await runNpm(
      tc,
      [...args, ...(override ? [`--registry=${override}`] : [])],
      INSTALL_TIMEOUT_MS
    )
    if ((run.failed || run.code !== 0) && effectiveRegistry !== NPM_FALLBACK_REGISTRY) {
      run = await runNpm(tc, [...args, `--registry=${NPM_FALLBACK_REGISTRY}`], INSTALL_TIMEOUT_MS)
    }
    if (run.failed || run.code !== 0) {
      const tail = (run.stderr || run.stdout).split(/\r?\n/).slice(-6).join('\n').trim()
      return { ok: false, error: `npm 安装失败：${tail || '未知错误'}` }
    }
    mergeNodeModules(join(staging, 'node_modules'), join(dshPluginsRoot(), 'node_modules'), [npmName])
    const version = readInstalledVersion(npmName)
    if (!version) return { ok: false, error: '安装完成但未找到包目录，安装可能未成功' }
    writeShimsIfAbsent(shims)
    upsertRecord({
      npm: npmName,
      version,
      source,
      installedAt: Date.now(),
      shims
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * 卸载插件并移除安装记录（shim 目录保留，避免影响其他插件）。
 * 直接删包目录而非 npm uninstall：npm reify 会重算整棵共享树，对运行中的
 * 插件目录改名挪移会 EBUSY，还可能误删其他手工放置的包。
 */
export async function removeDshPlugin(npmName: string): Promise<DshOpResult> {
  if (!isSafeNpmName(npmName)) return { ok: false, error: `非法的 npm 包名：${npmName}` }
  try {
    const pkgDir = join(dshPluginsRoot(), 'node_modules', ...npmName.split('/'))
    rmSync(pkgDir, { recursive: true, force: true })
    dropRecord(npmName)
    // 卸载即撤销信任：重装同名包（可能是不同来源）必须重新授权
    revokePlugin(npmName)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ---------- dsh-pet 本地目录安装通道 ----------
//
// dsh-pet 无法从公共 npm 直接装（peerDependencies 全是未公开的 @deepseek-ai/* 服务包，
// npm 会连带拉取失败），而本机装有 DSH 桌面端时包已完整存在：
//   ~/.dsh/profiles/desktop/node_modules/dsh-pet
// 这条通道把该目录整体复制进 <userData>/dsh-plugins/node_modules/dsh-pet 并写安装记录，
// 之后与 catalog 安装的包同池加载。复制后校验**完整文件集**（lesson：只查单文件存在
// 不足以证明副本可用——helper 资产缺失要到运行期才炸）。

/** 本机 DSH 桌面端 dsh-pet 包根（未装 DSH 桌面端 / 无该包 → null） */
export function localDshPetSource(): string | null {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  const pkgFile = join(home, 'profiles', 'desktop', 'node_modules', 'dsh-pet', 'package.json')
  if (!existsSync(pkgFile)) return null
  try {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8')) as { name?: string }
    return pkg.name === 'dsh-pet' ? dirname(pkgFile) : null
  } catch {
    return null
  }
}

/** 复制后必须存在的文件集（缺一即判定副本不完整并回滚） */
const DSH_PET_REQUIRED_FILES = [
  'package.json',
  'lib/index.js',
  join('runtime', 'electron-helper', 'main.js'),
  join('assets', 'config.jsonc')
]

/**
 * 从本机 DSH 桌面端安装 dsh-pet（目录整体复制 + 完整性校验 + 安装记录）。
 * @param sourceDir 覆盖探测到的包根（测试注入用）
 */
export async function installDshPetFromLocal(sourceDir?: string): Promise<DshOpResult> {
  const src = sourceDir ?? localDshPetSource()
  if (!src) {
    return { ok: false, error: '未找到本机 DSH 桌面端已安装的 dsh-pet（~/.dsh/profiles/desktop/node_modules/dsh-pet）' }
  }
  const srcPkgFile = join(src, 'package.json')
  let version = ''
  try {
    version = String((JSON.parse(readFileSync(srcPkgFile, 'utf-8')) as { version?: string }).version ?? '')
  } catch {
    return { ok: false, error: '源目录 package.json 不可读，dsh-pet 副本可能损坏' }
  }
  const missing = DSH_PET_REQUIRED_FILES.filter((rel) => !existsSync(join(src, rel)))
  if (missing.length > 0) {
    return { ok: false, error: `源包不完整，缺少：${missing.join('、')}` }
  }
  const dest = join(dshPluginsRoot(), 'node_modules', 'dsh-pet')
  try {
    mkdirSync(dshPluginsRoot(), { recursive: true })
    cpSync(src, dest, { recursive: true, force: true })
  } catch (err) {
    return { ok: false, error: `复制 dsh-pet 目录失败：${(err as Error).message}` }
  }
  const copiedMissing = DSH_PET_REQUIRED_FILES.filter((rel) => !existsSync(join(dest, rel)))
  if (copiedMissing.length > 0) {
    return { ok: false, error: `复制后校验失败，缺少：${copiedMissing.join('、')}（副本可能被杀软拦截）` }
  }
  writeShimsIfAbsent(DSH_PET_SHIMS)
  upsertRecord({ npm: 'dsh-pet', version, source: 'custom', installedAt: Date.now(), shims: [...DSH_PET_SHIMS] })
  return { ok: true }
}

export type { DshInstalledRecord }
