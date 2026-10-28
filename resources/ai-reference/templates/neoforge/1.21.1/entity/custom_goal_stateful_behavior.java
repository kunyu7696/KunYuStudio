// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/entity/custom_goal_stateful_behavior.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity.ai;

import java.util.EnumSet;

import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/**
 * 自定义 Goal 范式：带状态/携带物的多阶段行为（得手 → 脱离 → 完成）。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. 状态机集中在 tick() 内推进，canUse 只做「是否进入第一阶段」的判定。
 * 2. 阶段转移必须写清终止条件（到达/超时/被击中），否则 Goal 永远占控。
 * 3. 携带物是实体状态（主手装备槽）而非 Goal 局部变量，跨系统天然可见。
 * 4. stop() 必须幂等收尾：清导航、复位阶段。
 */
public class StatefulFleeGoal extends Goal {

    private enum Stage { FLEE, SETTLE, DONE }

    private final PathfinderMob entity;
    private final double fleeSpeed;
    private final double safeDistance;
    private Stage stage = Stage.DONE;
    private int settleTicks;

    public StatefulFleeGoal(PathfinderMob entity, double fleeSpeed, double safeDistance) {
        this.entity = entity;
        this.fleeSpeed = fleeSpeed;
        this.safeDistance = safeDistance;
        this.setFlags(EnumSet.of(Goal.Flag.MOVE));
    }

    @Override
    public boolean canUse() {
        return !this.entity.getMainHandItem().isEmpty();
    }

    @Override
    public void start() {
        this.stage = Stage.FLEE;
        this.settleTicks = 0;
    }

    @Override
    public boolean canContinueToUse() {
        return this.stage != Stage.DONE && this.entity.isAlive();
    }

    @Override
    public void tick() {
        switch (this.stage) {
            case FLEE -> {
                Player player = this.entity.level().getNearestPlayer(this.entity, this.safeDistance);
                if (player == null) {
                    this.stage = Stage.SETTLE;
                    return;
                }
                Vec3 away = this.entity.position().subtract(player.position())
                        .normalize().scale(this.safeDistance);
                Vec3 target = this.entity.position().add(away);
                this.entity.getNavigation().moveTo(target.x, target.y, target.z, this.fleeSpeed);
            }
            case SETTLE -> {
                if (++this.settleTicks >= 60) {
                    this.stage = Stage.DONE;
                }
            }
            default -> { /* DONE 不做事 */ }
        }
    }

    @Override
    public void stop() {
        this.stage = Stage.DONE;
        this.entity.getNavigation().stop();
    }
}
