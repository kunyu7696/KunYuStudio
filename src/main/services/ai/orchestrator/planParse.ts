// ---------------------------------------------------------------------------
// 解析与校验
// ---------------------------------------------------------------------------
import { isAbsolute, resolve, sep } from 'node:path'

import type { AgentFileChange, AgentPlan, PlannedSubtask } from '../../../../shared/types/agent'
import { checkProjectSourceWritable, lintBraceBalance } from '../fcTools/projectFilePolicy'
import {
  ALL_TIER_IDS,
  WEAVER_MAX_SUBTASKS,
  type StageId,
  type TierId
} from '../../../../shared/types/tiers'
import type { ResolvedProject } from './types'

export function parsePlanJson(raw: string, tier: TierId): AgentPlan | null {
  const obj = extractJsonObject(raw)
  if (!obj) return null
  const intent = obj['intent']
  if (intent !== 'chat' && intent !== 'code' && intent !== 'fix' && intent !== 'verify') {
    return null
  }
  const contentTypes = Array.isArray(obj['contentTypes'])
    ? obj['contentTypes'].filter((v): v is string => typeof v === 'string')
    : []
  const stages = Array.isArray(obj['stages'])
    ? (obj['stages'].filter(
        (v): v is StageId => v === 'generate' || v === 'build' || v === 'test'
      ) as StageId[])
    : []
  const goal = typeof obj['goal'] === 'string' ? obj['goal'] : ''
  const plan: AgentPlan = { intent, contentTypes, stages, goal, tier }
  // 实体生成模式（contentTypes 含 entity 时由 understand 判定；缺省 schema 向后兼容）
  if (obj['entityMode'] === 'schema' || obj['entityMode'] === 'freeform') {
    plan.entityMode = obj['entityMode']
  }
  // bridge 迁移计划
  const mp = obj['migrationPlan']
  if (typeof mp === 'object' && mp !== null) {
    const m = mp as Record<string, unknown>
    const modules = Array.isArray(m['modules'])
      ? m['modules'].filter((v): v is string => typeof v === 'string').slice(0, WEAVER_MAX_SUBTASKS)
      : []
    if (modules.length > 0) {
      plan.migrationPlan = {
        sourceLoader: typeof m['sourceLoader'] === 'string' ? m['sourceLoader'] : 'unknown',
        targetLoader: typeof m['targetLoader'] === 'string' ? m['targetLoader'] : 'fabric',
        modules
      }
    }
  }
  // weaver 子任务：兼容 string[] 与结构化 {goal,tier}[]
  if (Array.isArray(obj['subtasks'])) {
    const subtasks: PlannedSubtask[] = []
    for (const item of obj['subtasks'].slice(0, WEAVER_MAX_SUBTASKS)) {
      if (typeof item === 'string') {
        if (item.trim()) subtasks.push({ goal: item })
      } else if (typeof item === 'object' && item !== null) {
        const r = item as Record<string, unknown>
        if (typeof r['goal'] === 'string' && r['goal'].trim()) {
          const tier = ALL_TIER_IDS.includes(r['tier'] as TierId)
            ? (r['tier'] as TierId)
            : undefined
          subtasks.push({ goal: r['goal'], tier })
        }
      }
    }
    if (subtasks.length > 0) plan.subtasks = subtasks
  }
  return plan
}

export function sanitizePlan(plan: AgentPlan, userMessage: string): AgentPlan {
  let stages = plan.stages
  const order: StageId[] = ['generate', 'build', 'test']
  stages = [...new Set(stages)].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  if ((plan.intent === 'code' || plan.intent === 'fix') && !stages.includes('generate')) {
    stages = ['generate', 'build']
  }
  if (plan.intent === 'code' || plan.intent === 'fix') {
    if (!stages.includes('generate')) stages.unshift('generate')
    if (!stages.includes('build')) stages.push('build')
  }
  // code/fix/verify 默认都含测试阶段：GameTest 无头预跑成本低，
  // kunyu-observer 离线时优雅跳过（status='skipped'），不会卡流水线
  if (
    (plan.intent === 'code' || plan.intent === 'fix' || plan.intent === 'verify') &&
    !stages.includes('test')
  ) {
    stages.push('test')
  }
  const contentTypes =
    plan.contentTypes.length > 0 ? plan.contentTypes : detectFallbackTypes(userMessage)
  return { ...plan, stages, contentTypes, goal: plan.goal || userMessage.slice(0, 80) }
}

function detectFallbackTypes(message: string): string[] {
  if (/配方|合成|recipe|熔炼/i.test(message)) return ['recipe']
  if (/界面|gui|screen|菜单/i.test(message)) return ['gui']
  if (/混入|mixin|注入/i.test(message)) return ['mixin']
  if (/指令|命令|command/i.test(message)) return ['command']
  // 武器/工具/装备/食物等物品类需求必须路由到 item，否则参考包检索成 block，
  // 弱模型拿到错误模板上下文后极易零产出（实测「做一把XX之刃」被误路由为 block）
  if (
    /剑|刀|枪|弓|弩|盾|斧|镐|锄|铲|武器|工具|物品|盔甲|护甲|铠甲|头盔|胸甲|护腿|靴子|食物|道具|item|sword|blade|weapon|tool|armor|food/i.test(
      message
    )
  )
    return ['item']
  if (/实体|生物|entity|mob/i.test(message)) return ['entity']
  return ['block']
}

export interface CoderPayload {
  files: Array<{ path: unknown; action: unknown; content: unknown }>
  notes: string
  /** 验收契约（特征③）：LLM 输出未知结构，由 contractEvaluator.parseContract 防御性解析 */
  contract?: unknown
}

export function parseCoderJson(raw: string): CoderPayload {
  const obj = extractJsonObject(raw)
  if (!obj || !Array.isArray(obj['files'])) return { files: [], notes: '' }
  const files = obj['files']
    .filter(
      (f): f is Record<string, unknown> =>
        typeof f === 'object' && f !== null && typeof f['path'] === 'string'
    )
    .map((f) => ({ path: f['path'], action: f['action'], content: f['content'] }))
  const notes = typeof obj['notes'] === 'string' ? obj['notes'] : ''
  // contract 字段透传：仅当对象类型时才传，否则 undefined（contractEvaluator 会返回 null）
  const contractRaw = obj['contract']
  const contract = contractRaw && typeof contractRaw === 'object' ? contractRaw : undefined
  return { files, notes, contract }
}

/**
 * 文件变更安全校验：
 * - 路径必须为相对路径（拒绝盘符/UNC/前导斜杠）
 * - 归一化 POSIX；任何 `..` 段直接拒绝
 * - 扩展名白名单 + Gradle 构建文件黑名单（与 write_project_file 工具同一闸门，
 *   堵「JSON 通道落盘 build.gradle → 同轮自动构建执行」的提示注入 → RCE 链路）
 * - 有项目时解析为绝对路径后必须仍位于项目根内
 */
export function validateFileChanges(
  rawFiles: Array<{ path: unknown; action: unknown; content: unknown }>,
  project: ResolvedProject | null
): AgentFileChange[] {
  const result: AgentFileChange[] = []
  for (const f of rawFiles) {
    const posix = String(f.path).replace(/\\/g, '/').replace(/^\/+/, '')
    const action = f.action === 'modify' ? 'modify' : 'create'
    const content = typeof f.content === 'string' ? f.content : ''
    const change: AgentFileChange = { path: posix, action, content, accepted: false }

    const writable = checkProjectSourceWritable(posix)
    if (!content) {
      change.reason = '文件内容为空，已拒绝'
    } else if (/^[a-zA-Z]:/.test(String(f.path))) {
      change.reason = '拒绝绝对路径（盘符）'
    } else if (isAbsolute(String(f.path))) {
      change.reason = '拒绝绝对路径'
    } else if (posix.split('/').some((seg) => seg === '..')) {
      change.reason = '路径包含 .. 越界段，已拒绝'
    } else if (!writable.ok) {
      change.reason = writable.reason ?? '文件类型不允许 AI 通道写盘'
    } else if (project) {
      const root = resolve(project.path)
      const abs = resolve(root, posix)
      const inside = abs === root || abs.startsWith(root + sep)
      if (!inside) {
        change.reason = '目标路径逃逸项目根，已拒绝'
      } else {
        change.accepted = true
        // 硬护栏：.java 花括号配平（剥离注释/字符串后计数）。截断/丢括号的
        // 半成品直写盘会废掉整轮 Gradle 构建，且治愈循环修复成本高——
        // 这里直接拒绝并把原因挂在 change.reason 上回传模型自纠
        //（generatePipeline 会把被拒原因并入缺口清单，随补救轮定向回灌）。
        if (posix.endsWith('.java')) {
          const braceErr = lintBraceBalance(content)
          if (braceErr) {
            change.accepted = false
            change.reason = `${braceErr}，已拒绝写盘，请提交完整闭合的文件全文`
          }
        }
      }
    } else {
      // 无项目：片段模式，不写盘也不标记 accepted
      change.reason = '当前无打开项目，仅作为代码片段展示，未写盘'
    }
    result.push(change)
  }
  return result
}

export function mergeFileChanges(
  existing: AgentFileChange[],
  incoming: AgentFileChange[]
): AgentFileChange[] {
  const map = new Map(existing.map((f) => [f.path, f]))
  for (const f of incoming) map.set(f.path, f)
  return [...map.values()]
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}
