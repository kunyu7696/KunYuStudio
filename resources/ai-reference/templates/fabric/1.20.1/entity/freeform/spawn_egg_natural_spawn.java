// ============================================================================
// KunYuEcosystem AI Reference v3.3 | fabric/1.20.1/entity/freeform/spawn_egg_natural_spawn.java | mapping: Yarn | provenance: hand-curated（实体自由代码范式·刷怪蛋与自然生成）
// ============================================================================
package com.example.mod.entity;

import net.fabricmc.fabric.api.biome.v1.BiomeModifications;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectors;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.entity.SpawnRestriction;
import net.minecraft.item.Item;
import net.minecraft.item.SpawnEggItem;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
import net.minecraft.world.Heightmap;
import net.minecraft.world.biome.BiomeKeys;

/**
 * 刷怪蛋 + 自然生成注册范式。
 * Fabric 1.20.1 / Yarn。
 *
 * 要点：
 * 1. 1.20.1 用原版 SpawnEggItem(EntityType, 主色, 副色, Item.Settings)——
 *    FabricSpawnEggItem 不存在于任何版本 fabric-api，禁止编造。
 * 2. 自然生成两步缺一不可：
 *    ① SpawnRestriction.register 声明生成位置/高度图/谓词（地面实体通常
 *       ON_GROUND + MOTION_BLOCKING_NO_LEAVES + 下方为实心方块）；
 *    ② BiomeModifications.addSpawn 把实体加进目标群系的生成表
 *       （weight 权重、min/max 组大小）。
 * 3. SpawnGroup 必须语义正确：MONSTER 走 hostile 上限与光照规则，
 *    CREATURE 走被动生物规则；选错会出现「一切正常但永远不刷」。
 * 4. registerNaturalSpawn() 在 ModInitializer.onInitialize() 中调用。
 */
public final class ExampleSpawns {

    private ExampleSpawns() {}

    /** 刷怪蛋：主/副色为 0xRRGGBB；创造模式物品栏用 ItemGroupEvents 另行挂载 */
    public static final Item EXAMPLE_SPAWN_EGG = Registry.register(
        Registries.ITEM,
        new Identifier("examplemod", "example_spawn_egg"),
        new SpawnEggItem(ExampleEntity.EXAMPLE_ENTITY, 0x2B2B3A, 0xE8C468, new Item.Settings())
    );

    public static void registerNaturalSpawn() {
        // ① 生成限制：地面、无树叶遮挡、脚下实心
        SpawnRestriction.register(
            ExampleEntity.EXAMPLE_ENTITY,
            SpawnRestriction.Location.ON_GROUND,
            Heightmap.Type.MOTION_BLOCKING_NO_LEAVES,
            (type, world, reason, pos, random) ->
                world.getBlockState(pos.down()).isSolidBlock(world, pos.down())
        );
        // ② 加入平原/森林群系生成表：权重 20、每组 1~1 只
        BiomeModifications.addSpawn(
            BiomeSelectors.includeByKey(BiomeKeys.PLAINS, BiomeKeys.FOREST),
            SpawnGroup.CREATURE,
            ExampleEntity.EXAMPLE_ENTITY,
            20, 1, 1
        );
    }
}
