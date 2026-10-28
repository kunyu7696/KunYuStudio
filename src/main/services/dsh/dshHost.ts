/**
 * DSH 兼容宿主：不安装 dsh 本体，直接加载社区插件的进程内运行时。
 *
 * 契约依据（官方 cordis-primer / API 目录 / 插件开发指南调研结论）：
 * 1. apply 签名恒为 `(ctx, config)`；服务不按位置传参，插件通过 ctx 属性
 *    解析获取（vendored cordis 的 ctx 是 Proxy），`inject` 仅声明就绪门槛。
 * 2. 服务缺失时插件静默挂起（PENDING）而非报错跳过；宿主据此不调用 apply，
 *    在状态中如实标注等待的服务。
 * 3. apply 的返回值（函数 / Promise<函数> / async iterable）是卸载清理器，
 *    卸载时逆序执行。
 * 4. ctx 方法族：事件 on/once/emit/parallel（bail/serial/waterfall v1 暂不实现，
 *    调用即记警告）；服务 provide/get/set；ctx.inject(deps, cb)；ctx.effect。
 * 5. 没有 ctx.command / ctx.middleware / ready / dispose 事件（Koishi 概念，
 *    DSH 不存在），宿主不臆造。
 * 6. apply 抛错 → fiber FAILED（响亮失败，记为 error 状态）；工具 execute
 *    抛错由 ToolRegistry 捕获为失败结果，不崩进程。
 *
 * 工具名一律加 `dsh_<插件名>_` 前缀避免与内置/MCP 工具撞名。
 */
import { pathToFileURL } from 'node:url'
import type {
  DshInstalledRecord,
  DshPluginStatus
} from '../../../shared/types/dsh'
import type { ToolDefinition } from '../../../shared/types/ai'
import type { ToolRegistry, ToolResult } from '../ai/toolRegistry'
import { isDedicatedPlugin, readInstalledRecords } from './dshCatalog'
import { entryPathOf, trustStateOf, type DshPermission } from './dshTrust'

/** DSH defineTool 声明（社区约定字段子集） */
interface DshToolDef {
  name: string
  description?: string
  parameters?: Record<string, unknown>
  execute?: (args: Record<string, unknown>) => unknown
}

interface HostedTool {
  pluginName: string
  def: DshToolDef
  registryName: string
}

interface PluginLoadState {
  record: DshInstalledRecord
  status: DshPluginStatus
  disposers: Array<() => unknown>
}

/** 宿主级 DSH 系统提示段（插件经 ctx.systemPrompt.section 注入，Agent 系统提示拼接） */
interface DshPromptSection {
  name: string
  order: number
  text: () => string
}

const systemPromptSections: DshPromptSection[] = []

const states = new Map<string, PluginLoadState>()
/** 插件名 → 注册的工具（loadAll 重建） */
const hostedTools = new Map<string, HostedTool[]>()
/**
 * 服务表按插件归属：插件 npm 名 → 该插件 provide/set 的服务。
 * 解析按加载顺序跨插件查找（先装插件发布的服务对后装插件可见，cordis 仓库语义）；
 * disposeAll 全量清理——旧实现是全局 Map 且不清空，卸载后残留服务既可被插件
 * 冒充宿主服务投毒，也会幽灵满足后来插件的 inject。
 */
const providedByPlugin = new Map<string, Map<string, unknown>>()
let loading: Promise<void> | null = null

/** 跨插件解析服务（按加载顺序遍历）：先找到先赢 */
function providedLookup(name: string): { found: boolean; value: unknown } {
  for (const own of providedByPlugin.values()) {
    if (own.has(name)) return { found: true, value: own.get(name) }
  }
  return { found: false, value: undefined }
}

/** 宿主始终提供的服务键（ctx 属性解析可见） */
const HOST_SERVICES = ['tools', 'systemPrompt', 'fiber', 'logger', 'console', 'on', 'once', 'emit', 'parallel', 'inject', 'effect', 'provide', 'set', 'get'] as const

function sanitizeNamePart(text: string): string {
  return text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'plugin'
}

/** 可调用的 LoggerService：ctx.logger 直接打印；ctx.logger(name) 取命名 logger */
function makeLoggerService(pluginName: string): ((name: string) => Console) & Console {
  const prefix = `[dsh:${pluginName}]`
  const wrap =
    (fn: (...args: unknown[]) => void) =>
    (...args: unknown[]) =>
      fn(prefix, ...args)
  const root: Console = {
    ...console,
    log: wrap(console.log),
    info: wrap(console.info),
    warn: wrap(console.warn),
    error: wrap(console.error),
    debug: wrap(console.debug)
  } as Console
  const service = ((name: string) => {
    const named = `${prefix}[${name}]`
    const nWrap = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => fn(named, ...a)
    return { ...console, log: nWrap(console.log), info: nWrap(console.info), warn: nWrap(console.warn), error: nWrap(console.error), debug: nWrap(console.debug) } as Console
  }) as ((name: string) => Console) & Console
  Object.assign(service, root)
  return service
}

type EventListeners = Map<string, Array<(...args: unknown[]) => unknown>>

/** 未获授权的宿主能力：抛错让插件 apply 失败（error 状态可见），而非静默放行 */
function requirePermission(granted: DshPermission[], name: DshPermission, pluginName: string): void {
  if (granted.includes(name)) return
  throw new Error(
    `插件 ${pluginName} 未声明并获授权宿主能力「${name}」（package.json kunyu.permissions），宿主不提供该服务`
  )
}

/** 构建单个插件的 ctx（Proxy 属性解析服务；方法族按调研契约实现） */
function buildContext(
  pluginName: string,
  ownProvided: Map<string, unknown>,
  pluginsDisposers: Array<() => unknown>,
  granted: DshPermission[]
): { ctx: Record<string, unknown>; events: EventListeners } {
  const events: EventListeners = new Map()
  const loggerService = makeLoggerService(pluginName)
  /** 每插件 fiber 视图（稳定引用，config 惰性读取不炸） */
  const fiberView = { config: {} as Record<string, unknown> }

  const on = (name: string, listener: (...args: unknown[]) => unknown): (() => void) => {
    const list = events.get(name) ?? []
    list.push(listener)
    events.set(name, list)
    return () => {
      const cur = events.get(name) ?? []
      const idx = cur.indexOf(listener)
      if (idx >= 0) cur.splice(idx, 1)
    }
  }
  const emit = (name: string, ...args: unknown[]): unknown => {
    let last: unknown
    for (const fn of events.get(name) ?? []) last = fn(...args)
    return last
  }
  const parallel = async (name: string, ...args: unknown[]): Promise<void> => {
    await Promise.all((events.get(name) ?? []).map((fn) => fn(...args)))
  }
  const notImplemented = (method: string) => (): unknown => {
    console.warn(`[dsh:${pluginName}] ctx.${method} 在坤宇兼容宿主中未实现，调用被忽略`)
    return undefined
  }

  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, key) {
      if (typeof key !== 'string') return undefined
      switch (key) {
        case 'on':
          return on
        case 'once':
          return (name: string, listener: (...args: unknown[]) => unknown): (() => void) => {
            const off = on(name, (...args) => {
              off()
              return listener(...args)
            })
            return off
          }
        case 'emit':
          return emit
        case 'parallel':
          return parallel
        case 'serial':
        case 'bail':
        case 'waterfall':
          return notImplemented(key)
        case 'provide':
          return (name: string, value: unknown): (() => void) => {
            ownProvided.set(name, value)
            return () => {
              if (ownProvided.get(name) === value) ownProvided.delete(name)
            }
          }
        case 'set':
          return (name: string, value: unknown): void => {
            ownProvided.set(name, value)
          }
        case 'get':
          return (name: string, strict?: boolean): unknown => {
            const found = providedLookup(name)
            if (!found.found && strict) {
              throw new Error(`服务 ${name} 不存在`)
            }
            return found.value
          }
        case 'inject':
          return (deps: string[], cb: (c: Record<string, unknown>, config: Record<string, unknown>) => unknown): unknown => {
            const missing = deps.filter((d) => !providedLookup(d).found && !(HOST_SERVICES as readonly string[]).includes(d))
            if (missing.length > 0) {
              console.warn(`[dsh:${pluginName}] ctx.inject 等待服务：${missing.join('、')}（宿主未提供，回调挂起）`)
              return undefined
            }
            return cb(ctx, {})
          }
        case 'effect':
          return (execute: () => unknown, _label?: string): unknown => {
            const result = execute()
            if (typeof result === 'function') pluginsDisposers.push(result as () => unknown)
            return result
          }
        default: {
          // 服务解析：宿主服务优先，其次插件 provide 的服务
          // 宿主能力按授权收敛：未在 package.json kunyu.permissions 声明并获授权的
          // 服务不注入（取用即抛错，插件进入 error 状态，原因对外可见）
          if (key === 'tools') {
            requirePermission(granted, 'tools', pluginName)
            return toolsServiceOf(pluginName)
          }
          if (key === 'systemPrompt') {
            requirePermission(granted, 'systemPrompt', pluginName)
            return {
              section: (def: DshPromptSection): (() => void) => {
                systemPromptSections.push(def)
                const remove = (): void => {
                  const idx = systemPromptSections.indexOf(def)
                  if (idx >= 0) systemPromptSections.splice(idx, 1)
                }
                pluginsDisposers.push(remove)
                return remove
              }
            }
          }
          // fiber 视图：社区插件运行时读 ctx.fiber.config（config 惰性解析）
          if (key === 'fiber') return fiberView
          if (key === 'logger' || key === 'console') return loggerService
          const resolved = providedLookup(key)
          if (resolved.found) return resolved.value
          return undefined
        }
      }
    }
  })

  return { ctx, events }
}

/** 每个插件的 tools 服务（register/list/get） */
function toolsServiceOf(pluginName: string): {
  register: (def: DshToolDef) => void
  list: () => HostedTool[]
  get: (name: string) => HostedTool | undefined
} {
  const list = hostedTools.get(pluginName) ?? []
  hostedTools.set(pluginName, list)
  return {
    register(def: DshToolDef) {
      if (!def || typeof def.name !== 'string' || def.name.length === 0) {
        throw new Error('ctx.tools.register 缺少工具名')
      }
      const registryName = `dsh_${sanitizeNamePart(pluginName)}_${sanitizeNamePart(def.name)}`
      const item: HostedTool = { pluginName, def, registryName }
      const existing = list.findIndex((t) => t.def.name === def.name)
      if (existing >= 0) list.splice(existing, 1, item)
      else list.push(item)
    },
    list: () => list,
    get: (name: string) => list.find((t) => t.def.name === name)
  }
}

function injectNames(mod: Record<string, unknown>): string[] {
  const inject = mod.inject
  if (Array.isArray(inject)) return inject.filter((s): s is string => typeof s === 'string')
  if (inject && typeof inject === 'object') return Object.keys(inject)
  return []
}

/** 加载单个插件：信任闸 → inject 门控 → apply(ctx, config) → 捕获 disposer */
async function loadOne(record: DshInstalledRecord): Promise<PluginLoadState> {
  const trust = trustStateOf(record.npm)
  const base: DshPluginStatus = {
    npm: record.npm,
    version: record.version,
    source: record.source,
    state: 'inactive',
    tools: [],
    missingServices: [],
    trustState: trust.state,
    declaredPermissions: trust.declared
  }
  const disposers: Array<() => unknown> = []
  const entryPath = entryPathOf(record.npm)
  if (!entryPath) {
    return { record, status: { ...base, reason: '未找到插件入口（package.json main/exports）' }, disposers }
  }
  // 信任闸门：授权前不 import——插件在主进程执行，授权即等于交出完整系统权限
  if (trust.state !== 'trusted') {
    return {
      record,
      status: {
        ...base,
        reason:
          trust.state === 'changed'
            ? '插件包内容已变更（升级或被替换），原授权自动失效：请核对来源后重新授权运行'
            : '未授权运行：插件将在主进程内以完整系统权限执行，需在本卡片点击「授权运行」后才加载'
      },
      disposers
    }
  }
  let mod: Record<string, unknown>
  try {
    mod = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>
  } catch (err) {
    return { record, status: { ...base, state: 'error', reason: `模块加载失败：${(err as Error).message}` }, disposers }
  }
  if (typeof mod.apply !== 'function') {
    return { record, status: { ...base, reason: '模块未导出 apply(ctx)，不是 DSH 插件' }, disposers }
  }
  const pluginName = typeof mod.name === 'string' && mod.name.length > 0 ? mod.name : record.npm
  const inject = injectNames(mod)

  // cordis 契约：依赖服务不可用 → 插件静默挂起（PENDING），宿主不调用 apply
  const missing = inject.filter(
    (name) => !providedLookup(name).found && !(HOST_SERVICES as readonly string[]).includes(name)
  )
  if (missing.length > 0) {
    return {
      record,
      status: {
        ...base,
        missingServices: missing,
        reason: `已挂起（PENDING）：等待宿主未提供的服务 ${missing.join('、')}，本插件不会激活`
      },
      disposers
    }
  }

  // 本插件的服务按 npm 名归属登记（重载时 disposeAll 会整体清空）
  const ownProvided = new Map<string, unknown>()
  providedByPlugin.set(record.npm, ownProvided)
  const { ctx } = buildContext(pluginName, ownProvided, disposers, trust.granted)
  try {
    // 签名恒为 (ctx, config)；config 取空对象（未实现配置瀑布）
    const returned = await (mod.apply as (c: unknown, config: unknown) => unknown)(ctx, {})
    if (typeof returned === 'function') disposers.push(returned as () => unknown)
    else if (returned instanceof Promise) {
      const resolved = await returned
      if (typeof resolved === 'function') disposers.push(resolved as () => unknown)
    }
  } catch (err) {
    return {
      record,
      status: {
        ...base,
        state: 'error',
        missingServices: missing,
        reason: `apply 执行失败（fiber FAILED）：${(err as Error).message}`
      },
      disposers
    }
  }
  const tools = (hostedTools.get(pluginName) ?? []).map((t) => t.registryName)
  return {
    record,
    status: { ...base, state: 'active', tools, missingServices: [] },
    disposers
  }
}

/** 逆序执行上一代插件的清理器（reload/卸载语义） */
async function disposeAll(): Promise<void> {
  for (const state of [...states.values()].reverse()) {
    for (const disposer of [...state.disposers].reverse()) {
      try {
        await disposer()
      } catch (err) {
        console.warn(`[dsh] 插件 ${state.record.npm} 清理器异常：${(err as Error).message}`)
      }
    }
  }
  states.clear()
  hostedTools.clear()
  systemPromptSections.length = 0
  // 服务表一并清空——旧实现残留 provided，卸载的插件留下的
  // 假服务会幽灵满足后来插件的 inject（甚至冒充宿主服务）
  providedByPlugin.clear()
}

/** 加载全部已安装插件（幂等；安装/卸载后调用刷新，先逆序执行旧清理器） */
export async function loadAllDshPlugins(): Promise<void> {
  if (loading) return loading
  loading = (async () => {
    await disposeAll()
    // 顺序加载：插件可经 ctx.provide 发布服务供后续插件消费（cordis 服务仓库语义）。
    // 专用适配层独占的包（dsh-pet）整体跳过：其 inject 服务通用宿主给不了，
    // 只会 PENDING 并与专属卡片重复；它由 petService 经 dsh-pet-kunyu 驱动。
    for (const record of readInstalledRecords()) {
      if (isDedicatedPlugin(record.npm)) continue
      try {
        states.set(record.npm, await loadOne(record))
      } catch (err) {
        states.set(record.npm, {
          record,
          status: {
            npm: record.npm,
            version: record.version,
            source: record.source,
            state: 'error',
            tools: [],
            missingServices: [],
            trustState: trustStateOf(record.npm).state,
            reason: `加载异常：${(err as Error).message}`
          },
          disposers: []
        })
      }
    }
  })()
  try {
    await loading
  } finally {
    loading = null
  }
}

export function getDshPluginStatuses(): DshPluginStatus[] {
  return [...states.values()].map((s) => s.status)
}

/**
 * 收集 DSH 插件注入的系统提示段（order 升序；text 求值失败按空段跳过）。
 * Agent 系统提示组装时调用；无激活段返回空串（不加空行）。
 */
export function collectDshSystemPrompt(): string {
  if (systemPromptSections.length === 0) return ''
  return [...systemPromptSections]
    .sort((a, b) => a.order - b.order)
    .map((s) => {
      try {
        return (s.text() ?? '').trim()
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

/** 把已激活插件注册的工具桥接进 ToolRegistry（每次 orchestrator run 重建注册表后调用） */
export function registerDshTools(registry: ToolRegistry): void {
  for (const tools of hostedTools.values()) {
    for (const hosted of tools) {
      if (registry.has(hosted.registryName)) continue
      const def = hosted.def
      const fcDef: ToolDefinition = {
        type: 'function',
        function: {
          name: hosted.registryName,
          description: `[DSH 插件 ${hosted.pluginName}] ${def.description ?? def.name}`,
          parameters: dshParamsToSchema(def.parameters)
        }
      }
      registry.registerTool(
        fcDef,
        async (args: Record<string, unknown>): Promise<ToolResult> => {
          if (typeof def.execute !== 'function') {
            return { ok: false, text: '', error: `DSH 工具 ${def.name} 未实现 execute` }
          }
          try {
            return { ok: true, text: normalizeToolOutput(await def.execute(args)) }
          } catch (err) {
            return { ok: false, text: '', error: `DSH 工具 ${def.name} 执行失败：${(err as Error).message}` }
          }
        },
        'chat'
      )
    }
  }
}

/** DSH 参数声明 → OpenAI FC JSON Schema（最佳努力；无法识别时回退空对象） */
export function dshParamsToSchema(spec: unknown): Record<string, unknown> {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { type: 'object', properties: {} }
  }
  const obj = spec as Record<string, unknown>
  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
    return obj
  }
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, raw] of Object.entries(obj)) {
    if (raw === null || typeof raw !== 'object') continue
    const p = raw as { type?: string; required?: boolean; description?: string }
    const mapped = p.type === 'string' ? 'string' : p.type === 'number' || p.type === 'integer' ? 'number' : p.type === 'boolean' ? 'boolean' : null
    if (!mapped) continue
    properties[key] = { type: mapped, ...(p.description ? { description: p.description } : {}) }
    if (p.required === true) required.push(key)
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

/** DSH 工具执行结果 → 统一 ToolResult 文本 */
function normalizeToolOutput(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (item && typeof item === 'object' && 'text' in (item as Record<string, unknown>) ? String((item as Record<string, unknown>).text) : null))
      .filter((t): t is string => t !== null)
    if (parts.length > 0) return parts.join('\n')
  }
  if (value && typeof value === 'object' && 'text' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).text)
  }
  return JSON.stringify(value ?? null)
}
