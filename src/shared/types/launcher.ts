/**
 * M11 启动器集成共享类型。
 * 启动器集成负责：检测本机启动器 → 列出实例 → 一键导入构建产物 → 启动游戏。
 * 支持 PCL2 / HMCL / BakaXL / Prism / MultiMC / 官方启动器。
 */

/** 启动器种类 */
export type LauncherKind = 'pcl2' | 'hmcl' | 'bakaxl' | 'prism' | 'multimc' | 'official'

/** 加载器类型（与项目 loader 对齐） */
export type LauncherLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt' | 'vanilla'

/** 检测到的启动器信息 */
export interface LauncherInfo {
  id: string
  kind: LauncherKind
  name: string
  /** 可执行文件路径（手动添加时必填，自动检测时可能为空） */
  exePath: string
  /** 启动器数据目录（存实例/版本配置） */
  dataDir: string
  version?: string
  /** 是否为自动检测（false 表示用户手动添加） */
  autoDetected: boolean
}

/** 启动器实例（一个 Minecraft 版本目录） */
export interface LauncherInstance {
  id: string
  /** 所属启动器 ID */
  launcherId: string
  name: string
  /** 游戏根目录（.minecraft 或实例目录） */
  gamePath: string
  mcVersion: string
  loader?: LauncherLoader
  loaderVersion?: string
  lastUsed?: string
}

/** 手动添加启动器的输入 */
export interface AddLauncherInput {
  kind: LauncherKind
  name: string
  exePath: string
  /** 数据目录可选，留空则从 exePath 推导 */
  dataDir?: string
}

/** 一键导入构建产物的输入 */
export interface ImportInput {
  launcherId: string
  instanceId: string
  /** 构建产物 jar 路径 */
  artifactPath: string
  /** 是否覆盖同名文件 */
  overwrite?: boolean
}

/** 导入记录（持久化，用于导入历史与版本管理） */
export interface ImportRecord {
  id: string
  launcherId: string
  instanceId: string
  artifactPath: string
  destPath: string
  fileName: string
  importedAt: string
  /** 关联项目 ID（可选，用于溯源） */
  projectId?: string
}

/** 导入冲突信息（目标目录已存在同名文件且未指定 overwrite） */
export interface ImportConflict {
  /** 已存在文件名 */
  existingFileName: string
  /** 已存在文件完整路径 */
  existingPath: string
}

/** 导入结果 */
export interface ImportResult {
  ok: boolean
  record?: ImportRecord
  conflict?: ImportConflict
  error?: string
}

/** 批量导入输入（整合包启动测试一次性装入实例） */
export interface ImportBatchInput {
  launcherId: string
  instanceId: string
  /** 待导入源文件绝对路径（重复项自动去重） */
  artifactPaths: string[]
  /** 同名时是否覆盖，默认 false（已存在同名文件视为已就位，不重复复制） */
  overwrite?: boolean
}

/** 批量导入结果 */
export interface ImportBatchResult {
  /**
   * 是否全部就位：实例解析成功且无复制失败。
   * `conflicts` 表示目标已存在同名文件（视为已就位），不计为失败。
   */
  ok: boolean
  /** 本次实际复制的文件名 */
  imported: string[]
  /** 目标已存在同名文件、未复制的文件名 */
  conflicts: string[]
  /** 复制失败的文件 */
  failed: Array<{ fileName: string; error: string }>
  /** 实例 mods 目录绝对路径（供调用方做目录断言） */
  modsDir?: string
  error?: string
}

/** 检测结果 */
export interface DetectResult {
  launchers: LauncherInfo[]
  /** 各启动器检测过程中的错误（不阻断整体） */
  errors: string[]
}

/** 自动集成输入：按项目期望的版本/加载器挑选最合适的已装实例 */
export interface AutoIntegrateInput {
  /** 目标 Minecraft 版本（如 1.20.1）；留空则只按加载器与可用性挑选 */
  mcVersion?: string
  /** 目标加载器；留空则不按加载器打分 */
  loader?: LauncherLoader
  /** 关联项目 ID（用于记录集成映射，便于重启后恢复） */
  projectId?: string
}

/** 自动集成候选（已按匹配度打分） */
export interface AutoIntegrateCandidate {
  launcherId: string
  launcherName: string
  instanceId: string
  instanceName: string
  mcVersion: string
  loader?: LauncherLoader
  /** 匹配得分，越高越优先 */
  score: number
  /** 命中理由（面向用户展示） */
  reason: string
}

/** 自动集成结果 */
export interface AutoIntegrateResult {
  ok: boolean
  /** 选中的启动器 */
  launcher?: LauncherInfo
  /** 选中的实例 */
  instance?: LauncherInstance
  /** 实例 mods 目录绝对路径 */
  modsDir?: string
  /** 已持久化的激活实例 ID */
  activeInstanceId?: string
  /** 选中理由（面向用户展示） */
  reason?: string
  /** 全部候选（按得分降序，便于用户改选） */
  candidates: AutoIntegrateCandidate[]
  error?: string
}

/** 主进程持久化状态（重启后由渲染层恢复） */
export interface LauncherPersistedState {
  activeInstanceId: string | null
  activeLauncherId: string | null
  records: ImportRecord[]
}

/** 启动器事件阶段 */
export type LauncherEventPhase = 'detect' | 'import' | 'launch'

/** 启动器事件状态 */
export type LauncherEventStatus = 'start' | 'progress' | 'done' | 'failed'

/** 启动器事件（主进程 → 渲染，经 LAUNCHER_EVENT 推送） */
export interface LauncherEvent {
  phase: LauncherEventPhase
  status: LauncherEventStatus
  detail?: string
  /** 关联的导入记录 ID（import 阶段） */
  recordId?: string
}
