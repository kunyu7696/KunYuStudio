/**
 * 领域事实层（结构化槽）。
 *
 * 动机：agent_memory 是单池 4000 字自由文本，「加载器/版本/命名空间/已注册 ID/
 * 构建状态」这类决定修复方向的关键事实混在里面，先到先占、无法按槽取。
 * 本模块给每个项目一份固定槽的事实文件（.kunyu/project-facts.json）：
 * - 模型经 project_facts_write 显式写槽（确认事实后写，不猜）；
 * - 三个消费方共享同一份：Agent system 头部注入（generatePipeline）、
 *   续跑 notes 头部（runSession）、历史摘要的领域保留项（historyBudget 提示词）。
 *
 * 护栏：路径由 projectRoot 派生锁死 .kunyu/ 内；各槽字符/条数上限硬编码；
 * 解析失败一律返回空事实（不阻断工具循环）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 事实文件相对项目根路径 */
export const FACTS_REL_PATH = '.kunyu/project-facts.json'

/** 可写槽位 */
export type FactSlot = 'loader' | 'mcVersion' | 'namespace' | 'lastBuild' | 'registeredIds' | 'notes'

export interface ProjectFacts {
  /** 目标加载器（如 fabric / neoforge / forge） */
  loader?: string
  /** Minecraft 版本（如 1.21.1） */
  mcVersion?: string
  /** 模组 ID / 命名空间 */
  namespace?: string
  /** 最近一次构建/测试状态摘要（如「构建失败：缺 item model 注册」） */
  lastBuild?: string
  /** 已注册/已确认的内容 ID（去重数组） */
  registeredIds?: string[]
  /** 其他硬约束（用户明确纠正过的偏好等，短句数组） */
  notes?: string[]
}

/** 各槽上限（字符 / 条数），超限软失败引导精简 */
export const FACTS_LIMITS = {
  scalar: 60 as const,
  lastBuild: 120 as const,
  idEntry: 60 as const,
  idsMax: 50 as const,
  noteEntry: 120 as const,
  notesMax: 8 as const
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function cleanScalar(v: unknown, max: number): string {
  return asString(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

/** 读取项目事实；文件缺失/损坏一律返回 {} */
export function readFacts(root: string | null | undefined): ProjectFacts {
  if (!root) return {}
  const file = join(root, FACTS_REL_PATH)
  if (!existsSync(file)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return {}
    const d = parsed as Record<string, unknown>
    const facts: ProjectFacts = {}
    const loader = cleanScalar(d['loader'], FACTS_LIMITS.scalar)
    const mcVersion = cleanScalar(d['mcVersion'], FACTS_LIMITS.scalar)
    const namespace = cleanScalar(d['namespace'], FACTS_LIMITS.scalar)
    const lastBuild = cleanScalar(d['lastBuild'], FACTS_LIMITS.lastBuild)
    if (loader) facts.loader = loader
    if (mcVersion) facts.mcVersion = mcVersion
    if (namespace) facts.namespace = namespace
    if (lastBuild) facts.lastBuild = lastBuild
    if (Array.isArray(d['registeredIds'])) {
      facts.registeredIds = d['registeredIds']
        .map((v) => cleanScalar(v, FACTS_LIMITS.idEntry))
        .filter((v) => v.length > 0)
        .slice(0, FACTS_LIMITS.idsMax)
    }
    if (Array.isArray(d['notes'])) {
      facts.notes = d['notes']
        .map((v) => cleanScalar(v, FACTS_LIMITS.noteEntry))
        .filter((v) => v.length > 0)
        .slice(0, FACTS_LIMITS.notesMax)
    }
    return facts
  } catch {
    return {}
  }
}

export interface FactWriteResult {
  ok: boolean
  reason?: string
}

/** 写单个槽（覆盖语义：registeredIds/notes 为追加并去重，其余标量覆盖） */
export function writeFactSlot(root: string, slot: FactSlot, rawValue: unknown): FactWriteResult {
  if (slot !== 'registeredIds' && slot !== 'notes') {
    const value = cleanScalar(rawValue, slot === 'lastBuild' ? FACTS_LIMITS.lastBuild : FACTS_LIMITS.scalar)
    if (!value) return { ok: false, reason: '槽内容不能为空' }
    const facts = readFacts(root)
    if (slot === 'loader') facts.loader = value
    else if (slot === 'mcVersion') facts.mcVersion = value
    else if (slot === 'namespace') facts.namespace = value
    else facts.lastBuild = value
    return persistFacts(root, facts)
  }
  // registeredIds / notes：追加去重
  const entryMax = slot === 'registeredIds' ? FACTS_LIMITS.idEntry : FACTS_LIMITS.noteEntry
  const listMax = slot === 'registeredIds' ? FACTS_LIMITS.idsMax : FACTS_LIMITS.notesMax
  const entry = cleanScalar(rawValue, entryMax)
  if (!entry) return { ok: false, reason: '槽内容不能为空' }
  const facts = readFacts(root)
  const list = slot === 'registeredIds' ? (facts.registeredIds ?? []) : (facts.notes ?? [])
  if (list.includes(entry)) return { ok: true }
  if (list.length >= listMax) {
    return { ok: false, reason: `${slot} 已达 ${listMax} 条上限，请先清理过期条目（重写该槽整体覆盖）` }
  }
  if (slot === 'registeredIds') facts.registeredIds = [...list, entry]
  else facts.notes = [...list, entry]
  return persistFacts(root, facts)
}

function persistFacts(root: string, facts: ProjectFacts): FactWriteResult {
  const file = join(root, FACTS_REL_PATH)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(facts, null, 2)}\n`, 'utf-8')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: `写入事实文件失败：${(e as Error).message}` }
  }
}

/** 把事实压成一行紧凑文本；空事实返回 null（不占上下文） */
export function factsToPromptLine(facts: ProjectFacts): string | null {
  const parts: string[] = []
  if (facts.loader || facts.mcVersion) {
    parts.push(`目标 ${[facts.loader, facts.mcVersion].filter(Boolean).join(' ')}`)
  }
  if (facts.namespace) parts.push(`命名空间 ${facts.namespace}`)
  if (facts.registeredIds && facts.registeredIds.length > 0) {
    parts.push(`已注册 ID：${facts.registeredIds.join(', ')}`)
  }
  if (facts.lastBuild) parts.push(`最近构建：${facts.lastBuild}`)
  if (facts.notes && facts.notes.length > 0) parts.push(`约束：${facts.notes.join('；')}`)
  return parts.length > 0 ? parts.join('｜') : null
}
