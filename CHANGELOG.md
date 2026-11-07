# 更新日志

## Unreleased

### 新增

- **构建依赖（Maven 坐标）管理**：模组项目新增「构建依赖」模块，按 `group:artifact:version` 把编译期依赖写进项目 `build.gradle` 的 `repositories` / `dependencies`。
  - 只认自己写的行（行尾 `// kunyu:dep:<group>:<artifact>` / `// kunyu:maven:<url>` 标记），用户手写的仓库与依赖不读取、不修改、不展示
  - 幂等：重复添加同一坐标不产生重复行，改版本原地更新；撤销依赖/仓库即删对应标记行
  - 坐标与仓库名做白名单校验（仓库仅接受 https、拒绝内嵌凭证与查询串），防止把引号/换行注入构建脚本
  - 默认配置按加载器区分：Fabric 用 `modImplementation`，Forge/NeoForge 用 `implementation`
  - 真机验证：对演示项目写入 GeckoLib 坐标 → 落到正确的两个块内 → 撤销后 `build.gradle` 与原文件 SHA256 完全一致
  - 缺口如实说明：这是**编译期**依赖链路，与资源库「下载 jar 到 `run/mods`」的运行期链路互相独立；不解析传递依赖，也不做版本冲突仲裁
- **设置项「启动动画」开关**：关闭后启动直接进入主界面，运行中关闭也会立刻收起当前启动层
- **生成任务的上下文交接**：AI 生成流水线压缩历史时，摘要同样写入项目记忆（`.kunyu/agent-memory.md`，`[上下文交接]` 标记），与聊天链路一致；此前长任务被压缩掉的结论下一次会话就没了
- **加载器版本矩阵定时自动刷新**：新增 `scripts/refresh-loader-matrix.mjs`，配合 `.github/workflows/matrix-refresh.yml` 每天 UTC 03:00 拉取上游元数据，有变化自动开 PR。
  - Fabric 的 `loader / yarn / fabric-api / loom / gradle` 一律整体跟随官方 MDK（`FabricMC/fabric-example-mod` 各 MC 分支的 `gradle.properties` + `gradle-wrapper.properties`），取不到 MDK 就整条跳过——不会出现"loader 升了、loom 没升"这种官方未验证的组合。源不可达时自动回退 Gitee 镜像。
  - 若上游 loom 要求更高的宿主 JVM 而矩阵的 JDK 不够，该条**只报告不写入**（`[hold]`），避免产出 `loom 1.19 + JDK 17` 这种必然跑不起来的组合。
  - 新增 `src/main/templates/mdkSnapshot.json` 作为 MDK 坐标 lockfile，`loaderVersionMatrix.spec.ts` 增加离线结构断言：矩阵与快照不一致即失败（已用「只改 loader 不改 loom」的注入缺陷验证会红）。
  - 连续 3 天失败自动开/追加 issue，避免"job 红但没人订阅 CI"等于静默。
  - Forge / NeoForge 仍为版本号 patch 级刷新；`jdk / hostJdk / forgeConstructorStyle / FG 区间 / MDG 版本` 不自动推导，需人工核对。
- **既有项目不会被矩阵刷新追溯修改**：加载器/映射/API 版本在创建项目时就写进了工程自己的 `gradle.properties`，矩阵自动刷新只影响之后新建的项目。需要升级老项目目前只能手工改这几个版本号（项目级「升级到最新工具链」入口尚未实现）

### 修复

- **五档预算与模型价格脱钩**：此前 `TIER_RUN_BUDGETS` 是硬编码常量（24/48/72/96/144 次），换贵模型照样跑满、换本地无限量模型也不会放宽，用户无法知道「哪个模型贵、哪个不限流」。新增 `src/shared/types/modelProfile.ts` 作为模型价格/上下文/能力/计费类型的单一数据源，数据来自 OpenRouter 公开模型 API 的真实价格快照（`src/shared/data/modelCatalog.json`，`npm run models:refresh` 刷新，运行时离线读取）；`resolveRunBudget(tier, profile)` 按「单次成本上限 × 档位份额 / 每次调用估算成本」推导调用次数，并在估算成本超限时熔断。零价/本地模型记为 `unlimited`，目录未收录的模型不猜价、回退固定上限并标注 `unknown`。设置页新增「单次任务成本上限」，运行日志逐条说明预算来源。
- **自审不可信（生成者自己判断自己）**：此前 generate 后由同一模型、同一上下文复核自己的产出，看到的是自己的推理与自述，容易顺着结论打勾。新增独立审查阶段（`src/main/services/ai/orchestrator/independentReview.ts`）：审查者只接收变更前后的 unified diff、验收条件与项目类型，不接收生成过程/工具轨迹/模型自述；输出结构化「verdict + 问题清单（文件:行 + 理由）」。存在 blocker 时回滚本次写入并在 build 之前阻断，审查结论以 artifact 呈现；应答不可解析时降级为 skipped，不因审查自身不稳定误伤运行。设置页可指定独立审查模型（默认沿用生成模型但上下文完全隔离）或关闭该阶段。
- **工具数量文档失真（无单一数据源）**：README 写「93 个」、AI-PIPELINE / ARCHITECTURE / FEATURES 写「66 个」，而注册表实测为 **35（无项目）/ 88（模组项目）/ 91（整合包项目）**——工具是按上下文门控动态暴露的，任何单一数字只对某个场景成立。新增 `src/main/services/ai/toolInventory.ts` 作为唯一口径，`npm run tools:inventory` 生成 `docs/TOOLS-INVENTORY.json`，`toolInventory.spec.ts` 守门（已注入错误计数验证会红）；四处文档改为引用该产物，不再手写数字
- **「版本矩阵健康度」刷新按钮无效**：按钮此前只重读本地 overlay，而 overlay 对已存在的组合一旦写入就永不更新（`seedFromBaseline` 只补缺失项），所以参考包里更新的门禁结论永远进不来——实测本机 34 个组合的基线数据都比本地新。新增 `monitor:refresh` 通道：重读参考包基线，按 `lastVerifiedAt` 把更新的 `matrixHealth` 统计并入 overlay（不动灯色，避免旧基线把探针红灯刷回绿灯），并提示本次同步条数
- **模型工坊保存写坏文档**：`serializeDocument` 本身已返回 JSON 字符串，调用处又 `JSON.stringify` 了一次，导致落盘的是被转义的字符串；主进程读回后 `format` 恒为 `undefined`，资源包/应用实体编译 100% 失败。自动保存与手动保存两处均已修正
- **glTF 导入多轴旋转错误**：导入端自带的四元数转欧拉公式与导出端 `quatFromEulerXYZDeg` 不是同一旋转序，多轴旋转解出的角度完全对不上（如 `[30,40,50]` 解成 `[48.42,-1.44,60.49]`）；改为复用 `shared/modeler/quat.ts` 的 `eulerXYZDegFromQuat`
- **市场安装路径穿越**：此前直接用第三方响应里的 `fileName` 拼安装路径，投毒响应（如 `../../Startup/a.jar`）可写到目标目录之外；现在落盘前只取文件名最后一段并剔除非法字符，来源记录同步使用清洗后的名字
- **`run_command` 可绕过可执行白名单**：此前只校验 basename，`./node`、`C:\\tools\\Git.exe` 这类带路径的写法能直接执行磁盘上的同名文件；改为拒绝任何带路径分隔符的 exec
- **生成清单非原子写 + 损坏即当基线**：清单改为「临时文件 + rename」原子写；读取时若清单存在但无法解析，不再按首轮基线放行，而是按「来源未知」把已存在文件判为冲突，避免静默覆盖用户手改的 Java / assets
- **更新链路镜像信任边界收紧**：`latest.yml` 只从 GitHub 直连读取，镜像仅承载安装包；镜像前缀强制 https 且拒绝 `?` `#` `@`，安装包下载后自算 sha512 并校验 10 MB 体积下限，通过后才允许安装——镜像劫持无法再同时替换清单元数据

## 0.1.8 - 2026-11-05

### 新增

- **启动动画正式接入应用启动流程**：两幕动画（品牌亮相 → 方块世界）在真实窗口首帧即显示，期间执行初始化；跳过按钮只关闭界面，不打断初始化
- **启动日志绑定真实初始化事件**：设置加载、主题/语言应用、工作区模块装载、运行环境校验、上次项目恢复、MC 运行环境检查共 6 步，逐行显示实际耗时与成败，失败行标红但不中断后续步骤；底部进度条只按已完成步骤推进，另有 12 秒兜底放行
- 相位改为 CSS 过渡驱动（品牌 3s → 第二幕 3s → 整层 1s 淡出，合计约 7s），退场不再依赖 Vue 过渡类，窗口隐藏时也不会残留遮挡层
- 两幕动效（图标入场、字标上浮、地面滚动、方块雨、光束呼吸）始终播放，不随系统「减弱动态效果」偏好关闭——该偏好在本机会导致整段动画只剩背景淡入淡出
- **FancyMenu 开始菜单可视化编辑器**：画布缩放、Ctrl + 滚轮精细定位、工具栏预设；P2 补齐轮播与粒子元素，并新增 TaCZ 死亡消息模块
- **FTB Quest 拖拽连线画布**：任务节点可直接拖拽摆放并连线
- **AI 工具动作展示「依据」**：每个工具动作附上本轮推理摘要与写入前的读取 / 检索证据，时间线可逐条展开，看清模型为什么这么做
- **插件页支持语言插件**：声明式语法着色插件，零代码执行，内置 snbt-colors 示例

### 修复

- **Windows 安装包构建失败**：发版流水线为跑单测铺了 0 字节 electron 二进制桩，打包链路却直接使用该目录（缺 `dist/version` 与全部运行时文件），导致「构建安装包」阶段退出；新增 `scripts/restore-electron-binary.cjs`，打包前自动还原真实二进制，还原不成即明确失败
- 模型工坊按项目隔离，修复市场搜索卡顿与 FTB 画布平移
- `httpGetText` 恢复 `truncated` 字段语义，修复相关单测断言
- 表单 action 字段改用显式 `model-value` 绑定，避免 `v-model` 空值合并编译失败
- 画布硬编码文案改为 i18n，移除 `any` 类型断言
- 修正 modpack IPC handler 的相对路径问题，收窄测试联合类型
- FancyMenu 改用项目 store 取路径，修复任务坐标 TDZ

### 其他

- README 品牌化改造（logo 头图、徽章、导航、下载表），仓库名回退为 KunYuStudio
- 依赖升级（minor-and-patch 分组）
- CI：Release 的 Windows 质量门禁补 electron 二进制桩；Web 端共享路径统一

---

历史版本（0.1.7 及更早）的变更记录见 GitHub Releases 页面。
