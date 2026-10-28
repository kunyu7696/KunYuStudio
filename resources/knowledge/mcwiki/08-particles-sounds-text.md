# 粒子、声音与文本反馈

## 粒子（Particles）

代码直接播放原版粒子无需注册：

```java
world.addParticle(ParticleTypes.HAPPY_VILLAGER,
    x, y, z, velocityX, velocityY, velocityZ);
// 服务端发包给所有追踪玩家（推荐，避免客户端独占）：
ServerWorld sw = (ServerWorld) world;
sw.spawnParticles(ParticleTypes.ENCHANT, x, y, z, count, dx, dy, dz, speed);
```

- 常用：ENCHANT（附魔符文）、HAPPY_VILLAGER（绿心）、HEART、CRIT、SMOKE、LARGE_SMOKE、FLAME、SOUL_FIRE_FLAME、PORTAL、EXPLOSION、POOF、ELECTRIC_SPARK、BLOCK（带参数方块状态）
- 自定义粒子：注册 DefaultParticleType + client ParticleFactory（SpriteProvider 提供贴图序列）
- 性能：单实体每 tick 粒子控制在个位数；范围粒子用 count 而非循环多次调用

## 声音（Sound Events）

```java
public static final RegistryEntry.Reference<SoundEvent> GOBLIN_AMBIENT =
    Registries.SOUND_EVENT.entryOf(RegistryKey.of(RegistryKeys.SOUND_EVENT, new Identifier(MOD_ID, "entity.goblin.ambient")));
// 或简单注册：Registry.register(Registries.SOUND_EVENT, id, SoundEvent.of(id))
```

播放：
```java
world.playSound(null, x, y, z, SoundEvents.AMBIENT_CAVE, SoundCategory.HOSTILE, 1.0f, 1.0f);
// 参数：听众 null=附近所有玩家、事件、类别、音量、音调(0.5-2.0)
```

- 实体音效用 `getSoundVolume()/getSoundPitch()` 配合 ambient 声音字段；`playAmbientSound` 由 LivingEntity 调度
- assets：sounds.json 映射事件 → ogg 文件列表；文件必须 OGG Vorbis，路径 `assets/<ns>/sounds/...`
- SoundCategory 决定玩家音量设置页的分类

## 自定义音乐唱片（资源包 + 数据包双端，1.21+）

资源包侧——注册声音事件并放音频：

```
assets/<ns>/sounds.json
assets/<ns>/sounds/records/my_song.ogg   ← 必须 OGG Vorbis（用 Audacity/ffmpeg 转换）
```

```json
{ "records.my_song": { "sounds": [ { "name": "<ns>:records/my_song" } ] } }
```

数据包侧——声明唱片歌曲：

```
data/<ns>/jukebox_song/my_song.json
```

```json
{
  "sound_event": "<ns>:records.my_song",
  "description": { "text": "My Song" },
  "length_in_seconds": 95.0,
  "comparator_output": 7
}
```

物品侧——任意物品加组件即成唱片（1.21+）：

```
/give @s minecraft:paper[minecraft:jukebox_playable={song:"<ns>:my_song"}]
```

- 放进唱片机播放；`comparator_output` 决定红石比较器输出强度
- 唱片外观贴图/模型走资源包常规贴图与物品模型定义（见 14-item-model-definitions）

## 文本（Text）

- `Text.literal("字面")`；`Text.translatable("entity.mymod.goblin")`；`Text.of(String)`
- 样式：`.formatted(Formatting.RED, Formatting.BOLD)`、`.styled(s -> s.withColor(0x4ade80))`
- 拼接：`Text.literal("").append(a).append(b)`；hover/click：`.styled(s -> s.withHoverEvent(new HoverEvent(...)))`
- actionbar：`player.sendMessage(text, true)`（第二参 overlay=true 走 hotbar 上方）
- 标题：TitleS2C 包或服务端 `serverPlayer.networkHandler.sendPacket(new TitleS2C(...))`；更常用 fabric 的 CommandSource#sendFeedback

## translate 组件与语言文件（本地化）

文本组件 `{"translate":"<key>","with":[...]}` 按客户端语言自动换文案，语言文件在资源包：

```
assets/<ns>/lang/zh_cn.json     { "item.mypack.my_sword": "我的剑", "msg.mypack.kill": "%s 被 %s 击杀了" }
assets/<ns>/lang/en_us.json     { "item.mypack.my_sword": "My Sword" }
```

- 查找顺序：当前语言 → en_us 兜底 → 都没有则直接显示翻译键本身
- `%s` 按顺序填 `with` 数组（元素也是文本组件，可再嵌套 translate）；字面百分号写 `%%`；`%1$s` 可乱序引用——不同语种的语序差异靠它解决
- 在 `assets/minecraft/lang/` 下定义**与原版同名的键**可覆盖原版文案（改名原版物品/进度文本）
- 数据包/命令里使用：`/tellraw @a {"translate":"msg.mypack.kill","with":[{"selector":"@s"},{"text":"苦力怕"}]}`

## Boss 血条

- 服务端 `BossBar`：`new ServerBossBar(name, color, style)`，`addPlayer`/`removePlayer`，`setPercent(hp/maxHp)` 每帧更新
- 颜色 PINK/BLUE/RED/GREEN/YELLOW/PURPLE/WHITE；样式 PROGRESS/NOTCHED_6/NOTCHED_10/NOTCHED_12/NOTCHED_20
