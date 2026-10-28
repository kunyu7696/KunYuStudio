/**
 * A3 离线模型预置流水线：预置清单 → 后台预取（进度事件）→ 本地缓存校验 → DB 落库。
 *
 * 纯函数风格：不 import electron，modelsDir / db / 下载执行器全部注入，vitest 纯 Node 可测。
 *
 * 下载策略：复用 @xenova/transformers 自带 FS 缓存（env.cacheDir = modelsDir），
 * 缓存键即 <modelId>/<filename>，与 kbRagService 加载路径完全一致——
 * 预取成功后 kbRag 首次使用直接命中本地缓存，无需二次下载。
 */
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type {
  ModelAssetDto,
  ModelAssetStatus,
  ModelListResult,
  ModelProvisionEvent,
  PresetModelInfo
} from '../../shared/types/models'

/** 预置模型清单（requiredFiles 相对 modelsDir/<id>/，存在性校验用） */
export const PRESET_MODELS: ReadonlyArray<PresetModelInfo & { requiredFiles: string[] }> = [
  {
    id: 'Xenova/bge-small-zh-v1.5',
    name: 'BGE Small 中文向量模型',
    description: '本地知识库 RAG 嵌入：把参考包文档编码为向量供语义检索，下载后完全离线可用',
    estimatedSizeBytes: 50 * 1024 * 1024,
    // quantized feature-extraction 管线实际拉取的最小文件集
    requiredFiles: ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']
  }
]

export type ModelDownloadProgress = (info: {
  file?: string
  progress?: number
  loadedBytes?: number
  totalBytes?: number
}) => void

/** 事件推送出口（主进程侧通常是 win.webContents.send 的适配器） */
export interface ModelEventSink {
  isDestroyed(): boolean
  webContents: { send(channel: string, payload: ModelProvisionEvent): void }
}

export const MODEL_EVENT_CHANNEL = 'aiRuntime:model-event'

interface ModelAssetRow {
  model_id: string
  status: string
  dir: string
  size_bytes: number
  error: string | null
  updated_at: number
}

export interface ModelProvisionDeps {
  /** xenova 缓存根目录（与 kbRagSingleton 的 modelsDir 同一路径） */
  modelsDir: string
  db: Database.Database
  /**
   * 下载执行器（测试注入 mock；缺省走 xenova pipeline，自带 FS 缓存与断点文件复用）。
   * 返回该模型实际落盘字节数；抛错即视为失败（prefetchAll 捕获后继续下一个）。
   */
  downloadModel?: (model: PresetModelInfo, onProgress: ModelDownloadProgress) => Promise<number>
  /**
   * 安装包内预置模型目录（A3 离线预置）。
   * prod：process.resourcesPath/models；dev：resources/models（由 scripts/fetch-models 拉取）。
   * 返回 null/undefined 或目录不完整时跳过种子拷贝，回退在线下载。
   */
  bundledModelsDir?: () => string | null
}

/** 递归统计目录字节数（模型落盘体积回写 DB） */
function dirSizeBytes(dir: string): number {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) total += dirSizeBytes(abs)
    else if (entry.isFile()) {
      try {
        total += statSync(abs).size
      } catch {
        /* 单文件统计失败忽略 */
      }
    }
  }
  return total
}

/** 默认下载执行器：xenova pipeline 触发真实下载（进度经 progress_callback 逐文件回报） */
async function xenovaDownload(
  modelsDir: string,
  model: PresetModelInfo,
  onProgress: ModelDownloadProgress
): Promise<number> {
  // 国内网络默认走 hf-mirror；2.17 不读 HF_ENDPOINT 环境变量，需显式写 remoteHost
  process.env['HF_ENDPOINT'] ??= 'https://hf-mirror.com'
  const mod = (await import('@xenova/transformers')) as typeof import('@xenova/transformers')
  mod.env.cacheDir = modelsDir
  const endpoint = process.env['HF_ENDPOINT']
  if (endpoint) mod.env.remoteHost = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  await mod.pipeline('feature-extraction', model.id, {
    quantized: true,
    progress_callback: (p: {
      status?: string
      file?: string
      progress?: number
      loaded?: number
      total?: number
    }) => {
      if (p.status === 'progress' || p.status === 'done') {
        onProgress({
          file: p.file,
          progress: typeof p.progress === 'number' ? p.progress : undefined,
          loadedBytes: typeof p.loaded === 'number' ? p.loaded : undefined,
          totalBytes: typeof p.total === 'number' ? p.total : undefined
        })
      }
    }
  })
  return dirSizeBytes(modelCacheDir(modelsDir, model.id))
}

function modelCacheDir(modelsDir: string, modelId: string): string {
  // xenova FileCache 以 <modelId>/<filename> 为键，模型 id 自带一层斜杠
  return join(modelsDir, ...modelId.split('/'))
}

export function createModelProvisionService(deps: ModelProvisionDeps) {
  const download = deps.downloadModel ?? ((m: PresetModelInfo, p: ModelDownloadProgress) => xenovaDownload(deps.modelsDir, m, p))
  let inflight: Promise<ModelListResult> | null = null

  function readRow(modelId: string): ModelAssetRow | undefined {
    return deps.db.prepare('SELECT * FROM model_assets WHERE model_id = ?').get(modelId) as
      | ModelAssetRow
      | undefined
  }

  function upsertRow(modelId: string, status: ModelAssetStatus, sizeBytes: number, error: string | null): void {
    deps.db
      .prepare(
        `INSERT INTO model_assets (model_id, status, dir, size_bytes, error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(model_id) DO UPDATE SET
           status = excluded.status,
           dir = excluded.dir,
           size_bytes = excluded.size_bytes,
           error = excluded.error,
           updated_at = excluded.updated_at`
      )
      .run(modelId, status, modelCacheDir(deps.modelsDir, modelId), sizeBytes, error, Date.now())
  }

  /** 缓存完整性：清单内文件全部存在即视为已缓存（不做哈希，下载半截的文件由 xenova 自行覆盖重下） */
  function isModelCached(modelId: string): boolean {
    const model = PRESET_MODELS.find((m) => m.id === modelId)
    if (!model) return false
    const dir = modelCacheDir(deps.modelsDir, modelId)
    return model.requiredFiles.every((f) => existsSync(join(dir, f)))
  }

  /**
   * 离线种子拷贝：安装包内 bundle 的模型文件完整时复制进 xenova 缓存目录。
   * 成功返回 true；bundle 缺失/不完整/拷贝失败返回 false（调用方回退在线下载）。
   */
  function trySeedFromBundle(modelId: string): boolean {
    const model = PRESET_MODELS.find((m) => m.id === modelId)
    const bundledRoot = deps.bundledModelsDir?.()
    if (!model || !bundledRoot) return false
    const srcDir = join(bundledRoot, ...modelId.split('/'))
    if (!model.requiredFiles.every((f) => existsSync(join(srcDir, f)))) return false
    try {
      cpSync(srcDir, modelCacheDir(deps.modelsDir, modelId), { recursive: true })
    } catch {
      return false
    }
    return isModelCached(modelId)
  }

  function listModels(): ModelListResult {
    const models: ModelAssetDto[] = PRESET_MODELS.map((m) => {
      const row = readRow(m.id)
      const cached = isModelCached(m.id)
      // 文件系统为准：文件齐了即使 DB 记着 failed/missing 也算 ready；
      // 文件缺失时 downloading/failed 才可信（避免中途失败被误报为 ready）
      const status: ModelAssetStatus = cached
        ? 'ready'
        : row?.status === 'downloading' || row?.status === 'failed'
          ? row.status
          : 'missing'
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        estimatedSizeBytes: m.estimatedSizeBytes,
        status,
        cached,
        sizeBytes: row?.size_bytes ?? 0,
        error: cached ? null : (row?.error ?? null),
        updatedAt: row?.updated_at ?? 0
      }
    })
    return { models, kbBackend: null }
  }

  /**
   * 逐个预取未缓存模型；单模型失败记录 DB + 推送 failed 事件后继续，绝不 throw。
   * 并发调用共享同一在途 Promise，避免重复下载。
   */
  function prefetchAll(win?: ModelEventSink | null): Promise<ModelListResult> {
    if (inflight) return inflight
    const emit = (payload: ModelProvisionEvent): void => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send(MODEL_EVENT_CHANNEL, payload)
      } catch {
        /* 窗口已销毁等异常不影响下载 */
      }
    }
    inflight = (async () => {
      for (const model of PRESET_MODELS) {
        if (isModelCached(model.id)) {
          upsertRow(model.id, 'ready', dirSizeBytes(modelCacheDir(deps.modelsDir, model.id)), null)
          continue
        }
        // A3 离线预置：安装包自带模型时种子拷贝，免首启下载（约百 MB 断点消除）
        if (trySeedFromBundle(model.id)) {
          const sizeBytes = dirSizeBytes(modelCacheDir(deps.modelsDir, model.id))
          upsertRow(model.id, 'ready', sizeBytes, null)
          emit({ modelId: model.id, status: 'done', progress: 100, totalBytes: sizeBytes })
          continue
        }
        upsertRow(model.id, 'downloading', 0, null)
        emit({ modelId: model.id, status: 'downloading', progress: 0 })
        try {
          const sizeBytes = await download(model, (p) =>
            emit({
              modelId: model.id,
              status: 'downloading',
              file: p.file,
              progress: p.progress,
              loadedBytes: p.loadedBytes,
              totalBytes: p.totalBytes
            })
          )
          upsertRow(model.id, 'ready', sizeBytes, null)
          emit({ modelId: model.id, status: 'done', progress: 100, totalBytes: sizeBytes })
        } catch (err) {
          const message = (err as Error).message
          upsertRow(model.id, 'failed', 0, message)
          emit({ modelId: model.id, status: 'failed', error: message })
        }
      }
      return listModels()
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  return { listModels, isModelCached, prefetchAll }
}

export type ModelProvisionService = ReturnType<typeof createModelProvisionService>
