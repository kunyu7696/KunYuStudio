import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  assembleModpack,
  findLatestDistArtifacts,
  previewModpack,
  type ModpackMeta
} from '../../services/modpack/modpackAssembler'
import { createContentPack, scanContentPacks, setPackEnabled } from '../../services/modpack/contentPackIo'
import { readSources } from '../../services/modpack/provenance'
import { createSystemLaunchTestDeps, persistLaunchTestResult, runLaunchTest } from '../../services/modpack/launchTest'
import { getAllProjects } from '../../services/projectService'
import { getSection } from '../../services/settingsService'
import { publishModpack, preflightCurseForge, type PublishPlatform } from '../../services/publish/publishService'
import { runReleaseQualityGates } from '../../services/publish/releaseGates'
import { getReferenceService } from '../../services/ai/referencePackageService'
import { getDb } from '../../services/db'
import { createAgentRunStore } from '../../services/agentRunStore'
import type { LaunchTestInput, PublishModpackInput } from '../../../shared/types/modpack'
import type { CreatePackInput } from '../../../shared/types/contentPack'
import type { IpcContext } from '../context'

/**
 * 整合包组装目标的解析结果。
 * 组装**仅限 `type === 'modpack'` 的项目**，且元数据一律取自项目记录（不信任渲染层传参），
 * 避免「用别的项目的版本信息生成清单」这类难以排查的错误。
 */
type ModpackTarget =
  | { ok: true; root: string; projectId: string | null; meta: ModpackMeta }
  | { ok: false; error: string }

function resolveModpackTarget(projectPath: string): ModpackTarget {
  const project = getAllProjects().find((p) => p.path === projectPath)
  if (!project) {
    return { ok: false, error: '未找到该项目，请重新打开项目后再试。' }
  }
  if (project.type !== 'modpack') {
    return { ok: false, error: '只有「整合包」类型的项目支持组装与导出。' }
  }
  if (!project.loader) {
    return {
      ok: false,
      error: '项目缺少模组加载器元数据（Fabric / Forge / NeoForge），无法生成平台清单。'
    }
  }
  return {
    ok: true,
    root: project.path,
    projectId: project.id,
    meta: {
      name: project.name,
      mcVersion: project.mcVersion,
      loader: project.loader,
      loaderVersion: project.loaderVersion
    }
  }
}

/**
 * 验收门禁（验证三态显式化 #1）：查该项目最近一次 Agent 运行产出的最新验收契约，
 * 归一三态后统计未验证数（旧值 skipped 也计入）。无运行/无契约/DB 异常 → null（门禁放行）。
 */
function findLatestContractGate(
  projectId: string | null
): { overall: string; unverifiedCount: number; total: number } | null {
  if (!projectId) return null
  const norm = (s: string): string => (s === 'skipped' ? 'unverified' : s)
  try {
    const runs = createAgentRunStore(getDb()).listRuns({ projectId, limit: 10 })
    for (const run of runs) {
      const events = createAgentRunStore(getDb()).getRunEvents(run.id)
      const contractEvent = [...events].reverse().find((e) => e.artifact?.kind === 'contract')
      const contract = contractEvent?.artifact?.contract
      if (!contract) continue
      const assertions = contract.assertions ?? []
      return {
        overall: norm(contract.overall),
        unverifiedCount: assertions.filter((a) => norm(a.status) === 'unverified').length,
        total: assertions.length
      }
    }
  } catch {
    /* DB 异常时门禁降级为不拦截 */
  }
  return null
}

/** 质量门依赖：组合健康度接参考包服务（releaseGates 保持无 electron 依赖，便于单测） */
function runQualityGates(root: string, meta: { mcVersion: string; loader: string }) {
  return runReleaseQualityGates(root, meta, {
    getHealth: (loader, mcVersion) => getReferenceService().getComboHealth(`${loader}-${mcVersion}`)
  })
}

/** 整合包真实组装：仅 modpack 项目可组装 + 启动测试前的来源记录读取 */
export function registerModpackHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.MODPACK_PREVIEW, (_event, projectPath: string) => {
    const target = resolveModpackTarget(projectPath)
    if (!target.ok) return { ok: false, error: target.error }
    const result = previewModpack(target.root, target.meta)
    return { ok: result.ok, error: result.error, plan: result.plan }
  })
  ipcMain.handle(IpcChannels.MODPACK_ASSEMBLE, (_event, projectPath: string) => {
    const target = resolveModpackTarget(projectPath)
    if (!target.ok) return { ok: false, error: target.error }
    return assembleModpack(target.root, target.meta)
  })
  ipcMain.handle(IpcChannels.MODPACK_LIST_SOURCES, (_event, projectPath: string) => {
    const target = resolveModpackTarget(projectPath)
    if (!target.ok) return []
    return [...readSources(target.root).values()]
  })
  // 内容包模块化：列表 / 启用开关 / 新建（入参只收标量与 plain 对象，防结构化克隆失败）
  ipcMain.handle(IpcChannels.MODPACK_LIST_PACKS, (_event, projectPath: string) => {
    const target = resolveModpackTarget(projectPath)
    if (!target.ok) return []
    return scanContentPacks(target.root)
  })
  ipcMain.handle(
    IpcChannels.MODPACK_SET_PACK_ENABLED,
    (_event, projectPath: string, packId: string, enabled: boolean) => {
      const target = resolveModpackTarget(projectPath)
      if (!target.ok) return { ok: false, error: target.error }
      return setPackEnabled(target.root, packId, enabled)
    }
  )
  ipcMain.handle(IpcChannels.MODPACK_CREATE_PACK, (_event, projectPath: string, input: CreatePackInput) => {
    const target = resolveModpackTarget(projectPath)
    if (!target.ok) return { ok: false, error: target.error }
    return createContentPack(target.root, {
      id: String(input?.id ?? ''),
      name: String(input?.name ?? ''),
      category: input?.category,
      description: input?.description,
      author: input?.author
    })
  })
  ipcMain.handle(IpcChannels.MODPACK_LAUNCH_TEST, async (_event, input: LaunchTestInput) => {
    const target = resolveModpackTarget(input.projectPath)
    if (!target.ok) {
      return {
        ok: false,
        verdict: 'failed',
        summary: '启动测试未执行。',
        error: target.error
      }
    }
    // 版本/加载器预检信息一律取自项目记录，不使用渲染层传入值
    const result = await runLaunchTest(
      {
        ...input,
        projectPath: target.root,
        mcVersion: target.meta.mcVersion,
        loader: target.meta.loader
      },
      createSystemLaunchTestDeps(ctx.launcherService)
    )
    // P4 质量门：落盘最近一次结果，发布 preflight 的「运行验收」门据此判定
    persistLaunchTestResult(target.root, result)
    return result
  })

  /** 整合包发布：按勾选平台直发 Modrinth / CurseForge（M18） */
  ipcMain.handle(
    IpcChannels.MODPACK_PUBLISH,
    async (
      _event,
      projectPath: string,
      input: PublishModpackInput,
      platforms: PublishPlatform[]
    ) => {
      const target = resolveModpackTarget(projectPath)
      if (!target.ok) return { ok: false, error: target.error }
      // P4 发布质量门：许可/依赖/运行验收硬门不过 → fail fast，不触碰网络
      // （软告警不拦截，在发布预检面板如实呈现由人定夺）
      const gates = runQualityGates(target.root, target.meta)
      if (!gates.ready) {
        const msg =
          '发布质量门未通过：' +
          gates.checks
            .filter((c) => c.severity === 'block' && !c.ok)
            .map((c) => `${c.label}${c.detail ? `（${c.detail}）` : ''}`)
            .join('；')
        return { ok: false, error: msg }
      }
      const s = getSection('publish')
      const auth = {
        modrinth: s.modrinthToken && s.modrinthProjectId ? { token: s.modrinthToken, projectId: s.modrinthProjectId } : undefined,
        curseforge: s.curseforgeToken && s.curseforgeProjectId ? { token: s.curseforgeToken, projectId: s.curseforgeProjectId } : undefined
      }
      // P0-6：产物路径由主进程按平台解析，预检与上传对齐同一文件；
      // 渲染层传入路径仅在存在且扩展名正确时采纳，否则回退 dist/ 最新产物
      const artifacts = findLatestDistArtifacts(join(target.root, 'dist'))
      const mrpackPath =
        input.zipPath && input.zipPath.endsWith('.mrpack') && existsSync(input.zipPath)
          ? input.zipPath
          : artifacts.mrpackPath
      const cfZipPath =
        input.cfZipPath && input.cfZipPath.endsWith('-cf.zip') && existsSync(input.cfZipPath)
          ? input.cfZipPath
          : artifacts.cfZipPath
      // 产物缺失的平台不进发布链路，以结果条目如实报错（部分失败不回滚）
      const runnable: PublishPlatform[] = []
      const results = []
      for (const p of platforms) {
        const missing =
          p === 'modrinth'
            ? !mrpackPath || !existsSync(mrpackPath)
            : !cfZipPath || !existsSync(cfZipPath)
        if (missing) {
          results.push({
            platform: p,
            ok: false,
            error:
              p === 'modrinth'
                ? '未找到 Modrinth 产物（dist/*.mrpack），请先执行「组装并导出」。'
                : '未找到 CurseForge 产物（dist/*-cf.zip），请先执行「组装并导出」。'
          })
        } else {
          runnable.push(p)
        }
      }
      if (runnable.length === 0) return { ok: true, results }
      try {
        const svcResults = await publishModpack(
          { ...input, zipPath: mrpackPath, cfZipPath, mcVersion: target.meta.mcVersion, loader: target.meta.loader },
          runnable,
          auth
        )
        return { ok: true, results: [...results, ...svcResults] }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  /** 发布预检：按平台产物存在性 / CF 版本匹配（M18；P0-6 与上传对齐同一文件） */
  ipcMain.handle(
    IpcChannels.MODPACK_PUBLISH_PREFLIGHT,
    async (_event, projectPath: string) => {
      const target = resolveModpackTarget(projectPath)
      if (!target.ok) return { ok: false, error: target.error }
      const artifacts = findLatestDistArtifacts(join(target.root, 'dist'))
      const s = getSection('publish')
      const ready = {
        modrinth: !!(s.modrinthToken && s.modrinthProjectId),
        curseforge: !!(s.curseforgeToken && s.curseforgeProjectId)
      }
      let cfVersions: { ready: boolean; gameVersionIds: number[]; suggestions: string[] } | null = null
      if (ready.curseforge) {
        try {
          cfVersions = await preflightCurseForge(s.curseforgeToken, target.meta.mcVersion, target.meta.loader)
        } catch {
          cfVersions = { ready: false, gameVersionIds: [], suggestions: [] }
        }
      }
      return {
        ok: true,
        mrpack: {
          path: artifacts.mrpackPath,
          exists: !!artifacts.mrpackPath && existsSync(artifacts.mrpackPath),
          mtime: artifacts.mrpackMtime
        },
        cfZip: {
          path: artifacts.cfZipPath,
          exists: !!artifacts.cfZipPath && existsSync(artifacts.cfZipPath),
          mtime: artifacts.cfZipMtime
        },
        ready,
        cfVersions,
        contractGate: findLatestContractGate(target.projectId),
        // P4：质量门全量项（block+warn）透传到发布面板逐项展示
        qualityGates: runQualityGates(target.root, target.meta)
      }
    }
  )
}
