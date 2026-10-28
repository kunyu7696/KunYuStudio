// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/entity/spawn_egg_natural_spawn.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.world.entity.SpawnPlacements;
import net.minecraft.world.level.levelgen.Heightmap;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.SpawnPlacementRegisterEvent;

/**
 * 刷怪蛋 + 自然生成注册范式。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. 刷怪蛋沿用 DeferredSpawnEggItem（延迟取 EntityType，见 entity/spawn_egg_item.java）。
 * 2. 自然生成两步缺一不可：
 *    ① SpawnPlacementRegisterEvent 声明生成位置/高度图/谓词，
 *    ② 数据包 biome modifier（data/<modid>/neoforge/biome_modifier/*.json）把实体加进群系生成表。
 * 3. MobCategory 必须语义正确，选错表现为「一切正常但永远不刷」。
 * 4. 群系生成表必须用 JSON 声明，禁止在代码里直接改 Biome。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
public final class ModSpawns {

    private ModSpawns() {}

    @SubscribeEvent
    public static void registerSpawnPlacements(SpawnPlacementRegisterEvent event) {
        // ① 生成限制：地面、无树叶遮挡、脚下实心
        event.register(
                ModEntities.EXAMPLE_ENTITY.get(),
                SpawnPlacements.Type.ON_GROUND,
                Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
                (type, level, reason, pos, random) -> level.getBlockState(pos.below()).isSolid(),
                SpawnPlacementRegisterEvent.Operation.REPLACE);
    }
}

/* ============================================================================
 * ② 群系生成表（src/main/resources/data/<modid>/neoforge/biome_modifier/add_example_spawn.json）
 * ============================================================================
 *
 * {
 *   "type": "neoforge:add_spawns",
 *   "biomes": ["minecraft:plains", "minecraft:forest"],
 *   "spawners": [
 *     { "type": "examplemod:example_entity", "weight": 20, "minCount": 1, "maxCount": 1 }
 *   ]
 * }
 */
