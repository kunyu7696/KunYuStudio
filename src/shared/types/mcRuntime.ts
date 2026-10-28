/**
 * MC 运行时置备共享类型（零配置运行环境 3b）。
 *
 * 覆盖：版本清单 / 单版本 JSON / 库与 natives / 资产索引与对象 / 托管实例元数据 /
 * 置备进度与结果。主进程置备服务与渲染进程向导共用，不含任何进程相关依赖。
 *
 * 授权/边界：不对游戏本体与资产做任何再分发，全部由用户在首启向导触发后联网从
 * 官方或国内镜像（BMCLAPI）下载；镜像地址一律可配置，禁止锁死第三方 ID。
 */

/** 版本清单（version_manifest_v2.json）中的单条版本摘要 */
export interface McVersionSummary {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  /** 单版本 JSON 的官方下载地址（置备时按镜像重写） */
  url: string
  /** 官方给出的单版本 JSON 校验和（v2 清单含 sha1，用于下载后校验） */
  sha1?: string
  size?: number
  time: string
  releaseTime: string
}

export interface McVersionManifest {
  latest: { release: string; snapshot: string }
  versions: McVersionSummary[]
}

/** 规则（库 / natives / 参数通用）：命中当前上下文则该条生效 */
export interface McRule {
  action: 'allow' | 'disallow'
  os?: { name?: string; version?: string; arch?: string }
  features?: Record<string, boolean>
}

/** 单文件下载描述（库 / 客户端 / 资产索引共用） */
export interface McDownload {
  /** 相对路径（库为 maven 相对路径；资产索引为固定文件名） */
  path?: string
  url: string
  sha1?: string
  sha256?: string
  size?: number
}

export interface McLibrary {
  name: string
  downloads?: {
    artifact?: McDownload
    classifiers?: Record<string, McDownload>
  }
  /** 平台 → natives 分类器模板（如 windows → natives-windows-${arch}） */
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  rules?: McRule[]
}

export interface McAssetIndexRef {
  id: string
  sha1: string
  size: number
  totalSize: number
  url: string
}

/** 参数条目：纯字符串，或带规则的字符串/字符串数组 */
export type McArgumentEntry = string | { rules?: McRule[]; value: string | string[] }

export interface McVersionDetail {
  id: string
  type?: string
  mainClass: string
  /** 资产目录名（${assets_index_name}）：1.7+ 为 "minecraft" 风格短名 */
  assets: string
  assetIndex: McAssetIndexRef
  downloads: { client?: McDownload; server?: McDownload; [k: string]: McDownload | undefined }
  libraries: McLibrary[]
  /** 1.13+ 结构；旧版本可能只有 minecraftArguments */
  arguments?: { game: McArgumentEntry[]; jvm: McArgumentEntry[] }
  /** 1.12- 旧结构的游戏参数（空格分隔） */
  minecraftArguments?: string
  javaVersion?: { majorVersion: number; component: string }
}

/** 资产索引（indexes/<id>.json） */
export interface McAssetIndex {
  objects: Record<string, { hash: string; size: number }>
}

/** 托管实例元数据（userData/mcinstances/<id>/instance.json） */
export interface McInstance {
  id: string
  name: string
  mcVersion: string
  createdAt: string
  lastUsedAt: string | null
}

/** 置备进度阶段 */
export type McProvisionPhase = 'resolve' | 'version' | 'client' | 'libraries' | 'assets' | 'done'

export interface McProvisionProgress {
  phase: McProvisionPhase
  /** 总体 0-100（粗粒度） */
  progress: number
  message?: string
  /** 当前阶段的条目进度（库/资产文件数） */
  current?: number
  total?: number
  /** 字节进度（client jar 等大文件） */
  loadedBytes?: number
  totalBytes?: number
}

export interface McProvisionInput {
  /** 目标 MC 版本 id（如 "1.21.1"） */
  mcVersion: string
  /** 托管实例 id；缺省用 mcVersion 生成 */
  instanceId?: string
  /** 实例显示名；缺省用 mcVersion */
  name?: string
  /** 覆盖镜像基地址（空串=官方直连）；缺省按网络设置解析 */
  mirror?: string
  /** 覆盖实例根目录（测试用）；缺省 userData/mcinstances */
  instancesRoot?: string
  /** 是否下载全部资产对象（默认 true；关闭时仅写索引，首次启动再补） */
  downloadAssets?: boolean
}

/** 单版本置备的摘要产物（渲染层展示/后续启动用） */
export interface McProvisionInfo {
  instanceId: string
  mcVersion: string
  mainClass: string
  assets: string
  assetIndexId: string
  /** 版本 JSON 声明的 Java 主版本（无声明为 null） */
  javaMajor: number | null
}

export type McProvisionResult =
  | { ok: true; instance: McInstance; info: McProvisionInfo }
  | { ok: false; errorMessage: string }

/** 托管实例启动输入（零配置运行环境 3b 的真实启动接线） */
export interface McLaunchInput {
  /** 托管实例 id（userData/mcinstances/<id>） */
  instanceId: string
  /** 覆盖实例根目录（测试用）；缺省 userData/mcinstances */
  instancesRoot?: string
  /** 覆盖游戏窗口分辨率；缺省沿用版本 JSON 声明（854×480） */
  width?: number
  height?: number
  /** 覆盖最大堆内存（MB）；缺省取设置 java.gradleMemoryMb */
  memoryMb?: number
}

export type McLaunchResult =
  | { ok: true; pid: number | null; mcVersion: string; mainClass: string }
  | { ok: false; errorMessage: string }
