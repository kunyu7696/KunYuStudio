/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.20.4）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.20.4 loaderVersion=20.4.240
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.4 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.4 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.20.4/block/simple_block.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 方块注册（NeoForge 1.20.4）。
 * 惯用写法：DeferredRegister.Blocks 简写 + DeferredHolder，
 * 在主类构造器中 BLOCKS.register(modEventBus)。
 */
public class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(ModMain.MOD_ID);

    public static final DeferredHolder<Block, Block> EXAMPLE_BLOCK = BLOCKS.register("example_block",
            () -> new Block(BlockBehaviour.Properties.of()
                    .strength(1.5f, 6.0f)                 // 硬度 1.5，爆炸抗性 6.0
                    .sound(SoundType.STONE)
                    .requiresCorrectToolForDrops()));     // 需要正确工具才掉落

    // 配套 BlockItem：为清晰起见用显式 register（见 item/simple_item.java）：
    // public static final DeferredHolder<Item, BlockItem> EXAMPLE_BLOCK_ITEM =
    //         ModItems.ITEMS.register("example_block",
    //                 () -> new BlockItem(EXAMPLE_BLOCK.get(), new Item.Properties()));
    // 也可用简写一次注册：BLOCKS.registerSimpleBlockItem(EXAMPLE_BLOCK, new Item.Properties());
}
