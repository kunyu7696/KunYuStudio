/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.16.5）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.16.5 loaderVersion=0.14.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.16.5 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.16.5 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.16.5/worldgen/ore_feature.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.worldgen;
// [版本修正] 1.16.5 无 PlacedFeature / RegistryKeys / Registries / HeightRangePlacementModifier，
// 世界生成走 Decorator.RANGE + BuiltinRegistries.CONFIGURED_FEATURE
import net.fabricmc.fabric.api.biome.v1.BiomeModifications;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectors;
import net.minecraft.util.Identifier;
import net.minecraft.util.registry.BuiltinRegistries;
import net.minecraft.util.registry.Registry;
import net.minecraft.util.registry.RegistryKey;
import net.minecraft.world.gen.GenerationStep;
import net.minecraft.world.gen.decorator.Decorator;
import net.minecraft.world.gen.decorator.RangeDecoratorConfig;
import net.minecraft.world.gen.feature.ConfiguredFeature;
import net.minecraft.world.gen.feature.Feature;
import net.minecraft.world.gen.feature.OreFeatureConfig;
/**
 *  - Fabric 1.16.5
 *
 *
 * 1.  ConfiguredFeature
 * 2.  PlacedFeature
 * 3.  BiomeModifications
 *
 * 1.16.5
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
    // [版本修正] 1.16.5 用 Registry.CONFIGURED_FEATURE_WORLDGEN 作 RegistryKey 的注册表引用
    public static final RegistryKey<ConfiguredFeature<?, ?>> ORE_EXAMPLE_CF =
        RegistryKey.of(Registry.CONFIGURED_FEATURE_WORLDGEN, new Identifier("examplemod", "ore_example"));

    public static void register() {
        // 1.16.5 OreFeatureConfig：(RuleTest, BlockState, int size)
        // Rules.BASE_STONE_OVERWORLD 为 1.16.5 的石头匹配规则
        OreFeatureConfig oreConfig = new OreFeatureConfig(
            OreFeatureConfig.Rules.BASE_STONE_OVERWORLD,
            net.minecraft.block.Blocks.IRON_BLOCK.getDefaultState(),
            9  // size
        );
        // ConfiguredFeature：ORE.configure(...).decorate(Decorator.RANGE.configure(...)).spreadHorizontally().repeat(20)
        ConfiguredFeature<?, ?> configuredFeature = Feature.ORE
            .configure(oreConfig)
            .decorate(Decorator.RANGE.configure(new RangeDecoratorConfig(0, 0, 64)))  // Y 0~64
            .spreadHorizontally()
            .repeat(20);  // 每区块 20 次
        // 注册进 BuiltinRegistries.CONFIGURED_FEATURE
        Registry.register(
            BuiltinRegistries.CONFIGURED_FEATURE,
            new Identifier("examplemod", "ore_example"),
            configuredFeature
        );
        // BiomeModifications 引用 RegistryKey
        BiomeModifications.addFeature(
            BiomeSelectors.foundInOverworld(),
            GenerationStep.Feature.UNDERGROUND_ORES,
            ORE_EXAMPLE_CF
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
