// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/entity/spawn_egg_natural_spawn.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.world.entity.SpawnPlacements;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 刷怪蛋 + 自然生成注册范式。
 * Forge 1.20.1 / Mojmap。
 *
 * 要点：
 * 1. 1.20.1 用原版 SpawnEggItem(EntityType, 主色, 副色, Item.Properties)；
 *    Supplier 延迟取值避免注册顺序死锁。
 * 2. 自然生成两步缺一不可：
 *    ① SpawnPlacements.register 声明生成位置/高度图/谓词（FMLCommonSetupEvent 内），
 *    ② 数据包 biome modifier（data/<modid>/forge/biome_modifier/*.json）把实体加进群系生成表。
 *    只做 ① 会出现「注册正常但永远不刷」。
 * 3. MobCategory 必须语义正确：MONSTER 走 hostile 上限与光照规则，
 *    CREATURE 走被动生物规则；选错同样表现为「永远不刷」。
 * 4. 群系生成表必须用 JSON 声明，禁止在代码里直接改 Biome。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)
public final class ModSpawns {

    public static final DeferredRegister<Item> SPAWN_EGGS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_SPAWN_EGG = SPAWN_EGGS.register("example_spawn_egg",
            () -> new net.minecraft.world.item.SpawnEggItem(() -> ModEntities.EXAMPLE_ENTITY.get(),
                    0x2B2B3A, 0xE8C468, new Item.Properties()));

    private ModSpawns() {}

    @SubscribeEvent
    public static void onCommonSetup(FMLCommonSetupEvent event) {
        // ① 生成限制：地面、无树叶遮挡、脚下实心
        event.enqueueWork(() -> SpawnPlacements.register(
                ModEntities.EXAMPLE_ENTITY.get(),
                SpawnPlacements.Type.ON_GROUND,
                Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
                (type, level, reason, pos, random) -> level.getBlockState(pos.below()).isSolid()));
    }
}

/* ============================================================================
 * ② 群系生成表（src/main/resources/data/<modid>/forge/biome_modifier/add_example_spawn.json）
 * ============================================================================
 *
 * {
 *   "type": "forge:add_spawns",
 *   "biomes": ["minecraft:plains", "minecraft:forest"],
 *   "spawners": [
 *     { "type": "examplemod:example_entity", "weight": 20, "minCount": 1, "maxCount": 1 }
 *   ]
 * }
 */
