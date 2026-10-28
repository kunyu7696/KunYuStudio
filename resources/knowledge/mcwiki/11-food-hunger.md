# 食物与饱食度（Food / Hunger）

## 食物物品

1.20.1 食物组件挂在 Item.Settings：

```java
public static final Item MEAT_KEBAB = new Item(new Item.Settings()
    .food(new FoodComponent.Builder()
        .hunger(8)              // 鸡腿数（饱食度恢复，玩家满 20）
        .saturationModifier(0.8f)  // 饱和度系数（实际饱和度 = 2 × hunger × modifier）
        .meat()                 // 肉食（狗可喂）
        .alwaysEdible()         // 满饥饿也能吃（金苹果/药水食物）
        .statusEffect(new StatusEffectInstance(STATUS_EFFECT, 600), 0.5f) // 50% 概率
        .build()));
```

- 原版数值参考：面包 hunger 5 / sat 0.6；牛排 8 / 0.8；金胡萝卜 6 / 1.2（饱和度最高之一）；金苹果 4 / 1.2 + 效果；附魔金苹果 4 / 1.2 + 强效果 alwaysEdible
- 吃东西耗时固定 32 tick；`finishUsing` 触发（可重写自定义进食逻辑，如喝完返回玻璃瓶：用 REMAINDER）

## 机制

- 饥饿值（foodLevel 0-20）：奔跑/跳跃/攻击消耗；为 0 时按难度掉血
- 饱和度（0-20，隐藏）：先消耗饱和度才减饥饿；进食同时补两者
- 饱食度（foodSaturationLevel）耗尽后才开始饿
- 自然回血：饥饿 ≥18（和平 ≥18 或任意难度 18+）消耗饱和度/饥饿换血

## 自定义进食逻辑

重写 Item 的：
- `use(world, user, hand)` 返回 `consume` 触发进食动画（或写自定义 UseAction EAT/DRINK）
- `finishUsing(stack, world, user)`：施加自定义效果、播放声音、返回剩余物品（瓶子）
- `getUseTime`：饮用类更长（药水 32）

## minecraft-data 食物数据

- mc_data_lookup kind=food 返回 foodPoints / saturation / stackSize，写自定义食物数值前先查原版参照物保持平衡
