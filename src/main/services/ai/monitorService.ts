/**
 * 版本漂移监测服务。
 *
 * 手动触发（无后台定时器）：抓四类官方源 → 与 17 组合指纹比对 →
 * 加载器版本升高则灯转 yellow、写漂移事件与 overlay；网络失败软失败，
 * 保留全部旧状态。组合数据来自 referencePackageService，监测状态
 * （事件/上次检查时间）持久化 userData/ai/version-matrix.json。
 */
import { app } from 'electron'
import { join } from 'node:path'
import type { ReferenceService } from './referencePackageService'
import {
  createUpstreamSources,
  type UpstreamSources
} from './upstreamSources'
import {
  compareMcVersions,
  compareVersions,
  loadMonitorState,
  nextDriftId,
  saveMonitorState,
  type MonitorPersist
} from './versionMatrix'
import type {
  ComboMatrixCell,
  DriftEvent,
  MonitorEvent,
  MonitorStage,
  MonitorState
} from '../../../shared/types/monitor'
import type { LoaderId } from '../../../shared/types/aiReference'

const STATE_FILE = 'version-matrix.json'

export interface MonitorServiceDeps {
  reference: ReferenceService
  statePath: string
  sources: UpstreamSources
  now?: () => Date
}

export interface MonitorService {
  getState(): MonitorState
  isChecking(): boolean
  runUpstreamCheck(): Promise<MonitorState>
  /** IPC 层注册事件广播（Task 9） */
  setEmitter(emit: ((e: MonitorEvent) => void) | null): void
}

interface LoaderLatest {
  comboId: string
  loader: LoaderId
  mcVersion: string
  latest: string
}

export function createMonitorService(deps: MonitorServiceDeps): MonitorService {
  let persist: MonitorPersist = loadMonitorState(deps.statePath)
  let checking = false
  let stage: MonitorStage = 'idle'
  let lastError: string | null = null
  let emitter: ((e: MonitorEvent) => void) | null = null
  let seq = 0
  const now = deps.now ?? (() => new Date())

  function emit(
    type: MonitorEvent['type'],
    extra?: Partial<MonitorEvent>
  ): void {
    if (!emitter) return
    seq += 1
    emitter({ type, seq, at: now().toISOString(), stage, ...extra })
  }

  function snapshotState(): MonitorState {
    return {
      checking,
      stage,
      lastCheckAt: persist.lastCheckAt,
      lastCheckError: lastError,
      cells: deps.reference.listMatrixCells(),
      events: [...persist.events].reverse()
    }
  }

  function cellsByLoader(loader: LoaderId): ComboMatrixCell[] {
    return deps.reference.listMatrixCells().filter((c) => c.loader === loader)
  }

  function maxTrackedMc(): string {
    return deps.reference
      .listMatrixCells()
      .map((c) => c.mcVersion)
      .reduce((acc, v) => (compareMcVersions(v, acc) > 0 ? v : acc), '1.0.0')
  }

  function driftEvent(
    comboId: string,
    kind: DriftEvent['kind'],
    fromVersion: string | null,
    toVersion: string,
    message: string
  ): DriftEvent {
    const at = now().toISOString()
    return { id: nextDriftId(at, seq + 1), comboId, kind, fromVersion, toVersion, at, message }
  }

  function applyLoaderDrift(latest: LoaderLatest[], newEvents: DriftEvent[]): void {
    const cells = new Map(deps.reference.listMatrixCells().map((c) => [c.id, c]))
    for (const item of latest) {
      const cell = cells.get(item.comboId)
      if (!cell) continue
      if (compareVersions(item.latest, cell.loaderVersion) <= 0) continue
      // 版本升高：red（回测失败）在重测前保留红灯，其余转 yellow
      const keepRed = deps.reference.getComboHealth(item.comboId) === 'red'
      deps.reference.recordUpstreamState({
        comboId: item.comboId,
        latestLoaderVersion: item.latest,
        ...(keepRed ? {} : { health: 'yellow' as const })
      })
      newEvents.push(
        driftEvent(
          item.comboId,
          'loader-new',
          cell.loaderVersion,
          item.latest,
          `${item.loader} ${item.mcVersion} 加载器 ${cell.loaderVersion} → ${item.latest}，待编译回测`
        )
      )
      emit('combo-drift', {
        comboId: item.comboId,
        drift: newEvents[newEvents.length - 1],
        message: `发现新版本：${item.latest}`
      })
    }
  }

  async function run(): Promise<MonitorState> {
    if (checking) throw new Error('版本监测正在进行中')
    checking = true
    lastError = null
    stage = 'fabric-meta'
    emit('check-started', { progress: 2, message: '开始检查上游版本源' })

    const fabricCells = cellsByLoader('fabric')
    const forgeCells = cellsByLoader('forge')
    const neoforgeCells = cellsByLoader('neoforge')
    const totalUrls = fabricCells.length + 3 // fabric 逐版本 + mojang/forge/neoforge
    let hit = 0
    const onUrl = (source: string): void => {
      hit += 1
      const map: Record<string, MonitorStage> = {
        fabric: 'fabric-meta',
        mojang: 'mojang-manifest',
        forge: 'forge-maven',
        neoforge: 'neoforge-maven'
      }
      stage = map[source] ?? stage
      emit('stage', {
        stage,
        progress: Math.min(90, 5 + Math.round((hit / totalUrls) * 85)),
        message: `请求 ${source} 源（${hit}/${totalUrls}）`
      })
    }

    const { snapshot, failures } = await deps.sources.fetchSnapshot({
      fabricMcVersions: fabricCells.map((c) => c.mcVersion),
      forgeMcVersions: forgeCells.map((c) => c.mcVersion),
      neoforgeMcVersions: neoforgeCells.map((c) => c.mcVersion),
      onUrl
    })

    stage = 'compare'
    emit('stage', { stage: 'compare', progress: 92, message: '比对版本指纹' })

    const newEvents: DriftEvent[] = []
    applyLoaderDrift(
      snapshot.fabric
        .filter((x) => x.latestLoader !== null)
        .map((x) => ({
          comboId: `fabric-${x.mcVersion}`,
          loader: 'fabric',
          mcVersion: x.mcVersion,
          latest: x.latestLoader as string
        })),
      newEvents
    )
    applyLoaderDrift(
      snapshot.forge
        .filter((x) => x.latestLoader !== null)
        .map((x) => ({
          comboId: `forge-${x.mcVersion}`,
          loader: 'forge',
          mcVersion: x.mcVersion,
          latest: x.latestLoader as string
        })),
      newEvents
    )
    applyLoaderDrift(
      snapshot.neoforge
        .filter((x) => x.latestLoader !== null)
        .map((x) => ({
          comboId: `neoforge-${x.mcVersion}`,
          loader: 'neoforge',
          mcVersion: x.mcVersion,
          latest: x.latestLoader as string
        })),
      newEvents
    )

    // 全局新 MC 版本（首次成功检查只记录基线，不产生事件）
    if (snapshot.latestMcRelease) {
      const trackedMax = maxTrackedMc()
      const baseline = persist.lastSeenMcRelease ?? trackedMax
      if (compareMcVersions(snapshot.latestMcRelease, baseline) > 0) {
        const ev = driftEvent(
          'global',
          'mc-new',
          baseline,
          snapshot.latestMcRelease,
          `Minecraft 发布新版本 ${snapshot.latestMcRelease}（已跟踪最高 ${trackedMax}）`
        )
        newEvents.push(ev)
        emit('combo-drift', { comboId: 'global', drift: ev })
      }
      persist.lastSeenMcRelease = snapshot.latestMcRelease
    }

    if (failures.length > 0) {
      const allFailed =
        failures.length >= 4 &&
        snapshot.fabric.every((x) => x.latestLoader === null) &&
        snapshot.forge.length === 0 &&
        snapshot.neoforge.length === 0
      lastError = failures.map((f) => `${f.source}: ${f.message}`).join('；')
      if (allFailed) {
        // 全源失败：不改变任何组合状态（事件也不追加）
        checking = false
        stage = 'done'
        persist.lastCheckAt = now().toISOString()
        saveMonitorState(deps.statePath, persist)
        const state = snapshotState()
        emit('check-finished', {
          progress: 100,
          state,
          message: `检查失败：${lastError}`
        })
        return state
      }
    }

    persist.lastCheckAt = now().toISOString()
    persist.events = [...persist.events, ...newEvents].slice(-100)
    saveMonitorState(deps.statePath, persist)

    checking = false
    stage = 'done'
    const state = snapshotState()
    emit('check-finished', {
      progress: 100,
      state,
      message:
        newEvents.length > 0
          ? `检查完成，发现 ${newEvents.length} 条漂移`
          : failures.length > 0
            ? `部分源失败：${lastError ?? ''}`
            : '检查完成，版本均为最新'
    })
    return state
  }

  return {
    getState: snapshotState,
    isChecking: () => checking,
    runUpstreamCheck: run,
    setEmitter(e) {
      emitter = e
    }
  }
}

/* ------------------------------ Electron 单例 ------------------------------ */

let singleton: MonitorService | null = null

export function defaultMonitorStatePath(): string {
  return join(app.getPath('userData'), 'ai', STATE_FILE)
}

export function initMonitorService(reference: ReferenceService): MonitorService {
  if (singleton) return singleton
  singleton = createMonitorService({
    reference,
    statePath: defaultMonitorStatePath(),
    sources: createUpstreamSources()
  })
  return singleton
}

export function getMonitorService(): MonitorService | null {
  return singleton
}
