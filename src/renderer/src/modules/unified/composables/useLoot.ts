/**
 * useLoot：战利品表可视化编辑。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed } from 'vue'
import { useUnifiedStore } from '../../../stores/unified'
import { t } from '../../../i18n'
import {
  createDefaultBlockLoot,
  createEmptyLoot,
  lootFixed
} from '../../../../../shared/schemas/loot.schema'
import type {
  LootEntryDef,
  LootPoolDef,
  LootTableDef
} from '../../../../../shared/schemas/loot.schema'

export function useLoot() {
  const store = useUnifiedStore()

  /* ================================================================== */
  /* 战利品表可视化编辑                                                   */
  /* ================================================================== */

  /** 当前对象的战利品表（方块/物品/实体通用） */
  const loot = computed<LootTableDef | null>(() => store.active?.data.lootTable ?? null)

  /** 对象类型 → 战利品表 type：block→block，entity→entity，item→chest（通用表，无 type 字段） */
  function lootTypeFor(objectType: string): LootTableDef['type'] {
    return objectType === 'block' ? 'block' : objectType === 'entity' ? 'entity' : 'chest'
  }

  /** 空状态引导文案 */
  const lootEmptyHint = computed(() => {
    switch (store.active?.type) {
      case 'block':
        return t('unified.loot.hintBlock')
      case 'entity':
        return t('unified.loot.hintEntity')
      default:
        return t('unified.loot.hintItem')
    }
  })

  /** 启用战利品表：方块默认掉落自身；物品/实体默认掉落/产出自身 1 个 */
  function enableLoot(): void {
    const u = store.active
    if (!u) return
    if (u.type === 'block') {
      u.data.lootTable = createDefaultBlockLoot(u.id)
      return
    }
    const def = createEmptyLoot(lootTypeFor(u.type))
    def.pools[0].entries.push({ item: u.id, count: lootFixed(1), weight: 1, chance: 1 })
    u.data.lootTable = def
  }

  /** 添加掉落池（空池，type 跟随当前对象） */
  function addPool(): void {
    const u = store.active
    if (!u || !u.data.lootTable) return
    u.data.lootTable.pools.push(createEmptyLoot(lootTypeFor(u.type)).pools[0])
  }

  /** 删除池 */
  function removePool(pi: number): void {
    const u = store.active
    if (!u || !u.data.lootTable) return
    u.data.lootTable.pools.splice(pi, 1)
  }

  /** 给指定池添加一条掉落物（默认当前物品/数量1/权重1/必定） */
  function addEntry(pi: number): void {
    const pool = store.active?.data.lootTable?.pools[pi]
    if (!pool) return
    const entry: LootEntryDef = {
      item: '',
      count: lootFixed(1),
      weight: 1,
      chance: 1
    }
    pool.entries.push(entry)
  }

  /** 删除条目 */
  function removeEntry(pi: number, ei: number): void {
    const pool = store.active?.data.lootTable?.pools[pi]
    if (!pool) return
    pool.entries.splice(ei, 1)
  }

  /** 切换池抽取次数形态（固定↔区间），尽量保留数值 */
  function setRollsKind(pool: LootPoolDef, kind: 'fixed' | 'range'): void {
    if (pool.rolls.kind === kind) return
    if (kind === 'fixed') {
      const v = pool.rolls.kind === 'range' ? pool.rolls.min : pool.rolls.value
      pool.rolls = lootFixed(v)
    } else {
      const v = pool.rolls.kind === 'fixed' ? pool.rolls.value : pool.rolls.max
      pool.rolls = { kind: 'range', min: v, max: v }
    }
  }

  /** 切换条目数量形态（固定↔区间） */
  function setCountKind(entry: LootEntryDef, kind: 'fixed' | 'range'): void {
    if (entry.count.kind === kind) return
    if (kind === 'fixed') {
      const v = entry.count.kind === 'range' ? entry.count.min : entry.count.value
      entry.count = lootFixed(v)
    } else {
      const v = entry.count.kind === 'fixed' ? entry.count.value : entry.count.max
      entry.count = { kind: 'range', min: v, max: v }
    }
  }

  return {
    loot,
    lootEmptyHint,
    enableLoot,
    addPool,
    removePool,
    addEntry,
    removeEntry,
    setRollsKind,
    setCountKind
  }
}
