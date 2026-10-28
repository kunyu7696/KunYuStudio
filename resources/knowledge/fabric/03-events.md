# Fabric 事件回调（Events / Callbacks）

Fabric API 把原版硬编码时机暴露成事件，在 `onInitialize()` 注册，避免写 Mixin。

## 玩家与生命周期

- `ServerPlayConnectionEvents.JOIN`：玩家进服（`handler, sender, server`），发欢迎消息/网络包
- `ServerPlayConnectionEvents.DISCONNECT`：玩家离服
- `ServerLifecycleEvents.SERVER_STARTED` / `SERVER_STOPPING`：服务端启停
- `ServerTickEvents.END_SERVER_TICK`：每 tick 末；`END_WORLD_TICK`：每个世界 tick
- `ClientTickEvents.END_CLIENT_TICK`：客户端 tick（client 入口注册）

## 玩家行为

- `AttackEntityCallback.EVENT`：玩家攻击实体（返回 ActionResult，PASS/FAIL/ SUCCESS）
- `UseBlockCallback.EVENT` / `UseItemCallback.EVENT`：右键方块/物品（服务端逻辑入口）
- `UseEntityCallback.EVENT`：右键实体
- `PlayerBlockBreakEvents.BEFORE / AFTER`：方块破坏前（可取消）/后
- `AttackBlockCallback.EVENT`：左键方块

## 世界变化

- `ServerWorldEvents.LOAD / UNLOAD`
- `ServerChunkEvents.CHUNK_LOAD`（注意性能：实体生成不要在这里做重活）
- `ServerEntityEvents.ENTITY_LOAD`：实体加载进世界（可用作自定义实体的服务端补数据）

## 注册示例

```java
ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
    Text msg = Text.literal("欢迎，").append(handler.player.getDisplayName());
    sender.sendMessage(msg);
});

UseItemCallback.EVENT.register((player, world, hand) -> {
    if (!world.isClient && player.getStackInHand(hand).isOf(Items.STICK)) {
        player.setHealth(player.getHealth() - 1f);
        return TypedActionResult.success(player.getStackInHand(hand));
    }
    return TypedActionResult.pass(player.getStackInHand(hand));
});
```

## ActionResult 语义

- `success(stack)`：成功并挥臂；`consume(stack)`：成功不挥臂；`pass(stack)`：放行后续逻辑；`fail(stack)`：拒绝
- 回调只在服务端 world 改状态：`if (!world.isClient)` 守卫

## 命令注册

- `CommandRegistrationCallback.EVENT`：`dispatcher.register(CommandManager.literal("home").executes(ctx -> {...}))`
- 参数类型 `StringArgumentType`、`EntityArgumentType` 等来自 brigadier（`com.mojang.brigadier`）

## 找不到事件时

- 事件清单见 fabric-api 各模块 `net.fabricmc.fabric.api.*.v1.*Events`
- 确无事件再用 Mixin 注入目标方法（见 Mixin 篇）
