# KubeJS 配方速查（添加 / 移除 / 替换）

> 灵感来源：B 站《从零开始的 MC 整合包制作教程 #7：KubeJS 简单配方添加》（b23.tv/RP5lJYk）。
> 内容依据 KubeJS 官方 wiki（kubejs.com/wiki/tutorials/recipes）重写整理，不搬运视频原文。
> 适用：KubeJS 6/7（MC 1.18.2 ~ 1.21.x）；标注了版本分叉的语法差异。

## 基本框架

- 配方脚本放 `server_scripts/` 目录（服务端脚本），改完进游戏 `/reload` 即生效，无需重启。
- 1.19.2 及以上用 `ServerEvents.recipes`；1.18.2 用 `onEvent('recipes', ...)`：

```js
// 1.19.2+
ServerEvents.recipes(event => {
  // 所有配方增删改都写在这个回调里
})

// 1.18.2
onEvent('recipes', event => { /* 同上 */ })
```

## 物品书写法（全事件通用）

- `'minecraft:iron_ingot'`：物品 id
- `'3x minecraft:gravel'`：`Nx ` 前缀 = 数量（仅输出位可用）
- `'#minecraft:planks'`：`#` 前缀 = 物品标签（输入位任意一种匹配）
- `Item.of('minecraft:stone', 3)`：等价的对象写法，可携带 NBT/组件
- `Ingredient.of('#minecraft:saplings')`：标签作为配料的显式写法

## 添加配方

### 有序合成 event.shaped(output, pattern, key)

```js
event.shaped(
  Item.of('minecraft:stone', 3),   // 产物（数量 1-64）
  [ 'A B', ' C ', 'B A' ],          // 形状：≤3 行、每行 ≤3 字符，空格=空位
  { A: 'minecraft:andesite',        // 字母→物品映射；字母只是占位符，与物品无关
    B: 'minecraft:diorite',         // 输入物品数量必须为 1
    C: 'minecraft:granite' }
)
```

### 无序合成 event.shapeless(output, inputs)

```js
event.shapeless(Item.of('minecraft:dandelion', 3), [
  'minecraft:bone_meal',
  'minecraft:yellow_dye',
  '3x minecraft:ender_pearl'        // 输入总物品数 ≤ 9
])
```

### 锻造 event.smithing（版本分叉）

```js
// 1.20+：四参（产物, 模板, 被升级物, 升级材料）
event.smithing(
  'minecraft:netherite_ingot',
  'minecraft:netherite_upgrade_smithing_template',
  'minecraft:iron_ingot',
  'minecraft:black_dye'
)
// 1.19.2 及以下：三参（无模板位）
event.smithing('minecraft:netherite_ingot', 'minecraft:iron_ingot', 'minecraft:black_dye')
```

### 烧炼 event.smelting / blasting / smoking / campfireCooking(output, input)

```js
event.smelting('3x minecraft:gravel', 'minecraft:stone')
event.blasting('10x minecraft:iron_nugget', 'minecraft:iron_ingot')
event.smoking('minecraft:tinted_glass', 'minecraft:glass').xp(0.35)          // .xp() 链式设经验
event.campfireCooking('minecraft:torch', 'minecraft:stick', 0.35, 600)       // 也可直接给经验+时长(tick)
```

- `.cookingTime(ticks)` 链式设烧制时长；燃料不可在配方事件改，要用标签改。
- 切石：`event.stonecutting('3x minecraft:stick', '#minecraft:planks')`（输入可用标签）。

### 模组配方直通 event.custom(json)

模组只要支持数据包配方，`event.custom()` 可直接写它的 JSON 结构（去模组 GitHub 的
`src/generated/resources/data/<modid>/recipes/` 找参考，或解包 jar）：

```js
event.custom({
  type: 'farmersdelight:cutting',
  ingredients: [{ item: 'minecraft:cake' }],
  tool: { tag: 'forge:tools/knives' },
  result: [{ item: 'farmersdelight:cake_slice', count: 7 }]
})
```

## 移除配方 event.remove(filter)

过滤器字段可组合：`output`（产物）、`input`（输入）、`mod`（模组 id）、`id`（配方唯一 id）、
`type`（配方类型）；对象内多字段 = 全部满足（AND），数组 = 任一满足（OR），`not` = 取反：

```js
event.remove({ output: 'minecraft:stone_pickaxe' })                 // 按产物
event.remove({ output: '#minecraft:wool' })                          // 产物在标签内
event.remove({ mod: 'farmersdelight' })                              // 整个模组
event.remove({ type: 'minecraft:campfire_cooking' })                 // 某类型全部
event.remove({ not: { type: 'minecraft:smelting' }, output: 'minecraft:stone' })  // 非熔炼的石头配方
event.remove([{ type: 'minecraft:smelting', output: 'minecraft:iron_ingot' },
              { type: 'minecraft:blasting', output: 'minecraft:iron_ingot' }])     // OR
event.remove({ id: 'minecraft:glowstone' })                          // 按配方 id
// event.remove({})  // 空过滤器 = 删全部，危险，勿用
```

查配方唯一 id：游戏内 `F3 + H` 开高级提示，REI 悬停 `[+]` 按钮、EMI/JEI 悬停产物图标可见。
注意：配方 id 常与产物 id 不同；JEI 与 EMI 同装时显示 `jei:/modid/path` 形式，实际 id 是 `modid:path`。

## 批量替换 event.replaceInput / replaceOutput(filter, from, to)

三参：过滤器 → 被替换的配料 → 换成什么（可为标签）：

```js
// 把所有用到木棍的配方里的木棍换成任意树苗
event.replaceInput(
  { input: 'minecraft:stick' },
  'minecraft:stick',
  Ingredient.of('#minecraft:saplings')   // 1.20 及以下可直接写 '#minecraft:saplings' 字符串
)
```

## 批量生成技巧

```js
ServerEvents.recipes(event => {
  // 助手函数：重复结构只写一次
  const potting = (output, input) => {
    event.shaped(output, ['BIB', ' B '], { B: 'minecraft:brick', I: input })
  }
  potting('kubejs:potted_snowball', 'minecraft:snowball')
  potting('kubejs:potted_lava', 'minecraft:lava_bucket')

  // 循环：内置 Color.DYE 数组含全部 16 色
  Color.DYE.forEach(color => {
    event.shapeless(`kubejs:${color}_clay`, ['minecraft:clay', `minecraft:${color}_dye`])
  })

  // 循环 + 工具损耗：damageIngredient 让工具扣耐久而非消耗
  const metals = ['iron', 'copper', 'gold']
  metals.forEach(metal => {
    event.shapeless(`kubejs:${metal}_plate`, [`minecraft:${metal}_ingot`, 'kubejs:hammer'])
      .damageIngredient('kubejs:hammer')
  })
})
```

## 调试

- 改完 `/reload`；配方不出现时先看服务端日志的脚本报错（语法错误整个文件不加载）。
- 物品 id/标签不确定：手持物品执行 `/kjs hand` 查看其 id 与全部标签。
- 产物 id 拼错不会报错，但合成无产物——先 `/give` 验证物品存在。
