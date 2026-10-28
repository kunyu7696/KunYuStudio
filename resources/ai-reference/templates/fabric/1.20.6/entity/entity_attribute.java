/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.20.6）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.20.6 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.6 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.6 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.20.6/entity/entity_attribute.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.entity;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
/**
 *  - Fabric 1.20.6
 *
 *
 * 1.  FabricDefaultAttributeRegistry Fabric
 * 2.  DefaultAttributeRegistryVanilla
 *
 * Fabric 1.20.6
 *
 * : FabricDefaultAttributeRegistry
 *   - Fabric API
 *   -
 *   -
 *
 * : DefaultAttributeRegistryVanilla
 *   - Minecraft
 *   -
 *   -  Fabric
 *
 * :
 * -
 * -
 * -
 * - createMobAttributes()
 */
public class ModEntityAttributes {
    /**
     *
     * ModInitializer onInitialize()
     */
    public static void register() {
        // ================================================================
        // : FabricDefaultAttributeRegistry
        // ================================================================
        // 1: EntityType
        // 2: DefaultAttributeContainer createMobAttributes()
        FabricDefaultAttributeRegistry.register(
            ExampleEntity.EXAMPLE_ENTITY,
            ExampleEntity.createMobAttributes()
        );
        // ================================================================
        // : DefaultAttributeRegistryVanilla
        // ================================================================
        // DefaultAttributeRegistry.register(
        //     ExampleEntity.EXAMPLE_ENTITY,
        //     ExampleEntity.createMobAttributes()

        // );
        //  FabricDefaultAttributeRegistry
    }
}
/**
 * ================================================================
 *
 * ================================================================
 *
 *
 * ------------------------------------------------------------------
 * GENERIC_MAX_HEALTH              20.0     20 = 10
 * GENERIC_KNOCKBACK_RESISTANCE     0.0     0.0~1.0
 * GENERIC_MOVEMENT_SPEED           0.25
 * GENERIC_FLYING_SPEED             0.0
 * GENERIC_ATTACK_DAMAGE            2.0
 * GENERIC_ATTACK_KNOCKBACK         0.0
 * GENERIC_ATTACK_SPEED             4.0
 * GENERIC_ARMOR                    0.0     0~20
 * GENERIC_ARMOR_TOUGHNESS          0.0
 * GENERIC_FOLLOW_RANGE            16.0     AI /
 * GENERIC_LUCK                     0.0
 * GENERIC_MAX_ABSORPTION           0.0
 * GENERIC_JUMP_STRENGTH            0.42
 * GENERIC_GRAVITY                  0.08    1.20.5+
 *
 * :
 */
