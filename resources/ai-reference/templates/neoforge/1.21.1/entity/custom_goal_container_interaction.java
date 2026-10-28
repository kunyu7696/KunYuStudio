// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/entity/custom_goal_container_interaction.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity.ai;

import java.util.EnumSet;

import net.minecraft.core.BlockPos;
import net.minecraft.world.Container;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 自定义 Goal 范式：容器交互（定位容器 → 走近 → 打开 → 取物）。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. Goal 生命周期为 canUse → start → tick → canContinueToUse → stop。
 * 2. setFlags(EnumSet.of(Goal.Flag.MOVE, Goal.Flag.LOOK)) 声明占用移动与视线。
 * 3. 容器必须经 ChestBlock.getContainer(...) 处理双箱合并，
 *    再回落 BlockEntity instanceof Container，禁止直接强转 BlockEntity。
 * 4. BlockPos.betweenClosed 返回可变复用对象，存储前必须 immutable()。
 */
public class ContainerInteractionGoal extends Goal {

    private final PathfinderMob entity;
    private final double speed;
    private final int searchRange;
    private final int maxTake;
    private int cooldown;
    private BlockPos targetPos;

    public ContainerInteractionGoal(PathfinderMob entity, double speed, int searchRange, int maxTake) {
        this.entity = entity;
        this.speed = speed;
        this.searchRange = searchRange;
        this.maxTake = maxTake;
        this.setFlags(EnumSet.of(Goal.Flag.MOVE, Goal.Flag.LOOK));
    }

    @Override
    public boolean canUse() {
        if (this.cooldown > 0) {
            this.cooldown--;
            return false;
        }
        this.targetPos = this.findContainer();
        return this.targetPos != null;
    }

    @Override
    public void start() {
        this.entity.getNavigation().moveTo(
                this.targetPos.getX() + 0.5,
                this.targetPos.getY(),
                this.targetPos.getZ() + 0.5,
                this.speed);
    }

    @Override
    public boolean canContinueToUse() {
        return this.targetPos != null && !this.entity.getNavigation().isDone();
    }

    @Override
    public void tick() {
        if (this.targetPos == null) return;
        this.entity.getLookControl().setLookAt(
                this.targetPos.getX() + 0.5,
                this.targetPos.getY() + 0.5,
                this.targetPos.getZ() + 0.5);
        if (this.entity.blockPosition().closerThan(this.targetPos, 2.0)) {
            this.takeFromContainer(this.targetPos);
            this.cooldown = 200; // 10 秒冷却，防止每刻重复取物
            this.stop();
        }
    }

    @Override
    public void stop() {
        this.targetPos = null;
        this.entity.getNavigation().stop();
    }

    /** 以实体为中心立方体扫描容器方块；命中即返回不可变坐标 */
    private BlockPos findContainer() {
        BlockPos origin = this.entity.blockPosition();
        Level level = this.entity.level();
        for (BlockPos pos : BlockPos.betweenClosed(
                origin.offset(-this.searchRange, -2, -this.searchRange),
                origin.offset(this.searchRange, 2, this.searchRange))) {
            if (this.containerAt(level, pos) != null) {
                return pos.immutable();
            }
        }
        return null;
    }

    /** 双箱经 ChestBlock.getContainer 合并取整；单容器回落 BlockEntity instanceof */
    private Container containerAt(Level level, BlockPos pos) {
        BlockState state = level.getBlockState(pos);
        if (state.getBlock() instanceof ChestBlock chest) {
            return ChestBlock.getContainer(chest, state, level, pos, true);
        }
        BlockEntity blockEntity = level.getBlockEntity(pos);
        return blockEntity instanceof Container container ? container : null;
    }

    /** 从第一个非空槽位取最多 maxTake 个物品并装备到主手 */
    private void takeFromContainer(BlockPos pos) {
        Container container = this.containerAt(this.entity.level(), pos);
        if (container == null) return;
        for (int slot = 0; slot < container.getContainerSize(); slot++) {
            ItemStack stack = container.getItem(slot);
            if (stack.isEmpty()) continue;
            ItemStack taken = container.removeItem(slot, Math.min(stack.getCount(), this.maxTake));
            this.entity.setItemSlot(EquipmentSlot.MAINHAND, taken);
            container.setChanged();
            return;
        }
    }
}
