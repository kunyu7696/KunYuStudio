/**
 * 简易 CDP（Chrome DevTools Protocol）客户端，通过 WebSocket 连接 Electron 页面。
 * 用法：node scripts/cdp-client.mjs <ws-url> <js-expression>
 */
// Node 22 全局 WebSocket，无需 import
const wsUrl = process.argv[2]
const expression = process.argv[3]

if (!wsUrl || !expression) {
  console.error('Usage: node cdp-client.mjs <ws-url> <js-expression>')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()

ws.addEventListener('open', () => {
  const send = (method, params = {}) => {
    id++
    const msg = { id, method, params }
    ws.send(JSON.stringify(msg))
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
  }
  ;(async () => {
    await send('Runtime.enable')
    const res = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    const payload = res.result || res
    if (payload.exceptionDetails) {
      console.error('EXCEPTION:', JSON.stringify(payload.exceptionDetails, null, 2))
    } else {
      console.log(JSON.stringify(payload.result?.value, null, 2))
    }
    ws.close()
  })()
})

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve } = pending.get(msg.id)
    pending.delete(msg.id)
    resolve(msg)
  }
})

ws.addEventListener('error', (err) => {
  console.error('WS ERROR:', err.message)
  process.exit(1)
})
