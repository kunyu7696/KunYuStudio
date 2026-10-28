# AI 目标（Goal）与行为选择器

## 双选择器

- `goalSelector`：决定「做什么」（游走、攻击、游泳、看玩家），数字越小越优先
- `targetSelector`：决定「打谁」（最近玩家、伤害者反击、同类增援）

## 常用目标（Yarn 1.20.1）

| 目标类 | 作用 |
| --- | --- |
| MeleeAttackGoal | 靠近并近战 |
| RangedAttackGoal | 保持距离远程攻击（实现 RangedAttackMob 接口） |
| SwimGoal | 水中上浮（几乎所有陆地生物必备） |
| WanderAroundFarGoal | 随机游走 |
| LookAtEntityGoal | 注视某类实体（通常 PlayerEntity） |
| LookAroundGoal | 随机看四周 |
| EscapeDangerGoal | 白天/受威胁逃离（亡灵用避免阳光变体） |
| AnimalMateGoal | 繁殖 |
| TemptGoal | 被手持指定食物的玩家吸引 |
| FollowParentGoal | 幼年跟随成年 |
| EatGrassGoal | 吃草（羊） |
| BreakDoorGoal | 破门（僵尸类） |

## targetSelector

- `ActiveTargetGoal(entity, targetClass, checkVisibility, checkCanTarget)`：主动索敌
- `RevengeGoal`：反击最近伤害者（setGroupRevenge 可联动同类）
- `FollowTargetGoal` / `TrackOwnerAttackerGoal`：驯服宠物帮主人
- `NearestAttackableTargetGoal`：按类索敌的通用版

## Control 占用

自定义 Goal 构造里 `setControls(EnumSet.of(Control.MOVE, Control.LOOK))`：
- 同一时刻同一控制只允许一个目标运行；不声明会导致多个移动目标抢路径
- JUMP（兔子/鹦鹉）、TARGET（索敌锁定）、LOOK（转头）

## canStart / shouldContinue / tick

- `canStart`：每 tick 评估一次（开销大时加冷却 tick），返回 true 才 start
- `shouldContinue`：运行中每 tick 检查，false 立即 stop
- `start/stop/tick`：进入、退出（要回正速度/朝向）、每 tick 行为

## Boss 行为编排建议

- 阶段切换靠自定义 Goal + 血量阈值（在 `computeFallDamage`/`onDamaged` 里切 phase）
- 每阶段一个 Goal 组，配合 `setControls` 互斥；技能冷却在 tick 里倒计时
- 远程弹幕阶段目标用 RangedAttackGoal 的自定义变体，不要直接在实体 tick 里生成火球（绕过目标系统会导致寻路卡死）
