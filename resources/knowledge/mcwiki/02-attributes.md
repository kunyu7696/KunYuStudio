# 属性系统（Attributes / 实体属性）

实体的战斗与移动数值由属性容器管理，实体生成前必须完成注册。

## 1.20.1 常用属性（Yarn GENERIC_ 前缀）

- `GENERIC_MAX_HEALTH`：最大生命值（20 = 10 颗心）
- `GENERIC_MOVEMENT_SPEED`：移动速度（玩家约 0.1，普通怪 0.23-0.3）
- `GENERIC_ATTACK_DAMAGE`：攻击伤害（玩家基准 1，显示的「攻击力」=1+该值）
- `GENERIC_ARMOR`：护甲值（0-30）
- `GENERIC_ARMOR_TOUGHNESS`：护甲韧性（钻石 2，下界合金 3）
- `GENERIC_KNOCKBACK_RESISTANCE`：击退抗性（0-1，1 完全免疫）
- `GENERIC_FOLLOW_RANGE`：追踪距离（默认 16/32）
- `GENERIC_ATTACK_KNOCKBACK`：攻击击退
- `GENERIC_LUCK`：幸运（影响战利品运气）
- 马类：`HORSE_JUMP_STRENGTH`；僵尸：`GENERIC_SPAWN_REINFORCEMENTS`

## 注册

```java
public static DefaultAttributeContainer.Builder createAttributes() {
    return HostileEntity.createHostileAttributes()
        .add(EntityAttributes.GENERIC_MAX_HEALTH, 30.0)
        .add(EntityAttributes.GENERIC_MOVEMENT_SPEED, 0.28)
        .add(EntityAttributes.GENERIC_ATTACK_DAMAGE, 5.0);
}
// 实体类型注册后立即：
FabricDefaultAttributeRegistry.register(ModEntities.GOBLIN, createAttributes());
```

- 不注册属性会在实体生成时崩溃（空属性容器）

## 修饰符（AttributeModifier）

- 临时改变属性用 UUID + `EntityAttributeModifier`：
```java
instance.addTemporaryModifier(new EntityAttributeModifier(uuid, "rage bonus", 4.0,
    EntityAttributeModifier.Operation.ADDITION));
```
- Operation：`ADDITION` 加算；`MULTIPLY_BASE` 乘基础（百分比相加后乘）；`MULTIPLY_TOTAL` 总乘
- 装备效果（护甲/攻击速度）也是靠修饰符实现

## 设计参考（boss 数值阶梯）

- 普通敌对：血量 16-30、伤害 3-6
- 精英：血量 60-120、伤害 8-12、护甲 8-15
- Boss：血量 200-500、伤害 12-20、击退抗性 0.5-1、追踪 48
