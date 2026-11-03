import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readTaczDeath, saveTaczDeath } from '../taczDeathService'
import { TACZ_DEFAULT_GLOBAL, TACZ_DEFAULT_WORLD } from '../../../shared/types/taczdeath'
import type { TaczGlobalConfig, TaczWorldsFile } from '../../../shared/types/taczdeath'

const TMP_DIRS: string[] = []

function tmpRoot(): string {
  const d = mkdtempSync(join(process.cwd(), '.tacz-test-'))
  TMP_DIRS.push(d)
  return d
}

afterEach(() => {
  for (const d of TMP_DIRS) if (existsSync(d)) rmSync(d, { recursive: true, force: true })
  TMP_DIRS.length = 0
})

function configDir(root: string): string {
  return join(root, 'config', 'taczdeathmessage')
}

describe('taczDeathService', () => {
  describe('readTaczDeath', () => {
    it('两份文件都不存在时返回默认值 + exists 全 false', () => {
      const root = tmpRoot()
      const res = readTaczDeath(root)
      expect(res.exists.global).toBe(false)
      expect(res.exists.world).toBe(false)
      expect(res.global).toEqual(TACZ_DEFAULT_GLOBAL)
      expect(res.worlds).toEqual({ worlds: {} })
      expect(res.globalPath).toBe(join(configDir(root), 'global_config.json'))
      expect(res.worldPath).toBe(join(configDir(root), 'world_config.json'))
      expect(res.error).toBeUndefined()
    })

    it('读取真实格式的 global_config.json', () => {
      const root = tmpRoot()
      mkdirSync(configDir(root), { recursive: true })
      writeFileSync(
        join(configDir(root), 'global_config.json'),
        JSON.stringify({
          defaultWorldEnabled: false,
          messages: {
            player: { normal: '&e{killer} 击杀 {victim}', headshot: '&c爆头' },
            animal: { normal: '&e{killer} 猎杀 {victim}（{gun}）', headshot: '&c精准猎杀' }
          },
          headshotSuffix: '（Headshot）'
        })
      )
      const res = readTaczDeath(root)
      expect(res.exists.global).toBe(true)
      expect(res.exists.world).toBe(false)
      expect(res.global.defaultWorldEnabled).toBe(false)
      expect(res.global.messages.player.normal).toBe('&e{killer} 击杀 {victim}')
      expect(res.global.messages.animal.headshot).toBe('&c精准猎杀')
      expect(res.global.headshotSuffix).toBe('（Headshot）')
    })

    it('读取 world_config.json 多个维度', () => {
      const root = tmpRoot()
      mkdirSync(configDir(root), { recursive: true })
      writeFileSync(
        join(configDir(root), 'world_config.json'),
        JSON.stringify({
          worlds: {
            'minecraft:overworld': {
              enabled: true,
              messages: {
                player: { normal: '&a[PvP] &e{killer} 击败 {victim}', headshot: '&a[PvP] 爆头' }
              }
            },
            'minecraft:the_nether': { enabled: false }
          }
        })
      )
      const res = readTaczDeath(root)
      expect(Object.keys(res.worlds.worlds)).toEqual([
        'minecraft:overworld',
        'minecraft:the_nether'
      ])
      expect(res.worlds.worlds['minecraft:overworld'].enabled).toBe(true)
      expect(res.worlds.worlds['minecraft:overworld'].messages.player.normal).toBe(
        '&a[PvP] &e{killer} 击败 {victim}'
      )
      // the_nether 缺 messages → 用默认模板补齐
      expect(res.worlds.worlds['minecraft:the_nether'].enabled).toBe(false)
      expect(res.worlds.worlds['minecraft:the_nether'].messages.animal.normal).toBe(
        TACZ_DEFAULT_WORLD.messages.animal.normal
      )
    })

    it('JSON 损坏时回退默认值并带 error', () => {
      const root = tmpRoot()
      mkdirSync(configDir(root), { recursive: true })
      writeFileSync(join(configDir(root), 'global_config.json'), '{not valid json')
      const res = readTaczDeath(root)
      expect(res.error).toContain('global_config.json')
      expect(res.global).toEqual(TACZ_DEFAULT_GLOBAL)
      expect(res.exists.global).toBe(false)
    })
  })

  describe('saveTaczDeath', () => {
    it('写入两份文件并自动创建目录', () => {
      const root = tmpRoot()
      const global: TaczGlobalConfig = structuredClone(TACZ_DEFAULT_GLOBAL)
      const worlds: TaczWorldsFile = {
        worlds: { 'minecraft:overworld': structuredClone(TACZ_DEFAULT_WORLD) }
      }
      const res = saveTaczDeath(root, global, worlds)
      expect(res.ok).toBe(true)
      if (!res.ok) return
      expect(existsSync(res.globalPath)).toBe(true)
      expect(existsSync(res.worldPath)).toBe(true)

      const roundTrip = readTaczDeath(root)
      expect(roundTrip.exists.global).toBe(true)
      expect(roundTrip.exists.world).toBe(true)
      expect(roundTrip.worlds.worlds['minecraft:overworld'].enabled).toBe(true)
    })

    it('保留旧文件里的未知字段（global 与 world 各一处）', () => {
      const root = tmpRoot()
      mkdirSync(configDir(root), { recursive: true })
      writeFileSync(
        join(configDir(root), 'global_config.json'),
        JSON.stringify({
          defaultWorldEnabled: true,
          customFlag: 'keep-me',
          messages: {
            player: { normal: 'a', headshot: 'b' },
            animal: { normal: 'c', headshot: 'd' }
          }
        })
      )
      writeFileSync(
        join(configDir(root), 'world_config.json'),
        JSON.stringify({
          worlds: {
            'minecraft:overworld': {
              enabled: true,
              extraField: 42,
              messages: {
                player: { normal: 'x', headshot: 'y' },
                animal: { normal: 'z', headshot: 'w' }
              }
            }
          }
        })
      )

      const global = structuredClone(TACZ_DEFAULT_GLOBAL)
      global.headshotSuffix = '自定义后缀'
      const worlds: TaczWorldsFile = {
        worlds: { 'minecraft:overworld': structuredClone(TACZ_DEFAULT_WORLD) }
      }
      const res = saveTaczDeath(root, global, worlds)
      expect(res.ok).toBe(true)

      const savedGlobal = JSON.parse(
        readFileSync(join(configDir(root), 'global_config.json'), 'utf-8')
      ) as Record<string, unknown>
      expect(savedGlobal.customFlag).toBe('keep-me')
      expect(savedGlobal.headshotSuffix).toBe('自定义后缀')

      const savedWorld = JSON.parse(
        readFileSync(join(configDir(root), 'world_config.json'), 'utf-8')
      ) as Record<string, unknown>
      const overworld = (savedWorld.worlds as Record<string, Record<string, unknown>>)[
        'minecraft:overworld'
      ]
      expect(overworld.extraField).toBe(42)
    })

    it('headshotSuffix 为空时从 JSON 中删除该键', () => {
      const root = tmpRoot()
      const global = structuredClone(TACZ_DEFAULT_GLOBAL)
      global.headshotSuffix = ''
      const res = saveTaczDeath(root, global, { worlds: {} })
      expect(res.ok).toBe(true)
      const saved = JSON.parse(
        readFileSync(join(configDir(root), 'global_config.json'), 'utf-8')
      ) as Record<string, unknown>
      expect('headshotSuffix' in saved).toBe(false)
    })
  })
})
