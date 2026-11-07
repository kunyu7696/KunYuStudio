#!/usr/bin/env node
/**
 * 刷新 LLM 模型目录快照（唯一价格来源：OpenRouter 公开模型 API）。
 *
 * 为什么不在运行时联网：桌面应用需要离线可用、且不能让预算推导依赖网络抖动。
 * 因此这里把真实价格抓成快照落到 src/shared/data/modelCatalog.json，
 * 由 `modelProfile.spec.ts` 守门（结构合法、价格非负、有来源与抓取时间）。
 *
 * 用法：npm run models:refresh
 * 说明：抓不到网络时直接失败退出（绝不生成编造价格）；此前快照保持不动。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SOURCE = 'https://openrouter.ai/api/v1/models'
const OUT = join(process.cwd(), 'src', 'shared', 'data', 'modelCatalog.json')

/** OpenRouter 价格字符串（USD/token）→ USD/百万 token，保留 6 位小数 */
function perMillion(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 1e6 * 1e6) / 1e6
}

function toEntry(m) {
  const prompt = perMillion(m?.pricing?.prompt)
  const completion = perMillion(m?.pricing?.completion)
  if (prompt === null || completion === null) return null
  if (typeof m.id !== 'string' || m.id.length === 0) return null
  const modalities = Array.isArray(m?.architecture?.input_modalities)
    ? m.architecture.input_modalities
    : []
  const supported = Array.isArray(m?.supported_parameters) ? m.supported_parameters : []
  return {
    id: m.id,
    name: typeof m.name === 'string' ? m.name : m.id,
    context: Number.isFinite(m?.context_length) ? m.context_length : 0,
    maxOutput: Number.isFinite(m?.top_provider?.max_completion_tokens)
      ? m.top_provider.max_completion_tokens
      : 0,
    prompt,
    completion,
    vision: modalities.includes('image'),
    tools: supported.includes('tools')
  }
}

async function main() {
  console.log('[model-catalog] 拉取', SOURCE)
  const res = await fetch(SOURCE, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json()
  const list = Array.isArray(body?.data) ? body.data : []
  const models = list
    .map(toEntry)
    .filter((m) => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id))
  if (models.length === 0) throw new Error('目录为空，拒绝写入')
  const payload = {
    source: SOURCE,
    fetchedAt: new Date().toISOString(),
    currency: 'USD',
    unit: 'per_million_tokens',
    models
  }
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`[model-catalog] 完成：${models.length} 个模型 -> ${OUT}`)
}

main().catch((e) => {
  console.error('[model-catalog] 失败：', e.message)
  process.exit(1)
})
