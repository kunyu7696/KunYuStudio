import type { ItemSchema } from '../../../shared/types/content'
import type { EntitySchema } from '../../../shared/schemas/entity.schema'
import {
  foodEffectConstant,
  itemDisplayName,
  type ArmorSlot,
  type ToolKind
} from '../../../shared/schemas/item.schema'
import type { GeneratorBlock } from '../blockAdapter'
import {
  ARMOR_DURABILITY_MULTIPLIER,
  armorMaterialConstant,
  mojmapModItemsJava
} from '../mojmapCodegen'
import { compareMcVersions } from '../ai/versionMatrix'
import {
  blockItemClassImport,
  isLegacyRegistry,
  itemClassImport,
  itemPropertiesExpr,
  rarityImport,
  registryImports,
  registriesConst,
  resourceKeyImport,
  setIdCallExpr,
  stackCountCall
} from '../../templates/fabricTemplates'
import { isMojangEra } from '../../templates/loaderVersionMatrix'
import type { ItemSpriteKind } from '../../templates/textureSynthesizer'
import type { ModContext } from './context'
import { fmtFloat, toJavaConst } from './javaBlocks'
import { GENERATED_BANNER, clampStack, oneLine } from './utils'

/** 生成 ModItems.java（含方块物品、独立物品与实体刷怪蛋；按加载器分发；blocks 须为仅含 hasBlockItem 的方块） */
export function generateModItemsJava(
  ctx: ModContext,
  blocks: GeneratorBlock[],
  items: ItemSchema[],
  entities: EntitySchema[] = []
): string {
  return ctx.loader === 'fabric'
    ? isMojangEra(ctx.mcVersion)
      ? fabricMojmapModItemsJava(ctx, blocks, items, entities)
      : fabricModItemsJava(ctx, blocks, items, entities)
    : mojmapModItemsJava(ctx, blocks, items, entities)
}

/** 工具类名与构造器攻击力参数类型（Yarn/Mojmap 同名，参数 int/float 有别） */
const TOOL_CLASSES: Record<ToolKind, { cls: string; intDamage: boolean }> = {
  pickaxe: { cls: 'PickaxeItem', intDamage: true },
  axe: { cls: 'AxeItem', intDamage: false },
  shovel: { cls: 'ShovelItem', intDamage: false },
  hoe: { cls: 'HoeItem', intDamage: true },
  sword: { cls: 'SwordItem', intDamage: true }
}

/**
 * Yarn 1.20.1 原版创造模式物品组常量（net.minecraft.item.ItemGroups）。
 * 1.20.1 新创造菜单：物品只 Registry.register 而不加入任何 ItemGroup，
 * 既不会出现在分类页，也不会出现在搜索页（搜索页仅聚合各组条目）。
 * 注意：工具组在 1.20.1 名为 TOOLS（1.20.2 起才改名 TOOLS_AND_UTILITIES）。
 */
const FABRIC_ITEM_GROUPS = [
  'BUILDING_BLOCKS',
  'COLORED_BLOCKS',
  'NATURAL',
  'FUNCTIONAL',
  'REDSTONE',
  'TOOLS',
  'FOOD_AND_DRINK',
  'INGREDIENTS',
  'SPAWN_EGGS',
  'COMBAT'
] as const

type FabricItemGroup = (typeof FABRIC_ITEM_GROUPS)[number]

/**
 * P0-1：legacy（<1.19.3）ItemGroup 常量映射。
 * legacy 无 ItemGroups/ItemGroupEvents（fabric-api itemgroup v1），物品入组走
 * Item.Settings.group(ItemGroup.X)；1.18.2 组常量与 1.19.3+ 名称映射（Yarn 1.18.2 javap 核实）。
 */
const LEGACY_ITEM_GROUP: Record<FabricItemGroup, string> = {
  BUILDING_BLOCKS: 'BUILDING_BLOCKS',
  COLORED_BLOCKS: 'DECORATIONS',
  NATURAL: 'MISC',
  FUNCTIONAL: 'DECORATIONS',
  REDSTONE: 'REDSTONE',
  TOOLS: 'TOOLS',
  FOOD_AND_DRINK: 'FOOD',
  INGREDIENTS: 'MISC',
  SPAWN_EGGS: 'MISC',
  COMBAT: 'COMBAT'
}

/** 物品语义 → 程序化贴图形体（工具按 toolKind、盔甲按槽位） */
export function itemSpriteKind(item: ItemSchema): ItemSpriteKind {
  switch (item.itemType) {
    case 'tool':
      return { type: 'tool', toolKind: item.tool?.toolKind ?? 'sword' }
    case 'armor':
      return { type: 'armor', slot: item.armor?.slot ?? 'chestplate' }
    case 'food':
      return { type: 'food' }
    case 'block_item':
      return { type: 'block_item' }
    default:
      return { type: 'simple', id: item.id }
  }
}

/** creativeTab 显式指定值仅接受原版组常量白名单，防止自由文本注入 Java 代码 */
function resolveFabricItemGroup(item: ItemSchema): FabricItemGroup {
  const explicit = (item.properties.creativeTab ?? '').trim()
  if ((FABRIC_ITEM_GROUPS as readonly string[]).includes(explicit)) {
    return explicit as FabricItemGroup
  }
  // 未指定（空串）时按物品类型给合理默认组
  switch (item.itemType) {
    case 'tool':
      return item.tool?.toolKind === 'sword' ? 'COMBAT' : 'TOOLS'
    case 'armor':
      return 'COMBAT'
    case 'food':
      return 'FOOD_AND_DRINK'
    case 'block_item':
      return 'BUILDING_BLOCKS'
    default:
      return 'INGREDIENTS'
  }
}

/** 通用 Item.Settings/Properties 链（耐久/堆叠/rarity/fireproof） */
function commonSettingLines(
  i: ItemSchema,
  style: 'yarn' | 'mojmap',
  /** 工具/盔甲未显式设置耐久时的兜底表达式（Java 代码，如 ToolMaterials.IRON.getDurability()）。
   * null 表示耐久已由 Settings 辅助方法内建（1.21.5+ pickaxe()/armor()），跳过兜底且不退化为堆叠 */
  maxDamageExpr?: string | null
): string[] {
  const lines: string[] = []
  if (i.properties.maxDamage > 0) {
    lines.push(`.maxDamage(${Math.floor(i.properties.maxDamage)})`)
  } else if (maxDamageExpr === null) {
    // 耐久已内建（1.21.5+ 数据组件式工具/盔甲）
  } else if (maxDamageExpr) {
    // 工具/盔甲没有耐久条不符合原版行为（Yarn/Mojmap 均不会自动应用材质耐久）
    lines.push(`.maxDamage(${maxDamageExpr})`)
  } else if (style === 'yarn') {
    lines.push(`.maxCount(${clampStack(i.properties.maxCount)})`)
  } else {
    lines.push(`.stacksTo(${clampStack(i.properties.maxCount)})`)
  }
  if (i.properties.rarity !== 'common') {
    lines.push(`.rarity(Rarity.${i.properties.rarity.toUpperCase()})`)
  }
  if (i.properties.fireproof) lines.push('.fireproof()')
  return lines
}

/** 食物 Builder 链（Yarn FoodComponent / Mojmap FoodProperties） */
function foodBuilderLines(
  item: ItemSchema,
  flavor: 'yarn' | 'mojmap',
  foodSaturationMethod: string,
  mcVersion = '1.20.1'
): string[] {
  const f = item.food!
  // Yarn 侧调用方会再叠加 4 空格（对齐 .food( 之后的缩进层级）
  const indent = flavor === 'yarn' ? '        ' : '                '
  // 1.20.5 物品组件重构（Yarn javap 实证）：hunger 改名 nutrition、meat 方法移除
  const componentRefactor = compareMcVersions(mcVersion, '1.20.5') >= 0
  const lines: string[] = []
  lines.push(`${indent}.${componentRefactor ? 'nutrition' : 'hunger'}(${Math.floor(f.hunger)})`)
  lines.push(`${indent}.${foodSaturationMethod}(${fmtFloat(f.saturation)})`)
  if (f.meat && flavor === 'mojmap') lines.push(`${indent}.meat()`)
  else if (f.meat && !componentRefactor) lines.push(`${indent}.meat()`) // Yarn 1.20.5 前 meat 为无参方法（原 .meat(true) 无法编译）
  if (f.alwaysEdible) lines.push(`${indent}.alwaysEdible()`)
  if (flavor === 'yarn' && f.snack) lines.push(`${indent}.snack()`)
  for (const e of f.effects) {
    const constant = foodEffectConstant(e.effect, flavor)
    if (!constant) {
      lines.push(`${indent}// TODO 效果 ${e.effect} 不在常用效果清单，已跳过（请扩展映射后生成）`)
      continue
    }
    const effectsClass = flavor === 'yarn' ? 'StatusEffects' : 'MobEffects'
    const instanceClass = flavor === 'yarn' ? 'StatusEffectInstance' : 'MobEffectInstance'
    lines.push(
      `${indent}.${flavor === 'yarn' ? 'statusEffect' : 'effect'}(new ${instanceClass}(${effectsClass}.${constant}, ${Math.floor(e.duration)}, ${Math.floor(e.amplifier)}), ${fmtFloat(e.chance)})`
    )
  }
  lines.push(`${indent}.build()`)
  return lines
}

/** Yarn <1.20 护甲构造器/耐久方法接收 EquipmentSlot（javap 实证），slot → 枚举成员对照 */
const YARN_ARMOR_EQUIPMENT_SLOTS: Record<ArmorSlot, string> = {
  helmet: 'HEAD',
  chestplate: 'CHEST',
  leggings: 'LEGS',
  boots: 'FEET'
}

/** 单个物品的字段定义（Yarn/Fabric 静态字段形态）；legacyGroup 仅 legacy（<1.19.3）传入（.group 入组） */
function fabricItemField(i: ItemSchema, mcVersion: string, legacyGroup?: string): string {
  const name = itemDisplayName(i, 'zh_cn')
  let comment = `/** ${name} */`
  if (i.itemType === 'block_item' && i.blockRef) {
    comment = `/** ${name}（方块物品，引用 ${i.blockRef}；方块本体注册见 ModBlocks） */`
  } else if (i.description) {
    comment = `/** ${name}：${oneLine(i.description)} */`
  }

  // 1.20.5 物品组件重构（Yarn javap 实证）：工具构造器收窄为 (ToolMaterial, Settings)，
  // 攻击属性走 attributeModifiers；ArmorMaterials 成员转 Holder（CHAINMAIL→CHAIN）且耐久迁入 ArmorItem.Type
  const componentRefactor = compareMcVersions(mcVersion, '1.20.5') >= 0
  // 1.21.4 再重构（javap 实证）：ToolMaterials 改为单数 ToolMaterial；ArmorMaterials 迁包到
  // net.minecraft.item.equipment；耐久方法改为 ToolMaterial.durability() / ArmorMaterial.durability() * multiplier
  const equipmentRefactor = compareMcVersions(mcVersion, '1.21.4') >= 0
  // 1.21.5 数据组件化（javap 实证）：原版删除 PickaxeItem/ArmorItem 等子类，工具/盔甲均为裸 Item，
  // 行为经 Settings 辅助方法注入（pickaxe()/sword()/armor() 内建 ToolComponent/EquippableComponent、
  // 攻击属性与材质耐久）；SpawnEggItem 构造器同步去除颜色参数
  const dataComponentItems = compareMcVersions(mcVersion, '1.21.5') >= 0
  // 1.21 起 Identifier 构造器私有化，EntityAttributeModifier 标识从 String 改为 Identifier
  const gte121 = compareMcVersions(mcVersion, '1.21') >= 0
  const modifierId = (name: string): string =>
    gte121 ? `Identifier.of("minecraft", "${name}")` : `"minecraft:${name}"`

  // AI 自由代码路径：自定义物品类（如 KatanaItem）。取类名简写，构造器仅收 Settings，
  // 工具/盔甲/食物等特殊行为由自定义类内部实现，不再生成原版构造参数。
  const customSimple = i.customClass ? i.customClass.split('.').pop() : null

  let ctor = 'Item'
  let argsPrefix = ''
  let maxDamageExpr: string | null | undefined
  const settings: string[] = []

  if (customSimple) {
    ctor = customSimple
  } else if (i.itemType === 'tool' && i.tool) {
    const t = i.tool
    const meta = TOOL_CLASSES[t.toolKind]
    ctor = meta.cls
    const dmg = meta.intDamage
      ? `${Math.trunc(t.attackDamage)}`
      : fmtFloat(t.attackDamage)
    const material = `${equipmentRefactor ? 'ToolMaterial' : 'ToolMaterials'}.${t.material.toUpperCase()}`
    if (dataComponentItems) {
      // 1.21.5+：裸 Item + Settings.pickaxe()/sword() 等辅助方法（签名均为 (ToolMaterial, float, float)，
      // 内建 ToolComponent/WeaponComponent、攻击属性修饰与材质耐久，无需再设 maxDamage 兜底）
      ctor = 'Item'
      settings.push(
        `        .${t.toolKind}(${material}, ${fmtFloat(t.attackDamage)}, ${fmtFloat(t.attackSpeed)})`
      )
      maxDamageExpr = null
    } else if (equipmentRefactor) {
      // 1.21.4+：原版工具子类构造器保留 (ToolMaterial, float, float, Settings)
      argsPrefix = `${material}, ${dmg}, ${fmtFloat(t.attackSpeed)}, `
    } else if (componentRefactor) {
      // 1.20.5~1.21.3 工具构造器收窄为 (ToolMaterial, Settings)，攻击属性走 attributeModifiers
      argsPrefix = `${material}, `
      settings.push('        .attributeModifiers(AttributeModifiersComponent.builder()')
      settings.push(
        `            .add(EntityAttributes.GENERIC_ATTACK_DAMAGE, new EntityAttributeModifier(${modifierId('attack_damage')}, ${dmg}, EntityAttributeModifier.Operation.ADD_VALUE), AttributeModifierSlot.MAINHAND)`
      )
      settings.push(
        `            .add(EntityAttributes.GENERIC_ATTACK_SPEED, new EntityAttributeModifier(${modifierId('attack_speed')}, ${fmtFloat(t.attackSpeed)}, EntityAttributeModifier.Operation.ADD_VALUE), AttributeModifierSlot.MAINHAND)`
      )
      settings.push('            .build())')
    } else {
      argsPrefix = `${material}, ${dmg}, ${fmtFloat(t.attackSpeed)}, `
    }
    if (!dataComponentItems) {
      maxDamageExpr = equipmentRefactor ? `${material}.durability()` : `${material}.getDurability()`
    }
  } else if (i.itemType === 'armor' && i.armor) {
    const a = i.armor
    ctor = 'ArmorItem'
    const materialConst = armorMaterialConstant(a.material, componentRefactor)
    if (dataComponentItems) {
      // 1.21.5+：裸 Item + Settings.armor(ArmorMaterial, EquipmentType)，内建 EquippableComponent、
      // 防御/韧性属性与 maxDamage（材质耐久 × 槽位倍数），无需再设 maxDamage 兜底
      ctor = 'Item'
      settings.push(
        `        .armor(ArmorMaterials.${materialConst}, EquipmentType.${a.slot.toUpperCase()})`
      )
      maxDamageExpr = null
    } else if (equipmentRefactor) {
      // 1.21.4+：ArmorMaterials 迁包到 item.equipment 且为 interface，ArmorMaterial 是 record；
      // 耐久 = ArmorMaterial.durability() × ArmorItem.Type.getMaxDamage(multiplier) 倍数表
      const slot = `EquipmentType.${a.slot.toUpperCase()}`
      argsPrefix = `ArmorMaterials.${materialConst}, ${slot}, `
      maxDamageExpr = `ArmorMaterials.${materialConst}.durability() * ${ARMOR_DURABILITY_MULTIPLIER[a.material]}`
    } else if (componentRefactor) {
      // 1.20.5+：原版 ArmorMaterial 经 Holder 间接引用，耐久迁入 ArmorItem.Type.getMaxDamage(multiplier) 数值表
      const slot = `ArmorItem.Type.${a.slot.toUpperCase()}`
      argsPrefix = `ArmorMaterials.${materialConst}, ${slot}, `
      maxDamageExpr = `${slot}.getMaxDamage(${ARMOR_DURABILITY_MULTIPLIER[a.material]})`
    } else if (compareMcVersions(mcVersion, '1.20') < 0) {
      // 1.19.x-：构造器与材质耐久方法均接收 EquipmentSlot
      const slotArg = `EquipmentSlot.${YARN_ARMOR_EQUIPMENT_SLOTS[a.slot]}`
      argsPrefix = `ArmorMaterials.${materialConst}, ${slotArg}, `
      maxDamageExpr = `ArmorMaterials.${materialConst}.getDurability(${slotArg})`
    } else {
      // 1.20.x：ArmorItem(Type, ArmorItem.Type, ...)，ArmorMaterials.getDurability(Type)
      const slot = `ArmorItem.Type.${a.slot.toUpperCase()}`
      argsPrefix = `ArmorMaterials.${materialConst}, ${slot}, `
      maxDamageExpr = `ArmorMaterials.${materialConst}.getDurability(${slot})`
    }
  }

  settings.push(...commonSettingLines(i, 'yarn', maxDamageExpr).map((s) => `        ${s}`))
  if (i.itemType === 'food' && i.food) {
    settings.push('        .food(new FoodComponent.Builder()')
    settings.push(
      ...foodBuilderLines(i, 'yarn', 'saturationModifier', mcVersion).map((s) => `    ${s}`)
    )
    settings.push('        )')
  }

  const chain =
    settings.length > 0
      ? `new Item.Settings()\n${settings.join('\n')}`
      : 'new Item.Settings()'
  // 1.18 及以前原版工具类构造器为 protected（javap 实证：PickaxeItem 等），
  // 外部包无法直接 new；改用匿名子类（空类体）绕过可见性。1.19.2 起已放开为 public。
  const legacyAnonCtor =
    !componentRefactor && i.itemType === 'tool' && compareMcVersions(mcVersion, '1.19') < 0
  const ctorTail = legacyAnonCtor ? ' {}' : ''
  // legacy（<1.19.3）：无 ItemGroupEvents，物品入组走 Settings.group（放链尾，顺序无关）
  if (legacyGroup) {
    return `    ${comment}
    public static final ${ctor === 'Item' ? 'Item' : ctor} ${toJavaConst(i.id)} = new ${ctor}(${argsPrefix}${chain}\n        .group(ItemGroup.${legacyGroup}))${ctorTail};`
  }
  return `    ${comment}
    public static final ${ctor === 'Item' ? 'Item' : ctor} ${toJavaConst(i.id)} = new ${ctor}(${argsPrefix}${chain})${ctorTail};`
}

/**
 * 26.x Fabric（Mojang 官方映射）单物品字段。
 *
 * 与 Yarn 版的差异（按 javap 26.3 逐项核对）：
 * - 属性对象为 Item.Properties，且必须 setId(ResourceKey)（注册期否则抛异常）
 * - 1.21.5+ 原版工具/盔甲子类已删除（数据组件化）：裸 Item + Properties.pickaxe()/sword()/
 *   humanoidArmor() 等辅助方法，内建攻击属性与材质耐久
 * - 食物只生成 26.x FoodProperties.Builder 仍保留的 nutrition/saturationModifier/alwaysEdible；
 *   肉类与药水效果已迁入数据组件（Consumable），写法未确证 → 跳过（宁可少生成，不猜 API）
 * - SpawnEggItem 只收 Properties，实体类型经 Properties.spawnEgg(EntityType) 注入
 */
function fabricMojmapItemField(ctx: ModContext, i: ItemSchema): string {
  const name = itemDisplayName(i, 'zh_cn')
  let comment = `/** ${name} */`
  if (i.itemType === 'block_item' && i.blockRef) {
    comment = `/** ${name}（方块物品，引用 ${i.blockRef}；方块本体注册见 ModBlocks） */`
  } else if (i.description) {
    comment = `/** ${name}：${oneLine(i.description)} */`
  }

  // AI 自由代码路径：自定义类构造器仅收 Properties，特殊行为由类内部实现
  const customSimple = i.customClass ? i.customClass.split('.').pop() : null
  const isTool = !customSimple && i.itemType === 'tool' && Boolean(i.tool)
  const isArmor = !customSimple && i.itemType === 'armor' && Boolean(i.armor)

  const settings: string[] = []
  const setId = setIdCallExpr(ctx.mcVersion, 'ITEM', ctx.modClassName, i.id)
  if (setId) settings.push(`        ${setId}`)
  const hasDurability = i.properties.maxDamage > 0

  const ctor = customSimple ?? 'Item'
  if (isTool) {
    const t = i.tool!
    // 辅助方法签名 (ToolMaterial, float, float)：攻击力为加成值、攻击速度为修正值，与原版构造器语义一致
    settings.push(
      `        .${t.toolKind}(ToolMaterial.${t.material.toUpperCase()}, ${fmtFloat(t.attackDamage)}, ${fmtFloat(t.attackSpeed)})`
    )
  } else if (isArmor) {
    const a = i.armor!
    settings.push(
      `        .humanoidArmor(ArmorMaterials.${a.material.toUpperCase()}, ArmorType.${a.slot.toUpperCase()})`
    )
  } else if (!hasDurability) {
    settings.push(`        ${stackCountCall(ctx.mcVersion, clampStack(i.properties.maxCount))}`)
  }

  // 显式耐久覆盖（工具/盔甲未显式设置时由辅助方法按材质内建，不再兜底）
  if (hasDurability) {
    settings.push(`        .durability(${Math.floor(i.properties.maxDamage)})`)
  }
  if (i.properties.rarity !== 'common') {
    settings.push(`        .rarity(Rarity.${i.properties.rarity.toUpperCase()})`)
  }
  if (i.properties.fireproof) settings.push('        .fireResistant()')

  if (i.itemType === 'food' && i.food) {
    const f = i.food
    settings.push('        .food(new FoodProperties.Builder()')
    settings.push(`            .nutrition(${Math.floor(f.hunger)})`)
    settings.push(`            .saturationModifier(${fmtFloat(f.saturation)})`)
    if (f.alwaysEdible) settings.push('            .alwaysEdible()')
    if (f.meat || f.snack || f.effects.length > 0) {
      // 26.x 肉类（狼可食）与药水效果已迁入 Consumable 数据组件，未确证写法 → 先跳过
      settings.push('            // TODO 26.x 肉类/药水效果走数据组件（Consumable），暂不生成')
    }
    settings.push('            .build())')
  }

  return `    ${comment}
    public static final ${ctor} ${toJavaConst(i.id)} = new ${ctor}(${itemPropertiesExpr(ctx.mcVersion)}
${settings.join('\n')});`
}

function fabricMojmapModItemsJava(
  ctx: ModContext,
  blocks: GeneratorBlock[],
  items: ItemSchema[],
  entities: EntitySchema[]
): string {
  const eggEntities = entities.filter((e) => e.spawnEgg.enabled)
  const needRarity = items.some((i) => i.properties.rarity !== 'common')
  const needFood = items.some((i) => i.itemType === 'food')
  const toolItems = items.filter((i) => !i.customClass && i.itemType === 'tool' && i.tool)
  const armorItems = items.filter((i) => !i.customClass && i.itemType === 'armor')

  const blockItemFields = blocks.map((b) => {
    const name = oneLine(b.displayName)
    const setId = setIdCallExpr(ctx.mcVersion, 'ITEM', ctx.modClassName, b.id)
    return `    /** ${name}（方块物品） */
    public static final BlockItem ${toJavaConst(b.id)} = new BlockItem(
        ModBlocks.${toJavaConst(b.id)}, ${itemPropertiesExpr(ctx.mcVersion)}${setId ? `\n            ${setId}` : ''}
    );`
  })

  const itemFields = items.map((i) => fabricMojmapItemField(ctx, i))

  // 26.x 刷怪蛋：SpawnEggItem(Properties)，实体类型经 Properties.spawnEgg(EntityType) 指定，
  // 颜色已数据驱动（不再有主/副色构造参数）
  const eggFields = eggEntities.map((e) => {
    const name = oneLine(e.displayName.zh_cn || e.id)
    const setId = setIdCallExpr(ctx.mcVersion, 'ITEM', ctx.modClassName, `${e.id}_spawn_egg`)
    return `    /** ${name}刷怪蛋 */
    public static final Item ${toJavaConst(e.id)}_SPAWN_EGG = new SpawnEggItem(
        ${itemPropertiesExpr(ctx.mcVersion)}${setId ? `\n            ${setId}` : ''}
            .spawnEgg(ModEntities.${toJavaConst(e.id)})
    );`
  })

  const fields = [...blockItemFields, ...itemFields, ...eggFields].join('\n\n')
  const itemRegConst = registriesConst(ctx.mcVersion, 'ITEM')
  const blockRegs = blocks.map(
    (b) =>
      `        Registry.register(${itemRegConst}, ${ctx.modClassName}.id("${b.id}"), ${toJavaConst(b.id)});`
  )
  const itemRegs = items.map(
    (i) =>
      `        Registry.register(${itemRegConst}, ${ctx.modClassName}.id("${i.id}"), ${toJavaConst(i.id)});`
  )
  const eggRegs = eggEntities.map(
    (e) =>
      `        Registry.register(${itemRegConst}, ${ctx.modClassName}.id("${e.id}_spawn_egg"), ${toJavaConst(e.id)}_SPAWN_EGG);`
  )

  const total = blocks.length + items.length + eggEntities.length
  const needItemImport = total > 0
  const customImports = items
    .filter((i) => i.customClass)
    .map((i) => `import ${i.customClass};\n`)
    .join('')

  const imports = `import ${ctx.packageName}.${ctx.modClassName};
${total > 0 ? registryImports(ctx.mcVersion) : ''}${total > 0 ? resourceKeyImport(ctx.mcVersion) : ''}${
    blocks.length > 0 ? blockItemClassImport(ctx.mcVersion) : ''
  }${needItemImport ? itemClassImport(ctx.mcVersion) : ''}${
    needRarity ? rarityImport(ctx.mcVersion) : ''
  }${needFood ? 'import net.minecraft.world.food.FoodProperties;\n' : ''}${
    toolItems.length > 0 ? 'import net.minecraft.world.item.ToolMaterial;\n' : ''
  }${
    armorItems.length > 0
      ? 'import net.minecraft.world.item.equipment.ArmorMaterials;\nimport net.minecraft.world.item.equipment.ArmorType;\n'
      : ''
  }${eggEntities.length > 0 ? 'import net.minecraft.world.item.SpawnEggItem;\n' : ''}${customImports}`

  return `package ${ctx.packageName}.registry;

${imports}
/**
 * ${GENERATED_BANNER}
 */
public class ModItems {
${fields || '    // 暂无由可视化编辑器管理的物品'}

    public static void register() {
${[...blockRegs, ...itemRegs, ...eggRegs].join('\n') || '        // no managed items'}
    }
}
`
}

function fabricModItemsJava(
  ctx: ModContext,
  blocks: GeneratorBlock[],
  items: ItemSchema[],
  entities: EntitySchema[]
): string {
  // 仅为已注册（已建模）且启用刷怪蛋的实体生成 SpawnEggItem
  const eggEntities = entities.filter((e) => e.spawnEgg.enabled)
  const needRarity = items.some((i) => i.properties.rarity !== 'common')
  const needFood = items.some((i) => i.itemType === 'food')
  const needFoodEffect = items.some(
    (i) => i.itemType === 'food' && (i.food?.effects.length ?? 0) > 0
  )
  const toolItems = items.filter((i) => i.itemType === 'tool' && i.tool)
  const armorItems = items.filter((i) => i.itemType === 'armor')
  const usedToolClasses = [...new Set(toolItems.map((i) => TOOL_CLASSES[i.tool!.toolKind].cls))]

  // P0-1：legacy（<1.19.3）无 ItemGroups/ItemGroupEvents，入组走 Settings.group + 常量映射
  const legacyRegistry = isLegacyRegistry(ctx.mcVersion)
  const legacyGroup = (group: FabricItemGroup): string => legacyRegistry ? LEGACY_ITEM_GROUP[group] : ''

  const blockItemFields = blocks.map((b) => {
    const name = oneLine(b.displayName)
    const group = legacyGroup('BUILDING_BLOCKS')
    return `    /** ${name}（方块物品） */
    public static final BlockItem ${toJavaConst(b.id)} = new BlockItem(
        ModBlocks.${toJavaConst(b.id)}, new Item.Settings()${group ? `\n            .group(ItemGroup.${group})` : ''}
    );`
  })

  const itemFields = items.map((i) =>
    fabricItemField(i, ctx.mcVersion, legacyGroup(resolveFabricItemGroup(i)) || undefined)
  )
  // 1.21.5 起刷怪蛋颜色数据驱动化（javap 实证）：SpawnEggItem 构造器收窄为 (EntityType, Settings)
  const eggColorless = compareMcVersions(ctx.mcVersion, '1.21.5') >= 0
  const eggFields = eggEntities.map((e) => {
    const primary = parseInt((e.properties.primaryColor ?? '#000000').replace('#', ''), 16)
    const secondary = parseInt((e.properties.secondaryColor ?? '#000000').replace('#', ''), 16)
    const name = oneLine(e.displayName.zh_cn || e.id)
    const group = legacyGroup('SPAWN_EGGS')
    const colorArgs = eggColorless ? '' : `${primary}, ${secondary}, `
    return `    /** ${name}刷怪蛋 */
    public static final Item ${toJavaConst(e.id)}_SPAWN_EGG = new SpawnEggItem(
        ModEntities.${toJavaConst(e.id)}, ${colorArgs}new Item.Settings()${group ? `\n            .group(ItemGroup.${group})` : ''}
    );`
  })
  const fields = [...blockItemFields, ...itemFields, ...eggFields].join('\n\n')

  const itemRegConst = registriesConst(ctx.mcVersion, 'ITEM')
  const blockRegs = blocks.map(
    (b) =>
      `        Registry.register(${itemRegConst}, ${ctx.modClassName}.id("${b.id}"), ${toJavaConst(b.id)});`
  )
  const itemRegs = items.map(
    (i) =>
      `        Registry.register(${itemRegConst}, ${ctx.modClassName}.id("${i.id}"), ${toJavaConst(i.id)});`
  )
  const eggRegs = eggEntities.map(
    (e) =>
      `        Registry.register(${itemRegConst}, ${ctx.modClassName}.id("${e.id}_spawn_egg"), ${toJavaConst(e.id)}_SPAWN_EGG);`
  )

  const total = blocks.length + items.length + eggEntities.length
  const needItemImport = total > 0

  // 创造模式物品组分发：方块物品→建筑方块；刷怪蛋→刷怪蛋；其余按物品类型映射
  const groupEntries = new Map<FabricItemGroup, string[]>()
  const pushGroup = (group: FabricItemGroup, constName: string): void => {
    const list = groupEntries.get(group)
    if (list) list.push(constName)
    else groupEntries.set(group, [constName])
  }
  for (const b of blocks) pushGroup('BUILDING_BLOCKS', toJavaConst(b.id))
  for (const i of items) pushGroup(resolveFabricItemGroup(i), toJavaConst(i.id))
  for (const e of eggEntities) pushGroup('SPAWN_EGGS', `${toJavaConst(e.id)}_SPAWN_EGG`)

  // legacy（<1.19.3）已在字段构造走 .group(ItemGroup.X)，不生成 ItemGroupEvents 事件注册
  const groupEvents = legacyRegistry
    ? ''
    : [...groupEntries.entries()]
        .map(
          ([group, names]) => `        ItemGroupEvents.modifyEntriesEvent(ItemGroups.${group}).register(entries -> {
${names.map((n) => `            entries.add(${n});`).join('\n')}
        });`
        )
        .join('\n')

  // 1.20.5 物品组件重构 / 1.21 Identifier 构造器私有化 / <1.20 护甲走 EquipmentSlot（Yarn javap 实证）
  const componentRefactor = compareMcVersions(ctx.mcVersion, '1.20.5') >= 0
  const gte121 = compareMcVersions(ctx.mcVersion, '1.21') >= 0
  const equipmentRefactor = compareMcVersions(ctx.mcVersion, '1.21.4') >= 0
  // 1.21.5+ 原版工具/盔甲子类已删除（数据组件化），相关 import 必须跳过
  const dataComponentItems = compareMcVersions(ctx.mcVersion, '1.21.5') >= 0
  const legacyArmorSlot = compareMcVersions(ctx.mcVersion, '1.20') < 0

  const toolImports = dataComponentItems
    ? ''
    : usedToolClasses.map((c) => `import net.minecraft.item.${c};\n`).join('')
  const imports = `import ${ctx.packageName}.${ctx.modClassName};
${total > 0 ? registryImports(ctx.mcVersion) : ''}${
    blocks.length > 0
      ? `import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
`
      : needItemImport
        ? 'import net.minecraft.item.Item;\n'
        : ''
  }${
    total > 0
      ? legacyRegistry
        ? 'import net.minecraft.item.ItemGroup;\n'
        : `import net.minecraft.item.ItemGroups;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
`
      : ''
  }${needRarity ? 'import net.minecraft.util.Rarity;\n' : ''}${
    needFood
      ? componentRefactor
        ? 'import net.minecraft.component.type.FoodComponent;\n'
        : 'import net.minecraft.item.FoodComponent;\n'
      : ''
  }${
    needFoodEffect
      ? `import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
`
      : ''
  }${toolItems.length > 0 ? `import net.minecraft.item.${equipmentRefactor ? 'ToolMaterial' : 'ToolMaterials'};\n${toolImports}${
    componentRefactor && !equipmentRefactor
      ? `import net.minecraft.component.type.AttributeModifiersComponent;
	import net.minecraft.component.type.AttributeModifierSlot;
	import net.minecraft.entity.attribute.EntityAttributeModifier;
	import net.minecraft.entity.attribute.EntityAttributes;
	${gte121 ? 'import net.minecraft.util.Identifier;\n' : ''}`
      : ''
  }` : ''}${
    armorItems.length > 0
      ? `${dataComponentItems ? '' : 'import net.minecraft.item.ArmorItem;\n'}
	import ${equipmentRefactor ? 'net.minecraft.item.equipment.ArmorMaterials' : 'net.minecraft.item.ArmorMaterials'};
	${equipmentRefactor ? 'import net.minecraft.item.equipment.EquipmentType;\n' : ''}${legacyArmorSlot ? 'import net.minecraft.entity.EquipmentSlot;\n' : ''}`
      : ''
  }${eggEntities.length > 0 ? 'import net.minecraft.item.SpawnEggItem;\n' : ''}${
    items.some((i) => i.customClass)
      ? items
          .filter((i) => i.customClass)
          .map((i) => `import ${i.customClass};\n`)
          .join('')
      : ''
  }`

  return `package ${ctx.packageName}.registry;

${imports}
/**
 * ${GENERATED_BANNER}
 */
public class ModItems {
${fields || '    // 暂无由可视化编辑器管理的物品'}

    public static void register() {
${[...blockRegs, ...itemRegs, ...eggRegs].join('\n') || '        // no managed items'}
${groupEvents ? `        // 加入创造模式物品栏（1.20.1 起未加入 ItemGroup 的物品在创造菜单/搜索页均不可见）
${groupEvents}` : ''}
    }
}
`
}
