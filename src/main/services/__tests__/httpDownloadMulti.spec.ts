/**
 * httpDownload 多线程分段下载单测（本地服务器，不依赖外网）：
 * - 支持 Range 的大文件：自动切多段并行，落盘字节与原文件一致，哈希校验通过
 * - 段传输中途断连：该段从已写入偏移续传，最终仍完整
 * - 服务端声称支持 Range 但 GET 忽略 Range（回 200）：回退单流，结果仍正确
 * - HEAD 探测失败（405）：直接走单流
 * - 目标已有半成品：不混写，走单流续传
 * - 用户取消：不多发请求
 */
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../settingsService', () => ({
  getSection: () => ({ proxyMode: 'none', proxyHost: '', proxyPort: 0, timeoutSec: 30 })
}))

import { httpDownload, HttpUtilError } from '../httpUtil'

const BODY = randomBytes(1024 * 1024) // 1MB 随机内容（阈值调小后即可触发多线程）
const SHA1 = createHash('sha1').update(BODY).digest('hex')
const MT_OPTS = { multithreadMinBytes: 64 * 1024 } as const

interface SeenReq {
  method: string
  url: string
  range: string
}

/** 按 Range 头回 206 切片；忽略 Range 与否由调用方控制 */
function serveRange(res: ServerResponse, body: Buffer, range: string | undefined): void {
  const m = /^bytes=(\d+)-(\d*)$/.exec(range ?? '')
  if (!m) {
    res.writeHead(200, { 'Content-Length': String(body.length) })
    res.end(body)
    return
  }
  const start = Number(m[1])
  const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1
  const slice = body.subarray(start, end + 1)
  res.writeHead(206, {
    'Content-Length': String(slice.length),
    'Content-Range': `bytes ${start}-${end}/${body.length}`
  })
  res.end(slice)
}

describe('httpDownload 多线程分段', () => {
  let server: Server
  let baseUrl: string
  let tmpRoot: string
  let seen: SeenReq[] = []
  let dropFirstSegRequest = false

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'kunyu-httpmt-'))
    server = createServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', range: req.headers.range ?? '' })
      const url = req.url ?? ''
      if (url === '/norange') {
        // HEAD 谎称支持 Range；GET 一律忽略 Range 回全量
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'Content-Length': String(BODY.length), 'Accept-Ranges': 'bytes' })
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Length': String(BODY.length) })
        res.end(BODY)
        return
      }
      if (url === '/nohead') {
        if (req.method === 'HEAD') {
          res.writeHead(405, { 'Content-Length': '0' })
          res.end()
          return
        }
        serveRange(res, BODY, undefined)
        return
      }
      // /big /flaky：标准 Range 服务端
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Length': String(BODY.length), 'Accept-Ranges': 'bytes' })
        res.end()
        return
      }
      if (url === '/flaky' && dropFirstSegRequest && req.headers.range) {
        dropFirstSegRequest = false
        // 声明完整区间长度，但只发 4KB 就断开：模拟段内传输中断（客户端应视为截断并续传）
        const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range)!
        const start = Number(m[1])
        const end = Number(m[2])
        res.writeHead(206, {
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${BODY.length}`
        })
        res.write(BODY.subarray(start, start + 4096), () => {
          setTimeout(() => res.destroy(), 50)
        })
        return
      }
      serveRange(res, BODY, req.headers.range)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('大文件自动多段并行，字节一致且哈希校验通过', async () => {
    seen = []
    const dest = join(tmpRoot, 'big.bin')
    const progress: Array<[number, number]> = []
    const bytes = await httpDownload(`${baseUrl}/big`, dest, {
      expected: { sha1: SHA1, size: BODY.length },
      onProgress: (loaded, total) => progress.push([loaded, total]),
      ...MT_OPTS
    })
    expect(bytes).toBe(BODY.length)
    expect((await readFile(dest)).equals(BODY)).toBe(true)
    // 1 次 HEAD 探测 + ≥2 个带不同起点的 Range GET
    expect(seen.filter((r) => r.method === 'HEAD').length).toBe(1)
    const ranges = seen.filter((r) => r.method === 'GET').map((r) => r.range)
    const starts = new Set(ranges.map((r) => /bytes=(\d+)-/.exec(r)?.[1]))
    expect(ranges.length).toBeGreaterThanOrEqual(2)
    expect(starts.size).toBe(ranges.length)
    // 进度最终到达总量
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1]).toEqual([BODY.length, BODY.length])
  })

  it('段内断连后从该段已写偏移续传，最终完整', async () => {
    seen = []
    dropFirstSegRequest = true
    const dest = join(tmpRoot, 'flaky.bin')
    const bytes = await httpDownload(`${baseUrl}/flaky`, dest, {
      expected: { sha1: SHA1, size: BODY.length },
      ...MT_OPTS
    })
    expect(bytes).toBe(BODY.length)
    expect((await readFile(dest)).equals(BODY)).toBe(true)
    // 断过一次 → 该段必出现一次带非零起点的续传请求
    const resumed = seen.filter((r) => r.method === 'GET' && /bytes=[1-9]\d*-/.test(r.range))
    expect(resumed.length).toBeGreaterThanOrEqual(1)
  })

  it('服务端忽略 Range 时回退单流，结果仍正确', async () => {
    seen = []
    const dest = join(tmpRoot, 'norange.bin')
    const bytes = await httpDownload(`${baseUrl}/norange`, dest, {
      expected: { sha1: SHA1, size: BODY.length },
      ...MT_OPTS
    })
    expect(bytes).toBe(BODY.length)
    expect((await readFile(dest)).equals(BODY)).toBe(true)
  })

  it('HEAD 探测失败直接走单流', async () => {
    seen = []
    const dest = join(tmpRoot, 'nohead.bin')
    const bytes = await httpDownload(`${baseUrl}/nohead`, dest, {
      multithread: true,
      ...MT_OPTS
    })
    expect(bytes).toBe(BODY.length)
    expect((await readFile(dest)).equals(BODY)).toBe(true)
    expect(seen.filter((r) => r.method === 'GET' && r.range !== '').length).toBe(0)
  })

  it('已有半成品时不混写：走单流从已有字节续传', async () => {
    seen = []
    const dest = join(tmpRoot, 'partial.bin')
    const half = BODY.subarray(0, BODY.length / 2)
    await writeFile(dest, half)
    const bytes = await httpDownload(`${baseUrl}/big`, dest, {
      expected: { sha1: SHA1, size: BODY.length },
      ...MT_OPTS
    })
    expect(bytes).toBe(BODY.length)
    expect((await readFile(dest)).equals(BODY)).toBe(true)
    // 单流续传：GET 带开区间 Range（bytes=<half>-）
    const getRanges = seen.filter((r) => r.method === 'GET').map((r) => r.range)
    expect(getRanges.some((r) => r === `bytes=${half.length}-`)).toBe(true)
  })

  it('用户取消时不发任何请求', async () => {
    seen = []
    const dest = join(tmpRoot, 'cancel.bin')
    const controller = new AbortController()
    controller.abort()
    await expect(
      httpDownload(`${baseUrl}/big`, dest, { signal: controller.signal, ...MT_OPTS })
    ).rejects.toBeInstanceOf(HttpUtilError)
    expect(seen.length).toBe(0)
  })
})
