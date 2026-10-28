// ============================================================================
// KunYuEcosystem AI Reference v3.1 | forge/1.16.5/block/processing_block.java | mapping: Mojmap 1.16.5 (flat packages) | 工作方块（熔炉/高炉/烟熏炉/太阳能熔炉）带 LIT 亮态
// ============================================================================
package com.example.examplemod.block;

import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.SoundType;
import net.minecraft.block.material.Material;
import net.minecraft.state.BooleanProperty; // 1.16.5 状态属性：net.minecraft.state 包
import net.minecraft.state.StateContainer;  // 1.16.5 状态容器：StateContainer（1.17+ 改名 StateManager）
import net.minecraft.state.properties.BlockStateProperties; // 1.16.5：net.minecraft.state.properties 包
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 工作/加工类方块（熔炉、高炉、烟熏炉、太阳能熔炉等）的 LIT 亮态三件套。
 *
 * <p>1.16.5 Forge Mojmap 下与原版熔炉一致：
 * 1. {@link #LIT} 属性（BooleanProperty，复用 {@link BlockStateProperties#LIT}）；
 * 2. {@code createBlockStateDefinition} 注册 + 构造函数 {@code registerDefaultState}；
 * 3. {@code lightLevel(state -> state.getValue(LIT) ? 13 : 0)} 让工作时发光、停机熄灭；
 * 4. TileEntity tick 内 {@code world.setBlockState(pos, state.setValue(LIT, working), 3)} 回写；
 * 5. blockstate JSON 提供 {@code "lit=false"} / {@code "lit=true"} 双变体。
 *
 * <p>1.17+ 对照（勿混入 1.16.5 代码）：StateContainer→StateManager、
 * getDefaultState→defaultBlockState、AbstractBlock.Properties→BlockBehaviour.Properties、
 * 包名加 world. 前缀。
 *
 * <p>注意：1.16.5 的 {@code AbstractBlock.Properties.of(...)} 必须带 Material 参数。
 *
 * <p><b>不要只写 Java 不写 blockstate 双变体，也不要只写 blockstate 不写 LIT 属性。</b>
 */
public class ProcessingBlock extends Block {

    /** 工作亮态：true=烧炼/加工中，false=停机。复用原版 {@code lit} 属性名，与 blockstate JSON 一致。 */
    public static final BooleanProperty LIT = BlockStateProperties.LIT;

    public ProcessingBlock(AbstractBlock.Properties properties) {
        super(properties);
        // super 构造器已用基础态调用过 registerDefaultState，此处 getDefaultState() 非空
        this.registerDefaultState(this.getDefaultState().setValue(LIT, false));
    }

    @Override
    protected void createBlockStateDefinition(StateContainer.Builder<Block, BlockState> builder) {
        builder.add(LIT);
    }

    /**
     * Forge 惯用注册（与同目录 simple_block.java 同款 DeferredRegister + RegistryObject，
     * 主类构造器中 {@code BLOCKS.register(modEventBus)}）。
     * lightLevel 接收 {@code BlockState -> int}，按 LIT 返回 13（工作）或 0（停机）。
     */
    public static final DeferredRegister<Block> BLOCKS =
            DeferredRegister.create(ForgeRegistries.BLOCKS, "examplemod");

    public static final RegistryObject<Block> PROCESSING_BLOCK = BLOCKS.register("processing_block",
            () -> new ProcessingBlock(AbstractBlock.Properties.of(Material.STONE)
                    .strength(3.5f, 6.0f)                 // 硬度 3.5，爆炸抗性 6.0（对标原版熔炉）
                    .sound(SoundType.STONE)
                    .requiresCorrectToolForDrops()        // 需要正确工具才掉落
                    .lightLevel(state -> state.getValue(LIT) ? 13 : 0)));
}
