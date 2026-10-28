// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.3/block/processing_block.java | mapping: Mojmap | loader: NeoForge | 工作方块（熔炉/高炉/烟熏炉/太阳能熔炉）带 LIT 亮态
// ============================================================================
package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.StateDefinition;
import net.minecraft.world.level.block.state.properties.BlockStateProperties;
import net.minecraft.world.level.block.state.properties.BooleanProperty;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 工作/加工类方块（熔炉、高炉、烟熏炉、太阳能熔炉等）的 LIT 亮态三件套。
 *
 * <p>1.21.3 NeoForge Mojmap 下与原版熔炉一致：
 * 1. {@link #LIT} 属性（BooleanProperty，复用 {@link BlockStateProperties#LIT}）；
 * 2. {@code createBlockStateDefinition} 注册 + 构造函数 {@code registerDefaultState}；
 * 3. {@code lightLevel(state -> state.getValue(LIT) ? 13 : 0)} 让工作时发光、停机熄灭；
 * 4. BlockEntity ticker 内 {@code level.setBlock(pos, state.setValue(LIT, working), Block.UPDATE_ALL)} 回写；
 * 5. blockstate JSON 提供 {@code "lit=false"} / {@code "lit=true"} 双变体。
 *
 * <p><b>不要只写 Java 不写 blockstate 双变体，也不要只写 blockstate 不写 LIT 属性。</b>
 */
public class ProcessingBlock extends Block {

    /** 工作亮态：true=烧炼/加工中，false=停机。复用原版 {@code lit} 属性名，与 blockstate JSON 一致。 */
    public static final BooleanProperty LIT = BlockStateProperties.LIT;

    public ProcessingBlock(BlockBehaviour.Properties properties) {
        super(properties);
        this.registerDefaultState(this.defaultBlockState().setValue(LIT, false));
    }

    @Override
    protected void createBlockStateDefinition(StateDefinition.Builder<Block, BlockState> builder) {
        builder.add(LIT);
    }

    // 寄存器风格对齐同目录 simple_block.java：DeferredRegister.Blocks，
    // 在主类构造器中 BLOCKS.register(modEventBus)。模板自包含故寄存器写在本类，
    // 实际项目请集中到 ModBlocks。
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(ModMain.MOD_ID);

    /**
     * 静态注册（幂等）。lightLevel 接收 {@code ToIntFunction<BlockState>}，按 LIT 返回 13（工作）或 0（停机）。
     *
     * <p><b>1.21.2+ 起 {@code BlockBehaviour.Properties} 必须携带方块 id（setId），否则运行期崩溃。</b>
     * {@code registerBlock(name, 构造引用, properties)} 会自动按注册名设置 id，
     * 切勿退回 {@code BLOCKS.register(name, () -> new X(Properties.of()...))} 裸写。
     */
    public static final DeferredBlock<Block> PROCESSING_BLOCK = BLOCKS.registerBlock("processing_block",
            ProcessingBlock::new,
            BlockBehaviour.Properties.of()
                    .strength(3.5f, 6.0f)                 // 硬度 3.5，爆炸抗性 6.0
                    .sound(SoundType.METAL)
                    .requiresCorrectToolForDrops()        // 需要正确工具才掉落
                    .lightLevel(state -> state.getValue(LIT) ? 13 : 0));
}
