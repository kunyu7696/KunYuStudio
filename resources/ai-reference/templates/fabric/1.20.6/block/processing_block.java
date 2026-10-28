// ============================================================================
// KunYuEcosystem AI Reference v3.1 | fabric/1.20.6/block/processing_block.java | mapping: Yarn | 工作方块（熔炉/高炉/烟熏炉/太阳能熔炉）带 LIT 亮态
// ============================================================================
package com.example.mod.block;

import net.fabricmc.fabric.api.object.builder.v1.block.FabricBlockSettings;
import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.block.BlockState;
import net.minecraft.block.Blocks;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.state.StateManager;
import net.minecraft.state.property.BooleanProperty;
import net.minecraft.state.property.Properties;
import net.minecraft.util.Identifier;

/**
 * 工作/加工类方块（熔炉、高炉、烟熏炉、太阳能熔炉等）的 LIT 亮态三件套。
 *
 * <p>1.20.6 Fabric Yarn 下与原版熔炉一致：
 * 1. {@link #LIT} 属性（BooleanProperty，复用 {@link Properties#LIT}）；
 * 2. {@code appendProperties} 注册 + 构造函数 {@code setDefaultState}；
 * 3. {@code luminance(state -> state.get(LIT) ? 13 : 0)} 让工作时发光、停机熄灭；
 * 4. BlockEntity ticker 内 {@code world.setBlockState(pos, state.with(LIT, working))} 回写；
 * 5. blockstate JSON 提供 {@code "lit=false"} / {@code "lit=true"} 双变体。
 *
 * <p><b>版本差异：</b>1.20.6 起 {@code new Identifier(...)} 已废弃，改用静态工厂
 * {@code Identifier.of("examplemod", id)}；注册表仍为 {@code Registries.BLOCK}；
 * 方块设置沿用 {@code FabricBlockSettings.copyOf(...)}。
 *
 * <p><b>不要只写 Java 不写 blockstate 双变体，也不要只写 blockstate 不写 LIT 属性。</b>
 */
public class ProcessingBlock extends Block {

    /** 工作亮态：true=烧炼/加工中，false=停机。复用原版 {@code lit} 属性名，与 blockstate JSON 一致。 */
    public static final BooleanProperty LIT = Properties.LIT;

    public ProcessingBlock(AbstractBlock.Settings settings) {
        super(settings);
        setDefaultState(getDefaultState().with(LIT, false));
    }

    @Override
    protected void appendProperties(StateManager.Builder<Block, BlockState> builder) {
        builder.add(LIT);
    }

    /**
     * 静态注册（幂等）。luminance 接收 {@code BlockState -> int}，按 LIT 返回 13（工作）或 0（停机）。
     */
    public static Block register(String id) {
        Block block = Registry.register(
                Registries.BLOCK,
                Identifier.of("examplemod", id),
                new ProcessingBlock(FabricBlockSettings.copyOf(Blocks.IRON_BLOCK)
                        .strength(3.5f, 6.0f)
                        .requiresTool()
                        .luminance(state -> state.get(LIT) ? 13 : 0))
        );
        return block;
    }
}
