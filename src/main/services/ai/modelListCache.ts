/**
 * 提供商模型列表缓存。
 *
 * 设置页进入时自动拉取模型列表，避免每次都打厂商端口；默认 24 小时内的结果
 * 直接复用，用户点「刷新」时 force 绕过缓存。缓存落盘在 userData/ai/ 下，
 * 重启应用后仍保留最后同步结果。
 *
 * 本模块不依赖 Electron（路径由调用方注入），便于单测。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 缓存有效期：24 小时 */
export const MODEL_LIST_TTL_MS = 24 * 60 * 60 * 1000

export interface ModelListCacheEntry {
  models: string[]
  /** 写入时间（epoch ms） */
  fetchedAt: number
}

type CacheFile = Record<string, ModelListCacheEntry>

function readCache(path: string): CacheFile {
  try {
    if (!existsSync(path)) return {}
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const out: CacheFile = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const entry = value as { models?: unknown; fetchedAt?: unknown }
      if (Array.isArray(entry?.models) && typeof entry.fetchedAt === 'number') {
        out[key] = {
          models: entry.models.filter((m): m is string => typeof m === 'string'),
          fetchedAt: entry.fetchedAt
        }
      }
    }
    return out
  } catch {
    // 缓存损坏按空处理，不阻断主流程
    return {}
  }
}

function writeCache(path: string, data: CacheFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(data), 'utf-8')
  } catch {
    // 缓存写入失败不影响模型列表返回
  }
}

export interface ModelListCache {
  /** 读取有效缓存；过期/不存在返回 null */
  read(providerId: string): ModelListCacheEntry | null
  /** 写入最新结果并返回落盘条目 */
  write(providerId: string, models: string[]): ModelListCacheEntry
}

export function createModelListCache(deps: {
  path: string
  ttlMs?: number
  now?: () => number
}): ModelListCache {
  const ttlMs = deps.ttlMs ?? MODEL_LIST_TTL_MS
  const now = deps.now ?? Date.now
  return {
    read(providerId) {
      const entry = readCache(deps.path)[providerId]
      if (!entry) return null
      if (now() - entry.fetchedAt > ttlMs) return null
      return entry
    },
    write(providerId, models) {
      const cache = readCache(deps.path)
      const entry: ModelListCacheEntry = { models: [...models], fetchedAt: now() }
      cache[providerId] = entry
      writeCache(deps.path, cache)
      return entry
    }
  }
}
