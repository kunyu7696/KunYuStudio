/**
 * dsh-pet 桌宠服务：在 kunyu 主进程内为原装 dsh-pet 插件提供宿主半边。
 *
 * 架构（对应交付包 dsh-pet-kunyu/，可整目录提交给原作者）：
 * - dsh-pet-kunyu/lib/pet-host.js：伪 ctx 宿主（HTTP server + webServer/llm/
 *   agentDefaultModel/credentials/commands 注入 + 动态 import 原装插件并 apply）。
 *   物理窗口/拖拽/多宠物/配置合并/碎碎念/对话全部是**原作代码**在跑，本服务零复制。
 * - dsh-pet-kunyu/lib/agent-event-bridge.js：kunyu AgentEvent → session/event 桥，
 *   驱动宠物工作状态（thinking/working/waiting/result/success/error）。
 * - 本服务只做 kunyu 侧 glue：llm 适配（aiService.chatStream → plain 流）、
 *   Electron 探测、agent 事件转发、安装通道编排与 IPC 状态。
 *
 * dsh-pet 包来源：本机 DSH 桌面端 ~/.dsh/profiles/desktop/node_modules/dsh-pet
 * 整体复制进 <userData>/dsh-plugins/node_modules/dsh-pet（peerDependencies 全是
 * 未公开的 @deepseek-ai/* 服务包，公共 npm 装不了）。
 * 配置/素材/记忆沿用原作位置（$DSH_HOME/dsh-pet/），用户在 DSH 里配好的宠物直接生效。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'
import { isPackagedRuntime } from '../../runtimeEnv'
import { chatStream, listModels } from '../aiService'
import { onGradleRunEvent } from '../gradleService'
import { getSection } from '../settingsService'
import type { AgentEvent } from '../../../shared/types/agent'
import type { ChatMessage } from '../../../shared/types/ai'
import type { DshPetStatus } from '../../../shared/types/dsh'
import { dshPluginsRoot } from './dshCatalog'
import { installDshPetFromLocal, installDshPlugin, localDshPetSource } from './dshInstaller'
import { checkPetVersion } from './petVersionGate'
import {
  dshBalanceProviderId,
  isDeepSeekCredentialRef,
  isDeepSeekOfficialBaseUrl,
  kunyuProviderIdForDsh
} from './petProviderMap'

// ---------- 交付包（dsh-pet-kunyu/lib）的类型面（纯 ESM JS，运行时动态 import） ----------

/** plain llm 请求（pet-host 已把 DSH 消息拍平成文本） */
interface PlainLlmRequest {
  provider: string
  model: string
  system?: string
  temperature?: number
  signal?: AbortSignal
  messages: Array<{ role: string; content: string }>
}

/** kunyu 注入的 plain llm 适配器契约 */
interface PlainLlmAdapter {
  listProviders?: () => Array<{ id: string; name: string }>
  listModels?: (providerId: string) => Promise<Array<{ id: string; name: string }>>
  currentSelection?: () => { provider: string; model: string } | null
  stream: (req: PlainLlmRequest) => AsyncIterable<{ type: 'text'; text: string }>
}

interface PetHostHandle {
  port: number
  emit(name: string, ...args: unknown[]): unknown
  stop(): Promise<void>
}

interface PetHostModule {
  startPetHost(options: {
    petPackagePath: string
    llm: PlainLlmAdapter
    electronPath?: string
    modelSelection?: () => { provider: string; model: string } | null
    /** 桌宠余额链路取凭证（ref 如 DEEPSEEK_API_KEY）；无对应凭证返回 undefined */
    resolveCredential?: (ref: unknown) => Promise<string | undefined>
    logger?: Console
  }): Promise<PetHostHandle>
}

interface AgentBridge {
  feed(event: AgentEvent): Array<{ type: string; data: Record<string, unknown> }>
  reset(): void
}

// ---------- 运行态 ----------

let host: PetHostHandle | null = null
let bridge: AgentBridge | null = null
let starting: Promise<DshPetStatus> | null = null
let lastError: string | null = null

// ---------- 路径解析 ----------

/** 交付包 lib 目录（dev=项目根 dsh-pet-kunyu/；打包=extraResources/dsh-pet-kunyu/） */
function petHostLibDir(): string {
  return isPackagedRuntime(app)
    ? join(process.resourcesPath, 'dsh-pet-kunyu', 'lib')
    : join(process.cwd(), 'dsh-pet-kunyu', 'lib')
}

/** 已装的 dsh-pet 包根 */
function petPackageDir(): string {
  return join(dshPluginsRoot(), 'node_modules', 'dsh-pet')
}

/** Electron 可执行文件探测（找不到 → 原作插件按它的顺序兜底/下载） */
export function resolvePetElectron(): string | null {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const exe = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? join('Electron.app', 'Contents', 'MacOS', 'Electron') : 'electron'
  const candidates = [
    process.env.DSH_PET_ELECTRON_PATH ?? '',
    join(dshHome, 'electron', exe),
    join(process.cwd(), 'node_modules', 'electron', 'dist', exe)
  ]
  // kunyu 自身就是 Electron 应用，process.execPath 即 electron 可执行文件
  // （dev=electron-vite 的 electron.exe；打包=electron-builder 重命名后的 exe）
  // 仅在 Electron 进程内有效（process.versions.electron 存在），node 测试环境不误加
  if (process.versions.electron) candidates.push(process.execPath)
  return candidates.find((c) => c.length > 0 && existsSync(c)) ?? null
}

// ---------- llm 适配：aiService.chatStream（回调）→ plain 异步流 ----------

/** 当前默认 kunyu 服务商配置（defaultProviderId 优先，回落首个启用的提供商） */
function currentKunyuProvider() {
  const ai = getSection('ai')
  return ai.providers.find((p) => p.id === ai.defaultProviderId) ?? ai.providers.find((p) => p.enabled) ?? null
}

/**
 * 当前模型选择（喂 dsh-pet agentDefaultModel，碎碎念/对话回落它）。
 * provider id 按 baseUrl 映射成 dsh-pet 内置官方 id（如 deepseek-official），
 * 原作的余额查询才认；无法映射的服务商保留 kunyu 随机 id（余额显示 unsupported）。
 */
function kunyuModelSelection(): { provider: string; model: string } | null {
  const provider = currentKunyuProvider()
  if (!provider || !provider.model) return null
  return { provider: dshBalanceProviderId(provider.baseUrl) ?? provider.id, model: provider.model }
}

/** dsh-pet 回传的 provider id 反查 kunyu 真实服务商 id（llm 调用走 kunyu 通道） */
function resolveKunyuProviderId(dshProviderId: string): string {
  return kunyuProviderIdForDsh(dshProviderId, getSection('ai').providers)
}

/**
 * 桌宠余额凭证解析：DeepSeek 官方 ref → 优先当前选中、其次任意已配 key 的
 * 官方 DeepSeek 服务商的 apiKey。中转服务商或未配 key → undefined
 * （原作据此显示 credential-missing / unsupported，不伪造凭证）。
 */
async function resolvePetCredential(ref: unknown): Promise<string | undefined> {
  if (!isDeepSeekCredentialRef(ref)) return undefined
  const ai = getSection('ai')
  const current = ai.providers.find((p) => p.id === ai.defaultProviderId)
  const hit =
    current && isDeepSeekOfficialBaseUrl(current.baseUrl) && current.apiKey
      ? current
      : ai.providers.find((p) => isDeepSeekOfficialBaseUrl(p.baseUrl) && !!p.apiKey)
  return hit?.apiKey || undefined
}

/**
 * 把回调式 chatStream 桥成异步生成器：onDelta 入队列唤醒消费端，
 * 上游结束/失败后先排空队列再终结（错误原样抛出，dsh-pet 捕获为结构化失败原因）。
 */
async function* kunyuStream(req: PlainLlmRequest): AsyncGenerator<{ type: 'text'; text: string }> {
  const messages: ChatMessage[] = []
  if (req.system) messages.push({ role: 'system', content: req.system })
  for (const m of req.messages ?? []) {
    messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })
  }
  const queue: string[] = []
  let settled = false
  let failure: Error | null = null
  let wake: (() => void) | null = null
  const pump = chatStream(
    {
      providerId: resolveKunyuProviderId(req.provider),
      model: req.model,
      messages,
      temperature: req.temperature
    },
    {
      onDelta: (delta) => {
        queue.push(delta)
        wake?.()
      },
      signal: req.signal
    }
  ).then(
    () => {
      settled = true
    },
    (err: unknown) => {
      failure = err instanceof Error ? err : new Error(String(err))
      settled = true
    }
  )
  try {
    for (;;) {
      if (queue.length > 0) {
        yield { type: 'text', text: queue.shift() as string }
        continue
      }
      if (settled) {
        if (failure) throw failure
        return
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      wake = null
    }
  } finally {
    // 消费端提前放弃（如 dsh 超时中断迭代）也不能留未处理 rejection
    void pump.catch(() => {})
  }
}

function makeKunyuLlm(): PlainLlmAdapter {
  return {
    listProviders: () =>
      getSection('ai')
        .providers.filter((p) => p.enabled)
        .map((p) => ({ id: p.id, name: p.name })),
    listModels: async (providerId) => {
      try {
        return (await listModels(resolveKunyuProviderId(providerId))).map((m) => ({ id: m, name: m }))
      } catch {
        return []
      }
    },
    currentSelection: kunyuModelSelection,
    stream: kunyuStream
  }
}

// ---------- 状态 / 启停 ----------

function readPetVersion(): string | null {
  const pkgFile = join(petPackageDir(), 'package.json')
  if (!existsSync(pkgFile)) return null
  try {
    return String((JSON.parse(readFileSync(pkgFile, 'utf-8')) as { version?: string }).version ?? '') || null
  } catch {
    return null
  }
}

export function petStatus(): DshPetStatus {
  const petDir = petPackageDir()
  const petVersion = readPetVersion()
  // 已装才附兼容判定；unverified 带警告文案，unsupported 的阻断原因同时走 error 通道
  const compat = petVersion === null ? null : checkPetVersion(petVersion)
  return {
    running: host !== null && host.port > 0,
    port: host && host.port > 0 ? host.port : null,
    petInstalled: existsSync(join(petDir, 'lib', 'index.js')),
    petVersion,
    electronFound: resolvePetElectron() !== null,
    sourceAvailable: localDshPetSource() !== null,
    ...(compat
      ? {
          compat: compat.level,
          // verified 无消息；unverified 警告随状态展示；unsupported 的文案走 error 阻断
          ...(compat.level === 'unverified' && compat.message ? { compatMessage: compat.message } : {})
        }
      : {}),
    ...(lastError ? { error: lastError } : {})
  }
}

/**
 * 启动桌宠：确保 dsh-pet 已装（未装则走本地目录通道）→ 动态加载交付包宿主 →
 * 注入 kunyu llm/模型选择/Electron → 原作插件 apply（内部自行拉起 helper 窗口）。
 */
export async function startPet(): Promise<DshPetStatus> {
  if (host) return petStatus()
  if (starting) return starting
  starting = (async () => {
    try {
      const petDir = petPackageDir()
      if (!existsSync(join(petDir, 'lib', 'index.js'))) {
        // 通道1：本地复制（DSH 桌面端已装 dsh-pet，最快、零网络）
        let installed = await installDshPetFromLocal()
        // 通道2：npm 安装（--legacy-peer-deps + 5 个 peer shim，需系统 node+npm）
        if (!installed.ok) {
          installed = await installDshPlugin('dsh-pet', 'custom')
        }
        if (!installed.ok) {
          lastError = installed.error ?? 'dsh-pet 安装失败'
          return petStatus()
        }
      }
      // 版本门禁（不改原作方案的配套）：低于适配最低版本硬阻断；
      // 高于验证档只在状态里给警告，不阻止尝试（petStatus.compat 透传渲染层）。
      const compat = checkPetVersion(readPetVersion())
      if (compat.level === 'unsupported') {
        lastError = compat.message
        return petStatus()
      }
      const libDir = petHostLibDir()
      const hostEntry = join(libDir, 'pet-host.js')
      if (!existsSync(hostEntry)) {
        lastError = '未找到 dsh-pet-kunyu 适配层（dev 需项目根 dsh-pet-kunyu/lib，打包需 resources/dsh-pet-kunyu/lib）'
        return petStatus()
      }
      const hostMod = (await import(pathToFileURL(hostEntry).href)) as PetHostModule
      const bridgeMod = (await import(pathToFileURL(join(libDir, 'agent-event-bridge.js')).href)) as {
        createAgentEventBridge(): AgentBridge
      }
      const electronPath = resolvePetElectron()
      const handle = await hostMod.startPetHost({
        petPackagePath: petDir,
        llm: makeKunyuLlm(),
        ...(electronPath ? { electronPath } : {}),
        modelSelection: kunyuModelSelection,
        resolveCredential: resolvePetCredential,
        logger: console
      })
      host = handle
      bridge = bridgeMod.createAgentEventBridge()
      lastError = null
      return petStatus()
    } catch (err) {
      lastError = (err as Error).message
      return petStatus()
    } finally {
      starting = null
    }
  })()
  return starting
}

/** 停止桌宠：逆序执行插件注册的 disposer（内含原作 stopHelper），再关 HTTP server */
export async function stopPet(): Promise<DshPetStatus> {
  const current = host
  host = null
  bridge?.reset()
  bridge = null
  lastError = null
  if (current) {
    try {
      await current.stop()
    } catch (err) {
      lastError = (err as Error).message
    }
  }
  return petStatus()
}

/**
 * Agent 事件转发（aiRuntimeHandlers 的 run/resumeRun 回调调用）：
 * 桥映射成 session/event 帧后喂给原作插件的 ctx.on('session/event') 监听器。
 * 未启动时静默丢弃（桌宠关闭不影响 Agent 运行）。
 */
export function notifyPetAgentEvent(event: AgentEvent): void {
  if (!host || !bridge) return
  for (const frame of bridge.feed(event)) {
    try {
      host.emit('session/event', { header: { id: event.runId } }, { ...frame, seq: event.seq })
    } catch (err) {
      console.warn('[petService] session/event 喂送失败（忽略）：', (err as Error).message)
    }
  }
}

// ---------- 手动 Gradle 构建 → 桌宠桥接（方案乙） ----------
//
// 手动构建不走 Agent 事件流，桌宠感知不到。这里订阅 gradleService 生命周期事件，
// 合成 `gradle:<runId>` 的 AgentEvent 复用 session/event 桥：
// started → phase running（宠物转 thinking）；done 按 status 三态分流——
// success→done（庆祝）、fail→error（错误态）、cancel（取消/超时）→skipped
// （桥映射 turn/end(aborted)，原作会话清理回空闲，不残留工作状态）。
let gradleBridgeDisposer: (() => void) | null = null

/** 注册 Gradle 构建 → 桌宠事件桥（幂等；IPC 注册时调用一次即可） */
export function bridgeGradleEventsToPet(): void {
  if (gradleBridgeDisposer) return
  gradleBridgeDisposer = onGradleRunEvent((e) => {
    const petRunId = `gradle:${e.runId}`
    const at = new Date().toISOString()
    if (e.phase === 'started') {
      notifyPetAgentEvent({
        type: 'phase',
        phase: 'running',
        runId: petRunId,
        seq: 0,
        stage: 'build',
        action: e.tasks.join(' '),
        at
      })
    } else {
      notifyPetAgentEvent({
        type: 'phase',
        phase: e.status === 'success' ? 'done' : e.status === 'cancel' ? 'skipped' : 'error',
        runId: petRunId,
        seq: 1,
        stage: 'build',
        at
      })
    }
  })
}
