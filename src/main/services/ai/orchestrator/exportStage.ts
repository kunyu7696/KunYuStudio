// ---------------------------------------------------------------------------
// export：产物收集 / 整合包真实组装
// ---------------------------------------------------------------------------
import type {
  AgentEvent,
  AgentFileChange,
  BuildConclusion,
  ExportOutcome
} from '../../../../shared/types/agent'
import type { TierId } from '../../../../shared/types/tiers'
import { assembleModpack, type ModpackMeta } from '../../modpack/modpackAssembler'
import type { ModpackAssembleResult } from '../../../../shared/types/modpack'
import { latestBuiltJar } from '../../jarPicker'
import { planExport } from '../exportPlan'
import type { ResolvedProject } from './types'

/**
 * 执行 export 决策：由 planExport 纯函数分派，这里只做 IO。
 * 整合包项目走真实组装（不再被「build pass 且有 jar」短路）。
 */
export function collectExportOutcome(input: {
  tier: TierId
  project: ResolvedProject | null
  build: BuildConclusion | null
  files: AgentFileChange[]
  assemble?: (projectPath: string, meta: ModpackMeta) => ModpackAssembleResult
  /** 手动导出（AGENT_EXPORT_NOW）：不要求本次构建 pass，build/libs 有 jar 即导出 */
  manual?: boolean
}): ExportOutcome {
  const { tier, project, build, files, assemble, manual } = input
  const accepted = files
    .filter((f) => f.accepted)
    .map((f) => ({ kind: 'files' as const, path: f.path }))

  const action = planExport({
    tier,
    project,
    buildStatus: build?.status ?? null,
    jarPath: project ? latestBuiltJar(project.path) : null,
    manual
  })

  switch (action.kind) {
    case 'jar': {
      if (!action.jarPath) return { status: 'skipped', artifacts: accepted, summary: action.summary }
      return {
        status: 'ok',
        artifacts: [{ kind: 'jar', path: action.jarPath }],
        summary: action.summary
      }
    }

    case 'modpack-assemble': {
      if (!project) return { status: 'skipped', artifacts: accepted, summary: action.summary }
      if (!project.loader) {
        return {
          status: 'skipped',
          artifacts: accepted,
          summary:
            '缺少加载器元数据，无法组装整合包：请在项目元数据中补齐「MC 版本 + 加载器 + 加载器版本」。'
        }
      }
      const run = assemble ?? assembleModpack
      let result: ModpackAssembleResult
      try {
        result = run(project.path, {
          name: project.name,
          mcVersion: project.mcVersion,
          loader: project.loader,
          loaderVersion: project.loaderVersion
        })
      } catch (err) {
        return {
          status: 'skipped',
          artifacts: [],
          summary: `整合包组装失败（不影响构建结果）：${(err as Error).message}`
        }
      }
      const warnings = result.plan?.warnings ?? []
      const notes = warnings.length > 0 ? warnings : undefined
      if (!result.ok || !result.zipPath) {
        return {
          status: 'skipped',
          artifacts: [],
          summary: `整合包组装失败：${result.error ?? '未知错误'}`,
          notes
        }
      }
      const artifacts = [{ kind: 'zip' as const, path: result.zipPath }]
      if (result.cfZipPath) {
        artifacts.push({ kind: 'zip' as const, path: result.cfZipPath })
      }
      return {
        status: 'ok',
        artifacts,
        summary:
          `整合包已组装：${result.zipPath}` +
          (result.cfZipPath ? `（CF 版：${result.cfZipPath}）` : '') +
          `（${result.plan?.jars.length ?? 0} 个模组 / ${result.entryCount ?? 0} 个条目）`,
        notes
      }
    }

    default:
      return { status: 'skipped', artifacts: accepted, summary: action.summary }
  }
}

export function buildArtifact(id: string, build: BuildConclusion): AgentEvent['artifact'] {
  return {
    id,
    kind: 'build-result',
    title:
      build.status === 'pass'
        ? `真实构建通过（${build.rounds} 轮）`
        : build.status === 'fail'
          ? `构建失败（${build.rounds} 轮）`
          : '构建跳过',
    build,
    body: build.summary
  }
}
