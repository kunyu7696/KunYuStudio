/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.18.2）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.18.2 loaderVersion=40.2.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.18.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.18.2 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.18.2/worldgen/ore_feature.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.worldgen;

import com.example.examplemod.ModMain;
import net.minecraft.core.Holder;
import net.minecraft.core.Registry; // 版本差异：net.minecraft.core.registries.Registries 类 1.19 才引入，1.18.2 用 net.minecraft.core.Registry
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.VerticalAnchor;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.levelgen.feature.Feature;
import net.minecraft.world.level.levelgen.feature.OreFeatures;
import net.minecraft.world.level.levelgen.feature.configurations.OreConfiguration; // 版本差异：OreFeatureConfig 于 1.18 改名 OreConfiguration
import net.minecraft.world.level.levelgen.placement.BiomeFilter;
import net.minecraft.world.level.levelgen.placement.CountPlacement;
import net.minecraft.world.level.levelgen.placement.HeightRangePlacement;
import net.minecraft.world.level.levelgen.placement.InSquarePlacement;
import net.minecraft.world.level.levelgen.placement.PlacedFeature;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.RegistryObject;

import java.util.List;

/**
 * 矿物生成（Forge 1.18.2）。
 * 要点：
 * - 代码方式：DeferredRegister 分别登记 ConfiguredFeature 与 PlacedFeature
 *   （1.18.2 用 Registry.CONFIGURED_FEATURE_REGISTRY / PLACED_FEATURE_REGISTRY 键）。
 * - 仅注册两个 Feature 还不够，必须再注入群系。1.18.2 没有 forge:biome_modifier JSON（1.19+ 才有），
 *   用游戏总线的 BiomeLoadingEvent：
 *     @SubscribeEvent
 *     public static void onBiomeLoad(BiomeLoadingEvent event) {
 *         if (event.getCategory() != Biome.BiomeCategory.NETHER && event.getCategory() != Biome.BiomeCategory.THEEND) {
 *             event.getGeneration().addFeature(GenerationStep.Decoration.UNDERGROUND_ORES,
 *                     ORE_EXAMPLE_PF.getHolder().orElseThrow()); // RegistryObject#getHolder 取 Optional<Holder>
 *         }
 *     }
 * - 更推荐 data/examplemod/worldgen/ 下 configured_feature + placed_feature JSON；本模板展示代码路径便于理解。
 */
public class ModWorldGen {
    public static final DeferredRegister<ConfiguredFeature<?, ?>> CONFIGURED_FEATURES =
            DeferredRegister.create(Registry.CONFIGURED_FEATURE_REGISTRY, ModMain.MOD_ID);
    public static final DeferredRegister<PlacedFeature> PLACED_FEATURES =
            DeferredRegister.create(Registry.PLACED_FEATURE_REGISTRY, ModMain.MOD_ID);

    /** 矿脉形状与矿物：size 9，替换石系方块，替换为铁块（示例）。 */
    public static final RegistryObject<ConfiguredFeature<?, ?>> ORE_EXAMPLE_CF =
            CONFIGURED_FEATURES.register("ore_example",
                    () -> new ConfiguredFeature<>(Feature.ORE, new OreConfiguration(
                            OreFeatures.STONE_ORE_REPLACEABLES, // 版本差异：Target 常量 1.18+ 移到 OreFeatures 类
                            Blocks.IRON_BLOCK.defaultBlockState(),
                            9)));

    /** 放置规则：每区块 20 次尝试，Y -64~64 均匀分布。 */
    public static final RegistryObject<PlacedFeature> ORE_EXAMPLE_PF =
            PLACED_FEATURES.register("ore_example",
                    () -> new PlacedFeature(Holder.direct(ORE_EXAMPLE_CF.get()), List.of(
                            CountPlacement.of(20),                       // 每区块尝试次数
                            InSquarePlacement.spread(),                  // 水平随机扩散
                            HeightRangePlacement.uniform(
                                    VerticalAnchor.bottom(),             // 世界底部
                                    VerticalAnchor.absolute(64)),        // Y=64
                            BiomeFilter.biome())));                      // 尾部必须带生物群系过滤
}
