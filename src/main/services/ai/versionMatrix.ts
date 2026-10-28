/**
 * 版本指纹库与监测状态持久化（M7 Task 4，PDF p445-446 / monitor v4.0）。
 *
 * 33 个组合指纹（17 既有 + V-01 新增 1.21.4/1.21.5 四个 + V-02 新增 1.21.6~1.21.11
 * 十二个待验证组合）以参考包 manifest.versionFingerprints 为唯一来源；
 * 本模块负责：版本比较纯函数、MC→NeoForge 版本线映射、userData 监测状态
 * （上次检查时间 / 漂移事件）读写。组合灯色仍由 referencePackageService
 * overlay 管理，避免双写不一致。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DriftEvent } from '../../../shared/types/monitor'

/** MC 版本 → NeoForge 版本线（NeoForge 用 20.x/21.x 独立编号，26.x 起跟随 MC 年份版本线） */
const NEOFORGE_LINES: Record<string, string> = {
  '1.20.2': '20.2',
  '1.20.3': '20.3',
  '1.20.4': '20.4',
  '1.20.5': '20.5',
  '1.20.6': '20.6',
  '1.21': '21.0',
  '1.21.1': '21.1',
  '1.21.3': '21.3',
  '1.21.4': '21.4',
  '1.21.5': '21.5',
  // 补缺失版本线（上游 maven 各线均持续发版）
  '1.21.6': '21.6',
  '1.21.7': '21.7',
  '1.21.9': '21.9',
  '1.21.8': '21.8',
  '1.21.10': '21.10',
  '1.21.11': '21.11',
  '26.1': '26.1',
  '26.2': '26.2',
  '26.3': '26.3'
}

export function neoforgeLineFor(mcVersion: string): string | null {
  return NEOFORGE_LINES[mcVersion] ?? null
}

interface SemVerParts {
  nums: number[]
  pre: string | null
}

function parseSemVer(v: string): SemVerParts {
  const trimmed = v.trim()
  const dash = trimmed.indexOf('-')
  const core = dash === -1 ? trimmed : trimmed.slice(0, dash)
  const pre = dash === -1 ? null : trimmed.slice(dash + 1)
  const nums = core.split('.').map((x) => {
    const n = Number.parseInt(x, 10)
    return Number.isFinite(n) ? n : 0
  })
  return { nums, pre }
}

/**
 * 语义化版本比较（支持加载器版本：0.19.5 / 47.4.23 / 21.3.0-beta）。
 * 返回 1 表示 a>b，-1 表示 a<b，0 相等；带预发布后缀的同号版本低于正式版。
 */
export function compareVersions(a: string, b: string): 1 | -1 | 0 {
  const pa = parseSemVer(a)
  const pb = parseSemVer(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i += 1) {
    const x = pa.nums[i] ?? 0
    const y = pb.nums[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === null) return 1 // 正式版 > 预发布
  if (pb.pre === null) return -1
  return pa.pre > pb.pre ? 1 : -1
}

/** MC 版本比较（1.21.1 > 1.20.6 这类纯数字点分） */
export function compareMcVersions(a: string, b: string): 1 | -1 | 0 {
  const na = a.split('.').map((x) => Number.parseInt(x, 10) || 0)
  const nb = b.split('.').map((x) => Number.parseInt(x, 10) || 0)
  const len = Math.max(na.length, nb.length)
  for (let i = 0; i < len; i += 1) {
    const x = na[i] ?? 0
    const y = nb[i] ?? 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/* ------------------------- 监测状态 userData 持久化 ------------------------- */

export interface MonitorPersist {
  version: 1
  lastCheckAt: string | null
  /** 最近一次见到的 Minecraft 正式版（全局新 MC 事件去重用） */
  lastSeenMcRelease: string | null
  events: DriftEvent[]
}

const EMPTY_STATE: MonitorPersist = {
  version: 1,
  lastCheckAt: null,
  lastSeenMcRelease: null,
  events: []
}

/** 漂移事件上限（仅保留最近 100 条，防无限增长） */
export const MAX_DRIFT_EVENTS = 100

export function loadMonitorState(path: string): MonitorPersist {
  if (!existsSync(path)) return structuredClone(EMPTY_STATE)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>)['version'] !== 1) {
      return structuredClone(EMPTY_STATE)
    }
    const r = raw as Record<string, unknown>
    const events = Array.isArray(r['events'])
      ? (r['events'] as DriftEvent[]).filter(
          (e) => e && typeof e.id === 'string' && typeof e.at === 'string'
        )
      : []
    return {
      version: 1,
      lastCheckAt: typeof r['lastCheckAt'] === 'string' ? r['lastCheckAt'] : null,
      lastSeenMcRelease:
        typeof r['lastSeenMcRelease'] === 'string' ? r['lastSeenMcRelease'] : null,
      events: events.slice(-MAX_DRIFT_EVENTS)
    }
  } catch {
    return structuredClone(EMPTY_STATE)
  }
}

export function saveMonitorState(path: string, state: MonitorPersist): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, path)
}

/** 生成漂移事件 id（时间 + 计数器，碰撞可忽略） */
export function nextDriftId(nowIso: string, seq: number): string {
  return `drift-${Date.parse(nowIso) || Date.now()}-${seq}`
}
