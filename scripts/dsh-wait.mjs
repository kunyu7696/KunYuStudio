/**
 * 等待 DeepSeek Harness 当前 agent 运行完成，抽取最终 markdown 报告。
 * 用法：node scripts/dsh-wait.mjs <ws-url>
 */
const wsUrl = process.argv[2]
if (!wsUrl) { console.error('Usage: node dsh-wait.mjs <ws-url>'); process.exit(1) }

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()

const send = (method, params = {}) => {
  id++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
const evalJs = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  const payload = res.result || res
  if (payload.exceptionDetails) throw new Error(JSON.stringify(payload.exceptionDetails))
  return payload.result?.value
}

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    const maxWait = 5400_000 // 90 分钟
    const start = Date.now()
    let lastLen = 0, stable = 0
    console.error('waiting for agent to finish (stop button to disappear)...')
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 15_000))
      const state = await evalJs(`(() => {
        const stopBtn = Array.from(document.querySelectorAll('button')).find(b => {
          const t = (b.title || b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
          return t.includes('stop') || t.includes('停止');
        });
        // 取最后一个 markdown 渲染块（最终回复）
        const mds = Array.from(document.querySelectorAll('div._markdown_1ypvv_5'));
        const last = mds[mds.length - 1];
        return { stopping: !!stopBtn, mdCount: mds.length, lastLen: last ? last.textContent.length : 0 };
      })()`)
      console.error(`[${Math.round((Date.now()-start)/1000)}s] stopping=${state.stopping} mdCount=${state.mdCount} lastLen=${state.lastLen}`)
      if (!state.stopping && state.lastLen > 0) {
        if (state.lastLen === lastLen) {
          stable++
          if (stable >= 3) { console.error('agent finished & response stable'); break }
        } else { stable = 0; lastLen = state.lastLen }
      } else {
        stable = 0
      }
    }
    // 抽取最后一个 markdown 块的完整文本
    const full = await evalJs(`(() => {
      const mds = Array.from(document.querySelectorAll('div._markdown_1ypvv_5'));
      const last = mds[mds.length - 1];
      return last ? last.textContent : '';
    })()`)
    console.log(full || '(no markdown content found)')
    ws.close()
  } catch (e) {
    console.error('ERROR:', e.message)
    ws.close(); process.exit(1)
  }
})
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m) }
})
ws.addEventListener('error', e => { console.error('WS ERROR:', e.message); process.exit(1) })
