/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.1）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.1 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.1 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.1 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.1/block/simple_block.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.block;
// [版本修正] 1.21.x FabricItemSettings 已移除，改用原版 new Item.Settings()
// [版本修正] 1.21.x FabricBlockSettings 已废弃，改用 AbstractBlock.Settings.copy()
import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.block.Blocks;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
/**
 *  (Fabric 1.21.1)
 * <p>
 *  Fabric 1.21.1
 *
 * 1.  Registries.BLOCK
 * 2. BlockItem Registries.ITEM
 * 3. Fabric  @Mod  Forge  Registry.register()
 * 4.  ModInitializer
 * <p>
 *
 * -  BLOCK  ITEM
 * -  new Item.Settings()  FabricItemSettings
 * - Identifier  mod_idblockstate/model
 */
public class SimpleBlock extends Block {
    /**
     *
     *  static final
     * BLOCK  ITEM  BlockItem  block
     */
    public static final Block EXAMPLE_BLOCK = registerBlock("example_block");
    /**
     *
     *  AbstractBlock.SettingsFabricBlockSettings
     *  Block
     *
     * @param settings  FabricBlockSettings
     */
    public SimpleBlock(AbstractBlock.Settings settings) {
        super(settings);
    }
    /**
     *
     *  Block  BlockItem
     *
     * @param name  mod_id  "examplemod:example_block"
     * @return  Block
     */
    private static Block registerBlock(String name) {
        // ----  ----
        // FabricBlockSettings.copyOf(Blocks.STONE)
        //   .strength(3.0f)          ——
        //   .strength(3.0f, 6.0f)    ——
        //   .resistance(6.0f)        ——
        //   .requiresTool()          ——
        //   .luminance(15)           ——  0~15
        //   .nonOpaque()             ——
        //   .mapColor(MapColor.STONE_GRAY) ——
        //   .sounds(BlockSoundGroup.STONE) —— //
        //   -  1.21.1  AbstractBlock.Settings.copy() + of() FabricBlockSettings.copyOf()
        //   - 1.21.1  strength  float
        AbstractBlock.Settings settings = AbstractBlock.Settings.copy(Blocks.STONE)
                .strength(3.0f)          // ==3.0
                .requiresTool()           //
                .luminance(15);           //  15

        // ----  ----
        //  new SimpleBlock(settings)
        //  new Block(settings)
        Block block = new SimpleBlock(settings);
        // ----  Block  Registries.BLOCK ----
        //  Fabric 1.21.1
        //   Registry.register(Registries.BLOCK, new Identifier("mod_id", "name"), block)
        //   - Registries.BLOCK1.21.1  Registries Registry.BLOCK
        //   - Identifier.of("examplemod", name) mod_id
        //   - block
        //   -  DeferredRegister  @ObjectHolder Forge
        //   - mod_id
        //   - Identifier  fabric.mod.json  id
        Registry.register(Registries.BLOCK, Identifier.of("examplemod", name), block);
        // ----  BlockItem  Registries.ITEM ----
        // ""/ BlockItem
        // FabricItemSettings
        //   // [版本修正] 1.21.x FabricItemSettings 已移除，改用原版 new Item.Settings()
        //  1.21.1  FabricItemSettings  new Item.Settings()
        //  FabricItemSettings  Fabric  foodfuel
        //   .maxCount(64)             ——
        //   .maxDamage(256)           ——
        //   .fireproof()              ——  FabricItemSettings
        //   .group(ItemGroup.BUILDING_BLOCKS) —— 1.21.1  creative tab
        //                                          ItemGroupEvents
        BlockItem item = new BlockItem(block, new Item.Settings());
        Registry.register(Registries.ITEM, Identifier.of("examplemod", name), item);
        return block;
    }
    // ========================================================================
    // ========================================================================
    //  ModInitializer
    //   public class ExampleMod implements ModInitializer {
    //       @Override
    //       public void onInitialize() {
    //           //  SimpleBlock
    //           //  SimpleBlock.class  EXAMPLE_BLOCK
    //           Block block = SimpleBlock.EXAMPLE_BLOCK;
    //       }
    //   }
    //  onInitialize() /
    //  onInitializeClient
    // ========================================================================
    // 1.21.1
    // ========================================================================
    // 1.21.1  .group(ItemGroup.XXX)
    //   //  onInitialize
    //   ItemGroupEvents.modifyEntriesEvent(ItemGroups.BUILDING_BLOCKS)
    //       .register(entries -> entries.add(SimpleBlock.EXAMPLE_BLOCK));
    //   import net.fabricmc.fabric.api.event.player.UseBlockCallback;
    //   import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
    //   import net.minecraft.item.ItemGroups;
}
