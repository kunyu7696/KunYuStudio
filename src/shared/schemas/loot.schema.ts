/**
 * 战利品表语义 Schema（统一编辑器 P2.3）。
 *
 * 与加载器/版本无关的可视化编辑模型，编译后产出原版
 * data/<ns>/loot_tables/*.json。方块/实体/宝箱三类共用：
 * - block：type=minecraft:block，池条件 survives_explosion
 * - entity/chest：不写 type 与 survives_explosion（原版实体/箱子表惯例）
 *
 * 设计边界（P2.3）：覆盖最常用形态——多池、每池多次抽取（固定/区间）、
 * 物品掉落数量（固定/区间）、同池权重、概率掉落。暂不含空表引用、
 * 标签掉落、战利品注入函数（时运/抢夺）等高级能力。
 */
import { sharedT } from '../i18n'

/** 固定数值 */
export interface LootNumberFixed {
  kind: 'fixed'
  value: number
}
/** 均匀随机区间（对应原版 min/max） */
export interface LootNumberRange {
  kind: 'range'
  min: number
  max: number
}
export type LootNumber = LootNumberFixed | LootNumberRange

/** 池内单条掉落物 */
export interface LootEntryDef {
  /** 物品 id：含命名空间（minecraft:diamond）原样使用；不含则由调用方补当前模组命名空间 */
  item: string
  /** 单次掉落数量（固定或区间，对应 set_count 函数） */
  count: LootNumber
  /** 同池权重（>1 时按权重随机择一），默认 1 */
  weight: number
  /** 触发概率 0~1：<1 时加 random_chance 条件；1 = 必定 */
  chance: number
}

/** 一个掉落池 */
export interface LootPoolDef {
  /** 抽取次数（固定或区间） */
  rolls: LootNumber
  entries: LootEntryDef[]
}

/** 战利品表定义（语义层） */
export interface LootTableDef {
  type: 'block' | 'entity' | 'chest'
  pools: LootPoolDef[]
}

/* ---------------- 工厂 ---------------- */

/** 固定数值便捷构造 */
export function lootFixed(value: number): LootNumberFixed {
  return { kind: 'fixed', value }
}

/** 默认"掉落自身 1 个"的方块战利品表（等价旧 dropsSelf 自动产物） */
export function createDefaultBlockLoot(selfId: string): LootTableDef {
  return {
    type: 'block',
    pools: [
      {
        rolls: lootFixed(1),
        entries: [
          { item: selfId, count: lootFixed(1), weight: 1, chance: 1 }
        ]
      }
    ]
  }
}

/** 空战利品表（一个空池，供 UI 起步） */
export function createEmptyLoot(type: LootTableDef['type']): LootTableDef {
  return { type, pools: [{ rolls: lootFixed(1), entries: [] }] }
}

/* ---------------- 编译到原版 JSON ---------------- */

function compileNumber(n: LootNumber): number | { min: number; max: number } {
  if (n.kind === 'fixed') return Math.max(0, Math.floor(n.value))
  const min = Math.max(0, Math.floor(n.min))
  const max = Math.max(min, Math.floor(n.max))
  return { min, max }
}

function compileEntry(e: LootEntryDef, namespace: string): Record<string, unknown> {
  const name = e.item.includes(':') ? e.item : `${namespace}:${e.item}`
  const out: Record<string, unknown> = {
    type: 'minecraft:item',
    name
  }
  if (e.weight !== 1) out.weight = Math.max(1, Math.floor(e.weight))

  const functions: Record<string, unknown>[] = []
  // 数量：固定且为 1 时省略 set_count；否则写函数
  if (!(e.count.kind === 'fixed' && e.count.value === 1)) {
    functions.push({ function: 'minecraft:set_count', count: compileNumber(e.count) })
  }
  if (functions.length) out.functions = functions

  const conditions: Record<string, unknown>[] = []
  const chance = Math.min(1, Math.max(0, e.chance))
  if (chance < 1) {
    conditions.push({ condition: 'minecraft:random_chance', chance: Number(chance.toFixed(4)) })
  }
  if (conditions.length) out.conditions = conditions

  return out
}

/**
 * 编译为原版战利品表 JSON 对象。
 * @param def      语义定义
 * @param namespace 不含命名空间的物品 id 补此前缀（通常为 mod id）
 */
export function compileLootTable(
  def: LootTableDef,
  namespace: string
): Record<string, unknown> {
  const pools = def.pools
    .filter((p) => p.entries.length > 0)
    .map((p) => {
      const pool: Record<string, unknown> = {
        rolls: compileNumber(p.rolls),
        bonus_rolls: 0,
        entries: p.entries.map((e) => compileEntry(e, namespace))
      }
      if (def.type === 'block') {
        pool.conditions = [{ condition: 'minecraft:survives_explosion' }]
      }
      return pool
    })

  const root: Record<string, unknown> = { pools }
  if (def.type === 'block') root.type = 'minecraft:block'
  return root
}

/* ---------------- 校验 ---------------- */

/** 轻量校验，返回首条错误信息；合法返回 null */
export function validateLootTable(def: LootTableDef): string | null {
  if (!Array.isArray(def.pools) || def.pools.length === 0) {
    return sharedT('schema.loot.errPoolsRequired')
  }
  for (const [pi, p] of def.pools.entries()) {
    if (p.rolls.kind === 'range' && p.rolls.max < p.rolls.min) {
      return sharedT('schema.loot.errRollsRange', { pool: pi + 1 })
    }
    if (p.entries.length === 0) {
      return sharedT('schema.loot.errEntriesRequired', { pool: pi + 1 })
    }
    for (const [ei, e] of p.entries.entries()) {
      if (!e.item.trim()) {
        return sharedT('schema.loot.errEntryIdRequired', { pool: pi + 1, entry: ei + 1 })
      }
      if (e.count.kind === 'range' && e.count.max < e.count.min) {
        return sharedT('schema.loot.errCountRange', { pool: pi + 1, item: e.item })
      }
      if (e.chance < 0 || e.chance > 1) {
        return sharedT('schema.loot.errChanceRange', { pool: pi + 1, item: e.item })
      }
    }
  }
  return null
}
