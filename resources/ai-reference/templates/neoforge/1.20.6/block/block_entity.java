/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.20.6）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.20.6 loaderVersion=20.6.132
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.6 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.6 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.20.6/block/block_entity.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 方块实体注册（NeoForge 1.20.6）。
 * 要点：
 * - 原版注册表用 Registries 键：DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, MODID)。
 * - BlockEntityType.Builder.of(构造引用, 关联方块).build(null)：1.20.6 中 Type 参数仍传 null。
 * - 数据读写：1.20.5+ 起签名为 saveAdditional/loadAdditional(CompoundTag, HolderLookup.Provider)，
 *   务必先调用 super（1.20.4 及更早是单参 saveAdditional/load）。
 */
public class ModBlockEntities {
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, ModMain.MOD_ID);

    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<ExampleBlockEntity>> EXAMPLE_BLOCK_ENTITY =
            BLOCK_ENTITIES.register("example_block_entity",
                    () -> BlockEntityType.Builder.of(ExampleBlockEntity::new, ModBlocks.EXAMPLE_BLOCK.get())
                            .build(null));

    /** 示例方块实体：计数器持久化。 */
    public static class ExampleBlockEntity extends BlockEntity {
        private int counter = 0;

        public ExampleBlockEntity(BlockPos pos, BlockState state) {
            super(ModBlockEntities.EXAMPLE_BLOCK_ENTITY.get(), pos, state);
        }

        public void increment() {
            this.counter++;
            setChanged(); // 标记脏数据，触发保存
        }

        @Override
        protected void saveAdditional(CompoundTag tag, HolderLookup.Provider registries) {
            super.saveAdditional(tag, registries);
            tag.putInt("counter", this.counter);
        }

        @Override
        protected void loadAdditional(CompoundTag tag, HolderLookup.Provider registries) {
            super.loadAdditional(tag, registries);
            this.counter = tag.getInt("counter");
        }
    }
}
