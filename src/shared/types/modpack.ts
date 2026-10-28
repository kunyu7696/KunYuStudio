/**
 * 整合包真实组装共享类型（织星导出：双平台清单 + overrides + dist zip）。
 * 主进程组装器产出，渲染层 ModpackView 与产物卡消费。
 */
import type { ModLoader } from './project'
import type { ContentPackSummary } from './contentPack'

/** 模组来源平台：两个平台可反查下载坐标，local 表示手工拖入（只能走 overrides） */
export type ModSourcePlatform = 'curseforge' | 'modrinth' | 'local'

/** 运行环境三态（同 Modrinth client_side/server_side 语义） */
export type SideRequirement = 'required' | 'optional' | 'unsupported'

/** jar 的运行环境要求（client/server） */
export interface JarEnv {
  client: SideRequirement
  server: SideRequirement
}

/** 单个模组 jar 的来源记录（安装时写入 `.kunyu/modpack.json`） */
export interface ModSourceEntry {
  /** `run/mods` 下的文件名（唯一键） */
  fileName: string
  platform: ModSourcePlatform
  /** 平台内 mod/project id；local 为空串 */
  modId: string
  /** 平台版本文件 id（CF fileID / MR version id）；local 为空串 */
  versionId: string
  /** 平台 slug（CF slug / MR slug）；local 为空串 */
  slug: string
  /** 展示名 */
  name: string
  /** 人类可读版本号 */
  versionNumber: string
  /** 下载直链（CF 部分文件无直链，为 null） */
  downloadUrl: string | null
  /** 安装时文件大小（字节），用于识别本地文件已被替换 */
  size: number
  /**
   * 安装时平台权威 sha1（Modrinth hashes.sha1；CF/旧记录无值）。
   * 组装整合包时优先按此比对内容，同尺寸替换也能识别（P1-10）。
   */
  sha1?: string
  /** Modrinth project 侧别（安装时记录，组装 env 的权威信号）；旧记录/CF/local 无值 */
  clientSide?: SideRequirement
  serverSide?: SideRequirement
  /**
   * 许可协议 SPDX id（P3-1a：安装时从平台详情落盘）。
   * 组装整合包时按此判定「随包 overrides 再分发」合规性；
   * CurseForge API 不返回许可字段，CF 记录与旧记录无值（组装时按 unknown 轻提示）。
   */
  license?: string
  /** 安装时间 ISO */
  installedAt: string
}

/** `.kunyu/modpack.json` 结构 */
export interface ModpackSourcesFile {
  version: 1
  entries: ModSourceEntry[]
}

/** jar 去向：进 CF 清单 / 进 Modrinth 清单 / 只随包到 overrides */
export type ModJarDisposition = 'curseforge-files' | 'modrinth-files' | 'overrides'

/** 单个候选 jar 的组装计划 */
export interface ModJarPlan {
  fileName: string
  size: number
  disposition: ModJarDisposition
  /** 是否随包到 `overrides/mods/<fileName>`（清单无法覆盖时必须开，否则内容丢失） */
  bundledInOverrides: boolean
  /** 运行环境要求（client/server 三态），client-only 模组 server=unsupported */
  env: JarEnv
  /** 归类理由（中文明文，计划表展示） */
  reason: string
}

/** 被排除的文件 */
export interface ModpackExclusion {
  fileName: string
  reason: string
}

/** CurseForge `manifest.json` 的 files 条目 */
export interface CurseForgeFileEntry {
  projectID: number
  fileID: number
  required: boolean
}

/** Modrinth `modrinth.index.json` 的 files 条目 */
export interface ModrinthFileEntry {
  path: string
  hashes: { sha1: string; sha512: string }
  fileSize: number
  downloads: string[]
  env: JarEnv
}

/** 组装计划（干跑 `modpack:preview` 与实跑共用同一结构） */
export interface ModpackPlan {
  name: string
  mcVersion: string
  loader: ModLoader
  loaderVersion: string | null
  /** 计划写入 zip 的条目路径（POSIX，已排序） */
  zipEntries: string[]
  curseforgeFiles: CurseForgeFileEntry[]
  modrinthFiles: ModrinthFileEntry[]
  jars: ModJarPlan[]
  exclusions: ModpackExclusion[]
  /** 内容包概要（禁用包也列出，enabled:false 供 UI 展示） */
  packs: ContentPackSummary[]
  /** 非阻断告警（降级、许可提示等） */
  warnings: string[]
}

/** 干跑预览结果（`modpack:preview`，不落盘） */
export interface ModpackPreviewResult {
  ok: boolean
  error?: string
  plan?: ModpackPlan
}

/** 整合包目标平台（P1-4：分平台出包） */
export type ModpackPlatform = 'modrinth' | 'curseforge'

/** 组装结果 */
export interface ModpackAssembleResult {
  ok: boolean
  /** Modrinth .mrpack 产物绝对路径（client-only 模组落 client-overrides/mods） */
  zipPath?: string
  /** CurseForge .zip 产物绝对路径（所有模组落 overrides/mods，CF 不认 client-overrides） */
  cfZipPath?: string
  plan?: ModpackPlan
  /** 实际写入的 zip 条目数（MR 包，CF 包条目数可能不同） */
  entryCount?: number
  error?: string
}

/**
 * 启动测试判定。
 * ready 行不足为证：`world-joined` 为最强判定——
 * 日志增量中捕获到真实世界加入标记（Preparing spawn area / joined the game 等），
 * 优于仅见「Loading N mods」就绪行的 `mods-visible`。
 */
export type LaunchTestVerdict =
  | 'world-joined'
  | 'mods-visible'
  | 'launched-only'
  | 'crashed'
  | 'timeout'
  | 'failed'

/**
 * 启动测试场景断言（P1③）：把单一日志行判定升级为显式断言链，
 * 三态语义与 Agent 验收面板一致——verified 有实证 / inconclusive 未验证（不计入失败，
 * 也不计入已验证）/ failed 明确失败。
 */
export interface LaunchTestAssertion {
  id: 'mods-in-instance' | 'game-boot' | 'mods-loaded' | 'world-join'
  /** 中文标签 */
  label: string
  state: 'verified' | 'failed' | 'inconclusive'
  /** 证据一句话（日志行 / 目录断言计数 / 未验证原因） */
  evidence?: string
}

/** 启动测试输入（渲染层只负责定位项目与实例，版本/加载器由主进程从项目记录补齐） */
export interface LaunchTestInput {
  /** 整合包项目根（待装模组取自其 run/mods） */
  projectPath: string
  launcherId: string
  instanceId: string
  /** 轮询日志增量的超时（毫秒），默认 90 秒 */
  timeoutMs?: number
}

/** 启动测试最近结果落盘记录（.kunyu/launch-test-last.json；P4 发布 preflight 质量门读取） */
export interface LaunchTestRecord {
  /** 完成时间（ms epoch） */
  at: number
  verdict: LaunchTestVerdict
  ok: boolean
  summary: string
}

/** 启动测试结果 */
export interface LaunchTestResult {
  ok: boolean
  verdict: LaunchTestVerdict
  /** 计划导入实例的模组文件名 */
  planned?: string[]
  /** 目录断言：实例 mods 目录中实际存在的计划文件 */
  verifiedInInstance?: string[]
  /** 目录断言缺失的计划文件 */
  missing?: string[]
  /** 日志增量中解析到的关键行 */
  logSignals?: string[]
  /** P1③ 场景断言链：mods-in-instance / game-boot / mods-loaded / world-join 逐项三态 */
  assertions?: LaunchTestAssertion[]
  /** 人类可读回执（含诚实边界说明） */
  summary: string
  error?: string
}

/* ================================================================== */
/* M18：整合包直发 Modrinth / CurseForge                                */
/* ================================================================== */

export type PublishPlatform = 'modrinth' | 'curseforge'
export type PublishReleaseType = 'release' | 'beta' | 'alpha'

/** 发布输入（渲染层传入；mcVersion/loader 由主进程从项目记录补齐） */
export interface PublishModpackInput {
  /** Modrinth 产物（.mrpack）绝对路径；主进程会按平台重新解析并对齐 */
  zipPath: string
  /** CurseForge 产物（-cf.zip）绝对路径（P0-6）；缺省由主进程从 dist/ 解析 */
  cfZipPath?: string
  versionNumber: string
  title: string
  changelog: string
  releaseType: PublishReleaseType
}

/** 单平台发布结果 */
export interface PublishResultEntry {
  platform: PublishPlatform
  ok: boolean
  url?: string
  error?: string
}

/** 发布执行结果 */
export interface PublishModpackResult {
  ok: boolean
  results?: PublishResultEntry[]
  error?: string
}

/** 发布预检结果 */
export interface PublishPreflightResult {
  ok: boolean
  error?: string
  /**
   * 各平台产物（P0-6）：路径由主进程解析，预检展示与实际上传对齐同一文件。
   * 此前预检扫 `*.zip`（只命中 -cf.zip）而 CF 上传的是 .mrpack，两者并非同一文件。
   */
  mrpack?: { path: string; exists: boolean; mtime: number }
  cfZip?: { path: string; exists: boolean; mtime: number }
  /** 各平台 token+项目ID 就绪度 */
  ready?: { modrinth: boolean; curseforge: boolean }
  /** CF gameVersions 匹配预览（未配置 token 时为 null） */
  cfVersions?: { ready: boolean; gameVersionIds: number[]; suggestions: string[] } | null
  /**
   * 验收门禁：该项目最近一次 Agent 运行的契约摘要（无运行/无契约/查询失败时为 null）。
   * unverifiedCount > 0 时发布对话框应禁用「确认发布」（验证三态显式化 #1）。
   */
  contractGate?: { overall: string; unverifiedCount: number; total: number } | null
}