/**
 * export 阶段动作决策（纯函数，无 IO 无 electron 依赖）。
 *
 * 修掉的缺陷：原实现先判 `build.status === 'pass'` 且在 build/libs 找到 jar 就 return，
 * 而模组项目必然命中该分支，导致织星的「整合包 zip」分支成为死代码 —— 整合包从未被组装过。
 * 现按项目类型优先分派：整合包项目一律走真实组装，其余项目保持原行为（零回归）。
 */
import type { ModLoader, ProjectType } from '../../../shared/types/project'
import { TIER_CONFIGS, type TierId } from '../../../shared/types/tiers'

/** 决策所需的最小项目信息 */
export interface ExportProjectInfo {
  id: string
  name: string
  path: string
  type: ProjectType
  mcVersion: string
  loader: ModLoader | null
  loaderVersion: string | null
}

export type ExportActionKind = 'none' | 'files' | 'jar' | 'modpack-assemble'

export interface ExportAction {
  kind: ExportActionKind
  summary: string
  /** kind === 'jar' 时的产物路径 */
  jarPath?: string
}

export interface ExportPlanInput {
  tier: TierId
  project: ExportProjectInfo | null
  /** 构建结论状态；未执行构建时为 null */
  buildStatus: 'pass' | 'fail' | 'skipped' | null
  /** `build/libs` 中最新的 jar 绝对路径（没有则为 null） */
  jarPath: string | null
  /**
   * 手动导出（用户点「导出产物」按钮）：导出已从流水线分离，用户显式点击时
   * 只要 build/libs 存在 jar 就允许导出——它可能是此前构建/用户手动构建的产物，
   * 是否过期由用户自行判断；不再要求本次运行 build 必须 pass。
   */
  manual?: boolean
}

/**
 * 决定 export 阶段做什么。判定顺序自上而下短路：
 * 1. 无项目 → 仅汇报生成片段清单
 * 2. 整合包项目 → 真实组装（**不看 build 状态**：整合包无 gradle 工程，build 必为 skipped）
 * 3. 构建通过且有 jar → 导出 jar（普通模组项目零回归）
 * 4. 织星兜底 → 不导出（整目录 zip 兜底已废除——
 *    把含 build/、.gradle 的整个项目目录打成 modpack.zip 还报「整合包已导出」属假绿灯）
 * 5. 其余 → 不导出
 */
export function planExport(input: ExportPlanInput): ExportAction {
  const { tier, project, buildStatus, jarPath, manual } = input

  if (!project) {
    return {
      kind: 'files',
      summary: '无打开项目：仅汇报生成片段清单，未产出构建产物。'
    }
  }

  if (project.type === 'modpack') {
    return {
      kind: 'modpack-assemble',
      summary: `组装整合包：${project.name}`
    }
  }

  if (jarPath && (buildStatus === 'pass' || manual)) {
    return {
      kind: 'jar',
      jarPath,
      summary: `构建产物：${jarPath.split(/[\\/]/).pop() ?? jarPath}（${project.name}）`
    }
  }

  if (TIER_CONFIGS[tier].flags.orchestrator && buildStatus !== 'fail') {
    return {
      kind: 'none',
      summary:
        buildStatus === 'pass'
          ? '构建通过但未找到可分发 jar（build/libs 无产物），已跳过导出——不再整目录打包冒充产物，请检查构建输出。'
          : '未执行构建，无可分发产物，本次不导出。'
    }
  }

  return {
    kind: 'none',
    summary:
      buildStatus === 'pass'
        ? '构建通过但未找到 jar 产物（请检查 build/libs）。'
        : '构建未通过，本次不导出。'
  }
}