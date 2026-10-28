// ============================================================================
// KunYuEcosystem AI Reference v3.3 | fabric/1.20.1/entity/freeform/custom_goal_container_interaction.java | mapping: Yarn | provenance: hand-curated（实体自由代码范式·容器交互）
// ============================================================================
package com.example.mod.entity.ai;

import java.util.EnumSet;

import net.minecraft.block.BlockState;
import net.minecraft.block.InventoryProvider;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.entity.EquipmentSlot;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.inventory.Inventory;
import net.minecraft.item.ItemStack;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

/**
 * 自定义 Goal 范式：容器交互（定位容器 → 走近 → 打开 → 取物）。
 * Fabric 1.20.1 / Yarn。复制后按实体语义改名与调参。
 *
 * 要点：
 * 1. Goal 生命周期：canStart（能否开始）→ start（一次性准备）→ tick（每刻执行）
 *    → shouldContinue（是否继续）→ stop（收尾清理）；前两个为必须实现的语义。
 * 2. setControls(EnumSet.of(Goal.Control.MOVE, Goal.Control.LOOK)) 声明本 Goal
 *    占用移动与视线，避免与其他 Goal 冲突。
 * 3. 取容器必须先判 BlockState.getBlock() instanceof InventoryProvider（双箱合并）
 *    再回落 BlockEntity instanceof Inventory，禁止直接强转 BlockEntity。
 * 4. BlockPos.iterate 返回可变复用对象，存储前必须 toImmutable()。
 */
public class ContainerInteractionGoal extends Goal {

    private final PathAwareEntity entity;
    private final double speed;
    private final int searchRange;
    private final int maxTake;
    private int cooldown;
    private BlockPos targetPos;

    public ContainerInteractionGoal(PathAwareEntity entity, double speed, int searchRange, int maxTake) {
        this.entity = entity;
        this.speed = speed;
        this.searchRange = searchRange;
        this.maxTake = maxTake;
        this.setControls(EnumSet.of(Goal.Control.MOVE, Goal.Control.LOOK));
    }

    @Override
    public boolean canStart() {
        if (this.cooldown > 0) {
            this.cooldown--;
            return false;
        }
        this.targetPos = this.findContainer();
        return this.targetPos != null;
    }

    @Override
    public void start() {
        this.entity.getNavigation().startMovingTo(
            this.targetPos.getX() + 0.5,
            this.targetPos.getY(),
            this.targetPos.getZ() + 0.5,
            this.speed
        );
    }

    @Override
    public boolean shouldContinue() {
        return this.targetPos != null && !this.entity.getNavigation().isIdle();
    }

    @Override
    public void tick() {
        if (this.targetPos == null) return;
        this.entity.getLookControl().lookAt(
            this.targetPos.getX() + 0.5,
            this.targetPos.getY() + 0.5,
            this.targetPos.getZ() + 0.5
        );
        if (this.entity.getBlockPos().isWithinDistance(this.targetPos, 2.0)) {
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
        BlockPos origin = this.entity.getBlockPos();
        World world = this.entity.getWorld();
        for (BlockPos pos : BlockPos.iterate(
                origin.add(-this.searchRange, -2, -this.searchRange),
                origin.add(this.searchRange, 2, this.searchRange))) {
            if (this.getInventoryAt(world, pos) != null) {
                return pos.toImmutable(); // iterate 复用可变对象，必须固化
            }
        }
        return null;
    }

    /** 双箱经 InventoryProvider 合并取整；单容器回落 BlockEntity instanceof */
    private Inventory getInventoryAt(World world, BlockPos pos) {
        BlockState state = world.getBlockState(pos);
        if (state.getBlock() instanceof InventoryProvider provider) {
            return provider.getInventory(state, world, pos);
        }
        BlockEntity blockEntity = world.getBlockEntity(pos);
        return blockEntity instanceof Inventory inventory ? inventory : null;
    }

    /** 从第一个非空槽位取最多 maxTake 个物品并装备到主手（可改为存入自定义背包） */
    private void takeFromContainer(BlockPos pos) {
        Inventory inventory = this.getInventoryAt(this.entity.getWorld(), pos);
        if (inventory == null) return;
        for (int slot = 0; slot < inventory.size(); slot++) {
            ItemStack stack = inventory.getStack(slot);
            if (stack.isEmpty()) continue;
            ItemStack taken = inventory.removeStack(slot, Math.min(stack.getCount(), this.maxTake));
            this.entity.equipStack(EquipmentSlot.MAINHAND, taken);
            inventory.markDirty(); // 不写回会导致存档不同步
            return;
        }
    }
}
