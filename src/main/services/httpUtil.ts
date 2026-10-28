/**
 * 共享 HTTP 工具（M7 Task 4 从 aiService 抽出）。
 * 代理策略与超时统一来自设置：custom→ProxyAgent；system→Electron 解析系统代理；none→直连。
 * AI 对话（POST JSON）与上游监测（GET 文本/XML）共用同一套 dispatcher/超时语义。
 * M9 扩展：httpGetJson（GET + JSON 解析）、httpDownload（流式下载到文件，用于 jar）。
 */
import { request, ProxyAgent, FormData, getGlobalDispatcher, interceptors, type Dispatcher } from 'undici'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PassThrough } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getSection } from './settingsService'

export class HttpUtilError extends Error {
  readonly code: 'timeout' | 'network' | 'http'
  readonly status?: number
  constructor(code: 'timeout' | 'network' | 'http', message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

/** 从 Electron 会话解析目标 URL 的系统代理（PAC 结果），无 http 代理时返回 null */
async function resolveSystemProxy(targetUrl: string): Promise<string | null> {
  try {
    const { session } = await import('electron')
    const info = await session.defaultSession.resolveProxy(targetUrl)
    // 形如 "PROXY host:port" / "PROXY a;b;DIRECT" / "DIRECT"；SOCKS undici 不支持，视为直连
    const entry = info
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.toUpperCase().startsWith('PROXY '))
    const authority = entry ? entry.slice(6).trim() : ''
    return authority || null
  } catch {
    return null
  }
}

/** 依据网络设置构造 dispatcher：custom → ProxyAgent；system → 探测系统代理；none → 直连 */
export async function resolveDispatcher(targetUrl: string): Promise<Dispatcher | undefined> {
  const net = getSection('network')
  if (net.proxyMode === 'custom' && net.proxyHost) {
    const port = net.proxyPort > 0 ? net.proxyPort : 8080
    return new ProxyAgent(`http://${net.proxyHost}:${port}`)
  }
  if (net.proxyMode === 'system') {
    const authority = await resolveSystemProxy(targetUrl)
    if (authority) return new ProxyAgent(`http://${authority}`)
  }
  return undefined
}

/**
 * GET 抓取用 dispatcher：在按设置解析的基础上叠加重定向跟随（最多 5 跳）。
 * undici 的 request() 默认不跟随 3xx，BMCLAPI 等源会偶发 302，必须显式拦截。
 */
async function resolveGetDispatcher(url: string): Promise<Dispatcher> {
  const base = await resolveDispatcher(url)
  return (base ?? getGlobalDispatcher()).compose(
    interceptors.redirect({ maxRedirections: 5, throwOnMaxRedirect: true })
  )
}

/** 设置中的超时（毫秒，下限 5s） */
export function networkTimeoutMs(): number {
  return Math.max(5, getSection('network').timeoutSec) * 1000
}

export interface HttpResponse {
  status: number
  text: string
  /** maxBytes 截断标记：响应体超过抓取上限被截断时为 true */
  truncated?: boolean
}

/** GET 文本（监测源 JSON/XML、web_fetch 网页抓取用）；超时/网络错误抛 HttpUtilError，4xx/5xx 返回由调用方判定；3xx 自动跟随 */
export async function httpGetText(
  url: string,
  opts?: {
    timeoutMs?: number
    dispatcher?: Dispatcher
    signal?: AbortSignal
    /** 覆盖默认请求头（默认仅 User-Agent） */
    headers?: Record<string, string>
    /** 响应体抓取上限（字节）；超限即截断并置 truncated=true，防超大页面撑爆内存 */
    maxBytes?: number
  }
): Promise<HttpResponse> {
  try {
    const res = await request(url, {
      method: 'GET',
      dispatcher: opts?.dispatcher ?? (await resolveGetDispatcher(url)),
      signal: opts?.signal ?? AbortSignal.timeout(opts?.timeoutMs ?? networkTimeoutMs()),
      headers: { 'User-Agent': 'KunYu-Studio/0.1 (version-monitor)', ...(opts?.headers ?? {}) }
    })
    const maxBytes = opts?.maxBytes
    if (maxBytes === undefined || maxBytes <= 0) {
      const text = await res.body.text()
      return { status: res.statusCode, text }
    }
    // 限量流式读取：累计超限即停止消费（for-await break 自动销毁底层流）
    const chunks: Buffer[] = []
    let received = 0
    let truncated = false
    for await (const chunk of res.body as AsyncIterable<Buffer>) {
      received += chunk.length
      if (received > maxBytes) {
        chunks.push(chunk.subarray(0, chunk.length - (received - maxBytes)))
        truncated = true
        break
      }
      chunks.push(chunk)
    }
    return { status: res.statusCode, text: Buffer.concat(chunks).toString('utf-8'), truncated }
  } catch (err) {
    const e = err as Error & { code?: string; cause?: { code?: string } }
    const code = e.code ?? e.cause?.code ?? ''
    if (e.name === 'TimeoutError' || code === 'ABORT_ERR' || e.name === 'AbortError') {
      throw new HttpUtilError('timeout', `请求超时：${url}`)
    }
    throw new HttpUtilError('network', `无法连接 ${url}：${e.message}`)
  }
}

/** GET 并解析 JSON；4xx/5xx 抛 HttpUtilError('http')，非 JSON 抛 HttpUtilError('network') */
export async function httpGetJson<T>(
  url: string,
  opts?: {
    timeoutMs?: number
    dispatcher?: Dispatcher
    signal?: AbortSignal
    headers?: Record<string, string>
  }
): Promise<{ status: number; data: T }> {
  const res = await request(url, {
    method: 'GET',
    dispatcher: opts?.dispatcher ?? (await resolveGetDispatcher(url)),
    signal: opts?.signal ?? AbortSignal.timeout(opts?.timeoutMs ?? networkTimeoutMs()),
    headers: { Accept: 'application/json', ...(opts?.headers ?? {}) }
  })
  const text = await res.body.text()
  if (res.statusCode >= 400) {
    throw new HttpUtilError('http', `HTTP ${res.statusCode}：${url}`, res.statusCode)
  }
  try {
    return { status: res.statusCode, data: JSON.parse(text) as T }
  } catch {
    throw new HttpUtilError('network', `响应非 JSON：${url}`)
  }
}

/**
 * 抓取 `<url>.sha256` 校验 sidecar（Maven Central / gyan.dev 等常见约定）。
 * 返回 64 位十六进制小写哈希；sidecar 不可达或内容不含合法哈希时返回 null，
 * 由调用方决定是「拒绝下载」（fail-closed）还是「显式标记未校验」。
 */
export async function fetchSha256Sidecar(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const res = await httpGetText(`${url}.sha256`, { timeoutMs, maxBytes: 4096 })
    if (res.status !== 200) return null
    const m = res.text.match(/\b([0-9a-fA-F]{64})\b/)
    return m ? m[1]!.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * POST multipart/form-data（发布上传用）。
 * 用 undici 全局 FormData/Blob 组装；**禁止手设 Content-Type**（boundary 由 undici 生成）。
 * 字段值支持 string / { data: Uint8Array|Buffer, filename, contentType } 文件形态。
 * 4xx/5xx 抛 HttpUtilError('http') 并透传响应截断文本；超时/断网语义同 httpGetJson。
 */
export interface MultipartFileField {
  data: Uint8Array | Buffer
  filename: string
  contentType: string
}

export async function httpPostMultipart<T>(
  url: string,
  opts: {
    fields: Record<string, string | MultipartFileField>
    headers?: Record<string, string>
    timeoutMs?: number
    dispatcher?: Dispatcher
    signal?: AbortSignal
  }
): Promise<{ status: number; data: T }> {
  const form = new FormData()
  for (const [key, value] of Object.entries(opts.fields)) {
    if (typeof value === 'string') {
      form.append(key, value)
    } else {
      const bytes = value.data instanceof Buffer ? new Uint8Array(value.data) : value.data
      form.append(key, new Blob([bytes.buffer as ArrayBuffer], { type: value.contentType }), value.filename)
    }
  }
  try {
    const res = await request(url, {
      method: 'POST',
      dispatcher: opts.dispatcher ?? (await resolveDispatcher(url)),
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? Math.max(300, networkTimeoutMs() / 1000) * 1000),
      headers: opts.headers ?? {},
      body: form
    })
    const text = await res.body.text()
    if (res.statusCode >= 400) {
      const brief = text.length > 300 ? `${text.slice(0, 300)}…` : text
      throw new HttpUtilError('http', `HTTP ${res.statusCode}：${brief}`, res.statusCode)
    }
    try {
      return { status: res.statusCode, data: JSON.parse(text) as T }
    } catch {
      // 部分平台成功响应非 JSON（如 CF 偶发空体），以空对象兜底
      return { status: res.statusCode, data: {} as T }
    }
  } catch (err) {
    if (err instanceof HttpUtilError) throw err
    const e = err as Error & { code?: string; cause?: { code?: string } }
    const code = e.code ?? e.cause?.code ?? ''
    if (e.name === 'TimeoutError' || code === 'ABORT_ERR' || e.name === 'AbortError') {
      throw new HttpUtilError('timeout', `上传超时：${url}`)
    }
    throw new HttpUtilError('network', `无法连接 ${url}：${e.message}`)
  }
}

/**
 * 流式下载 URL 到 destPath（自动创建父目录）。
 * 返回写入字节数；非 2xx 抛 HttpUtilError('http')。
 *
 * P1-10 下载完整性：
 * - maxRedirections: 5 —— CF 兜底下载端点是 302，必须跟随；上限防重定向循环。
 * - 429 退避：命中时限流按 Retry-After（缺省 2s/5s）重试。
 * - expected：下完后按文件内容算 sha1/sha256/sha512 与平台权威哈希比对；均无则比 size。
 *   校验失败删除半成品文件并抛 HttpUtilError('http')。
 *
 * 弱网韧性（本次新增）：
 * - 网络抖动/超时/连接被重置时自动重试，并用 HTTP Range 从已落盘字节处断点续传，
 *   不再每次从头开始（此前下载中断只能整包重来，弱网下表现为“反复刷新、始终下不完”）。
 * - 单次尝试使用独立的超时计时（大文件慢速下载不会被总时长掐断）；
 * - 用户主动取消（signal.aborted）不重试，直接失败。
 */
export interface DownloadExpected {
  sha1?: string
  /** 零配置运行环境：JDK 归档的 Adoptium 权威校验和 */
  sha256?: string
  sha512?: string
  size?: number
}

/** 下载类请求的单次超时下限（大文件弱网场景，与普通 API 超时区分） */
const DOWNLOAD_TIMEOUT_FLOOR_MS = 300_000
/** 下载重试上限（首次 + 3 次续传） */
const DOWNLOAD_MAX_ATTEMPTS = 4

/** 半成品文件当前大小（不存在返回 0），用于续传起点 */
async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/** 判断是否为可重试的瞬时网络错误（用户取消/HTTP 语义错误不在此列） */
function isTransientDownloadError(err: unknown): boolean {
  const e = err as Error & { code?: string; cause?: { code?: string } }
  const code = e.code ?? e.cause?.code ?? ''
  if (
    e.name === 'TimeoutError' ||
    e.name === 'AbortError' ||
    code === 'ABORT_ERR' ||
    code === 'ETIMEDOUT'
  ) {
    return true
  }
  return new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'UND_ERR_SOCKET',
    'UND_ERR_CLOSED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT'
  ]).has(code)
}

function toDownloadError(err: unknown, url: string): HttpUtilError {
  if (err instanceof HttpUtilError) return err
  const e = err as Error & { code?: string; cause?: { code?: string } }
  const code = e.code ?? e.cause?.code ?? ''
  if (e.name === 'TimeoutError' || code === 'ABORT_ERR' || e.name === 'AbortError' || code === 'ETIMEDOUT') {
    return new HttpUtilError('timeout', `下载超时：${url}`)
  }
  return new HttpUtilError('network', `下载中断：${e.message || code}（${url}）`)
}

/** 丢弃响应体：先挂空错误监听，避免 destroy 触发的 AbortError 变成未捕获异常 */
function discardBody(body: { on(event: 'error', listener: () => void): unknown; destroy(): void }): void {
  body.on('error', () => undefined)
  body.destroy()
}

/** 重试退避：0.8s / 2s / 4s，避免连续冲击同一站点 */
function retryDelayMs(attempt: number): number {
  return Math.min(4000, 800 * Math.pow(2, attempt - 1))
}

/** 按文件内容计算权威哈希（续传场景下不能只哈希本次新写入的分片） */
async function hashFile(
  path: string,
  expected: DownloadExpected
): Promise<{ alg: 'sha512' | 'sha256' | 'sha1' | 'size'; actual: string } | null> {
  if (!expected.sha512 && !expected.sha256 && !expected.sha1) return null
  const alg = expected.sha512 ? 'sha512' : expected.sha256 ? 'sha256' : 'sha1'
  const hash = createHash(alg)
  await pipeline(createReadStream(path), hash)
  return { alg, actual: hash.digest('hex') }
}

export async function httpDownload(
  url: string,
  destPath: string,
  opts?: {
    timeoutMs?: number
    dispatcher?: Dispatcher
    signal?: AbortSignal
    headers?: Record<string, string>
    expected?: DownloadExpected
    /** 流式进度回调（逐块触发，调用方自行节流）；totalBytes 未知时为 0 */
    onProgress?: (loadedBytes: number, totalBytes: number) => void
  }
): Promise<number> {
  await mkdir(dirname(destPath), { recursive: true })
  // 跟随重定向（CF 兜底下载端点是 302），上限 5 次防循环；超限抛错由调用方兜底
  const base = opts?.dispatcher ?? (await resolveDispatcher(url)) ?? getGlobalDispatcher()
  const redirecting = base.compose(interceptors.redirect({ maxRedirections: 5, throwOnMaxRedirect: true }))
  const timeoutMs = opts?.timeoutMs ?? Math.max(DOWNLOAD_TIMEOUT_FLOOR_MS, networkTimeoutMs())
  // 断点续传起点：调用方未显式取消时，复用上次已落盘的半成品
  let resumeFrom = 0
  for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    if (opts?.signal?.aborted) {
      throw new HttpUtilError('network', `下载已取消：${url}`)
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = opts?.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
    const headers = { ...(opts?.headers ?? {}) }
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`
    let res: Awaited<ReturnType<typeof request>>
    try {
      res = await request(url, { method: 'GET', dispatcher: redirecting, signal, headers })
    } catch (err) {
      if (attempt < DOWNLOAD_MAX_ATTEMPTS && isTransientDownloadError(err) && !opts?.signal?.aborted) {
        resumeFrom = await fileSize(destPath)
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt)))
        continue
      }
      throw toDownloadError(err, url)
    }
    if (res.statusCode === 429 && attempt < DOWNLOAD_MAX_ATTEMPTS) {
      discardBody(res.body)
      const retryAfter = Number(res.headers['retry-after'])
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, 30) * 1000
        : attempt === 1 ? 2000 : 5000
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    // 416：续传起点已超出远端文件长度（文件被替换）→ 丢弃半成品从头下载
    if (res.statusCode === 416 && resumeFrom > 0) {
      discardBody(res.body)
      await unlink(destPath).catch(() => undefined)
      resumeFrom = 0
      continue
    }
    if (res.statusCode >= 400) {
      discardBody(res.body)
      throw new HttpUtilError('http', `下载失败 HTTP ${res.statusCode}：${url}`, res.statusCode)
    }
    // 服务端不支持 Range（回 200）→ 覆盖重写，避免新旧字节拼接
    const append = resumeFrom > 0 && res.statusCode === 206
    const ws = createWriteStream(destPath, { flags: append ? 'a' : 'w' })
    const totalBytes = Number(res.headers['content-length']) || 0
    let received = append ? resumeFrom : 0
    const counter = new PassThrough()
    counter.on('data', (chunk: Buffer) => {
      received += chunk.length
      opts?.onProgress?.(received, totalBytes > 0 ? totalBytes + (append ? resumeFrom : 0) : 0)
    })
    try {
      await pipeline(res.body, counter, ws)
    } catch (err) {
      ws.destroy()
      if (attempt < DOWNLOAD_MAX_ATTEMPTS && isTransientDownloadError(err) && !opts?.signal?.aborted) {
        resumeFrom = await fileSize(destPath)
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt)))
        continue
      }
      throw toDownloadError(err, url)
    }
    const bytes = await fileSize(destPath)
    // 完整性校验：平台哈希（sha512 优先于 sha1）权威，均无则 size 兜底
    const expected = opts?.expected
    if (expected) {
      let mismatch: string | null = null
      const hashed = await hashFile(destPath, expected)
      if (hashed) {
        const want = (expected[hashed.alg] as string).toLowerCase()
        if (hashed.actual !== want) {
          mismatch = `${hashed.alg} 不符（期望 ${want.slice(0, 16)}…，实际 ${hashed.actual.slice(0, 16)}…）`
        }
      } else if (expected.size && expected.size > 0 && bytes !== expected.size) {
        mismatch = `大小不符（期望 ${expected.size} 字节，实际 ${bytes} 字节）`
      }
      if (mismatch) {
        await unlink(destPath).catch(() => undefined)
        throw new HttpUtilError('http', `下载完整性校验失败（${mismatch}）：${url}`)
      }
    }
    return bytes
  }
  throw new HttpUtilError('http', `下载失败（已重试 ${DOWNLOAD_MAX_ATTEMPTS} 次）：${url}`)
}
