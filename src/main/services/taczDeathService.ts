/**
 * TaCZ 死亡消息配置——主进程服务。
 *
 * 读写 config/taczdeathmessage/ 下两份 JSON：
 * - global_config.json
 * - world_config.json
 *
 * 策略：读取时把未知字段保留（写入 raw），保存时先重读旧文件再 merge，
 * 避免整合包作者在文件里手写的额外字段被编辑器覆盖丢失。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  TaczDeathReadResult,
  TaczGlobalConfig,
  TaczMessagePair,
  TaczMessages,
  TaczWorldConfig,
  TaczWorldsFile
} from '../../shared/types/taczdeath'
import { TACZ_DEFAULT_GLOBAL, TACZ_DEFAULT_WORLD } from '../../shared/types/taczdeath'

const CONFIG_DIR = ['config', 'taczdeathmessage'] as const
const GLOBAL_FILE = 'global_config.json'
const WORLD_FILE = 'world_config.json'

function globalPath(root: string): string {
  return join(root, ...CONFIG_DIR, GLOBAL_FILE)
}

function worldPath(root: string): string {
  return join(root, ...CONFIG_DIR, WORLD_FILE)
}

// ---------------------------------------------------------------------------
// 解析辅助
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v = obj[key]
  return typeof v === 'string' ? v : fallback
}

function bool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key]
  return typeof v === 'boolean' ? v : fallback
}

function parsePair(
  raw: unknown,
  fallback: TaczMessagePair
): TaczMessagePair {
  if (!isRecord(raw)) return { ...fallback }
  return {
    normal: str(raw, 'normal', fallback.normal),
    headshot: str(raw, 'headshot', fallback.headshot)
  }
}

function parseMessages(
  raw: unknown,
  fallback: TaczMessages
): TaczMessages {
  const rec = isRecord(raw) ? raw : {}
  return {
    player: parsePair(rec.player, fallback.player),
    animal: parsePair(rec.animal, fallback.animal)
  }
}

/** 解析 global_config.json，未知字段保留在 raw */
function parseGlobal(raw: Record<string, unknown>): TaczGlobalConfig {
  return {
    defaultWorldEnabled: bool(raw, 'defaultWorldEnabled', TACZ_DEFAULT_GLOBAL.defaultWorldEnabled),
    messages: parseMessages(raw.messages, TACZ_DEFAULT_GLOBAL.messages),
    headshotSuffix: str(raw, 'headshotSuffix', TACZ_DEFAULT_GLOBAL.headshotSuffix)
  }
}

/** 解析 world_config.json */
function parseWorlds(raw: Record<string, unknown>): TaczWorldsFile {
  const worldsRaw = isRecord(raw.worlds) ? raw.worlds : {}
  const worlds: Record<string, TaczWorldConfig> = {}
  for (const [dim, val] of Object.entries(worldsRaw)) {
    if (!isRecord(val)) continue
    worlds[dim] = {
      enabled: bool(val, 'enabled', true),
      messages: parseMessages(val.messages, TACZ_DEFAULT_WORLD.messages)
    }
  }
  return { worlds }
}

// ---------------------------------------------------------------------------
// 读取
// ---------------------------------------------------------------------------

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 读取两份配置；文件缺失或解析失败时回退默认值并标记 exists / error */
export function readTaczDeath(root: string): TaczDeathReadResult {
  const gp = globalPath(root)
  const wp = worldPath(root)

  const globalRaw = readJson(gp)
  const worldRaw = readJson(wp)

  let error: string | undefined
  if (existsSync(gp) && !globalRaw) error = 'global_config.json 解析失败，已回退默认值'
  if (existsSync(wp) && !worldRaw) {
    error = (error ? error + '；' : '') + 'world_config.json 解析失败，已回退默认值'
  }

  return {
    global: globalRaw ? parseGlobal(globalRaw) : { ...TACZ_DEFAULT_GLOBAL },
    worlds: worldRaw ? parseWorlds(worldRaw) : { worlds: {} },
    globalPath: gp,
    worldPath: wp,
    exists: { global: globalRaw !== null, world: worldRaw !== null },
    error
  }
}

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

/** 序列化 global：保留旧文件里的未知字段 */
function serializeGlobal(
  config: TaczGlobalConfig,
  previous: Record<string, unknown> | null
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(previous ?? {}) }
  base.defaultWorldEnabled = config.defaultWorldEnabled
  base.messages = {
    player: { normal: config.messages.player.normal, headshot: config.messages.player.headshot },
    animal: { normal: config.messages.animal.normal, headshot: config.messages.animal.headshot }
  }
  if (config.headshotSuffix) base.headshotSuffix = config.headshotSuffix
  else delete base.headshotSuffix
  return base
}

/** 序列化 worlds：保留每个世界旧配置里的未知字段 */
function serializeWorlds(
  file: TaczWorldsFile,
  previous: Record<string, unknown> | null
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(previous ?? {}) }
  const prevWorlds = isRecord(previous?.worlds) ? (previous!.worlds as Record<string, unknown>) : {}
  const out: Record<string, unknown> = {}
  for (const [dim, cfg] of Object.entries(file.worlds)) {
    const prevEntry = isRecord(prevWorlds[dim]) ? (prevWorlds[dim] as Record<string, unknown>) : {}
    out[dim] = {
      ...prevEntry,
      enabled: cfg.enabled,
      messages: {
        player: { normal: cfg.messages.player.normal, headshot: cfg.messages.player.headshot },
        animal: { normal: cfg.messages.animal.normal, headshot: cfg.messages.animal.headshot }
      }
    }
  }
  base.worlds = out
  return base
}

/** 保存两份配置；自动创建目录；保留旧文件未知字段 */
export function saveTaczDeath(
  root: string,
  global: TaczGlobalConfig,
  worlds: TaczWorldsFile
): { ok: true; globalPath: string; worldPath: string } | { ok: false; error: string } {
  const gp = globalPath(root)
  const wp = worldPath(root)
  try {
    mkdirSync(dirname(gp), { recursive: true })
    writeFileSync(gp, JSON.stringify(serializeGlobal(global, readJson(gp)), null, 2), 'utf-8')
    writeFileSync(wp, JSON.stringify(serializeWorlds(worlds, readJson(wp)), null, 2), 'utf-8')
  } catch (err) {
    return { ok: false, error: `写入失败: ${(err as Error).message}` }
  }
  return { ok: true, globalPath: gp, worldPath: wp }
}
