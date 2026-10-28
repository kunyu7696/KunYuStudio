/**
 * 工具元信息集中目录（P4）：可见性策略 + 超时策略 + 命名纪律（P6）。
 *
 * 背景：可见性谓词原本散落在各 fcTools 片段里各自写成闭包（hasProject /
 * hasFabricProject / isModpack / …），超时字面量也散落在各处，难以审计与统一。
 * P4 把这两类「工具元信息」收敛到本目录：
 *
 * - 可见性：片段只在工具对象上声明一个规则名（RegisteredTool.visibility），
 *   规则语义（谓词）集中在本文件的 resolveVisibility 里唯一维护。
 * - 超时：各工具声明的执行超时集中在 TOOL_TIMEOUTS，片段从目录读取而非写死。
 * - 命名纪律：三级行为注解目录 TOOL_BEHAVIORS 与反向路由
 *   目录 TOOL_ROUTING 集中在本文档维护，入库时由 toolRegistry.put() 统一渲染进
 *   description（annotateToolDescription），片段保持只写功能描述、不管纪律措辞。
 *
 * 说明：语义异构、依赖运行时服务状态的少数门控（如 mc_data_lookup 依赖
 * mcData.available()、按语料库区分的知识库工具）仍由片段自带 available 闭包，
 * 不强行塞进规则目录——单一属主：一个工具要么用 visibility 规则，要么用 available，
 * 二者不并存，避免两套语义互相覆盖。
 */
import type { ToolRegistryDeps } from '../toolRegistry'

/** 可见性规则名（集中目录维护；片段只引用名字） */
export type ToolVisibilityRule =
  /** 恒可见 */
  | 'always'
  /** 需打开项目（projectRoot 存在） */
  | 'project'
  /** 需 Fabric 项目：Forge/NeoForge（Mojmap）上不暴露 Yarn 写盘工具（P1-9） */
  | 'fabric-project'
  /** 写盘类市场工具仅整合包（modpack）项目暴露 */
  | 'modpack'
  /** 调度工具需注入 runGradle */
  | 'scheduler'
  /** 本地知识库工具需注入 kbRag 端口 */
  | 'kb-rag'
  /** 子代理委派需设置 ai.subAgentEnabled 开启（默认关，成本闸门） */
  | 'subagent'

/**
 * 把规则名解析为可见性谓词。
 * 无打开项目 / loader 或 type 缺失时的兜底语义与各片段原实现保持一致。
 */
export function resolveVisibility(
  rule: ToolVisibilityRule,
  deps: ToolRegistryDeps
): () => boolean {
  switch (rule) {
    case 'always':
      return () => true
    case 'project':
      return () => Boolean(deps.projectRoot?.())
    case 'fabric-project':
      return () => {
        if (!deps.projectRoot?.()) return false
        const loader = deps.projectLoader?.()
        // loader 未注入时保持旧行为（不门控），便于测试与只读场景
        return loader === undefined || loader === null || loader === 'fabric'
      }
    case 'modpack':
      return () => Boolean(deps.projectRoot?.()) && deps.projectType?.() === 'modpack'
    case 'scheduler':
      return () => deps.runGradle !== undefined
    case 'kb-rag':
      return () => !!deps.kbRag
    case 'subagent':
      return () => deps.subAgentEnabled?.() === true
  }
}

/** 各工具声明的执行超时（ms）——集中维护，片段从目录读取。 */
export const TOOL_TIMEOUTS = {
  /** gradle_build：真实 clean build 上限 */
  gradleBuild: 30 * 60 * 1000,
  /** run_game_test：无头 GameTest 默认超时 */
  gameTestDefault: 120_000,
  /** run_game_test：无头 GameTest 最小超时 */
  gameTestMin: 10_000,
  /** run_game_test：无头 GameTest 最大超时 */
  gameTestMax: 600_000,
  /** run_command：默认超时 */
  runCommandDefault: 60_000,
  /** run_command：最小超时 */
  runCommandMin: 5_000,
  /** run_command：最大超时 */
  runCommandMax: 600_000
} as const

/** run_game_test 超时参数夹取到目录声明的上下限内。 */
export function clampGameTestTimeout(ms?: number): number {
  const value = ms ?? TOOL_TIMEOUTS.gameTestDefault
  return Math.min(TOOL_TIMEOUTS.gameTestMax, Math.max(TOOL_TIMEOUTS.gameTestMin, value))
}

/** run_command 超时参数夹取到目录声明的上下限内。 */
export function clampRunCommandTimeout(ms?: number): number {
  const value = ms ?? TOOL_TIMEOUTS.runCommandDefault
  return Math.min(TOOL_TIMEOUTS.runCommandMax, Math.max(TOOL_TIMEOUTS.runCommandMin, value))
}

// ---------------------------------------------------------------------------
// 命名纪律
//
// 核心洞察：工具命名的价值不在前缀，而在「三级行为注解 + 含反向路由的
// description」。落到 KunYu：不改任何工具名、不加前缀，而是在入库时给每个工具的
// description 前置行为级标签（模型选工具时第一眼看到副作用级别）、末尾追加
// 「不适用→改用谁」的反向路由（把易混淆工具的分界写在选择点）。
// 两个目录与可见性规则同地维护；toolPolicy.spec.ts 做完整性/防漂移/引用真实性
// 三重交叉校验，新增工具漏登记即红。
// ---------------------------------------------------------------------------

/**
 * 三级行为注解：
 * - readonly：纯检索/校验/诊断/观察，不写盘、无项目外副作用
 * - project-write：写项目文件或语义资产（.kunyu/content、源码、资源、配置）
 * - external-effect：项目外副作用——联网请求、启动进程、操控运行中游戏、消耗云端额度
 * 同时具备多级能力的工具按最高级标注（如 mc_world 含 set_block 即标 external-effect）。
 */
export type ToolBehavior = 'readonly' | 'project-write' | 'external-effect'

/** 行为级中文标签（渲染在 description 开头） */
export const TOOL_BEHAVIOR_LABELS: Record<ToolBehavior, string> = {
  readonly: '只读',
  'project-write': '写项目盘',
  'external-effect': '外部副作用'
}

/** 行为级目录：工具名 → 三级行为。按域分组，与 fcTools 片段一一对应。 */
export const TOOL_BEHAVIORS: Record<string, ToolBehavior> = {
  // —— 只读检索（chatRetrievalTools）
  template_search: 'readonly',
  kb_search: 'readonly',
  mc_data_lookup: 'readonly',
  fabric_docs_search: 'readonly',
  mc_wiki_search: 'readonly',
  kubejs_docs_search: 'readonly',
  error_analyze: 'readonly',
  version_check: 'readonly',
  api_validate: 'readonly',
  project_grep: 'readonly',
  read_project_file: 'readonly',
  // —— 语义资产与文件（contentTools）
  content_list: 'readonly',
  texture_asset_search: 'readonly',
  content_read: 'readonly',
  model_validate: 'readonly',
  item_validate: 'readonly',
  content_upsert: 'project-write',
  write_project_file: 'project-write',
  project_facts_write: 'project-write',
  edit_project_file: 'project-write',
  texture_paint: 'project-write',
  texture_pixelize: 'project-write',
  // texture_repaint 消耗用户自带云端图像额度，按最高级标注
  texture_repaint: 'external-effect',
  // —— 配方（recipeTools）
  recipe_validate: 'readonly',
  recipe_create: 'project-write',
  recipe_generate: 'project-write',
  // —— Mixin（mixinTools）
  mixin_target_lookup: 'readonly',
  mixin_validate: 'readonly',
  mixin_scaffold: 'project-write',
  mixin_register: 'project-write',
  // —— 校验/诊断（validationTools）
  fabric_mod_json_validate: 'readonly',
  fabric_log_debugger: 'readonly',
  mc_test_scenario: 'external-effect',
  // —— Forge/NeoForge（forgeNeoTools）
  forge_mods_toml_validate: 'readonly',
  neoforge_mods_toml_validate: 'readonly',
  forge_meta_version_check: 'external-effect',
  neoforge_meta_version_check: 'external-effect',
  // —— Fabric（fabricTools）
  fabric_javadoc_lookup: 'readonly',
  fabric_meta_version_check: 'external-effect',
  fabric_template_generate: 'project-write',
  fabric_content_register: 'project-write',
  fabric_data_assets_generate: 'project-write',
  // —— 社区市场（marketTools）
  market_list_installed: 'readonly',
  modpack_dependency_audit: 'readonly',
  market_search_mods: 'external-effect',
  market_mod_detail: 'external-effect',
  // 下载 jar 走网络且写 run/mods，按最高级标注
  market_install_mod: 'external-effect',
  // —— 游戏控制（gameControlTools）：观察类只读，改动游戏/起进程 external-effect
  mc_state: 'readonly',
  mc_screenshot: 'readonly',
  mc_observe_entity: 'readonly',
  mc_inventory: 'readonly',
  mc_command: 'external-effect',
  mc_chat: 'external-effect',
  mc_world: 'external-effect',
  mc_input: 'external-effect',
  mc_ensure_test_world: 'external-effect',
  mc_cleanup_test_world: 'external-effect',
  run_game_test: 'external-effect',
  mc_launch: 'external-effect',
  // —— 调度与进度（schedulingTools / todoTools）
  gradle_build: 'external-effect',
  todo_write: 'readonly',
  // —— B1 联网检索（webTools）
  web_search: 'external-effect',
  web_fetch: 'external-effect',
  // —— B2 IDE 通用（ideTools）
  list_files: 'readonly',
  run_command: 'external-effect',
  // —— B3 Agent 地基（memoryTools）
  agent_memory_read: 'readonly',
  agent_memory_append: 'project-write',
  agent_memory_clear: 'project-write',
  // —— M1 多代理（subAgentTools）
  agent_delegate: 'external-effect',
  agent_delegate_batch: 'external-effect',
  // —— 反编译工作区（decompileTools）
  decompile_list_workspaces: 'readonly',
  decompile_search: 'readonly',
  decompile_read_file: 'readonly',
  // 下载 Vineflower + 起 Java 进程，按最高级标注
  decompile_start: 'external-effect',
  // —— 音效工坊（audioTools）
  audio_list_library: 'readonly',
  audio_register_event: 'project-write',
  audio_unregister_event: 'project-write',
  // —— FTB 任务书（ftbTools）
  ftb_list_chapters: 'readonly',
  ftb_read_chapter: 'readonly',
  ftb_save_chapter: 'project-write',
  // —— Patchouli 手册（patchouliTools）
  patchouli_list_books: 'readonly',
  patchouli_read_book: 'readonly',
  patchouli_save_book: 'project-write',
  // —— KubeJS 脚本（kubejsTools）
  kubejs_list_scripts: 'readonly',
  kubejs_read_script: 'readonly',
  kubejs_list_templates: 'readonly',
  kubejs_write_script: 'project-write',
  kubejs_apply_template: 'project-write'
}

/**
 * 反向路由目录：工具名 → 「什么时候别用我、该改用谁」。
 * 渲染为 description 末尾的「不适用：…」一句。引用的工具名必须真实存在于注册表
 * （spec 提取全部含下划线的标识符逐一校验），写错名字即红。
 */
export const TOOL_ROUTING: Record<string, string> = {
  template_search: '搜用户项目文件→project_grep；查原版注册名/数值→mc_data_lookup',
  kb_search: '核对用户工程现状→project_grep；查原版 ID/数值→mc_data_lookup',
  mc_data_lookup: '查模组 API 类/方法签名→fabric_javadoc_lookup；查 Mixin 注入目标→mixin_target_lookup',
  fabric_docs_search: '查 Yarn 类/方法签名→fabric_javadoc_lookup；原版机制术语→mc_wiki_search；Mixin 注入目标→mixin_target_lookup',
  mc_wiki_search: '查注册名与数值→mc_data_lookup；Fabric API 用法→fabric_docs_search / fabric_javadoc_lookup',
  kubejs_docs_search: '本地库未覆盖的 KubeJS 主题→web_search/web_fetch 查官方 wiki；原版机制→mc_wiki_search',
  error_analyze: '游戏运行崩溃或 latest.log 诊断→fabric_log_debugger',
  version_check:
    '查最新 loader 版本号→fabric_meta_version_check / forge_meta_version_check / neoforge_meta_version_check',
  api_validate: '校验语义资产 JSON→item_validate / model_validate；校验配方→recipe_validate',
  project_grep: '读单个文件全文→read_project_file；搜内置参考包→kb_search / template_search',
  read_project_file: '跨文件找符号/注册名→project_grep；读语义资产→content_read',
  content_list: '读单个资产完整 JSON→content_read',
  texture_asset_search: '生成新贴图→texture_paint / texture_repaint；像素化参考图→texture_pixelize',
  content_read: '读源码/资源文件→read_project_file；列全部资产→content_list',
  content_upsert: '写自定义行为类/BlockEntity/Mixin→write_project_file；改既有源码→edit_project_file',
  write_project_file: '新增/修改方块/物品/实体/模型→content_upsert；改既有文件→edit_project_file',
  project_facts_write: '事实槽自动注入每轮 system 头部，无需主动读；写普通文件→write_project_file；叙述性约定→agent_memory_append',
  edit_project_file: '新建文件或整体重写→write_project_file；改语义资产→content_upsert',
  texture_paint: '照用户参考图做贴图→texture_pixelize；按文字描述 AI 重绘→texture_repaint',
  texture_pixelize: '无参考图从零生成→texture_paint；按文字改画→texture_repaint',
  texture_repaint: '未配置图像 Key 或要离线生成→texture_paint；仅像素化已有参考图→texture_pixelize',
  model_validate: '校验物品语义→item_validate',
  item_validate: '校验 Cube 模型→model_validate',
  recipe_validate: '自然语言生成配方→recipe_generate；确认后落盘→recipe_create',
  recipe_create: '原料是中文口语名需先组装语义→recipe_generate；只校验不落盘→recipe_validate',
  recipe_generate: '语义配方已手写好只需落盘→recipe_create；只预览不落盘→recipe_validate',
  mixin_target_lookup: '查普通 Yarn 类/方法（非注入目标）→fabric_javadoc_lookup',
  mixin_scaffold: '已写好 Mixin 类要注册→mixin_register；查注入点→mixin_target_lookup',
  mixin_register: 'Mixin 类还没生成→mixin_scaffold',
  mixin_validate: '运行期注入失败崩溃诊断→fabric_log_debugger',
  fabric_mod_json_validate: 'Forge/NeoForge 描述符→forge_mods_toml_validate / neoforge_mods_toml_validate',
  fabric_log_debugger: 'Gradle 构建失败日志→error_analyze',
  mc_test_scenario: '无头回归测试（不起客户端）→run_game_test',
  forge_mods_toml_validate: 'Fabric 项目→fabric_mod_json_validate',
  neoforge_mods_toml_validate: 'Fabric 项目→fabric_mod_json_validate',
  forge_meta_version_check: 'Fabric loader 版本→fabric_meta_version_check；NeoForge→neoforge_meta_version_check',
  neoforge_meta_version_check: 'Fabric loader 版本→fabric_meta_version_check；Forge→forge_meta_version_check',
  fabric_meta_version_check: 'Forge/NeoForge 版本→forge_meta_version_check / neoforge_meta_version_check',
  fabric_javadoc_lookup: '查 Mixin 注入目标→mixin_target_lookup；查原版注册名→mc_data_lookup',
  fabric_template_generate: '新增方块/物品/实体等内容对象→content_upsert（模板仅用于骨架类）',
  fabric_content_register: '新增内容对象→content_upsert（注册类由生成链产出，勿手写）',
  fabric_data_assets_generate: '内容对象的 blockstate/模型/语言→content_upsert 生成链；配方→recipe_create',
  market_search_mods: '核对已装清单→market_list_installed；审计依赖→modpack_dependency_audit',
  market_mod_detail: '已选定版本要安装→market_install_mod',
  market_install_mod: '未核对版本/loader 先查→market_mod_detail；查已装→market_list_installed',
  market_list_installed: '搜新模组→market_search_mods；依赖冲突审计→modpack_dependency_audit',
  modpack_dependency_audit: '缺前置要安装→market_search_mods → market_install_mod',
  mc_state: '要看画面截图→mc_screenshot；只看背包→mc_inventory',
  mc_screenshot: '要结构化现场数据（坐标/生命/实体）→mc_state',
  mc_command: '发聊天消息→mc_chat；多步场景断言→mc_test_scenario',
  mc_chat: '执行指令（以 / 开头）→mc_command',
  mc_world: '批量场景执行加断言→mc_test_scenario',
  mc_observe_entity: '观察玩家自身状态→mc_state；持续行为断言→mc_test_scenario',
  mc_inventory: '给玩家物品→mc_command；看周围实体→mc_observe_entity',
  mc_input: '能用指令完成的操作→mc_command（更可靠）',
  mc_ensure_test_world: '测试收尾清理→mc_cleanup_test_world',
  mc_cleanup_test_world: '布置测试前置→mc_ensure_test_world',
  run_game_test: '交互式/探索性验证（需起客户端）→mc_test_scenario / mc_launch',
  mc_launch: '构建验证（不起客户端）→gradle_build；无头测试→run_game_test',
  gradle_build: '无头 GameTest→run_game_test',
  todo_write: '单步任务无需清单；写项目文件→write_project_file',
  web_fetch: '本地参考包/知识库能回答的→kb_search / template_search；查社区模组→market_search_mods',
  web_search: '已知精确 URL 直接抓→web_fetch；本地语料能答的→kb_search / kubejs_docs_search',
  list_files: '按内容搜符号/注册名→project_grep；读单个文件→read_project_file',
  run_command: '构建模组→gradle_build（编排调度更稳）；起客户端→mc_launch；无头测试→run_game_test',
  agent_memory_read: '写入新记忆→agent_memory_append',
  agent_memory_append: '先看已有记忆避免重复→agent_memory_read；记忆大面积过期→agent_memory_clear',
  agent_memory_clear: '只想补充一条→agent_memory_append',
  agent_delegate: '简单问题直接答；单页联网→web_fetch；本地检索→kb_search/template_search',
  agent_delegate_batch: '单个任务→agent_delegate；任务间有依赖→串行 agent_delegate',
  decompile_list_workspaces: '按类名找→decompile_search；反编译新 jar→decompile_start',
  decompile_search: '读命中文件→decompile_read_file；先拿工作区列表→decompile_list_workspaces',
  decompile_read_file: '不知路径先搜→decompile_search；读项目内源码→read_project_file',
  decompile_start: '已反编译过直接看产物→decompile_list_workspaces；只查 Yarn 类签名→fabric_javadoc_lookup',
  audio_list_library: '注册音效事件→audio_register_event；列语义资产→content_list',
  audio_register_event: '先确认音效文件与既有事件→audio_list_library；撤销注册→audio_unregister_event',
  audio_unregister_event: '改事件定义→audio_register_event；先看引用关系→audio_list_library',
  ftb_list_chapters: '读章节任务明细→ftb_read_chapter',
  ftb_read_chapter: '先看章节列表→ftb_list_chapters；改章节→ftb_save_chapter',
  ftb_save_chapter: '只读章节→ftb_read_chapter',
  patchouli_list_books: '读整本手册→patchouli_read_book',
  patchouli_read_book: '先看手册列表→patchouli_list_books；写入手册→patchouli_save_book',
  patchouli_save_book: '只读手册→patchouli_read_book',
  kubejs_list_scripts: '读单个脚本→kubejs_read_script；查事件 API 用法→kubejs_docs_search',
  kubejs_read_script: '列全部脚本→kubejs_list_scripts；改脚本→kubejs_write_script',
  kubejs_list_templates: '落盘模板→kubejs_apply_template；看已有脚本→kubejs_list_scripts',
  kubejs_write_script: '从内置骨架起步→kubejs_apply_template；只读→kubejs_read_script',
  kubejs_apply_template: '目标已存在会拒绝，自定义内容或覆盖→kubejs_write_script'
}

/**
 * 把命名纪律注解渲染进工具 description：行为级标签前置 + 反向路由后置。
 * 未登记的工具（外部 MCP 桥接等）原样返回。由 toolRegistry.put() 统一调用，
 * 片段不写纪律措辞。
 */
export function annotateToolDescription(name: string, description: string): string {
  const behavior = TOOL_BEHAVIORS[name]
  const routing = TOOL_ROUTING[name]
  let out = description
  if (routing) out += ` 不适用：${routing}。`
  return behavior ? `【${TOOL_BEHAVIOR_LABELS[behavior]}】${out}` : out
}
