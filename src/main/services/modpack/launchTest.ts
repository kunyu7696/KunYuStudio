/**
 * 整合包启动测试（真实往返：组装产物 → 装入启动器实例 → 启动 → 日志增量判定）。
 *
 * 诚实边界：`launcherService.launch` 只负责 spawn 启动器本体，不保证自动进入目标实例。
 * 因此「模组确实进了实例」由**目录断言**保证，「游戏内可见」由**日志增量**保证；
 * 拿不到日志就如实报 `launched-only` / `timeout`，绝不报假成功。
 *
 * ready 行不足为证：`Loading N mods` 只是就绪行，
 * 真机世界加入标记（Preparing spawn area / joined the game）才是更强证据——
 * 轮询在 mods 就绪后追加短宽限窗捕获 join 标记，命中即升级 `world-joined`；
 * 判定结果附带场景断言链（实例目录 / 引导 / 模组加载 / 世界加入 逐项三态）。
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { LauncherInstance, LauncherKind } from '../../../shared/types/launcher'
import type {
  LaunchTestAssertion,
  LaunchTestInput,
  LaunchTestRecord,
  LaunchTestResult,
  LaunchTestVerdict
} from '../../../shared/types/modpack'
import { getInstanceSubDir } from '../launcherService'
import { isGameVessel } from './classify'
import { scanModCandidates } from './modpackAssembler'
import type { ImportBatchInput, ImportBatchResult } from '../../../shared/types/launcher'

/** 启动测试依赖（进程与实例解析可注入，文件读取走真实磁盘） */
export interface LaunchTestDeps {
  /** 解析实例 → 启动器类型与实例对象 */
  resolveInstance(
    instanceId: string
  ): Promise<{ kind: LauncherKind; instance: LauncherInstance } | null>
  importBatch(input: ImportBatchInput): Promise<ImportBatchResult>
  launch(instanceId: string): Promise<boolean>
  sleep(ms: number): Promise<void>
  now(): number
}

/** 服务内运行输入：预检所需的版本/加载器由调用方（IPC 层）从项目记录补齐 */
export interface LaunchTestRunInput extends LaunchTestInput {
  mcVersion: string
  loader: string | null
}

/** 默认轮询参数 */
const DEFAULT_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 1_500
/** 单次增量读取上限（避免日志暴涨时占用过多内存） */
const MAX_CHUNK = 256_000

/** 日志中的启动标记（出现即说明 JVM 已起并进入客户端初始化） */
const START_MARKER = /(Loading Minecraft|Setting user:|Backend library:|LWJGL Version)/i
/** 模组加载计数（Fabric/Forge 都会打印） */
const MODS_LOADED = /Loading (\d+) mods/i
/**
 * P1③ 真机世界加入标记（强于就绪行的证据）：
 * 集成服务器生成出生点 / 本地玩家实体登记 / 多人进服问候，任一出现即客户端真实进入世界。
 */
const WORLD_JOIN_RE = /(Preparing spawn area|Receiving player info|logged in with entity id|joined the game)/i
/** 模组就绪行出现后，等待世界加入标记的短宽限窗（毫秒）：启动器自动进世界会立即打出，不打则不必久等 */
const JOIN_GRACE_MS = 10_000
/** 崩溃/致命错误特征行 */
const FATAL_LINE = /(caused by:|Exception in thread|Fatal error|crash report)/i

interface FileStamp {
  size: number
  mtimeMs: number
}

function statOrNull(path: string): FileStamp | null {
  try {
    const s = statSync(path)
    return { size: s.size, mtimeMs: s.mtimeMs }
  } catch {
    return null
  }
}

/** 从 offset 起读取文件增量（按字节，避免误读文件头部） */
function readChunk(path: string, offset: number): string {
  if (!existsSync(path)) return ''
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const size = statSync(path).size
    if (size <= offset) return ''
    const length = Math.min(size - offset, MAX_CHUNK)
    const buf = Buffer.alloc(length)
    readSync(fd, buf, 0, length, offset)
    return buf.toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 供 IPC 层直接使用的系统依赖 */
export function createSystemLaunchTestDeps(service: {
  resolveInstance(instanceId: string): Promise<{ launcher: unknown; instance: LauncherInstance } | null>
  importBatch(input: ImportBatchInput): Promise<ImportBatchResult>
  launch(instanceId: string): Promise<boolean>
}): LaunchTestDeps {
  return {
    async resolveInstance(instanceId) {
      const resolved = await service.resolveInstance(instanceId)
      if (!resolved) return null
      const kind = (resolved.launcher as { kind: LauncherKind }).kind
      return { kind, instance: resolved.instance }
    },
    importBatch: (input) => service.importBatch(input),
    launch: (instanceId) => service.launch(instanceId),
    sleep: defaultSleep,
    now: () => Date.now()
  }
}

/**
 * 执行启动测试。
 * 任一步骤无法继续时返回 `verdict: 'failed'` 与中文 `error`，不抛异常。
 */
export async function runLaunchTest(
  input: LaunchTestRunInput,
  deps: LaunchTestDeps
): Promise<LaunchTestResult> {
  const resolved = await deps.resolveInstance(input.instanceId)
  if (!resolved) {
    return { ok: false, verdict: 'failed', summary: '启动测试未执行。', error: '实例不存在，请重新检测启动器与实例。' }
  }
  const { kind, instance } = resolved
  const modsDir = getInstanceSubDir(instance, kind, 'mods')
  const logsDir = getInstanceSubDir(instance, kind, 'logs')
  const logPath = join(logsDir, 'latest.log')
  const crashDir = getInstanceSubDir(instance, kind, 'crash-reports')

  // 预检：版本/加载器不匹配仅告警，不阻断（用户可能就是想跨版本试）
  const precheck: string[] = []
  if (input.mcVersion && instance.mcVersion && input.mcVersion !== instance.mcVersion) {
    precheck.push(`项目 MC 版本 ${input.mcVersion} 与实例 ${instance.mcVersion} 不一致`)
  }
  if (input.loader && instance.loader && input.loader !== instance.loader) {
    precheck.push(`项目加载器 ${input.loader} 与实例 ${instance.loader} 不一致`)
  }

  // 待装模组直接取 run/mods 源文件：损坏 jar 与游戏本体不参与，避免把实例带崩
  const candidates = scanModCandidates(input.projectPath)
  const planned = candidates.filter((c) => c.validZip && !isGameVessel(c.fileName))
  const skipped = candidates.filter((c) => !c.validZip || isGameVessel(c.fileName)).map((c) => c.fileName)

  if (planned.length === 0) {
    return {
      ok: false,
      verdict: 'failed',
      planned: [],
      summary: 'run/mods 下没有可导入的模组 jar，启动测试未执行。',
      error: '项目 run/mods 下没有可用模组：请先在市场安装或把 jar 放入该目录。'
    }
  }

  const importResult = await deps.importBatch({
    launcherId: input.launcherId,
    instanceId: input.instanceId,
    artifactPaths: planned.map((c) => c.absPath)
  })
  if (importResult.error || importResult.failed.length > 0) {
    const detail = importResult.error ?? `${importResult.failed.length} 个模组复制失败`
    return {
      ok: false,
      verdict: 'failed',
      planned: planned.map((c) => c.fileName),
      summary: `模组导入实例失败：${detail}`,
      error: detail
    }
  }

  // 目录断言：实例 mods 目录里是否真的有这些文件（与日志无关的硬证据）
  const inInstance = new Set(listDir(importResult.modsDir ?? modsDir))
  const verified = planned.map((c) => c.fileName).filter((n) => inInstance.has(n))
  const missing = planned.map((c) => c.fileName).filter((n) => !inInstance.has(n))

  // 基线快照：只认启动之后的日志增量与新增崩溃报告，避免把上次的失败当成本次结果
  const baseline = statOrNull(logPath)
  const baselineCrashes = new Set(listDir(crashDir))

  const launched = await deps.launch(input.instanceId)
  if (!launched) {
    return {
      ok: false,
      verdict: 'failed',
      planned: planned.map((c) => c.fileName),
      verifiedInInstance: verified,
      missing,
      summary: '未找到可执行的启动器，模组已就位但游戏未启动。',
      error: '启动器进程缺失：请在启动器集成中确认可执行文件路径后重试。'
    }
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = deps.now() + timeoutMs
  let delta = ''
  let modsCount: number | null = null
  let modsCountAt = 0
  let worldJoinLine: string | null = null
  let newCrash = false

  while (deps.now() < deadline) {
    await deps.sleep(POLL_INTERVAL_MS)
    // 基线为空说明日志是本次新建的，全量即增量；被截断重建时同样按全量读
    const fresh = baseline === null ? readChunk(logPath, 0) : readChunk(logPath, baseline.size)
    if (fresh) delta += fresh
    if (modsCount === null) {
      const m = delta.match(MODS_LOADED)
      if (m) {
        modsCount = Number(m[1])
        modsCountAt = deps.now()
      }
    }
    // P1③：真 join 标记逐行捕获（不依赖整段正则，保留原文做证据）
    if (worldJoinLine === null) {
      const hit = delta.split(/\r?\n/).find((l) => WORLD_JOIN_RE.test(l))
      if (hit) worldJoinLine = hit.trim().slice(0, 160)
    }
    if (listDir(crashDir).some((f) => !baselineCrashes.has(f))) {
      newCrash = true
      break
    }
    // 最强证据到手立即收口；否则 mods 就绪后留短宽限窗等真 join，超时照常走完
    if (worldJoinLine !== null) break
    if (modsCount !== null && deps.now() - modsCountAt >= JOIN_GRACE_MS) break
  }

  const sawStart = START_MARKER.test(delta)
  const fatalLines = delta
    .split(/\r?\n/)
    .filter((l) => FATAL_LINE.test(l))
    .map((l) => l.trim())
    .slice(0, 5)

  let verdict: LaunchTestVerdict
  if (worldJoinLine !== null) verdict = 'world-joined'
  else if (modsCount !== null) verdict = 'mods-visible'
  else if (newCrash) verdict = 'crashed'
  else if (sawStart) verdict = 'launched-only'
  else if (fatalLines.length > 0) verdict = 'crashed'
  else verdict = 'timeout'

  // P1③ 场景断言链：逐项三态，真 join 证据可顶替上游日志行（join 出现即证明引导与加载已过）
  const booted = sawStart || modsCount !== null || worldJoinLine !== null
  const assertions: LaunchTestAssertion[] = [
    {
      id: 'mods-in-instance',
      label: '模组进实例（目录断言）',
      state: missing.length === 0 ? 'verified' : 'failed',
      evidence:
        missing.length === 0 ? `${verified.length}/${planned.length} 就位` : `缺 ${missing.join('、')}`
    },
    {
      id: 'game-boot',
      label: '游戏引导启动',
      state: booted ? 'verified' : newCrash || fatalLines.length > 0 ? 'failed' : 'inconclusive',
      evidence: booted
        ? '日志增量出现启动标记'
        : newCrash || fatalLines.length > 0
          ? '引导期崩溃/致命错误'
          : `${Math.round(timeoutMs / 1000)} 秒内未读到启动标记（启动器可能停在选单）`
    },
    {
      id: 'mods-loaded',
      label: '模组加载（日志就绪行）',
      state: modsCount !== null || worldJoinLine !== null ? 'verified' : sawStart ? 'failed' : 'inconclusive',
      evidence:
        modsCount !== null
          ? `Loading ${modsCount} mods`
          : worldJoinLine !== null
            ? '世界加入标记顶替就绪行（更强证据）'
            : sawStart
              ? '启动窗口内未读到模组加载记录——模组未生效或实例未进目标版本'
              : '游戏未完成引导，无从判定'
    },
    {
      id: 'world-join',
      label: '真机世界加入',
      state: worldJoinLine !== null ? 'verified' : 'inconclusive',
      evidence:
        worldJoinLine !== null
          ? worldJoinLine
          : '启动器未自动进入世界（非失败；需要更强证据时请进游戏内确认）'
    }
  ]

  const notes = [...precheck]
  if (skipped.length > 0) notes.push(`已跳过 ${skipped.join('、')}（损坏或游戏本体）`)
  if (missing.length > 0) notes.push(`实例目录缺少 ${missing.join('、')}`)

  const base = `模组已就位 ${verified.length}/${planned.length} 个（实例 mods 目录断言）`
  let summary: string
  switch (verdict) {
    case 'world-joined':
      summary =
        `${base}；日志增量捕获世界加入标记（${worldJoinLine}）` +
        (modsCount !== null ? `与「Loading ${modsCount} mods」` : '') +
        '，游戏已加载模组并真实进入世界。'
      break
    case 'mods-visible':
      summary = `${base}；日志增量出现「Loading ${modsCount} mods」，游戏已加载模组（未捕获世界加入标记，真机体验请进游戏确认）。`
      break
    case 'launched-only':
      summary = `${base}；检测到游戏启动标记，但未在 ${Math.round(timeoutMs / 1000)} 秒内读到模组加载记录——启动器可能停在选择界面，请在游戏内确认模组列表。`
      break
    case 'crashed':
      summary = `${base}；检测到崩溃报告或致命错误行，游戏启动失败。`
      break
    case 'timeout':
      summary = `${base}；${Math.round(timeoutMs / 1000)} 秒内未读到启动标记或模组加载记录（部分启动器需手动点「启动」才会进入实例）。`
      break
    default:
      summary = base
  }
  if (notes.length > 0) summary += `\n告警：${notes.join('；')}`

  return {
    ok: verdict === 'world-joined' || verdict === 'mods-visible',
    verdict,
    planned: planned.map((c) => c.fileName),
    verifiedInInstance: verified,
    missing,
    logSignals: fatalLines.length > 0 ? fatalLines : startSignals(delta),
    assertions,
    summary
  }
}

/** 截取日志增量中的关键行作为回执证据 */
function startSignals(delta: string): string[] {
  return delta
    .split(/\r?\n/)
    .filter((l) => START_MARKER.test(l) || MODS_LOADED.test(l) || WORLD_JOIN_RE.test(l))
    .map((l) => l.trim())
    .slice(-5)
}

/* ---------------- 最近结果落盘（P4 发布 preflight 质量门） ---------------- */

/** 记录路径：项目根 .kunyu/launch-test-last.json */
function recordAbsPath(projectRoot: string): string {
  return join(projectRoot, '.kunyu', 'launch-test-last.json')
}

/**
 * 启动测试完成后落盘最近一次结果（best-effort：写盘失败不影响测试回执本身）。
 * 发布 preflight 的「运行验收」门据此判定——没有记录 = 未验证（INCONCLUSIVE），
 * 有记录按 verdict 分档（crashed/failed 硬门拦截，timeout/launched-only 软告警）。
 */
export function persistLaunchTestResult(projectRoot: string, result: LaunchTestResult): void {
  const record: LaunchTestRecord = {
    at: Date.now(),
    verdict: result.verdict,
    ok: result.ok,
    summary: result.summary
  }
  try {
    const abs = recordAbsPath(projectRoot)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, JSON.stringify(record, null, 2), 'utf-8')
  } catch {
    /* 落盘失败不阻断启动测试回执 */
  }
}

/** 读取最近一次启动测试记录；无记录或文件损坏返回 null（按未验证处理，不臆测） */
export function readLaunchTestRecord(projectRoot: string): LaunchTestRecord | null {
  try {
    const abs = recordAbsPath(projectRoot)
    if (!existsSync(abs)) return null
    const raw: unknown = JSON.parse(readFileSync(abs, 'utf-8'))
    if (typeof raw !== 'object' || raw === null) return null
    const r = raw as Partial<LaunchTestRecord>
    if (typeof r.at !== 'number' || typeof r.verdict !== 'string' || typeof r.summary !== 'string') {
      return null
    }
    return { at: r.at, verdict: r.verdict as LaunchTestVerdict, ok: r.ok === true, summary: r.summary }
  } catch {
    return null
  }
}