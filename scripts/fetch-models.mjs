#!/usr/bin/env node
/**
 * A3 离线模型预置：构建期从 HuggingFace（或 HF_ENDPOINT 镜像）拉取 bge-small-zh-v1.5
 * 量化版到 resources/models，供 electron-builder extraResources 打包进安装包。
 *
 * 用法：npm run fetch-models
 * 幂等：已缓存文件存在且完整时跳过（CI/CD 缓存友好）。
 * 国内网络默认 hf-mirror.com；显式设置过 HF_ENDPOINT 的环境变量时不覆盖。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MODEL_ID = 'Xenova/bge-small-zh-v1.5'
const REQUIRED_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
const OUT_DIR = join(process.cwd(), 'resources', 'models', ...MODEL_ID.split('/'))

async function main() {
  process.env['HF_ENDPOINT'] ??= 'https://hf-mirror.com'
  const isCached = REQUIRED_FILES.every((f) => existsSync(join(OUT_DIR, f)))
  if (isCached) {
    console.log('[fetch-models] 缓存已命中：', OUT_DIR)
    return
  }
  console.log('[fetch-models] 拉取', MODEL_ID, '->', OUT_DIR)
  mkdirSync(OUT_DIR, { recursive: true })
  // xenova pipeline 自带 FS 缓存：把 cacheDir 指向目标目录即可「按需下载+复用」
  const { pipeline, env } = await import('@xenova/transformers')
  env.cacheDir = join(process.cwd(), 'resources', 'models')
  const endpoint = process.env['HF_ENDPOINT']
  if (endpoint) env.remoteHost = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  await pipeline('feature-extraction', MODEL_ID, {
    quantized: true,
    progress_callback: (p) => {
      if (p.status === 'progress') {
        const pct = typeof p.progress === 'number' ? Math.round(p.progress) : '?'
        process.stdout.write(`\r  ${p.file ?? ''} ${pct}%`)
      }
      if (p.status === 'done') {
        console.log(`\r  ${p.file ?? ''} done`)
      }
    }
  })
  // 写摘要供打包审计
  writeFileSync(
    join(OUT_DIR, '.source.json'),
    JSON.stringify({ modelId: MODEL_ID, fetchedAt: new Date().toISOString(), endpoint }, null, 2)
  )
  console.log('[fetch-models] 完成：', OUT_DIR)
}

main().catch((e) => {
  console.error('[fetch-models] 失败：', e.message)
  process.exit(1)
})
