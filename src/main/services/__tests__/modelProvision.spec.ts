/**
 * A3 离线模型预置流水线单测：
 * 清单完整性 / isModelCached 真假分支 / prefetch 成功与失败降级（不抛出）/ DB 状态落库。
 * 不触发真实下载：downloadModel 一律注入 mock，modelsDir 用临时目录。
 */
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate } from '../db'
import {
  MODEL_EVENT_CHANNEL,
  PRESET_MODELS,
  createModelProvisionService,
  type ModelProvisionDeps,
  type ModelEventSink
} from '../modelProvisionService'
import type { ModelProvisionEvent } from '../../../shared/types/models'

let db: Database.Database
let modelsDir: string
let events: Array<{ channel: string; payload: ModelProvisionEvent }>

const sink: ModelEventSink = {
  isDestroyed: () => false,
  webContents: {
    send: (channel, payload) => {
      events.push({ channel, payload })
    }
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  modelsDir = mkdtempSync(join(tmpdir(), 'kunyu-models-'))
  events = []
})

afterEach(() => {
  db.close()
  rmSync(modelsDir, { recursive: true, force: true })
})

function makeService(downloadModel?: ModelProvisionDeps['downloadModel']) {
  return createModelProvisionService({ modelsDir, db, downloadModel })
}

/** 在临时 modelsDir 里伪造某模型的完整缓存文件 */
function fakeCachedModel(modelId: string): void {
  const model = PRESET_MODELS.find((m) => m.id === modelId)!
  for (const rel of model.requiredFiles) {
    const abs = join(modelsDir, ...modelId.split('/'), ...rel.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, '{}', 'utf-8')
  }
}

const BGE_ID = 'Xenova/bge-small-zh-v1.5'

describe('PRESET_MODELS 清单', () => {
  it('至少包含 bge-small-zh-v1.5，且字段完整、requiredFiles 非空', () => {
    const ids = PRESET_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    const bge = PRESET_MODELS.find((m) => m.id === BGE_ID)
    expect(bge).toBeDefined()
    expect(bge!.name.length).toBeGreaterThan(0)
    expect(bge!.description.length).toBeGreaterThan(0)
    expect(bge!.estimatedSizeBytes).toBeGreaterThan(0)
    expect(bge!.requiredFiles.length).toBeGreaterThan(0)
    // quantized 管线必需的 onnx 权重必须在清单内
    expect(bge!.requiredFiles.some((f) => f.endsWith('.onnx'))).toBe(true)
  })
})

describe('isModelCached', () => {
  it('空目录 → false；补齐清单文件 → true；未知模型 → false', () => {
    const svc = makeService()
    expect(svc.isModelCached(BGE_ID)).toBe(false)
    expect(svc.isModelCached('no/such-model')).toBe(false)

    fakeCachedModel(BGE_ID)
    expect(svc.isModelCached(BGE_ID)).toBe(true)
  })

  it('清单文件缺一 → false（存在性校验按完整清单）', () => {
    const svc = makeService()
    const model = PRESET_MODELS.find((m) => m.id === BGE_ID)!
    // 只写第一个文件
    const first = join(modelsDir, ...BGE_ID.split('/'), model.requiredFiles[0]!)
    mkdirSync(dirname(first), { recursive: true })
    writeFileSync(first, '{}', 'utf-8')
    expect(svc.isModelCached(BGE_ID)).toBe(false)
  })
})

describe('prefetchAll', () => {
  it('成功：推送 downloading→done，DB 落 ready + size_bytes，列表 cached=true', async () => {
    const download = vi.fn(async (model: { id: string }, onProgress: (p: { progress?: number }) => void) => {
      onProgress({ progress: 40 })
      fakeCachedModel(model.id)
      return 12345
    })
    const svc = makeService(download)

    const result = await svc.prefetchAll(sink)

    expect(download).toHaveBeenCalledTimes(1)
    const statuses = events.filter((e) => e.channel === MODEL_EVENT_CHANNEL).map((e) => e.payload.status)
    expect(statuses[0]).toBe('downloading')
    expect(statuses[statuses.length - 1]).toBe('done')

    const row = db.prepare('SELECT * FROM model_assets WHERE model_id = ?').get(BGE_ID) as {
      status: string
      size_bytes: number
      error: string | null
    }
    expect(row.status).toBe('ready')
    expect(row.size_bytes).toBe(12345)
    expect(row.error).toBeNull()

    const item = result.models.find((m) => m.id === BGE_ID)!
    expect(item.status).toBe('ready')
    expect(item.cached).toBe(true)
  })

  it('失败：不抛出，推送 failed，DB 落 failed + error', async () => {
    const download = vi.fn(async () => {
      throw new Error('network unreachable')
    })
    const svc = makeService(download)

    const result = await svc.prefetchAll(sink) // 不 reject 即通过

    const failedEvent = events.find((e) => e.payload.status === 'failed')
    expect(failedEvent?.payload.error).toContain('network unreachable')

    const row = db.prepare('SELECT * FROM model_assets WHERE model_id = ?').get(BGE_ID) as {
      status: string
      error: string | null
    }
    expect(row.status).toBe('failed')
    expect(row.error).toContain('network unreachable')

    const item = result.models.find((m) => m.id === BGE_ID)!
    expect(item.status).toBe('failed')
    expect(item.cached).toBe(false)
    expect(item.error).toContain('network unreachable')
  })

  it('已缓存模型跳过下载，直接落 ready', async () => {
    fakeCachedModel(BGE_ID)
    const download = vi.fn()
    const svc = makeService(download)

    const result = await svc.prefetchAll(sink)

    expect(download).not.toHaveBeenCalled()
    const row = db.prepare('SELECT status FROM model_assets WHERE model_id = ?').get(BGE_ID) as {
      status: string
    }
    expect(row.status).toBe('ready')
    expect(result.models.find((m) => m.id === BGE_ID)!.status).toBe('ready')
  })

  it('并发调用共享同一在途 Promise（不重复下载）', async () => {
    let resolveDownload: (() => void) | null = null
    const download = vi.fn(
      () =>
        new Promise<number>((res) => {
          resolveDownload = () => res(1)
        })
    )
    const svc = makeService(download)

    const p1 = svc.prefetchAll(sink)
    const p2 = svc.prefetchAll(sink)
    resolveDownload!()
    await Promise.all([p1, p2])

    expect(download).toHaveBeenCalledTimes(1)
  })

  it('文件系统为准：文件齐全但 DB 记 failed 时，列表仍报 ready', async () => {
    fakeCachedModel(BGE_ID)
    db.prepare(
      "INSERT INTO model_assets (model_id, status, dir, size_bytes, error, updated_at) VALUES (?, 'failed', '', 0, '旧错误', 1)"
    ).run(BGE_ID)

    const svc = makeService()
    const item = svc.listModels().models.find((m) => m.id === BGE_ID)!
    expect(item.status).toBe('ready')
    expect(item.error).toBeNull()
  })

  it('sink 为 null 时静默运行（后台启动预取路径）', async () => {
    const download = vi.fn(async (model: { id: string }) => {
      fakeCachedModel(model.id)
      return 1
    })
    const svc = makeService(download)
    const result = await svc.prefetchAll(null)
    expect(result.models.find((m) => m.id === BGE_ID)!.status).toBe('ready')
  })
})

describe('离线种子拷贝（bundledModelsDir）', () => {
  let bundledDir: string

  beforeEach(() => {
    bundledDir = mkdtempSync(join(tmpdir(), 'kunyu-bundled-'))
  })

  afterEach(() => {
    rmSync(bundledDir, { recursive: true, force: true })
  })

  /** 在 bundle 目录伪造完整模型（结构与 modelsDir 相同：<modelId>/<file>） */
  function fakeBundledModel(modelId: string): void {
    const model = PRESET_MODELS.find((m) => m.id === modelId)!
    for (const rel of model.requiredFiles) {
      const abs = join(bundledDir, ...modelId.split('/'), ...rel.split('/'))
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, '{}', 'utf-8')
    }
  }

  it('bundle 完整时免下载直接 ready，推送 done 事件', async () => {
    fakeBundledModel(BGE_ID)
    const download = vi.fn()
    const svc = createModelProvisionService({
      modelsDir,
      db,
      downloadModel: download,
      bundledModelsDir: () => bundledDir
    })

    const result = await svc.prefetchAll(sink)

    expect(download).not.toHaveBeenCalled()
    expect(svc.isModelCached(BGE_ID)).toBe(true)
    const row = db.prepare('SELECT status FROM model_assets WHERE model_id = ?').get(BGE_ID) as {
      status: string
    }
    expect(row.status).toBe('ready')
    const doneEvent = events.find((e) => e.payload.status === 'done')
    expect(doneEvent).toBeDefined()
    expect(result.models.find((m) => m.id === BGE_ID)!.status).toBe('ready')
  })

  it('bundle 缺失或不完整时回退在线下载', async () => {
    // 只写 bundle 的一半文件（不完整）
    const model = PRESET_MODELS.find((m) => m.id === BGE_ID)!
    const first = join(bundledDir, ...BGE_ID.split('/'), model.requiredFiles[0]!)
    mkdirSync(dirname(first), { recursive: true })
    writeFileSync(first, '{}', 'utf-8')

    const download = vi.fn(async (m: { id: string }) => {
      fakeCachedModel(m.id)
      return 42
    })
    const svc = createModelProvisionService({
      modelsDir,
      db,
      downloadModel: download,
      bundledModelsDir: () => bundledDir
    })

    const result = await svc.prefetchAll(sink)

    expect(download).toHaveBeenCalledTimes(1)
    expect(result.models.find((m) => m.id === BGE_ID)!.status).toBe('ready')
  })

  it('bundledModelsDir 返回 null 时跳过种子（打包缺省路径）', async () => {
    const download = vi.fn(async (m: { id: string }) => {
      fakeCachedModel(m.id)
      return 1
    })
    const svc = createModelProvisionService({
      modelsDir,
      db,
      downloadModel: download,
      bundledModelsDir: () => null
    })

    await svc.prefetchAll(sink)
    expect(download).toHaveBeenCalledTimes(1)
  })
})
