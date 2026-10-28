/**
 * B2 IDE 通用能力：list_files / run_command。
 *
 * 补齐通用 IDE 的两块地基：
 * - list_files：工程文件树视图。project_grep 按内容搜、read_project_file 读单文件，
 *   本工具回答「这个工程长什么样」——结构探索、定位文件后再交给前两者。
 * - run_command：受控命令执行。gradle_build 走编排调度不进模型循环，本工具给模型
 *   一个通用但有硬护栏的出口：可执行名白名单、cwd 锁项目根、超时、输出尾部截断、
 *   危险子命令拦截（git push/reset/clean/rebase、npm publish、node -e 等）。
 *
 * 护栏明细（run_command）：
 * - 白名单：gradlew/git/npm/node/java/javac；一律 shell:false 直起进程，
 *   仅 Windows 下 gradlew.bat 经 cmd /c 包装且参数先过 cmd 元字符检查；
 * - 参数禁含 `..` 与绝对路径，防项目根逃逸；
 * - 输出采集上限 1MB（保尾部），回填前再截到 TOOL_RESULT_CLIP；
 * - 超时集中目录 TOOL_TIMEOUTS（toolPolicy），kill 后软失败。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { clipToolText, TOOL_RESULT_CLIP } from './textClip'
import { GREP_SKIP_DIRS, globToRegExp, isIgnoredByUser, parseKunyuIgnore } from '../projectGrep'
import { clampRunCommandTimeout } from './toolPolicy'

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

// ---------------------------------------------------------------------------
// list_files
// ---------------------------------------------------------------------------

const LIST_DEFAULT_MAX = 200
const LIST_HARD_MAX = 500

interface ListResult {
  ok: boolean
  entries: string[]
  truncated: boolean
  error?: string
}

/** 递归收集项目文件（相对 POSIX 路径），跳过依赖/构建输出目录；数量封顶 */
export function listProjectFiles(
  root: string,
  options: { dir?: string; glob?: string; maxEntries?: number } = {}
): ListResult {
  const absRoot = resolve(root)
  if (!existsSync(absRoot) || !statSync(absRoot).isDirectory()) {
    return { ok: false, entries: [], truncated: false, error: '项目根不存在或不是目录' }
  }
  const startDir = resolve(absRoot, options.dir ?? '')
  const relStart = relative(absRoot, startDir)
  if (relStart.startsWith('..')) {
    return { ok: false, entries: [], truncated: false, error: 'dir 不允许逃逸项目根' }
  }
  if (!existsSync(startDir) || !statSync(startDir).isDirectory()) {
    return { ok: false, entries: [], truncated: false, error: `目录不存在：${options.dir}` }
  }
  const maxEntries = Math.min(
    LIST_HARD_MAX,
    Math.max(1, Math.floor(options.maxEntries ?? LIST_DEFAULT_MAX))
  )
  const globRe = options.glob ? globToRegExp(options.glob) : null
  const userIgnore = parseKunyuIgnore(absRoot)
  const entries: string[] = []
  let truncated = false

  const walk = (dir: string): boolean => {
    let dirents: Dirent<string>[]
    try {
      dirents = readdirSync(dir, { withFileTypes: true })
    } catch {
      return true
    }
    // 名称排序保证输出确定性
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of dirents) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (GREP_SKIP_DIRS.has(entry.name)) continue
        if (isIgnoredByUser(userIgnore, toPosix(relative(absRoot, abs)))) continue
        if (!walk(abs)) return false
        continue
      }
      if (!entry.isFile()) continue
      if (globRe && !globRe.test(entry.name)) continue
      const rel = relative(absRoot, abs)
      if (rel.startsWith('..')) continue
      if (isIgnoredByUser(userIgnore, toPosix(rel))) continue
      entries.push(toPosix(rel))
      if (entries.length >= maxEntries) {
        truncated = true
        return false
      }
    }
    return true
  }
  walk(startDir)
  return { ok: true, entries, truncated }
}

// ---------------------------------------------------------------------------
// run_command
// ---------------------------------------------------------------------------

/** 可执行名白名单（小写、去路径、去 .exe 后缀后匹配） */
const EXEC_WHITELIST: ReadonlySet<string> = new Set([
  'gradlew',
  'gradlew.bat',
  'git',
  'npm',
  'node',
  'java',
  'javac'
])

/** 各可执行名的危险子命令/参数拦截 */
const GIT_DENY_SUBCOMMANDS: ReadonlySet<string> = new Set(['push', 'reset', 'clean', 'rebase', 'filter-branch'])
const NPM_DENY_SUBCOMMANDS: ReadonlySet<string> = new Set(['publish', 'unpublish', 'link'])
const NODE_DENY_FLAGS: ReadonlySet<string> = new Set(['-e', '-p', '-i', '--eval', '--print', '--interactive'])

/** cmd /c 包装路径的元字符黑名单（防命令拼接） */
const CMD_META_RE = /[&|<>^]/
const ABS_PATH_RE = /^(?:[a-zA-Z]:[\\/]|\\\\|~|\/)/

export interface SpawnPlan {
  ok: boolean
  reason?: string
  file?: string
  args?: string[]
}

/**
 * 把用户给的 exec+args 解析为实际 spawn 计划；拒绝时给出中文原因。
 * 纯函数导出以便单测直接覆盖拦截矩阵。
 */
export function resolveSpawnPlan(
  exec: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): SpawnPlan {
  const base = (exec.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
  if (!EXEC_WHITELIST.has(base)) {
    return { ok: false, reason: `可执行名不在白名单（${[...EXEC_WHITELIST].join('/')}）：${exec}` }
  }
  for (const a of args) {
    if (a.includes('..')) return { ok: false, reason: `参数不允许包含 ..：${a}` }
    if (ABS_PATH_RE.test(a)) return { ok: false, reason: `参数不允许绝对路径：${a}` }
  }
  const sub = args.find((a) => !a.startsWith('-'))?.toLowerCase()
  if (base === 'git') {
    if (sub && GIT_DENY_SUBCOMMANDS.has(sub)) {
      return { ok: false, reason: `git ${sub} 属于危险子命令，已拦截（如需执行请手动操作）` }
    }
    if (sub === 'config' && args.includes('--global')) {
      return { ok: false, reason: 'git config --global 修改全局配置，已拦截' }
    }
  }
  if (base === 'npm' && sub && NPM_DENY_SUBCOMMANDS.has(sub)) {
    return { ok: false, reason: `npm ${sub} 属于危险子命令，已拦截` }
  }
  if (base === 'node') {
    for (const a of args) {
      if (NODE_DENY_FLAGS.has(a) || a.startsWith('--eval=') || a.startsWith('--print=')) {
        return { ok: false, reason: `node ${a} 属于内联代码执行，已拦截（请写成项目内脚本文件再运行）` }
      }
    }
  }
  if (base === 'gradlew' || base === 'gradlew.bat') {
    if (platform === 'win32') {
      for (const a of args) {
        if (CMD_META_RE.test(a)) {
          return { ok: false, reason: `Gradle 参数包含 cmd 元字符（&|<>^），已拦截：${a}` }
        }
      }
      return { ok: true, file: 'cmd.exe', args: ['/d', '/s', '/c', 'gradlew.bat', ...args] }
    }
    return { ok: true, file: './gradlew', args }
  }
  return { ok: true, file: exec, args }
}

/** 输出采集上限（超出保尾部），回填前再截到 TOOL_RESULT_CLIP */
const COLLECT_CAP = 1_000_000

export interface ProcOutcome {
  code: number | null
  output: string
  timedOut: boolean
  spawnError?: string
}

/** 直起进程（shell:false），合并采集 stdout/stderr，超时 kill */
export function runProcess(
  file: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<ProcOutcome> {
  return new Promise((resolveP) => {
    let out = ''
    let timedOut = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (r: ProcOutcome) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolveP(r)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, args, { cwd, shell: false, windowsHide: true })
    } catch (e) {
      finish({ code: null, output: '', timedOut: false, spawnError: (e as Error).message })
      return
    }
    const append = (chunk: Buffer) => {
      out += chunk.toString('utf-8')
      if (out.length > COLLECT_CAP) out = out.slice(-Math.floor(COLLECT_CAP / 2))
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.on('error', (e) => {
      finish({ code: null, output: out, timedOut, spawnError: e.message })
    })
    child.on('close', (code) => {
      finish({ code, output: out, timedOut })
    })
  })
}

/** 尾部截断（构建日志错误在末尾，保尾不保头） */
function clipTail(text: string, max = TOOL_RESULT_CLIP): string {
  return text.length <= max ? text : `（前文已截断）…${text.slice(-max)}`
}

// ---------------------------------------------------------------------------
// 片段出口
// ---------------------------------------------------------------------------

export function builtinIdeTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'list_files',
        description:
          '列出项目文件树（相对项目根的 POSIX 路径），自动跳过 node_modules/.git/build/.gradle/run/.kunyu 等目录。' +
          '用于了解工程结构、定位文件；支持子目录与文件名通配（如 *.java）。',
        parameters: {
          type: 'object',
          properties: {
            dir: { type: 'string', description: '相对项目根的子目录，缺省为根' },
            glob: { type: 'string', description: '文件名通配（仅 * 与 ?），如 *.java；缺省列出全部文件' },
            maxEntries: {
              type: 'number',
              description: `返回条数上限，默认 ${LIST_DEFAULT_MAX}，最大 ${LIST_HARD_MAX}`
            }
          }
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '无打开的项目' }
      const result = listProjectFiles(root, {
        dir: asString(args['dir']).trim() || undefined,
        glob: asString(args['glob']).trim() || undefined,
        maxEntries: typeof args['maxEntries'] === 'number' ? args['maxEntries'] : undefined
      })
      if (!result.ok) return { ok: false, text: '', error: result.error ?? '列出失败' }
      if (result.entries.length === 0) {
        return { ok: true, text: '未列出任何文件（目录为空或全部命中跳过规则）。', data: { count: 0 } }
      }
      const note = result.truncated ? `（已达上限，仅列出前 ${result.entries.length} 条）\n` : ''
      return {
        ok: true,
        text: clipToolText(`${note}${result.entries.join('\n')}`),
        data: { count: result.entries.length, truncated: result.truncated }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'run_command',
        description:
          '在项目根目录执行白名单命令（gradlew/git/npm/node/java/javac），返回合并输出（长输出保尾部截断）。' +
          'cwd 锁定项目根不可逃逸，参数禁含 .. 与绝对路径；有执行超时（默认 60s，上限 600s）；' +
          '危险子命令会被拦截（git push/reset/clean/rebase、npm publish、node 内联 eval 等）。' +
          'node 脚本须为项目内已存在文件（node xxx.js）。',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '可执行名（白名单内），如 gradlew / git / node' },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: '参数数组（逐元素传递，不经 shell 拼接），如 ["tasks"] 或 ["status","--short"]'
            },
            timeoutMs: { type: 'number', description: '超时毫秒数，默认 60000，范围 5000～600000' }
          },
          required: ['command']
        }
      }
    },
    visibility: 'project',
    execute: async (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '无打开的项目' }
      const command = asString(args['command']).trim()
      if (!command) return { ok: false, text: '', error: 'command 不能为空' }
      const cmdArgs = Array.isArray(args['args'])
        ? args['args'].filter((v): v is string => typeof v === 'string')
        : []
      const timeoutMs = clampRunCommandTimeout(
        typeof args['timeoutMs'] === 'number' ? args['timeoutMs'] : undefined
      )
      const plan = resolveSpawnPlan(command, cmdArgs)
      if (!plan.ok || !plan.file || !plan.args) {
        return { ok: false, text: '', error: plan.reason ?? '命令被拦截' }
      }
      const r = await runProcess(plan.file, plan.args, root, timeoutMs)
      if (r.spawnError) {
        return { ok: false, text: '', error: `无法启动进程：${r.spawnError}` }
      }
      if (r.timedOut) {
        return { ok: false, text: '', error: `执行超时（${timeoutMs}ms，已终止进程）。部分输出：\n${clipTail(r.output)}` }
      }
      const label = `${command} ${cmdArgs.join(' ')}`.trim()
      if (r.code === 0) {
        const body = r.output.trim() ? clipTail(r.output.trim()) : '（无输出）'
        return { ok: true, text: `$ ${label}\n${body}`, data: { code: 0 } }
      }
      return {
        ok: false,
        text: '',
        error: `$ ${label}\n命令退出码 ${r.code ?? '?'}：\n${clipTail(r.output.trim() || '（无输出）')}`
      }
    }
  })

  return tools
}
