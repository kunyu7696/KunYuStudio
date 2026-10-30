# KunYu 插件开发指南

本文以官方示例插件 **SNBT 语法着色**（`resources/plugins/snbt-colors`）为例，
讲解如何为 KunYu Studio 开发插件。

## 一、KunYu 的两种插件形态

| 形态 | 能力 | 运行位置 | 适合场景 |
| --- | --- | --- | --- |
| **MCP 工具插件** | 向 AI 助手注册工具（读写文件、调用外部服务等） | 独立进程（npx / uvx） | 给 AI 增加能力，如查 wiki、操作构建 |
| **渲染层声明式插件**（本文） | 为代码编辑器贡献**语法着色**（Monarch 语言） | 纯 JSON，不执行任何代码 | 让某类文件「代码信息有不同颜色」 |

渲染层插件是**纯 JSON、零代码执行**的形态：插件只声明语法规则，
主进程负责扫描和校验，编辑器（Monaco）负责着色。因为不可执行，
它不需要权限模型，安装即安全。

> 本文聚焦渲染层声明式插件。MCP 工具插件的开发见「插件库与商城」模块
> 与 `src/shared/types/plugin.ts` 的市场模型。

## 二、10 分钟做一个着色插件

### 1. 插件就是一个文件夹

```
my-lang-colors/
├── plugin.json      # 清单：是谁、贡献什么
└── language.json    # Monarch 语法规则（可选，也能内联进 plugin.json）
```

### 2. 写清单 plugin.json

```json
{
  "id": "myname.my-lang-colors",
  "name": "My Lang 语法着色",
  "version": "1.0.0",
  "description": "为 .mylang 文件提供语法着色",
  "author": "Your Name",
  "contributes": {
    "languages": [
      {
        "id": "mylang",
        "aliases": ["MyLang"],
        "extensions": [".mylang"],
        "configuration": {
          "comments": { "lineComment": "#" },
          "brackets": [["{", "}"], ["[", "]"]],
          "autoClosingPairs": [
            { "open": "{", "close": "}" },
            { "open": "\"", "close": "\"" }
          ]
        },
        "monarch": "language.json"
      }
    ]
  }
}
```

### 3. 写语法规则 language.json

Monarch 是 Monaco 内置的声明式高亮引擎：一组「正则 → token 类型」规则，
按顺序匹配，先中先生效。**JSON 里正则一律写成字符串**（Monaco 加载时再编译）：

```json
{
  "defaultToken": "",
  "tokenizer": {
    "root": [
      ["#.*$", "comment"],
      ["\"([^\"\\\\]|\\\\.)*\"", "string"],
      ["-?\\d+", "number"],
      ["\\b(true|false)\\b", "keyword"],
      ["[{}\\[\\]]", "@brackets"]
    ]
  }
}
```

> 注意 JSON 转义：正则里的 `\d` 要写成 `\\d`，`\"` 要写成 `\\\"`。

### 4. 安装

把整个文件夹放进用户插件目录：

| 环境 | 插件目录 |
| --- | --- |
| 打包版 | `%APPDATA%\KunYu Studio\plugins\`（macOS / Linux 为对应 userData 下的 `plugins/`） |
| 开发版 | 仓库根目录 `.dev-userdata\plugins\` |

即最终路径形如 `…\plugins\my-lang-colors\plugin.json`。

### 5. 生效

**重启应用**（插件在编辑器首次打开时扫描注册一次）。之后打开任何
`.mylang` 文件，即可看到着色效果。

## 三、plugin.json 字段参考

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `id` | ✓ | 字母/数字开头，可含 `.` `-`，≤64 字符；建议反向域名风格防冲突 |
| `name` | ✓ | 1-60 字符 |
| `version` | ✓ | 语义化版本号，如 `1.0.0` |
| `description` | | ≤200 字符 |
| `author` | | ≤60 字符 |
| `contributes.languages` | ✓ | 1-10 门语言 |

每个语言条目：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✓ | 小写字母开头的字母/数字/中划线，≤32 字符；**与内置语言冲突会被跳过** |
| `aliases` | | 显示名，≤8 项 |
| `extensions` | | 关联扩展名（含点），≤8 项；打开对应文件时编辑器自动选用本语言 |
| `monarch` | ✓ | 内联对象，或插件目录内的 JSON 文件名（如 `"language.json"`；**不允许路径**，杜绝目录逃逸） |
| `configuration` | | 注释符号 / 括号 / 自动闭合对 |

结构非法的插件不会拖垮其他插件：加载结果里逐个附带错误信息
（开发版可在 DevTools 控制台查看 `plugin:list-renderer` 的返回）。

## 四、token 类型 → 颜色对照

插件不直接指定颜色，而是给文本片段标注 **token 类型**，颜色由应用主题决定。
这样插件在深色/浅色主题下都协调。常用 token 与 KunYu 主题的对应色：

| token 类型 | 深色主题 | 浅色主题 | 建议用于 |
| --- | --- | --- | --- |
| `comment` | 灰绿斜体 | 灰色斜体 | 注释 |
| `keyword` | 紫 | 紫 | 关键字、布尔、常量 |
| `string` | 绿 | 绿 | 字符串 |
| `number` / `number.float` | 橙 | 橙 | 数字 |
| `type` | 蓝 | 蓝 | 类型、键名、命名空间 ID |
| `identifier` | 前景色 | 前景色 | 普通标识符（默认） |
| `operator` / `delimiter` | 前景色 | 前景色 | 运算符、分隔符 |

完整规则见 `src/renderer/src/monaco/setup.ts` 的 `kunyu-dark` / `kunyu-light`。

## 五、官方示例逐行讲解：snbt-colors

`resources/plugins/snbt-colors/language.json` 为 FTB 任务书的 SNBT 格式着色：

```json
["#.*$", "comment"]                          → # 开头的行注释 → 灰绿斜体
["\"([^\"\\\\]|\\\\.)*\"", "string"]          → 双引号字符串（含转义）→ 绿
["'([^'\\\\]|\\\\.)*'", "string"]             → 单引号字符串 → 绿
["-?\\d+\\.\\d+([eE][-+]?\\d+)?[fd]?", "number.float"] → 1.5、2.0f、1e3d → 橙
["-?\\d+[bsl]?", "number"]                    → 整数及 SNBT 后缀 1b/7s/9l → 橙
["\\b(true|false)\\b", "keyword"]             → 布尔字面量 → 紫
["[a-zA-Z_][\\w-]*(?=\\s*:)", "type"]         → 冒号前的键名 → 蓝
["[{}\\[\\]]", "@brackets"]                   → 花/方括号（配对着色）
["[:,;]", "delimiter"]                        → 冒号、逗号、分号
```

要点：

- **规则按顺序匹配**，所以 `number.float` 写在 `number` 前面（否则 `1.5`
  会先命中整数规则）；
- 键名规则用了正则前瞻 `(?=\s*:)`——只有「后面跟着冒号」的标识符才算键名；
- `@brackets` 是 Monarch 内置 token，启用括号配对高亮。

## 六、调试技巧

1. **改了插件要重启应用**：插件在编辑器首次打开时注册一次（幂等），
   热改不会生效。
2. **着色没出现**按顺序排查：
   - 目录层级是否对（`plugins\<文件夹>\plugin.json`，不能再套一层）；
   - `plugin.json` 是否通过校验（字段拼写、版本号格式）；
   - `extensions` 是否含前导点（`".snbt"` 不是 `"snbt"`）；
   - Monarch 正则是否写成了 JSON 合法字符串（反斜杠要双写）。
3. **语言 id 冲突**：如果 `id` 与内置语言（如 `json`、`snbt`）重复，
   该语言会被跳过——换个独有序列号。

## 七、当前限制与路线图

v0 只开放 **languages 贡献点**（语法着色）。规划中的贡献点：

- `themes`：整套编辑器配色；
- `snippets`：代码片段补全；
- `commands`：只读命令（状态栏展示等）。

设计约束不变：**渲染层插件永远声明式、零代码执行**；需要可执行能力时
请走 MCP 工具插件通道（有独立的信任门与权限模型）。

## 八、相关源码索引

| 位置 | 作用 |
| --- | --- |
| `src/shared/types/rendererPlugin.ts` | 清单类型 + 校验器（主进程/渲染层共用） |
| `src/main/services/plugins/rendererPluginService.ts` | 插件目录扫描、monarch 引用解析（防目录逃逸） |
| `src/renderer/src/monaco/pluginLanguages.ts` | 注册进 Monaco（幂等、冲突跳过） |
| `src/renderer/src/monaco/languageExtensionRegistry.ts` | 扩展名 → 语言 id 映射 |
| `resources/plugins/snbt-colors/` | 官方示例插件（本指南的讲解对象） |
