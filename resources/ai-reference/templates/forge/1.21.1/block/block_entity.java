/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.21.1）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.21.1 loaderVersion=52.0.57
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.1 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.1 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.21.1/block/block_entity.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup; // 版本差异：1.20.5+ NBT 读写方法签名带 HolderLookup.Provider
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 方块实体注册（Forge 1.21.1）。
 * 要点：
 * - DeferredRegister<BlockEntityType<?>> 挂到 ForgeRegistries.BLOCK_ENTITY_TYPES。
 * - BlockEntityType.Builder.of(构造引用, 关联方块).build(null)：1.21.1 中 Type 参数传 null。
 * - 数据读写用 saveAdditional/load（1.20.x 命名），务必先调用 super。
 */
public class ModBlockEntities {
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(ForgeRegistries.BLOCK_ENTITY_TYPES, ModMain.MOD_ID);

    public static final RegistryObject<BlockEntityType<ExampleBlockEntity>> EXAMPLE_BLOCK_ENTITY =
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

        // 版本差异：1.20.5+ 的 load(CompoundTag) 拆分，覆写点为 loadAdditional（带 Provider）
        @Override
        protected void loadAdditional(CompoundTag tag, HolderLookup.Provider registries) {
            super.loadAdditional(tag, registries);
            this.counter = tag.getInt("counter");
        }
    }
}
