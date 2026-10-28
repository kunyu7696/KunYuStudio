# GameTest 无头测试框架

Fabric 提供服务端无头（无客户端渲染）结构化测试，CI 里跑 `runGameTestServer`。

## 依赖

`build.gradle`：
```groovy
modTestImplementation "net.fabricmc.fabric-api:fabric-gametest-api-v1:${project.fabric_version}"
```

loom 开启 split source sets 时测试放 `src/test/java` 或 client/test 对应源集。

## 测试骨架

```java
public class GoblinGameTest {
    @GameTest(structureName = "fabric-gametest-api-v1:empty", tickCount = 100)
    public static void goblinAttacksDummy(TestContext ctx) {
        BlockPos pos = new BlockPos(1, 2, 1);
        GoblinEntity goblin = new GoblinEntity(ModEntities.GOBLIN, ctx.getWorld());
        goblin.refreshPositionAndAngles(ctx.getAbsolutePos(pos), 0, 0);
        ctx.getWorld().spawnEntity(goblin);

        // 安排未来 tick 的断言
        ctx.runAtTickTime(40, () -> {
            ctx.assertTrue(goblin.getTarget() != null, "goblin should have target");
            ctx.complete();
        });
    }
}
```

- structureName：结构模板（空地用空结构，或导出自己的场地 .nbt 放 `data/<ns>/structures/`）
- tickCount：超时 tick 数；超时自动失败
- `@GameTest` 方法必须 static；批量注册可在 ModInitializer 里 `GameTestRegistry.registerTestClass(GoblinGameTest.class)`（注解自动扫描需要 fabric.mod.json 的 entrypoint gametest）

## 常用断言

- `ctx.complete()` 立即成功；`ctx.completeWhen(condition)` 每 tick 轮询直到真
- `ctx.expectBlock(Block, pos)`、`expectBlockAtEnd`
- `ctx.succeedWhenEntityPresent/Dead`、`assertEntityPresent`
- `ctx.setBlockState(pos, state)`
- `ctx.runAtTickTime(t, runnable)`、`ctx.waitAndExecute(ticks, runnable)`
- `ctx.spawnItem`、`ctx.mockItem`（无需注册的桩物品）、`ctx.spawnMob(EntityType, pos)`

## 运行

- `./gradlew runGameTestServer`：启动无头服务端跑全部测试，成功退出码 0
- 单测过滤：`--args='--gatest GOBLIN_TESTS'`（类名/方法名模式，版本相关参数以 loom 文档为准）

## 与坤舆流水线的关系

- `.kunyu/content/gametest/*.json` 声明用例时，构建后自动 headless 预跑；无 GameTest 时回退 kunyu-observer 真机探测
- GameTest 验证「逻辑/属性/AI」；视觉（模型/动画/贴图）仍靠真机截图自审
