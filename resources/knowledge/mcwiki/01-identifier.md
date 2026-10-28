# 命名空间、注册名与 Identifier

## 概念

Minecraft 几乎所有内容（方块、物品、实体、附魔、声音、粒子、菜单类型…）都通过「注册名」唯一确定。

- 完整形式：`namespace:path`，如 `minecraft:diamond`、`mymod:ruby_ore`
- 省略命名空间时默认 `minecraft:`；自定义模组内容必须用自己的命名空间（通常等于 mod id）
- path 规则：小写字母 `a-z`、数字 `0-9`、下划线 `_`、斜杠 `/`、点 `.`、减号 `-`；禁止大写字母与空格

## 代码侧

- Java 类：`net.minecraft.util.Identifier`（Yarn 1.20.1）
- 创建：`new Identifier("mymod", "ruby_ore")`
- 注册表：`Registry.register(Registries.ITEM, new Identifier("mymod","ruby"), item)`

## 与资产/数据路径的对应

| 注册名 | 资产/数据路径 |
| --- | --- |
| 物品 mymod:ruby | `assets/mymod/models/item/ruby.json`、`textures/item/ruby.png` |
| 方块 mymod:ruby_ore | `assets/mymod/blockstates/ruby_ore.json`、`data/mymod/loot_tables/blocks/ruby_ore.json` |
| 实体 mymod:goblin | `assets/mymod/textures/entity/goblin.png`、语言键 `entity.mymod.goblin` |

## 语言文件键

- 物品：`item.<ns>.<path>`；方块：`block.<ns>.<path>`；实体：`entity.<ns>.<path>`
- 语言文件：`assets/<ns>/lang/en_us.json`、`zh_cn.json`

## 常见错误

- 注册了 BlockItem 但忘记加入 ItemGroup：物品存在但创造栏找不到
- 命名空间大小写错（`MyMod:Ruby`）：直接抛 InvalidIdentifierException
- 自定义内容误用 minecraft 命名空间：可能覆盖原版或加载顺序冲突
