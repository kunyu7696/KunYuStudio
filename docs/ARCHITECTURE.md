# KunYu Studio 架构设计

> 原 KunYuEcosystem
>
> 本文描述 KunYuStudio 的技术架构：进程模型、目录分层、IPC 约定、核心数据模型、
> 端到端数据流、版本矩阵与安全模型。功能清单见 [FEATURES.md](FEATURES.md)，
> AI 子系统详见 [AI-PIPELINE.md](AI-PIPELINE.md)。

---

## 一、系统定位

KunYu 是面向 Minecraft 模组与整合包开发者的桌面工作台，把代码编辑器与
对话式 AI 缝合为一体：AI 操作以工具卡片、diff、中间态呈现，可中断、可回滚；
内置环境引导器负责 JDK 与游戏运行时；内置 observer mod 做游戏内截图、
世界探测、输入注入与 GameTest 断言。

支持的项目类型：`mod`（模组）、`datapack`（数据包）、`resourcepack`（资源包）、
`shaderpack`（光影包）、`modpack`（整合包）。

---

## 二、技术栈

| 层 | 技术 | 版本 |
| --- | --- | --- |
| 桌面容器 | Electron | 44.x |
| 主进程运行时 | Node.js | ≥ 22 |
| 前端框架 | Vue | 3.5 |
| 状态管理 | Pinia | 4.x |
| UI 组件 | Element Plus | 2.14 |
| 代码编辑 | Monaco Editor | 0.56 |
| 3D 渲染 | Three.js | 0.186 |
| 构建 | electron-vite / Vite / TypeScript | 5.x / 7.x / 5.9 |
| 打包 | electron-builder | 26.x（Windows NSIS + 绿色包） |
| 网络 | undici | 8.x |
| 本地库 | better-sqlite3 | 13.x |
| AI / 嵌入 | MCP SDK 1.x、@xenova/transformers（bge-small-zh 离线嵌入） | — |
| 测试 | Vitest 3.x + fast-check + @vue/test-utils | — |

应用体积接受区间 300–400 MB，不做刻意瘦身。

---

## 三、进程模型与分层

```
┌─────────────────────────────────────────────┐
│ renderer（Vue 3 + Pinia + Element Plus）     │  UI、编辑器、状态
├─────────────────────────────────────────────┤
│ preload（白名单桥）                          │  唯一暴露 window.api
├─────────────────────────────────────────────┤
│ main（Electron + Node）                      │  IPC、服务、文件、构建、AI
├─────────────────────────────────────────────┤
│ shared（类型 + schema + 建模器核心）          │  三端共享的单一事实源
└─────────────────────────────────────────────┘
```

设计原则：

- **渲染层不直接触达网络、文件系统与子进程**，一律经主进程服务；
- **共享层只放纯数据与纯函数**（类型、schema、建模器数学与命令），避免三端漂移；
- 主进程服务按业务域分目录，IPC handler 只做装配与转发，业务逻辑落在可单测的
  纯函数/服务类中。

---

## 四、目录结构

```
src/
├─ main/                      # Electron 主进程
│  ├─ ipc/                    #   IPC handler 装配（依赖注入 IpcContext）
│  ├─ services/               #   业务服务域
│  │  ├─ ai/                  #     AI 子系统（编排器、工具注册表、RAG、提供商）
│  │  ├─ ci/                  #     CI/CD 工作流生成
│  │  ├─ contentGenerator/    #     内容对象代码生成
│  │  ├─ dsh/                 #     DSH 插件宿主 + 桌宠
│  │  ├─ migration/           #     设置/数据迁移
│  │  ├─ modeler/             #     建模器 IO 与备份
│  │  ├─ modpack/             #     整合包组装
│  │  ├─ observer/            #     observer mod 客户端与游戏控制
│  │  ├─ performance/         #     性能画像（JFR / Spark 解析）
│  │  └─ publish/             #     发布（Modrinth / CurseForge）
│  ├─ templates/              #   项目模板与加载器版本矩阵（唯一数据源）
│  └─ utils/                  #   主进程通用工具
├─ preload/                   # contextBridge 白名单（声明式 API + 推送通道）
├─ renderer/src/
│  ├─ modules/                #   19 个活动栏模块（视图 + 注册表）
│  ├─ components/             #   跨模块组件（AI 面板、设置面板等）
│  ├─ stores/                 #   Pinia 状态
│  ├─ monaco/                 #   Monaco 集成与 CUE 内联补全
│  └─ utils/                  #   渲染层工具
└─ shared/
   ├─ types/                  #   类型：ipc / ai / agent / tiers / project / build ...
   ├─ schemas/                #   内容对象 schema 与三端适配器（UnifiedContent）
   ├─ modeler/                #   建模器核心：文档模型 / 命令栈 / 数学 / 格式编解码
   ├─ services/               #   双端共享服务（agent 路由、档位模型解析等）
   └─ utils/                  #   共享纯函数

resources/
├─ ai-reference/              # AI 参考包：1562 活跃模板 / 39 错误模式 / 78 API 索引
│  ├─ templates/              #   按 fabric / forge / neoforge 分目录的模板工程
│  ├─ community/              #   社区参考片段
│  └─ manifest.json           #   清单（模板、指纹、来源统计）
├─ knowledge/                 # 离线知识库（30 篇 Markdown，RAG 语料）
├─ mcdata/                    # minecraft-data 静态数据
├─ observer-mod/              # 游戏内观察 mod（Gradle 工程，随包分发 jar）
├─ observer-agent/            # 观察者 agent 资源
└─ dsh-plugins/               # 预置 DSH 插件
```

---

## 五、IPC 通信层

- 全部通道集中定义在 `src/shared/types/ipc.ts` 的 `IpcChannels` 常量表，
  共 **252 个**，命名约定 `领域:动作`，按业务域前缀分组：

| 前缀 | 域 |
| --- | --- |
| `app:` `win:` `shell:` `dialog:` | 应用、窗口、系统壳、文件对话框 |
| `settings:` | 设置读写与迁移 |
| `project:` `fs:` | 项目生命周期、文件系统（含监听） |
| `content:` | 内容对象读写、生成、反向同步、贴图 |
| `modeler:` | 建模器文档、编译、写回 |
| `gradle:` `jdk:` `java:` `mc:` | 构建、环境、游戏版本与实例 |
| `ai:` `agent:` `mcp:` `ref:` | AI 对话、Agent 运行、MCP、参考包检索 |
| `market:` `modlib:` `modpack:` | 市场、模组库、整合包 |
| `datapack:` `shaderpack:` `resourcepack:` | 三类包编辑 |
| `ci:` `integration:` `vcs:` `plugin:` `dsh:` `observer:` | CI、启动器集成、版本控制、插件、DSH、观察者 |

- 约定：
  - 请求/响应走 `ipcMain.handle` / `invoke`，失败以
    `{ ok:false, errorKind, errorMessage }` 包装返回，不依赖异常序列化；
  - 长过程（AI 流、构建日志、游戏事件）走 `webContents.send` + `ipcRenderer.on`，
    按 `streamId` / `runId` 过滤；
  - 所有主→渲染推送通道在 preload 有白名单，未声明的无法订阅；
  - preload 只暴露声明过的命名空间 API，不泄漏 Node 能力。

---

## 六、共享契约层

### 6.1 内容对象（UnifiedContent）

工坊以「内容对象」为中心，一个对象同时承载三端：

| 端 | 内容 |
| --- | --- |
| Java | 注册类、字段、构造与行为参数 |
| 资源包 | 模型 JSON、贴图 PNG、语言键、音效 |
| 数据包 | 配方、战利品表、标签、进度 |

渲染层用扁平表单编辑，主进程负责组装成完整 schema 并落盘——表单与 schema
之间由 `src/shared/schemas/` 的适配器双向转换，保证「编辑器所见 = 构建所用」。
AI 参考包 manifest 登记 13 种内容类型。

### 6.2 模型文档（ModelDocument）

建模器的原生文档格式，详见 [MODELER.md](MODELER.md)。要点：扁平 map + root
顺序表、不可变更新、贴图 base64 内嵌、schema 版本化自动迁移，存于
`.kunyu/modeler/<id>.json`。

### 6.3 设置与持久化

- 全局设置存于用户数据目录 `settings.json`（提供商、网络、环境、开关）；
- API Key 只留在主进程，经系统钥匙串加密，不进渲染层日志与状态快照；
- 项目级会话、消息与运行记录存本地 SQLite（better-sqlite3）。

---

## 七、渲染层

- **工作台外壳**：左侧活动栏（19 个模块，按项目类型与场景动态可见）+
  主编辑区 + 右侧 AI 助手面板（可折叠调宽）+ 底部终端/问题面板 + 状态栏；
- **模块注册表**：`src/renderer/src/modules/index.ts` 声明式注册，
  模块携带可见性条件（全局 / 按项目类型 / 仅主页）；
- **统一编辑器**：工坊五类内容对象（方块/物品/实体/生物群系/进度）共用同一
  编辑骨架，分区面板（基础表单、配方、战利品表、贴图、AI 重绘、3D 预览）；
- **Monaco**：Java/JSON/GLSL 编辑，CUE 内联补全（FIM 协议，可注入仓库上下文）。

---

## 八、关键端到端数据流

### 8.1 「一句话做一个红宝石块」Agent 链路

```
用户一句话（右侧 AI 助手）
  → 意图识别 + 档位选择（五档预算）
  → understand：项目事实层 + kb_search 检索命中模板/知识
  → generate：模型经 66 个内置工具循环（检索/写文件/校验/贴图/模型）
  → build：Gradle 构建；失败读日志归因 → 修复 → 重建（档位限轮）
  → test：observer mod 启动游戏，GameTest + 截图断言（自愈 ≤10 轮）
  → export：jar / 资源包产物归档，三态结论如实呈现
```

### 8.2 语义编辑落盘与反向同步

```
工坊表单编辑
  → shared 适配器组装完整 schema
  → 主进程 contentGenerator 生成 Java/JSON/PNG
  → 原子写落盘 + 覆盖保护（手工改动的文件不静默覆盖）
  → 反向同步：解析既有注册类（ModBlocks.java 等）回填工坊字段
```

---

## 九、版本矩阵

唯一数据源：`src/main/templates/loaderVersionMatrix.ts`。项目脚手架、CI 构建、
构建探针均按 `(loader, mcVersion)` 从此查询完整工具链（JDK / Gradle / 加载器
版本坐标），不再各自硬编码默认值。

- **覆盖**：35 个登记组合——Fabric 16 条（1.16.5 ~ 26.3）、Forge 6 条
  （1.18.2 ~ 26.3）、NeoForge 13 条（1.20.4 ~ 26.3）；
  其中 NeoForge 26.3 上游仍为 Beta，登记可见但禁止创建（向导灰显），
  实际可用 34 个组合；Forge 1.16.5 因 FG4 + official mappings 框架级不兼容
  已冻结，不计入组合。
- **版本分层**：
  - `core`：1.20.1 / 1.21.1（三加载器主力，发布前强制真机验证门槛）；
  - `extended`：1.20.4 / 1.20.6 / 1.21.3+ 与 26.x 新年份线；
  - `legacy`：1.16.5 / 1.18.2 / 1.19.2（新建向导默认隐藏）。
- **JDK 映射**：JDK 17（1.16.5~1.20.1 线）/ JDK 21（1.20.4 起）/ JDK 25
  （26.x 线），由环境引导器自动检测与下载。
- **26.x 新年份线**：Fabric 26.x 起 Yarn 无构建，改用 Loom 默认 Mojang 官方
  映射（模板不输出 mappings 行）；Forge 26.3 为 FG7 mavenizer 体系。

---

## 十、安全模型

- **窗口**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、
  `webSecurity` 开（生产构建）；
- **preload**：只暴露声明过的 API；主→渲染推送通道白名单；
- **CSP**：静态声明，禁止远端脚本与 `unsafe-eval`（详见 README「已知环境问题」
  中 dev/prod 差异说明）；
- **密钥**：API Key 仅存主进程并加密，不写入渲染层日志与前端状态快照；
- **网络**：渲染层无直接出网能力；所有外部请求经主进程，统一治理超时、
  代理与退避；文件下载支持断点续传——瞬时中断按 Range 从已落盘字节继续，
  半成品保留在目标旁的 `.part`，再次下载可接着传；
- **NeoForge 构建**：NFRT 对不在 artifact manifest 里的工具（如 `binarypatcher`）
  硬编码从 `maven.neoforged.net` 下载，该域名在部分网络不可达，构建会卡在
  `:createMinecraftArtifacts`；用 `scripts/prefetch-nfrt-tools.ps1` 经 forgecdn
  预取并做 sha1 校验后写入 NFRT 工件缓存，构建时直接复用。构建日志出现
  `WARNING: <坐标> is not present in the artifact manifest` 即说明需要预取；
- **本地数据**：设置、会话、运行记录留在本机；不上传代码或项目内容；
- **社区桥接**：人机验证不由程序自动挑战，正常加载验证页面后由开发者手动
  完成；挑战出现异常时主动停止，避免反复刷新影响站点信誉；
- **MCP 工具权限**：市场新装插件默认不暴露任何工具，需逐项勾选放行，
  调用留审计日志。

---

## 十一、扩展指南（新增一个领域能力的最短路径）

1. **shared**：在 `types/` 定义类型，`ipc.ts` 登记通道常量；
2. **main**：在对应 `services/` 域实现业务逻辑（纯函数优先，便于单测），
   在 `ipc/` 装配 handler；
3. **preload**：声明 API 与（如有）推送通道白名单；
4. **renderer**：在对应模块视图调用 `window.api`；新模块则登记进
   `modules/index.ts` 并声明可见性条件；
5. **测试**：主进程/共享层跑 node 环境 spec，渲染层跑 jsdom 环境 spec；
6. **AI 工具**（如需要）：在 `services/ai/fcTools/` 按域新增工具定义，
   遵循「软失败（ok:false + 文本说明），不阻断流水线」约定。

---

*—— kunyu (睏欤)*
