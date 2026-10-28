# 物品/方块实体数据持久化（NBT / CompoundTag）

1.20.1 没有 Data Components（那是 1.20.5+），自定义数据走 NBT。

## ItemStack NBT

```java
public static final String MANA_KEY = "Mana";

public static int getMana(ItemStack stack) {
    NbtCompound nbt = stack.getNbt();
    return nbt != null && nbt.contains(MANA_KEY) ? nbt.getInt(MANA_KEY) : 0;
}
public static void setMana(ItemStack stack, int v) {
    stack.getOrCreateNbt().putInt(MANA_KEY, v);
}
```

- `getOrCreateNbt()` / `setNbt(null)` 清除；支持类型 putInt/putString/putBoolean/putUuid/putIntArray
- 嵌套：`nbt.put("BlockEntityTag", sub)`
- 注意：物品在工作台/铁砧合成时 NBT 默认丢失，需要 `RecipeRemainingStack` 或自定义 ScreenHandler 保留

## 物品名称与描述

- 自定义名称：`stack.setCustomName(Text.literal("神剑"))`
- 物品提示行：在 Item 子类重写 `appendTooltip(TooltipContext, List<Text>, TooltipType)`
```java
tooltip.add(Text.literal("+10 攻击力").formatted(Formatting.GREEN));
```

## BlockEntity 持久化

```java
public class MachineBlockEntity extends BlockEntity {
    private int energy;
    @Override protected void writeNbt(NbtCompound nbt) {
        super.writeNbt(nbt);
        nbt.putInt("Energy", energy);
    }
    @Override public void readNbt(NbtCompound nbt) {
        super.readNbt(nbt);
        energy = nbt.getInt("Energy");
    }
}
```

- 同步到客户端：重写 `toInitialChunkDataNbt()` 返回 CompoundTag，`markDirty()` 后 `world.updateListeners(pos, state, state, Block.NOTIFY_ALL)`
- BlockEntityType 注册：`FabricBlockEntityTypeBuilder.create(MachineBlockEntity::new, MOD_BLOCK).build()` 并注册到 `Registries.BLOCK_ENTITY_TYPE`

## 实体数据

- `Entity.writeCustomDataToNbt(NbtCompound)` / `readCustomDataFromNbt`：落盘
- `writeCustomDataToPacket` / `readCustomDataFromPacket`：生成追踪数据包（Spawn packet 附加数据）
- 运行时高频同步用 `TrackedDataHandlerRegistry` 注册的 `DataTracker`（旧名 tracked data）：
```java
private static final TrackedData<Integer> MANA =
    DataTrackerRegistry.register(GoblinEntity.class, TrackedDataHandlerRegistry.INTEGER);
dataTracker.startTracking(MANA, 0);
```

## 语言文件

- `assets/<ns>/lang/en_us.json`、`zh_cn.json`：键如 `item.mymod.ruby.title`（物品名）、`block.mymod.ruby_ore`
- 读取用户手编 json 先 strip BOM
