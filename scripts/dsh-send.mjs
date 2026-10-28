/**
 * DeepSeek Harness 交互脚本：在"评审"会话中输入提示词并发送，
 * 轮询等待 AI 回复完成后，抽取回复文本输出到 stdout。
 *
 * 用法：node scripts/dsh-send.mjs <ws-url> <prompt-file>
 */
import { readFileSync } from 'node:fs'

const wsUrl = process.argv[2]
const promptFile = process.argv[3]
if (!wsUrl || !promptFile) {
  console.error('Usage: node dsh-send.mjs <ws-url> <prompt-file>')
  process.exit(1)
}
const prompt = readFileSync(promptFile, 'utf8')

const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()

const send = (method, params = {}) => {
  id++
  const msg = { id, method, params }
  ws.send(JSON.stringify(msg))
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
}

const evalJs = async (expression) => {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  const payload = res.result || res
  if (payload.exceptionDetails) {
    throw new Error(JSON.stringify(payload.exceptionDetails))
  }
  return payload.result?.value
}

// 点击元素坐标
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

ws.addEventListener('open', async () => {
  try {
    await send('Runtime.enable')
    await send('Page.enable')

    // 1. 聚焦输入框并清空
    await evalJs(`(() => {
      const el = document.querySelector('div.RlGAzG_input');
      if (!el) return 'no input';
      el.focus();
      el.innerHTML = '';
      return 'focused';
    })()`)
    console.error('input focused')

    // 2. 用 CDP Input.insertText 输入中文（绕过 React 受控组件的问题）
    await send('Input.insertText', { text: prompt })
    console.error('text inserted, length:', prompt.length)

    // 稍等让 React 处理
    await new Promise(r => setTimeout(r, 300))

    // 3. 查找并点击发送按钮
    const sendBtnInfo = await evalJs(`(() => {
      const candidates = Array.from(document.querySelectorAll('button'));
      // 找发送按钮：通常是带发送图标或 title 的按钮
      const btn = candidates.find(b => {
        const t = (b.title || b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
        return t.includes('send') || t.includes('发送') || t.includes('submit');
      }) || candidates[candidates.length - 1];
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, label: btn.title || btn.textContent?.slice(0,30) };
    })()`)
    console.error('send button:', JSON.stringify(sendBtnInfo))

    if (sendBtnInfo) {
      await clickAt(sendBtnInfo.x, sendBtnInfo.y)
      console.error('clicked send')
    } else {
      // 兜底：按 Enter
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      console.error('pressed Enter')
    }

    // 4. 轮询等待回复完成：检测"停止生成"按钮消失 或 出现新的助手消息
    console.error('waiting for response...')
    let lastText = ''
    let stableCount = 0
    const maxWait = 600_000 // 10 分钟
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 5000))
      const state = await evalJs(`(() => {
        const stopBtn = Array.from(document.querySelectorAll('button')).find(b => {
          const t = (b.title || b.getAttribute('aria-label') || b.textContent || '').toLowerCase();
          return t.includes('stop') || t.includes('停止');
        });
        // 取最后一个助手消息块
        const msgs = Array.from(document.querySelectorAll('[class*="message"], [class*="assistant"], [class*="content"]'));
        const lastMsg = msgs[msgs.length - 1];
        return { stopping: !!stopBtn, lastText: lastMsg ? lastMsg.textContent.slice(-500) : '' };
      })()`)
      console.error(`poll: stopping=${state.stopping}, tailLen=${state.lastText.length}`)
      if (!state.stopping && state.lastText.length > 0) {
        if (state.lastText === lastText) {
          stableCount++
          if (stableCount >= 3) {
            console.error('response stable, extracting...')
            break
          }
        } else {
          stableCount = 0
          lastText = state.lastText
        }
      }
    }

    // 5. 抽取完整回复文本
    const full = await evalJs(`(() => {
      // 尝试多种选择器获取助手消息
      const selectors = [
        '[class*="assistant"] [class*="content"]',
        '[class*="message"] [class*="content"]',
        '[class*="_text_"]',
        'div[class*="markdown"]',
        'div[class*="content"]'
      ];
      let best = '';
      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          const t = el.textContent.trim();
          if (t.length > best.length) best = t;
        }
      }
      return best;
    })()`)
    console.log(full)
    ws.close()
  } catch (err) {
    console.error('ERROR:', err.message)
    ws.close()
    process.exit(1)
  }
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
