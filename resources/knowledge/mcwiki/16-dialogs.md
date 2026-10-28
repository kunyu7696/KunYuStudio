# 对话框（Dialog，1.21.6+）

数据包驱动的原生 GUI 对话框：`data/<ns>/dialog/<id>.json`，用 `/dialog show @s <ns>:<id>` 打开，`/dialog clear` 关闭。不用模组就能做菜单/表单/确认框。

## 类型（type）

| type | 用途 |
|---|---|
| `minecraft:notice` | 单「返回」按钮的提示框 |
| `minecraft:confirmation` | 是/否 两个按钮 |
| `minecraft:multi_action` | 自定义多按钮，`columns` 控制列数排布 |
| `minecraft:dialog_list` | 列出打开其他对话框的入口（做目录/嵌套） |
| `minecraft:server_links` | 服务器链接页 |

公共字段：`title`、`body`、`inputs`、`pause`（单人模式是否暂停游戏）、`after_action`（动作后 `close`/`none`/`wait_for_response`）。

## body：内容区

```json
"body": [
  { "type": "minecraft:plain_message", "contents": {"text":"请选择奖励"}, "width": 200 },
  { "type": "minecraft:item", "item": {"id":"minecraft:diamond","count":1}, "description": {"text":"钻石"} }
]
```

- plain_message 支持文本组件；item 类型把物品图标+说明放进对话框

## 按钮与动作（action）

每个按钮是一个 `action` 对象：`label` + `on_click`。on_click 的 action 类型：

| action | 效果 |
|---|---|
| `open_url` | 打开网址 |
| `run_command` | 以玩家身份执行命令（权限按玩家自身） |
| `suggest_command` | 把命令填进聊天框待发送 |
| `change_page` | 切到书的某页（成书界面） |
| `dynamic/run_command` | 宏命令，命令里可用 `$(key)` 引用 inputs 的值 |
| `dynamic/custom` | 携带 inputs 数据发给服务端（模组用） |
| `show_dialog` | 打开另一个对话框——**对话框嵌套**就靠它 |

```json
{
  "label": "去商店",
  "on_click": { "action": "show_dialog", "dialog": "mypack:shop_main" }
}
```

## inputs：输入项

- `text`（文本框，输出字符串）、`boolean`（勾选，输出 true/false）、`number_range`（滑条，输出数值）、`single_option`（单选列表）
- 每个 input 有 `key`；配合按钮的 `dynamic/run_command` 把输入代进命令：

```json
{
  "label": "改名",
  "on_click": {
    "action": "dynamic/run_command",
    "template": "data modify storage mypack:tmp name set value \"$(new_name)\""
  }
}
```

- 宏替换规则与函数宏一致：`$(key)` 在提交时展开；注意字符串值的引号转义

## 实战要点

- 多按钮布局用 multi_action 的 `columns`；按钮过多自动分页/滚动
- 嵌套菜单 = 按钮 `show_dialog` 指到另一个 dialog id；notice 的返回按钮回到上一层不是自动的，要显式配
- 对话框在客户端渲染，mod 环境（Fabric/Forge）同样可用；旧版本（<1.21.6）没有该注册表，兜底方案是成书 UI 或 tellraw 点击事件

> 本条目知识点结构参考了 B 站/抖音 UP 主「筱燚」的《数据包 / 资源包 / 实例》系列教程（第 20~25、45 期），正文按 Minecraft 官方 wiki 与公开文档重写。感谢社区创作者的整理与分享。
