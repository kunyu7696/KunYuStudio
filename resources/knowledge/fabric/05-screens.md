# GUI：ScreenHandler 与 Screen

容器型 GUI（箱子/机器）用 ScreenHandler 体系，自动处理多人同步；纯客户端界面用 Screen。

## 容器 GUI 三件套

1. `ScreenHandlerType<T>` 注册到 `Registries.SCREEN_HANDLER`
2. 服务端 Handler 继承 `GenericContainerScreenHandler` 或直接 `ScreenHandler`
3. 客户端 `Screen` 继承 `HandledScreen<T>`，在 client 入口 `HandledScreens.register(...)`

## 最简箱子型（9 槽）

```java
// 服务端打开
player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
    (syncId, inv, p) -> GenericContainerScreenHandler.createGeneric9x3(
        ScreenHandlerType.GENERIC_9X3, syncId, inv, container, 3),
    Text.literal("我的箱子")));
```

## 自研槽位

```java
this.addSlot(new Slot(inventory, index, x, y) {
    @Override public boolean canInsert(ItemStack stack) {
        return stack.isIn(ModTags.GEMS);   // 只接受某标签
    }
});
```

- 玩家背包槽位：27  storage + 9 hotbar，用 `addPlayerSlots(inv, x, y)` 帮助方法或手写三层循环

## 属性同步（进度条/能量）

- 服务端 `this.addProperties(new PropertyDelegate() { get(i){...} set(i,v){...} size(){return 2;} })`
- 客户端 `handler.getDelegate().get(0)` 取同步值，重绘进度条

## 纯客户端 Screen

```java
public class ManaScreen extends Screen {
    protected ManaScreen() { super(Text.literal("Mana")); }
    @Override protected void init() { /* addDrawableChild(ButtonWidget...) */ }
    @Override public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
        this.renderBackground(ctx);
        super.render(ctx, mouseX, mouseY, delta);
    }
}
// 打开：MinecraftClient.getInstance().setScreen(new ManaScreen());
```

- 1.20.1 渲染统一走 `DrawContext`：drawTexture / fill / drawText
- `ButtonWidget.builder(Text, btn -> {...}).dimensions(x,y,w,h).build()`
- 按键绑定：`KeyBindingHelper.registerKeyBinding(new KeyBinding(...))`，在 client tick 里 `wasPressed()`

## 常见错误

- 客户端直接改世界状态（必须发包让服务端改）
- ScreenHandler 槽位数服务端/客户端不一致导致 desync
