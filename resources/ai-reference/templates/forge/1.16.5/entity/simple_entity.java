/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/entity/simple_entity.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.entity.CreatureEntity; // 1.16.5 陆生生物基类：CreatureEntity（PathfinderMob 是 1.17+ 改名）
import net.minecraft.entity.EntityClassification; // 1.16.5 生物分类：EntityClassification（1.17+ 改名 MobCategory）
import net.minecraft.entity.EntityType;
import net.minecraft.entity.MobEntity;
import net.minecraft.entity.ai.attributes.AttributeModifierMap; // 1.16.5 属性表：AttributeModifierMap（1.17+ 改名 AttributeSupplier）
import net.minecraft.entity.ai.attributes.Attributes;
import net.minecraft.world.World; // 1.16.5 世界类：net.minecraft.world.World（1.17+ 改名 Level）
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 实体注册（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - DeferredRegister.create(ForgeRegistries.ENTITIES, MODID)（1.19.3+ 该常量改名 ENTITY_TYPES）。
 * - EntityType.Builder.of(工厂, EntityClassification).sized(宽, 高).build("名字")；
 *   build 吃 String（数据修复器键，与注册名一致即可）；1.18+ 改为 build(ResourceLocation.toString())。
 * - 属性必须在 FMLCommonSetupEvent.enqueueWork 里用 GlobalEntityTypeAttributes.put 注册
 *   （见 entity_attribute.java），否则实体生成即 NPE。1.16.5 没有 EntityAttributeCreationEvent。
 */
public class ModEntities {
    public static final DeferredRegister<EntityType<?>> ENTITY_TYPES =
            DeferredRegister.create(ForgeRegistries.ENTITIES, ModMain.MOD_ID);

    public static final RegistryObject<EntityType<ExampleEntity>> EXAMPLE_ENTITY =
            ENTITY_TYPES.register("example_entity",
                    () -> EntityType.Builder.of(ExampleEntity::new, EntityClassification.CREATURE)
                            .sized(0.6f, 1.8f)   // 碰撞箱：宽 0.6，高 1.8
                            .build("example_entity"));

    /** 示例生物：陆生被动型。 */
    public static class ExampleEntity extends CreatureEntity {
        public ExampleEntity(EntityType<? extends CreatureEntity> type, World world) {
            super(type, world);
        }

        /** 属性构建器：1.16.5 返回 AttributeModifierMap.MutableAttribute，登记时调 .create()。 */
        public static AttributeModifierMap.MutableAttribute createAttributes() {
            return MobEntity.createAttributes() // 1.17+ 改名 createMobAttributes()
                    .add(Attributes.MAX_HEALTH, 20.0)
                    .add(Attributes.MOVEMENT_SPEED, 0.25)
                    .add(Attributes.ATTACK_DAMAGE, 3.0)
                    .add(Attributes.FOLLOW_RANGE, 16.0);
        }

        @Override
        protected void registerGoals() {
            // 1.16.5 常用 Goal：SwimGoal、PanicGoal、WaterAvoidingRandomWalkingGoal、
            // LookAtGoal（1.17+ 的 LookAtPlayerGoal/WaterAvoidingRandomStrollGoal 是改名后产物）
        }
    }
}
