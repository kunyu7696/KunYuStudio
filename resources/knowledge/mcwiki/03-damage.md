# 伤害系统（DamageSource / DamageTypes）

## 1.20.1 的变化

伤害来源改为注册表数据驱动：`data/minecraft/damage_type/<id>.json` 定义，代码用 `RegistryEntry<DamageType>`。

## 伤害类型 JSON

```json
{
  "message_id": "goblinSlash",
  "scaling": "when_caused_by_living_non_player",
  "exhaustion": 0.1,
  "effects": "hurt"
}
```

- `message_id`：死亡消息键前缀
- `scaling`：难度缩放（always / when_caused_by_living_non_player / never）
- `effects`：hurt（受伤闪红）/ thorns（荆棘音效）/ drowning / burning / freezing / poking

## 代码造成伤害

```java
// 自定义类型 key
public static final RegistryKey<DamageType> GOBLIN_SLASH =
    RegistryKey.of(RegistryKeys.DAMAGE_TYPE, new Identifier(MOD_ID, "goblin_slash"));

DamageSource source = entity.getDamageSources()
    .create(ModDamageTypes.GOBLIN_SLASH, attacker);
target.damage(source, 6.0f);
```

- `getDamageSources().create(key, attacker)` / `.create(key, projectile, attacker)` / `.create(key)`
- 原版便利来源：`mobAttack(mob)`、`playerAttack(player)`、`thrownProjectile(p, owner)`、`magic()`、`wither()`、`generic()`

## 伤害结算要点

- 护甲减伤：`damage * (1 - min(20, armor)/25)`，再经韧性修正
- 护甲韧性压制高伤害穿透；附魔保护按 EPF（附魔保护系数）再减最多 80%
- 无敌帧：实体受伤后 10 tick 内默认只认更高伤害；同 tick 多次小伤害会被吞（需要用不同来源或绕过）
- `LivingEntity#applyDamage(source, amount)` 是减伤后的实际扣血点；`damage()` 之前可被事件取消

## 免疫与判断

- `entity.isInvulnerableTo(source)`：创造模式玩家、火焰伤害对火焰免疫生物等
- `entity.damage(source, amount)` 返回 boolean 表示是否结算成功
- 死亡消息：`DeathMessageMessageType` + lang 键 `death.attack.<message_id>`
