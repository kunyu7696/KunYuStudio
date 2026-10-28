# 自定义实体与 AI（Goal / Attribute / 注册）

## 类继承选择（语义基类 → Yarn 类）

- 被动可繁殖：`AnimalEntity`（实现 createChild）
- 被动不可繁殖：`PassiveEntity`
- 敌对：`HostileEntity` 或具体 `Monster`/`PathAwareEntity`
- 投射物：`PersistentProjectileEntity` / `ThrownItemEntity`
- 通用有生命：`MobEntity` / `LivingEntity`

## 标准结构

```java
public class GoblinEntity extends HostileEntity {
    public GoblinEntity(EntityType<? extends HostileEntity> type, World world) { super(type, world); }

    @Override protected void initGoals() {
        this.goalSelector.add(1, new MeleeAttackGoal(this, 1.0, false));
        this.goalSelector.add(5, new WanderAroundFarGoal(this, 0.8));
        this.goalSelector.add(6, new LookAtEntityGoal(this, PlayerEntity.class, 8f));
        this.targetSelector.add(1, new ActiveTargetGoal<>(this, PlayerEntity.class, true, false));
        this.targetSelector.add(2, new RevengeGoal(this));
    }

    public static DefaultAttributeContainer.Builder createAttributes() {
        return HostileEntity.createHostileAttributes()
            .add(EntityAttributes.GENERIC_MAX_HEALTH, 30)
            .add(EntityAttributes.GENERIC_MOVEMENT_SPEED, 0.28)
            .add(EntityAttributes.GENERIC_ATTACK_DAMAGE, 5)
            .add(EntityAttributes.GENERIC_FOLLOW_RANGE, 24)
            .add(EntityAttributes.GENERIC_ARMOR, 4)
            .add(EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, 0.3);
    }
}
```

- 优先级数字越小越优先；goalSelector 控行为，targetSelector 控目标
- 必须 `FabricDefaultAttributeRegistry.register`，否则实体生成时属性表缺失崩溃

## Goal 常用类（Yarn 1.20.1）

- 近战：`MeleeAttackGoal(mob, speed, pauseWhenIdle)`
- 游走：`WanderAroundFarGoal`、`SwimGoal`、`LookAroundGoal`
- 注视：`LookAtEntityGoal`
- 逃跑：`EscapeDangerGoal`（受伤逃）
- 繁殖：`AnimalMateGoal`、`TemptGoal`（持食物跟随）、`FollowParentGoal`
- 目标：`ActiveTargetGoal`、`RevengeGoal`、`FollowTargetIfTamedGoal`

## 自定义 Goal 骨架

```java
public class ChargeAttackGoal extends Goal {
    private final MobEntity mob;
    public ChargeAttackGoal(MobEntity mob) { this.mob = mob;
        setControls(EnumSet.of(Control.MOVE, Control.LOOK)); }
    @Override public boolean canStart() { /* 条件 */ return false; }
    @Override public boolean shouldContinue() { return false; }
    @Override public void start() {}
    @Override public void tick() {}
    @Override public void stop() {}
}
```

- `setControls` 声明占用哪些控制（MOVE/LOOK/JUMP/TARGET），避免与游走类目标互斥冲突

## 生成规则

```java
BiomeModifications.addSpawn(
    BiomeSelectors.includeByKey(BiomeKeys.PLAINS),
    SpawnGroup.MONSTER, ModEntities.GOBLIN, 20, 1, 3);
```

- 权重 0-1000；min/max 群组大小
- 光照/亮度限制：自定义 SpawnRestriction（`SpawnRestriction.register` + LocationPredicate 风格条件）

## 刷怪蛋

- `SpawnEggItem` 注册两个颜色 int；必须落盘 `assets/<ns>/models/item/<id>_spawn_egg.json` = `{"parent":"minecraft:item/template_spawn_egg"}`，否则资源校验 FileNotFoundException
