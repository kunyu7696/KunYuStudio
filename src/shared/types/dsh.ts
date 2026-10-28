/**
 * DSH（DeepSeek Harness）社区插件兼容宿主类型。
 *
 * 坤宇不安装 dsh 本体：直接安装 DSH 社区插件 npm 包，并由主进程内嵌的
 * 兼容宿主按 cordis 约定加载（apply(ctx, ...inject 服务)），把插件注册的
 * 工具接入坤宇自己的 AI 工具注册表（toolRegistry）。
 *
 * 能力边界：
 * - 工具类插件（inject: ['tools']）→ 坤宇提供 tools 服务，可激活
 * - UI 类插件（client bundle）→ 依赖 dsh web 前端模块表，坤宇内不可渲染；
 *   dsh-pet 桌宠例外，由 dsh-pet-kunyu 适配层以独立 helper 窗口方式运行
 */

/** 精选插件清单条目（resources/dsh-plugins/manifest.json） */
export interface DshCatalogEntry {
  /** 展示 id（唯一） */
  id: string
  /** npm 包名 */
  npm: string
  name: string
  description: string
  /** 分类：tool=工具类（可激活进 AI 循环）；ui=界面类（需 dsh web 前端） */
  category: 'tool' | 'ui'
  /** 非公开的 @deepseek-ai/* 服务包，安装后由宿主写入本地 shim */
  shims: string[]
  /** 是否已在精选清单中标记为坤宇内不可完整运行 */
  uiNote?: string
}

/** 已安装插件记录（持久化于 <userData>/dsh-plugins/kunyu.dsh.json） */
export interface DshInstalledRecord {
  npm: string
  version: string
  source: 'catalog' | 'custom'
  installedAt: number
  shims: string[]
}

/** 单个插件的加载状态（兼容宿主加载结果） */
export interface DshPluginStatus {
  npm: string
  version: string
  source: 'catalog' | 'custom'
  /** active=apply 成功且至少注册/无需工具；inactive=未激活（原因见 reason） */
  state: 'active' | 'inactive' | 'error'
  /** 未激活/出错原因（中文，直接展示） */
  reason?: string
  /** 插件通过 ctx.tools.register 注册、已桥接进 AI 循环的工具名 */
  tools: string[]
  /** 插件声明 inject 但宿主未提供的服务 */
  missingServices: string[]
  /**
   * 信任门控状态：trusted=已授权且包内容未变；untrusted=从未授权（不会加载）；
   * changed=授权后包内容被变更，原授权失效（需重新授权）
   */
  trustState?: 'trusted' | 'untrusted' | 'changed'
  /** 插件在 package.json `kunyu.permissions` 中声明的宿主能力（仅白名单项） */
  declaredPermissions?: string[]
}

/** 环境探测结果 */
export interface DshEnvStatus {
  nodeOk: boolean
  nodeVersion: string
  npmOk: boolean
  /** node/npm 缺失时的引导文案 */
  message?: string
}

/** 目录 + 已装 + 状态聚合（渲染层一次拉全） */
export interface DshCatalogState {
  env: DshEnvStatus
  entries: Array<DshCatalogEntry & { installed?: DshInstalledRecord; status?: DshPluginStatus }>
  customs: Array<DshInstalledRecord & { status?: DshPluginStatus }>
  /** 精选清单未随包携带（安装包不完整/开发目录裁剪），目录降级为空（P0-3） */
  catalogMissing?: boolean
}

export interface DshOpResult {
  ok: boolean
  error?: string
}

/**
 * dsh-pet 版本与坤宇适配层的兼容判定：
 * - verified：在适配验证档内（当前 0.3.x），承诺可用；
 * - unverified：版本越新或无法识别，允许尝试启动但仅给警告，不保证约定仍兼容；
 * - unsupported：低于适配最低版本（缺接口），startPet 硬阻断。
 */
export type DshPetCompatLevel = 'verified' | 'unverified' | 'unsupported'

/** dsh-pet 桌宠运行状态（DSH_PET_STATUS 数据源） */
export interface DshPetStatus {
  /** 宿主已启动（helper 窗口由原作插件自行拉起） */
  running: boolean
  /** 桌宠路由 HTTP 端口（未运行为 null） */
  port: number | null
  /** dsh-pet 包已装进 <userData>/dsh-plugins（本地目录通道或 npm） */
  petInstalled: boolean
  /** dsh-pet 版本（未装为 null） */
  petVersion: string | null
  /** 检测到可用的 Electron 可执行文件（helper 渲染窗口依赖） */
  electronFound: boolean
  /** 本机 DSH 桌面端存在可复制的 dsh-pet 包（一键安装可用性提示） */
  sourceAvailable: boolean
  /** 已装版本相对适配验证档的兼容性（未装时不附该字段） */
  compat?: DshPetCompatLevel
  /** 非 verified 时给用户看的中文说明（unsupported 同时写入 error 阻断启动） */
  compatMessage?: string
  /** 最近一次启动失败的中文原因 */
  error?: string
}
