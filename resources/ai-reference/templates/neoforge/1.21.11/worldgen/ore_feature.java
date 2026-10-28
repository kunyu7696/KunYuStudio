/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.11）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.11 loaderVersion=21.11.45
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.11 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.11 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.11/worldgen/ore_feature.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.worldgen;

import com.example.examplemod.ModMain;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.VerticalAnchor;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.levelgen.feature.Feature;
import net.minecraft.world.level.levelgen.feature.OreFeatures;
import net.minecraft.world.level.levelgen.feature.configurations.OreConfiguration;
import net.minecraft.world.level.levelgen.placement.BiomeFilter;
import net.minecraft.world.level.levelgen.placement.CountPlacement;
import net.minecraft.world.level.levelgen.placement.HeightRangePlacement;
import net.minecraft.world.level.levelgen.placement.InSquarePlacement;
import net.minecraft.world.level.levelgen.placement.PlacedFeature;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

import java.util.List;

/**
 * 矿物生成（NeoForge 1.21.11）。
 * 要点：
 * - 代码方式：DeferredRegister 分别登记 ConfiguredFeature 与 PlacedFeature
 *   （Registries.CONFIGURED_FEATURE / PLACED_FEATURE）。
 * - 仅注册两个 Feature 还不够，必须再用 biome modifier JSON 注入群系：
 *     data/examplemod/neoforge/biome_modifier/add_ore_example.json
 *     {"type":"neoforge:add_features","biomes":"#minecraft:is_overworld","features":"examplemod:ore_example","step":"underground_ores"}
 * - 更推荐 runData 数据生成直接产出 JSON；本模板展示代码路径便于理解。
 */
public class ModWorldGen {
    public static final DeferredRegister<ConfiguredFeature<?, ?>> CONFIGURED_FEATURES =
            DeferredRegister.create(Registries.CONFIGURED_FEATURE, ModMain.MOD_ID);
    public static final DeferredRegister<PlacedFeature> PLACED_FEATURES =
            DeferredRegister.create(Registries.PLACED_FEATURE, ModMain.MOD_ID);

    /** 矿脉形状与矿物：size 9，替换石系方块，替换为铁块（示例）。 */
    public static final DeferredHolder<ConfiguredFeature<?, ?>, ConfiguredFeature<?, ?>> ORE_EXAMPLE_CF =
            CONFIGURED_FEATURES.register("ore_example",
                    () -> new ConfiguredFeature<>(Feature.ORE, new OreConfiguration(
                            // Mojmap 类名为 OreConfiguration（OreFeatureConfig 是 Yarn 名）；
                            // 规则测试常量 STONE_ORE_REPLACEABLES 在 OreFeatures 类上
                            OreFeatures.STONE_ORE_REPLACEABLES,
                            Blocks.IRON_BLOCK.defaultBlockState(),
                            9)));

    /** 放置规则：每区块 20 次尝试，Y -64~64 均匀分布。 */
    public static final DeferredHolder<PlacedFeature, PlacedFeature> ORE_EXAMPLE_PF =
            PLACED_FEATURES.register("ore_example",
                    () -> new PlacedFeature(Holder.direct(ORE_EXAMPLE_CF.get()), List.of(
                            CountPlacement.of(20),                       // 每区块尝试次数
                            InSquarePlacement.spread(),                  // 水平随机扩散
                            HeightRangePlacement.uniform(
                                    VerticalAnchor.bottom(),             // 世界底部
                                    VerticalAnchor.absolute(64)),        // Y=64
                            BiomeFilter.biome())));                      // 尾部必须带生物群系过滤
}
