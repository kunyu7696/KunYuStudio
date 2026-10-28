# 命令与函数（Commands / mcfunction）

## Brigadier 注册（Fabric）

```java
CommandRegistrationCallback.EVENT.register((dispatcher, access, env) -> {
    dispatcher.register(CommandManager.literal("goblin")
        .requires(src -> src.hasPermissionLevel(2))
        .then(CommandManager.argument("target", EntityArgumentType.players())
            .executes(ctx -> {
                ServerPlayerEntity p = EntityArgumentType.getPlayer(ctx, "target");
                p.damage(p.getDamageSources().generic(), 3f);
                return 1;
            })));
});
```

- 参数：`StringArgumentType.word/string/greedyString`、`IntegerArgumentType.integer(min,max)`、`EntityArgumentType.player/players/entity`、`BlockPosArgumentType.blockPos()`、`ItemStackArgumentType.itemStack(regries)`
- 取值：`EntityArgumentType.getPlayer(ctx, name)`；返回值 int = 成功数（0=失败）
- 客户端也能注册 client 命令：`ClientCommandRegistrationCallback`（不存在时不会发给服务端）

## 反馈文本

- 服务端：`ctx.getSource().sendFeedback(() -> Text.literal("成功"), false)`（第二参是否广播给管理员日志）
- 失败：`ctx.getSource().sendError(Text.literal("目标不存在"))`

## mcfunction（数据包函数）

`data/<ns>/functions/heal_all.mcfunction`：
```
effect give @a minecraft:regeneration 5 1
playsound minecraft:entity.player.levelup player @a
```

- 每行一条命令；`# 注释`；不支持 if/for，逻辑用多个函数 + 命令树组合
- 执行：`/function <ns>:heal_all`
- 标签函数：`data/minecraft/tags/functions/load.json`（加载时执行）、`tick.json`（每 tick）
```json
{ "values": ["mymod:init"] }
```

## 函数宏（1.20.2+，1.20.1 不可用）

带 `$` 前缀的行支持 `$(var)` 变量替换，调用时用 SNBT 传参：

```
# data/mypack/functions/greet.mcfunction
$say 你好，$(name)！你的分数是 $(score)

# 调用：
/function mypack:greet {name:"Steve", score:42}
```

- 只有以 `$` 开头的行才做宏替换；同一函数可混用普通行
- 宏也可以由 `execute ... run function` 链带参调用，配合 storage 里的数据先 `data get` 再传
- 1.20.1 的 mcfunction 不支持 `$` 宏替换；需要参数化用 execute store 或直接在 Java 里注册命令

## 记分板实战骨架（计时器/抽奖/商店通用）

```
# init：dummy 目标 + 常量
scoreboard objectives add timer dummy
scoreboard players set #tick timer 0

# tick 函数（tags/functions/tick.json）：每 tick 加分、到阈值触发、归零循环
scoreboard players add #tick timer 1
execute if score #tick timer matches 20.. run function mypack:one_second
execute if score #tick timer matches 20.. run scoreboard players set #tick timer 0
```

- 检测玩家行为驱动分数：`execute as @a[scores={mine_stone=1..}]`（自定义准则项如 used、mined、killed 触发后立刻 `scoreboard players reset` 防重复触发）
- 「击杀生物给奖励」= 击杀统计准则 + 检测 + give + 重置；「商店」= 检测分数达标 + clear 货币 + give 商品；「抽奖」= random 值域或战利品表 random_chance 配分数区间
- 跨函数传数值优先 storage + macro，其次记分板虚拟玩家（`#常量` 开头的假玩家名）

## execute 链（数据包常用）

- `execute as @e[type=mymod:goblin] at @s run ...`
- `execute if entity @a[distance=..10] run ...`
- `execute positioned ~ ~10 ~ run ...`
- 记分板：`scoreboard objectives add hp dummy` + `execute store result score @s hp run data get entity @s Health`
