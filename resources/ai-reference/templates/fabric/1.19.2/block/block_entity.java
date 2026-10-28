/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.19.2）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.19.2 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.19.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.19.2 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.19.2/block/block_entity.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.block.entity;
import net.fabricmc.fabric.api.object.builder.v1.block.entity.FabricBlockEntityTypeBuilder;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.BlockEntityType;
import net.minecraft.nbt.NbtCompound;

// [版本修正] ≤1.19.2 无 Registries，注册表在 net.minecraft.util.registry.Registry
import net.minecraft.util.registry.Registry;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
/**
 *  (Fabric 1.19.2)
 * <p>
 * BlockEntity
 *  BlockState  16 0~15  BlockEntity
 * <p>
 *
 * 1.  net.minecraft.block.entity.BlockEntity
 * 2.  readNbt() / writeNbt() /
 * 3.  BlockEntityType  Block
 * 4. BlockEntity  Block  appendBlockEntityType()  BlockWithEntity
 * <p>
 *
 * -  writeNbt  super.writeNbt(nbt)/
 * -  BlockEntityType  Block  NPE
 * -  BlockEntityProvider  BlockEntity
 */
public class ExampleBlockEntity extends BlockEntity {
    /**
     *
     *  ItemStackint
     */
    private int counter = 0;
    /**
     *
     * BlockEntity  (BlockEntityType<?>, BlockPos, BlockState)
     *
     * @param pos
     * @param state  BlockState
     *
     *
     * - pos  state Supplier
     * -  BlockEntityType createBlockEntity  null
     */
    public ExampleBlockEntity(BlockPos pos, BlockState state) {
        //  BlockEntityType
        //  EXAMPLE_BLOCK_ENTITY
        super(ExampleBlockEntity.EXAMPLE_BLOCK_ENTITY, pos, state);
    }
    // ========================================================================
    // NBT
    // ========================================================================
    /**
     *  NBT
     *
     * @param nbt  NbtCompound  new
     *
     *
     * -  super.writeNbt(nbt)
     *
     * - NbtCompound
     *     nbt.putInt("key", value)    ——  int
     *     nbt.putString("key", str)  ——  String
     *     nbt.putBoolean("key", b)   ——  boolean
     *     nbt.put("key", subNbt)     ——  NbtCompound
     *     nbt.putLong("key", l)      ——  long
     * - key  +  "counter"
     * - ItemStack stack.writeNbt(nbt)  NbtList
     */
    @Override
    public void writeNbt(NbtCompound nbt) {
        //  super.writeNbt
        super.writeNbt(nbt);
        nbt.putInt("counter", this.counter);
    }

    /**
     *  NBT
     *
     * @param nbt  NbtCompound
     *
     *
     * - 1.19.2  readNbt  void1.20.5+  API
     * -  super.readNbt()
     *    writeNbt writeNbt  super
     * -  key
     * - readNbt  writeNbt  key
     *
     * NbtCompound
     *   nbt.getInt("key")       ——  int 0
     *   nbt.getString("key")   ——  String ""
     *   nbt.getBoolean("key")   ——  boolean false
     *   nbt.contains("key")    ——  key
     */
    @Override
    public void readNbt(NbtCompound nbt) {
        super.readNbt(nbt);  // 1.19.2  super
        this.counter = nbt.getInt("counter");
    }
    // ========================================================================
    // BlockEntityType
    // ========================================================================
    /**
     * BlockEntityType
     * <p>
     *
     * 1. SimpleBlock.EXAMPLE_BLOCK—— BlockEntityType
     * 2.  FabricBlockEntityTypeBuilder.create(...)
     *    - BlockEntity  ExampleBlockEntity::new
     *    -  Block
     * 3.  .build()  BlockEntityType
     * 4.  Registry.register(Registries.BLOCK_ENTITY_TYPE, ...)
     * <p>
     *
     * - Fabric
     *     FabricBlockEntityTypeBuilder.create(ExampleBlockEntity::new, BLOCK).build()
     *   FabricBlockEntityTypeBuilder  BlockEntityType.Builder
     *    BlockEntityType
     * <p>
     * -
     *     BlockEntityType.Builder.create(ExampleBlockEntity::new, BLOCK).build(null)
     *    BlockEntityType.Builder.build(Type<?> type)  Type<?>
     *    Type  null Registry.register
     *   Fabric  null
     * <p>
     *
     * -
     * -  BLOCK  EXAMPLE_BLOCK_ENTITY
     *
     */
    public static final BlockEntityType<ExampleBlockEntity> EXAMPLE_BLOCK_ENTITY =
            Registry.register(
                    Registry.BLOCK_ENTITY_TYPE,
                    new Identifier("examplemod", "example_block_entity"),
                    // Fabric
                    FabricBlockEntityTypeBuilder.create(
                            ExampleBlockEntity::new,
                            com.example.mod.block.SimpleBlock.EXAMPLE_BLOCK
                    ).build()
            );
    // ========================================================================
    // ========================================================================

    //   @Override
    //   public NbtCompound toUpdatePacket() {
    //       NbtCompound nbt = new NbtCompound();
    //       this.writeNbt(nbt);
    //       return nbt;
    //   }
    //   @Override
    //   public void readUpdatePacket(NbtCompound nbt) {
    //       this.readNbt(nbt);
    //   }
    //  world.updateListeners(pos, state, state, flags)
    //  BlockEntity toUpdatePacket -> readUpdatePacket ->
    //  markDirty()
    //   public void incrementCounter() {
    //       this.counter++;
    //       markDirty();  //
    //   }
    // markDirty()
    // ========================================================================
    // ========================================================================
    //  Block  BlockEntityProvider
    //   import net.minecraft.block.BlockWithEntity;
    //   import net.minecraft.block.entity.BlockEntity;
    //   public class ExampleBlock extends BlockWithEntity {
    //       //  createBlockEntity BlockEntity
    //       @Override
    //       public BlockEntity createBlockEntity(BlockPos pos, BlockState state) {
    //           return new ExampleBlockEntity(pos, state);
    //       }
    //       //  getRenderType
    //       @Override
    //       public BlockRenderType getRenderType(BlockState state) {
    //           // BLOCK
    //           //  ENTITYBLOCK_ANIMATED
    //           return BlockRenderType.MODEL;
    //       }
    //   }
}
