/**
 * 流式响应分帧器（t71s）：
 * - SSE 模式（OpenAI 兼容 /chat/completions stream:true）：按行切分，剥除 `data:` 前缀，
 *   调用方收到的每一项是一帧 payload（含 `[DONE]`）；忽略注释/空行/事件字段行。
 * - NDJSON 模式（Ollama /api/chat stream:true）：每行一个 JSON 对象。
 * TCP 分包可能切断任意一行，残留缓存在实例内，跨 push 拼接；结束时调用 flush()。
 */
export class StreamLineFramer {
  private buffer = ''
  constructor(private readonly sse: boolean) {}

  push(chunk: string): string[] {
    this.buffer += chunk
    const out: string[] = []
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, nl).replace(/\r$/, '')
      this.buffer = this.buffer.slice(nl + 1)
      if (this.sse) {
        if (!line.startsWith('data:')) continue
        line = line.slice(5).trim()
        if (!line) continue
      } else if (!line.trim()) {
        continue
      }
      out.push(line)
    }
    return out
  }

  /** 流结束后取出残余半行（正常协议末帧都带换行，通常为空） */
  flush(): string[] {
    const rest = this.buffer.trim()
    this.buffer = ''
    if (!rest) return []
    if (this.sse) {
      if (!rest.startsWith('data:')) return []
      const payload = rest.slice(5).trim()
      return payload ? [payload] : []
    }
    return [rest]
  }
}
