/**
 * Gradle 子进程封装（M5 T5.1/T5.3）。
 * - 调用项目内 gradlew（Windows: gradlew.bat；POSIX: ./gradlew），--console=plain
 * - stdout/stderr 实时切片推送渲染进程；支持取消（进程树）与超时
 * - runClient 时轮询 run/logs/latest.log 判定启动成功，轮询 crash-reports 捕获崩溃摘要
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { IpcChannels } from '../../shared/types/ipc'
import type {
  CrashSummary,
  GradleEvent,
  GradleRunInput
} from '../../shared/types/build'
import { getSection } from './settingsService'
import { isPackagedRuntime } from '../runtimeEnv'
import { resolveObserverAgentJar } from './observer/observerService'
import { assertCmdSafe } from '../utils/cmdSafe'
import { generateObserverToken, setObserverToken } from './observer/observerToken'
import { lintBraceBalance } from './ai/fcTools/projectFilePolicy'

interface ActiveRun {
  runId: string
  child: ChildProcess
  root: string
  tasks: string[]
  /** 多实例 id（默认实例为 undefined） */
  instanceId?: string
  /** 实际游戏目录（默认 run/，多实例 .kunyu/runs/<id>），日志/崩溃轮询走这里 */
  gameRunDir: string
  /** 事件出口：IPC 构建走 webContents.send，编译探针走进程内回调 */
  sink: GradleSink
  cancelled: boolean
  timedOut: boolean
  /** 检测到 Gradle daemon 文件锁冲突（FileHasher 拒绝访问），用于自动重试 */
  daemonConflict: boolean
  /** 是否已因 daemon 冲突重试过（避免无限重试） */
  retried: boolean
  startedAt: number
  timeoutTimer: ReturnType<typeof setTimeout> | null
  pollTimer: ReturnType<typeof setInterval> | null
  logOffset: number
  startedSent: boolean
  crashSent: Set<string>
  knownCrashes: Set<string>
}

/** 实例 id 白名单：短、小写、无路径字符 */
const INSTANCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** 构建运行生命周期事件（供桌宠等外部模块订阅，与 sink 推送解耦） */
export interface GradleRunLifecycleEvent {
  runId: string
  phase: 'started' | 'done'
  exitCode: number | null
  cancelled: boolean
  tasks: string[]
  /** 终态分流（仅 phase=done 时存在）：success 成功 / fail 失败 / cancel 取消或超时 */
  status?: 'success' | 'fail' | 'cancel'
}
export type GradleRunListener = (event: GradleRunLifecycleEvent) => void
const runListeners = new Set<GradleRunListener>()

/** 订阅构建运行事件，返回退订函数 */
export function onGradleRunEvent(fn: GradleRunListener): () => void {
  runListeners.add(fn)
  return () => {
    runListeners.delete(fn)
  }
}

function emitRunEvent(event: GradleRunLifecycleEvent): void {
  for (const fn of runListeners) {
    try {
      fn(event)
    } catch {
      /* 监听器异常不得影响构建主流程 */
    }
  }
}

/** 多实例游戏目录（相对项目根，正斜杠写法同时可作为 --gameDir 参数） */
export function instanceGameDirRel(instanceId: string): string {
  return `.kunyu/runs/${instanceId}`
}

/** 无窗口 Gradle 执行的事件出口（M7 编译探针复用） */
export type GradleSink = (event: GradleEvent) => void

const activeRuns = new Map<string, ActiveRun>()
const MAX_OUTPUT_CHUNK = 64 * 1024

/** 游戏启动成功标记（1.17+ 开发客户端 latest.log） */
const GAME_STARTED_RE = /(Sound engine started|Backend library: LWJGL|OpenAL initialized)/
const GAME_STOPPING_RE = /Stopping!/

/** 崩溃根因关键词分类（T5.3） */
const CRASH_KEYWORDS: Array<[RegExp, string]> = [
  [/OutOfMemoryError/, '内存不足（OutOfMemoryError）'],
  [/UnsupportedClassVersionError/, 'JDK 版本不匹配（类版本过高）'],
  [/ClassNotFoundException|NoClassDefFoundError|NoSuchMethodError|NoSuchFieldError/, '依赖缺失或模组版本不兼容'],
  [/already registered|duplicate registration|Registry.*already/, '注册冲突（重复注册）'],
  [/MixinApplyError|mixins\.json|Mixin transformation/, 'Mixin 注入失败（模组兼容性）'],
  [/FileNotFoundException|ResourceNotFoundException/, '资源文件缺失'],
  [/NullPointerException/, '空指针异常（NullPointerException）'],
  [/IllegalArgumentException/, '非法参数（IllegalArgumentException）'],
  [/ExceptionInInitializerError/, '静态初始化失败'],
  [/StackOverflowError/, '栈溢出（StackOverflowError）']
]

function emit(win: BrowserWindow, event: GradleEvent): void {
  if (!win.isDestroyed()) win.webContents.send(IpcChannels.GRADLE_EVENT, event)
}

function push(run: ActiveRun, event: GradleEvent): void {
  try {
    run.sink(event)
  } catch {
    /* 回调异常不影响子进程管理 */
  }
}

/** 解析 crash-report 文本为摘要 */
export function parseCrashReport(text: string, reportPath: string): CrashSummary {
  const descriptionMatch = text.match(/^Description:\s*(.+)$/m)
  const description = descriptionMatch?.[1]?.trim() ?? '崩溃报告未提供 Description'

  // Headline 段：Description 空行之后的第一个非缩进行（异常类型）
  let headline = ''
  const afterDesc = text.slice((descriptionMatch?.index ?? 0) + (descriptionMatch?.[0]?.length ?? 0))
  for (const line of afterDesc.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('at ') || t.startsWith('...')) continue
    if (/^--\s.*\s--$/.test(t)) break
    headline = t
    break
  }
  if (!headline) headline = description

  // 最后一条 Caused by 通常是根因
  const caused = [...text.matchAll(/^Caused by:\s*(.+)$/gm)].map((m) => m[1]?.trim() ?? '')
  const cause = caused.length > 0 ? caused[caused.length - 1]! : headline

  const keyword = CRASH_KEYWORDS.find(([re]) => re.test(cause) || re.test(headline))?.[1]
    ?? '未分类异常（请查看完整报告）'

  return { reportPath, description, headline, cause, keyword }
}

/** 读取最新 crash-report（轮询用） */
function readNewestCrash(run: ActiveRun): string | null {
  const dir = join(run.gameRunDir, 'crash-reports')
  if (!existsSync(dir)) return null
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.txt'))
  } catch {
    return null
  }
  if (files.length === 0) return null
  files.sort()
  return join(dir, files[files.length - 1]!)
}

/** 轮询 run 目录：检测游戏启动成功标记与新崩溃报告（T5.3） */
function pollGameState(run: ActiveRun): void {
  // 1) latest.log 增量扫描启动标记
  const logPath = join(run.gameRunDir, 'logs', 'latest.log')
  if (existsSync(logPath)) {
    try {
      const stat = statSync(logPath)
      if (stat.size < run.logOffset) run.logOffset = 0 // 日志被重置（新会话）
      if (stat.size > run.logOffset) {
        const len = Math.min(MAX_OUTPUT_CHUNK, stat.size - run.logOffset)
        const fd = readFileSync(logPath)
        // 增量读取 [offset, size]；单轮增量超过上限时只取尾部
        const start = Math.max(run.logOffset, stat.size - len)
        const tail = fd.subarray(start, stat.size).toString('utf8')
        run.logOffset = stat.size
        if (!run.startedSent && GAME_STARTED_RE.test(tail)) {
          run.startedSent = true
          push(run, { type: 'game-started', runId: run.runId })
        }
        if (GAME_STOPPING_RE.test(tail)) {
          // 玩家正常关闭游戏：稍后进程自行退出
        }
      }
    } catch {
      /* 读取瞬间可能被占用，下轮重试 */
    }
  }

  // 2) 新崩溃报告
  const newest = readNewestCrash(run)
  if (newest && !run.knownCrashes.has(newest) && !run.crashSent.has(newest)) {
    run.crashSent.add(newest)
    try {
      const text = readFileSync(newest, 'utf8')
      push(run, { type: 'crash', runId: run.runId, crash: parseCrashReport(text, newest) })
    } catch {
      /* 报告尚未写完，下轮重试 */
      run.crashSent.delete(newest)
    }
  }
}

/** Windows 下杀整棵进程树（gradlew.bat → java）。
 *  必须用 spawnSync 阻塞等待 taskkill 完成：矩阵门禁超时清理场景下，
 *  异步 spawn 会导致 afterEach 的 rmSync 先于进程退出执行而抛 EBUSY，
 *  且 activeRuns 残留 run 阻塞后续组合的并发检查。 */
function killWindowsTree(pid: number): void {
  try {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 30000 })
  } catch {
    /* taskkill 失败不阻塞上层流程 */
  }
}

/** 结束本活动运行的全部资源 */
function finishRun(
  run: ActiveRun,
  exitCode: number | null,
  signal: NodeJS.Signals | null
): void {
  if (run.timeoutTimer) clearTimeout(run.timeoutTimer)
  if (run.pollTimer) clearInterval(run.pollTimer)
  activeRuns.delete(run.runId)

  // runClient 退出时若没发过启动成功，再尝试抓一次崩溃报告
  if (run.tasks.some((t) => t === 'runClient') && !run.startedSent) {
    const newest = readNewestCrash(run)
    if (newest && !run.crashSent.has(newest)) {
      try {
        const text = readFileSync(newest, 'utf8')
        push(run, { type: 'crash', runId: run.runId, crash: parseCrashReport(text, newest) })
      } catch {
        /* 忽略读取失败 */
      }
    }
  }

  push(run, {
    type: 'phase',
    runId: run.runId,
    phase: 'done',
    exitCode,
    cancelled: run.cancelled,
    timedOut: run.timedOut,
    durationMs: Date.now() - run.startedAt
  })
  emitRunEvent({
    runId: run.runId,
    phase: 'done',
    exitCode,
    cancelled: run.cancelled,
    tasks: run.tasks,
    status: run.cancelled || run.timedOut ? 'cancel' : exitCode === 0 ? 'success' : 'fail'
  })
  void signal
}

/**
 * 将设置的 Gradle 内存同步进项目 gradle.properties 的 org.gradle.jvmargs。
 * daemon 堆参数只认该属性（GRADLE_OPTS/-D 均不影响 daemon 上下文），
 * 与 Android Studio 的内存管理方式一致；无变化时返回 null 不写盘。
 */
function syncGradleMemory(root: string, mb: number): string | null {
  const propsPath = join(root, 'gradle.properties')
  if (!existsSync(propsPath)) return null
  const raw = readFileSync(propsPath, 'utf8')
  // (\r?) 捕获 CRLF 行尾，替换时保留原文件的换行风格；分组 1 仅捕获「=」右侧的值
  const lineRe = /^[ \t]*org\.gradle\.jvmargs[ \t]*=(.*?)(\r?)$/m
  const match = raw.match(lineRe)
  if (!match) {
    const desired = `org.gradle.jvmargs=-Xmx${mb}m`
    writeFileSync(propsPath, raw.replace(/\s*$/, '') + `\n\n# Gradle memory (managed by KunYu Studio settings)\n${desired}\n`, 'utf8')
    return desired
  }
  // 仅替换/追加 -Xmx 段，保留行内其余 JVM 参数（-XX:*、-Xms 等）
  const original = match[1].trim()
  const next = /-Xmx\S+/i.test(original)
    ? original.replace(/-Xmx\S+/i, `-Xmx${mb}m`)
    : `${original} -Xmx${mb}m`
  if (next === original) return null
  const line = `org.gradle.jvmargs=${next}${match[2]}`
  // 使用函数替换，避免行内 $ 序列被当作替换模式解释
  writeFileSync(propsPath, raw.replace(lineRe, () => line), 'utf8')
  return line.trim()
}

/**
 * S-05：runClient 启动前生成一次性 observer 令牌并解析 agent jar 路径，
 * 写入 gradle.properties 的 kunyu.observer.token / kunyu.observer.agent，
 * 由 build.gradle 的 -javaagent vmArg 传入游戏 JVM（javaagent 形态，覆盖全加载器全版本）；
 * 同时记录到进程内 store，供 observerClient 在 HTTP 请求头 X-Observer-Token 中附带。
 * agent 未构建时写入空值，模板 if 条件跳过挂载（observer 缺失不阻塞启动）。
 */
function syncObserverLaunchProps(root: string): string {
  const token = generateObserverToken()
  setObserverToken(root, token)
  // properties 文件反斜杠是转义符：Windows 路径必须转正斜杠（Groovy/Java 均接受）
  const aiSection = getSection('ai') as { observerAutoInject?: boolean }
  const enabled = aiSection.observerAutoInject !== false // 默认 true
  const agentJar = enabled
    ? resolveObserverAgentJar(process.resourcesPath, app.getAppPath(), isPackagedRuntime(app))
    : null
  const agentProp = agentJar ? agentJar.replace(/\\/g, '/') : ''
  const propsPath = join(root, 'gradle.properties')
  const header = '# Kunyu observer agent (rotated on each runClient)'
  const upsert = (raw: string, key: string, value: string): string => {
    const lineRe = new RegExp(`^[ \\t]*${key.replace(/\./g, '\\.')}[ \\t]*=.*?(\\r?)$`, 'm')
    if (lineRe.test(raw)) return raw.replace(lineRe, () => `${key}=${value}$1`)
    return raw.replace(/\s*$/, '') + `\n${key}=${value}\n`
  }
  let raw = existsSync(propsPath) ? readFileSync(propsPath, 'utf8') : `${header}\n`
  if (!raw.includes('kunyu.observer.token') && !raw.includes('kunyu.observer.agent')) {
    raw = raw.replace(/\s*$/, '') + `\n${header}\n`
  }
  raw = upsert(raw, 'kunyu.observer.token', token)
  raw = upsert(raw, 'kunyu.observer.agent', agentProp)
  writeFileSync(propsPath, raw, 'utf8')
  return token
}

/**
 * 存量项目迁移：observer 从 Fabric mod 改为 javaagent 后，
 * 旧模板生成的 `vmArg/jvmArg/jvmArgument/systemProperty "-Dkunyu.observer.token=..."`
 * 行已无法挂载 agent。runClient 前幂等替换为 if (agent) { -javaagent } 条件块；
 * 已是新形态或用户自定义的文件零触碰。
 * @returns 是否实际迁移了文件
 */
export function migrateObserverAgentVmArg(root: string): boolean {
  const gradlePath = join(root, 'build.gradle')
  if (!existsSync(gradlePath)) return false
  let raw: string
  try {
    raw = readFileSync(gradlePath, 'utf8')
  } catch {
    return false
  }
  if (raw.includes('kunyu.observer.agent')) return false
  // 旧行签名：四种 DSL 写法（loom vmArg / FG jvmArg / MDG jvmArgument / FG7 systemProperty）
  const rules: Array<{ re: RegExp; method: string }> = [
    {
      re: /^([ \t]*)vmArg "-Dkunyu\.observer\.token=\$\{project\.findProperty\('kunyu\.observer\.token'\) \?: ''\}"[ \t]*\r?$/m,
      method: 'vmArg'
    },
    {
      re: /^([ \t]*)jvmArg "-Dkunyu\.observer\.token=\$\{project\.findProperty\('kunyu\.observer\.token'\) \?: ''\}"[ \t]*\r?$/m,
      method: 'jvmArg'
    },
    {
      re: /^([ \t]*)jvmArgument "-Dkunyu\.observer\.token=\$\{project\.findProperty\('kunyu\.observer\.token'\) \?: ''\}"[ \t]*\r?$/m,
      method: 'jvmArgument'
    },
    {
      re: /^([ \t]*)systemProperty 'kunyu\.observer\.token', "\$\{project\.findProperty\('kunyu\.observer\.token'\) \?: ''\}"[ \t]*\r?$/m,
      method: 'jvmArgument'
    }
  ]
  let next = raw
  let migrated = false
  for (const { re, method } of rules) {
    next = next.replace(re, (_m, indent: string) => {
      migrated = true
      return (
        `${indent}if (project.findProperty('kunyu.observer.agent')) {\n` +
        `${indent}    ${method} "-javaagent:\${project.findProperty('kunyu.observer.agent')}=port=9876,token=\${project.findProperty('kunyu.observer.token') ?: ''}"\n` +
        `${indent}}`
      )
    })
  }
  if (!migrated) return false
  try {
    writeFileSync(gradlePath, next, 'utf8')
  } catch {
    return false
  }
  return true
}

/**
 * 存量项目修复：commit 6441c49 引入的 S-05 loom 块模板少一个闭合
 * 括号（6658529 已修模板，但用坏模板脚手架生成的存量项目 build.gradle 天生带病），
 * Gradle 解析直接失败（Unexpected input: '{'），且该文件在 AI 通道黑名单内，
 * 治愈循环无法自动修复。
 * 按坏块精确签名做确定性替换；仅当整文件括号不平衡、且替换后恢复平衡时才写回，
 * 用户手写的正常文件零触碰。幂等，毫秒级。
 * @returns 是否实际修复了文件
 */
export function repairLegacyS05LoomBlock(root: string): boolean {
  const gradlePath = join(root, 'build.gradle')
  if (!existsSync(gradlePath)) return false
  let raw: string
  try {
    raw = readFileSync(gradlePath, 'utf8')
  } catch {
    return false
  }
  if (lintBraceBalance(raw) === null) return false
  const brokenRe =
    /(vmArg "-Dkunyu\.observer\.token=\$\{project\.findProperty\('kunyu\.observer\.token'\) \?: ''\}"\r?\n)    \}\r?\n\}\r?\n/
  if (!brokenRe.test(raw)) return false
  const fixed = raw.replace(brokenRe, (_m, p1: string) => `${p1}        }\n    }\n}\n`)
  if (lintBraceBalance(fixed) !== null) return false
  try {
    writeFileSync(gradlePath, fixed, 'utf8')
  } catch {
    return false
  }
  return true
}

/**
 * 启动 Gradle 任务（无窗口回调形态，M7 编译探针复用；输出收集进 sink）。
 * @throws 项目缺少 gradlew 或已有任务运行时抛错
 */
export function executeGradleBuild(input: GradleRunInput, sink: GradleSink, reuseRunId?: string): string {
  const root = resolve(input.root)
  const isWin = process.platform === 'win32'
  // S-01：root 最终拼接进 `cmd.exe /c <wrapper>`，路径含 cmd 元字符（& | ^ % 等）
  // 时会被 cmd 二次解析为命令分隔符，导致任意命令执行。Windows 合法路径通常不含
  // 这些字符，直接拒绝。tasks/extraArgs 的白名单见下方 GRADLE_ARG_RE。
  if (isWin) assertCmdSafe('项目路径', root)
  const wrapper = isWin ? join(root, 'gradlew.bat') : join(root, 'gradlew')
  if (!existsSync(wrapper)) {
    throw new Error(`项目中未找到 Gradle Wrapper（${isWin ? 'gradlew.bat' : 'gradlew'}），无法构建`)
  }

  const isGame = input.tasks.includes('runClient')

  // tasks/extraArgs 来自 IPC，
  // 且 Windows 下经 cmd.exe /c 拼接执行——不设白名单时 `tasks:['x& powershell -c …']`
  // 即任意命令注入。任务名/旗标统一按安全字符集校验（旗标如 -x/--info 同样放行），
  // 空白与 shell 元字符 & | ; < > ( ) ! $ ` \ " ' 一律拒绝。
  const GRADLE_ARG_RE = /^[A-Za-z0-9_./:=+-]+$/
  const invalid = [
    ...input.tasks,
    ...(input.extraArgs ?? [])
  ].find((t) => !GRADLE_ARG_RE.test(t))
  if (invalid) {
    throw new Error(`非法 Gradle 参数（仅允许字母/数字/_ . / : = + -，不允许空白与 shell 元字符）: ${invalid}`)
  }

  // 多实例 id 校验：仅 runClient 允许携带；非法字符直接拒绝（防路径穿越）
  const rawId = input.instanceId?.trim()
  if (rawId !== undefined && !isGame) {
    throw new Error('instanceId 仅用于 runClient 多实例，构建类任务不支持')
  }
  if (rawId && !INSTANCE_ID_RE.test(rawId)) {
    throw new Error('instanceId 只能包含小写字母、数字、下划线、短横线（1-32 位）')
  }
  const instanceId = isGame && rawId ? rawId : undefined

  // 并发规则：只有「各自带不同 instanceId 的 runClient」可并行；其余一律独占
  for (const other of activeRuns.values()) {
    const otherGame = other.tasks.includes('runClient')
    const coexist =
      isGame &&
      otherGame &&
      !!instanceId &&
      !!other.instanceId &&
      instanceId !== other.instanceId
    if (!coexist) {
      throw new Error(
        otherGame
          ? `已有游戏实例正在运行（${other.instanceId ? `id=${other.instanceId}` : '默认 run/ 目录'}），请先停止或使用不同的 instanceId`
          : '已有 Gradle 任务正在运行，请先停止当前任务'
      )
    }
  }

  const runId = reuseRunId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const args = [...input.tasks, '--console=plain', ...(input.extraArgs ?? [])]

  // 多实例隔离：独立 gameDir（存档/日志/mods）+ 独立 project-cache（避开同项目缓存互锁）
  const gameRunDir = isGame
    ? join(root, instanceId ? instanceGameDirRel(instanceId) : 'run')
    : join(root, 'run')
  if (isGame) {
    mkdirSync(gameRunDir, { recursive: true })
    if (instanceId) {
      const relGameDir = instanceGameDirRel(instanceId)
      args.push('--project-cache-dir', `.kunyu/cache/${instanceId}`)
      // Loom runClient 把 --args 整串透传给游戏主类；相对路径基于 Gradle cwd（项目根）
      args.push(`--args=--gameDir ${relGameDir}`)
    }
  }

  const env: NodeJS.ProcessEnv = { ...process.env }
  if (input.javaHome) {
    env['JAVA_HOME'] = input.javaHome
    const sep = isWin ? ';' : ':'
    // Windows 环境块大小写不敏感，只写 Path——同时写 Path/PATH 两个键时
    // 部分进程链（vitest fork 等）会生成含大小写重复项的坏 env 块，
    // CreateProcess 直接失败（spawn cmd.exe ENOENT）。
    const pathKey = isWin ? 'Path' : 'PATH'
    env[pathKey] = `${join(input.javaHome, 'bin')}${sep}${env[pathKey] ?? ''}`
  }
  // 构建类任务强制 javac/Gradle 输出英文（中文系统默认 zh_CN 会输出“错误:/警告:”且按 GBK 编码）
  if (!isGame) {
    env['JAVA_TOOL_OPTIONS'] = '-Duser.language=en -Duser.country=US'
  }
  // M6：Gradle 守护进程内存上限取自设置（默认 2048）。
  // daemon 堆参数只认项目 gradle.properties 的 org.gradle.jvmargs，故以同步属性文件的方式下发；
  // 变化时在面板给出系统提示。GRADLE_OPTS 仅对 launcher 生效，不承载该配置。
  const gradleMemoryMb = getSection('java').gradleMemoryMb
  const memoryLine = syncGradleMemory(root, gradleMemoryMb)
  // S-05：runClient 前轮换 observer 令牌 + 解析 agent 路径，写入 gradle.properties 供游戏 JVM 读取；
  // 存量项目先把旧的 -Dkunyu.observer.token vmArg 行迁移为 javaagent 条件块
  if (isGame) {
    migrateObserverAgentVmArg(root)
    syncObserverLaunchProps(root)
  }

  let child: ChildProcess
  if (isWin) {
    // cmd /c 保证 .bat 可执行；得到的 PID 是 cmd.exe，取消时按进程树杀
    child = spawn('cmd.exe', ['/c', wrapper, ...args], {
      cwd: root,
      env,
      windowsHide: true
    })
  } else {
    // detached 新进程组，取消时整组结束
    child = spawn('sh', [wrapper, ...args], {
      cwd: root,
      env,
      detached: true
    })
  }

  const run: ActiveRun = {
    runId,
    child,
    root,
    tasks: input.tasks,
    instanceId,
    gameRunDir,
    sink,
    cancelled: false,
    timedOut: false,
    daemonConflict: false,
    retried: false,
    startedAt: Date.now(),
    timeoutTimer: null,
    pollTimer: null,
    logOffset: 0,
    startedSent: false,
    crashSent: new Set(),
    knownCrashes: new Set()
  }
  activeRuns.set(runId, run)

  // runClient：observer 为 javaagent 形态，由 build.gradle 的
  // -javaagent vmArg 自动挂载，覆盖 Fabric/Forge/NeoForge 与 MC 全版本；
  // 不再像旧 mod 那样复制 jar 进 mods 目录。

  // 启动时快照已有崩溃报告，避免误报历史崩溃
  const crashDir = join(gameRunDir, 'crash-reports')
  if (existsSync(crashDir)) {
    try {
      readdirSync(crashDir)
        .filter((f) => f.endsWith('.txt'))
        .forEach((f) => run.knownCrashes.add(join(crashDir, f)))
    } catch {
      /* 忽略 */
    }
  }

  // runClient 轮询游戏日志与崩溃目录
  if (isGame) {
    run.pollTimer = setInterval(() => pollGameState(run), 1500)
  }

  if (input.timeoutMs && input.timeoutMs > 0) {
    run.timeoutTimer = setTimeout(() => {
      run.timedOut = true
      push(run, {
        type: 'output',
        runId,
        stream: 'system',
        text: `\n任务超过 ${Math.round(input.timeoutMs! / 1000)}s 超时，已终止进程。\n`
      })
      cancelGradle(runId)
    }, input.timeoutMs)
  }

  /** 按行推送（保留残余缓冲区直到收到换行） */
  const bindStream = (stream: NodeJS.ReadableStream, kind: 'stdout' | 'stderr'): void => {
    let buffer = ''
    stream.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n|\r(?!\n)/)
      buffer = lines.pop() ?? ''
      const text = lines.length > 0 ? lines.join('\n') + '\n' : ''
      if (text) push(run, { type: 'output', runId, stream: kind, text })
      // 检测 Gradle daemon 文件锁冲突（FileHasher 拒绝访问），用于退出后自动重试
      if (!run.daemonConflict && /FileHasher/.test(text) && /拒绝访问|Access [Dd]enied/i.test(text)) {
        run.daemonConflict = true
      }
    })
    stream.on('end', () => {
      if (buffer) push(run, { type: 'output', runId, stream: kind, text: buffer + '\n' })
    })
  }
  if (child.stdout) bindStream(child.stdout, 'stdout')
  if (child.stderr) bindStream(child.stderr, 'stderr')

  child.on('error', (err) => {
    push(run, {
      type: 'output',
      runId,
      stream: 'system',
      text: `\n无法启动 Gradle 进程：${err.message}\n`
    })
    finishRun(run, -1, null)
  })

  child.on('close', (code, signal) => {
    // 检测到 Gradle daemon 文件锁冲突时，自动清理残留 daemon 后重试一次
    if (
      run.daemonConflict &&
      !run.retried &&
      code !== 0 &&
      !run.cancelled &&
      !run.timedOut
    ) {
      run.retried = true
      // 先从 activeRuns 移除旧 run，否则重试启动时并发检查会误判
      activeRuns.delete(run.runId)
      if (run.timeoutTimer) clearTimeout(run.timeoutTimer)
      if (run.pollTimer) clearInterval(run.pollTimer)
      push(run, {
        type: 'output',
        runId,
        stream: 'system',
        text: '\n[自动恢复] 检测到 Gradle daemon 文件锁冲突（FileHasher 拒绝访问），正在清理残留 daemon 并重试构建…\n'
      })
      try {
        spawnSync(
          isWin ? 'cmd.exe' : 'sh',
          isWin ? ['/c', wrapper, '--stop'] : [wrapper, '--stop'],
          { cwd: root, env, windowsHide: true, timeout: 15000 }
        )
      } catch {
        /* --stop 失败不阻塞重试 */
      }
      // 用同样 input 重新启动，复用旧 runId（P0-5 修复）：waitForGradleDone 等的是旧 runId，
      // cancel 通过 state.gradleRunId 杀的也是旧 runId——复用后重试进程的 done 事件能匹配旧 waiter，
      // cancelGradle 也能杀到重试后的新进程。
      executeGradleBuild({ ...input }, sink, run.runId)
      return
    }
    finishRun(run, code, signal)
  })

  push(run, { type: 'phase', runId, phase: 'started', exitCode: null, cancelled: false, timedOut: false, durationMs: 0 })
  emitRunEvent({ runId, phase: 'started', exitCode: null, cancelled: false, tasks: input.tasks })
  if (memoryLine) {
    push(run, {
      type: 'output',
      runId,
      stream: 'system',
      text: `[设置] 已按 Gradle 内存设置更新 gradle.properties：${memoryLine}\n`
    })
  }
  return runId
}

/**
 * 启动 Gradle 任务（IPC 形态：行为与 M5/M6 完全一致，事件推送到窗口）。
 * @throws 项目缺少 gradlew 或已有任务运行时抛错
 */
export function startGradle(win: BrowserWindow, input: GradleRunInput): string {
  return executeGradleBuild(input, (event) => emit(win, event))
}

/** 取消运行中的 Gradle 任务（杀进程树） */
export function cancelGradle(runId?: string): boolean {
  const run = runId ? activeRuns.get(runId) : [...activeRuns.values()][0]
  if (!run) return false
  run.cancelled = true
  const pid = run.child.pid
  if (pid === undefined) return false
  if (process.platform === 'win32') {
    killWindowsTree(pid)
  } else {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      run.child.kill('SIGTERM')
    }
  }
  return true
}

/** 是否有活动任务（渲染端构建按钮状态用） */
export function hasActiveRun(): boolean {
  return activeRuns.size > 0
}
