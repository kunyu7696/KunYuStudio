import { existsSync } from 'node:fs'
import { pixelsToPng } from '../modelCompiler'
import { resolveBlockPattern, synthesizeBlockTexture } from '../../templates/textureSynthesizer'
import { statEntry } from '../fsService'
import { readJson } from './context'
import type { GenSink } from './sink'

export function blockstateJson(modId: string, id: string): string {
  return JSON.stringify({ variants: { '': { model: `${modId}:block/${id}` } } }, null, 2)
}

export function blockModelJson(textureRef: string): string {
  return JSON.stringify({ parent: 'block/cube_all', textures: { all: textureRef } }, null, 2)
}

export function blockItemModelJson(modId: string, id: string): string {
  return JSON.stringify({ parent: `${modId}:block/${id}` }, null, 2)
}

export function itemModelJson(parent: string, textureRef: string): string {
  return JSON.stringify(
    { parent, textures: { layer0: textureRef } },
    null,
    2
  )
}

/**
 * customTexture/texture.path 指定的
 * 贴图若磁盘不存在，模型引用悬空 → 游戏内紫黑方块（构建全绿的静默失败）。
 * 生成阶段就地补一张 16×16 程序化占位 PNG（按内容色合成），保证引用永不悬空。
 */
export function ensureTexturePng(sink: GenSink, absTexPath: string, id: string, color: string): void {
  if (existsSync(absTexPath)) return
  sink.bin(absTexPath, pixelsToPng(synthesizeBlockTexture(color, resolveBlockPattern(id)), 16))
}

export function lootTableJson(modId: string, id: string): string {
  return JSON.stringify(
    {
      type: 'minecraft:block',
      pools: [
        {
          rolls: 1,
          bonus_rolls: 0,
          entries: [{ type: 'minecraft:item', name: `${modId}:${id}` }],
          conditions: [{ condition: 'minecraft:survives_explosion' }]
        }
      ]
    },
    null,
    2
  )
}

/**
 * 同步标签 JSON：移除上一轮由本工具托管的旧条目，写入本轮条目，
 * 保留用户手工添加的其它值。合并后为空且文件仅由本工具创建时删除文件。
 * @returns 是否删除了该文件
 */
export function syncTagFile(path: string, newEntries: string[], oldManaged: string[], sink: GenSink): boolean {
  let existing: string[] = []
  const node = statEntry(path)
  if (node) {
    try {
      const parsed = readJson(path) as { values?: unknown }
      if (Array.isArray(parsed.values)) {
        existing = parsed.values.filter((v): v is string => typeof v === 'string')
      }
    } catch {
      existing = []
    }
  }
  const oldSet = new Set(oldManaged)
  const kept = existing.filter((v) => !oldSet.has(v))
  const merged = [...new Set([...kept, ...newEntries])].sort()
  if (merged.length === 0) {
    if (node) sink.remove(path)
    return true
  }
  sink.text(path, JSON.stringify({ replace: false, values: merged }, null, 2))
  return false
}

/**
 * 同步语言文件：移除上一轮托管键，写入本轮键；
 * 首次生成时额外清理模板 example_block 占位键。保留其它非托管键。
 */
export function syncLangFile(
  path: string,
  newKeys: Record<string, string>,
  oldManagedKeys: string[],
  extraRemoveKeys: string[],
  sink: GenSink
): void {
  const parsed: Record<string, string> = {}
  const node = statEntry(path)
  if (node) {
    try {
      Object.assign(parsed, readJson(path) as Record<string, string>)
    } catch {
      /* 语言文件损坏时以托管内容重建 */
    }
  }
  for (const k of oldManagedKeys) delete parsed[k]
  for (const k of extraRemoveKeys) delete parsed[k]
  Object.assign(parsed, newKeys)
  sink.text(path, JSON.stringify(parsed, null, 2) + '\n')
}
