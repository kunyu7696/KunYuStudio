import {
  Box,
  Collection,
  Connection,
  Document,
  Files,
  FolderOpened,
  GoldMedal,
  Goods,
  Grid,
  Headset,
  MagicStick,
  Menu,
  Monitor,
  Picture,
  Reading,
  Search,
  Setting,
  Share,
  Star,
  Sunny,
  Tickets,
  TrendCharts,
  VideoPlay
} from '@element-plus/icons-vue'
import { moduleRegistry } from './registry'

/**
 * 注册内置活动栏模块。
 * 项目管理作为首项，符合"启动时进入项目管理界面"的设计（3.12）。
 * 其余模块对应设计文档 3.2。
 * 视图全部通过动态 import 懒加载，Vite 自动按模块拆包。
 */
export function registerBuiltinModules(): void {
  // M13：项目管理与资源管理器合并为单一模块——主页卡片 + 工作区（代码/可视化两模式）
  // 由 ProjectManagerView 内部承载，侧边栏始终为文件树
  moduleRegistry.register({
    id: 'project-manager',
    name: '项目管理',
    icon: Files,
    description: '新建、打开、导入项目',
    loader: () => import('./views/ProjectManagerView.vue'),
    sidebarLoader: () => import('../components/explorer/FileTree.vue')
  })

  moduleRegistry.register({
    id: 'datapack',
    name: '数据包编辑器',
    icon: Collection,
    description: '无代码创建与编辑数据包：配方、战利品表、进度、标签、函数等',
    projectTypes: ['mod', 'datapack'],
    requireProject: true,
    loader: () => import('./datapack/DataPackView.vue'),
    sidebarLoader: () => import('./datapack/DataPackTree.vue')
  })

  // 光影包编辑器：只在光影包项目里可见——模组项目内的光影资源走资源包/统一编辑器链路，不需要独立入口
  moduleRegistry.register({
    id: 'shaderpack',
    name: '光影包编辑器',
    icon: Sunny,
    description: '创建与编辑 Iris / OptiFine 光影包：GLSL 着色器、选项配置与多语言',
    projectTypes: ['shaderpack'],
    requireProject: true,
    loader: () => import('./shaderpack/ShaderPackView.vue'),
    sidebarLoader: () => import('./shaderpack/ShaderPackTree.vue')
  })

  moduleRegistry.register({
    id: 'resourcepack',
    name: '资源包编辑器',
    icon: Box,
    description: '组织贴图与模型，配置音效、语言、字体，打包导出标准资源包',
    projectTypes: ['mod', 'resourcepack'],
    requireProject: true,
    loader: () => import('./resourcepack/ResourcePackView.vue'),
    sidebarLoader: () => import('./resourcepack/ResourcePackTree.vue')
  })

  // 工坊（原「统一编辑器」）：按内容对象（方块/物品/实体）编辑，三端实时同步
  moduleRegistry.register({
    id: 'unified',
    name: '工坊',
    icon: Menu,
    description: '按内容对象编辑：方块/物品/实体的 Java、资源包、数据包三端统一管理',
    projectTypes: ['mod'],
    requireProject: true,
    loader: () => import('./unified/UnifiedEditorView.vue')
  })

  // 模型工坊：通用建模器（ModelDocument 原生文档 + 撤销栈），P0 只读视口骨架
  moduleRegistry.register({
    id: 'modeler',
    name: '模型工坊',
    icon: Share,
    description: '通用 3D 建模器：层级 Outliner、只读视口与文档管理（.kunyu/modeler）',
    requireProject: true,
    loader: () => import('./modeler/ModelerWorkbench.vue')
  })

  // 附魔编辑器：独立轻量模块（语义 schema 驱动，不进 unified 三端模型）
  moduleRegistry.register({
    id: 'enchant',
    name: '附魔编辑器',
    icon: GoldMedal,
    description: '创建与编辑自定义附魔：Fabric/Forge 出 Java 注册类，NeoForge 1.21 出数据 JSON',
    projectTypes: ['mod'],
    requireProject: true,
    loader: () => import('./enchant/EnchantView.vue')
  })

  // 资产库（原项目画廊）：AI 产出的贴图候选全部存档，零额度复用（不必重跑 AI 烧额度）；
  // 同时接替原「KunYu 社区」的跨项目聚合与 .kyshare.json 分享包导入/导出
  // 主页活动栏专用：打开任何项目后隐藏（项目内不再重复提供入口）
  moduleRegistry.register({
    id: 'gallery',
    name: '资产库',
    icon: Picture,
    description: 'AI 贴图候选、项目像素资产与 3D 模型的统一资产库：跨项目汇总、写回 / 二次编辑、分享包导入导出',
    homeOnly: true,
    loader: () => import('./gallery/GalleryView.vue')
  })

  // 版本控制同时是产物管理入口：不绑定具体项目，有无项目均可打开
  moduleRegistry.register({
    id: 'vcs',
    name: '版本与产物',
    icon: Connection,
    description: 'Git 提交、分支管理与构建产物管理',
    loader: () => import('./views/VcsView.vue')
  })

  moduleRegistry.register({
    id: 'debug',
    name: '运行和调试',
    icon: VideoPlay,
    description: '启动游戏、断点调试',
    requireProject: true,
    loader: () => import('./views/DebugView.vue')
  })

  // 模组与市场：主页活动栏可先逛市场（无需打开项目）；已打开项目时只保留在整合包项目里
  // ——普通模组/数据包等项目的依赖管理走各自的编辑器与依赖链路，不需要这个入口
  moduleRegistry.register({
    id: 'market',
    name: '模组与市场',
    icon: Goods,
    description: '浏览模组市场与公共社区桥接（整合包项目内可用，未打开项目也可先浏览）',
    projectTypes: ['modpack'],
    loader: () => import('./views/MarketView.vue')
  })

  // 资源库：市场下载与本地导入的 jar/zip/mrpack 统一存放，主页活动栏专用——
  // 打开任何项目后隐藏（项目内不再重复提供入口）
  moduleRegistry.register({
    id: 'modlib',
    name: '资源库',
    icon: FolderOpened,
    description: '全局资源库：市场下载与本地导入的模组/资源包/数据包/光影统一存放，打开整合包项目可按类型一键加入对应目录',
    homeOnly: true,
    loader: () => import('./modlib/ModLibraryView.vue')
  })

  // 反编译工作区：全局工具（Vineflower 按需下载，产物在 userData/decompiled 独立安全根），不绑定项目
  moduleRegistry.register({
    id: 'decompile',
    name: '反编译',
    icon: Search,
    description: '用 Vineflower 把任意 jar 反编译为可读 Java 源码树：任务进度、类搜索与只读浏览',
    loader: () => import('./decompile/DecompileView.vue')
  })

  // 音效工坊：jfxr 参数合成 / MIDI 渲染 / 本地音频 → FFmpeg 统一转 OGG，落 assets/<ns>/sounds 并注册 sounds.json
  moduleRegistry.register({
    id: 'audio',
    name: '音效工坊',
    icon: Headset,
    description: '参数合成器、MIDI 旋律与本地音频统一转 OGG 44.1kHz，注册 sounds.json 音效事件',
    projectTypes: ['mod', 'resourcepack'],
    requireProject: true,
    loader: () => import('./audio/AudioView.vue')
  })

  // FTB 任务书：config/ftbquests/quests/chapters/*.snbt 章节列表 + 任务表单 + 依赖展示（保存与生成器互逆）
  moduleRegistry.register({
    id: 'ftbquest',
    name: 'FTB 任务书',
    icon: Tickets,
    description: '编辑 FTB Quests 章节：任务提交物品、奖励与前置依赖，落盘 SNBT 游戏内 /reload 生效',
    projectTypes: ['modpack'],
    requireProject: true,
    loader: () => import('./ftbquest/FtbQuestView.vue')
  })

  // Patchouli 指南书：config/<ns>/patchouli_books/<book>/ 直读直写（book.json + 类目 + 条目页面，同步语义保存）
  moduleRegistry.register({
    id: 'patchouli',
    name: '指南书',
    icon: Reading,
    description: '编辑 Patchouli 手册：类目与条目页面（文本/配方/图片/聚焦），落盘 config/<命名空间>/patchouli_books/',
    projectTypes: ['modpack'],
    requireProject: true,
    loader: () => import('./patchouli/PatchouliView.vue')
  })

  // KubeJS 脚本：kubejs/{startup,server,client}_scripts/*.js 编辑（Monaco JS + onEvent 片段 + 模板库）
  moduleRegistry.register({
    id: 'kubejs',
    name: 'KubeJS 脚本',
    icon: Document,
    description: '编辑 KubeJS 三目录脚本：启动期注册、服务端与客户端事件，模板库一键生成骨架',
    projectTypes: ['modpack'],
    requireProject: true,
    loader: () => import('./kubejs/KubejsView.vue')
  })

  moduleRegistry.register({
    id: 'launcher',
    name: '启动器集成',
    icon: Monitor,
    description: '检测本机启动器、一键导入构建产物、快速启动游戏',
    requireProject: true,
    loader: () => import('./views/LauncherView.vue')
  })

  // 半独立功能：主页活动栏专用入口——未打开项目时由 AI 引导创建/选择项目；
  // 打开项目后由右侧 AI 助手面板与各编辑器承载，本入口从项目页移除
  moduleRegistry.register({
    id: 'ai-workflow',
    name: '全流程 AI 制作',
    icon: MagicStick,
    description: 'AI Agent 引导从创意到成品的完整开发流程（主页入口）',
    homeOnly: true,
    loader: () => import('./views/AiView.vue')
  })

  moduleRegistry.register({
    id: 'performance',
    name: '性能画像',
    icon: TrendCharts,
    description: '模组五维性能评分排行榜、冲突与建议、JFR / Spark 采样归因',
    requireProject: true,
    loader: () => import('./performance/PerformanceView.vue')
  })

  // 整合包组装：仅整合包类型项目可见（真实生成双清单 + overrides + dist zip）
  moduleRegistry.register({
    id: 'modpack',
    name: '整合包组装',
    icon: Box,
    description: '扫描 run/mods 生成 CurseForge / Modrinth 双清单与 overrides，导出整合包 zip',
    projectTypes: ['modpack'],
    requireProject: true,
    loader: () => import('./modpack/ModpackView.vue')
  })

  // 特性⑤ CI/CD 集成：仅模组类型项目可见（build/release/gametest 工作流导出）
  moduleRegistry.register({
    id: 'ci-cd',
    name: 'CI/CD 集成',
    icon: Connection,
    description: '生成 GitHub Actions 工作流：build 矩阵 + release 手动确认发布 + gametest 无头测试',
    projectTypes: ['mod'],
    requireProject: true,
    loader: () => import('./ci/CiCdView.vue')
  })

  moduleRegistry.register({
    id: 'plugins',
    name: '插件库与商城',
    icon: Grid,
    description: '管理已安装插件，浏览下载第三方扩展',
    loader: () => import('./views/PluginsView.vue')
  })

  // DSH 社区插件兼容宿主：无需 dsh 本体直接安装运行 DeepSeek Harness 插件
  moduleRegistry.register({
    id: 'dsh-plugins',
    name: 'DSH 插件',
    icon: Star,
    description: '安装 DeepSeek Harness 社区插件，工具能力直接进入 AI 循环',
    loader: () => import('./views/DshView.vue')
  })

  moduleRegistry.register({
    id: 'settings',
    name: '设置',
    icon: Setting,
    description: '工具偏好、JDK 路径、游戏版本配置',
    placement: 'bottom',
    loader: () => import('./views/SettingsView.vue')
  })
}

export { moduleRegistry } from './registry'
export { eventBus } from './eventBus'
export type { KunYuModule } from './registry'
