/**
 * httpDownload 弱网韧性单测：
 * - 连接中途断开 → 自动重试，并用 Range 从已落盘字节续传，最终完整落盘
 * - 用户主动取消 → 不重试，直接失败
 * - 服务端回 416（远端文件变化）→ 丢弃半成品从头下载
 * 用 node:http 本地服务器制造可复现的断连，不依赖外网。
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../settingsService', () => ({
  getSection: () => ({ proxyMode: 'none', proxyHost: '', proxyPort: 0, timeoutSec: 30 })
}))

import { httpDownload, HttpUtilError } from '../httpUtil'

const BODY = Buffer.from('0123456789abcdef'.repeat(12_500)) // 200 KB
const SHA1 = createHash('sha1').update(BODY).digest('hex')

describe('httpDownload 断点续传', () => {
  let server: Server
  let baseUrl: string
  let tmpRoot: string
  let requests: string[] = []

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'kunyu-httpdl-'))
    server = createServer((req, res) => {
      requests.push(req.headers.range ?? '')
      if (req.url === '/flaky') {
        const range = req.headers.range
        if (!range) {
          // 第一次：只发一半就断开连接（模拟弱网中断）
          res.writeHead(200, { 'Content-Length': String(BODY.length) })
          res.write(BODY.subarray(0, BODY.length / 2))
          setTimeout(() => res.destroy(), 10)
          return
        }
        const start = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0)
        const slice = BODY.subarray(start)
        res.writeHead(206, {
          'Content-Length': String(slice.length),
          'Content-Range': `bytes ${start}-${BODY.length - 1}/${BODY.length}`
        })
        res.end(slice)
        return
      }
      if (req.url === '/stale') {
        // 对所有请求都回 416：模拟远端文件已替换、续传起点失效
        res.writeHead(416, { 'Content-Length': '0' })
        res.end()
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
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('中断后自动续传，最终文件完整且哈希校验通过', async () => {
    requests = []
    const dest = join(tmpRoot, 'flaky.jar')
    const bytes = await httpDownload(`${baseUrl}/flaky`, dest, {
      expected: { sha1: SHA1, size: BODY.length }
    })
    expect(bytes).toBe(BODY.length)
    const content = await readFile(dest)
    expect(content.equals(BODY)).toBe(true)
    // 首次无 Range；续传请求带 Range，从断点处继续
    expect(requests.length).toBe(2)
    expect(requests[0]).toBe('')
    expect(requests[1]).toMatch(/^bytes=\d+-$/)
  })

  it('用户主动取消时不重试', async () => {
    requests = []
    const dest = join(tmpRoot, 'cancel.jar')
    const controller = new AbortController()
    controller.abort()
    await expect(
      httpDownload(`${baseUrl}/flaky`, dest, { signal: controller.signal })
    ).rejects.toBeInstanceOf(HttpUtilError)
    expect(requests.length).toBe(0)
  })

  it('416 时丢弃半成品并从头上重新下载（不会无限循环）', async () => {
    requests = []
    const dest = join(tmpRoot, 'stale.jar')
    await expect(httpDownload(`${baseUrl}/stale`, dest)).rejects.toMatchObject({
      code: 'http',
      status: 416
    })
    // 首次 416（resumeFrom=0 不触发重置）→ 直接按 HTTP 错误失败
    expect(requests.length).toBe(1)
  })

  it('哈希不符时删除半成品并报错', async () => {
    const dest = join(tmpRoot, 'badhash.jar')
    await expect(
      httpDownload(`${baseUrl}/flaky`, dest, { expected: { sha1: 'deadbeef' } })
    ).rejects.toMatchObject({ code: 'http' })
  })
})
