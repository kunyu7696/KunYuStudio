# KunYu Studio

> 原 KunYuEcosystem（坤舆生态）。

Minecraft 模组与整合包的可视化开发工作台：把「写模组」从手写 Java/JSON 变成
「AI 生成 → 沙盒验证 → 一键导出」的闭环。桌面应用（Electron），Windows 优先。

## 功能一览

- **统一可视化编辑器**：物品 / 方块 / 实体 / 食物 / 工具 / 护甲 / 附魔 / 药水 /
  生物群系 / 进度，同一份语义模型驱动，实时预览。
- **代码手工编写**：可视化不是唯一路径——打开项目即是完整代码工作区（侧边栏文件树
  + Monaco 编辑器），可直接手写 / 修改 Java、JSON、Gradle 等产物，多标签页、
  自动保存、错误行跳转、运行前后 diff；生成器会保留你在表单里填的「自定义代码片段」。
- **AI 流水线**：五档 Agent（迅工 / 匠造 / 大师 / 桥接 / 织星），
  理解 → 生成 → 构建 → 测试 → 导出全链路；构建失败自动读日志修复
  （按档位 0/1/3/4/5 轮），真机测试自愈至多 10 轮。单次运行有资源熔断：
  模型调用上限 24/48/72/96/144 次、Gradle 构建 3/6/10/12/14 次、
  墙钟 30/60/90/120/150 分钟，任一超限即熔断停止并如实回报。
- **贴图 / 模型**：像素画生成（512px 大图 → 量化降采样）、自研建模器支持
  立方体 / 骨骼 / 网格 / UV / 权重 / 动画，`.bbmodel` 互导；离线时程序化保底。
- **整合包组装**：Modrinth / CurseForge 搜索入库，拖拽组装，一键导出，
  可直发双平台。
- **零配置运行环境**：应用不内置 JDK 与游戏本体——首次使用在「设置 → 运行环境」
  一键准备，按版本矩阵自动检测/下载所需 JDK（17/21/25）与 Minecraft 客户端、
  依赖库、资产，生成可直接启动的托管实例；国内可配置镜像（BMCLAPI 失败自动回退
  官方源），已下载文件校验跳过、支持断点续传。
- **真机沙盒**：observer mod 随包分发，游戏内截图 / 世界探测 / 输入注入，
  全自动 GameTest 闭环验证。
- **MCP 生态**：内置 mcdev-mcp 静态检索；自定义 MCP server 接入（stdio），
  市场预置一键导入，工具级权限过滤（市场新装插件默认不暴露任何工具，需在
  插件页「工具权限」逐项勾选放行）。
- **性能画像**：spark / JFR 报告解析，mod 性能榜单与优化建议。

## 快速开始

前置：Node.js ≥ 22（开发本应用用）。模组项目所需的 JDK 与 Minecraft 运行时
**无需预装**——首次使用时在「设置 → 运行环境」一键准备，应用按版本矩阵自动
检测/下载。

```powershell
npm ci
npm run dev
```

即可启动开发模式（界面语言：中文）。创建第一个项目后，试试顶栏「⚡ 快速创建」。

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式（含本机 EDR 规避 shim，详见下方「已知环境问题」） |
| `npm run typecheck` | 双端类型检查（node + web） |
| `npm run test` | 全量单测（vitest） |
| `npm run lint` | ESLint（`--max-warnings 0`） |
| `npm run build` | 编译 out/ 产物 |
| `npm run build:win` | 打 Windows NSIS 安装包（前置见下） |
| `npm run fetch-models` | 预拉 bge-small-zh 离线嵌入模型（打包用） |
| `npm run kb:manifest` | 刷新知识库语料版本指纹（改动 `resources/knowledge` 后执行） |

### 打包前置（`build:win` 之前）

1. `resources/observer-mod` 下执行一次 `gradlew build`（JDK 17）——产出游戏内
   观察 mod jar；
2. `npm run fetch-models`——把离线嵌入模型拉进 `resources/models`
   （可选，缺失时运行时回退在线下载）。

## 仓库结构

```
src/
  main/       Electron 主进程：IPC、构建流水线、市场、MCP、AI 服务
  preload/    contextBridge 白名单
  renderer/   Vue 3 + Pinia + Element Plus 界面
  shared/     双端共享：类型 / schema / 建模器核心（单一事实源）
resources/    AI 参考包（1562 个活跃模板）、知识库、observer mod、离线嵌入模型
scripts/      启动包装器、构建与验证脚本
docs/         设计文档（见下）
```

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 进程模型、目录结构、IPC、数据流、安全模型 |
| [docs/FEATURES.md](docs/FEATURES.md) | 19 个功能模块与工程链路能力清单 |
| [docs/AI-PIPELINE.md](docs/AI-PIPELINE.md) | AI 子系统：五档编排、66 个内置工具、上下文管理、RAG、三态验收 |
| [docs/MODELER.md](docs/MODELER.md) | 建模器：架构、文档模型、格式矩阵、操作说明 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发环境、脚本、测试策略、代码约定 |

## 版本矩阵覆盖

| 加载器 | MC 版本 |
| --- | --- |
| Fabric | 1.16.5 · 1.18.2 · 1.19.2 · 1.20.1 · 1.20.4 · 1.20.6 · 1.21.1 · 1.21.4~1.21.11 · 26.3 |
| Forge | 1.18.2 · 1.19.2 · 1.20.1 · 1.20.4 · 1.21.1 · 26.3（1.16.5 因 FG4 + official mappings 框架级不兼容已冻结） |
| NeoForge | 1.20.4 · 1.20.6 · 1.21.1 · 1.21.3~1.21.11 · 26.3（官方仍 Beta，暂禁用，待 GA 解除） |

共 34 个可生成组合，分层验证：**core**（1.20.1 / 1.21.1，PR 与 push 均强制编译
验证）→ **extended**（1.20.4 / 1.20.6 / 1.21.3+ / 26.x，PR 档全量）→
**legacy**（1.16.5 / 1.18.2 / 1.19.2，新建向导默认隐藏，仅定时真机构建覆盖）。
JDK 17 / 21 / 25 按矩阵自动匹配（1.21.6+ 宿主需 25，26.x 起编译目标即 Java 25）；
Fabric 26.x 起无 Yarn 构建，自动切换 Mojang 官方映射。工具链坐标
（loader / yarn / loom / ForgeGradle / ModDevGradle 版本）唯一数据源：
`src/main/templates/loaderVersionMatrix.ts`。

## 测试与质量

- PR 门禁：双端 typecheck + ESLint 零告警 + 全量单测（276 个测试文件）。
- 矩阵门禁：`test:matrix` / `test:matrix-pr` 按上表加载器 × MC 版本组合验证模板。
- 测试环境分层：`src/main` / `src/shared` 跑 node，`src/renderer` 跑 jsdom。
- 构建后断言产物为本次生成（新鲜度断言），杜绝陈旧包。

## 隐私与合规

- **单机 local-first**：项目、设置、AI 密钥全部保存在本机 userData；
  密钥经系统钥匙串加密（Windows DPAPI / macOS Keychain）。
  **明文回退说明**：`safeStorage` 不可用（如部分 Linux 发行版无钥匙串）时，
  密钥退回明文保存并在启动日志显式告警；此类环境下请勿把 userData 目录
  同步到公共网盘。
- **不含游戏本体**：导出的整合包只有清单与配置，Minecraft jar 由启动器
  按清单下载（EULA 合规）。
- AI 调用只发生在你显式配置供应商并发起请求时；离线保底工具不联网。

## 已知环境问题

部分企业 EDR / 安全软件会拦截 `node_modules` 内进程的目录枚举与内存映射，
导致 esbuild / Electron 无法启动。`npm run dev` 已内置规避（把二进制复制到
TEMP 并重定向），无需手动处理；如仍失败请查看 `scripts/run-electron-vite.cjs`
头部注释。

### 开发模式安全削弱说明（仅 dev，生产构建不受影响）

`npm run dev` 为兼容上述 EDR 环境与 Vite 开发服务器，会在启动时叠加两层削弱：

1. **`--no-sandbox` + 禁用 GPU 子进程**：受限会话中 Chromium sandbox 无法初始化，
   仅本机驱动探针等自动化场景使用；生产构建保持 sandbox 开启。
2. **`webSecurity` 放宽**：仅当存在 `ELECTRON_RENDERER_URL`（Vite dev server）时
   放宽跨域限制；生产构建强制启用 webSecurity 与同源策略。

以上削弱均通过环境变量检测自动切换，不会带入 `npm run build:win` 产物。

另：**CSP 不随 dev/prod 变化**——`index.html` meta 静态声明
`default-src 'self'; script-src 'self'`（无 `unsafe-eval`），`style-src` 放行
`'unsafe-inline'` 供 Element Plus 内联样式，`connect-src` 放行 `ws:` 与
`127.0.0.1/localhost` 供 Vite HMR、observer 探针与本机 MCP 桥接。

## 许可

本项目自 2026-10-21 起以 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0-only）授权。
此前发布的版本仍为 MIT，已经取得的权利不受影响。

改协议的想法很简单：坤舆大量受益于 Minecraft 模组社区与开源生态的开放成果，
我们也希望自己的改进能同样留在开放的地方。AGPLv3 不限制商业使用、修改与分发，
只要求在分发或对外提供网络服务时一并开放改过的源码。

这不是针对任何个人或团队。如果这项变更给你的使用场景带来不便，欢迎联系作者，
我们愿意在合理范围内一起商量别的授权方式。也谢谢一路提交 issue、反馈问题、
分享经验的社区朋友。

**边界说明：AGPLv3 保护的是坤舆本身，不涉及你的开发产物。**
你用坤舆写出来的模组、整合包、资源包、数据包、模型、贴图、脚本、生成的工程模板
以及 `.kyshare` 分享包，版权归你，许可证由你自己决定；这些产物不因使用了坤舆而
被要求开源。随工具生成的项目模板自带 MIT `LICENSE`，可自由改写为你需要的任何协议。
（该例外以 AGPLv3 第 7 条附加许可的形式写在 [LICENSE](LICENSE) 中。）

第三方组件仍遵循各自的许可证（见 [resources/THIRD-PARTY-NOTICES.md](resources/THIRD-PARTY-NOTICES.md)），与本项目的
AGPLv3 无关。

---

*—— kunyu (睏欤)*
