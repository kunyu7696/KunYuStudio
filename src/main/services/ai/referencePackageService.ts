/**
 * AI 反幻觉参考包服务（M7 Task 2）。
 *
 * 资源位置：
 * - dev：<项目根>/resources/ai-reference
 * - prod：process.resourcesPath/ai-reference（electron-builder extraResources）
 *
 * 安装目录内的 manifest/模板/prompt 全部只读；组合灯色/探针签字/门禁档案
 * 统一读写 userData/ai/ai-reference-overlay.json（唯一真源，见 matrixHealthStore）。
 * manifest.json 冻结为静态基线，不再被任何流程回写；其 health/verifiedAt/
 * matrixHealth 仅在 overlay 无记录时经 seedFromBaseline 一次性迁入。
 */
import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import type {
  ContentType,
  ErrorPattern,
  LoaderId,
  MatchedErrorPattern,
  ReferenceManifest,
  ReferenceOverlay,
  TemplateView,
  VersionFingerprint
} from '../../../shared/types/aiReference'
import type { ComboHealth, ComboMatrixCell } from '../../../shared/types/monitor'
import { tierOfMcVersion } from '../../templates/loaderVersionMatrix'
import { isPackagedRuntime } from '../../runtimeEnv'
import {
  createMatrixHealthStore,
  defaultMatrixHealthPath,
  type MatrixHealthStore,
  type ProbeRecordInput,
  type UpstreamRecordInput
} from './matrixHealthStore'

const MANIFEST_FILE = 'manifest.json'
const PROMPT_FILE = 'system_prompt_base.md'
const CAPABILITIES_FILE = 'kunyu_capabilities.md'

/* ------------------------------------------------------------------ */
/* 路径解析                                                            */
/* ------------------------------------------------------------------ */

/** dev 工作区资源根 */
export function devReferenceDir(): string {
  return join(process.cwd(), 'resources', 'ai-reference')
}

/** 当前运行环境下的参考包根目录 */
export function resolveReferenceDir(): string {
  return isPackagedRuntime(app)
    ? join(process.resourcesPath, 'ai-reference')
    : devReferenceDir()
}

/** overlay 固定写入 userData/ai/（探针/监测/门禁可写，安装目录保持只读） */
export function defaultOverlayPath(): string {
  return defaultMatrixHealthPath()
}

/* ------------------------------------------------------------------ */
/* 结构校验                                                            */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asArray(v: unknown, label: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`manifest 字段 ${label} 必须是数组`)
  return v
}

/**
 * 加载并结构校验 manifest；同时交叉校验 stats 与磁盘实物。
 * 损坏/被篡改时直接抛错（调用方软降级，绝不带病工作）。
 */
export function loadManifestFromDir(referenceDir: string): ReferenceManifest {
  const manifestPath = join(referenceDir, MANIFEST_FILE)
  if (!existsSync(manifestPath)) throw new Error(`参考包不存在：${manifestPath}`)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch (e) {
    throw new Error(`manifest.json 解析失败：${(e as Error).message}`)
  }
  if (!isRecord(raw)) throw new Error('manifest 顶层必须是对象')

  const m = raw as unknown as ReferenceManifest
  asArray(m.templates, 'templates')
  asArray(m.errorPatterns, 'errorPatterns')
  asArray(m.apiIndex, 'apiIndex')
  asArray(m.versionFingerprints, 'versionFingerprints')
  if (!isRecord(m.scopeControl) || !Array.isArray(m.scopeControl.m7ActiveVersions)) {
    throw new Error('manifest.scopeControl.m7ActiveVersions 缺失')
  }
  if (!isRecord(m.stats)) throw new Error('manifest.stats 缺失')

  // stats 必须与数组实际长度一致（防手工篡改）
  const s = m.stats
  if (s.templateCount !== m.templates.length) {
    throw new Error(`stats.templateCount(${s.templateCount}) 与模板数(${m.templates.length}) 不一致`)
  }
  if (s.errorPatternCount !== m.errorPatterns.length) {
    throw new Error('stats.errorPatternCount 与实际错误模式数不一致')
  }
  if (s.apiIndexCount !== m.apiIndex.length) {
    throw new Error('stats.apiIndexCount 与实际 API 索引数不一致')
  }

  // 每个 active 模板的 file 必须真实存在，且不得逃逸参考包根
  const root = resolve(referenceDir)
  for (const t of m.templates) {
    if (typeof t.file !== 'string' || !t.file) throw new Error('模板缺少 file 字段')
    const abs = resolve(root, t.file)
    const relPath = relative(root, abs)
    if (relPath.startsWith('..') || isAbsolute(relPath)) {
      throw new Error(`模板路径越界：${t.file}`)
    }
    if (!existsSync(abs)) throw new Error(`模板文件缺失：${t.file}`)
    if (t.active !== true) throw new Error(`仅允许 active 模板入库：${t.id}`)
  }

  // 所有 active 组合必须存在对应指纹
  for (const av of m.scopeControl.m7ActiveVersions) {
    const ok = m.versionFingerprints.some(
      (f) => f.loader === av.loader && f.mcVersion === av.version
    )
    if (!ok) throw new Error(`active 组合缺少指纹：${av.loader}/${av.version}`)
  }
  return m
}

/* ------------------------------------------------------------------ */
/* 服务实例（纯依赖注入，便于无 Electron 环境验证）                      */
/* ------------------------------------------------------------------ */

export interface ReferenceService {
  readonly referenceDir: string
  isLoaded(): boolean
  loadError(): string | null
  getManifest(): ReferenceManifest | null
  /** 列出激活组合的模板（inactive 组合永远返回空） */
  listTemplates(loader: LoaderId, version: string, types?: readonly ContentType[]): ReferenceManifest['templates']
  readTemplate(id: string): TemplateView | null
  getSystemPromptBase(): string | null
  /** KunYuStudio 应用自身能力清单（聊天意图注入，AI 自我认知语料） */
  getKunyuCapabilities(): string | null
  getFingerprint(comboId: string): VersionFingerprint | null
  /** 合并 overlay 后的组合灯色 */
  getComboHealth(comboId: string): ComboHealth
  /** 矩阵单元格（含 inactive，供 UI 展示 33 格：17 既有 + 16 个 1.21.4~1.21.11 待验证） */
  listMatrixCells(): ComboMatrixCell[]
  matchErrorPatterns(loader: LoaderId, version: string, logText: string): MatchedErrorPattern[]
  /** 探针回写：组合灯色 + 模板逐条 build/verified */
  recordProbeResult(input: ProbeResultInput): void
  /** 上游监测回写：最新加载器版本与漂移灯色（不动 verifiedAt；red 由调用方决定是否覆盖） */
  recordUpstreamState(input: UpstreamStateInput): void
  getOverlay(): ReferenceOverlay
}

/** 探针回写输入（语义与字段同 matrixHealthStore.ProbeRecordInput） */
export type ProbeResultInput = ProbeRecordInput

/** 上游监测回写输入（语义与字段同 matrixHealthStore.UpstreamRecordInput） */
export type UpstreamStateInput = UpstreamRecordInput

export function createReferenceService(deps: {
  referenceDir: string
  overlayPath: string
}): ReferenceService {
  let manifest: ReferenceManifest | null = null
  let error: string | null = null
  // 矩阵健康统一存储：唯一真源（探针/监测/门禁同写一份，磁盘即真源）
  const store: MatrixHealthStore = createMatrixHealthStore({ path: deps.overlayPath })
  try {
    manifest = loadManifestFromDir(deps.referenceDir)
    // 一次性种子迁移：overlay 无记录的组合从 manifest 基线灌入（幂等，
    // 已有运行时记录绝不覆盖）——保证既有绿灯成果与 prod 升级后基线不丢失
    store.seedFromBaseline(manifest)
  } catch (e) {
    error = (e as Error).message
  }
  const regexCache = new Map<string, RegExp>()

  function activeCombos(): Set<string> {
    if (!manifest) return new Set()
    return new Set(
      manifest.scopeControl.m7ActiveVersions.map((a) => `${a.loader}/${a.version}`)
    )
  }

  return {
    referenceDir: deps.referenceDir,

    isLoaded: () => manifest !== null,
    loadError: () => error,

    getManifest: () => manifest,

    listTemplates(loader, version, types) {
      if (!manifest) return []
      if (!activeCombos().has(`${loader}/${version}`)) return []
      return manifest.templates.filter(
        (t) =>
          t.loader === loader &&
          t.version === version &&
          (!types || types.length === 0 || types.some((ty) => t.contentTypes.includes(ty)))
      )
    },

    readTemplate(id) {
      if (!manifest) return null
      const t = manifest.templates.find((x) => x.id === id)
      if (!t) return null
      const abs = resolve(deps.referenceDir, normalize(t.file))
      const root = resolve(deps.referenceDir)
      const relPath = relative(root, abs)
      if (relPath.startsWith('..') || isAbsolute(relPath)) return null
      if (!existsSync(abs)) return null
      const content = readFileSync(abs, 'utf-8')
      // 模板运行时状态：overlay 优先，无记录回退 manifest 基线（模板写方仅探针，无分裂面）
      const ov = store.getTemplate(t.id)
      const view: TemplateView = {
        ...t,
        verified: ov ? ov.verified : t.verified,
        verifiedAt: ov ? ov.verifiedAt : t.verifiedAt,
        build: ov ? ov.build : t.build,
        content
      }
      return view
    },

    getSystemPromptBase() {
      const p = join(deps.referenceDir, PROMPT_FILE)
      if (!existsSync(p)) return null
      return readFileSync(p, 'utf-8')
    },

    getKunyuCapabilities() {
      const p = join(deps.referenceDir, CAPABILITIES_FILE)
      if (!existsSync(p)) return null
      return readFileSync(p, 'utf-8')
    },

    getFingerprint(comboId) {
      if (!manifest) return null
      return manifest.versionFingerprints.find((f) => f.id === comboId) ?? null
    },

    getComboHealth(comboId) {
      // 唯一真源为 overlay store（种子迁移后基线已并入）；不再回退 manifest.health
      return store.getCombo(comboId)?.health ?? 'unknown'
    },

    listMatrixCells() {
      if (!manifest) return []
      const activeSet = activeCombos()
      const cells: ComboMatrixCell[] = []
      // 活跃组合 + 冻结/储备组合统一成矩阵格（V-02 后 33 格：17 既有 + 16 待验证）
      for (const f of manifest.versionFingerprints) {
        const comboKey = `${f.loader}/${f.mcVersion}`
        const isActive = activeSet.has(comboKey)
        let templateCount = 0
        if (isActive) {
          templateCount = manifest.templates.filter(
            (t) => t.loader === f.loader && t.version === f.mcVersion
          ).length
        } else {
          templateCount =
            manifest.scopeControl.registeredButInactive.find(
              (c) => c.loader === f.loader && c.version === f.mcVersion
            )?.templateCount ?? 0
        }
        // 运行时状态只读统一 store（health/verifiedAt/matrixHealth 不再回退 manifest 基线，
        // 基线已在服务启动时经 seedFromBaseline 一次性迁入 overlay）
        const ov = store.getCombo(f.id)
        const health = ov?.health ?? 'unknown'
        cells.push({
          id: f.id,
          loader: f.loader,
          mcVersion: f.mcVersion,
          // 已验证钉版优先写入工程；漂移值只用于 UI 提示，不覆盖
          loaderVersion: f.loaderVersion,
          latestLoaderVersion: ov?.latestLoaderVersion ?? undefined,
          mapping: f.mapping,
          jdk: f.jdk,
          health,
          // beta 组合禁用：向导灰显（与矩阵 isBetaBlocked 双保险）
          disabled: health === 'beta',
          driftRisk: f.driftRisk,
          active: isActive,
          templateCount,
          verifiedAt: ov?.verifiedAt ?? null,
          note: f.note,
          tier: f.tier ?? tierOfMcVersion(f.mcVersion),
          matrixHealth: ov?.matrixHealth
        })
      }
      return cells
    },

    matchErrorPatterns(loader, version, logText) {
      if (!manifest || !logText) return []
      const matches: MatchedErrorPattern[] = []
      for (const p of manifest.errorPatterns as ErrorPattern[]) {
        if (!p.loaders.includes(loader)) continue
        if (!p.mcVersions.includes(version)) continue
        let re = regexCache.get(p.id)
        if (!re) {
          re = new RegExp(p.pattern, 'm')
          regexCache.set(p.id, re)
        }
        const m = re.exec(logText)
        if (m) {
          const start = Math.max(0, m.index - 40)
          const end = Math.min(logText.length, m.index + m[0].length + 80)
          matches.push({ pattern: p, matchedText: logText.slice(start, end).trim() })
        }
      }
      // 严重度优先（critical > major > minor > warning > info），同级别按 manifest 顺序
      const order: Record<ErrorPattern['severity'], number> = {
        critical: 0,
        major: 1,
        minor: 2,
        warning: 3,
        info: 4
      }
      return matches.sort(
        (a, b) => order[a.pattern.severity] - order[b.pattern.severity]
      )
    },

    recordProbeResult(input) {
      store.recordProbeResult(input)
    },

    recordUpstreamState(input) {
      store.recordUpstreamState(input)
    },

    getOverlay: () => store.getOverlay()
  }
}

/* ------------------------------------------------------------------ */
/* Electron 单例                                                       */
/* ------------------------------------------------------------------ */

let singleton: ReferenceService | null = null

/** app ready（userData 确定）后调用一次 */
export function initReferencePackage(): ReferenceService {
  if (singleton) return singleton
  singleton = createReferenceService({
    referenceDir: resolveReferenceDir(),
    overlayPath: defaultOverlayPath()
  })
  if (!singleton.isLoaded()) {
    console.warn(`[ai-reference] 参考包加载失败：${singleton.loadError() ?? 'unknown'}`)
  }
  return singleton
}

export function getReferenceService(): ReferenceService {
  if (!singleton) return initReferencePackage()
  return singleton
}

/** 供测试/诊断确认实际解析目录（不触发 Electron 路径外 IO） */
export function referenceManifestAbsPath(): string {
  return join(resolveReferenceDir(), MANIFEST_FILE)
}
