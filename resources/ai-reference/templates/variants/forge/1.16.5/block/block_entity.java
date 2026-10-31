/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/block/block_entity.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.block.BlockState;
import net.minecraft.nbt.CompoundNBT; // 1.16.5 NBT 类：CompoundNBT（1.17+ 改名 CompoundTag）
import net.minecraft.tileentity.TileEntity; // 1.16.5 方块实体：TileEntity（1.17+ 改名 BlockEntity）
import net.minecraft.tileentity.TileEntityType;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 方块实体注册（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - DeferredRegister<TileEntityType<?>> 挂到 ForgeRegistries.TILE_ENTITIES
 *   （1.19+ 改名 ForgeRegistries.BLOCK_ENTITY_TYPES）。
 * - TileEntityType.Builder.of(构造引用, 关联方块).build(null)：1.16.5 数据修复器参数传 null。
 * - 1.16.5 的 TileEntity 构造器【不带】 BlockPos/BlockState（1.17 才改签名）；
 *   方块端通过 Block.hasTileEntity(BlockState) / createTileEntity(BlockState, IBlockReader)
 *   或 IForgeBlock 同名扩展提供实例。
 * - 数据读写：save(CompoundNBT) 返回 tag、load(BlockState, CompoundNBT)；务必先调 super。
 *   （saveAdditional/load(CompoundTag) 是 1.18+ 的写法。）
 */
public class ModBlockEntities {
    public static final DeferredRegister<TileEntityType<?>> TILE_ENTITIES =
            DeferredRegister.create(ForgeRegistries.TILE_ENTITIES, ModMain.MOD_ID);

    public static final RegistryObject<TileEntityType<ExampleTileEntity>> EXAMPLE_TILE_ENTITY =
            TILE_ENTITIES.register("example_tile_entity",
                    () -> TileEntityType.Builder.of(ExampleTileEntity::new, ModBlocks.EXAMPLE_BLOCK.get())
                            .build(null));

    /** 示例方块实体：计数器持久化。 */
    public static class ExampleTileEntity extends TileEntity {
        private int counter = 0;

        /** 1.16.5 构造器只收 TileEntityType；pos/state 由世界放置时回填。 */
        public ExampleTileEntity() {
            super(ModBlockEntities.EXAMPLE_TILE_ENTITY.get());
        }

        public void increment() {
            this.counter++;
            setChanged(); // 标记脏数据，触发区块保存（MCP 名 markDirty）
        }

        @Override
        public CompoundNBT save(CompoundNBT tag) {
            super.save(tag);
            tag.putInt("counter", this.counter);
            return tag;
        }

        @Override
        public void load(BlockState state, CompoundNBT tag) {
            super.load(state, tag);
            this.counter = tag.getInt("counter");
        }
    }
}
