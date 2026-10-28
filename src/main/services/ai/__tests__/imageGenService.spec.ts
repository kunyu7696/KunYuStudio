/**
 * imageGenService 单测：本地伪服务模拟 OpenAI 兼容 /images/generations。
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createServer, type ServerResponse, type IncomingMessage } from 'node:http'
import { PNG } from 'pngjs'
import type { AiProviderConfig } from '../../../../shared/types/ai'
import { generateImage, generateImages } from '../imageGenService'

function testProvider(overrides: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return {
    id: 'test-img',
    name: '测试图像商',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:0',
    apiKey: 'sk-test',
    apiKeyUrl: '',
    model: 'chat-model',
    imageModel: 'test-image-1',
    maxTokens: 4096,
    temperature: 0.7,
    enabled: true,
    ...overrides
  }
}

/** 1x1 红点 PNG 的 base64（合法 PNG 即可，管线不关心内容）。 */
function tinyPngBase64(): string {
  const png = new PNG({ width: 2, height: 2 })
  for (let i = 0; i < 2 * 2; i++) {
    png.data[i * 4] = 255
    png.data[i * 4 + 1] = 0
    png.data[i * 4 + 2] = 0
    png.data[i * 4 + 3] = 255
  }
  return PNG.sync.write(png).toString('base64')
}

interface FakeServer {
  port: number
  lastBody: unknown
  stop: () => void
}

function startImageServer(handler: (url: string, res: ServerResponse, body: unknown) => void): Promise<FakeServer> {
  let lastBody: unknown = null
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c.toString('utf-8')))
    req.on('end', () => {
      try {
        lastBody = raw ? JSON.parse(raw) : {}
      } catch {
        lastBody = {}
      }
      handler(req.url ?? '/', res, lastBody)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        port,
        get lastBody() {
          return lastBody
        },
        stop: () => server.close()
      })
    })
  })
}

const servers: FakeServer[] = []
afterEach(() => {
  while (servers.length) servers.pop()?.stop()
})

describe('generateImages', () => {
  it('b64_json 正常返回 data URL，并按协议发模型/尺寸/response_format', async () => {
    const fake = await startImageServer((_url, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ b64_json: tinyPngBase64(), revised_prompt: 'rp' }] }))
    })
    servers.push(fake)

    const result = await generateImages({
      provider: testProvider({ baseUrl: `http://127.0.0.1:${fake.port}` }),
      prompt: '红宝石剑',
      size: '1024x1024',
      n: 1
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.images[0]?.dataUrl).toMatch(/^data:image\/png;base64,/)
    expect(result.data.images[0]?.revisedPrompt).toBe('rp')
    expect(result.data.model).toBe('test-image-1')
    expect(fake.lastBody).toMatchObject({
      model: 'test-image-1',
      prompt: '红宝石剑',
      size: '1024x1024',
      n: 1,
      response_format: 'b64_json'
    })
  })

  it('url 形态自动下载转 data URL', async () => {
    // 同一服务：/images/generations 返回指向 /img 的 url，/img 给 PNG 字节
    const fake: FakeServer = await new Promise((resolveOuter) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const portNow = (server.address() as AddressInfo | null)?.port ?? 0
        if ((req.url ?? '').startsWith('/img')) {
          res.setHeader('Content-Type', 'image/png')
          res.end(Buffer.from(tinyPngBase64(), 'base64'))
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${portNow}/img` }] }))
      })
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as AddressInfo).port
        resolveOuter({ port, lastBody: null, stop: () => server.close() })
      })
    })
    servers.push(fake)

    const result = await generateImage({
      provider: testProvider({ baseUrl: `http://127.0.0.1:${fake.port}` }),
      prompt: 'x'
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.dataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it('401 归类为 auth', async () => {
    const fake = await startImageServer((_u, res) => {
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
    })
    servers.push(fake)
    const result = await generateImage({
      provider: testProvider({ baseUrl: `http://127.0.0.1:${fake.port}` }),
      prompt: 'x'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKind).toBe('auth')
      expect(result.errorMessage).toContain('bad key')
    }
  })

  it('未配置 imageModel → config 错误并给设置引导', async () => {
    const result = await generateImage({
      provider: testProvider({ imageModel: '' }),
      prompt: 'x'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKind).toBe('config')
      expect(result.errorMessage).toContain('图像模型')
    }
  })

  it('空提示词直接 config 失败，不发请求', async () => {
    const result = await generateImage({ provider: testProvider(), prompt: '   ' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorKind).toBe('config')
  })
})
