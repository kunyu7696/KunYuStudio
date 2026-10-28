/**
 * AI 图像生成服务（贴图工坊「AI 重绘」管线的供应商适配层）。
 *
 * 硬约束：工作台不自建云端、不内置任何付费额度。这里只把请求转发到用户
 * 在设置里配置的、自带 Key 的 OpenAI 兼容 /images/generations 端点
 * （智谱 CogView / 豆包 Seedream / OpenAI dall-e-3 / 任意兼容网关）。
 *
 * 响应两种形态都吃：
 * - {data:[{b64_json}]}（智谱/豆包，默认要求 response_format=b64_json）
 * - {data:[{url}]}（OpenAI 风格）→ 再下载一次并转 data URL，10MB 上限
 */
import type { AiErrorKind, AiProviderConfig, AiResult } from '../../../shared/types/ai'

// 注意：settingsService 顶层依赖 electron-store（CommonJS），vitest 纯 Node 环境无法加载。
// 仅在真正需要读用户配置（未注入 provider）时动态导入，测试注入路径不触发。
async function loadProvidersFromSettings(): Promise<AiProviderConfig[]> {
  const { getSection } = await import('../settingsService')
  return getSection('ai').providers as AiProviderConfig[]
}

/** 支持的出图尺寸（供应商支持范围不同，失败时错误信息会透传服务端提示）。 */
export type ImageSize = '1024x1024' | '1024x1536' | '1536x1024' | '512x512' | '256x256'

export interface GenerateImageOptions {
  /** 指定供应商 id；省略时取第一个启用且配置了 imageModel 的供应商 */
  providerId?: string
  /** 中文/英文画面提示词（工具层会自动补充 Minecraft 像素风格约束） */
  prompt: string
  size?: ImageSize
  /** 生成张数（候选画廊一次 4 张时用），默认 1；部分供应商上限 10 */
  n?: number
  timeoutMs?: number
  /** 测试注入：自定义 fetch */
  fetchImpl?: typeof fetch
  /** 测试/特殊调用注入：直接给供应商配置，绕过 settings 读取 */
  provider?: AiProviderConfig
}

export interface GeneratedImage {
  /** PNG/JPEG data URL，后续像素化管线统一只接受 PNG 时会再转一道 */
  dataUrl: string
  /** 部分供应商会返回改写后的提示词 */
  revisedPrompt?: string
  model: string
}

export interface GenerateImageMulti {
  images: GeneratedImage[]
  model: string
}

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60_000

/** 读取所有「启用 + 配了图像模型」的供应商（设置面板/工具层挑选用）。 */
export async function listImageProviders(): Promise<AiProviderConfig[]> {
  const providers = await loadProvidersFromSettings()
  return providers.filter((p) => p.enabled && p.kind === 'openai-compatible' && (p.imageModel ?? '').trim() !== '')
}

async function pickProvider(options: { providerId?: string; provider?: AiProviderConfig }): Promise<AiProviderConfig | null> {
  if (options.provider) return options.provider
  const providers = await loadProvidersFromSettings()
  if (options.providerId) {
    return providers.find((p) => p.id === options.providerId) ?? null
  }
  return (
    providers.find(
      (p) => p.enabled && p.kind === 'openai-compatible' && (p.imageModel ?? '').trim() !== ''
    ) ?? null
  )
}

function fail(errorKind: AiErrorKind, errorMessage: string): AiResult<GenerateImageMulti> {
  return { ok: false, errorKind, errorMessage }
}

/** 去掉尾部斜杠，拼 /images/generations。 */
function endpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  return `${base}/images/generations`
}

interface ImagesApiItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
}

/**
 * 生成一张或多张图片。
 * 返回 IPC 风格的 AiResult：网络/鉴权/配置错误全部归类，不向工具层抛裸异常。
 */
export async function generateImages(
  options: GenerateImageOptions
): Promise<AiResult<GenerateImageMulti>> {
  const provider = await pickProvider(options)
  if (!provider) {
    return fail(
      'config',
      '没有可用的图像生成供应商：请在「设置 → AI 提供商」里填写图像模型（如智谱 cogview-3、豆包 seedream、dall-e-3）与 API Key。工作台不内置云端额度。'
    )
  }
  if (provider.kind === 'ollama') {
    return fail('config', '本地 Ollama 暂不支持 /images/generations 图像协议，请选择 OpenAI 兼容图像供应商。')
  }
  if (!(provider.imageModel ?? '').trim()) {
    return fail('config', `供应商「${provider.name}」未配置图像模型（imageModel 为空）。`)
  }
  if (!options.prompt.trim()) {
    return fail('config', '图像提示词为空。')
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchImpl(endpoint(provider.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: provider.imageModel,
        prompt: options.prompt,
        n: Math.max(1, Math.min(10, options.n ?? 1)),
        size: options.size ?? '1024x1024',
        response_format: 'b64_json'
      }),
      signal: controller.signal
    })
  } catch (err) {
    clearTimeout(timer)
    const aborted = (err as Error).name === 'AbortError'
    return fail(
      aborted ? 'timeout' : 'network',
      aborted
        ? `图像生成请求超时（${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms）`
        : `图像服务连接失败：${(err as Error).message}`
    )
  }
  clearTimeout(timer)

  const raw = await res.text()
  if (!res.ok) {
    // 401/403 → auth；404/model 相关 → model；其余 5xx → server
    let detail = raw
    try {
      detail = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw
    } catch {
      // 保留原文
    }
    if (res.status === 401 || res.status === 403) return fail('auth', `图像服务鉴权失败：${detail}`)
    if (res.status === 404 || /model|cogview|seedream|dall/i.test(detail)) {
      return fail('model', `图像模型不可用：${detail}`)
    }
    return fail('server', `图像服务返回 ${res.status}：${detail}`)
  }

  let parsed: { data?: ImagesApiItem[] }
  try {
    parsed = JSON.parse(raw) as { data?: ImagesApiItem[] }
  } catch {
    return fail('server', '图像服务返回了无法解析的响应。')
  }
  if (!Array.isArray(parsed.data) || parsed.data.length === 0) {
    return fail('server', '图像服务响应中没有 data 条目。')
  }

  const images: GeneratedImage[] = []
  for (const item of parsed.data) {
    try {
      if (item.b64_json) {
        images.push({
          dataUrl: `data:image/png;base64,${item.b64_json}`,
          revisedPrompt: item.revised_prompt,
          model: provider.imageModel!
        })
      } else if (item.url) {
        const downloaded = await downloadAsDataUrl(item.url, fetchImpl)
        images.push({ dataUrl: downloaded, revisedPrompt: item.revised_prompt, model: provider.imageModel! })
      }
    } catch (err) {
      return fail('network', `下载图像结果失败：${(err as Error).message}`)
    }
  }
  if (images.length === 0) {
    return fail('server', '图像服务返回的条目既无 b64_json 也无 url。')
  }
  return { ok: true, data: { images, model: provider.imageModel! } }
}

/** 单张便捷封装（取第一张）。 */
export async function generateImage(
  options: GenerateImageOptions
): Promise<AiResult<GeneratedImage>> {
  const r = await generateImages({ ...options, n: 1 })
  if (!r.ok) return r
  return { ok: true, data: r.data.images[0]! }
}

/** 下载 url 结果并转 data URL（带体积上限）。 */
async function downloadAsDataUrl(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`图片超过 ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB 上限`)
  }
  return `data:${mime};base64,${buf.toString('base64')}`
}
