/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/block/simple_block.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.block.AbstractBlock; // 1.16.5 方块属性宿主：AbstractBlock.Properties（1.17+ 改名 BlockBehaviour.Properties）
import net.minecraft.block.Block;
import net.minecraft.block.SoundType;
import net.minecraft.block.material.Material; // 1.16.5 材料枚举：net.minecraft.block.material.Material
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 方块注册（Forge 1.16.5，Mojmap 平铺包）。
 * 惯用写法：DeferredRegister + RegistryObject，在主类构造器中 BLOCKS.register(modEventBus)。
 * 注意：1.16.5 的 AbstractBlock.Properties.of(...) 必须带 Material 参数
 *       （1.19.3+ 才有无参重载 of()）。
 */
public class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS =
            DeferredRegister.create(ForgeRegistries.BLOCKS, ModMain.MOD_ID);

    public static final RegistryObject<Block> EXAMPLE_BLOCK = BLOCKS.register("example_block",
            () -> new Block(AbstractBlock.Properties.of(Material.STONE) // Material 参数不可省
                    .strength(1.5f, 6.0f)                 // 硬度 1.5，爆炸抗性 6.0
                    .sound(SoundType.STONE)
                    .requiresCorrectToolForDrops()));     // 需要正确工具才掉落

    // 方块通常需要配套 BlockItem 才能进物品栏/背包（见 item/simple_item.java）：
    // public static final RegistryObject<Item> EXAMPLE_BLOCK_ITEM =
    //         ModItems.ITEMS.register("example_block",
    //                 () -> new BlockItem(EXAMPLE_BLOCK.get(),
    //                         new Item.Properties().tab(ItemGroup.TAB_BUILDING_BLOCKS)));
}
