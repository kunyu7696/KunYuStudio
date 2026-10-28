/**
 * 编译探针批量驱动（M23 真实回测）：
 * 通过 CDP 连接 dev 应用的渲染进程，顺序调用 window.api.monitor.runProbe(comboId)，
 * 每 20s 轮询 window.__probeState 并落盘 scripts/.probe-results.json。
 *
 * 前置：npm run dev 已启动（主进程自动开 9222 CDP 端口）。
 * 用法：node scripts/probe-verify.mjs [comboId ...]   （无参 = manifest 登记的全部组合）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CDP_PORT = process.env.KY_CDP_PORT || 9222
const RESULTS_FILE = resolve(process.cwd(), 'scripts', '.probe-results.json')
const POLL_MS = 20_000

/** 默认组合从仓库 manifest 指纹派生（此前硬编码 17 组合已随矩阵扩容过时） */
function defaultCombos() {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'resources', 'ai-reference', 'manifest.json'), 'utf8')
    )
    const combos = (manifest.versionFingerprints ?? []).map((f) => `${f.loader}-${f.mcVersion}`)
    if (combos.length > 0) return combos
  } catch {
    /* manifest 不可用时回退内置清单 */
  }
  return [
    'fabric-1.21.1', 'fabric-1.20.4', 'fabric-1.20.6', 'fabric-1.19.2', 'fabric-1.18.2', 'fabric-1.20.1',
    'neoforge-1.21.1', 'neoforge-1.21.3', 'neoforge-1.20.6', 'neoforge-1.20.4',
    'forge-1.20.1', 'forge-1.21.1', 'forge-1.20.4', 'forge-1.19.2', 'forge-1.18.2',
    'fabric-1.16.5', 'forge-1.16.5'
  ]
}
const combos = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultCombos()

let msgId = 0
const pending = new Map()
let ws

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error(`页面内异常：${JSON.stringify(r.exceptionDetails).slice(0, 400)}`)
  return r.result?.value
}

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page' && /^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(t.url))
      if (page) return page
    } catch { /* CDP 尚未就绪 */ }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('找不到应用页面（CDP /json/list 无 http 页面）')
}

async function main() {
  const page = await findPage()
  console.log(`[probe] 页面：${page.url}`)
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? rej(new Error(m.error.message)) : res(m.result)
    }
  }
  await send('Runtime.enable')
  await send('Page.enable')

  // 干净页面（规避 Vite HMR 幽灵绑定），等 preload 与 Vue 挂载
  await send('Page.reload', { ignoreCache: true })
  await new Promise((r) => setTimeout(r, 6000))
  const ready = await evaluate(`typeof window.api === 'object' && typeof window.api.monitor?.runProbe === 'function'`)
  if (!ready) throw new Error('window.api.monitor.runProbe 不可用（preload 未注入？）')
  console.log('[probe] preload OK，注入顺序执行器…')

  await evaluate(`(() => {
    window.__probeState = { queue: ${JSON.stringify(combos)}, idx: -1, current: null, results: [], done: false }
    ;(async () => {
      for (let i = 0; i < window.__probeState.queue.length; i++) {
        const c = window.__probeState.queue[i]
        window.__probeState.idx = i
        window.__probeState.current = c
        const rec = { combo: c, startedAt: new Date().toISOString() }
        try {
          const st = await window.api.monitor.runProbe(c)
          rec.phase = st.phase
          rec.message = st.message
          rec.matched = st.matchedPatternIds ?? null
        } catch (e) {
          rec.phase = 'ipc-error'
          rec.message = String(e && e.message ? e.message : e)
        }
        rec.finishedAt = new Date().toISOString()
        window.__probeState.results.push(rec)
      }
      window.__probeState.done = true
    })()
  })()`)

  console.log(`[probe] 队列 ${combos.length} 个组合已开始，每 ${POLL_MS / 1000}s 轮询…`)
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const state = await evaluate('JSON.stringify(window.__probeState)').then((s) => JSON.parse(s ?? 'null'))
    if (!state) { console.log('[probe] 状态丢失（页面被刷新？），退出'); process.exit(2) }
    writeFileSync(RESULTS_FILE, JSON.stringify(state, null, 2))
    const done = state.results.length
    const last = state.results[state.results.length - 1]
    console.log(`[probe] ${done}/${state.queue.length} 当前=${state.current ?? '-'}${last ? ` 上一结果=${last.combo}:${last.phase}` : ''}`)
    if (state.done) break
  }
  const final = await evaluate('JSON.stringify(window.__probeState.results)').then((s) => JSON.parse(s))
  writeFileSync(RESULTS_FILE, JSON.stringify({ queue: combos, done: true, results: final }, null, 2))
  const pass = final.filter((r) => r.phase === 'pass').length
  console.log(`[probe] 全部结束：pass=${pass} fail=${final.filter((r) => r.phase === 'fail').length} skipped/error=${final.length - pass - final.filter((r) => r.phase === 'fail').length}`)
  console.log(`[probe] 明细见 ${RESULTS_FILE}`)
  ws.close()
  process.exit(0)
}

main().catch((e) => { console.error(`[probe] 驱动失败：${e.message}`); process.exit(1) })
