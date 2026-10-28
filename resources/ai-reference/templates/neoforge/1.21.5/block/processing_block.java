/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.5）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.5 loaderVersion=21.5.98
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.5 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.5 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.5/block/processing_block.java | mapping: Mojmap | loader: NeoForge | 工作方块（熔炉/高炉/烟熏炉/太阳能熔炉）带 LIT 亮态
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
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 工作/加工类方块（熔炉、高炉、烟熏炉、太阳能熔炉等）的 LIT 亮态三件套。
 *
 * <p>1.21.5 NeoForge Mojmap 下与原版熔炉一致：
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

    // 注册风格对齐同目录 simple_block.java：DeferredRegister.Blocks + DeferredHolder，
    // 在主类构造器中 BLOCKS.register(modEventBus)。模板自包含故寄存器写在本类，
    // 实际项目请集中到 ModBlocks。
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(ModMain.MOD_ID);

    /**
     * 静态注册（幂等）。lightLevel 接收 {@code ToIntFunction<BlockState>}，按 LIT 返回 13（工作）或 0（停机）。
     */
    public static final DeferredHolder<Block, Block> PROCESSING_BLOCK = BLOCKS.register("processing_block",
            () -> new ProcessingBlock(BlockBehaviour.Properties.of()
                    .strength(3.5f, 6.0f)                 // 硬度 3.5，爆炸抗性 6.0
                    .sound(SoundType.METAL)
                    .requiresCorrectToolForDrops()        // 需要正确工具才掉落
                    .lightLevel(state -> state.getValue(LIT) ? 13 : 0)));
}
