/**
 * 矩阵健康状态统一存储（唯一真源）。
 *
 * 历史教训（幻影红灯）：health 曾双写分裂——矩阵门禁写仓库 manifest.json，
 * 编译探针/上游监测写 userData overlay，读取时 overlay 优先，导致陈旧红灯
 * 压过门禁新绿灯，「修了一边、另一边没修」。本模块把全部读写收敛到同一文件：
 *
 * - 唯一真源：<userData>/ai/ai-reference-overlay.json（运行时层）
 * - manifest.json 冻结为静态基线（坐标 pin/模板/指纹），不再被任何流程回写；
 *   其 health/verifiedAt/matrixHealth 仅在 overlay 无记录时作一次性种子迁入
 *   （seedFromBaseline，保证既有绿灯成果与 prod 升级后基线不丢失）
 * - 写方：编译探针 recordProbeResult、上游监测 recordUpstreamState、
 *   矩阵门禁 recordGateResult（原写 manifest，统一成套整改后并入本层）
 * - 读方：referencePackageService（listMatrixCells/getComboHealth/readTemplate）
 * - 磁盘即真源：所有读写入口先 syncFromDisk（mtime 探测），外部进程
 *   （如 vitest 门禁）写入后应用内刷新即见，杜绝内存陈旧覆盖磁盘新数据
 *
 * 路径解析：实例化时显式注入 path（测试/门禁经 KY_MATRIX_HEALTH_PATH 或
 * 直接计算）；运行期默认 defaultMatrixHealthPath() = userData/ai/ 下。
 */
import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  BuildStatus,
  ComboOverlayState,
  ReferenceManifest,
  ReferenceOverlay,
  TemplateOverlayState
} from '../../../shared/types/aiReference'
import type { ComboHealth } from '../../../shared/types/monitor'

const OVERLAY_FILE = 'ai-reference-overlay.json'

const EMPTY_OVERLAY: ReferenceOverlay = { version: 1, templates: {}, combos: {} }

/** 运行期默认路径：userData/ai/ai-reference-overlay.json（dev 经 app.setPath 指向 .dev-userdata） */
export function defaultMatrixHealthPath(): string {
  const env = process.env.KY_MATRIX_HEALTH_PATH
  if (env) return env
  try {
    return join(app.getPath('userData'), 'ai', OVERLAY_FILE)
  } catch {
    // 无 Electron 环境（裸 vitest 且未 mock）：回退平台用户目录
    const base =
      process.platform === 'win32'
        ? (process.env.APPDATA ?? join(process.env.USERPROFILE ?? '.', 'AppData', 'Roaming'))
        : join(process.env.HOME ?? '.', '.config')
    return join(base, 'kunyu-ecosystem', 'ai', OVERLAY_FILE)
  }
}

export interface ProbeRecordInput {
  comboId: string
  health: ComboHealth
  verifiedAt: string
  /** 不传模板结果时只更新组合灯色 */
  templates?: Array<{ id: string; build: BuildStatus; verified: string | null }>
  latestLoaderVersion?: string
}

export interface UpstreamRecordInput {
  comboId: string
  latestLoaderVersion: string
  /** 漂移判定后的灯色；red（回测失败）未重测前可不传，保持红灯 */
  health?: ComboHealth
}

export interface GateRecordInput {
  comboId: string
  pass: boolean
  /** 门禁注入的内容定义数（matrixHealth.templateCount 语义） */
  templateCount: number
  at: string
}

export interface MatrixHealthStore {
  readonly path: string
  /** 当前 overlay 快照（读取前自动 syncFromDisk） */
  getOverlay(): ReferenceOverlay
  /** 组合运行时状态；无记录返回 null（调用方按 unknown 处理） */
  getCombo(comboId: string): ComboOverlayState | null
  /** 模板运行时状态；无记录返回 null（调用方可回退 manifest 基线） */
  getTemplate(templateId: string): TemplateOverlayState | null
  /** 编译探针回写：组合灯色 + 可选模板逐条 build/verified */
  recordProbeResult(input: ProbeRecordInput): void
  /** 上游监测回写：最新加载器版本与漂移灯色（不动 verifiedAt） */
  recordUpstreamState(input: UpstreamRecordInput): void
  /** 矩阵门禁回写：灯色（green/yellow）+ matrixHealth 档案；red 留给带错误归因的探针通道 */
  recordGateResult(input: GateRecordInput): void
  /**
   * 一次性种子迁移：overlay 无记录的组合从 manifest 基线灌入（幂等）。
   * 已有运行时记录的组合绝不覆盖（运行时层优先级恒高于基线）。
   */
  seedFromBaseline(manifest: ReferenceManifest): void
  /** 磁盘新鲜度检查：文件 mtime 变化（外部进程写入）则丢弃内存态重新加载 */
  syncFromDisk(): void
}

function loadFromDisk(path: string): ReferenceOverlay {
  if (!existsSync(path)) return structuredClone(EMPTY_OVERLAY)
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return structuredClone(EMPTY_OVERLAY)
    }
    const rec = raw as Record<string, unknown>
    if (rec['version'] !== 1) return structuredClone(EMPTY_OVERLAY)
    const isRec = (v: unknown): v is Record<string, never> =>
      typeof v === 'object' && v !== null && !Array.isArray(v)
    return {
      version: 1,
      templates: isRec(rec['templates']) ? (rec['templates'] as ReferenceOverlay['templates']) : {},
      combos: isRec(rec['combos']) ? (rec['combos'] as ReferenceOverlay['combos']) : {}
    }
  } catch {
    // 损坏的 overlay 不阻塞服务，按空覆盖启动
    return structuredClone(EMPTY_OVERLAY)
  }
}

export function createMatrixHealthStore(deps: { path: string }): MatrixHealthStore {
  let overlay = loadFromDisk(deps.path)
  /** 上次加载/写入时的磁盘 mtime（0 = 文件不存在）；mtime 漂移即外部写入 */
  let lastMtime = existsSync(deps.path) ? statSync(deps.path).mtimeMs : 0

  function persist(): void {
    mkdirSync(dirname(deps.path), { recursive: true })
    const tmp = `${deps.path}.tmp`
    writeFileSync(tmp, JSON.stringify(overlay, null, 2), 'utf-8')
    renameSync(tmp, deps.path)
    lastMtime = statSync(deps.path).mtimeMs
  }

  function syncFromDisk(): void {
    const mtime = existsSync(deps.path) ? statSync(deps.path).mtimeMs : 0
    if (mtime === lastMtime) return
    overlay = loadFromDisk(deps.path)
    lastMtime = mtime
  }

  return {
    path: deps.path,

    getOverlay() {
      syncFromDisk()
      return overlay
    },

    getCombo(comboId) {
      syncFromDisk()
      return overlay.combos[comboId] ?? null
    },

    getTemplate(templateId) {
      syncFromDisk()
      return overlay.templates[templateId] ?? null
    },

    recordProbeResult(input) {
      syncFromDisk()
      overlay = structuredClone(overlay)
      overlay.combos[input.comboId] = {
        health: input.health,
        verifiedAt: input.verifiedAt,
        latestLoaderVersion:
          input.latestLoaderVersion ?? overlay.combos[input.comboId]?.latestLoaderVersion,
        // 门禁档案探针不动（探针无内容注入计数口径）
        matrixHealth: overlay.combos[input.comboId]?.matrixHealth
      }
      if (input.templates) {
        for (const r of input.templates) {
          overlay.templates[r.id] = {
            verified: r.verified,
            verifiedAt: input.verifiedAt,
            build: r.build
          }
        }
      }
      persist()
    },

    recordUpstreamState(input) {
      syncFromDisk()
      overlay = structuredClone(overlay)
      const prev = overlay.combos[input.comboId]
      overlay.combos[input.comboId] = {
        // health/verifiedAt 缺省沿用旧值；首次监测且未指定灯色时保持 unknown
        health: input.health ?? prev?.health ?? 'unknown',
        verifiedAt: prev?.verifiedAt ?? null,
        latestLoaderVersion: input.latestLoaderVersion,
        matrixHealth: prev?.matrixHealth
      }
      persist()
    },

    recordGateResult(input) {
      syncFromDisk()
      overlay = structuredClone(overlay)
      const prev = overlay.combos[input.comboId]
      overlay.combos[input.comboId] = {
        // 真机构建通过 → 绿；失败标黄（红灯保留给带错误归因的编译探针通道）
        health: input.pass ? 'green' : 'yellow',
        verifiedAt: input.at,
        latestLoaderVersion: prev?.latestLoaderVersion,
        matrixHealth: {
          templateCount: input.templateCount,
          verifiedCount: input.pass ? input.templateCount : 0,
          passRate: input.pass ? 100 : 0,
          lastVerifiedAt: input.at
        }
      }
      persist()
    },

    seedFromBaseline(manifest) {
      syncFromDisk()
      const seeded: typeof overlay.combos = {}
      let changed = false
      for (const f of manifest.versionFingerprints) {
        if (overlay.combos[f.id]) continue // 已有运行时记录，绝不覆盖
        seeded[f.id] = {
          health: f.health,
          verifiedAt: f.verifiedAt,
          ...(f.matrixHealth ? { matrixHealth: f.matrixHealth } : {})
        }
        changed = true
      }
      if (!changed) return
      overlay = structuredClone(overlay)
      Object.assign(overlay.combos, seeded)
      persist()
    },

    syncFromDisk
  }
}
