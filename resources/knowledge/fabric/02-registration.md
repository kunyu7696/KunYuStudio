# 注册系统（Registries）

## 核心 API

- `net.minecraft.registry.Registries`：静态注册表集合（BLOCK / ITEM / ENTITY_TYPE / BLOCK_ENTITY_TYPE / SOUND_EVENT / PARTICLE_TYPE / SCREEN_HANDLER_TYPE …）
- `Registry.register(Registries.BLOCK, id, block)`：注册并返回实例
- `net.minecraft.util.Identifier`：注册名

## 注册方块与物品的标准模式

```java
public class ModBlocks {
    public static final Block RUBY_ORE = register("ruby_ore",
        new Block(AbstractBlock.Settings.create().mapColor(MapColor.STONE).strength(3.0f).requiresTool()));

    private static Block register(String name, Block block) {
        return Registry.register(Registries.BLOCK, new Identifier(MOD_ID, name), block);
    }
    public static void initialize() {}
}
```

- 方块必须再注册一个对应的 `BlockItem` 到 `Registries.ITEM`，否则无法在物品栏拿到
- `AbstractBlock.Settings`：`strength(hardness, resistance)`、`hardness()`、`sounds(BlockSoundGroup.METAL)`、`luminance(s -> 15)`、`nonOpaque()`、`slipperiness()`
- 物品设置 `new Item.Settings().rarity(Rarity.EPIC).maxCount(16).fireproof()`

## 物品组（创造模式标签页）

- 每个注册的 Item 必须加入 ItemGroup，否则创造模式不可见：
```java
ItemGroupEvents.modifyEntriesEvent(ItemGroups.INGREDIENTS)
    .register(entries -> entries.add(RUBY_ITEM));
```
- 自定义创造标签页：`Registry.register(Registries.ITEM_GROUP, id, FabricItemGroup.builder().icon(...).displayName(...).entries((ctx, s) -> s.add(...)).build())`

## 实体注册

```java
Registry.register(Registries.ENTITY_TYPE, new Identifier(MOD_ID, "goblin"),
    FabricEntityTypeBuilder.create(SpawnGroup.MONSTER, GoblinEntity::new)
        .dimensions(EntityDimensions.fixed(0.6f, 1.95f))
        .trackRangeBlocks(10).build());
```

- 属性必须注册：`FabricDefaultAttributeRegistry.register(ModEntities.GOBLIN, GoblinEntity.createAttributes())`
- 客户端渲染器：`EntityRendererRegistry.register(ModEntities.GOBLIN, GoblinRenderer::new)`，在 client 入口

## 静态字段初始化陷阱

- 注册帮助类的静态字段在类加载时触发注册，必须在 `onInitialize()` 中调用一次 `ModBlocks.initialize()` 强制类加载
- 顺序：方块 → BlockItem/物品 → 实体 → 在主入口统一 initialize

## 数据包注册（1.20.1 仍为代码注册）

- 1.20.1 的附魔、药水效果、声音事件仍是代码注册（`Registries.ENCHANTMENT` / `Registries.STATUS_EFFECT` / `Registries.SOUND_EVENT`）
- 世界生成内容（生物群系/特征/结构）走 RegistryKey + BiomeModifications API，不直接 register
