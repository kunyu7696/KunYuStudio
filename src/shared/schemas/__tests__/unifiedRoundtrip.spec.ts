/**
 * UnifiedContent 往返属性测试（技术债 #6）。
 *
 * 只断言最小不变量，不做全字段属性测试（字段持续演进）：
 * - 合法 UnifiedContent 经 adapter → 扁平 schema（validate + normalize）→ adapter 往返后，
 *   核心字段 id / type 恒等；ns（命名空间，适配器入参，落在 java.packageName）恒等。
 * - 中间扁平产物通过各自 schema 校验（validateBlockSchema / validateItemSchema /
 *   validateEntitySchema / validateBiomeDoc / validateAdvancementDoc）。
 *
 * 注：UnifiedContent 本体只有 id / type 两个核心标量字段——ns 是适配器入参而非字段，
 * loader 不存在于内容对象上（仅工程级 datapack/shaderpack 元数据有 loader）。
 * 因此「id / ns / type / loader」四字段不变量在此收敛为 id / type / ns(packageName)。
 *
 * 对应真实函数：
 * - adapter 出：unifiedToBlock / unifiedToItem / unifiedToEntity / unifiedToBiome / unifiedToAdvancement
 * - schema 校验/规范化：validateXxxSchema + normalizeXxxSchema（biome/advancement 为 validateXxxDoc）
 * - adapter 回：blockToUnified / itemToUnified / entityToUnified / biomeToUnified / advancementToUnified
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import type { UnifiedContent } from '../unified.schema'
import {
  createDefaultUnifiedBlock,
  createDefaultUnifiedItem,
  createDefaultUnifiedEntity,
  createDefaultUnifiedContent,
  validateUnifiedContent,
  applyUnifiedItemType
} from '../unified.schema'
import {
  blockToUnified,
  unifiedToBlock,
  itemToUnified,
  unifiedToItem,
  entityToUnified,
  unifiedToEntity,
  biomeToUnified,
  unifiedToBiome,
  advancementToUnified,
  unifiedToAdvancement
} from '../unified.adapter'
import { normalizeBlockSchema, validateBlockSchema } from '../block.schema'
import { normalizeItemSchema, validateItemSchema } from '../item.schema'
import { normalizeEntitySchema, validateEntitySchema } from '../entity.schema'
import { validateBiomeDoc } from '../datapack/biome.schema'
import { validateAdvancementDoc } from '../datapack/advancement.schema'
import type { BlockProperties } from '../block.schema'
import type { ItemJavaProperties } from '../unified.schema'
import type { EntityProperties } from '../entity.schema'

/* ------------------------------------------------------------------ */
/* 生成器：只产生「合法」UnifiedContent（以工厂默认值为底，覆盖合法随机值）   */
/* ------------------------------------------------------------------ */

/** 注册名：小写字母开头，仅小写/数字/下划线，≤64 字符 */
const arbId = fc.stringMatching(/^[a-z][a-z0-9_]{0,19}$/)

/** 命名空间：仅小写/数字/下划线（作为 lang 键与包名片段必须合法） */
const arbNs = fc.stringMatching(/^[a-z][a-z0-9_]{0,9}$/)

/** 显示名：保证 trim 后至少一个非空（validateUnifiedContent 的硬性要求） */
const arbDisplayName = fc
  .tuple(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), arbId)
  .map(([en, zh, id]) => {
    const enUs = en.trim() ? en : ''
    const zhCn = zh.trim() ? zh : ''
    return enUs || zhCn ? { en_us: enUs, zh_cn: zhCn } : { en_us: id, zh_cn: '' }
  })

/** #RRGGBB 颜色 */
const arbHex = fc
  .tuple(
    fc.constantFrom(...'0123456789abcdef'.split('')),
    fc.constantFrom(...'0123456789abcdef'.split('')),
    fc.constantFrom(...'0123456789abcdef'.split('')),
    fc.constantFrom(...'0123456789abcdef'.split('')),
    fc.constantFrom(...'0123456789abcdef'.split('')),
    fc.constantFrom(...'0123456789abcdef'.split(''))
  )
  .map((cs) => `#${cs.join('')}`)

const arbBlock: fc.Arbitrary<{ u: UnifiedContent; ns: string }> = fc
  .record({
    id: arbId,
    ns: arbNs,
    name: arbDisplayName,
    hardness: fc.integer({ min: 0, max: 50 }),
    resistance: fc.integer({ min: 0, max: 100 }),
    lightLevel: fc.integer({ min: 0, max: 15 }),
    miningLevel: fc.constantFrom(0, 1, 2, 3, 4),
    toolType: fc.constantFrom('hand', 'pickaxe', 'axe', 'shovel', 'hoe', 'sword'),
    renderType: fc.constantFrom('solid', 'cutout', 'translucent'),
    soundGroup: fc.constantFrom('stone', 'wood', 'gravel', 'metal', 'glass', 'wool'),
    color: arbHex
  })
  .map((r) => {
    const u = createDefaultUnifiedBlock(r.id, r.ns)
    u.displayName = r.name
    const p = u.java.properties as BlockProperties
    p.hardness = r.hardness
    p.resistance = r.resistance
    p.lightLevel = r.lightLevel
    p.miningLevel = r.miningLevel as BlockProperties['miningLevel']
    p.toolType = r.toolType as BlockProperties['toolType']
    p.renderType = r.renderType as BlockProperties['renderType']
    p.soundGroup = r.soundGroup as BlockProperties['soundGroup']
    if (u.assets.textures.block?.[0]) u.assets.textures.block[0].color = r.color
    return { u, ns: r.ns }
  })

const arbItem: fc.Arbitrary<{ u: UnifiedContent; ns: string }> = fc
  .record({
    id: arbId,
    ns: arbNs,
    name: arbDisplayName,
    maxDamage: fc.integer({ min: 0, max: 9999 }),
    maxCount: fc.integer({ min: 1, max: 64 }),
    rarity: fc.constantFrom('common', 'uncommon', 'rare', 'epic'),
    color: arbHex
  })
  .map((r) => {
    const u = createDefaultUnifiedItem(r.id, r.ns)
    u.displayName = r.name
    const p = u.java.properties as ItemJavaProperties
    p.maxDamage = r.maxDamage
    // 有耐久物品最大堆叠固定为 1（validateItemSchema 约束）
    p.maxCount = r.maxDamage > 0 ? 1 : r.maxCount
    p.rarity = r.rarity as ItemJavaProperties['rarity']
    if (u.assets.textures.item) u.assets.textures.item.color = r.color
    return { u, ns: r.ns }
  })

const arbEntity: fc.Arbitrary<{ u: UnifiedContent; ns: string }> = fc
  .record({
    id: arbId,
    ns: arbNs,
    name: arbDisplayName,
    width: fc.double({ min: 0.1, max: 16, noNaN: true }),
    height: fc.double({ min: 0.1, max: 16, noNaN: true }),
    eyeHeight: fc.double({ min: 0, max: 16, noNaN: true }),
    naturalSpawn: fc.boolean(),
    groupLo: fc.integer({ min: 1, max: 50 }),
    groupHi: fc.integer({ min: 1, max: 50 })
  })
  .map((r) => {
    const u = createDefaultUnifiedEntity(r.id, r.ns)
    u.displayName = r.name
    const p = u.java.properties as EntityProperties
    p.width = r.width
    p.height = r.height
    p.eyeHeight = r.eyeHeight
    if (u.java.spawn) {
      u.java.spawn.naturalSpawn = r.naturalSpawn
      u.java.spawn.minGroupSize = Math.min(r.groupLo, r.groupHi)
      u.java.spawn.maxGroupSize = Math.max(r.groupLo, r.groupHi)
      // naturalSpawn=true 时 biomes 至少一个（validateEntitySchema 约束），默认值已满足
    }
    return { u, ns: r.ns }
  })

const arbBiome: fc.Arbitrary<UnifiedContent> = fc
  .record({ id: arbId, name: arbDisplayName })
  .map((r) => {
    const u = createDefaultUnifiedContent('biome', r.id)
    u.displayName = r.name
    return u
  })

const arbAdvancement: fc.Arbitrary<UnifiedContent> = fc
  .record({ id: arbId, name: arbDisplayName })
  .map((r) => {
    const u = createDefaultUnifiedContent('advancement', r.id)
    u.displayName = r.name
    return u
  })

/** 每类运行次数；5 类合计 250 组随机用例 */
const RUNS = { numRuns: 50 }

/* ------------------------------------------------------------------ */
/* 往返属性                                                              */
/* ------------------------------------------------------------------ */

describe('UnifiedContent 往返属性：最小不变量', () => {
  it('block：unified → flat(validate+normalize) → unified 后 id/type/ns 恒等，中间校验无错误', () => {
    fc.assert(
      fc.property(arbBlock, ({ u, ns }) => {
        fc.pre(validateUnifiedContent(u) === null) // 输入必须合法
        const flat = unifiedToBlock(u)
        expect(validateBlockSchema(flat)).toBeNull()
        const back = blockToUnified(normalizeBlockSchema(flat), ns)
        expect(back.id).toBe(u.id)
        expect(back.type).toBe('block')
        expect(back.java.packageName).toBe(u.java.packageName) // ns 不变量
      }),
      RUNS
    )
  })

  it('item：unified → flat(validate+normalize) → unified 后 id/type/ns 恒等，中间校验无错误', () => {
    fc.assert(
      fc.property(arbItem, ({ u, ns }) => {
        fc.pre(validateUnifiedContent(u) === null)
        const flat = unifiedToItem(u)
        expect(validateItemSchema(flat)).toBeNull()
        const back = itemToUnified(normalizeItemSchema(flat), ns)
        expect(back.id).toBe(u.id)
        expect(back.type).toBe('item')
        expect(back.java.packageName).toBe(u.java.packageName)
      }),
      RUNS
    )
  })

  it('entity：unified → flat(validate+normalize) → unified 后 id/type/ns 恒等，中间校验无错误', () => {
    fc.assert(
      fc.property(arbEntity, ({ u, ns }) => {
        fc.pre(validateUnifiedContent(u) === null)
        const flat = unifiedToEntity(u)
        expect(validateEntitySchema(flat)).toBeNull()
        const back = entityToUnified(normalizeEntitySchema(flat), ns)
        expect(back.id).toBe(u.id)
        expect(back.type).toBe('entity')
        expect(back.java.packageName).toBe(u.java.packageName)
      }),
      RUNS
    )
  })

  it('biome：unified → doc(validate) → unified 后 id/type 恒等，doc 校验无错误', () => {
    fc.assert(
      fc.property(arbBiome, (u) => {
        fc.pre(validateUnifiedContent(u) === null)
        const flat = unifiedToBiome(u)
        expect(validateBiomeDoc(flat.doc)).toBeNull()
        const back = biomeToUnified(flat)
        expect(back.id).toBe(u.id)
        expect(back.type).toBe('biome')
        // biome/advancement 往返后仍须通过 unified 校验（无 Java 类名环节，可完整闭环）
        expect(validateUnifiedContent(back)).toBeNull()
      }),
      RUNS
    )
  })

  it('advancement：unified → doc(validate) → unified 后 id/type 恒等，doc 校验无错误', () => {
    fc.assert(
      fc.property(arbAdvancement, (u) => {
        fc.pre(validateUnifiedContent(u) === null)
        const flat = unifiedToAdvancement(u)
        expect(validateAdvancementDoc(flat.doc)).toBeNull()
        const back = advancementToUnified(flat)
        expect(back.id).toBe(u.id)
        expect(back.type).toBe('advancement')
        expect(validateUnifiedContent(back)).toBeNull()
      }),
      RUNS
    )
  })
})

/* ------------------------------------------------------------------ */
/* 类名往返不变量：适配层按 deriveContentClassName(id, type) 确定性派生     */
/* java.className，与工厂默认值同源，往返产物可完整通过统一校验。            */
/* ------------------------------------------------------------------ */

describe('UnifiedContent 往返：类名不变量', () => {
  it('block/item/entity 往返后仍应通过 validateUnifiedContent（className 确定性派生）', () => {
    const roundTripped: UnifiedContent[] = [
      blockToUnified(
        normalizeBlockSchema(unifiedToBlock(createDefaultUnifiedBlock('rt_block', 'rtmod'))),
        'rtmod'
      ),
      itemToUnified(
        normalizeItemSchema(unifiedToItem(createDefaultUnifiedItem('rt_item', 'rtmod'))),
        'rtmod'
      ),
      entityToUnified(
        normalizeEntitySchema(unifiedToEntity(createDefaultUnifiedEntity('rt_entity', 'rtmod'))),
        'rtmod'
      )
    ]
    for (const back of roundTripped) {
      expect(validateUnifiedContent(back)).toBeNull()
    }
    // 类名与工厂默认值同规则：Pascal(id) + 类型后缀
    expect(roundTripped[0].java.className).toBe('RtBlockBlock')
    expect(roundTripped[1].java.className).toBe('RtItemItem')
    expect(roundTripped[2].java.className).toBe('RtEntity')
  })
})

describe('applyUnifiedItemType：统一对象物品子类型切换', () => {
  it('simple → tool：填入工具默认配置', () => {
    const u = createDefaultUnifiedItem('my_sword', 'mymod')
    applyUnifiedItemType(u, 'tool')
    expect(u.java.itemType).toBe('tool')
    const tool = u.java.tool!
    expect(tool.toolKind).toBe('sword')
    expect(tool.material).toBe('iron')
    expect(typeof tool.attackDamage).toBe('number')
    // 非物品对象 / 同类型为空操作
    const block = createDefaultUnifiedBlock('my_block', 'mymod')
    applyUnifiedItemType(block, 'tool')
    expect(block.java.itemType).toBeUndefined()
    applyUnifiedItemType(u, 'tool')
    expect(u.java.itemType).toBe('tool')
  })

  it('tool（有耐久）→ food：清空工具配置、耐久归零、堆叠恢复 64', () => {
    const u = createDefaultUnifiedItem('my_food', 'mymod')
    ;(u.java.properties as { maxDamage: number }).maxDamage = 250
    applyUnifiedItemType(u, 'tool')
    applyUnifiedItemType(u, 'food')
    expect(u.java.itemType).toBe('food')
    expect(u.java.tool).toBeUndefined()
    expect(u.java.food).toBeDefined()
    expect(u.java.food!.hunger).toBe(6)
    const p = u.java.properties as { maxDamage: number; maxCount: number }
    expect(p.maxDamage).toBe(0)
    expect(p.maxCount).toBe(64)
  })

  it('切换后往返扁平 schema 仍通过校验（tool 配置随 adapter 双向映射）', () => {
    const u = createDefaultUnifiedItem('my_pick', 'mymod')
    applyUnifiedItemType(u, 'tool')
    const flat = unifiedToItem(u)
    expect(validateItemSchema(flat)).toBeNull()
    expect(flat.itemType).toBe('tool')
    expect(flat.tool?.toolKind).toBe('sword')
  })
})
