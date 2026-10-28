# KunYu 功能模块清单

> 按代码实际实现盘点：25 个活动栏模块 + 工程链路能力。
> 架构见 [ARCHITECTURE.md](ARCHITECTURE.md)，AI 子系统（五档 Agent、66 个
> 内置工具、上下文管理）见 [AI-PIPELINE.md](AI-PIPELINE.md)。

---

## 一、模块总表

模块在 `src/renderer/src/modules/index.ts` 声明式注册，按项目类型与场景
动态可见。

| # | 模块 id | 显示名 | 一句话定位 | 可见范围 |
| --- | --- | --- | --- | --- |
| 1 | `project-manager` | 项目管理 | 新建 / 打开 / 导入项目，主页卡片 + 工作区双模式 | 全局 |
| 2 | `unified` | 工坊 | 按内容对象编辑方块/物品/实体等的 Java、资源包、数据包三端 | 模组项目 |
| 3 | `modeler` | 模型工坊 | 通用 3D 建模器（立方体 / 骨骼 / 网格 / UV / 权重 / 动画） | 任意项目 |
| 4 | `datapack` | 数据包编辑器 | 无代码编辑配方、战利品表、进度、标签、函数 | 模组 / 数据包 |
| 5 | `ftbquest` | FTB 任务书 | 编辑 FTB Quests 章节：任务提交物品、奖励与前置依赖，落盘 SNBT | 模组 / 整合包 |
| 6 | `patchouli` | 指南书 | 编辑 Patchouli 手册：类目与条目页面（文本/配方/图片/聚焦） | 模组 / 整合包 |
| 7 | `kubejs` | KubeJS 脚本 | 三目录脚本编辑：启动期注册、服务端与客户端事件，模板库生成骨架 | 模组 / 整合包 |
| 8 | `resourcepack` | 资源包编辑器 | 贴图、模型、音效、语言、字体与打包导出 | 模组 / 资源包 |
| 9 | `audio` | 音效工坊 | 参数合成 / MIDI / 本地音频统一转 OGG，注册 sounds.json 音效事件 | 模组 / 资源包 |
| 10 | `shaderpack` | 光影包编辑器 | Iris / OptiFine 光影包：GLSL、子 pass、选项与多语言 | 光影包 |
| 11 | `enchant` | 附魔编辑器 | 自定义附魔：Fabric/Forge 出 Java 类，NeoForge 出数据 JSON | 模组项目 |
| 12 | `gallery` | 资产库 | AI 贴图候选、像素资产与 3D 模型统一归档；分享包导入导出与跨项目汇总，零额度复用 | 全局 |
| 13 | `vcs` | 版本与产物 | Git 提交、分支、差异与构建产物管理 | 全局 |
| 14 | `debug` | 运行和调试 | 启动游戏、断点调试、日志观察 | 任意项目 |
| 15 | `decompile` | 反编译 | 用 Vineflower 把任意 jar 反编译为可读 Java 源码树，只读浏览 | 全局 |
| 16 | `market` | 模组与市场 | 模组市场、社区桥接 | 整合包 / 未开项目 |
| 17 | `modlib` | Mod 库 | 全局 Mod 库：市场下载与本地导入的 jar 统一存放，可一键加入整合包 run/mods | 全局 |
| 18 | `launcher` | 启动器集成 | 检测本机启动器、一键导入产物、快速启动 | 任意项目 |
| 19 | `ai-workflow` | 全流程 AI 制作 | 主页 AI 引导：从创意到成品 | 仅主页 |
| 20 | `performance` | 性能画像 | 五维评分排行、冲突建议、JFR / Spark 归因 | 模组项目 |
| 21 | `modpack` | 整合包组装 | 扫描 run/mods，生成双平台清单与 overrides，导出 zip | 整合包 |
| 22 | `ci-cd` | CI/CD 集成 | 生成 GitHub Actions：build / release / gametest | 模组项目 |
| 23 | `plugins` | 插件库与商城 | 第三方扩展浏览、安装与启用管理 | 全局 |
| 24 | `dsh-plugins` | DSH 插件 | 兼容宿主，DeepSeek Harness 插件工具直接进 AI 循环 | 全局 |
| 25 | `settings` | 设置 | 偏好、环境、AI、网络、更新（底部固定） | 全局 |

---

## 二、模块明细

### 1. 项目管理 `project-manager`

- 主页卡片式项目列表：新建 / 打开 / 导入已有工程；
- 按项目类型分流：模组、数据包、资源包、光影包、整合包；
- 新建向导：模板、命名空间、加载器与 Minecraft 版本（版本矩阵见
  [ARCHITECTURE.md](ARCHITECTURE.md) 第九节）；
- 工作区双模式：代码模式（文件树 + 编辑器）与可视化模式；
- 侧边栏常驻文件树；多文档标签、前进后退。

### 2. 工坊 `unified`

- 顶部按内容类型切换：物品 / 方块 / 实体 / 生物群系 / 进度；
- 每个对象统一持有三端：Java 类、资源包（模型/贴图/语言）、数据包
  （配方/战利品表/标签）；
- 编辑分区：基础表单、配方、战利品表、贴图编辑、像素绘画、AI 重绘、
  3D 模型预览、模型工坊跳转；
- 代码生成与反向同步（把工坊字段写回 `ModBlocks.java` 一类注册类）；
- 导入导出：Blockbench 工程、OBJ 体素化导入；
- 资源体检：缺失贴图、模型与语言键的批量诊断；
- 保存 → 生成 → 构建一条链。

### 3. 模型工坊 `modeler`

自研通用 3D 建模器（clean-room，不读取不复制 Blockbench 源码，仅依据官方
wiki 与公开格式规范独立实现）。架构与完整操作说明见 [MODELER.md](MODELER.md)。
要点：

- 原生文档 `.kunyu/modeler/<id>.json`，贴图 base64 内嵌；
- 节点：立方体 / 组（骨骼）/ 定位点 / 网格；
- 视口：移动、旋转、缩放、绘画、权重五工具，网格子对象（对象/顶点/面/边/切刀）；
- UV 编辑器：per-face 与 box-uv、自动 UV、整像素吸附；
- 时间轴：三通道关键帧、缓动曲线、`.animation.json` 互导、动画控制器状态机；
- 格式矩阵：Java 方块/物品、Bedrock 实体/方块、GeckoLib、自由模型、OBJ 导出；
  导入 BB / OBJ / DAE / FBX / glTF / geo.json / JEM / JPM / 皮肤；
- 落地：应用到对象 / 实体写回，或随项目构建编译进资源包。

### 4. 数据包编辑器 `datapack`

- 树形管理数据包结构（`data/<ns>/...`）；
- 配方：有序/无序/熔炼/切石/锻造等，表单化编辑；
- 战利品表、进度、标签（方块/物品/实体/函数）、函数文件；
- 校验命名空间与 JSON 结构，避免进游戏才报错。

### 5. FTB 任务书 `ftbquest`

- 直读直写 `config/ftbquests/quests/chapters/*.snbt` 章节文件；
- 左栏章节列表（新建 / 删除），右栏章节表单（id / 名称 / 图标）与任务表格；
- 任务为提交物品类型，可配物品奖励与前置依赖（标签展示，拖拽连线画布后置）；
- 保存经主进程重写为规范 SNBT（与整合包生成器互逆），游戏内 `/reload` 生效。

### 6. 指南书 `patchouli`

- 直读直写 `config/<命名空间>/patchouli_books/<book>/`：book.json + 类目 + 条目页面；
- 手册 / 类目 / 条目三级表格编辑；模组项目默认命名空间取 modId；
- 页面类型四种：文本 / 配方 / 图片 / 聚焦（spotlight），不识别的类型给出警告且不回写；
- 保存为同步语义：已删除的类目 / 条目文件一并移除，游戏内持有手册即可翻阅。

### 7. KubeJS 脚本 `kubejs`

- 直读直写 `kubejs/{startup,server,client}_scripts/*.js`，按启动期 / 服务端 / 客户端三目录分组；
- Monaco JS 编辑，含 onEvent 事件 API 片段补全，Ctrl+S 保存落盘；
- 模板库内置常用骨架（物品 / 方块注册、配方、服务端与客户端事件），一键生成新脚本，
  目标已存在时拒绝覆盖；
- 目录不存在时保存自动创建；游戏内 `/reload` 生效。

### 8. 资源包编辑器 `resourcepack`

- 目录树组织 `assets/<ns>/`：textures、models、sounds、lang、font；
- 贴图编辑与像素绘画，支持多分辨率；
- 模型 JSON 编辑与预览；
- 音效事件、语言文件、字体提供者配置；
- `pack.mcmeta` 分辨率与格式管理，打包导出标准资源包。

### 9. 音效工坊 `audio`

- 三条来源统一转 OGG 44.1kHz：jfxr 参数合成器（波形 / 滑音 / 包络等参数与跳跃、激光等
  预置）、MIDI 旋律渲染、本地音频导入（wav / mp3 / ogg / flac / m4a / aac）；
- 落盘 `assets/<命名空间>/sounds/`，并注册 `sounds.json` 音效事件
  （事件名、引用音效、字幕键）；
- 声音库集中管理已生成音效与已注册事件；
- FFmpeg 首次使用按需下载，不进安装包。

### 10. 光影包编辑器 `shaderpack`

- 文件树按管线分类：gbuffers（11 个子 pass）、shadow、composite 1–9、
  program、属性；
- 新建文件时按子 pass 选择模板（含 `fallbackTo` 后备链提示）；
- GLSL 编辑：语法高亮、片段库；
- `shaders.properties` 选项、多语言文件；
- 子 pass 清单与后备链可视化。

### 11. 附魔编辑器 `enchant`

- 语义 schema 驱动的轻量编辑器，不进 unified 三端模型；
- 按加载器出码：Fabric / Forge 生成 Java 注册类；NeoForge 1.21 起生成数据 JSON；
- 冲突与等级上限等字段表单化。

### 12. 资产库 `gallery`

- AI 生成的全部贴图候选自动存档；
- 无项目时跨项目汇总为素材库；有项目时看本项目；
- 一键写回资产 / 二次编辑，避免重复消耗 AI 额度；
- 项目内像素资产与 3D 模型统一归档；
- `.kyshare.json` 分享包导入 / 导出，并提供公开发布入口。

### 13. 版本与产物 `vcs`

- Git：提交、分支、差异查看；
- 产物管理：构建 jar / 资源包 / 整合包的归档与定位。

### 14. 运行和调试 `debug`

- 启动游戏（按项目加载器与版本）；
- 断点调试入口；
- 日志与运行态观察，配合底部终端与问题面板。

### 15. 反编译 `decompile`

- 用 Vineflower 把任意 jar 反编译为可读的 Java 源码树，便于学习模组实现与排查依赖冲突；
- 工具首次使用按需下载（Maven Central / 阿里云镜像，强制 SHA-256 校验），不进安装包；
- 产物保存在用户数据目录 `decompiled/` 独立安全根，与项目文件树隔离；
- 工作区列表 + 懒加载文件树 + 类名搜索 + Monaco 只读浏览，超大文件截断预览。

### 16. 模组与市场 `market`

- 模组市场浏览、详情、安装、已安装列表（Modrinth / CurseForge）；
- 公共社区桥接；人机验证由开发者手动完成（见
  [ARCHITECTURE.md](ARCHITECTURE.md) 安全模型）；
- 整合包依赖审计；
- 依赖外部社区站点可用性，部分区域受网络环境影响。

### 17. Mod 库 `modlib`

- 全局库，位于用户数据目录 `mod-library/`，不绑定任何项目；
- 市场下载与本地导入的 jar 统一存放，未打开项目也能查看、搜索筛选与清理；
- 打开整合包项目可一键加入 `run/mods`（与组装区拖放共用同一写入逻辑）；
- 弱网下载支持断点续传与自动重试（见 [ARCHITECTURE.md](ARCHITECTURE.md) 网络层）。

### 18. 启动器集成 `launcher`

- 检测本机启动器（官方 / 第三方）；
- 一键导入构建产物；
- 快速启动游戏实例。

### 19. 全流程 AI 制作 `ai-workflow`

- 主页专属入口，未打开项目时引导创建或选择项目；
- 用对话把创意拆成可执行任务，再交给 Agent 流水线；
- 打开项目后由右侧 AI 助手接管，本入口自动从项目页移除。

### 20. 性能画像 `performance`

- 模组五维评分与排行榜；
- 冲突检测与优化建议；
- JFR / Spark 采样归因（热点方法、耗时分布）。

### 21. 整合包组装 `modpack`

- 扫描 `run/mods` 实际依赖；
- 生成 CurseForge 与 Modrinth 双平台清单；
- 生成 `overrides` 覆盖目录，导出整合包 zip；
- 依赖完整性与冲突审计。

### 22. CI/CD 集成 `ci-cd`

- 生成 GitHub Actions 工作流：
  - `build`：版本矩阵构建；
  - `release`：手动确认后发布；
  - `gametest`：无头 GameTest。

### 23. 插件库与商城 `plugins`

- 浏览、安装、启用/停用第三方扩展（MCP server）；
- 市场预置一键导入；工具级权限过滤——新装插件默认不暴露任何工具，
  需在「工具权限」逐项勾选放行；
- 插件工具经 MCP 桥接进入 AI 工具循环。

### 24. DSH 插件 `dsh-plugins`

- 无需安装 DeepSeek Harness 本体，直接装载其社区插件；
- 插件暴露的工具直接进入 AI 工具循环；
- 桌宠（dsh-pet）以事件流跟进 AI 运行状态。

### 25. 设置 `settings`

- 通用偏好、界面与编辑器行为；
- 环境：JDK 检测与自动准备（17/21/25 版本矩阵）、Minecraft 客户端与依赖、
  镜像与回退；
- AI：提供商与模型、API Key、生成参数；
- 网络：超时、代理；
- 子代理委派开关（默认关闭，控制算力成本）、观察者 Agent 开关；
- 应用更新检查设置项。

---

## 三、工程链路能力

| 能力 | 说明 |
| --- | --- |
| 环境准备 | 内置引导器：JDK（17/21/25）、Minecraft 客户端、依赖库、资产；断点续传与镜像回退 |
| 版本矩阵 | 按加载器 + MC 版本选择对应 JDK 与 Gradle 配置（唯一数据源 `loaderVersionMatrix.ts`） |
| 构建 | Gradle 构建、实时日志、问题面板、产物收集、产物新鲜度断言 |
| 运行 | 启动客户端 / 服务端，observer mod 回传截图与状态 |
| 验证 | GameTest、断言、三态结论（已验证 / 未通过 / 未验证） |
| 导出 | jar、资源包、数据包、光影包、整合包 zip |
| 发布 | 直发 Modrinth / CurseForge，发布前 preflight 检查 |
| VCS | Git 集成与产物归档 |
| CI | GitHub Actions 生成（build / release / gametest） |
| 分享 | `.kyshare` 分享包导出/导入 |

---

## 四、已知边界

- 不随包内置 Minecraft 游戏本体与 JDK，首次使用需联网准备（镜像失败自动回退）；
- 开发模式下为调试便利放宽了部分安全策略，正式包恢复严格配置
  （见 README「已知环境问题」）；
- 社区桥接依赖外部站点可用性，网络受限区域体验不稳定；验证页面需人工完成；
- 真机整机验证（全加载器 × 全版本组合）按计划后置；
- 建模器复杂网格操作（knife / loop cut / weight paint 进阶）后置；
- 外部 Agent 派发的真实 CLI 端到端实测暂缓，等真实需求与反馈。

---

*—— kunyu (睏欤)*
