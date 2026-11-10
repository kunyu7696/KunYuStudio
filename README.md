<div align="center">
  <img src="resources/build/icon.png" width="128" alt="KunYu Studio" />

  <h1>KunYu Studio</h1>

  <p><strong>从一个想法，到可以进游戏的 Minecraft 模组与整合包</strong></p>

  <p>AI 辅助开发 · 可视化编辑 · 真机沙盒验证 · 一键导出发布</p>

  <p><sub>An AI-assisted desktop toolkit for Minecraft mod &amp; modpack development — visual editors, sandbox testing, one-click export.</sub></p>

  <p>
    <a href="https://github.com/kunyu7696/KunYuStudio/releases/latest"><img src="https://img.shields.io/github/v/release/kunyu7696/KunYuStudio?display_name=tag&label=release&color=e7653f" alt="release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-e7653f" alt="license" /></a>
    <a href="https://github.com/kunyu7696/KunYuStudio/actions/workflows/ci.yml"><img src="https://github.com/kunyu7696/KunYuStudio/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <img src="https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-2d8a56" alt="platform" />
    <a href="https://qm.qq.com/q/fTdLJLLgVU"><img src="https://img.shields.io/badge/QQ%20%E7%BE%A4-963335581-12b7f5" alt="QQ 群" /></a>
    <a href="https://afdian.com/a/KunYuStudio"><img src="https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-%E8%B5%9E%E5%8A%A9%E6%94%AF%E6%8C%81-946ce6" alt="爱发电" /></a>
  </p>

  <p>
    <a href="https://github.com/kunyu7696/KunYuStudio/releases/latest"><strong>下载最新版</strong></a> ·
    <a href="#功能一览">功能一览</a> ·
    <a href="#快速开始">快速开始</a> ·
    <a href="#文档导航">文档</a> ·
    <a href="#交流与反馈">交流群</a> ·
    <a href="#支持开发">爱发电</a>
  </p>
</div>

---

**KunYu Studio**（原 KunYuEcosystem）是 Minecraft 模组与整合包的可视化开发工作台：
把「写模组」从手写 Java/JSON 变成「AI 生成 → 沙盒验证 → 一键导出」的闭环。
桌面应用（Electron），Windows 优先，macOS / Linux 同步发行。

## 下载与安装

到 [Releases](https://github.com/kunyu7696/KunYuStudio/releases) 页下载对应平台的安装包：

| 平台 | 文件 |
| --- | --- |
| Windows | `KunYu-Studio-<版本>-setup.exe`（NSIS 安装包） |
| macOS | `KunYu-Studio-<版本>-mac-x64.dmg` / `-mac-arm64.dmg` |
| Linux | `KunYu-Studio-<版本>-linux-x86_64.AppImage` |

安装后无需配置 JDK 或游戏本体——首次使用在「设置 → 运行环境」一键准备，
应用按版本矩阵自动检测/下载所需运行时。

## 功能一览

- **两种应用模式**：工作台（IDE 式布局）与灵感台（全屏创意空间），顶栏一键切换。
- **启动体验**：两幕启动动画（品牌亮相 → 方块世界），期间真实执行初始化并逐行显示
  6 个步骤的耗时与成败（设置 / 主题语言 / 模块装载 / 环境自检 / 项目恢复 / 运行环境）；
  进度条只认完成度，点击任意处可跳过，跳过不打断初始化。
- **工坊（统一可视化编辑器）**：物品 / 方块 / 实体 / 食物 / 工具 / 护甲 / 附魔 / 药水 /
  生物群系 / 进度，同一份语义模型驱动 Java、资源包、数据包三端，实时预览。
- **代码手工编写**：可视化不是唯一路径——打开项目即是完整代码工作区（侧边栏文件树
  + Monaco 编辑器），可直接手写 / 修改 Java、JSON、Gradle 等产物，多标签页、
  自动保存、错误行跳转、运行前后 diff；生成器会保留你在表单里填的「自定义代码片段」。
- **数据包 / 资源包 / 光影包编辑器**：三种独立项目类型各有一套专用编辑器——
  配方、战利品表、进度、函数与标签；贴图模型、音效、语言、字体；Iris / OptiFine
  的 GLSL 着色器与选项配置。
- **模型工坊与资产库**：自研建模器支持立方体 / 骨骼 / 网格 / UV / 权重 / 动画，
  `.bbmodel` 互导；AI 产出的贴图候选全部存档到资产库，跨项目汇总、零额度复用，
  支持 `.kyshare.json` 分享包导入导出。
- **音效工坊**：参数合成 / MIDI 渲染 / 本地音频统一转 OGG 44.1kHz，
  自动注册 `sounds.json` 音效事件。
- **整合包与社区内容**：Modrinth / CurseForge 搜索入库、拖拽组装、一键导出双清单；
  FTB 任务书、Patchouli 指南书、KubeJS 脚本、FancyMenu 开始菜单、TaCZ 死亡消息
  均为可视化编辑，保存即落盘。
- **AI 流水线**：五档 Agent（迅工 / 匠造 / 大师 / 桥接 / 织星），
  理解 → 生成 → 构建 → 测试 → 导出全链路；构建失败自动读日志修复
  （按档位 0/1/3/4/5 轮），真机测试自愈至多 10 轮。单次运行有资源熔断：
  模型调用上限 24/48/72/96/144 次、Gradle 构建 3/6/10/12/14 次、
  墙钟 30/60/90/120/150 分钟，任一超限即熔断停止并如实回报。
- **零配置运行环境**：应用不内置 JDK 与游戏本体——首次使用在「设置 → 运行环境」
  一键准备，按版本矩阵自动检测/下载所需 JDK（17/21/25）与 Minecraft 客户端、
  依赖库、资产，生成可直接启动的托管实例；国内可配置镜像（BMCLAPI 失败自动回退
  官方源），已下载文件校验跳过、支持断点续传。
- **真机沙盒**：observer javaagent 随包分发，游戏内截图 / 世界探测 / 输入注入，
  全自动 GameTest 闭环验证。
- **MCP 生态**：内置 mcdev-mcp 静态检索；自定义 MCP server 接入（stdio），
  市场预置一键导入，工具级权限过滤（市场新装插件默认不暴露任何工具，需在
  插件页「工具权限」逐项勾选放行）。
- **工程周边**：反编译工作区（Vineflower 按需下载）、版本与产物管理（Git + 构建产物）、
  CI/CD 工作流生成（build / release / gametest）、性能画像（spark / JFR 解析、
  五维评分与冲突建议）、插件库与 DSH 社区插件宿主。

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
| `npm run test:matrix` | 加载器 × MC 版本模板矩阵门禁（全量） |
| `npm run test:matrix-pr` | 矩阵门禁（PR 档，core + extended） |
| `npm run test:coverage` | 全量单测并输出覆盖率 |
| `npm run lint` | ESLint（`--max-warnings 0`） |
| `npm run build` | 编译 out/ 产物 |
| `npm run build:win` / `build:mac` / `build:linux` | 打对应平台安装包（只出产物，不上传） |
| `npm run fetch-models` | 预拉 bge-small-zh 离线嵌入模型（打包用） |
| `npm run kb:manifest` | 刷新知识库语料版本指纹（改动 `resources/knowledge` 后执行） |

### 打包前置

`build:*` 会自动串好整条链路（`fix-dist-acl` → `build-observer-agent` →
electron-vite build → 产物新鲜度断言 → electron-builder → 打包后校验），
只需保证本机装了 **JDK 21**（用于构建随包分发的 observer javaagent）。
离线嵌入模型可选：`npm run fetch-models` 拉进 `resources/models`，
缺失时运行时回退在线下载。

> 产物新鲜度断言会比对 `out/`、`app.asar`、observer jar 与工作区是否一致，
> 陈旧包会直接失败——这能挡住「源码改了但安装包还是旧的」。

## 仓库结构

```
src/
  main/       Electron 主进程：IPC、构建流水线、市场、MCP、AI 服务
  preload/    contextBridge 白名单
  renderer/   Vue 3 + Pinia + Element Plus 界面（23 个活动栏模块 + 灵感台）
  shared/     双端共享：类型 / schema / 建模器核心（单一事实源）
resources/    AI 参考包（1576 个活跃模板）、知识库、observer javaagent、
              mcdata 版本数据、插件与 DSH 插件包、离线嵌入模型
scripts/      启动包装器、构建与验证脚本
docs/         设计文档（见下）
```

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 进程模型、目录结构、IPC、数据流、安全模型 |
| [docs/FEATURES.md](docs/FEATURES.md) | 23 个活动栏模块与工程链路能力清单 |
| [docs/AI-PIPELINE.md](docs/AI-PIPELINE.md) | AI 子系统：五档编排、内置工具（数量见 [TOOLS-INVENTORY.json](docs/TOOLS-INVENTORY.json)）、上下文管理、RAG、三态验收 |
| [docs/MODELER.md](docs/MODELER.md) | 建模器：架构、文档模型、格式矩阵、操作说明 |
| [docs/PLUGINS.md](docs/PLUGINS.md) | 插件体系：清单格式、权限模型、语言插件与 DSH 兼容宿主 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发环境、脚本、测试策略、代码约定 |

## 版本矩阵覆盖

| 加载器 | MC 版本 |
| --- | --- |
| Fabric | 1.16.5 · 1.18.2 · 1.19.2 · 1.20.1 · 1.20.4 · 1.20.6 · 1.21.1 · 1.21.4~1.21.11 · 26.3 |
| Forge | 1.18.2 · 1.19.2 · 1.20.1 · 1.20.4 · 1.21.1 · 26.3（1.16.5 因 FG4 + official mappings 框架级不兼容已冻结） |
| NeoForge | 1.20.4 · 1.20.6 · 1.21.1 · 1.21.3~1.21.11 · 26.3（官方仍 Beta，暂禁用，待 GA 解除） |

共 35 个可生成组合（Fabric 16 · Forge 6 · NeoForge 13），分层验证：**core**（1.20.1 / 1.21.1，PR 与 push 均强制编译
验证）→ **extended**（1.20.4 / 1.20.6 / 1.21.3+ / 26.x，PR 档全量）→
**legacy**（1.16.5 / 1.18.2 / 1.19.2，新建向导默认隐藏，仅定时真机构建覆盖）。
JDK 17 / 21 / 25 按矩阵自动匹配（1.21.6+ 宿主需 25，26.x 起编译目标即 Java 25）；
Fabric 26.x 起无 Yarn 构建，自动切换 Mojang 官方映射。工具链坐标
（loader / yarn / loom / ForgeGradle / ModDevGradle 版本）唯一数据源：
`src/main/templates/loaderVersionMatrix.ts`。

## 测试与质量

- PR 门禁：双端 typecheck + ESLint 零告警 + 全量单测（310 个测试文件）。
- 矩阵门禁：`test:matrix` / `test:matrix-pr` 按上表加载器 × MC 版本组合验证模板。
- **三态门禁（advisory，不阻塞合并/发布）**：编译通过 ≠ 能加载 ≠ 能玩。
  `npm run test:runtime` 在 11 个版本族代表组合上起专用服务器，日志出现 `Done (…)` 才算「能加载」；
  `npm run test:client` 在 6 组上走虚拟显示（Xvfb + Mesa 软件渲染）进世界并抓屏，
  截图非全黑、无新 crash-report、进程存活三者同时满足才算「能玩」（仅 Linux 可跑）。
  结论写入参考包 `matrixHealth.stages.{load,runtime}`，设置页「版本矩阵健康度」以三态点展示；
  两套门禁分别每日/每周定时执行，结果由 CI 提交回 `manifest`。
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

## 交流与反馈

- **QQ 群（推荐）**：[KunYuStudio 交流群](https://qm.qq.com/q/fTdLJLLgVU)，群号 **963335581**。点链接或手机 QQ 扫码直接入群；使用问题、功能建议、版本兼容反馈都可以在这里先问一句。
- **Issue**：[GitHub Issues](https://github.com/kunyu7696/KunYuStudio/issues)。功能缺陷请附版本号（设置页或安装包名）、平台与复现步骤，带日志最快定位。
- **安全漏洞**：不要开公开 issue，按 [SECURITY.md](.github/SECURITY.md) 私密报告。

## 支持开发

KunYu Studio 是独立开发的开源项目。如果它对你有帮助，欢迎来爱发电请作者喝杯咖啡：

<div align="center">

**[⚡ afdian.com/a/KunYuStudio](https://afdian.com/a/KunYuStudio)**

</div>

也可以点仓库页右上角的 **❤ Sponsor** 按钮直达。赞助全凭自愿，全部功能对所有人开放。

## 许可

本项目自 2026-10-21 起以 [GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0-only）授权。
此前发布的版本仍为 MIT，已经取得的权利不受影响。

改协议的想法很简单：KunYuStudio 大量受益于 Minecraft 模组社区与开源生态的开放成果，
我们也希望自己的改进能同样留在开放的地方。AGPLv3 不限制商业使用、修改与分发，
只要求在分发或对外提供网络服务时一并开放改过的源码。

这不是针对任何个人或团队。如果这项变更给你的使用场景带来不便，欢迎联系作者，
我们愿意在合理范围内一起商量别的授权方式。也谢谢一路提交 issue、反馈问题、
分享经验的社区朋友。

**边界说明：AGPLv3 保护的是 KunYuStudio 本身，不涉及你的开发产物。**
你用 KunYuStudio 写出来的模组、整合包、资源包、数据包、模型、贴图、脚本、生成的工程模板
以及 `.kyshare` 分享包，版权归你，许可证由你自己决定；这些产物不因使用了 KunYuStudio 而
被要求开源。随工具生成的项目模板自带 MIT `LICENSE`，可自由改写为你需要的任何协议。
（该例外以 AGPLv3 第 7 条附加许可的形式写在 [LICENSE](LICENSE) 中。）

第三方组件仍遵循各自的许可证（见 [resources/THIRD-PARTY-NOTICES.md](resources/THIRD-PARTY-NOTICES.md)），与本项目的
AGPLv3 无关。

---

*—— kunyu (睏欤)*
