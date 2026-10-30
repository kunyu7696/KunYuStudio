/**
 * IPC 通道名统一约定：领域:动作（参见设计文档 9.2.2）
 * 新增通道时在此集中维护，主进程 handle 与 preload 白名单保持一致。
 */
export const IpcChannels = {
  APP_GET_VERSION: 'app:get-version',
  APP_GET_PLATFORM: 'app:get-platform',
  // 应用自更新（electron-updater；GitHub Releases 主源 + 镜像兜底，下载需用户确认）
  UPDATE_GET_STATE: 'update:get-state',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  // 主进程推送：更新状态机变化（UpdateState）
  UPDATE_STATE_CHANGED: 'update:state-changed',
  // 写盘自检探针：渲染层启动时调用，主进程试写 userData 探针文件，
  // 失败说明当前环境禁止写盘（EDR/只读盘），顶部横幅提示
  APP_WRITE_PROBE: 'app:write-probe',
  // 无边框窗口控制（frame:false 下由渲染层 TopBar 触发）
  WIN_MINIMIZE: 'win:minimize',
  WIN_TOGGLE_MAXIMIZE: 'win:toggle-maximize',
  WIN_CLOSE: 'win:close',
  WIN_IS_MAXIMIZED: 'win:is-maximized',
  // 主进程推送：最大化状态变化（渲染层同步 ▢/❐ 图标）
  WIN_MAXIMIZED_CHANGED: 'win:maximized-changed',
  // 设置（M6）
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_SET: 'settings:set',
  // 密钥加密可用性（safeStorage 不可用时渲染层横幅提示「密钥明文落盘」降级）
  SETTINGS_CRYPTO_STATUS: 'settings:crypto-status',
  // 在系统浏览器打开外部链接（M6）
  SHELL_OPEN_EXTERNAL: 'shell:open-external',
  // 在系统文件管理器中定位并选中文件/文件夹
  SHELL_SHOW_ITEM_IN_FOLDER: 'shell:show-item-in-folder',
  PROJECT_LIST: 'project:list',
  PROJECT_CREATE: 'project:create',
  PROJECT_OPEN: 'project:open',
  PROJECT_DELETE: 'project:delete',
  PROJECT_IMPORT: 'project:import',
  PROJECT_RELOCATE: 'project:relocate',
  PROJECT_DERIVE_MOD_ID: 'project:derive-mod-id',
  DIALOG_SELECT_DIRECTORY: 'dialog:select-directory',
  DIALOG_SELECT_IMAGE: 'dialog:select-image',
  DIALOG_SELECT_FILE: 'dialog:select-file',
  // 文件系统（M3）
  FS_READ_DIR: 'fs:read-dir',
  FS_READ_FILE: 'fs:read-file',
  FS_READ_BINARY: 'fs:read-binary',
  FS_WRITE_FILE: 'fs:write-file',
  FS_CREATE: 'fs:create',
  FS_RENAME: 'fs:rename',
  FS_DELETE: 'fs:delete',
  FS_COPY: 'fs:copy',
  FS_MOVE: 'fs:move',
  FS_SEARCH: 'fs:search',
  FS_STAT: 'fs:stat',
  FS_WATCH_START: 'fs:watch-start',
  FS_WATCH_STOP: 'fs:watch-stop',
  FS_EVENT: 'fs:event',
  // 可视化编辑器内容资产（M4）
  CONTENT_LIST: 'content:list',
  CONTENT_LOAD: 'content:load',
  CONTENT_SAVE: 'content:save',
  CONTENT_DELETE: 'content:delete',
  CONTENT_SAVE_TEXTURE: 'content:save-texture',
  CONTENT_SAVE_TEXTURE_ASSET: 'content:save-texture-asset',
  CONTENT_GENERATE: 'content:generate',
  CONTENT_REVERSE_SYNC: 'content:reverse-sync',
  CONTENT_BBMODEL_IMPORT: 'content:bbmodel-import',
  CONTENT_BBMODEL_EXPORT: 'content:bbmodel-export',
  /** 建模工坊 B2：OBJ 体素化导入（弹文件框，主进程读 obj+mtl 并体素化） */
  CONTENT_OBJ_IMPORT: 'content:obj-import',
  /** 贴图工坊 AI 重绘（候选画廊 / mask 局部重绘），主进程代理用户自带 Key 的图像供应商 */
  CONTENT_TEXTURE_REPAINT: 'content:texture-repaint',
  /** 贴图工坊：用候选返回的 sourceToken 本地重跑像素化（改参数即时预览，不消耗 AI 额度） */
  CONTENT_TEXTURE_PIXELIZE: 'content:texture-pixelize',
  /** 贴图工坊：读取项目级色板锁定与像素化偏好（.kunyu/texture-palette.json） */
  CONTENT_TEXTURE_PALETTE_GET: 'content:texture-palette-get',
  /** 贴图工坊：合并写入项目级色板与像素化偏好，并回读返回最新值 */
  CONTENT_TEXTURE_PALETTE_SET: 'content:texture-palette-set',
  /** 贴图工坊：采用 AI 候选贴图写回 item/block/model 资产（聊天「产物」卡点选） */
  CONTENT_TEXTURE_APPLY_CANDIDATE: 'content:texture-apply-candidate',
  /** 画廊模型条目：把立方体模型写回目标对象（落独立模型资产 + 绑定 cubeModelId） */
  CONTENT_MODEL_APPLY_CANDIDATE: 'content:model-apply-candidate',
  /** 项目画廊：列出 AI 产出的全部贴图候选（.kunyu/gallery/，永不自动删除） */
  CONTENT_GALLERY_LIST: 'content:gallery-list',
  /** 项目画廊：把 AI 候选入库（AI 出图即存档，供零额度复用） */
  CONTENT_GALLERY_SAVE: 'content:gallery-save',
  /** 项目画廊：删除单项（仅用户手动触发） */
  CONTENT_GALLERY_DELETE: 'content:gallery-delete',
  /** 内容资源体检：语义层与工程产物引用一致性只读检查 */
  CONTENT_DOCTOR: 'content:doctor',
  // 模型工坊（独立建模器模块，P2）
  /** 模型工坊：弹文件框导入 PNG 为文档贴图（主进程解码校验 ≤512） */
  MODELER_TEXTURE_IMPORT: 'modeler:texture-import',
  /** 模型工坊：弹保存框把文档贴图导出为 PNG 文件 */
  MODELER_TEXTURE_EXPORT: 'modeler:texture-export',
  /** 模型工坊：显式保存文档（备份轮转 + 原子写 + 清自动保存） */
  MODELER_DOC_SAVE: 'modeler:doc-save',
  /** 模型工坊：写/清自动保存影子文件（<id>.autosave） */
  MODELER_DOC_AUTOSAVE: 'modeler:doc-autosave',
  /** 模型工坊：崩溃恢复信息（autosave 存在性与两侧 mtime） */
  MODELER_DOC_RECOVERY: 'modeler:doc-recovery',
  /** 模型工坊（P3-f）：把工坊文档（bedrock_entity/geckolib）导出 geo.json 并写回实体 renderer.geoJson */
  MODELER_APPLY_GEO_TO_ENTITY: 'modeler:apply-geo-to-entity',
  /** 模型工坊（P4）：弹文件框导入 .animation.json 合并进当前文档 */
  MODELER_ANIM_IMPORT: 'modeler:anim-import',
  /** 模型工坊（P4）：弹保存框把文档动画导出为 .animation.json 文件 */
  MODELER_ANIM_EXPORT: 'modeler:anim-export',
  /** 模型工坊（P5-open）：把工坊文档（java_block）导出 ModelAsset 并写回方块/物品/实体对象 */
  MODELER_APPLY_MODEL_TO_OBJECT: 'modeler:apply-model-to-object',
  /** 模型工坊（D1）：把已保存工坊文档直接编译落盘到资源包（产物落 assets/<modId>/） */
  MODELER_COMPILE_RESOURCE: 'modeler:compile-resource',
  /** 模型工坊（P5-bbmodel）：弹文件框导入 .bbmodel 为新的模型文档 */
  MODELER_BBMODEL_IMPORT: 'modeler:bbmodel-import',
  /** 模型工坊（P5-bbmodel）：弹保存框把当前文档导出为 .bbmodel 文件 */
  MODELER_BBMODEL_EXPORT: 'modeler:bbmodel-export',
  /** 模型工坊（P5-obj）：弹文件框导入 .obj（+同目录 .mtl）体素化为新的模型文档 */
  MODELER_OBJ_IMPORT: 'modeler:obj-import',
  /** 模型工坊（C5）：弹文件框导入 Collada .dae 为新模型文档（XML 解析在渲染层） */
  MODELER_DAE_IMPORT: 'modeler:dae-import',
  /** 模型工坊（C5）：弹文件框导入 ASCII FBX .fbx 为新模型文档（解析在渲染层） */
  MODELER_FBX_IMPORT: 'modeler:fbx-import',
  /** 模型工坊（C7）：弹文件框导入 glTF 2.0 .gltf 为新模型文档（解析在渲染层，嵌入式 base64 buffer） */
  MODELER_GLTF_IMPORT: 'modeler:gltf-import',
  /** 模型工坊（B5-1）：弹保存框把当前文档导出为 glTF 2.0（.gltf + .bin + PNG 贴图） */
  MODELER_GLTF_EXPORT: 'modeler:gltf-export',
  /** 模型工坊（C8）：弹保存框把当前文档导出为 OBJ .obj + .mtl 文本文件 */
  MODELER_OBJ_EXPORT: 'modeler:obj-export',
  /** 模型工坊（C9）：弹文件框导入 Bedrock geo.json（Entity / Block / GeckoLib 共用） */
  MODELER_BEDROCK_GEO_IMPORT: 'modeler:bedrock-geo-import',
  /** 模型工坊（C9）：弹保存框把当前文档导出为 Bedrock geo.json */
  MODELER_BEDROCK_GEO_EXPORT: 'modeler:bedrock-geo-export',
  /** 模型工坊（B5-2）：弹文件框导入 .animation_controllers.json 合并进当前文档 */
  MODELER_CTRL_IMPORT: 'modeler:ctrl-import',
  /** 模型工坊（B5-2）：弹保存框把当前文档动画控制器导出为 .animation_controllers.json */
  MODELER_CTRL_EXPORT: 'modeler:ctrl-export',
  /** 模型工坊（B5-3）：弹文件框导入 OptiFine .jem 整实体模型为新模型文档 */
  MODELER_JEM_IMPORT: 'modeler:jem-import',
  /** 模型工坊（B5-3）：弹保存框把当前文档导出为 OptiFine .jem 整实体模型 */
  MODELER_JEM_EXPORT: 'modeler:jem-export',
  /** 模型工坊（B5-3）：弹文件框导入 OptiFine .jpm 部件为新模型文档 */
  MODELER_JPM_IMPORT: 'modeler:jpm-import',
  /** 模型工坊（B5-3）：弹保存框把当前文档导出为 OptiFine .jpm 部件 */
  MODELER_JPM_EXPORT: 'modeler:jpm-export',
  /** 模型工坊（B5-4）：弹文件框导入 MC 皮肤 PNG（64×64/64×32）为新模型文档 */
  MODELER_SKIN_IMPORT: 'modeler:skin-import',
  /** 模型工坊（B5-4）：弹保存框把当前文档导出为 MC 皮肤 PNG */
  MODELER_SKIN_EXPORT: 'modeler:skin-export',
  // 构建与运行（M5）
  GRADLE_RUN: 'gradle:run',
  GRADLE_CANCEL: 'gradle:cancel',
  GRADLE_EVENT: 'gradle:event',
  JDK_DETECT: 'jdk:detect',
  /** 零配置运行环境 3a：应用内一键下载并安装 JDK（Adoptium API + 国内镜像重写） */
  JDK_PROVISION: 'jdk:provision',
  JDK_PROVISION_EVENT: 'jdk:provision-event',
  /** 零配置运行环境 3b：托管 MC 实例管理 + 运行时资产置备（BMCLAPI 等国内镜像） */
  MC_LIST_VERSIONS: 'mc:list-versions',
  MC_PROVISION: 'mc:provision',
  MC_PROVISION_EVENT: 'mc:provision-event',
  MC_LIST_INSTANCES: 'mc:list-instances',
  MC_DELETE_INSTANCE: 'mc:delete-instance',
  /** 零配置运行环境 3b：启动托管实例（拼装启动参数 + 解析 JDK + spawn java） */
  MC_LAUNCH_INSTANCE: 'mc:launch-instance',
  // 反编译工作区（Vineflower 运行时按需下载到 userData/tools，产物落 userData/decompiled 自管安全根）
  /** 工具就绪状态（不触发下载） */
  DECOMPILE_STATUS: 'decompile:status',
  /** 确保 Vineflower 就绪：缺失时按镜像设置下载（Maven Central / 阿里云） */
  DECOMPILE_ENSURE_TOOL: 'decompile:ensure-tool',
  /** 启动反编译任务（jarPath 为文件对话框选中的绝对路径）；进度经 decompile:event 推送 */
  DECOMPILE_START: 'decompile:start',
  /** 列出历史工作区（userData/decompiled 一级目录） */
  DECOMPILE_LIST_WORKSPACES: 'decompile:list-workspaces',
  /** 读工作区内目录（relDir 空串为根） */
  DECOMPILE_READ_DIR: 'decompile:read-dir',
  /** 读工作区内文本文件（超 2MB 截断） */
  DECOMPILE_READ_FILE: 'decompile:read-file',
  /** 按类名模糊搜索工作区内 .java（上限 200） */
  DECOMPILE_SEARCH: 'decompile:search',
  /** 删除整个工作区目录 */
  DECOMPILE_DELETE_WORKSPACE: 'decompile:delete-workspace',
  /** 主进程推送：反编译任务进度 */
  DECOMPILE_EVENT: 'decompile:event',
  // 音效工坊（FFmpeg 运行时按需下载到 userData/tools/ffmpeg，统一转 OGG Vorbis 44.1kHz）
  /** FFmpeg 就绪状态（不触发下载） */
  AUDIO_FFMPEG_STATUS: 'audio:ffmpeg-status',
  /** 确保 FFmpeg 就绪：缺失时按镜像设置下载（gyan.dev / BtbN）；进度经 audio:event 推送 */
  AUDIO_ENSURE_FFMPEG: 'audio:ensure-ffmpeg',
  /** 转码一份音源（渲染层 WAV 字节 / 本地路径）为 OGG 落盘 assets/<ns>/sounds/ */
  AUDIO_CONVERT: 'audio:convert',
  /** 声音库全貌：sounds 目录 .ogg 列表 + sounds.json 事件 */
  AUDIO_LIST: 'audio:list',
  /** 注册/更新 sounds.json 音效事件（同名覆盖） */
  AUDIO_REGISTER_EVENT: 'audio:register-event',
  /** 注销 sounds.json 音效事件 */
  AUDIO_UNREGISTER_EVENT: 'audio:unregister-event',
  /** 删除 .ogg 音效文件并摘除事件引用 */
  AUDIO_REMOVE_SOUND: 'audio:remove-sound',
  /** 读 .ogg 为 data URL（试听，上限 8MB） */
  AUDIO_READ_SOUND: 'audio:read-sound',
  /** 读用户经对话框选中的源音频/MIDI 字节（渲染层解析/预览用，上限 20MB） */
  AUDIO_READ_SOURCE: 'audio:read-source',
  /** 主进程推送：FFmpeg 下载 / 转码进度 */
  AUDIO_EVENT: 'audio:event',
  // FTB 任务书（config/ftbquests/quests/chapters/*.snbt 章节读写，SNBT 与生成器互逆）
  /** 章节摘要列表（无法解析的文件记入 warnings） */
  FTBQUEST_LIST: 'ftbquest:list',
  /** 读取单个章节（含任务明细） */
  FTBQUEST_READ: 'ftbquest:read',
  /** 保存章节（prevId 不同为重命名，删除旧文件） */
  FTBQUEST_SAVE: 'ftbquest:save',
  /** 删除章节文件 */
  FTBQUEST_DELETE: 'ftbquest:delete',
  // Patchouli 指南书（config/<namespace>/patchouli_books/<book>/ 直读直写，同步语义保存）
  /** 手册摘要列表 + 默认命名空间（模组项目=modId） */
  PATCHOULI_LIST: 'patchouli:list',
  /** 读整本手册（book.json + 类目树 + 条目页面） */
  PATCHOULI_READ: 'patchouli:read',
  /** 保存手册（移除不再存在的类目/条目文件；prev 不同为重命名/迁移） */
  PATCHOULI_SAVE: 'patchouli:save',
  /** 删除整本手册目录 */
  PATCHOULI_DELETE: 'patchouli:delete',
  // KubeJS 脚本（kubejs/{startup,server,client}_scripts/*.js 读写 + 内置模板库）
  /** 脚本列表（含不存在目录标记与读取警告） */
  KUBEJS_LIST: 'kubejs:list',
  /** 读脚本全文 */
  KUBEJS_READ: 'kubejs:read',
  /** 写脚本（自动创建目录） */
  KUBEJS_SAVE: 'kubejs:save',
  /** 删脚本文件 */
  KUBEJS_DELETE: 'kubejs:delete',
  /** 内置脚本模板库 */
  KUBEJS_TEMPLATES: 'kubejs:templates',
  /** 应用模板落盘为新脚本（目标已存在则拒绝） */
  KUBEJS_APPLY_TEMPLATE: 'kubejs:apply-template',
  // AI 助手（M6）：渲染进程不直接访问 AI 端点，一律经主进程代理
  AI_LIST_MODELS: 'ai:list-models',
  AI_TEST: 'ai:test',
  AI_CHAT: 'ai:chat',
  AI_CHAT_STREAM: 'ai:chat-stream',
  AI_CHAT_STOP: 'ai:chat-stop',
  AI_STREAM_EVENT: 'ai:stream-event',
  /** KunYuStudio 应用能力清单（AI 助手自我认知语料，main 读参考包 kunyu_capabilities.md） */
  AI_KUNYU_CAPABILITIES: 'ai:kunyu-capabilities',
  /** 知识库语料包状态：指纹一致性、登记版本、过期天数 */
  KNOWLEDGE_PACK_STATUS: 'knowledge:pack-status',
  /** kbRag 索引完整状态（知识库状态面板） */
  KB_RAG_STATUS: 'knowledge:rag-status',
  /** kbRag 索引重建（清缓存全量重编码，用户显式动作） */
  KB_RAG_REBUILD: 'knowledge:rag-rebuild',
  // M7：参考包 / 五 Agent 编排 / 版本漂移监测 / mcdev-mcp
  REF_GET_MANIFEST: 'ref:get-manifest',
  REF_GET_TEMPLATE: 'ref:get-template',
  AGENT_RUN: 'agent:run',
  /** 全流程 AI 制作：一次性需求拆解（规划概要 + AI 创意库），不进流水线 */
  AGENT_PLAN: 'agent:plan',
  AGENT_CANCEL: 'agent:cancel',
  AGENT_PAUSE: 'agent:pause',
  AGENT_RESUME: 'agent:resume',
  AGENT_EVENT: 'agent:event',
  /** 渲染层启动时查询主进程是否有活跃运行（T-1 幽灵任务接管） */
  AGENT_ACTIVE: 'agent:active',
  // Agent 任务图跨运行持久化：历史任务列表/详情/断点续跑/删除
  AGENT_HISTORY: 'agent:history',
  AGENT_HISTORY_DETAIL: 'agent:history-detail',
  AGENT_RESUME_RUN: 'agent:resume-run',
  AGENT_RUN_DELETE: 'agent:run-delete',
  /** 单项断言复验（证据链 #6）：对已完成运行的契约断言做单项重验，返回更新后的契约 artifact */
  AGENT_RECHECK_ASSERTION: 'agent:recheck-assertion',
  /** 手动导出产物（导出已从流水线分离）：基于任务事件流重建上下文，产出 export-result artifact */
  AGENT_EXPORT_NOW: 'agent:export-now',
  /** 资源替换局部重跑：只重生成单个贴图资产（AI 重绘回写 PNG），不重跑整个模组 */
  AGENT_REGENERATE_ASSET: 'agent:regenerate-asset',
  /** T2 对比视图：读取指定 run 中某文件的 run 前原文快照（found/original 三态见 Orchestrator） */
  AGENT_GET_FILE_SNAPSHOT: 'agent:get-file-snapshot',
  /** T2 单文件回滚：把指定 run 中某文件恢复到 run 前状态（modify 恢复原文；create 删文件） */
  AGENT_ROLLBACK_FILE: 'agent:rollback-file',
  // A3 离线模型预置流水线：清单+缓存状态查询 / 手动预取 / 下载进度事件
  MODELS_LIST: 'models:list',
  MODELS_PREFETCH: 'models:prefetch',
  MODEL_EVENT: 'aiRuntime:model-event',
  MONITOR_GET_STATE: 'monitor:get-state',
  MONITOR_CHECK: 'monitor:check',
  MONITOR_EVENT: 'monitor:event',
  PROBE_RUN: 'probe:run',
  MCP_GET_STATUS: 'mcp:get-status',
  MCP_SET_ENABLED: 'mcp:set-enabled',
  MCP_REFRESH: 'mcp:refresh',
  /** 测试一个开发者自定义的 MCP server（stdio 握手 + listTools，短连接 10s 内） */
  MCP_TEST_SERVER: 'mcp:test-server',
  /** 列出自定义 MCP server 的运行时状态 + 工具列表 */
  MCP_LIST_CUSTOM_TOOLS: 'mcp:list-custom-tools',
  /** 同步 settings 里的自定义 server 列表到主进程（增删连接） */
  MCP_SYNC_CUSTOM: 'mcp:sync-custom',
  /** 调用某个自定义 MCP server 的工具（持久连接） */
  MCP_CALL_CUSTOM_TOOL: 'mcp:call-custom-tool',
  /** kunyu-observer 内置探针：状态查询 / 注入当前项目 / 注入自定义 mods 目录 / 选择目录 */
  OBSERVER_GET_STATUS: 'observer:get-status',
  OBSERVER_INJECT_PROJECT: 'observer:inject-project',
  OBSERVER_INJECT_DIR: 'observer:inject-dir',
  OBSERVER_PICK_DIR: 'observer:pick-dir',
  // M9 模组市场与社区桥接
  MARKET_SEARCH: 'market:search',
  MARKET_GET_DETAIL: 'market:get-detail',
  MARKET_GET_VERSIONS: 'market:get-versions',
  MARKET_INSTALL: 'market:install',
  MARKET_TEST_CF: 'market:test-cf',
  // 用户级 Mod 库（整合包组装：存储社区模组，拖入 run/mods）
  MODLIB_LIST: 'modlib:list',
  MODLIB_DOWNLOAD: 'modlib:download',
  /** 取消当前进行中的 modlib 下载（AbortSignal 支持） */
  MODLIB_CANCEL_DOWNLOAD: 'modlib:cancel-download',
  /** 弹文件选择器（多选 jar）并导入库 */
  MODLIB_PICK_AND_IMPORT: 'modlib:pick-and-import',
  MODLIB_REMOVE: 'modlib:remove',
  /** 把库内资源加入整合包项目（按类型分流落盘；mod 含来源坐标记录） */
  MODLIB_ADD_TO_PROJECT: 'modlib:add-to-project',
  /** 列出项目 run/saves 下的世界目录名（数据包加入项目前选存档用） */
  MODLIB_LIST_WORLDS: 'modlib:list-worlds',
  /** 库根目录绝对路径（活动栏 Mod 库页展示「模组存在哪」） */
  MODLIB_ROOT: 'modlib:root',
  /** 在系统文件管理器中显示库内指定 jar */
  MODLIB_REVEAL: 'modlib:reveal',
  /** 补齐旧版条目的平台图标（返回是否有更新） */
  MODLIB_ENRICH_ICONS: 'modlib:enrich-icons',
  /** M16 en→zh 自动翻译（市场结果/社区页内文本批量翻译） */
  TRANSLATE_BATCH: 'translate:batch',
  /** M17 KunYu 创作社区：跨项目创作聚合 + .kyshare.json 分享包导出/导入 */
  KUNYU_LIST_CREATIONS: 'kunyu:list-creations',
  KUNYU_EXPORT_CREATION: 'kunyu:export-creation',
  KUNYU_IMPORT_CREATION: 'kunyu:import-creation',
  // M8 模组性能画像：排行榜查询与单画像详情
  PROFILE_LEADERBOARD: 'profile:leaderboard',
  PROFILE_GET: 'profile:get',
  PROFILE_APPLY_ACTIONS: 'profile:apply-actions',
  PROFILE_ANALYZE_DIRECTORY: 'profile:analyze-directory',
  PROFILE_IMPORT_JAR: 'profile:import-jar',
  PROFILE_IMPORT_JFR: 'profile:import-jfr',
  PROFILE_IMPORT_SPARK: 'profile:import-spark',
  // M10 游戏测试沙箱
  SANDBOX_RUN: 'sandbox:run',
  SANDBOX_CANCEL: 'sandbox:cancel',
  SANDBOX_EVENT: 'sandbox:event',
  // M11 启动器集成
  LAUNCHER_DETECT: 'launcher:detect',
  LAUNCHER_LIST_INSTANCES: 'launcher:list-instances',
  LAUNCHER_IMPORT: 'launcher:import',
  LAUNCHER_SET_ACTIVE: 'launcher:set-active',
  LAUNCHER_LAUNCH: 'launcher:launch',
  LAUNCHER_ADD: 'launcher:add',
  LAUNCHER_IMPORT_BATCH: 'launcher:import-batch',
  LAUNCHER_AUTO_INTEGRATE: 'launcher:auto-integrate',
  LAUNCHER_GET_STATE: 'launcher:get-state',
  LAUNCHER_EVENT: 'launcher:event',
  // 数据包编辑器（P0）
  DATAPACK_GET_META: 'datapack:get-meta',
  DATAPACK_INIT: 'datapack:init',
  DATAPACK_LIST_ENTRIES: 'datapack:list-entries',
  DATAPACK_READ_ENTRY: 'datapack:read-entry',
  DATAPACK_WRITE_ENTRY: 'datapack:write-entry',
  DATAPACK_DELETE_ENTRY: 'datapack:delete-entry',
  // 光影包编辑器（P0）
  SHADERPACK_GET_META: 'shaderpack:get-meta',
  SHADERPACK_INIT: 'shaderpack:init',
  SHADERPACK_LIST_FILES: 'shaderpack:list-files',
  SHADERPACK_READ_FILE: 'shaderpack:read-file',
  SHADERPACK_WRITE_FILE: 'shaderpack:write-file',
  SHADERPACK_DELETE_FILE: 'shaderpack:delete-file',
  SHADERPACK_EXPORT_ZIP: 'shaderpack:export-zip',
  // 资源包编辑器（P0）
  RESOURCEPACK_GET_META: 'resourcepack:get-meta',
  RESOURCEPACK_INIT: 'resourcepack:init',
  RESOURCEPACK_LIST_FILES: 'resourcepack:list-files',
  RESOURCEPACK_READ_FILE: 'resourcepack:read-file',
  RESOURCEPACK_WRITE_FILE: 'resourcepack:write-file',
  RESOURCEPACK_DELETE_FILE: 'resourcepack:delete-file',
  RESOURCEPACK_IMPORT_ICON: 'resourcepack:import-icon',
  RESOURCEPACK_WRITE_TEXTURE: 'resourcepack:write-texture',
  RESOURCEPACK_READ_TEXTURE: 'resourcepack:read-texture',
  RESOURCEPACK_EXPORT_ZIP: 'resourcepack:export-zip',
  RESOURCEPACK_IMPORT_SOUND: 'resourcepack:import-sound',
  RESOURCEPACK_READ_SOUND: 'resourcepack:read-sound',
  // 整合包真实组装（仅 type === 'modpack' 的项目）
  MODPACK_PREVIEW: 'modpack:preview',
  MODPACK_ASSEMBLE: 'modpack:assemble',
  MODPACK_LIST_SOURCES: 'modpack:list-sources',
  // P3-3 跨平台联动（CF↔MR 同模组映射 + 版本滞后/重复/缺失预警，手动触发）
  MODPACK_CROSS_LINK: 'modpack:cross-link',
  MODPACK_LAUNCH_TEST: 'modpack:launch-test',
  MODPACK_LIST_PACKS: 'modpack:list-packs',
  MODPACK_SET_PACK_ENABLED: 'modpack:set-pack-enabled',
  MODPACK_CREATE_PACK: 'modpack:create-pack',
  // 整合包发布（M18）：直发 Modrinth / CurseForge
  MODPACK_PUBLISH: 'modpack:publish',
  MODPACK_PUBLISH_PREFLIGHT: 'modpack:publish-preflight',
  // 特性⑤ CI/CD 集成（项目级 CI 配置 + 工作流导出）
  CI_GET_CONFIG: 'ci:get-config',
  CI_SET_CONFIG: 'ci:set-config',
  CI_PREVIEW: 'ci:preview',
  CI_EXPORT: 'ci:export',
  CI_REGENERATE: 'ci:regenerate',
  // 集成：外部 Agent CLI 检测 + KunYu 作为 MCP server 的桥接
  INTEGRATION_DETECT_AGENTS: 'integration:detect-agents',
  INTEGRATION_START_BRIDGE: 'integration:start-bridge',
  INTEGRATION_STOP_BRIDGE: 'integration:stop-bridge',
  INTEGRATION_GET_BRIDGE_STATUS: 'integration:get-bridge-status',
  /** 渲染层回传授权决定（主进程挂起的写工具调用据此放行/拒绝） */
  INTEGRATION_AUTH_RESPOND: 'integration:auth-respond',
  /** 主→渲染事件：外部 agent 请求执行写/敏感工具，等待用户手动授权 */
  INTEGRATION_AUTH_REQUEST: 'integration:auth-request',
  /** 渲染→主：把任务派发给外部 Agent CLI（Codex / Claude Code） */
  INTEGRATION_RUN_AGENT: 'integration:run-agent',
  /** 渲染→主：停止正在运行的外部 Agent 任务 */
  INTEGRATION_STOP_AGENT: 'integration:stop-agent',
  /** 主→渲染事件：外部 Agent 输出片段（stdout/stderr） */
  INTEGRATION_AGENT_CHUNK: 'integration:agent-chunk',
  /** 主→渲染事件：外部 Agent 进程结束（退出码/耗时） */
  INTEGRATION_AGENT_EXIT: 'integration:agent-exit',
  // 版本与产物（M14）
  VCS_GET_GIT_LOG: 'vcs:get-git-log',
  VCS_GET_GIT_STATUS: 'vcs:get-git-status',
  VCS_LIST_ARTIFACTS: 'vcs:list-artifacts',
  VCS_GET_STATUS_DETAIL: 'vcs:get-status-detail',
  VCS_STAGE_FILE: 'vcs:stage-file',
  VCS_UNSTAGE_FILE: 'vcs:unstage-file',
  VCS_STAGE_ALL: 'vcs:stage-all',
  VCS_COMMIT: 'vcs:commit',
  VCS_GET_DIFF: 'vcs:get-diff',
  VCS_BRANCH_LIST: 'vcs:branch-list',
  VCS_BRANCH_CHECKOUT: 'vcs:branch-checkout',
  VCS_BRANCH_CREATE: 'vcs:branch-create',
  VCS_BRANCH_DELETE: 'vcs:branch-delete',
  VCS_REMOTE_LIST: 'vcs:remote-list',
  VCS_INIT: 'vcs:init',
  VCS_REMOTE_ADD: 'vcs:remote-add',
  VCS_REMOTE_REMOVE: 'vcs:remote-remove',
  VCS_PUSH: 'vcs:push',
  VCS_PULL: 'vcs:pull',
  VCS_FETCH: 'vcs:fetch',
  VCS_COMMIT_DETAIL: 'vcs:commit-detail',
  VCS_TAG_LIST: 'vcs:tag-list',
  VCS_TAG_CREATE: 'vcs:tag-create',
  // 插件库与商城（M15）
  PLUGIN_LIST_MCP_SERVERS: 'plugin:list-mcp-servers',
  PLUGIN_TOGGLE_MCP: 'plugin:toggle-mcp',
  PLUGIN_TEST_MCP: 'plugin:test-mcp',
  PLUGIN_LIST_MARKET: 'plugin:list-market',
  PLUGIN_INSTALL_MARKET: 'plugin:install-market',
  // DSH（DeepSeek Harness）社区插件兼容宿主
  DSH_GET_STATE: 'dsh:get-state',
  DSH_INSTALL_PLUGIN: 'dsh:install-plugin',
  DSH_REMOVE_PLUGIN: 'dsh:remove-plugin',
  DSH_RELOAD: 'dsh:reload',
  /** 授权/撤销插件在主进程内运行（信任门控，绑定包内容指纹） */
  DSH_SET_TRUST: 'dsh:set-trust',
  // dsh-pet 桌宠（原装插件 + kunyu 宿主适配层）
  DSH_PET_START: 'dsh:pet-start',
  DSH_PET_STOP: 'dsh:pet-stop',
  DSH_PET_STATUS: 'dsh:pet-status',
  /** M4 Java 智能 import：项目源码类索引批量解析 */
  JAVA_RESOLVE_SYMBOLS: 'java:resolve-symbols',
  /** M3：仓库级上下文检索——从项目代码/知识库/模板取参考注入 FIM */
  AI_CUE_CONTEXT: 'ai:cue-context'
} as const

/**
 * 包编辑器布局模式：
 * - standalone：项目根即包根（资源包/数据包/光影包独立项目）
 * - embedded：模组项目内嵌（resourcepacks/、shaderpacks/、src/main/resources）
 */
export type PackLayoutMode = 'standalone' | 'embedded'

/** 贴图工坊 · 像素化参数（渲染层可覆盖的像素化子集；项目级色板锁定见 TexturePaletteDto） */
export interface TexturePixelizeOptions {
  maxColors?: number
  dither?: 'floyd' | 'none'
  outline?: boolean
  outlineFactor?: number
  downsample?: 'area' | 'nearest'
  alphaThreshold?: number
  /** 固定色板（"#rrggbb"）：锁定后跳过自动取色，超出色板的颜色被压到最近色 */
  palette?: string[]
}

/** AI 重绘请求：渲染进程只传当前贴图像素与自然语言需求，Key/供应商在主进程侧 */
export interface TextureRepaintRequest {
  /** 16（物品/方块）或 32（Cube 模型） */
  size: 16 | 32
  /** size*size 项语义像素（"" = 透明），作为重绘底稿 */
  pixels: string[]
  prompt: string
  /** 候选张数（画廊），默认 1，上限 10 */
  n?: number
  /** 局部重绘蒙版：size*size 项布尔，true=重绘该格；不传/全空=整图重绘 */
  maskFlags?: boolean[]
  /** 指定供应商 id；不传取首个启用且配了图像模型的供应商 */
  providerId?: string
  /** 像素化参数（透传给主进程 pixelize 管线；主进程白名单式校验） */
  pixelize?: TexturePixelizeOptions
}

export interface TextureRepaintVariantDto {
  /** size*size 项语义像素，可直接写回资产 */
  pixels: string[]
  /** PNG data URL，画廊缩略图用 */
  dataUrl: string
  palette: string[]
  ascii: string
  /** 该候选对应的 AI 大图在源头缓存里的 token（本地重跑像素化参数用；过期即无效） */
  sourceToken?: string
  revisedPrompt?: string
}

/** 本地重跑像素化请求：用已有候选的 sourceToken 回到 AI 大图重新像素化，不消耗 AI 额度 */
export interface TexturePixelizeRequest {
  /** 候选返回的源头大图 token（过期/未知 → config 错误） */
  sourceToken: string
  size: 16 | 32
  /** 本次重跑使用的像素化参数 */
  options?: TexturePixelizeOptions
}

/** 项目级色板锁定与像素化偏好（.kunyu/texture-palette.json 形状） */
export interface TexturePaletteDto {
  palette: string[]
  maxColors: number
  dither: 'floyd' | 'none'
  outline: boolean
  outlineFactor: number
  downsample: 'area' | 'nearest'
}

export type TextureRepaintResponse =
  | {
      ok: true
      size: 16 | 32
      /** 实际使用的图像模型名 */
      model: string
      variants: TextureRepaintVariantDto[]
      warnings: string[]
    }
  | { ok: false; errorKind: string; errorMessage: string }

/** 本地重跑响应：成功复用 repaint variant 形状，错误 kind 与 repaint 响应风格一致 */
export type TexturePixelizeResponse =
  | { ok: true; size: 16 | 32; variant: TextureRepaintVariantDto }
  | { ok: false; errorKind: 'config' | 'server'; errorMessage: string }

/**
 * 采用某个 AI 候选贴图写回资产（聊天「产物」卡里点选候选后调用）。
 * item 仅在 texture.path 为空时落 PNG（path 非空时像素不参与生成，回 pngWritten:false）。
 */
export type TextureApplyCandidateResponse =
  | { ok: true; relPath?: string; pngWritten: boolean; size: 16 | 32 }
  | { ok: false; errorMessage: string }

/** 模型来源引用：model = 独立模型资产；block/item/entity = 该对象内嵌的 Cube 模型 */
export interface ModelApplySourceRef {
  ownerKind: 'model' | 'block' | 'item' | 'entity'
  ownerId: string
}

/** 模型写回目标：仅这三类能承载 Cube 模型 */
export interface ModelApplyTargetRef {
  kind: 'block' | 'item' | 'entity'
  id: string
}

/**
 * 模型写回结果。
 * needsConfirm：目标实体现为 Blockbench 骨骼模型，写入会清空其骨骼几何，需用户确认后带 confirm=true 重试。
 */
export type ModelApplyResponse =
  | { ok: true; written: string[]; replacedGeo: boolean }
  | { ok: false; needsConfirm?: boolean; errorMessage: string }

/** 模型工坊（D1）：文档直接编译落盘到资源包的结果 */
export interface ModelerCompileResourceResult {
  ok: boolean
  files: string[]
  downgrades: Array<{ severity: 'warning' | 'info'; code: string; message: string; nodeId?: string }>
  errorMessage?: string
  modId?: string
}

/**
 * 项目画廊 · 单张画作（AI 出图即存档，永不自动删除）。
 * 落点：<projectRoot>/.kunyu/gallery/<id>.json（元数据 + 像素）+ <id>.png（缩略图）。
 * 与 .kunyu/texture-palette.json 同级，根级 .kunyu 不被内容扫描器扫到。
 */
export type GalleryAssetKind = 'item' | 'block' | 'model' | 'free'
/**
 * 画廊条目类别：
 * - texture = 一张贴图像素画（归档候选 / 项目已有像素资产）
 * - model = 一个 3D 模型（独立模型资产 / 对象内嵌 cubeModel / 实体骨骼模型），**缺省按 texture 读**
 */
export type GalleryEntryKind = 'texture' | 'model'

/** 模型类画廊条目的几何摘要（不内嵌 elements / geoJson 原文，防列表膨胀；几何在预览/导出时按需 content.load） */
export interface GalleryModelInfo {
  /** cube = 立方体元素模型（CubeElement）；blockbench = Blockbench 骨骼模型（GeckoLib geo） */
  geometry: 'cube' | 'blockbench'
  /** 几何归属：model = 独立模型资产本身，其余 = 该内容对象的内嵌/绑定模型 */
  ownerKind: 'model' | 'block' | 'item' | 'entity'
  ownerId: string
  /** cube 几何的贴图画布边长；blockbench 条目无像素贴图画布，固定占位 16 */
  textureSize: 16 | 32
  /** cube 几何的元素数量 */
  elementCount: number
  /** blockbench 几何的骨骼数量 */
  boneCount?: number
  /** 建模器模板标记（独立模型资产自带） */
  template?: string
  /** 该对象绑定的独立模型资产 id（镜像约定：cubeModelId === 自身 id） */
  boundModelId?: string | null
}
/**
 * 画廊条目来源：
 * - agent = AI 助手工具产出（会话内新出图即存档）
 * - workshop = 贴图工坊弹窗产出
 * - project = 项目里已经存在的像素资产（读时虚拟汇总，不落盘、不入库）
 */
export type GalleryOrigin = 'agent' | 'workshop' | 'project'
/** 入库来源：仅 AI 产出可写入画廊归档（项目资产是读时汇总，不参与入库） */
export type GallerySaveOrigin = 'agent' | 'workshop'

export interface GalleryItemDto {
  id: string
  /** ISO 时间戳，画廊按此倒序 */
  createdAt: string
  /** 条目类别；缺省（undefined）= 'texture'（旧归档只有贴图） */
  entryKind?: GalleryEntryKind
  /** entryKind='model' 时的几何摘要 */
  model?: GalleryModelInfo
  /** 绑定的资产；free = 未绑定（如实体贴图、随手生成的画） */
  assetKind: GalleryAssetKind
  assetId: string
  /** 贴图画布边长；model 条目为 16/32 占位（骨骼模型无贴图画布时固定 16） */
  size: 16 | 32
  /** 生成时的需求描述 */
  prompt: string
  /** 实际使用的图像模型名 */
  provider?: string
  /** 来源：agent=AI 助手工具产出，workshop=贴图工坊弹窗产出 */
  origin: GalleryOrigin
  /** 已自动写回的候选序号（1-based，仅 agent 首张） */
  appliedIndex?: number
  palette: string[]
  /** size*size 项语义像素（"" = 透明），可直接写回资产；model 条目在没有像素贴图时为 [] */
  pixels: string[]
  /** 缩略图 PNG 的本机绝对路径（渲染层转 file:// 显示） */
  pngPath: string
}

/** 入库入参（pngPath 由主进程落盘后回填，调用方不必提供） */
export interface GallerySaveInputDto {
  assetKind: GalleryAssetKind
  assetId: string
  size: 16 | 32
  prompt: string
  provider?: string
  origin: GallerySaveOrigin
  appliedIndex?: number
  palette: string[]
  pixels: string[]
}

/** 模型工坊：PNG 贴图导入结果（canceled=true 表示用户取消对话框） */
export interface ModelerTextureImportResult {
  canceled: boolean
  /** 文件名去扩展名（作为贴图默认名） */
  name?: string
  width?: number
  height?: number
  /** 原图 data URL（文档贴图 data 字段直存） */
  dataUrl?: string
  error?: string
}

/** 模型工坊：PNG 贴图导出入参 */
export interface ModelerTextureExportInput {
  /** 建议文件名（主进程清洗后作为 defaultPath） */
  name: string
  /** 贴图 data URL */
  dataUrl: string
}

/** 模型工坊：PNG 贴图导出结果 */
export interface ModelerTextureExportResult {
  canceled: boolean
  path?: string
  bytes?: number
  error?: string
}

/** 模型工坊：崩溃恢复信息（autosave 比主文件新 = 有未保存修改的恢复线索） */
export interface ModelerDocRecoveryInfo {
  hasAutosave: boolean
  autosaveMtime: number | null
  docMtime: number | null
}

/** 模型工坊：.animation.json 导入结果（canceled=true 表示用户取消对话框） */
export interface ModelerAnimImportResult {
  canceled: boolean
  /** 文件名去扩展名 */
  name?: string
  /** 文件 JSON 原文（编解码在渲染层 shared codec 完成，主进程只做读取） */
  content?: string
  error?: string
}

/** 模型工坊：.animation.json 导出入参 */
export interface ModelerAnimExportInput {
  /** 建议文件名（主进程清洗后作为 defaultPath） */
  name: string
  /** 动画文件 JSON 文本（渲染层 documentToAnimations 产物序列化） */
  content: string
}

/** 模型工坊：.animation.json 导出结果 */
export interface ModelerAnimExportResult {
  canceled: boolean
  path?: string
  bytes?: number
  error?: string
  /** （仅 bbmodel 导出）随格式落地物化的独立 PNG 贴图数 */
  texturesWritten?: number
  /** （仅 bbmodel 导出）贴图物化告警（路径越界/写盘失败等，逐条不中断） */
  warnings?: string[]
}

/** 模型工坊：.bbmodel 导入结果（canceled=true 表示用户取消对话框） */
export interface ModelerBbmodelImportResult {
  canceled: boolean
  /** 文件名去扩展名 */
  name?: string
  /** 文件 JSON 原文（编解码在渲染层 shared codec 完成；外链贴图已由主进程解引用为内嵌） */
  content?: string
  /** 外链贴图读取告警（读不到的外部 PNG 已用空白贴图替代） */
  warnings?: string[]
  error?: string
}

/** 模型工坊：.bbmodel 导出入参 */
export interface ModelerBbmodelExportInput {
  /** 建议文件名（主进程清洗后作为 defaultPath） */
  name: string
  /** bbmodel 文件 JSON 文本（渲染层 documentToBbmodel 产物序列化） */
  content: string
  /** 带独立 PNG 引用的贴图（主进程在 .bbmodel 落盘后把 PNG 物化到引用路径） */
  textures?: Array<{ file: string; data: string; name: string }>
}

/** 模型工坊：glTF 2.0 导出入参（B5-1） */
export interface ModelerGltfExportInput {
  /** 建议文件名（主进程清洗后作为 defaultPath） */
  name: string
  /** gltf JSON 文本（渲染层 documentToGltf 产物序列化；buffers[0].uri 由主进程回填） */
  gltf: string
  /** BIN 缓冲（单 buffer 全量字节） */
  bin: Uint8Array
  /** 随 .gltf 落盘的贴图（name = 文件名含 .png；data = data:image/png;base64,...） */
  images?: Array<{ name: string; data: string }>
}

/** 模型工坊：OBJ 导出入参（C8）——纯文本，落盘 .obj + 同目录 model.mtl */
export interface ModelerObjExportInput {
  /** 建议文件名（主进程清洗后作为 defaultPath 的 .obj 名） */
  name: string
  /** .obj 几何文件原文（渲染层 documentToObj 产物） */
  obj: string
  /** .mtl 材质文件原文（渲染层 documentToObj 产物） */
  mtl: string
}
export interface ModelerObjImportResult {
  canceled: boolean
  /** 文件名去扩展名 */
  name?: string
  /** .obj 文件原文（体素化在渲染层 shared codec 完成，主进程只做读取） */
  content?: string
  /** 同目录 .mtl 文件原文（找不到时不带此字段，走兜底色） */
  mtlContent?: string
  error?: string
}

/** 模型工坊：文本网格模型（Collada .dae / ASCII FBX .fbx）导入结果（C5） */
export interface ModelerTextModelImportResult {
  canceled: boolean
  /** 文件名去扩展名 */
  name?: string
  /** 文件原文（解析与文档组装在渲染层 shared codec 完成，主进程只做读取） */
  content?: string
  error?: string
}

/** 模型工坊：MC 皮肤 PNG 导入结果（B5-4，canceled=true 表示用户取消对话框） */
export interface ModelerSkinImportResult {
  canceled: boolean
  /** 文件名去扩展名 */
  name?: string
  width?: number
  height?: number
  /** 行优先语义像素串（'' = 透明；文档组装由渲染层 codec 完成） */
  pixels?: string[]
  error?: string
}

/** 模型工坊：MC 皮肤导出入参（B5-4） */
export interface ModelerSkinExportInput {
  /** 建议文件名（主进程清洗后作为 defaultPath） */
  name: string
  width: number
  height: number
  /** 行优先语义像素串（渲染层 documentToSkin 产物） */
  pixels: string[]
}

/** 模型工坊：MC 皮肤导出结果（B5-4） */
export interface ModelerSkinExportResult {
  canceled: boolean
  path?: string
  bytes?: number
  error?: string
}

/**
 * 通过 contextBridge 暴露给渲染进程的安全 API 契约。
 * 渲染进程只允许访问此接口，不直接接触 Node API。
 */
/** 内置 observer 探针状态（OBSERVER_GET_STATUS 返回） */
export interface ObserverStatusDto {
  available: boolean
  fileName: string | null
  version: string | null
  jarPath: string | null
  size: number | null
  /** 当前项目 run/mods 是否已装同版本 jar */
  injected: boolean
  /** 当前项目推导的 mods 目录（无项目时 null） */
  modsDir: string | null
}

/** observer 注入操作结果（OBSERVER_INJECT_* 返回） */
export interface ObserverInjectDto {
  ok: boolean
  sourcePath?: string
  targetPath?: string
  modsDir?: string
  warning?: string
  error?: string
  reason?: string
}

export interface IpcApi {
  app: {
    /** 读取应用版本号（package.json#version） */
    getVersion(): Promise<string>
    /** 读取当前操作系统平台（process.platform） */
    getPlatform(): Promise<string>
    /** 写盘自检探针：试写 userData，失败说明环境禁止写盘 */
    writeProbe(): Promise<{ ok: boolean; path: string; error?: string }>
  }
  /** 应用自更新（GitHub Releases 主源 + 国内镜像兜底；下载与安装均需用户确认） */
  update: {
    /** 读取当前更新状态机快照 */
    getState(): Promise<import('./update').UpdateState>
    /** 手动检查更新（状态经 update:state-changed 推送） */
    check(): Promise<import('./update').UpdateState>
    /** 确认下载已发现的新版本 */
    download(): Promise<import('./update').UpdateState>
    /** 重启并安装已下载的更新（NSIS 向导） */
    install(): Promise<void>
    /** 订阅更新状态推送；返回退订函数 */
    onStateChanged(listener: (state: import('./update').UpdateState) => void): () => void
  }
  /** 无边框窗口控制 */
  win: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
  }
  project: {
    list(): Promise<import('./project').Project[]>
    create(input: import('./project').CreateProjectInput): Promise<import('./project').Project>
    open(id: string): Promise<import('./project').Project | undefined>
    delete(id: string, deleteFiles: boolean): Promise<boolean>
    import(path: string): Promise<import('./project').Project>
    /**
     * 重新定位：目录被移动/改名后把记录指向新路径。
     * 新路径由主进程弹 OS 对话框选取并拒绝系统目录，不信任渲染层传入的 path；
     * 用户在对话框取消返回 undefined。
     */
    relocate(id: string): Promise<import('./project').Project | undefined>
    deriveModId(name: string): Promise<string>
  }
  dialog: {
    selectDirectory(): Promise<string | undefined>
    /** 选择 PNG 贴图文件 */
    selectImage(): Promise<string | undefined>
    /** 按扩展名过滤选择单个文件（人工导入 jar / .jfr / spark 报告） */
    selectFile(input: {
      title: string
      extensions: string[]
    }): Promise<string | undefined>
  }
  fs: {
    /** 读取目录，返回子节点列表（已按名称排序、目录在前） */
    readDir(path: string): Promise<import('./fs').FileNode[]>
    /** 读取文本文件内容 */
    readFile(path: string): Promise<import('./fs').FileContent>
    /** 读取二进制文件（图片预览等，base64 返回；超过 20MB 拒绝） */
    readBinary(path: string): Promise<import('./fs').BinaryFileContent>
    /** 写入文本文件内容 */
    writeFile(path: string, content: string): Promise<number>
    /** 新建文件或目录 */
    create(input: import('./fs').CreateFsEntryInput): Promise<import('./fs').FileNode>
    /** 重命名（同目录内移动） */
    rename(input: import('./fs').RenameFsEntryInput): Promise<string>
    /** 删除文件或目录（递归） */
    delete(path: string): Promise<boolean>
    /** 复制文件或目录 */
    copy(input: import('./fs').CopyFsEntryInput): Promise<string>
    /** 移动文件/目录到目标目录（跨目录 rename） */
    move(src: string, destDir: string): Promise<string>
    /** 按文件名模糊搜索（大小写不敏感，上限 200 条） */
    search(root: string, query: string): Promise<import('./fs').FileNode[]>
    /** 获取单个节点信息 */
    stat(path: string): Promise<import('./fs').FileNode | null>
    /** 启动对项目根目录的监听，变更通过 fs:event 推送 */
    watchStart(root: string): Promise<void>
    /** 停止监听 */
    watchStop(): Promise<void>
  }
  /** M4 Java 智能 import：主进程项目源码类索引 */
  java: {
    /**
     * 批量解析未 import 的简单类名；
     * 主进程 walk src/main/java 与 src/client/java，按 mtime 签名缓存索引。
     */
    resolveSymbols(
      input: import('./java').JavaResolveSymbolsRequest
    ): Promise<import('./java').JavaResolveSymbolsResult>
  }
  content: {
    /** 列出项目中可视化编辑的方块/物品 */
    list(root: string): Promise<import('./content').ContentSummary[]>
    /** 读取单个语义对象 */
    load(
      root: string,
      kind: import('./content').ContentKind,
      id: string
    ): Promise<import('./content').ContentDefinition>
    /** 保存语义对象；prevId 用于重命名场景 */
    save(
      root: string,
      def: import('./content').ContentDefinition,
      prevId?: string
    ): Promise<import('./content').ContentSummary>
    /** 删除语义对象 */
    remove(root: string, kind: import('./content').ContentKind, id: string): Promise<boolean>
    /** 保存模型像素画为 PNG（textures/model/<id>.png），返回资源相对路径 */
    saveTexture(
      root: string,
      modelId: string,
      pixels: string[],
      size: 16 | 32
    ): Promise<string>
    /** 材质编辑器导出：像素画写为 textures/<category>/<id>.png（支持非方形 GUI 画布） */
    saveTextureAsset(
      root: string,
      textureId: string,
      category: string,
      pixels: string[],
      width: number,
      height: number
    ): Promise<string>
    /**
     * 依据全部语义资产生成 Fabric 代码与资源。
     * overwritePaths 为用户在冲突对话框中确认覆盖的手改文件（相对项目根）。
     */
    generate(
      root: string,
      options?: import('./content').GenerateOptions
    ): Promise<import('./content').GenerateResult>
    /** 反向同步：解析 ModBlocks.java 手改属性回写方块语义 JSON，返回回写字段数 */
    reverseSync(root: string, id: string): Promise<number>
    /** 建模工坊：弹文件框导入 .bbmodel 为模型语义资产 */
    importBbmodel(
      root: string,
      explicitId?: string
    ): Promise<{ canceled: boolean; id?: string; warnings?: string[]; error?: string }>
    /** 建模工坊：弹文件框导出当前模型（传入 ModelAsset JSON）为 .bbmodel */
    exportBbmodel(
      root: string,
      model: import('./content').ModelAsset
    ): Promise<{ canceled: boolean; path?: string; bytes?: number; error?: string }>
    /** 建模工坊 B2：弹文件框导入 OBJ，体素化为模型语义资产（resolution 8..32） */
    importObj(
      root: string,
      id: string,
      resolution?: number
    ): Promise<{
      canceled: boolean
      model?: import('./content').ModelAsset
      warnings?: string[]
      mtlLoaded?: boolean
      error?: string
    }>
    /** 贴图工坊：AI 重绘（整图或 mask 局部），返回 n 个候选像素方案 */
    textureRepaint(
      request: TextureRepaintRequest
    ): Promise<TextureRepaintResponse>
    /** 贴图工坊：用候选 sourceToken 本地重跑像素化（改参数即时预览，不消耗 AI 额度） */
    texturePixelize(request: TexturePixelizeRequest): Promise<TexturePixelizeResponse>
    /** 贴图工坊：读取项目级色板锁定与像素化偏好 */
    texturePaletteGet(root: string): Promise<TexturePaletteDto>
    /** 贴图工坊：合并写入项目级色板与像素化偏好，返回最新值 */
    texturePaletteSet(root: string, patch: Partial<TexturePaletteDto>): Promise<TexturePaletteDto>
    /** 采用 AI 候选贴图写回 assets（聊天「产物」卡点选候选） */
    applyTextureCandidate(
      root: string,
      kind: 'item' | 'block' | 'model',
      id: string,
      pixels: string[],
      size: 16 | 32
    ): Promise<TextureApplyCandidateResponse>
    /**
     * 把画廊模型条目写回目标对象（来源可为其他项目：汇总模式跨项目复用）。
     * 目标实体现为 Blockbench 骨骼模型时返回 needsConfirm，用户确认后带 confirm=true 重试。
     */
    modelApplyCandidate(
      sourceRoot: string,
      source: ModelApplySourceRef,
      targetRoot: string,
      target: ModelApplyTargetRef,
      confirm?: boolean
    ): Promise<ModelApplyResponse>
    /** 项目画廊：列出 AI 产出的全部贴图候选（按 createdAt 倒序） */
    galleryList(root: string): Promise<GalleryItemDto[]>
    /** 项目画廊：把 AI 候选入库（返回实际落盘项，非法项被丢弃） */
    gallerySave(root: string, items: GallerySaveInputDto[]): Promise<GalleryItemDto[]>
    /** 项目画廊：删除单项 */
    galleryDelete(root: string, id: string): Promise<boolean>
    /** 内容资源体检：语义层与工程产物引用一致性只读检查 */
    doctor(root: string): Promise<import('./content').ContentDoctorReport>
  }
  /** 模型工坊（独立建模器模块）：PNG 贴图导入导出（文件对话框在主进程弹出） */
  modeler: {
    /** 弹文件框选 PNG，解码校验（≤512）后返回原图 data URL 与尺寸 */
    importTexturePng(root: string): Promise<ModelerTextureImportResult>
    /** 弹保存框，把贴图 data URL 落盘为 PNG 文件 */
    exportTexturePng(root: string, input: ModelerTextureExportInput): Promise<ModelerTextureExportResult>
    /**
     * 显式保存文档：旧版本备份轮转 + 原子写主文件 + 清自动保存（非法 id/写盘失败 reject）。
     * P1② 乐观锁：传 expectedRevision（编辑会话基线）时冲突抛 ModelerConflictError；
     * null 表示「我认为文档不存在」（新建首存），undefined 不校验（权威写入）。
     */
    saveDoc(
      root: string,
      id: string,
      content: string,
      expectedRevision?: string | null
    ): Promise<{ revision: string }>
    /** 写自动保存影子文件；content=null 删除（自动保存失败不致命，调用方自行兜底） */
    autosaveDoc(root: string, id: string, content: string | null): Promise<void>
    /** 崩溃恢复信息：autosave 存在性与两侧 mtime */
    checkDocRecovery(root: string, id: string): Promise<ModelerDocRecoveryInfo>
    /**
     * （P3-f）把工坊文档导出为 geo.json 写回实体 renderer.geoJson（modelType=blockbench_geo）。
     * 目标实体已有骨骼几何时返回 needsConfirm，确认后带 confirm=true 重试（覆盖前需二次确认）。
     */
    applyGeoToEntity(root: string, docId: string, entityId: string, confirm?: boolean): Promise<ModelApplyResponse>
    /** （P4）弹文件框选 .animation.json，返回 JSON 原文（合并进文档由渲染层 codec 完成） */
    importAnimations(root: string): Promise<ModelerAnimImportResult>
    /** （P4）弹保存框，把动画 JSON 文本落盘为 .animation.json 文件 */
    exportAnimations(root: string, input: ModelerAnimExportInput): Promise<ModelerAnimExportResult>
    /** （P5-bbmodel）弹文件框选 .bbmodel，返回 JSON 原文（整文档导入由渲染层 codec 完成） */
    importBbmodel(root: string): Promise<ModelerBbmodelImportResult>
    /** （P5-bbmodel）弹保存框，把 bbmodel JSON 文本落盘为 .bbmodel 文件 */
    exportBbmodel(root: string, input: ModelerBbmodelExportInput): Promise<ModelerAnimExportResult>
    /** （B5-1）弹保存框，把 glTF JSON + BIN 落盘为 .gltf/.bin 并物化 PNG 贴图 */
    exportGltf(root: string, input: ModelerGltfExportInput): Promise<ModelerAnimExportResult>
    /** （B5-2）弹文件框选 .animation_controllers.json，返回 JSON 原文（合并进文档由渲染层 codec 完成） */
    importController(root: string): Promise<ModelerAnimImportResult>
    /** （B5-2）弹保存框，把控制器 JSON 文本落盘为 .animation_controllers.json 文件 */
    exportController(root: string, input: ModelerAnimExportInput): Promise<ModelerAnimExportResult>
    /** （B5-3）弹文件框选 OptiFine .jem，返回 JSON 原文（整文档导入由渲染层 codec 完成） */
    importJem(root: string): Promise<ModelerAnimImportResult>
    /** （B5-3）弹保存框，把 OptiFine .jem 文本落盘 */
    exportJem(root: string, input: ModelerAnimExportInput): Promise<ModelerAnimExportResult>
    /** （B5-3）弹文件框选 OptiFine .jpm，返回 JSON 原文（整文档导入由渲染层 codec 完成） */
    importJpm(root: string): Promise<ModelerAnimImportResult>
    /** （B5-3）弹保存框，把 OptiFine .jpm 文本落盘 */
    exportJpm(root: string, input: ModelerAnimExportInput): Promise<ModelerAnimExportResult>
    /** （P5-obj）弹文件框选 .obj（自动带同目录 .mtl），返回原文（体素化由渲染层 codec 完成） */
    importObj(root: string): Promise<ModelerObjImportResult>
    /** （C8）弹保存框，把 OBJ .obj + .mtl 文本落盘为两个文件 */
    exportObj(root: string, input: ModelerObjExportInput): Promise<ModelerAnimExportResult>
    /** （C9）弹文件框选 Bedrock geo.json，返回 JSON 原文（Entity / Block / GeckoLib 共用） */
    importBedrockGeo(root: string): Promise<ModelerTextModelImportResult>
    /** （C9）弹保存框，把 Bedrock geo.json JSON 文本落盘 */
    exportBedrockGeo(root: string, input: { name: string; content: string }): Promise<ModelerAnimExportResult>
    /** （C5）弹文件框选 Collada .dae，返回 XML 原文（解析由渲染层 codec 完成） */
    importDae(root: string): Promise<ModelerTextModelImportResult>
    /** （C5）弹文件框选 ASCII FBX .fbx，返回原文（解析由渲染层 codec 完成） */
    importFbx(root: string): Promise<ModelerTextModelImportResult>
    /** （C7）弹文件框选 .gltf（glTF 2.0），返回 JSON 原文（解析由渲染层 codec 完成，支持嵌入式 base64 buffer） */
    importGltf(root: string): Promise<ModelerTextModelImportResult>
    /** （B5-4）弹文件框选 MC 皮肤 PNG（64×64/64×32），返回像素串（文档组装由渲染层 codec 完成） */
    importSkin(root: string): Promise<ModelerSkinImportResult>
    /** （B5-4）弹保存框把皮肤像素串落盘为 PNG 文件 */
    exportSkin(root: string, input: ModelerSkinExportInput): Promise<ModelerSkinExportResult>
    /**
     * （P5-open）把工坊 java_block 文档导出 ModelAsset 写回方块/物品/实体对象。
     * 复用画廊写回的不对称约束（方块只认 cubeModelId、物品/实体内嵌+绑定双写）；
     * 目标实体现为骨骼几何时返回 needsConfirm，确认后带 confirm=true 重试。
     */
    applyModelToObject(
      root: string,
      docId: string,
      targetKind: 'block' | 'item' | 'entity',
      targetId: string,
      confirm?: boolean
    ): Promise<ModelApplyResponse>
    /** （D1）把已保存工坊文档直接编译落盘到资源包（产物落 assets/<modId>/）。
     * 仅支持 java_block/bedrock/geckolib 格式；mesh 节点按 bedrock codec 规则跳过。
     */
    compileResource(root: string, docId: string): Promise<ModelerCompileResourceResult>
  }
  gradle: {
    /** 启动 Gradle 任务（输出通过 GRADLE_EVENT 事件推送），返回 runId */
    run(input: import('./build').GradleRunInput): Promise<string>
    /** 取消运行中的任务 */
    cancel(runId?: string): Promise<boolean>
  }
  jdk: {
    /** 检测本机 JDK 并匹配兼容版本；configuredPath 可传项目配置路径。
     *  context.loader+mcVersion 按版本矩阵推导 JDK 要求；context.requirements 直接指定
     *  （设置页校验目录用宽松值）；都缺省回退 1.20.1 时代默认 */
    detect(
      configuredPath?: string | null,
      context?: {
        loader?: string | null
        mcVersion?: string | null
        requirements?: import('./build').JdkRequirements
      }
    ): Promise<import('./build').JdkDetectResult>
    /** 应用内一键下载并安装指定主版本的 JDK；进度经 JDK_PROVISION_EVENT 推送 */
    provision(input: import('./build').JdkProvisionInput): Promise<import('./build').JdkProvisionResult>
  }
  /**
   * 零配置运行环境 3b：托管 MC 实例管理 + 运行时资产置备。
   * 实例落在 userData/mcinstances/<id>；下载进度经 MC_PROVISION_EVENT 推送。
   */
  mc: {
    /** 拉取版本清单（可按镜像重写；不传则按网络设置解析镜像） */
    listVersions(mirror?: string): Promise<import('./mcRuntime').McVersionSummary[]>
    /** 置备一个托管实例的完整运行时（版本 JSON/客户端/库/资产）；进度经事件推送 */
    provision(input: import('./mcRuntime').McProvisionInput): Promise<import('./mcRuntime').McProvisionResult>
    /** 列出本机已置备的托管实例 */
    listInstances(): Promise<import('./mcRuntime').McInstance[]>
    /** 删除托管实例（连带其版本/库/资产目录） */
    deleteInstance(id: string): Promise<boolean>
    /** 启动托管实例（拼装启动参数 + 解析 JDK + spawn java） */
    launchInstance(input: import('./mcRuntime').McLaunchInput): Promise<import('./mcRuntime').McLaunchResult>
  }
  /**
   * 反编译工作区（Vineflower）。工具与产物均独立于项目根：
   * vineflower.jar 在 userData/tools 运行时按需下载；产物在 userData/decompiled 自管安全根。
   */
  decompile: {
    /** 工具就绪状态（不触发下载） */
    status(): Promise<import('./decompile').DecompileToolStatus>
    /** 确保 Vineflower 就绪：缺失时按镜像设置下载（Maven Central / 阿里云） */
    ensureTool(): Promise<import('./decompile').DecompileToolStatus>
    /** 启动反编译任务（jarPath 为对话框选中绝对路径）；进度经 decompile:event 推送 */
    start(jarPath: string): Promise<import('./decompile').DecompileResult>
    /** 列出历史工作区（mtime 倒序） */
    listWorkspaces(): Promise<import('./decompile').DecompileWorkspaceInfo[]>
    /** 读工作区内目录（relDir 空串为根；目录在前按名称排序） */
    readDir(root: string, relDir: string): Promise<import('./fs').FileNode[]>
    /** 读工作区内文本文件（超 2MB 截断） */
    readFile(root: string, relPath: string): Promise<import('./decompile').DecompileFileContent>
    /** 按类名模糊搜索工作区内 .java（上限 200） */
    search(root: string, query: string): Promise<import('./fs').FileNode[]>
    /** 删除整个工作区目录 */
    deleteWorkspace(root: string): Promise<boolean>
  }
  /**
   * 音效工坊。合成在渲染层（jfxr 参数合成 / MIDI 渲染出 WAV 字节），
   * 主进程统一经 FFmpeg 转 OGG Vorbis 44.1kHz 落盘 assets/<ns>/sounds/ 并维护 sounds.json。
   */
  audio: {
    /** FFmpeg 就绪状态（不触发下载） */
    ffmpegStatus(): Promise<import('./audio').AudioToolStatus>
    /** 确保 FFmpeg 就绪：缺失时按镜像设置下载；进度经 audio:event 推送 */
    ensureFfmpeg(): Promise<import('./audio').AudioToolStatus>
    /** 转码一份音源为 OGG 落盘 sounds 目录；进度经 audio:event 推送 */
    convert(input: import('./audio').AudioConvertInput): Promise<import('./audio').AudioConvertResult>
    /** 声音库全貌（.ogg 文件 + sounds.json 事件 + 引用关系） */
    list(root: string): Promise<import('./audio').AudioLibrary>
    /** 注册/更新 sounds.json 音效事件（同名覆盖） */
    registerEvent(root: string, entry: import('./audio').SoundEventEntry): Promise<void>
    /** 注销 sounds.json 音效事件 */
    unregisterEvent(root: string, name: string): Promise<void>
    /** 删除 .ogg 音效文件并摘除事件引用 */
    removeSound(root: string, stem: string): Promise<void>
    /** 读 .ogg 为 data URL（试听，上限 8MB） */
    readSound(root: string, stem: string): Promise<string>
    /** 读用户经对话框选中的源音频/MIDI 字节（上限 20MB） */
    readSource(path: string): Promise<Uint8Array>
  }
  ftbQuest: {
    /** 章节摘要列表（无法解析的文件记入 warnings） */
    list(root: string): Promise<import('./ftbquest').FtbQuestListResult>
    /** 读取单个章节（含任务明细与依赖） */
    read(root: string, id: string): Promise<import('./ftbquest').FtbQuestChapter>
    /** 保存章节（重写为规范 SNBT；prevId 不同为重命名） */
    save(root: string, chapter: import('./ftbquest').FtbQuestChapter, prevId?: string): Promise<void>
    /** 删除章节文件 */
    remove(root: string, id: string): Promise<void>
  }
  patchouli: {
    /** 手册摘要列表 + 默认命名空间 + 解析警告 */
    list(root: string): Promise<import('./patchouli').PatchouliListResult>
    /** 读整本手册（含类目/条目/页面） */
    read(
      root: string,
      namespace: string,
      bookId: string
    ): Promise<import('./patchouli').PatchouliBook>
    /** 保存手册（同步语义：移除不再存在的类目/条目文件；prev 不同为重命名） */
    save(
      root: string,
      book: import('./patchouli').PatchouliBook,
      prev?: { namespace: string; bookId: string }
    ): Promise<void>
    /** 删除整本手册目录 */
    remove(root: string, namespace: string, bookId: string): Promise<void>
  }
  kubejs: {
    /** 脚本列表（含不存在目录标记与读取警告） */
    list(root: string): Promise<import('./kubejs').KubejsListResult>
    /** 读脚本全文 */
    read(root: string, dir: import('./kubejs').KubejsScriptDir, stem: string): Promise<string>
    /** 写脚本（自动创建目录） */
    save(
      root: string,
      dir: import('./kubejs').KubejsScriptDir,
      stem: string,
      content: string
    ): Promise<void>
    /** 删脚本文件 */
    remove(root: string, dir: import('./kubejs').KubejsScriptDir, stem: string): Promise<void>
    /** 内置脚本模板库 */
    templates(): Promise<import('./kubejs').KubejsTemplate[]>
    /** 应用模板落盘为新脚本（目标已存在则拒绝） */
    applyTemplate(root: string, templateId: string): Promise<import('./kubejs').KubejsScriptFile>
  }
  settings: {
    /** 读取全量应用设置（已与默认值合并） */
    getAll(): Promise<import('./settings').AppSettings>
    /** 部分更新设置（按分段合并校验），返回更新后的全量值 */
    set(patch: import('./settings').SettingsPatch): Promise<import('./settings').AppSettings>
    /** 密钥加密是否可用（safeStorage）；false = 密钥明文落盘降级 */
    cryptoStatus(): Promise<{ encrypted: boolean }>
  }
  shell: {
    /** 在系统浏览器打开 https/https 外链；非 http(s) 协议被拒绝 */
    openExternal(url: string): Promise<boolean>
    /** 在系统文件管理器中显示并选中指定文件/文件夹；不存在返回 false */
    showItemInFolder(path: string): Promise<boolean>
  }
  knowledge: {
    /** 扫描本地语料并返回指纹/过期状态（纯本地，不发网络请求） */
    packStatus(): Promise<import('./ai').KnowledgePackStatus>
    /** kbRag 索引完整状态（未初始化返回 null，不触发模型下载） */
    ragStatus(): Promise<import('./models').KbRagStatus | null>
    /** 重建知识库向量索引（清缓存全量重编码）；失败返回 errorMessage */
    ragRebuild(): Promise<
      { ok: true; result: import('./models').KbRagStatus } | { ok: false; errorMessage: string }
    >
  }
  ai: {
    /**
     * 拉取提供商可用模型列表（错误经 AiResult 归类）。
     * force=true 跳过 24h 缓存强制联网刷新；返回含 fetchedAt/fromCache 的新鲜度信息。
     */
    listModels(
      providerId: string,
      force?: boolean
    ): Promise<import('./ai').AiResult<import('./ai').ModelListInfo>>
    /** 连接测试（探测 models/tags 端点并计时） */
    test(providerId: string): Promise<import('./ai').AiTestResult>
    /** 发送对话请求（非流式） */
    chat(req: import('./ai').AiChatRequest): Promise<import('./ai').AiResult<import('./ai').AiChatResponse>>
    /**
     * 流式对话：streamId 由渲染层生成，增量通过 onDelta 回调；
     * 推理模型的思考过程经 onReasoning 回调（「思考中→已深度思考」折叠块）；
     * tool loop 中间态经 onToolStart/onToolEnd 回调（折叠摘要行「已执行 N 个工具」）；
     * invoke 最终同样返回完整 AiResult（与事件末包一致），便于错误归类复用。
     */
    chatStream(
      streamId: string,
      req: import('./ai').AiChatRequest,
      onDelta: (delta: string) => void,
      onReasoning?: (delta: string) => void,
      onToolStart?: (name: string, args: Record<string, unknown>) => void,
      onToolEnd?: (name: string, ok: boolean, summary: string) => void
    ): Promise<import('./ai').AiResult<import('./ai').AiChatResponse>>
    /** 中断进行中的流式请求（主进程 abort 上游连接） */
    chatStop(streamId: string): Promise<void>
    /** KunYuStudio 应用能力清单（AI 自我认知语料，main 读参考包 kunyu_capabilities.md）；缺失返回 null */
    kunyuCapabilities(): Promise<string | null>
    /**
     * M3：仓库级上下文检索（供 CUE 补全注入参考）。
     * 主进程并行检索项目代码 grep / 本地知识库 RAG / 参考包模板，
     * 结果不超过 maxChars，返回空文本表示无可用上下文或超时降级。
     */
    cueContext(input: {
      projectId: string
      relPath: string
      language: string
      query: string
      maxChars: number
      sources: { grep: boolean; kb: boolean; templates: boolean }
    }): Promise<{
      ok: true
      data: { text: string; sources: Array<{ kind: 'grep' | 'kb' | 'template'; ref: string }> }
    } | {
      ok: false
      error: string
    }>
  }
  /** M7 AI 参考包（manifest 与单模板内容） */
  aiRef: {
    getManifest(): Promise<import('./aiReference').ReferenceManifest | null>
    getTemplate(id: string): Promise<import('./aiReference').TemplateView | null>
  }
  /** M7 五 Agent 编排；过程事件走 agent:event */
  agent: {
    run(req: import('./agent').AgentRunRequest): Promise<import('./agent').AgentRunResult>
    /** 全流程 AI 制作 · AI 极速规划：一次性拆解需求为规划概要 + 创意库（不进流水线） */
    plan(
      message: string,
      projectType?: import('./planner').PlanProjectType
    ): Promise<
      | { ok: true; plan: import('./planner').ModPlanDraft }
      | { ok: false; errorMessage: string }
    >
    cancel(runId: string): Promise<void>
    pause(runId: string): Promise<void>
    resume(runId: string): Promise<void>
    /** 查询主进程是否有活跃 Agent 运行（渲染层重载后接管事件流用） */
    active(): Promise<{ active: boolean; runId: string | null }>
    /** 历史任务列表（按最近活动倒序；projectId 传入时按项目过滤） */
    history(opts?: {
      projectId?: string | null
      limit?: number
    }): Promise<import('./agent').AgentRunRecord[]>
    /** 单条历史任务详情：主记录 + 完整事件流水 */
    historyDetail(runId: string): Promise<{
      run: import('./agent').AgentRunRecord | null
      events: import('./agent').AgentEvent[]
    }>
    /** 断点续跑：从历史断点快照恢复，以新 runId 跑剩余阶段（事件仍走 agent:event） */
    resumeRun(
      runId: string
    ): Promise<
      | { ok: true; result: import('./agent').AgentRunResult }
      | { ok: false; errorMessage: string }
    >
    /** 删除历史任务记录（连带事件流水） */
    deleteRun(runId: string): Promise<boolean>
    /**
     * 单项断言复验：重新执行该断言的校验（静态类直接读盘；build-pass 重跑一次 Gradle）。
     * 返回更新后的 contract artifact（同 id 替换）；runId 仅用于定位与持久化事件。
     */
    recheckAssertion(
      runId: string,
      artifactId: string,
      assertion: import('./agent').AcceptanceAssertion
    ): Promise<
      | { ok: true; artifact: import('./agent').AgentArtifact }
      | { ok: false; errorMessage: string }
    >
    /** 手动导出产物：基于当前打开项目导出 jar / 整合包 zip；有 runId 时附带该运行的构建结论与文件清单 */
    exportNow(input: {
      runId?: string
      project?: {
        id: string
        name: string
        path: string
        type: import('./project').ProjectType
        mcVersion: string
        loader: import('./project').ModLoader | null
        loaderVersion: string | null
      }
    }): Promise<
      | { ok: true; artifact: import('./agent').AgentArtifact }
      | { ok: false; errorMessage: string }
    >
    /**
     * 资源替换局部重跑：只对单个贴图 PNG 做 AI 重绘并原地回写，
     * 不重跑整个模组（需求「只重生成贴图/单件」）。
     */
    regenerateAsset(input: {
      /** 项目根绝对路径（当前打开项目） */
      projectPath: string
      /** 项目根相对的项目内 PNG 路径（POSIX 风格，须落在 assets 贴图目录下） */
      relPath: string
      /** 重绘需求描述（中文即可） */
      instruction: string
      /** 覆盖默认图像供应商 */
      providerId?: string
    }): Promise<
      | { ok: true; path: string; size: number; model: string; warnings: string[] }
      | { ok: false; errorMessage: string }
    >
    /**
     * T2 对比视图：读取指定 run 中某文件的 run 前原文快照。
     * found=false：该 run 无此文件快照（未即时写盘/已回滚/端口已淘汰）；
     * found=true 时 original=null 表示 create（原文不存在），string 为 modify 原文。
     */
    getFileSnapshot(runId: string, relPath: string): Promise<{ found: boolean; original: string | null }>
    /**
     * T2 单文件回滚：把指定 run 中某文件恢复到 run 前状态（modify 恢复原文；create 删文件）。
     * 幂等；无快照时 ok:false 并附中文原因。
     */
    rollbackFile(runId: string, relPath: string): Promise<{ ok: boolean; reason?: string }>
  }
  /** A3 离线模型预置流水线；下载进度事件走 aiRuntime:model-event（on 订阅） */
  models: {
    /** 预置模型清单 + 各自缓存状态 + kbRag 嵌入后端状态 */
    list(): Promise<import('./models').ModelListResult>
    /** 手动触发预取（已在下载中返回当前进度视图）；失败不抛出，错误落在各模型 status */
    prefetch(): Promise<
      | { ok: true; result: import('./models').ModelListResult }
      | { ok: false; errorMessage: string }
    >
  }
  /** M7 版本漂移监测与真实编译探针；过程事件走 monitor:event */
  monitor: {
    getState(): Promise<import('./monitor').MonitorState>
    /** 立即拉取 Fabric/Forge/NeoForge 上游并比对基线 */
    check(): Promise<import('./monitor').MonitorState>
    /** 对 active 组合执行真实 Gradle 编译回测（M7 仅 fabric-1.20.1） */
    runProbe(comboId: string): Promise<import('./monitor').ProbeStatus>
  }
  /** M7 mcdev-mcp 静态只读工具链 */
  mcp: {
    getStatus(): Promise<import('./monitor').McpStatus>
    /** 启用（立即连接握手）/禁用（断开并清理子进程），同时持久化到设置 */
    setEnabled(enabled: boolean): Promise<import('./monitor').McpStatus>
    refresh(): Promise<import('./monitor').McpStatus>
    /** 测试一个开发者自定义的 MCP server（短连接 10s 内，返回 ok/tools/error） */
    testServer(
      cfg: import('./settings').CustomMcpServer
    ): Promise<{ ok: boolean; tools: string[]; error?: string }>
    /** 列出自定义 MCP server 的运行时状态 + 工具列表 */
    listCustomTools(): Promise<import('./monitor').CustomMcpRuntime[]>
    /** 同步 settings 里的自定义 server 列表到主进程（增删连接） */
    syncCustom(servers: import('./settings').CustomMcpServer[]): Promise<void>
    /** 调用某个自定义 MCP server 的工具（持久连接） */
    callCustomTool(
      serverId: string,
      toolName: string,
      args: Record<string, unknown>
    ): Promise<{ ok: boolean; text: string; error?: string; isError?: boolean }>
  }
  /** kunyu-observer 内置探针注入（一键注入项目 / 高级自定义 mods 目录） */
  observer: {
    getStatus(): Promise<ObserverStatusDto>
    injectProject(): Promise<ObserverInjectDto>
    injectDir(dir: string): Promise<ObserverInjectDto>
    pickDir(): Promise<{ ok: true; path: string } | { ok: false; canceled?: boolean }>
  }
  /** M9 模组市场与社区桥接（M16 起支持 mod/datapack/resourcepack/shader/modpack 五类内容） */
  market: {
    search(query: import('./market').MarketSearchQuery): Promise<import('./market').MarketSearchResult>
    getDetail(
      platform: import('./market').ModPlatform,
      modId: string,
      projectType?: import('./market').MarketProjectType
    ): Promise<import('./market').MarketModDetail>
    getVersions(
      platform: import('./market').ModPlatform,
      modId: string,
      projectType?: import('./market').MarketProjectType
    ): Promise<import('./market').MarketModFile[]>
    install(input: import('./market').MarketInstallInput): Promise<import('./market').MarketInstallResult>
    /** 测试 CurseForge API Key 是否有效，返回延迟与错误信息 */
    testCf(apiKey: string): Promise<{ ok: boolean; latencyMs: number; error?: string }>
  }
  /** 用户级 Mod 库：社区模组下载/本地导入/存储，供整合包拖入组装 */
  modlib: {
    /** 列出库条目（可按加载器/MC版本/名称过滤） */
    list(filter?: import('./modLibrary').ModLibraryFilter): Promise<import('./modLibrary').ModLibraryEntry[]>
    /** 从市场下载指定版本文件入库，返回操作结果 */
    download(input: import('./modLibrary').ModLibraryDownloadInput): Promise<import('./modLibrary').ModLibraryOpResult>
    /** 取消当前进行中的 modlib 下载 */
    cancelDownload(): Promise<{ ok: boolean; error?: string }>
    /** 弹文件选择器（多选 jar/zip/mrpack）导入库；返回新导入条目 */
    pickAndImport(): Promise<import('./modLibrary').ModLibraryEntry[]>
    /** 从库移除条目并删除资源文件 */
    remove(fileName: string): Promise<boolean>
    /** 把库内资源加入整合包项目（按类型分流落盘；mod 写入来源坐标；datapack 需传 worldName） */
    addToProject(projectPath: string, fileName: string, overwrite?: boolean, worldName?: string): Promise<import('./modLibrary').ModLibraryOpResult>
    /** 列出项目 run/saves 下的世界目录名（数据包选存档用；非整合包项目返回空表） */
    listWorlds(projectPath: string): Promise<string[]>
    /** 库根目录绝对路径（不绑定项目，位于 userData/mod-library） */
    root(): Promise<string>
    /** 在系统文件管理器中显示库内 jar；文件不存在返回 false */
    reveal(fileName: string): Promise<boolean>
    /** 补齐旧版条目的平台图标；返回是否有更新（离线时静默为 false） */
    enrichIcons(): Promise<boolean>
  }
  /** M16 en→zh 自动翻译：AI 优先、免费接口兜底、命中缓存零开销；null 表示该条展示原文 */
  translate: {
    toZh(
      texts: string[]
    ): Promise<{ translations: (string | null)[]; provider: 'ai' | 'free' | 'cache' | 'none' }>
  }
  /** M17 KunYu 创作社区（本地创作广场）：跨项目聚合 + 分享包导出/导入 */
  kunyu: {
    /** 聚合全部项目的语义创作（按更新时间倒序） */
    listCreations(): Promise<import('./community').CreationEntry[]>
    /** 弹保存对话框导出 .kyshare.json；license 为可选许可证预设 id；返回保存路径，用户取消返回 null */
    exportCreation(input: {
      projectPath: string
      kind: import('./content').ContentKind
      id: string
      license?: string
    }): Promise<{ filePath: string } | null>
    /**
     * 弹文件对话框选择 .kyshare.json 并导入目标项目；conflict 时需 overwrite=true 重试。
     * options.preview=true 时只读包返回预览元数据（不落盘），确认后回传 options.filePath 执行导入。
     */
    importCreation(
      targetProjectPath: string,
      overwrite?: boolean,
      options?: { preview?: boolean; filePath?: string }
    ): Promise<import('./community').ImportCreationResult | import('./community').SharePackagePreview | null>
  }
  /** M8 模组性能画像：排行榜查询 + 单画像详情 */
  profile: {
    /** 按维度排序 / loader / MC 版本 / severity 筛选排行榜 */
    leaderboard(
      query: import('../schemas/performance/profile').LeaderboardQuery
    ): Promise<import('../schemas/performance/profile').LeaderboardEntry[]>
    /** 读取单个完整画像（静态特征 / 建议 / 动态指标 / 评分）；不存在返回 null */
    get(
      key: import('../schemas/performance/profile').ProfileKey
    ): Promise<import('../schemas/performance/profile').ModPerformanceProfile | null>
    /** 执行已确认的安全动作（禁用 / 移除 / 改配置），返回逐项回执 */
    applyActions(input: {
      modsRoot: string
      configRoot: string
      actions: import('../schemas/performance/profile').PlannedAction[]
    }): Promise<import('../schemas/performance/profile').ActionReceipt[]>
    /** 半自动：分析目录下全部 jar 入榜 */
    analyzeDirectory(input: {
      dir: string
      loader: string
      mcVersion: string
    }): Promise<{
      total: number
      succeeded: number
      results: Array<{ ok: boolean; modId?: string; fileName: string; error?: string }>
    }>
    /** 人工：导入单 jar 静态分析入榜 */
    importJar(input: {
      jarPath: string
      loader: string
      mcVersion: string
    }): Promise<{ ok: boolean; modId?: string; fileName: string; error?: string }>
    /** 人工：导入 .jfr 动态归因合并 */
    importJfr(input: {
      jfrPath: string
      jdkHome?: string | null
      loader?: string
      mcVersion?: string
    }): Promise<{
      ok: boolean
      profilesUpdated: number
      modIds: string[]
      error?: string
    }>
    /** 人工：导入 Spark 报告（文件路径）动态归因合并 */
    importSpark(input: {
      filePath: string
      loader?: string
      mcVersion?: string
    }): Promise<{
      ok: boolean
      profilesUpdated: number
      modIds: string[]
      error?: string
    }>
  }
  /** M10 游戏测试沙箱：事件订阅走通用 on(SANDBOX_EVENT) */
  sandbox: {
    run(config: import('./sandbox').SandboxConfig): Promise<import('./sandbox').SandboxReport>
    cancel(runId?: string): Promise<boolean>
  }
  /** M11 启动器集成：检测/实例/导入/激活/启动；事件走通用 on(LAUNCHER_EVENT) */
  launcher: {
    /** 扫描本机常见路径，自动检测已安装启动器 */
    detect(): Promise<import('./launcher').DetectResult>
    /** 列出指定启动器下的所有 Minecraft 实例 */
    listInstances(launcherId: string): Promise<import('./launcher').LauncherInstance[]>
    /** 一键导入构建产物到实例 mods 目录（冲突检测复用 market 的 findExistingMod 模式） */
    import(input: import('./launcher').ImportInput): Promise<import('./launcher').ImportResult>
    /** 设置当前激活实例（用于版本切换） */
    setActive(instanceId: string): Promise<boolean>
    /** 调用启动器启动指定实例（M11 仅启动；沙箱联动留 M10 增强） */
    launch(instanceId: string): Promise<boolean>
    /** 手动添加启动器（autoDetected=false） */
    add(input: import('./launcher').AddLauncherInput): Promise<import('./launcher').LauncherInfo>
    /** 批量导入（一次建目录、一次写记录），整合包启动测试装入整包模组用 */
    importBatch(
      input: import('./launcher').ImportBatchInput
    ): Promise<import('./launcher').ImportBatchResult>
    /** 自动扫描本机启动器并挑选最合适的实例，选中后持久化为激活实例 */
    autoIntegrate(
      input: import('./launcher').AutoIntegrateInput
    ): Promise<import('./launcher').AutoIntegrateResult>
    /** 读取持久化的激活实例 / 导入记录（重启后恢复界面状态） */
    getState(): Promise<import('./launcher').LauncherPersistedState>
  }
  /** 数据包编辑器（P0）：元数据、目录初始化与条目 CRUD */
  datapack: {
    /** 读取数据包元数据；未创建返回 null */
    getMeta(root: string): Promise<import('../schemas/datapack.schema').DataPackMeta | null>
    /** 初始化数据包（幂等）：写元数据 + pack.mcmeta + 建类别目录 */
    init(
      root: string,
      input: { namespace: string; description: string; mcVersion: import('../schemas/datapack.schema').McVersion },
      mode: PackLayoutMode
    ): Promise<import('../schemas/datapack.schema').DataPackMeta>
    /** 扫描全部类别的条目列表 */
    listEntries(root: string, mode: PackLayoutMode): Promise<import('../schemas/datapack.schema').DataPackEntry[]>
    /** 读取条目原始文本（JSON 或 mcfunction） */
    readEntry(root: string, category: string, id: string, mode: PackLayoutMode): Promise<string>
    /** 写入条目（新建或覆盖） */
    writeEntry(
      root: string,
      category: string,
      id: string,
      content: string,
      mode: PackLayoutMode
    ): Promise<import('../schemas/datapack.schema').DataPackEntry>
    /** 删除条目文件 */
    deleteEntry(root: string, category: string, id: string, mode: PackLayoutMode): Promise<boolean>
  }
  /** 光影包编辑器（P0）：元数据、初始化与 shader 文件读写删 */
  shaderpack: {
    /** 读取光影包元数据；未创建返回 null */
    getMeta(root: string): Promise<import('../schemas/shaderpack.schema').ShaderPackMeta | null>
    /** 初始化光影包（幂等）：写元数据 + 建 shaders 标准目录 + 占位 properties */
    init(
      root: string,
      input: {
        packId?: string
        name: string
        loader: import('../schemas/shaderpack.schema').ShaderLoader
        mcVersion: import('../schemas/shaderpack.schema').McVersionLike
        version?: string
        description: string
      },
      mode: PackLayoutMode
    ): Promise<import('../schemas/shaderpack.schema').ShaderPackMeta>
    /** 扫描光影包全部可编辑文件（管线文件 + lib/lang + properties） */
    listFiles(root: string, mode: PackLayoutMode): Promise<import('../schemas/shaderpack.schema').ShaderPackFile[]>
    /** 读取文件原始文本（GLSL / lang / properties） */
    readFile(root: string, relPath: string, mode: PackLayoutMode): Promise<string>
    /** 写入文件（新建或覆盖） */
    writeFile(
      root: string,
      relPath: string,
      content: string,
      mode: PackLayoutMode
    ): Promise<import('../schemas/shaderpack.schema').ShaderPackFile>
    /** 删除文件（shaders.properties 不允许删除） */
    deleteFile(root: string, relPath: string, mode: PackLayoutMode): Promise<boolean>
    /** 导出可分发 zip（zip 顶层为 shaders/），返回项目 dist/ 下的产物绝对路径 */
    exportZip(root: string, mode: PackLayoutMode): Promise<string>
  }
  /** 资源包编辑器（P0）：元数据、初始化、文件读写删与图标导入 */
  resourcepack: {
    /** 读取资源包元数据；未创建返回 null */
    getMeta(root: string): Promise<import('../schemas/resourcepack.schema').ResourcePackMeta | null>
    /** 初始化资源包（幂等）：写元数据 + pack.mcmeta + 标准 assets 目录 */
    init(
      root: string,
      input: {
        packId?: string
        name: string
        mcVersion: string
        description: string
        namespace: string
      },
      mode: PackLayoutMode
    ): Promise<import('../schemas/resourcepack.schema').ResourcePackMeta>
    /** 递归扫描包内全部文件（assets/ + pack.mcmeta/pack.png） */
    listFiles(root: string, mode: PackLayoutMode): Promise<import('../schemas/resourcepack.schema').ResourcePackFile[]>
    /** 读取文本文件原始内容（json/mcmeta/txt 等） */
    readFile(root: string, relPath: string, mode: PackLayoutMode): Promise<string>
    /** 写入文本文件（新建或覆盖） */
    writeFile(
      root: string,
      relPath: string,
      content: string,
      mode: PackLayoutMode
    ): Promise<import('../schemas/resourcepack.schema').ResourcePackFile>
    /** 删除文件（pack.mcmeta 不允许删除） */
    deleteFile(root: string, relPath: string, mode: PackLayoutMode): Promise<boolean>
    /** 导入 PNG 图片为包根 pack.png，返回固定路径 */
    importIcon(root: string, srcPath: string, mode: PackLayoutMode): Promise<string>
    /** 像素画写为包内 PNG（新建或覆盖），返回文件节点 */
    writeTexture(
      root: string,
      relPath: string,
      pixels: string[],
      width: number,
      height: number,
      mode: PackLayoutMode
    ): Promise<import('../schemas/resourcepack.schema').ResourcePackFile>
    /** 读取包内 PNG 为 data URL（像素画编辑器解码用） */
    readTexture(root: string, relPath: string, mode: PackLayoutMode): Promise<string>
    /** 导出可分发 zip（产物 dist/<packId>.zip；zip 顶层 = pack.mcmeta + assets/） */
    exportZip(root: string, mode: PackLayoutMode): Promise<string>
    /** 导入 .ogg 音效至 assets/<ns>/sounds/，返回包内相对路径 */
    importSound(root: string, srcPath: string, mode: PackLayoutMode): Promise<string>
    /** 读取包内 .ogg 为 data URL（试听用，≤8MB） */
    readSound(root: string, relPath: string, mode: PackLayoutMode): Promise<string>
  }
  /**
   * 整合包真实组装：按项目路径在主进程内查项目，仅 type === 'modpack' 的项目可组装。
   * 元数据（MC 版本 / 加载器）一律取自项目记录，渲染层不传，避免与持久化数据不一致。
   */
  modpack: {
    /** 干跑预览：返回组装计划（含归类理由、排除项与告警），不落盘 */
    preview(projectPath: string): Promise<import('./modpack').ModpackPreviewResult>
    /** 真实组装：生成双平台清单 + overrides + dist/<项目名>-modpack.zip */
    assemble(projectPath: string): Promise<import('./modpack').ModpackAssembleResult>
    /** 读取项目内安装来源记录 `.kunyu/modpack.json`（缺失返回空数组） */
    listSources(projectPath: string): Promise<import('./modpack').ModSourceEntry[]>
    /** P3-3 跨平台联动：CF↔MR 同模组映射缓存 + 版本滞后/重复/缺失预警（手动触发，逐模组联网） */
    crossLink(projectPath: string): Promise<import('./modpack').CrossLinkReport>
    /** 启动测试：批量导入实例 → 目录断言 → 启动 → 日志增量判定 */
    launchTest(
      input: import('./modpack').LaunchTestInput
    ): Promise<import('./modpack').LaunchTestResult>
    /** 扫描项目根 content-packs/ 下全部内容包概要（含坏包告警） */
    listPacks(projectPath: string): Promise<import('./contentPack').ContentPackSummary[]>
    /** 切换内容包启用状态（改写 pack.json 的 enabled 字段） */
    setPackEnabled(
      projectPath: string,
      packId: string,
      enabled: boolean
    ): Promise<import('./contentPack').ContentPackOpResult>
    /** 新建内容包骨架（同 id 已存在时拒绝，不覆盖） */
    createPack(
      projectPath: string,
      input: import('./contentPack').CreatePackInput
    ): Promise<import('./contentPack').ContentPackOpResult>
    /** M18 发布预检：dist zip 就绪度 + 双平台 token 就绪度 + CF gameVersions 预览 */
    publishPreflight(projectPath: string): Promise<import('./modpack').PublishPreflightResult>
    /** M18 一键直发：将 dist zip 发布到 Modrinth / CurseForge（部分失败不回滚） */
    publish(
      projectPath: string,
      input: import('./modpack').PublishModpackInput,
      platforms: import('./modpack').PublishPlatform[]
    ): Promise<import('./modpack').PublishModpackResult>
  }
  ci: {
    /** 读取 .kunyu/ci-config.json；缺失返回 null */
    getConfig(projectPath: string): Promise<import('./ci').CiConfig | null>
    /** 写 .kunyu/ci-config.json */
    setConfig(projectPath: string, config: import('./ci').CiConfig): Promise<void>
    /** 预览工作流 YAML（不写盘） */
    preview(
      projectPath: string,
      config: import('./ci').CiConfig
    ): Promise<Record<string, string>>
    /** 导出所有已开启的工作流 + 矩阵构建脚本到项目 */
    export(
      projectPath: string,
      config: import('./ci').CiConfig
    ): Promise<import('./ci').CiExportResult>
    /** 读 config → 重新生成（用户手改 yml 后一键覆盖） */
    regenerate(projectPath: string): Promise<import('./ci').CiExportResult>
  }
  /** 版本与产物：Git 历史 + 构建产物 */
  vcs: {
    /** 读取最近 N 条 git log（默认 50） */
    getGitLog(root: string, limit?: number): Promise<import('./vcs').VcsGitLogResult>
    /** 读取仓库状态（分支/未提交统计） */
    getGitStatus(root: string): Promise<import('./vcs').VcsGitStatusResult>
    /** 扫描构建产物（build/libs/*.jar, dist/*.zip 等） */
    listArtifacts(root: string): Promise<import('./vcs').VcsArtifactsResult>
    /** 读取详细变更列表（已暂存/未暂存/未跟踪分类） */
    getStatusDetail(root: string): Promise<import('./vcs').VcsStatusDetailResult>
    /** 暂存单文件 */
    stageFile(root: string, path: string): Promise<{ ok: boolean; error?: string }>
    /** 取消暂存单文件 */
    unstageFile(root: string, path: string): Promise<{ ok: boolean; error?: string }>
    /** 暂存全部变更 */
    stageAll(root: string): Promise<{ ok: boolean; error?: string }>
    /** 提交 */
    commit(root: string, message: string): Promise<import('./vcs').VcsCommitResult>
    /** 获取文件 diff（staged=true 取已暂存 diff） */
    getDiff(root: string, path: string, staged?: boolean): Promise<import('./vcs').VcsDiffResult>
    /** 列出本地分支 */
    branchList(root: string): Promise<import('./vcs').VcsBranchListResult>
    /** 切换分支 */
    branchCheckout(root: string, name: string): Promise<import('./vcs').VcsBranchOpResult>
    /** 创建分支 */
    branchCreate(root: string, name: string, base?: string): Promise<import('./vcs').VcsBranchOpResult>
    /** 删除分支 */
    branchDelete(root: string, name: string): Promise<import('./vcs').VcsBranchOpResult>
    /** 列出远程仓库 */
    remoteList(root: string): Promise<import('./vcs').VcsRemoteListResult>
    /** 初始化 Git 仓库（默认分支 main） */
    initRepo(root: string): Promise<import('./vcs').VcsRepoOpResult>
    /** 添加远程仓库 */
    remoteAdd(root: string, name: string, url: string): Promise<import('./vcs').VcsRepoOpResult>
    /** 移除远程仓库 */
    remoteRemove(root: string, name: string): Promise<import('./vcs').VcsRepoOpResult>
    /** push 到远程 */
    push(root: string, remote: string, branch: string, setUpstream?: boolean): Promise<import('./vcs').VcsSyncResult>
    /** pull 远程（--ff-only） */
    pull(root: string): Promise<import('./vcs').VcsSyncResult>
    /** fetch 全部远程 */
    fetch(root: string): Promise<import('./vcs').VcsSyncResult>
    /** 提交详情（增删统计 + 文件列表） */
    commitDetail(root: string, hash: string): Promise<import('./vcs').VcsCommitDetailResult>
    /** 列出 tag */
    tagList(root: string): Promise<import('./vcs').VcsTagListResult>
    /** 创建附注 tag */
    tagCreate(root: string, name: string, message: string): Promise<import('./vcs').VcsTagCreateResult>
  }
  /** 插件库与商城：MCP 管理 + 插件市场 */
  plugin: {
    /** 列出全部自定义 MCP server（含运行时状态） */
    listMcpServers(): Promise<import('./plugin').PluginMcpListResult>
    /** 启用/禁用某个 MCP server（写 settings + 重连） */
    toggleMcp(id: string, enabled: boolean): Promise<import('./plugin').PluginToggleResult>
    /** 测试连接（短连接握手） */
    testMcp(cfg: import('./settings').CustomMcpServer): Promise<import('./plugin').PluginTestResult>
    /** 查询公共插件市场（官方 MCP Registry，失败回退内置精选）；支持搜索与分页游标 */
    listMarket(query?: import('./plugin').MarketQuery): Promise<import('./plugin').PluginMarketListResult>
    /** 从市场安装插件（写入自定义 MCP server 并立即启用） */
    installMarket(req: import('./plugin').MarketInstallRequest): Promise<import('./plugin').PluginInstallResult>
  }
  /** DSH 社区插件兼容宿主：精选目录 + 安装/卸载 + 加载状态（工具桥接进 AI 循环） */
  dsh: {
    /** 环境探测 + 精选清单 + 已装记录 + 每个插件的加载状态（一次拉全） */
    getState(): Promise<import('./dsh').DshCatalogState>
    /** 安装插件 npm 包（精选清单内或自定义包名），完成后自动重载宿主 */
    install(npmName: string, source: 'catalog' | 'custom'): Promise<import('./dsh').DshOpResult>
    /** 卸载插件并重载宿主 */
    remove(npmName: string): Promise<import('./dsh').DshOpResult>
    /** 手动重载全部插件（改包内容后用） */
    reload(): Promise<import('./dsh').DshOpResult>
    /**
     * 授权 / 撤销插件在主进程内运行。授权绑定当前包内容指纹；
     * 插件升级或被替换后授权自动失效，需重新授权。
     */
    setTrust(npmName: string, approve: boolean): Promise<import('./dsh').DshOpResult>
    /** 启动 dsh-pet 桌宠（未装包时自动走本机 DSH 桌面端本地目录安装） */
    petStart(): Promise<import('./dsh').DshPetStatus>
    /** 停止桌宠（关闭 helper 窗口与路由 server） */
    petStop(): Promise<import('./dsh').DshPetStatus>
    /** 查询桌宠运行状态 */
    petStatus(): Promise<import('./dsh').DshPetStatus>
  }
  /** 集成：外部 Agent CLI 检测 + KunYu MCP 桥接（写操作经授权弹窗） */
  integration: {
    /** 检测本机 Codex / Claude Code CLI（自定义路径优先，回退 PATH） */
    detectAgents(): Promise<import('./integration').ExternalAgentInfo[]>
    /** 启动 MCP 桥接 server（仅 127.0.0.1），端口取设置 integration.mcpBridgePort */
    startBridge(): Promise<import('./integration').McpBridgeStatus>
    /** 停止 MCP 桥接 server */
    stopBridge(): Promise<import('./integration').McpBridgeStatus>
    /** 查询桥接状态（pane 轮询用） */
    getBridgeStatus(): Promise<import('./integration').McpBridgeStatus>
    /** 回传授权决定（弹窗按钮触发） */
    respondAuth(decision: import('./integration').McpAuthDecision): Promise<void>
    /**
     * 订阅授权请求事件：外部 agent 调用写/敏感工具时主进程推送，
     * 渲染层弹窗后调用 respondAuth 回传决定。
     * @returns 取消订阅函数
     */
    onAuthRequest(listener: (req: import('./integration').McpAuthRequest) => void): () => void
    /** 把任务派发给外部 Agent CLI；任务经 stdin 传入，默认只读 */
    runAgent(req: import('./integration').ExternalAgentRunRequest): Promise<import('./integration').ExternalAgentRunStart>
    /** 停止正在运行的外部 Agent 任务（按进程树终止） */
    stopAgent(runId: string): Promise<boolean>
    /** 订阅外部 Agent 输出片段 */
    onAgentChunk(listener: (chunk: import('./integration').ExternalAgentChunk) => void): () => void
    /** 订阅外部 Agent 结束事件 */
    onAgentExit(listener: (exit: import('./integration').ExternalAgentExit) => void): () => void
  }
  /**
   * 订阅主进程事件推送（on 模式）。
   * @returns 取消订阅函数
   */
  on(channel: string, listener: (...args: unknown[]) => void): () => void
}

declare global {
  interface Window {
    api: IpcApi
  }
}

export {}
