/**
 * LLM 模型档案：价格 / 上下文窗口 / 能力 / 计费类型的**单一数据源**。
 *
 * 背景：五档预算此前是硬编码常量，与模型真实价格脱钩——用户换一个贵模型或
 * 本地无限量模型，档位预算毫无变化，既可能烧掉额度，也可能无谓熔断。
 *
 * 数据来源：`src/shared/data/modelCatalog.json` 是 OpenRouter 公开模型 API 的
 * 真实价格快照（USD / 百万 token），由 `npm run models:refresh` 刷新；运行时
 * **不联网**，因此离线可用。未收录的模型不猜价格——billing 记为 unknown，
 * 预算回退固定上限并如实告知，绝不编造数字。
 */
import catalogJson from '../data/modelCatalog.json'
import type { AiProviderConfig } from './ai'

export interface ModelCatalogEntry {
  /** 厂商/模型 id，如 openai/gpt-4o-mini */
  id: string
  name: string
  context: number
  maxOutput: number
  /** USD / 百万输入 token */
  prompt: number
  /** USD / 百万输出 token */
  completion: number
  vision: boolean
  tools: boolean
}

export interface ModelCatalog {
  source: string
  fetchedAt: string
  currency: string
  unit: string
  models: ModelCatalogEntry[]
}

export const MODEL_CATALOG = catalogJson as unknown as ModelCatalog

/** 计费类型：metered=按 token 计费；unlimited=本地/零价；unknown=未识别价格 */
export type ModelBilling = 'metered' | 'unlimited' | 'unknown'

export interface ModelPricing {
  /** USD / 百万输入 token */
  inputPerMTok: number
  /** USD / 百万输出 token */
  outputPerMTok: number
}

export interface ModelCapabilities {
  /** 是否支持图片输入（视觉评审/贴图理解） */
  vision: boolean
  /** 是否支持 Function Calling */
  tools: boolean
}

export interface ModelProfile {
  /** providerId:model，运行日志与 UI 展示用 */
  key: string
  providerId: string
  model: string
  displayName: string
  /** 上下文窗口（token）；0 = 未知，沿用提供商配置/固定回退 */
  contextWindow: number
  maxOutputTokens: number
  /** unknown 时为 null（不估算、不编造） */
  pricing: ModelPricing | null
  billing: ModelBilling
  capabilities: ModelCapabilities
  /** pricing 的来源：目录快照 / 本地模型 / 未识别 */
  source: 'catalog' | 'local' | 'unknown'
  /** 目录快照抓取时间（可追溯价格新鲜度） */
  catalogFetchedAt: string | null
}

/** 厂商提示：把用户配置的 baseUrl 映射到目录里的厂商前缀，避免同名模型串价 */
const VENDOR_HINTS: Array<[RegExp, string[]]> = [
  [/volces|volcengine|doubao|ark\.cn/i, ['bytedance', 'doubao']],
  [/openai\.com|azure/i, ['openai']],
  [/anthropic/i, ['anthropic']],
  [/googleapis|generativelanguage|gemini/i, ['google']],
  [/deepseek/i, ['deepseek']],
  [/moonshot/i, ['moonshotai']],
  [/dashscope|aliyun|bailian|qwen/i, ['qwen', 'alibaba']],
  [/bigmodel|zhipu/i, ['z-ai', 'thudm']],
  [/x\.ai|grok/i, ['x-ai']],
  [/mistral/i, ['mistralai']],
  [/minimax/i, ['minimax']],
  [/baichuan/i, ['baichuan']],
  [/01\.ai|lingyiwanwu|yi-large/i, ['01-ai']]
]

const byId = new Map<string, ModelCatalogEntry>()
const byShort = new Map<string, ModelCatalogEntry[]>()
for (const entry of MODEL_CATALOG.models) {
  byId.set(entry.id.toLowerCase(), entry)
  const short = entry.id.slice(entry.id.lastIndexOf('/') + 1).toLowerCase()
  const list = byShort.get(short)
  if (list) list.push(entry)
  else byShort.set(short, [entry])
}

/** 去掉常见的日期/版本后缀，便于把 gpt-4o-mini-2024-07-18 归到 gpt-4o-mini */
function stripVersionSuffix(name: string): string[] {
  const out: string[] = []
  const noFree = name.replace(/:free$/, '')
  if (noFree !== name) out.push(noFree)
  const noDate = noFree.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')
  if (noDate !== noFree) out.push(noDate)
  return out
}

function vendorHints(baseUrl: string): string[] {
  for (const [re, vendors] of VENDOR_HINTS) {
    if (re.test(baseUrl)) return vendors
  }
  return []
}

/** 同短名多候选时的消歧：厂商前缀优先；仍有多个且价格/窗口完全一致才采用（否则视为未识别） */
function pickAmbiguous(
  candidates: ModelCatalogEntry[],
  hints: string[]
): ModelCatalogEntry | null {
  const hinted = hints.length
    ? candidates.filter((c) => hints.some((h) => c.id.toLowerCase().startsWith(`${h}/`)))
    : []
  if (hinted.length === 1) return hinted[0]!
  const pool = hinted.length > 0 ? hinted : candidates
  if (pool.length === 1) return pool[0]!
  const first = pool[0]!
  const same = pool.every(
    (c) =>
      c.prompt === first.prompt &&
      c.completion === first.completion &&
      c.context === first.context
  )
  return same ? first : null
}

/** 在目录快照里匹配模型；匹配不到返回 null（不猜价） */
export function findCatalogEntry(model: string, baseUrl = ''): ModelCatalogEntry | null {
  const raw = model.trim().toLowerCase()
  if (!raw) return null
  const hints = vendorHints(baseUrl)
  const names = [raw, ...stripVersionSuffix(raw)]

  for (const name of names) {
    const direct = byId.get(name)
    if (direct) return direct
  }
  for (const name of names) {
    const short = name.slice(name.lastIndexOf('/') + 1)
    const candidates = byShort.get(short)
    if (!candidates || candidates.length === 0) continue
    const picked = pickAmbiguous(candidates, hints)
    if (picked) return picked
  }
  return null
}

export type ModelLookupProvider = Pick<
  AiProviderConfig,
  'id' | 'kind' | 'baseUrl' | 'model' | 'contextWindow'
>

/**
 * 解析某个提供商 + 模型的实际档案。
 * - Ollama（本地）→ unlimited，价格恒为 0；
 * - 目录命中 → metered（零价模型记 unlimited）；
 * - 未命中 → unknown（pricing=null，预算回退固定上限）。
 */
export function resolveModelProfile(
  provider: ModelLookupProvider,
  model: string
): ModelProfile {
  const name = model.trim() || provider.model.trim()
  const base: Pick<ModelProfile, 'key' | 'providerId' | 'model' | 'displayName'> = {
    key: `${provider.id}:${name}`,
    providerId: provider.id,
    model: name,
    displayName: name || provider.model
  }

  if (provider.kind === 'ollama') {
    return {
      ...base,
      contextWindow: provider.contextWindow ?? 0,
      maxOutputTokens: 0,
      pricing: { inputPerMTok: 0, outputPerMTok: 0 },
      billing: 'unlimited',
      capabilities: { vision: false, tools: true },
      source: 'local',
      catalogFetchedAt: null
    }
  }

  const entry = findCatalogEntry(name, provider.baseUrl)
  if (!entry) {
    return {
      ...base,
      contextWindow: provider.contextWindow ?? 0,
      maxOutputTokens: 0,
      pricing: null,
      billing: 'unknown',
      capabilities: { vision: false, tools: true },
      source: 'unknown',
      catalogFetchedAt: null
    }
  }

  const free = entry.prompt === 0 && entry.completion === 0
  return {
    ...base,
    contextWindow: entry.context || (provider.contextWindow ?? 0),
    maxOutputTokens: entry.maxOutput,
    pricing: { inputPerMTok: entry.prompt, outputPerMTok: entry.completion },
    billing: free ? 'unlimited' : 'metered',
    capabilities: { vision: entry.vision, tools: entry.tools },
    source: 'catalog',
    catalogFetchedAt: MODEL_CATALOG.fetchedAt
  }
}

/**
 * 单次调用的成本估算（USD）。
 * unknown 返回 null（拒绝编造）；unlimited 返回 0。
 */
export function estimateCallCostUsd(
  profile: Pick<ModelProfile, 'billing' | 'pricing'>,
  promptTokens: number,
  completionTokens: number
): number | null {
  if (profile.billing === 'unknown' || !profile.pricing) return null
  if (profile.billing === 'unlimited') return 0
  const cost =
    (promptTokens * profile.pricing.inputPerMTok + completionTokens * profile.pricing.outputPerMTok) /
    1_000_000
  return Number.isFinite(cost) ? cost : null
}
