# KunYu AI 子系统（AI Pipeline）

> 本文描述 KunYuStudio 的 AI 链路：对话入口、五档编排、工具注册表、上下文管理、
> RAG 与三态验收。模块视角的功能清单见 [FEATURES.md](FEATURES.md)。

---

## 一、分层

```
对话入口（右侧 AI 助手 / 主页全流程 AI 制作）
        ↓
意图与档位（迅工 / 匠造 / 大师 / 桥接 / 织星）
        ↓
编排器 orchestrator（understand → generate → build → test → export）
        ↓
工具注册表 ToolRegistry（内置工具按上下文门控动态暴露，数量见 [TOOLS-INVENTORY.json](TOOLS-INVENTORY.json) + MCP 桥接 + DSH 插件工具 + 子代理）
        ↓
主进程服务（AI HTTP、Gradle、MC 运行时、游戏控制、知识库、参考包）
```

AI 助手非常驻：打开项目时主动开启，避免不同项目任务混用；主界面保留开关，
无项目时作为普通聊天框使用，不进行项目工作。

---

## 二、五档 Agent

同一条全链路跑五种预算档位（深度定义于 `src/shared/types/tiers.ts`，预算由
`src/shared/services/runBudget.ts` 的 `resolveRunBudget(tier, profile)` 推导）。

预算**不再硬编码**：档位只决定「能跑多深」，实际次数由模型真实价格折算。

| 档位 | id | 深度天花板（模型调用） | Gradle 构建上限 | 构建自动修复轮次 | 成本份额 |
| --- | --- | --- | --- | --- | --- |
| 迅工 | sprinter | 20 | 4 | 0 | 25% |
| 匠造 | artisan | 29 | 5 | 1 | 50% |
| 大师 | master | 44 | 7 | 3 | 75% |
| 桥接 | bridge | 55 | 8 | 4 | 90% |
| 织星 | weaver | 70 | 9 | 5 | 100% |

- **价格来源**：`src/shared/data/modelCatalog.json` 是 OpenRouter 公开模型 API 的
  USD/百万 token 真实价格快照，`npm run models:refresh` 刷新；运行时离线读取。
- **换算**：`可用调用次数 = 单次成本上限 × 档位份额 / 每次调用估算成本`，再与深度
  天花板取小；贵模型调用次数更少，便宜模型可跑满深度。
- **兜底**：目录未收录的模型不猜价格，回退固定上限并在运行日志中标注
  `unknown`；本地 Ollama / 零价模型记为 `unlimited`，不设成本上限。
- **熔断**：模型调用、估算成本、Gradle 构建、墙钟任一超限即收尾停止，如实说明
  未完成部分，不无限重试。

**独立审查**：generate 结束后、build 之前，由隔离上下文的审查者只读取
「unified diff + 验收条件 + 项目类型」，不接收生成过程/工具轨迹/自述；输出
`verdict + 问题清单（文件:行 + 理由）`。存在 blocker 时回滚本次写入并阻断
build/test（`src/main/services/ai/orchestrator/independentReview.ts`）。

五阶段轨道：**understand → generate → build → test → export**
（理解 → 生成 → 构建 → 测试 → 导出）。

---

## 三、关键机制

| 机制 | 作用 |
| --- | --- |
| 构建治愈循环 | 构建失败读日志 → 归因 → 修复 → 重建，轮次按档位 0/1/3/4/5 封顶 |
| 真机测试自愈 | GameTest / 断言失败自动修复重跑，至多 10 轮 |
| 写入护栏 | 写文件前校验语法与结构，避免制造新错误；项目源码文件白名单约束读写范围 |
| 三态验收 | 已验证 / 未通过 / 未验证（INCONCLUSIVE）显式呈现，未验证不冒充通过 |
| 验收契约 | 验收断言合并为契约（contract），支持复验断言回写状态 |
| 流式中间态 | 思考、正文、工具执行实时可见；工具调用折叠为摘要行 |
| 增量编辑 | AI 代码生成基于已有文件的增量修改（edit_project_file），避免反复输出完整文件 |
| 候选画廊 | AI 贴图全部候选自动存档，零额度复用与二次编辑 |
| 子代理委派 | `agent_delegate` / `agent_delegate_batch`，单代理至多 6 轮；设置页独立开关，**默认关闭**（控制算力成本） |
| 零产出门 | generate 阶段无任何产物时如实判失败，不伪装成功 |
| 任务清单 | `todo_write` 让 Agent 显式维护待办，运行级隔离 |

---

## 四、内置工具（按域）

工具定义集中在 `src/main/services/ai/fcTools/` 按域分文件。全部软失败
（`ok:false` + 文本说明），不阻断流水线。分级：`chat` 级在 generate FC 循环
暴露给模型；`scheduling` 级（如 `gradle_build`）仅编排调度代码直接调用。

**数量不写死在文档里**：工具按上下文门控（无项目 / 模组项目 / 整合包项目各自不同），
真实数字由 `npm run tools:inventory` 从注册表实测写入 [TOOLS-INVENTORY.json](TOOLS-INVENTORY.json)，
`toolInventory.spec.ts` 负责在「加了工具但没更新清单」时让 CI 变红。

| 域（文件） | 工具 |
| --- | --- |
| 只读检索 `chatRetrievalTools` | `template_search` `kb_search` `mc_data_lookup` `error_analyze` `version_check` `api_validate` `project_grep` `read_project_file` |
| 游戏控制 `gameControlTools` | `mc_state` `mc_screenshot` `mc_command` `mc_chat` `mc_world` `mc_observe_entity` `mc_inventory` `mc_input` `mc_ensure_test_world` `mc_cleanup_test_world` `run_game_test` `mc_launch` |
| 内容语义 `contentTools` | `content_list` `content_read` `content_upsert` `write_project_file` `edit_project_file` `texture_asset_search` `texture_paint` `texture_pixelize` `texture_repaint` `model_validate` `item_validate` |
| 配方 `recipeTools` | `recipe_validate` `recipe_create` `recipe_generate` |
| Mixin `mixinTools` | `mixin_target_lookup` `mixin_scaffold` `mixin_register` `mixin_validate` |
| 校验 `validationTools` | `fabric_mod_json_validate` `fabric_log_debugger` `mc_test_scenario` |
| Forge/NeoForge `forgeNeoTools` | `forge_mods_toml_validate` `neoforge_mods_toml_validate` `forge_meta_version_check` `neoforge_meta_version_check` |
| Fabric `fabricTools` | `fabric_meta_version_check` `fabric_javadoc_lookup` `fabric_template_generate` `fabric_content_register` `fabric_data_assets_generate` |
| 市场 `marketTools` | `market_search_mods` `market_mod_detail` `market_install_mod` `market_list_installed` `modpack_dependency_audit` |
| 调度 `schedulingTools` | `gradle_build` |
| 待办 `todoTools` | `todo_write` |
| 联网 `webTools` | `web_fetch` |
| IDE `ideTools` | `list_files` `run_command` |
| 记忆 `memoryTools` | `agent_memory_read` `agent_memory_append` `agent_memory_clear` `project_facts_write` |
| 子代理 `subAgentTools` | `agent_delegate` `agent_delegate_batch` |

此外还有两类外部工具来源注入同一注册表：

- **MCP 桥接**：内置 mcdev-mcp 的 8 个只读静态工具经适配器注入；自定义
  MCP server（stdio）与市场预置插件同理接入。市场新装插件默认不暴露任何
  工具，需在插件页「工具权限」逐项勾选放行，调用留审计日志。
- **DSH 插件**：DeepSeek Harness 社区插件经兼容宿主装载，工具直接进循环。

---

## 五、上下文管理

目标：在有限窗口内保住关键历史，同时对模型诚实（不静默丢东西）。

| 手段 | 说明 |
| --- | --- |
| 历史预算随窗口缩放 | `resolveContextBudget`：预算 = min(固定上限, 模型窗口 × 50%)。固定上限：聊天 48k tokens（`aiChat.ts`）、Agent 64k tokens（`historyBudget.ts`） |
| 三层压缩 | Agent 历史超预算时：旧轮次摘要化 → 工具结果折叠 → 系统提示精简；被丢弃的轮次由模型先行总结（`summarizeDroppedRounds`），摘要留在上下文里 |
| 单条工具结果截断 | 超长输出按域常量截断，保留头部关键信息 |
| 工具 schema 预算 | 工具 schema 本身占窗口：无项目约 6.9k tokens、有项目约 16.8k tokens；按项目类型与档位过滤可见工具，控制 schema 开销 |
| 运行态工具输出形态 | `mc_*` 等运行态工具的输出针对上下文体积做结构化压缩 |
| 项目索引排除 | 构建产物、依赖目录不进检索与注入 |
| 格式约束前置 | 生成阶段系统提示即携带目标格式/边界约束，减少返工 |

---

## 六、RAG 与参考资源

- **AI 参考包**（`resources/ai-reference/`）：1576 个活跃模板（35 个
  loader × MC 组合）、39 条错误模式、78 条 API 索引，覆盖 12 种内容类型；
  `manifest.json` 登记版本指纹与来源统计。
  模板目录为**压缩布局**：`templates/canonical/` 每 (loader, 槽位) 一份正文
  （版本号等写成 `{{mcVersion}}` 占位符），`templates/vars/` 存占位符取值，
  `templates/versions/<loader>/<mc>.json` 声明该组合由哪些槽位组成、
  换行与迁移注释头，`templates/variants/` 只放装不进占位符的真实差异。
  manifest 的 `file` 仍是旧虚拟路径 `templates/<loader>/<mc>/<slot>`，
  运行时由 `templateStore` 组合还原（逐字节与压缩前一致，见
  `__tests__/templateStore.spec.ts` 的 sha1 基线断言）。
  模板来源以社区公开成果为基础重写/适配，谨向 Fabric、Forge、NeoForge
  社区与 minecraft-data 等数据来源致谢。
- **知识库**（`resources/knowledge/`）：30 篇离线 Markdown，公开教程的知识
  点蒸馏——条目注明灵感来源并基于官方文档重写，不逐字搬运原创内容。
- **语料版本指纹与过期提示**：`resources/knowledge/manifest.json` 记录每个文件
  的 sha256、整体指纹、语料版本与登记日期；运行时扫描比对，设置页「AI」区展示
  状态（一致 / 有不一致 / 未登记 / 超过 180 天可能过期）。语料增减或改动后
  **自动重写指纹**（资源目录只读时退回如实报告不一致）。发布前也可手动执行
  `npm run kb:manifest` 刷新。
- **`kb_search` 检索**：离线嵌入（bge-small-zh，经 @xenova/transformers）
  + 词面融合重排（0.7 余弦相似度 + 0.3 关键词得分）；候选扩取后重排再截断
  top-k，嵌入不可用（未联网且未预拉模型）时降级为纯词面排序。
- **Agent 记忆**：`agent_memory_*` 工具提供跨会话便签；`project_facts_write`
  让 Agent 把项目事实显式写回事实层，供后续轮次与档位使用。
- **联网**：`web_fetch` 预置抓取能力；联网检索由内置 fetch 类 MCP 补齐。

---

## 七、提供商与调用治理

- OpenAI 兼容协议（豆包、DeepSeek、通义、智谱、Moonshot 等）与本地 Ollama；
  用户自带 API Key，应用本身免费不限量；
- 对话超时下限 10 分钟，思考型模型长思维链不被误杀；
- 429 / 503 指数退避重试，`Retry-After` 响应头优先；
- 图像生成走 `/images/generations`（整图 / mask 局部重绘），模型由用户配置；
- `max_tokens` 按模型与窗口自适应（`reasoningBudget`）；
- 渲染层无直接出网能力，全部请求经主进程统一治理。

---

## 八、周边 AI 能力

- **CUE 补全**：Monaco 内联补全（FIM 协议），可注入仓库上下文；
- **AI 重绘**：整图 / 局部重绘 + 候选画廊，写回资产零额度复用；
- **桌宠（dsh-pet）**：以事件流跟进 AI 运行状态；
- **外部 Agent 集成**：设置页启用开关，供外部 CLI Agent 接管工作区
  （不做桌面快捷方式创建）；
- **观察者 Agent**：`kunyu-observer-agent` 开关仅放置在设置页，AI 助手仅
  显示自动消退的提示，聊天框内不放开关控件。

---

*—— kunyu (睏欤)*
