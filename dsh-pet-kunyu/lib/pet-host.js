/**
 * dsh-pet-kunyu 桌宠宿主（pet-host）
 *
 * 职责（对齐 dsh-pet lib/standalone.js 的 createStandaloneContext 契约，等价于官方
 * 「独立模式」的伪 ctx，但把 LLM 与事件源外置为注入项，方便任意宿主接入）：
 *   1. 起一个 127.0.0.1 的 HTTP server，按「前缀路由」分发到 dsh-pet 注册的
 *      handlePetRoute（/dsh-pet-7340/*：config/state/whisper/broadcast/anim/chat/
 *      models/文件素材），helper 的 bridge scheme 与直接 HTTP 都走这里；
 *   2. 构造 dsh-pet 插件（lib/index.js，cordis 插件，导出 name/inject/apply）所需的
 *      五个注入服务：webServer、agentDefaultModel、credentials、llm、commands，
 *      外加 on/emit/effect/logger；
 *   3. 动态 import 原装 dsh-pet 并 apply(ctx, {})——**不改原作任何代码**，
 *      物理窗口、拖拽、多宠物、配置合并、碎碎念/对话调度、electron-helper 拉起
 *      （resolveElectronPath → spawn runtime/electron-helper/main.js）全部沿用原实现；
 *   4. stop() 逆序执行插件注册的 disposer（内含 stopHelper）再关 server。
 *
 * 注入的 llm 契约（plain 形态，宿主适配器只面对它）：
 *   llm.stream(req) → AsyncIterable<{ type: 'text', text: string }>
 *     req = { provider, model, system?, temperature?, signal?, messages: [{role, content}] }
 *   llm.listProviders?() → [{ id, name }]
 *   llm.listModels?(providerId) → [{ id, name }] | string[]
 *   llm.currentSelection?() → { provider, model } | null   （agentDefaultModel 的数据源）
 *
 * Electron 解析顺序在原作插件内（resolveElectronPath）：
 *   env DSH_PET_ELECTRON_PATH → require('electron') → $DSH_HOME/electron/<exe> → 下载兜底。
 * 本模块提供的 electronPath 会写入该 env（存在才写），是原作顺序的**第一优先级**。
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 把 dsh 插件消息（content 为块数组或字符串）拍平成 {role, content:string}。
 * dsh-pet 的 whisper/chat 只发文本块，工具调用块不存在于这两条链路。
 */
export function toPlainMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  return list.map((m) => {
    const c = m?.content
    let text = ''
    if (typeof c === 'string') text = c
    else if (Array.isArray(c)) {
      text = c
        .map((b) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
        .join('')
    }
    return { role: String(m?.role ?? 'user'), content: text }
  })
}

/** 构造伪 ctx（路由表 + 事件表 + 注入服务），供 startPetHost 使用 */
function buildContext(options) {
  const { logger, llm, modelSelection, resolveCredential, routes, failures } = options
  const disposers = []
  const events = new Map()

  const on = (name, listener) => {
    const list = events.get(name) ?? []
    list.push(listener)
    events.set(name, list)
    return () => {
      const cur = events.get(name) ?? []
      const idx = cur.indexOf(listener)
      if (idx >= 0) cur.splice(idx, 1)
    }
  }
  /** 宿主桥接器调用：把外部事件喂给插件注册的监听器（如 'session/event'） */
  const emit = (name, ...args) => {
    let last
    for (const fn of events.get(name) ?? []) {
      try {
        last = fn(...args)
      } catch (e) {
        logger.error?.(`[dsh-pet-kunyu] 监听器 ${name} 抛错（已吞掉，不影响宿主）：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return last
  }

  const ctx = {
    /** cordis 效应：立即执行，返回的函数记为 disposer，stop 时逆序执行 */
    effect(fn, _label) {
      try {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
        return dispose
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(message)
        logger.error?.(`[dsh-pet-kunyu] 初始化某项失败（已跳过）：${message}`)
        return undefined
      }
    },
    on,
    emit,
    logger,
    webServer: {
      get port() {
        return options.portRef.port
      },
      register(spec) {
        routes.push({ kind: spec.kind, path: spec.path, handler: spec.handler })
        return () => {
          const idx = routes.findIndex((r) => r.handler === spec.handler)
          if (idx >= 0) routes.splice(idx, 1)
        }
      }
    },
    /** 命令在 kunyu 宿主不接终端输入：注册静默成功，返回反注册 */
    commands: { register: () => () => {} },
    agentDefaultModel: {
      currentSelection: () => {
        try {
          const sel = modelSelection?.()
          return sel?.provider ? { provider: String(sel.provider), model: String(sel.model ?? '') } : { provider: '', model: '' }
        } catch {
          return { provider: '', model: '' }
        }
      }
    },
    credentials: {
      /**
       * 桌宠余额链路按固定 ref 取 apiKey（如 DEEPSEEK_API_KEY）。
       * 原作约定 resolve 返回凭证对象 { value: string }（index.js 取 rc?.value）；
       * 宿主解析器给的是裸字符串，这里包成契约形状；无凭证返回 undefined
       * （原作显示 credential-missing）。异常同样吞成 undefined，不拖垮插件。
       */
      resolve: async (ref) => {
        try {
          const value = await resolveCredential?.(ref)
          return value ? { value: String(value) } : undefined
        } catch (e) {
          logger.warn?.(
            `[dsh-pet-kunyu] credentials.resolve('${String(ref)}') 抛错（回 undefined）：${
              e instanceof Error ? e.message : String(e)
            }`
          )
          return undefined
        }
      }
    },
    llm: {
      listProviders: () => {
        try {
          return (llm.listProviders?.() ?? []).map((p) =>
            typeof p === 'string' ? { id: p, name: p } : { id: String(p?.id ?? ''), name: String(p?.name ?? p?.id ?? '') }
          )
        } catch {
          return []
        }
      },
      listModels: async (providerId) => {
        try {
          const list = (await llm.listModels?.(providerId)) ?? []
          return list.map((m) =>
            typeof m === 'string' ? { id: m, name: m } : { id: String(m?.id ?? ''), name: String(m?.name ?? m?.id ?? '') }
          )
        } catch {
          return []
        }
      },
      resolveModelInfo: async () => undefined,
      /**
       * 把 plain llm 流包装成 dsh llm 流：消息在这里拍平，chunk 校验
       * {type:'text', text:string} 后原样透传（BlockAssembler 只认文本块）。
       */
      stream: (options) =>
        llm.stream({
          provider: String(options?.provider ?? ''),
          model: String(options?.model ?? ''),
          system: typeof options?.system === 'string' ? options.system : undefined,
          temperature: typeof options?.temperature === 'number' ? options.temperature : undefined,
          signal: options?.signal,
          messages: toPlainMessages(options?.messages)
        })
    }
  }
  return { ctx, disposers, emit }
}

/**
 * 启动桌宠宿主：HTTP server + 伪 ctx + 加载原装 dsh-pet 插件。
 *
 * @param {object} options
 * @param {string} options.petPackagePath  dsh-pet 包根目录（其 lib/index.js 为插件入口，
 *   runtime/electron-helper 为 helper；包通常位于
 *   `$DSH_HOME/profiles/desktop/node_modules/dsh-pet`，或经 npm 安装到宿主自己的
 *   node_modules 后把包根传进来）
 * @param {object} options.llm             plain llm 适配器（契约见文件头）
 * @param {string} [options.electronPath]  Electron 可执行文件（写入 DSH_PET_ELECTRON_PATH，
 *   存在才写；不传则由原作插件按它的兜底顺序解析）
 * @param {() => {provider:string, model:string} | null} [options.modelSelection]
 *   当前默认模型选择（喂 agentDefaultModel.currentSelection；碎碎念/对话在宠物配置
 *   未指定 whisperModel/chatModel 时回落到它）
 * @param {(ref: unknown) => Promise<string | undefined>} [options.resolveCredential]
 *   余额链路凭证解析（如 ref=DEEPSEEK_API_KEY 返回 apiKey；无凭证返回 undefined）
 * @param {Console} [options.logger]
 * @param {string} [options.routePrefix]   前缀路由（默认 '/dsh-pet-7340'，与原作一致）
 * @returns {Promise<{port:number, emit(name,...args):unknown, stop():Promise<void>}>}
 */
export async function startPetHost(options) {
  const {
    petPackagePath,
    llm,
    electronPath,
    modelSelection,
    resolveCredential,
    logger = console,
    routePrefix = '/dsh-pet-7340'
  } = options ?? {}
  if (!petPackagePath) throw new Error('startPetHost: 缺少 petPackagePath（dsh-pet 包根目录）')
  if (!llm || typeof llm.stream !== 'function') throw new Error('startPetHost: 缺少 llm.stream 适配器')

  const entry = join(petPackagePath, 'lib', 'index.js')
  if (!existsSync(entry)) throw new Error(`startPetHost: dsh-pet 插件入口不存在：${entry}`)

  // env 作用域化：此前直接写 process.env 全局且从不恢复，会泄漏到主进程
  // 后续 spawn 的无关子进程）：插件存活期间写入，stop() 时恢复原值。
  // 原作 resolveElectronPath 的第一优先级就是读这个 env，必须在插件读之前就位。
  const hadElectronEnv = Object.prototype.hasOwnProperty.call(process.env, 'DSH_PET_ELECTRON_PATH')
  const prevElectronEnv = process.env.DSH_PET_ELECTRON_PATH
  if (electronPath && existsSync(electronPath)) {
    process.env.DSH_PET_ELECTRON_PATH = electronPath
  }

  const routes = []
  const failures = []
  const portRef = { port: 0 }
  const { ctx, disposers, emit } = buildContext({
    logger,
    llm,
    modelSelection,
    resolveCredential,
    routes,
    failures,
    portRef
  })

  const server = createServer((req, res) => {
    // 本机加固：server 只服务 dsh-pet helper 与宿主桥接，均为本机 Node 进程，
    // 不会带 Origin；携带 Origin 说明是浏览器页面发起（CSRF/DNS rebinding 载体），直接拒绝。
    // Host 白名单拦 DNS rebinding（helper 的 DSH_PET_CONFIG_URL 固定指向 127.0.0.1/localhost）。
    // 注：原作 helper 的 HTTP 客户端不受我们控制、无法带 token 头，故不做逐请求 token，
    // 以 Host/Origin 校验 + 仅绑定 127.0.0.1 作为本机服务边界。
    const hostHeader = String(req.headers.host ?? '')
    const selfPort = portRef.port
    const hostAllowed =
      hostHeader === `127.0.0.1:${selfPort}` || hostHeader === `localhost:${selfPort}` || hostHeader === `[::1]:${selfPort}`
    if (!hostAllowed || req.headers.origin) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh-pet-kunyu: forbidden')
      return
    }
    const url = req.url ?? '/'
    // 括号明确意图：prefix 路由匹配精确路径 / 子路径 / 查询串（此前 && 优先级使
    // `kind === 'prefix' && url === r.path` 独立成枝，非 prefix 路由的精确匹配被吞掉）
    const route = routes.find(
      (r) => r.kind === 'prefix' && (url === r.path || url.startsWith(r.path + '/') || url.startsWith(r.path + '?'))
    )
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh-pet-kunyu: no route')
      return
    }
    Promise.resolve(route.handler(req, res)).catch((e) => {
      logger.error?.(`[dsh-pet-kunyu] 路由处理异常：${e instanceof Error ? e.message : String(e)}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
      } else {
        res.destroy()
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      portRef.port = typeof addr === 'object' && addr ? addr.port : 0
      resolve()
    })
  })

  const mod = await import(pathToFileURL(entry).href)
  if (typeof mod.apply !== 'function') {
    server.close()
    throw new Error('startPetHost: dsh-pet 入口未导出 apply(ctx)，不是预期的 cordis 插件')
  }
  // cordis 契约：apply 的返回值（函数 / Promise<函数>）是卸载清理器，随 disposer 一并逆序执行
  const returned = await mod.apply(ctx, {})
  if (typeof returned === 'function') disposers.push(returned)
  else if (returned instanceof Promise) {
    const resolved = await returned
    if (typeof resolved === 'function') disposers.push(resolved)
  }

  return {
    /** 实际监听端口（helper 经 DSH_PET_CONFIG_URL 指向 http://127.0.0.1:<port>/dsh-pet-7340） */
    port: portRef.port,
    /** 宿主桥接器把外部事件喂给插件（如 emit('session/event', session, event)） */
    emit,
    /** 逆序执行插件注册的 disposer（含 stopHelper），然后关 HTTP server、恢复进程 env */
    async stop() {
      for (const dispose of [...disposers].reverse()) {
        try {
          await dispose()
        } catch (e) {
          logger.warn?.(`[dsh-pet-kunyu] disposer 执行失败（忽略）：${e instanceof Error ? e.message : String(e)}`)
        }
      }
      disposers.length = 0
      await new Promise((resolve) => server.close(() => resolve()))
      portRef.port = 0
      if (hadElectronEnv) process.env.DSH_PET_ELECTRON_PATH = prevElectronEnv
      else delete process.env.DSH_PET_ELECTRON_PATH
    }
  }
}
