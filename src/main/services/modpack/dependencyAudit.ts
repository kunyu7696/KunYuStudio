/**
 * 模组依赖缺席审计。
 *
 * 动机：整合包装了一堆社区模组后，「某个模组的前置库没装」只有到游戏启动崩溃
 * （NoClassDefFoundError / 加载器报 requires xxx）才暴露；「可选联动模组没装」则
 * 联动功能静默不可用，用户以为坏了。本模块把这两类缺席前置到打包/预览阶段：
 *
 * - 纯文件扫描 run/mods 的 jar，解析内嵌元数据（Fabric fabric.mod.json 的
 *   depends/recommends/suggests/breaks；Forge/NeoForge mods.toml 的
 *   [[dependencies.xxx]] type="required"/"optional" 与 [[moddependencies]] 段）；
 * - 按全包 modId 集合比对，给出「缺必需前置」「缺可选联动」「冲突共存」三档中文告警；
 * - 任何单个 jar 元数据损坏一律跳过该 jar，绝不因坏 jar 拖垮整个审计；
 * - 纯函数、零网络，组装 plan/preview 与 agent 工具共用。
 *
 * 边界：只覆盖「模组之间的依赖」，fabricloader/minecraft/java 等系统键与
 * 环境依赖（如仅在特定 MC 版本才需要的库）不在此判定；版本范围约束（>=1.0）
 * 只报缺席不校验版本号是否满足（版本满足性属于加载器运行时职责）。
 */
import { openZip } from '../performance/jarReader'

/** 单个模组的依赖声明（从 jar 元数据解析出的归一化形态） */
export interface ModDependencyDecl {
  /** 目标 modId（归一化：小写、下划线→连字符） */
  target: string
  /** required=必需前置；optional=可选联动（缺席降级不崩）；incompatible=冲突不能共存 */
  kind: 'required' | 'optional' | 'incompatible'
}

/** 单个 jar 的身份与依赖声明 */
export interface ModJarDecl {
  fileName: string
  /** 归一化 modId；元数据损坏/缺失时为 null（该 jar 跳过审计但仍计入在场集合——能扫出 id 才算） */
  modId: string | null
  deps: ModDependencyDecl[]
}

export interface DependencyAuditResult {
  /** 成功解析出 modId 的 jar 数 */
  parsed: number
  /** 元数据损坏/缺失被跳过的 jar 文件名 */
  skipped: string[]
  /** 缺失的必需前置（message 中文，一行一条） */
  missingRequired: string[]
  /** 缺失的可选联动（功能降级提示） */
  missingOptional: string[]
  /** 声明了 breaks/incompatible 但共存的组合 */
  conflicts: string[]
}

/** modId 归一化：小写 + 下划线→连字符（fabric geckolib 与 forge geckolib 写法差异收敛） */
export function normalizeModId(id: string): string {
  return id.trim().toLowerCase().replace(/_/g, '-')
}

/** 系统/环境依赖键：不属于「模组间依赖」，一律不参与缺席判定 */
const SYSTEM_DEP_KEYS = new Set([
  'fabricloader', 'fabric-loader', 'minecraft', 'java', 'fabric', 'forge', 'neoforge',
  'fabric-api' // Fabric API 是事实上的平台层，缺它加载器自会报，且几乎每个包都装
])

function isSystemDep(id: string): boolean {
  return SYSTEM_DEP_KEYS.has(normalizeModId(id))
}

/** 解析 fabric.mod.json 的依赖段；文件缺失/损坏返回 null */
function parseFabricDeps(text: string): { modId: string; deps: ModDependencyDecl[] } | null {
  let obj: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    obj = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const modId = typeof obj['id'] === 'string' ? obj['id'] : ''
  if (!modId) return null
  const deps: ModDependencyDecl[] = []
  const collect = (value: unknown, kind: ModDependencyDecl['kind']): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (isSystemDep(key)) continue
      deps.push({ target: normalizeModId(key), kind })
    }
  }
  collect(obj['depends'], 'required')
  collect(obj['recommends'], 'optional')
  collect(obj['suggests'], 'optional')
  collect(obj['breaks'], 'incompatible')
  collect(obj['conflicts'], 'incompatible')
  return { modId: normalizeModId(modId), deps }
}

/**
 * 解析 mods.toml / neoforge.mods.toml 的依赖段（轻量正则，不引 TOML 解析器）：
 * - [[dependencies.<modId>]] 或 [[moddependencies.<modId>]] 段内 mandatory=true/false
 *   或 type="required"/"optional"；
 * - type="incompatible" 视为冲突声明；
 * - 首个 [[mods]] 表的 modId 作为本 jar 身份。
 * 只匹配「模组间依赖」：dependency 段的 owner modId 由段头或段内 modId= 决定。
 */
function parseForgeTomlDeps(text: string): { modId: string; deps: ModDependencyDecl[] } | null {
  const modId = /^\s*modId\s*=\s*"([^"]+)"/m.exec(text)?.[1]
  if (!modId) return null
  const deps: ModDependencyDecl[] = []
  // 按行扫描：遇 [[dependencies.xxx]] / [[moddependencies.xxx]] 表头开始收段，
  // 遇任何其他 [[...]] 表头结束（TOML 数组表的段体终止于下一个表头）。
  const depHeaderRe = /^\s*\[\[(?:mod)?dependencies\.([^\]]+)\]\]\s*$/
  const anyHeaderRe = /^\s*\[\[[^\]]+\]\]\s*$/
  interface SectionState {
    headerTarget: string
    body: string
  }
  let current: SectionState | null = null
  const flushSection = (s: SectionState): void => {
    // 段内显式 modId 优先（NeoForge 风格 [[dependencies.<owner>]] modId="target"），
    // 否则段头即目标（旧 Forge 风格 [[dependencies.<target>]]）
    const target = /^\s*modId\s*=\s*"([^"]+)"/m.exec(s.body)?.[1] ?? s.headerTarget
    if (!target) return
    const typeM = /^\s*type\s*=\s*"([^"]+)"/im.exec(s.body)?.[1]?.toLowerCase()
    const mandatoryM = /^\s*mandatory\s*=\s*(true|false)/im.exec(s.body)?.[1]?.toLowerCase()
    if (typeM === 'incompatible') {
      deps.push({ target: normalizeModId(target), kind: 'incompatible' })
      return
    }
    // mandatory=false 或 type="optional" → 可选；其余（含 mandatory=true、缺省）→ 必需
    const optional = typeM === 'optional' || mandatoryM === 'false'
    if (isSystemDep(target)) return
    deps.push({ target: normalizeModId(target), kind: optional ? 'optional' : 'required' })
  }
  for (const line of text.split('\n')) {
    const depM = depHeaderRe.exec(line)
    if (depM) {
      if (current) flushSection(current)
      current = { headerTarget: depM[1] ?? '', body: '' }
      continue
    }
    if (anyHeaderRe.test(line)) {
      if (current) {
        flushSection(current)
        current = null
      }
      continue
    }
    if (current) current.body += line + '\n'
  }
  if (current) flushSection(current)
  return { modId: normalizeModId(modId), deps }
}

/**
 * 从单个 jar 提取身份与依赖声明；元数据读不到/解析失败返回
 * { fileName, modId: null, deps: [] }（调用方计入 skipped）。
 */
export function extractJarDeps(absPath: string, fileName: string): ModJarDecl {
  try {
    const zip = openZip(absPath)
    if (zip.has('fabric.mod.json')) {
      const parsed = parseFabricDeps(zip.read('fabric.mod.json').toString('utf8'))
      if (parsed) return { fileName, modId: parsed.modId, deps: parsed.deps }
    }
    for (const name of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      if (!zip.has(name)) continue
      const parsed = parseForgeTomlDeps(zip.read(name).toString('utf8'))
      if (parsed) return { fileName, modId: parsed.modId, deps: parsed.deps }
    }
  } catch {
    // 坏 jar：跳过（组装器的 validZip 校验会另行排除）
  }
  return { fileName, modId: null, deps: [] }
}

/**
 * 依赖缺席审计（纯函数）。
 * @param decls 各 jar 的声明（extractJarDeps 产物）
 * 判定规则：
 * - required 目标不在在场 modId 集合 → missingRequired（启动必炸，强提示）；
 * - optional 目标不在场 → missingOptional（联动降级提示）；
 * - incompatible 目标在场 → conflicts（冲突共存，强提示）。
 */
export function auditDependencies(decls: ModJarDecl[]): DependencyAuditResult {
  const present = new Set<string>()
  const skipped: string[] = []
  for (const d of decls) {
    if (d.modId) present.add(d.modId)
    else skipped.push(d.fileName)
  }
  const missingRequired: string[] = []
  const missingOptional: string[] = []
  const conflicts: string[] = []
  for (const d of decls) {
    if (!d.modId) continue
    for (const dep of d.deps) {
      const hit = present.has(dep.target)
      if (dep.kind === 'required' && !hit) {
        missingRequired.push(`${d.fileName} 缺少必需前置模组 ${dep.target}——启动会失败，请先安装对应模组再打包。`)
      } else if (dep.kind === 'optional' && !hit) {
        missingOptional.push(`${d.fileName} 的可选联动模组 ${dep.target} 未安装——相关联动功能将不可用（不影响启动）。`)
      } else if (dep.kind === 'incompatible' && hit) {
        conflicts.push(`${d.fileName} 声明与 ${dep.target} 冲突，但两者都在包内——运行可能崩溃，请移除其一。`)
      }
    }
  }
  return {
    parsed: decls.length - skipped.length,
    skipped,
    missingRequired,
    missingOptional,
    conflicts
  }
}
