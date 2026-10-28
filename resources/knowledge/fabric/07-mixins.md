# Mixin 入门与常用注入（1.20.1 / Yarn）

事件 API 覆盖不到的原版行为才用 Mixin。Mixin 在编译期合并字节码。

## 配置 fabric.mod.json

```json
"mixins": ["mymod.mixins.json"]
```

`resources/mymod.mixins.json`：
```json
{
  "required": true,
  "package": "com.example.mymod.mixin",
  "compatibilityLevel": "JAVA_17",
  "mixins": ["PlayerEntityMixin"],
  "client": ["MinecraftClientMixin"],
  "injectors": { "defaultRequire": 1 }
}
```

- 通用 mixin 放 `mixins`；仅客户端（渲染/输入类）放 `client`
- `defaultRequire: 1`：至少注入 1 处否则崩溃（防止静默失效）

## 注入类型

### @Inject（最常用：方法头/尾/任意 INVOKE 点）

```java
@Mixin(LivingEntity.class)
public abstract class LivingEntityMixin {
    @Inject(method = "damage", at = @At("HEAD"))
    private void onDamage(DamageSource source, float amount, CallbackInfoReturnable<Boolean> cir) {
        // 受伤时触发逻辑；void 方法用 CallbackInfo，有返回值用 CallbackInfoReturnable
    }
}
```

- `at = @At("HEAD")` 方法头、`@At("RETURN")` 每个返回点
- 取消：`cir.setReturnValue(false)` + `cir.cancel()`（HEAD 取消要谨慎）

### @Redirect（重定向单次方法调用/字段访问）

```java
@Redirect(method = "attack", at = @At(value = "INVOKE",
    target = "Lnet/minecraft/entity/Entity;setVelocity(DDD)V"))
private void redirectVelocity(Entity entity, double x, double y, double z) { ... }
```

- @Redirect 同一注入点不能被两个 mixin 同时占用，冲突优先改用 @WrapOperation

### @ModifyVariable / @ModifyConstant / @WrapOperation

- @ModifyVariable：改局部变量
- @ModifyConstant：替换硬编码常量（如把某数值 0.02 改掉）
- @WrapOperation（MixinExtras，Fabric Loader 0.15 内置）：包装原调用，可前后加工且可叠加

### @Overwrite（危险）

- 整个替换方法，几乎不要用；与其他 mod 冲突率最高

### @Accessor / @Invoker

```java
@Mixin(MinecraftClient.class)
public interface MinecraftClientAccessor {
    @Accessor("itemUseCooldown") void setUseCooldown(int v);
    @Invoker("doAttack") boolean invokeDoAttack();
}
```

- 访问 private 字段/方法，反射的类型安全替代

## 目标描述符

- `target` 用 JVM 描述符：`L类全限定名;方法名(参数)返回值`，如 `Lnet/minecraft/entity/Entity;isAlive()Z`
- Yarn 映射名随版本变化：先用 mc_search/mc_get_class 核对 1.20.1 真实方法名再写注入

## 调试

- `./gradlew genSourcesWithVineflower` 生成带注释的反编译源码（IDEA 直接点进原版类）
- Mixin 应用失败日志关键字：`Invalid injection point`、`Critical injection conflict`、`was not found`
- `-Dmixin.debug.export=true` 导出转换后类到 `.mixin.out`
