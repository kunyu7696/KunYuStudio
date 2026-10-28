/**
 * 特性⑤ CI/CD 集成类型层。
 *
 * 集中维护 CI 配置类型与防御性解析函数，供主进程 ciExportService、
 * 渲染进程 CiCdView 与 IPC 层共享。
 *
 * 设计约定：
 * - workflows：三类工作流开关（build / release / gametest）
 * - matrix.loaders：CI 矩阵加载器列表（fabric / forge / neoforge 子集）
 * - publish：发布平台开关，仅决定 release.yml 是否注入对应步骤，
 *   实际发布由用户在 GitHub Actions UI 手动 workflow_dispatch 触发（AI 不替用户做决定）
 * - secrets：GitHub Secrets 名称（非密钥本身），用户可在仓库设置里改
 */
import type { ModLoader } from './project'

/** 工作流类型 */
export type CiWorkflowKind = 'build' | 'release' | 'gametest'

/** CI 配置（.kunyu/ci-config.json 的结构） */
export interface CiConfig {
  workflows: {
    build: boolean
    release: boolean
    gametest: boolean
  }
  matrix: {
    loaders: ModLoader[]
  }
  publish: {
    githubRelease: boolean
    modrinth: boolean
    curseforge: boolean
  }
  secrets: {
    /** Modrinth token 的 GitHub Secret 名称（默认 MODRINTH_TOKEN） */
    modrinth: string
    /** CurseForge token 的 GitHub Secret 名称（默认 CURSEFORGE_TOKEN） */
    curseforge: string
  }
}

/** CI 导出结果 */
export interface CiExportResult {
  ok: boolean
  /** 已写入的工作流文件相对路径（如 .github/workflows/build.yml） */
  workflows: string[]
  /** 已写入的构建脚本相对路径（如 .kunyu/ci/build-fabric.gradle） */
  buildScripts: string[]
  error?: string
}

/**
 * 生成默认 CI 配置。
 * - build + gametest 默认开启（编译验证 + 无头测试是基础质量门禁）
 * - release 默认关闭（发布需用户显式启用，避免误触发）
 * - 矩阵仅含传入 loader（用户可在 UI 扩展为三加载器）
 * - publish 全部关闭，secrets 用约定默认名
 */
export function createDefaultCiConfig(loader: ModLoader): CiConfig {
  return {
    workflows: {
      build: true,
      release: false,
      gametest: true
    },
    matrix: {
      loaders: [loader]
    },
    publish: {
      githubRelease: false,
      modrinth: false,
      curseforge: false
    },
    secrets: {
      modrinth: 'MODRINTH_TOKEN',
      curseforge: 'CURSEFORGE_TOKEN'
    }
  }
}

function isModLoader(v: unknown): v is ModLoader {
  return v === 'fabric' || v === 'forge' || v === 'neoforge'
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * 防御性解析 CI 配置。
 * - 非 plain object → null
 * - 字段缺失或类型不符 → 用默认值兜底（workflows/publish/secrets 全部有兜底）
 * - matrix.loaders 为空数组 → 兜底为 ['fabric']
 * - 未知 loader 值 → 过滤掉
 */
export function parseCiConfig(raw: unknown): CiConfig | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const obj = raw as Record<string, unknown>
  const fallback = createDefaultCiConfig('fabric')

  const workflowsRaw = obj.workflows
  const workflows = (workflowsRaw !== null && typeof workflowsRaw === 'object' && !Array.isArray(workflowsRaw))
    ? workflowsRaw as Record<string, unknown>
    : {}

  const matrixRaw = obj.matrix
  const matrix = (matrixRaw !== null && typeof matrixRaw === 'object' && !Array.isArray(matrixRaw))
    ? matrixRaw as Record<string, unknown>
    : {}

  const publishRaw = obj.publish
  const publish = (publishRaw !== null && typeof publishRaw === 'object' && !Array.isArray(publishRaw))
    ? publishRaw as Record<string, unknown>
    : {}

  const secretsRaw = obj.secrets
  const secrets = (secretsRaw !== null && typeof secretsRaw === 'object' && !Array.isArray(secretsRaw))
    ? secretsRaw as Record<string, unknown>
    : {}

  const rawLoaders = Array.isArray(matrix.loaders) ? matrix.loaders : []
  const loaders = rawLoaders.filter(isModLoader)
  if (loaders.length === 0) {
    loaders.push('fabric')
  }

  return {
    workflows: {
      build: isBool(workflows.build) ? workflows.build : fallback.workflows.build,
      release: isBool(workflows.release) ? workflows.release : fallback.workflows.release,
      gametest: isBool(workflows.gametest) ? workflows.gametest : fallback.workflows.gametest
    },
    matrix: { loaders },
    publish: {
      githubRelease: isBool(publish.githubRelease) ? publish.githubRelease : fallback.publish.githubRelease,
      modrinth: isBool(publish.modrinth) ? publish.modrinth : fallback.publish.modrinth,
      curseforge: isBool(publish.curseforge) ? publish.curseforge : fallback.publish.curseforge
    },
    secrets: {
      modrinth: isStr(secrets.modrinth) ? secrets.modrinth : fallback.secrets.modrinth,
      curseforge: isStr(secrets.curseforge) ? secrets.curseforge : fallback.secrets.curseforge
    }
  }
}
