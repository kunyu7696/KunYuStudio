# 合成配方（Recipes）速查

## 文件

`data/<ns>/recipes/<id>.json`，文件名即配方 id（可与物品不同名，但建议同名）。

## 有序合成 crafting_shaped

```json
{
  "type": "minecraft:crafting_shaped",
  "pattern": ["III", " S ", " S "],
  "key": {
    "I": { "item": "minecraft:iron_ingot" },
    "S": { "item": "minecraft:stick" }
  },
  "result": { "item": "minecraft:iron_pickaxe", "count": 1 }
}
```

- pattern 1-3 行，每行 1-3 字符；空格 = 空位
- key 把字符映射到 ingredient；`'I'` 等大写字母与物品无关，只是占位符
- ingredient 形式（1.20.1）：`{"item":"minecraft:iron_ingot"}`、`{"tag":"minecraft:planks"}`（标签任意一种）
- 合成台自动镜像左右对称配方（镐/斧无需写第二份）；不对称时（弓）也默认镜像，需要在 1.21+ 才有关闭选项

## 无序合成 crafting_shapeless

```json
{
  "type": "minecraft:crafting_shapeless",
  "ingredients": [ { "item": "mymod:ruby" }, { "tag": "minecraft:planks" } ],
  "result": { "item": "mymod:ruby_handle" }
}
```

## 烧炼 smelting / 其他

```json
{
  "type": "minecraft:smelting",
  "ingredient": { "item": "mymod:deepslate_ruby_ore" },
  "result": "mymod:ruby",
  "experience": 0.7,
  "cookingtime": 200
}
```

- type：smelting（熔炉 200t）/ blasting（高炉 100t，金属）/ smoking（烟熏炉，食物）/ campfire_cooking（600t）
- 石材切制：`minecraft:stonecutting`，ingredient + result + count
- 锻造：1.20.1 为 `minecraft:smithing`（ingredient + base + addition + result，旧无模板）

## 检查与调试

- 加入世界后 `/reload`，`/recipe give @p *` 验证全部解锁
- 配方不出现：JSON 解析错误看日志；result 物品 id 拼错不报错但合成无产物
- 一个产物多配方：多个文件同 result 完全合法
