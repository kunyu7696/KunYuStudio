/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.20.4）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.20.4 loaderVersion=49.0.53
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.4 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.4 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.4/block/simple_block.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 方块注册（Forge 1.20.4）。
 * 惯用写法：DeferredRegister + RegistryObject，在主类构造器中 BLOCKS.register(modEventBus)。
 */
public class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS =
            DeferredRegister.create(ForgeRegistries.BLOCKS, ModMain.MOD_ID);

    public static final RegistryObject<Block> EXAMPLE_BLOCK = BLOCKS.register("example_block",
            () -> new Block(BlockBehaviour.Properties.of()
                    .strength(1.5f, 6.0f)                 // 硬度 1.5，爆炸抗性 6.0
                    .sound(SoundType.STONE)
                    .requiresCorrectToolForDrops()));     // 需要正确工具才掉落

    // 方块通常需要配套 BlockItem 才能进物品栏/背包（见 item/simple_item.java）：
    // public static final RegistryObject<Item> EXAMPLE_BLOCK_ITEM =
    //         ModItems.ITEMS.register("example_block",
    //                 () -> new BlockItem(EXAMPLE_BLOCK.get(), new Item.Properties()));
}
