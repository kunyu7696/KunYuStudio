/**
 * httpUtil.httpGetText 扩展语义单测（B1 配套）：
 * - maxBytes：响应体超限流式截断 + truncated 标记
 * - headers：自定义请求头覆盖默认值
 * - 不传 maxBytes 时行为与旧版一致（全量读取、无 truncated 字段）
 * 用 node:http 本地服务器真实请求（proxyMode=none 不走代理/electron）。
 */
import { createServer, type Server, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../settingsService', () => ({
  getSection: () => ({ proxyMode: 'none', proxyHost: '', proxyPort: 0, timeoutSec: 30 })
}))

import { fetchSha256Sidecar, httpGetText } from '../httpUtil'

describe('httpGetText maxBytes / headers', () => {
  let server: Server
  let baseUrl: string
  let lastRequest: IncomingMessage | null = null
  const BIG_BODY = 'y'.repeat(100_000)

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastRequest = req
      if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(BIG_BODY)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('small')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('不传 maxBytes：全量读取且无 truncated 字段', async () => {
    const r = await httpGetText(`${baseUrl}/big`)
    expect(r.status).toBe(200)
    expect(r.text).toBe(BIG_BODY)
    expect(r.truncated).toBeUndefined()
  })

  it('maxBytes 截断到精确上限并标记 truncated', async () => {
    const r = await httpGetText(`${baseUrl}/big`, { maxBytes: 10_000 })
    expect(r.status).toBe(200)
    expect(r.text.length).toBe(10_000)
    expect(r.truncated).toBe(true)
  })

  it('maxBytes 大于响应体时不截断', async () => {
    const r = await httpGetText(`${baseUrl}/small`, { maxBytes: 10_000 })
    expect(r.text).toBe('small')
    expect(r.truncated).toBe(false)
  })

  it('自定义 headers 覆盖默认 User-Agent', async () => {
    await httpGetText(`${baseUrl}/small`, { headers: { 'User-Agent': 'KunYu-Test/1.0' } })
    expect(lastRequest?.headers['user-agent']).toBe('KunYu-Test/1.0')
  })
})

describe('fetchSha256Sidecar · 下载校验值获取', () => {
  let server: Server
  let baseUrl: string
  const HASH = 'a'.repeat(63) + 'f'

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/tool.zip.sha256') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end(`${HASH}  tool.zip\n`)
        return
      }
      if (req.url === '/garbage.sha256') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('<html>not found</html>')
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('解析 sidecar 中的 64 位十六进制哈希', async () => {
    expect(await fetchSha256Sidecar(`${baseUrl}/tool.zip`)).toBe(HASH)
  })

  it('404 与无哈希内容均返回 null（调用方据此拒绝下载或标记未校验）', async () => {
    expect(await fetchSha256Sidecar(`${baseUrl}/missing.zip`)).toBeNull()
    expect(await fetchSha256Sidecar(`${baseUrl}/garbage`)).toBeNull()
  })
})
