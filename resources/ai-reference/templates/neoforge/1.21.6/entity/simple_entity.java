/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.6）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.6 loaderVersion=21.6.20
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.6 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.6 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.6/entity/simple_entity.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 实体注册（NeoForge 1.21.6）。
 * 要点：
 * - 原版注册表用 Registries 键：DeferredRegister.create(Registries.ENTITY_TYPE, MODID)。
 * - EntityType.Builder.of(工厂, MobCategory).sized(宽, 高).build("名字")；
 *   build 的字符串用于数据修复器，与注册名一致即可。
 * - 属性必须经 EntityAttributeCreationEvent 注册（见 entity_attribute.java），否则生成实体即崩溃。
 */
public class ModEntities {
    public static final DeferredRegister<EntityType<?>> ENTITY_TYPES =
            DeferredRegister.create(Registries.ENTITY_TYPE, ModMain.MOD_ID);

    public static final DeferredHolder<EntityType<?>, EntityType<ExampleEntity>> EXAMPLE_ENTITY =
            ENTITY_TYPES.register("example_entity",
                    () -> EntityType.Builder.of(ExampleEntity::new, MobCategory.CREATURE)
                            .sized(0.6f, 1.8f)   // 碰撞箱：宽 0.6，高 1.8
                            .build("example_entity"));

    /** 示例生物：陆生被动型。 */
    public static class ExampleEntity extends PathfinderMob {
        public ExampleEntity(EntityType<? extends PathfinderMob> type, Level level) {
            super(type, level);
        }

        /** 属性构建器，供 EntityAttributeCreationEvent 使用。 */
        public static AttributeSupplier.Builder createAttributes() {
            return PathfinderMob.createMobAttributes()
                    .add(Attributes.MAX_HEALTH, 20.0)
                    .add(Attributes.MOVEMENT_SPEED, 0.25)
                    .add(Attributes.ATTACK_DAMAGE, 3.0)
                    .add(Attributes.FOLLOW_RANGE, 16.0);
        }

        @Override
        protected void registerGoals() {
            // 添加 AI Goal：WaterAvoidingRandomStrollGoal、LookAtPlayerGoal、PanicGoal 等
        }
    }
}
