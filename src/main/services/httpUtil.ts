/**
 * 共享 HTTP 工具（M7 Task 4 从 aiService 抽出）。
 * 代理策略与超时统一来自设置：custom→ProxyAgent；system→Electron 解析系统代理；none→直连。
 * AI 对话（POST JSON）与上游监测（GET 文本/XML）共用同一套 dispatcher/超时语义。
 * M9 扩展：httpGetJson（GET + JSON 解析）、httpDownload（流式下载到文件，用于 jar）。
 */
import { request, ProxyAgent, FormData, getGlobalDispatcher, interceptors, type Dispatcher } from 'undici'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, stat, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PassThrough, type Readable, type Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import { getSection } from './settingsService'

/** 声明支持的压缩算法：undici.request 默认不发 Accept-Encoding，大响应（如市场搜索 300KB）走明文会被镜像/CDN 严重拖慢 */
const ACCEPT_ENCODING = 'gzip, deflate, br'

/** 按响应 content-encoding 选择解压流；identity/未知编码返回 null（按原文读取） */
function bodyDecompressor(contentEncoding: unknown): Transform | null {
  const enc = String(contentEncoding ?? '').toLowerCase()
  if (!enc || enc === 'identity') return null
  if (enc.includes('br')) return createBrotliDecompress()
  if (enc.includes('gzip')) return createGunzip()
  if (enc.includes('deflate')) return createInflate()
  return null
}

/** 读取响应体（自动解压）；maxBytes > 0 时超限截断并置 truncated */
async function readBody(
  res: Awaited<ReturnType<typeof request>>,
  maxBytes?: number
): Promise<{ text: string; truncated?: boolean }> {
  const dec = bodyDecompressor(res.headers['content-encoding'])
  const body = (dec ? res.body.pipe(dec) : res.body) as Readable
  const limit = maxBytes !== undefined && maxBytes > 0 ? maxBytes : 0
  const chunks: Buffer[] = []
  let received = 0
  let truncated = false
  for await (const chunk of body as AsyncIterable<Buffer>) {
    if (limit > 0 && received + chunk.length > limit) {
      chunks.push(chunk.subarray(0, limit - received))
      truncated = true
      break
    }
    chunks.push(chunk)
    received += chunk.length
  }
  return { text: Buffer.concat(chunks).toString('utf-8'), truncated }
}

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
      headers: {
        'User-Agent': 'KunYu-Studio/0.1 (version-monitor)',
        'Accept-Encoding': ACCEPT_ENCODING,
        ...(opts?.headers ?? {})
      }
    })
    const { text, truncated } = await readBody(res, opts?.maxBytes)
    return truncated ? { status: res.statusCode, text, truncated } : { status: res.statusCode, text }
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
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': ACCEPT_ENCODING,
      ...(opts?.headers ?? {})
    }
  })
  let text: string
  try {
    text = (await readBody(res)).text
  } catch (err) {
    throw new HttpUtilError('network', `响应读取失败：${(err as Error).message}（${url}）`)
  }
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
 * 下载语义约定（httpDownload / downloadSingleStream / downloadSegmented 共用）：
 * - maxRedirections: 5 —— CF 兜底下载端点是 302，必须跟随；上限防重定向循环。
 * - 429 退避：命中时限流按 Retry-After（缺省 2s/5s）重试。
 * - expected：下完后按文件内容算 sha1/sha256/sha512 与平台权威哈希比对；均无则比 size。
 *   校验失败删除半成品文件并抛 HttpUtilError('http')。
 *
 * 弱网韧性：
 * - 网络抖动/超时/连接被重置时自动重试，并用 HTTP Range 从已落盘字节处断点续传，
 *   不再每次从头开始（此前下载中断只能整包重来，弱网下表现为“反复刷新、始终下不完”）。
 * - 单次尝试使用独立的超时计时（大文件慢速下载不会被总时长掐断）；
 * - 用户主动取消（signal.aborted）不重试，直接失败。
 *
 * 多线程分段：
 * - 大文件且服务端支持 Range 时自动并行分段（见 tryMultithreadDownload 的条件），
 *   各段独立重试与段内续传，按偏移直接写目标文件；不满足条件自动回退单流。
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

/** httpDownload 的可选项（单流与多线程分段共用） */
export interface HttpDownloadOptions {
  timeoutMs?: number
  dispatcher?: Dispatcher
  signal?: AbortSignal
  headers?: Record<string, string>
  expected?: DownloadExpected
  /** 流式进度回调（逐块触发，调用方自行节流）；totalBytes 未知时为 0 */
  onProgress?: (loadedBytes: number, totalBytes: number) => void
  /**
   * 多线程分段下载：true 强制做 Range 探测；false 禁用；
   * 缺省仅在 expected.size 达到阈值时探测（大文件零成本启用，小文件不多发请求）
   */
  multithread?: boolean
  /** 分段并发数（2–8，缺省 4） */
  connections?: number
  /** 触发多线程的体积阈值（字节，缺省 16MB；测试可调小） */
  multithreadMinBytes?: number
}

/** 多线程分段下载默认触发阈值（16MB） */
const MULTITHREAD_MIN_BYTES = 16 * 1024 * 1024
/** 单分段最小体积（8MB）：低于该值不再细分，避免碎片请求 */
const MULTITHREAD_MIN_SEGMENT_BYTES = 8 * 1024 * 1024
const MULTITHREAD_DEFAULT_CONNECTIONS = 4
const MULTITHREAD_MAX_CONNECTIONS = 8
/** HEAD 探测超时上限（不影响正文下载的单次超时） */
const PROBE_TIMEOUT_CAP_MS = 20_000

/** 服务端声称支持 Range 但正文请求回 200（忽略 Range）时抛出，触发整体回退单流 */
class RangeNotHonoredError extends Error {}

/** 按 expected 校验已落盘文件（哈希优先，size 兜底）；不符删除文件并抛错 */
async function assertDownloadIntegrity(
  destPath: string,
  expected: DownloadExpected | undefined,
  url: string
): Promise<void> {
  if (!expected) return
  const bytes = await fileSize(destPath)
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

/** HEAD 探测远端体积与 Range 支持；不支持/不可达返回 null（调用方回退单流） */
async function probeRangeCapability(
  url: string,
  dispatcher: Dispatcher,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<{ size: number } | null> {
  try {
    const res = await request(url, {
      method: 'HEAD',
      dispatcher,
      signal: AbortSignal.timeout(Math.min(timeoutMs, PROBE_TIMEOUT_CAP_MS)),
      headers: { ...(headers ?? {}) }
    })
    discardBody(res.body)
    if (res.statusCode >= 400) return null
    const size = Number(res.headers['content-length']) || 0
    if (size <= 0) return null
    const acceptRanges = String(res.headers['accept-ranges'] ?? '').toLowerCase()
    if (acceptRanges !== 'bytes') return null
    return { size }
  } catch {
    return null
  }
}

interface Segment {
  start: number
  end: number
  done: number
}

/**
 * 多线程分段下载：按 Range 把文件切成若干段并行拉取，各段独立重试与段内续传，
 * 直接按偏移写入目标文件（无合并步骤）；完成后由调用方做整体完整性校验。
 * 服务端对 Range 请求回 200 时抛 RangeNotHonoredError，由调用方清理后回退单流。
 */
async function downloadSegmented(
  url: string,
  destPath: string,
  size: number,
  opts: HttpDownloadOptions | undefined,
  redirecting: Dispatcher,
  timeoutMs: number
): Promise<void> {
  const connections = Math.min(
    MULTITHREAD_MAX_CONNECTIONS,
    Math.max(2, opts?.connections ?? MULTITHREAD_DEFAULT_CONNECTIONS)
  )
  const segCount = Math.min(
    connections,
    Math.max(2, Math.floor(size / MULTITHREAD_MIN_SEGMENT_BYTES))
  )
  const segSize = Math.ceil(size / segCount)
  const segments: Segment[] = []
  for (let i = 0; i < segCount; i++) {
    const start = i * segSize
    const end = Math.min(size, start + segSize) - 1
    if (end >= start) segments.push({ start, end, done: 0 })
  }

  const fh = await open(destPath, 'w')
  const report = (): void => {
    const loaded = segments.reduce((acc, s) => acc + s.done, 0)
    opts?.onProgress?.(loaded, size)
  }

  const downloadOne = async (seg: Segment): Promise<void> => {
    for (let attempt = 1; attempt <= DOWNLOAD_MAX_ATTEMPTS; attempt++) {
      if (opts?.signal?.aborted) throw new HttpUtilError('network', `下载已取消：${url}`)
      const from = seg.start + seg.done
      if (from > seg.end) return
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const signal = opts?.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
      const headers = { ...(opts?.headers ?? {}), Range: `bytes=${from}-${seg.end}` }
      let res: Awaited<ReturnType<typeof request>>
      try {
        res = await request(url, { method: 'GET', dispatcher: redirecting, signal, headers })
      } catch (err) {
        if (attempt < DOWNLOAD_MAX_ATTEMPTS && isTransientDownloadError(err) && !opts?.signal?.aborted) {
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
      // 416：远端文件变化导致段起点失效 → 重置本段重来
      if (res.statusCode === 416 && seg.done > 0) {
        discardBody(res.body)
        seg.done = 0
        continue
      }
      // 服务端忽略 Range 回 200：多线程不可用，整体回退单流
      if (res.statusCode === 200) {
        discardBody(res.body)
        throw new RangeNotHonoredError(url)
      }
      if (res.statusCode !== 206) {
        discardBody(res.body)
        throw new HttpUtilError('http', `分段下载失败 HTTP ${res.statusCode}：${url}`, res.statusCode)
      }
      try {
        let pos = from
        for await (const chunk of res.body as AsyncIterable<Buffer>) {
          await fh.write(chunk, 0, chunk.length, pos)
          pos += chunk.length
          seg.done += chunk.length
          report()
        }
        // 服务端提前结束（字节数少于请求区间）按传输中断处理，从已写偏移续传
        if (pos <= seg.end) {
          if (attempt < DOWNLOAD_MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, retryDelayMs(attempt)))
            continue
          }
          throw new HttpUtilError('network', `分段响应提前结束：${url}`)
        }
        return
      } catch (err) {
        if (attempt < DOWNLOAD_MAX_ATTEMPTS && isTransientDownloadError(err) && !opts?.signal?.aborted) {
          await new Promise((r) => setTimeout(r, retryDelayMs(attempt)))
          continue
        }
        throw toDownloadError(err, url)
      }
    }
    throw new HttpUtilError('http', `分段下载失败（已重试 ${DOWNLOAD_MAX_ATTEMPTS} 次）：${url}`)
  }

  try {
    await Promise.all(segments.map(downloadOne))
  } finally {
    await fh.close()
  }
}

/**
 * 满足条件时执行多线程分段下载：
 * - multithread === true 强制探测；缺省要求 expected.size 已达阈值（不多发 HEAD）
 * - 目标已有半成品（上次单流续传残留）时交给单流续传，不混用两种写入方式
 * - 服务端不支持 Range / 探测失败 / 中途发现 Range 被忽略 → 清理后回退单流
 * 返回 true 表示多线程已完成（含完整性校验）；false 表示应走单流。
 */
async function tryMultithreadDownload(
  url: string,
  destPath: string,
  opts: HttpDownloadOptions | undefined,
  redirecting: Dispatcher,
  timeoutMs: number
): Promise<boolean> {
  if (opts?.multithread === false || opts?.signal?.aborted) return false
  const threshold = Math.max(1, opts?.multithreadMinBytes ?? MULTITHREAD_MIN_BYTES)
  const hinted = (opts?.expected?.size ?? 0) >= threshold
  if (opts?.multithread !== true && !hinted) return false
  if ((await fileSize(destPath)) > 0) return false
  const cap = await probeRangeCapability(url, redirecting, timeoutMs, opts?.headers)
  if (!cap || cap.size < threshold) return false
  try {
    await downloadSegmented(url, destPath, cap.size, opts, redirecting, timeoutMs)
  } catch (err) {
    if (err instanceof RangeNotHonoredError) {
      await unlink(destPath).catch(() => undefined)
      return false
    }
    throw err
  }
  await assertDownloadIntegrity(destPath, opts?.expected, url)
  return true
}

async function downloadSingleStream(
  url: string,
  destPath: string,
  opts: HttpDownloadOptions | undefined,
  redirecting: Dispatcher,
  timeoutMs: number
): Promise<number> {
  // 断点续传起点：复用上次已落盘的半成品（此前恒为 0，跨次调用并未真正续传）
  let resumeFrom = await fileSize(destPath)
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
    await assertDownloadIntegrity(destPath, opts?.expected, url)
    return bytes
  }
  throw new HttpUtilError('http', `下载失败（已重试 ${DOWNLOAD_MAX_ATTEMPTS} 次）：${url}`)
}

/**
 * 流式下载 URL 到 destPath（自动创建父目录），返回写入字节数。
 *
 * 大文件多线程：满足条件（显式 multithread 或 expected.size 达阈值，且服务端
 * 支持 Range）时自动切换为分段并行下载；不满足或分段失败可回退时走单流。
 * 两种写入方式不混用：目标已存在半成品时固定走单流断点续传。
 */
export async function httpDownload(
  url: string,
  destPath: string,
  opts?: HttpDownloadOptions
): Promise<number> {
  await mkdir(dirname(destPath), { recursive: true })
  // 跟随重定向（CF 兜底下载端点是 302），上限 5 次防循环；超限抛错由调用方兜底
  const base = opts?.dispatcher ?? (await resolveDispatcher(url)) ?? getGlobalDispatcher()
  const redirecting = base.compose(interceptors.redirect({ maxRedirections: 5, throwOnMaxRedirect: true }))
  const timeoutMs = opts?.timeoutMs ?? Math.max(DOWNLOAD_TIMEOUT_FLOOR_MS, networkTimeoutMs())
  if (await tryMultithreadDownload(url, destPath, opts, redirecting, timeoutMs)) {
    return fileSize(destPath)
  }
  return downloadSingleStream(url, destPath, opts, redirecting, timeoutMs)
}
