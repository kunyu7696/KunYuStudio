// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.20.1/entity/simple_entity.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.entity;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.entity.SpawnRestriction;
import net.minecraft.entity.attribute.DefaultAttributeContainer;
import net.minecraft.entity.attribute.EntityAttributes;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
import net.minecraft.world.Heightmap;
import net.minecraft.world.World;
/**
 *  - Fabric 1.20.1
 *
 *
 * 1.
 * 2.  Registry.register  EntityType
 * 3.
 * 4. SpawnRestriction
 *

 * :
 * -  (EntityType, World)
 * - EntityType.Builder  dimensions  ""
 *    (0.6f, 1.8f)  0.6x1.8
 * - EntityType  build()  DataFixer null
 * - createMobAttributes()  DefaultAttributeContainer
 * -  FabricDefaultAttributeRegistry entity_attribute.java
 * - SpawnRestriction
 */
public class ExampleEntity extends PathAwareEntity {
    // ================================================================
    // ================================================================
    //  Registry.register  Registries.ENTITY_TYPE
    // : mod_id  mod ID
    public static final EntityType<ExampleEntity> EXAMPLE_ENTITY =
        Registry.register(
            Registries.ENTITY_TYPE,
            new Identifier("examplemod", "example_entity"),
            EntityType.Builder.<ExampleEntity>create(
                    ExampleEntity::new,
                    SpawnGroup.CREATURE
                )
                // x
                .dimensions(0.6f, 1.8f)
                //  5
                .trackingRange(8)
                //  false
                .build(null)
        );
    // ================================================================
    // ================================================================
    //  EntityType
    //  <? extends PathAwareEntity>
    public ExampleEntity(EntityType<? extends PathAwareEntity> entityType, World world) {
        super(entityType, world);
    }
    // ================================================================
    // ================================================================
    // DefaultAttributeContainer
    //  createMobAttributes()
    // :
    // - GENERIC_MAX_HEALTH       20 = 10
    // - GENERIC_MOVEMENT_SPEED   0.25
    // - GENERIC_ATTACK_DAMAGE    2
    // - GENERIC_FOLLOW_RANGE     AI  16
    // - GENERIC_ARMOR
    // - GENERIC_ARMOR_TOUGHNESS
    // - GENERIC_KNOCKBACK_RESISTANCE 0.0~1.0
    public static DefaultAttributeContainer createMobAttributes() {
        return PathAwareEntity.createMobAttributes()
            .add(EntityAttributes.GENERIC_MAX_HEALTH, 20.0)          // 10
            .add(EntityAttributes.GENERIC_MOVEMENT_SPEED, 0.25)      //
            .add(EntityAttributes.GENERIC_ATTACK_DAMAGE, 3.0)        //
            .add(EntityAttributes.GENERIC_FOLLOW_RANGE, 16.0)        //
            .add(EntityAttributes.GENERIC_ARMOR, 0.0)                //
            .add(EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, 0.0); //
    }
    // ================================================================
    // ================================================================
    // SpawnRestriction
    //  EntityType
    public static void registerSpawnRestrictions() {
        // :
        // 1.
        // 2. ON_GROUND  / IN_WATER  / ANY

        // 3. MOTION_BLOCKING
        // 4.
        // [版本修正] SpawnRestriction.register 在所有版本均为 4 参（无 SpawnRestriction.Method），原第4参已删
        SpawnRestriction.register(
            EXAMPLE_ENTITY,
            SpawnRestriction.Location.ON_GROUND,
            Heightmap.Type.MOTION_BLOCKING,
            (entityType, worldAccess, spawnReason, blockPos, random) -> {
                // :
                return worldAccess.getBlockState(blockPos.down()).isSolidBlock(
                    worldAccess, blockPos.down()
                );
            }
        );
    }
    // ================================================================
    //  tick
    // ================================================================
    @Override
    public void tick() {
        super.tick();
        //  tick
        // :
    }
    // ================================================================
    //  AI
    // ================================================================
    @Override
    protected void initGoals() {
        //  AI Goal
        //  AI:
        // - MeleeAttackGoal
        // - WanderAroundGoal
        // - LookAtEntityGoal
        // - FollowTargetGoal
        // - SwimGoal
    }
}
