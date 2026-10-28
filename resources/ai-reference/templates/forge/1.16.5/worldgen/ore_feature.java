/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/worldgen/ore_feature.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.worldgen;

import com.example.examplemod.ModMain;
import net.minecraft.block.Blocks;
import net.minecraft.util.ResourceLocation; // 1.16.5：net.minecraft.util.ResourceLocation
import net.minecraft.util.registry.Registry;
import net.minecraft.util.registry.WorldGenRegistries; // 1.16.5 ConfiguredFeature 注册表
import net.minecraft.world.gen.GenerationStage;
import net.minecraft.world.gen.feature.ConfiguredFeature;
import net.minecraft.world.gen.feature.Feature;
import net.minecraft.world.gen.feature.OreFeatureConfig;
import net.minecraft.world.gen.placement.Placement;
import net.minecraft.world.gen.placement.TopSolidRangeConfig;
import net.minecraftforge.event.world.BiomeLoadingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * 矿物生成（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 1.16.5 没有 PlacedFeature/DeferredRegister 世界生成管线：构建 ConfiguredFeature 后
 *   直接 Registry.register 进 WorldGenRegistries.CONFIGURED_FEATURE，
 *   调用时机必须在 FMLCommonSetupEvent.enqueueWork（主线程，方块已注册）：
 *   主类 commonSetup 里 event.enqueueWork(ModWorldGen::registerConfiguredFeatures)。
 * - 群系注入用游戏总线的 BiomeLoadingEvent（1.16.5 没有 forge:biome_modifier——
 *   那是 1.19+ 的特性；本目录 biome_modifier.json 不适用于 1.16.5，仅作跨版本对照保留）。
 * - 链式 API：withConfiguration(配置) → withPlacement(Placement.RANGE.configure(...))
 *   → square() 水平扩散 → count(每区块次数)。TopSolidRangeConfig(底偏移, 顶偏移, 最大Y)。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID) // 默认 game 总线：BiomeLoadingEvent
public class ModWorldGen {

    /** 矿脉配置+放置：size 9，替换主世界石系，生成铁块（示例），每区块 20 次，Y 0~64。 */
    public static ConfiguredFeature<?, ?> ORE_EXAMPLE;

    /** 在 FMLCommonSetupEvent.enqueueWork 中调用（不能类加载时就构建：方块注册未完成）。 */
    public static void registerConfiguredFeatures() {
        ORE_EXAMPLE = Feature.ORE.withConfiguration(new OreFeatureConfig(
                        OreFeatureConfig.FillerBlockType.BASE_STONE_OVERWORLD, // 替换目标：主世界石系
                        Blocks.IRON_BLOCK.getDefaultState(),                   // 1.17+ 改名 defaultBlockState()
                        9))                                                    // 矿脉大小
                .withPlacement(Placement.RANGE.configure(new TopSolidRangeConfig(0, 0, 64))) // Y 0~64
                .square()   // 水平随机扩散
                .count(20); // 每区块尝试次数
        Registry.register(WorldGenRegistries.CONFIGURED_FEATURE,
                new ResourceLocation(ModMain.MOD_ID, "ore_example"), ORE_EXAMPLE);
    }

    /** 群系加载时把矿物挂进 UNDERGROUND_ORES 阶段。 */
    @SubscribeEvent
    public static void onBiomeLoad(BiomeLoadingEvent event) {
        event.getGeneration()
                .getFeatures(GenerationStage.Decoration.UNDERGROUND_ORES)
                .add(() -> ORE_EXAMPLE);
        // 限定主世界可加：if (event.getCategory() != Biome.Category.NETHER
        //                  && event.getCategory() != Biome.Category.THEEND) { ... }
    }
}
