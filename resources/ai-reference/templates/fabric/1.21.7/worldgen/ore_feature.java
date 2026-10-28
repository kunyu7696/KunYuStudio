/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.7）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.7 loaderVersion=0.19.5
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.7 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.7 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.7/worldgen/ore_feature.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.worldgen;
import net.fabricmc.fabric.api.biome.v1.BiomeModifications;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectors;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.util.Identifier;
import net.minecraft.world.gen.GenerationStep;
import net.minecraft.world.gen.feature.ConfiguredFeature;
import net.minecraft.world.gen.feature.Feature;
// [版本修正] OreFeatureConfig.Rules 仅 1.16.x 有；≥1.18 用 OreFeatureConfig.createTarget + TagMatchRuleTest
import net.minecraft.world.gen.feature.OreFeatureConfig;
import net.minecraft.structure.rule.TagMatchRuleTest;
import net.minecraft.registry.tag.BlockTags;
import net.minecraft.world.gen.placementmodifier.CountPlacementModifier;
import net.minecraft.world.gen.placementmodifier.HeightRangePlacementModifier;
import net.minecraft.world.gen.placementmodifier.SquarePlacementModifier;
import net.minecraft.world.gen.YOffset;

import java.util.List;
/**
 *  - Fabric 1.21.7
 *
 *
 * 1.  ConfiguredFeature
 * 2.  PlacedFeature
 * 3.  BiomeModifications
 *
 * 1.21.7
 *   - ConfiguredFeature: ""
 *   - PlacedFeature: ""
 *
 * :
 *   ConfiguredFeature ->  Registries.CONFIGURED_FEATURE
 *   PlacedFeature     ->  Registries.PLACED_FEATURE
 *   BiomeModifications ->  PlacedFeature
 *
 * :
 * -  ConfiguredFeature PlacedFeature
 * - PlacedFeature  RegistryEntry<ConfiguredFeature>  ConfiguredFeature
 * - BiomeModifications.addFeature  RegistryKey<PlacedFeature>  PlacedFeature
 * - OreFeatureConfig.Rules.STONE_ORE_REPLACEABLES
 *    NETHERRACK ENDSTONE
 * - GenerationStep.Feature.UNDERGROUND_ORES
 * - (size) 64 3~12
 */
public class ModWorldGen {
    // ConfiguredFeature  RegistryKey
    public static final RegistryKey<ConfiguredFeature<?, ?>> ORE_EXAMPLE_CF =
        RegistryKey.of(RegistryKeys.CONFIGURED_FEATURE, new Identifier("examplemod", "ore_example"));
    // PlacedFeature  RegistryKey
    public static final RegistryKey<net.minecraft.world.gen.feature.PlacedFeature> ORE_EXAMPLE_PF =
        RegistryKey.of(RegistryKeys.PLACED_FEATURE, new Identifier("examplemod", "ore_example"));
    /**
     *
     * ModInitializer onInitialize()
     */
    public static void register() {
        // ================================================================
        // 1.  ConfiguredFeature
        // ================================================================
        // 1:
        // 2:  BlockState
        // 3:
        OreFeatureConfig oreConfig = new OreFeatureConfig(
            // [版本修正] ≥1.18 用 List<OreFeatureConfig.Target>
            java.util.List.of(
                OreFeatureConfig.createTarget(
                    new TagMatchRuleTest(BlockTags.STONE_ORE_REPLACEABLES),
                    net.minecraft.block.Blocks.IRON_BLOCK.getDefaultState()
                )
            ),
            9  //
        );
        //  ConfiguredFeature
        ConfiguredFeature<?, ?> configuredFeature = new ConfiguredFeature<>(
            Feature.ORE,    // :
            oreConfig        //
        );
        //  Registries.CONFIGURED_FEATURE
        Registry.register(
            Registries.CONFIGURED_FEATURE,
            new Identifier("examplemod", "ore_example"),
            configuredFeature
        );
        // ================================================================
        // 2.  PlacedFeature
        // ================================================================
        // PlacedFeature  RegistryEntry<ConfiguredFeature>

        //  RegistryEntry.of()  ConfiguredFeature
        RegistryEntry<ConfiguredFeature<?, ?>> cfEntry = RegistryEntry.of(configuredFeature);
        List<net.minecraft.world.gen.placementmodifier.PlacementModifier> placementModifiers = List.of(
            // :
            CountPlacementModifier.of(20),
            // :
            SquarePlacementModifier.of(),
            // :  Y=-64  Y=64
            HeightRangePlacementModifier.uniform(
                YOffset.getBottom(),  // Y=-64
                YOffset.fixed(64)     // Y=64
            )
        );
        //  PlacedFeature
        net.minecraft.world.gen.feature.PlacedFeature placedFeature =
            new net.minecraft.world.gen.feature.PlacedFeature(
                cfEntry,            // ConfiguredFeature
                placementModifiers  //
            );
        //  Registries.PLACED_FEATURE
        Registry.register(
            Registries.PLACED_FEATURE,
            new Identifier("examplemod", "ore_example"),
            placedFeature
        );
        // ================================================================
        // 3.  BiomeModifications
        // ================================================================
        BiomeModifications.addFeature(
            // :
            BiomeSelectors.foundInOverworld(),
            // :
            GenerationStep.Feature.UNDERGROUND_ORES,
            // PlacedFeature  RegistryKey
            RegistryKey.of(
                RegistryKeys.PLACED_FEATURE,
                new Identifier("examplemod", "ore_example")
            )
        );
    }
}
/**
 * ================================================================
 *
 * ================================================================
 *
 * BiomeSelectors :
 *
 * BiomeSelectors.all()
 * BiomeSelectors.foundInOverworld()
 * BiomeSelectors.foundInNether()
 * BiomeSelectors.foundInTheEnd()
 * BiomeSelectors.includeByKey(keys)       RegistryKey
 * BiomeSelectors.tag(tag)
 *
 * :
 * BiomeSelectors.foundInOverworld().and(context -> ...)
 * BiomeSelectors.foundInOverworld().or(BiomeSelectors.foundInNether())
 *
 * ================================================================
 *
 * ================================================================
 *
 * GenerationStep.Feature:
 * - RAW_GENERATION
 * - LAKES
 * - LOCAL_MODIFICATIONS
 * - UNDERGROUND_STRUCTURES

 * - SURFACE_STRUCTURES
 * - STRONGHOLDS
 * - UNDERGROUND_ORES
 * - UNDERGROUND_DECORATION
 * - FLUID_SPRINGS
 * - VEGETAL_DECORATION
 * - TOP_LAYER_MODIFICATION
 */
