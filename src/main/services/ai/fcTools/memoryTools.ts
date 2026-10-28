/**
 * B3 通用 Agent 地基：项目级持久记忆（agent_memory_read / append / clear）。
 *
 * 解决的问题：Agent 的「记性」原本只存活于单次会话——跨会话后，用户定过的
 * 包名约定、已确认的注册方案、排雷结论都要重新交代。本片段给每个项目一份
 * 持久记忆文件（.kunyu/agent-memory.md），模型可显式读写，跨会话留存。
 *
 * 边界与护栏：
 * - 路径完全由 projectRoot 派生，不接受任何模型输入的路径，锁死在 .kunyu/ 内；
 * - 条目单行化（换行折叠为空格），单条上限 500 字、总量上限 4000 字——
 *   防无限膨胀，超限软失败并引导精简；
 * - 规范化去重：同内容条目重复 append 直接返回已有，不刷屏；
 * - 仅项目上下文可见（visibility 'project'）；用户可随时手动删文件，
 *   与 agent_memory_clear 等价。
 *
 * 会话启动自动注入系统提示暂不做（保持最小面，后续按需再议）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { clipToolText } from './textClip'
import { FACTS_LIMITS, FACTS_REL_PATH, writeFactSlot, type FactSlot } from './projectFacts'

/** 记忆文件相对项目根路径（路径唯一来源，模型不可控） */
const MEMORY_REL_PATH = '.kunyu/agent-memory.md'
/** 单条记忆字符上限 */
const MAX_ENTRY_CHARS = 500
/** 记忆文件总字符上限（防膨胀烧上下文） */
const MAX_TOTAL_CHARS = 4_000

const FILE_HEADER = '# Agent 项目记忆（.kunyu/agent-memory.md）\n\n'

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 条目单行化 + 去首尾空白（换行/制表折叠为空格） */
export function normalizeEntry(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** 从文件内容提取已存在的条目（规范化后，供去重比对） */
export function listEntries(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((l) => normalizeEntry(l.replace(/^\s*-\s+/, '')))
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

export interface MemoryAppendResult {
  ok: boolean
  reason?: string
  /** true = 内容已存在，未重复写入 */
  duplicate?: boolean
}

/** 追加一条记忆（纯逻辑导出以便单测直接覆盖上限/去重） */
export function appendMemoryEntry(root: string, rawEntry: string): MemoryAppendResult {
  const entry = normalizeEntry(rawEntry)
  if (!entry) return { ok: false, reason: '记忆内容不能为空' }
  if (entry.length > MAX_ENTRY_CHARS) {
    return { ok: false, reason: `单条记忆超长（${entry.length} 字 > 上限 ${MAX_ENTRY_CHARS}），请浓缩后再记` }
  }
  const file = join(root, MEMORY_REL_PATH)
  const content = existsSync(file) ? readFileSync(file, 'utf-8') : FILE_HEADER
  if (listEntries(content).includes(entry)) return { ok: true, duplicate: true }
  const next = `${content.replace(/\s*$/, '')}\n- ${entry}\n`
  if (next.length > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      reason: `记忆已达总量上限（${MAX_TOTAL_CHARS} 字），请先 agent_memory_clear 或手动精简 ${MEMORY_REL_PATH}`
    }
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, next, 'utf-8')
  return { ok: true }
}

function readMemory(root: string): string | null {
  const file = join(root, MEMORY_REL_PATH)
  if (!existsSync(file)) return null
  const body = readFileSync(file, 'utf-8').trim()
  // 只剩文件头视为无记忆
  return body === FILE_HEADER.trim() || body === '' ? null : body
}

export function builtinMemoryTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'agent_memory_read',
        description:
          '读取本项目的持久记忆（.kunyu/agent-memory.md）：跨会话保留的约定、已确认方案与排雷结论。' +
          '开始一段连续工作前建议先读一次，避免重复询问用户已交代过的事。',
        parameters: { type: 'object', properties: {} }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '无打开的项目' }
      const body = readMemory(root)
      if (body === null) {
        return { ok: true, text: '暂无项目记忆。重要约定或结论可用 agent_memory_append 记下，跨会话生效。', data: { entries: 0 } }
      }
      return { ok: true, text: clipToolText(body), data: { entries: listEntries(body).length } }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'agent_memory_append',
        description:
          '向本项目持久记忆追加一条内容（单行，自动去重）。用于记下用户明确要求、关键决策、' +
          '验证过的结论（如「包名统一 com.example.mod」「盗贼实体注册方案已确认」）。' +
          `单条上限 ${MAX_ENTRY_CHARS} 字，总量上限 ${MAX_TOTAL_CHARS} 字；只记跨会话仍有价值的，不记流水账。`,
        parameters: {
          type: 'object',
          properties: {
            entry: { type: 'string', description: '要记下的一条记忆（单行，浓缩表达）' }
          },
          required: ['entry']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '无打开的项目' }
      try {
        const r = appendMemoryEntry(root, asString(args['entry']))
        if (!r.ok) return { ok: false, text: '', error: r.reason ?? '写入失败' }
        if (r.duplicate) return { ok: true, text: '该条记忆已存在，未重复写入。', data: { duplicate: true } }
        return { ok: true, text: `已记入项目记忆（${MEMORY_REL_PATH}）。`, data: { duplicate: false } }
      } catch (e) {
        return { ok: false, text: '', error: `写入记忆失败：${(e as Error).message}` }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'agent_memory_clear',
        description:
          '清空本项目的持久记忆（删除 .kunyu/agent-memory.md，等价于用户手动删除该文件）。' +
          '仅在用户明确要求清空或记忆已大面积过期时使用。',
        parameters: { type: 'object', properties: {} }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '无打开的项目' }
      const file = join(root, MEMORY_REL_PATH)
      if (!existsSync(file)) return { ok: true, text: '本就没有项目记忆，无需清空。' }
      try {
        rmSync(file)
        return { ok: true, text: '项目记忆已清空。' }
      } catch (e) {
        return { ok: false, text: '', error: `清空失败：${(e as Error).message}` }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'project_facts_write',
        description:
          '向项目事实槽写入一条结构化事实（.kunyu/project-facts.json）。' +
          '与 agent_memory_append 的分工：事实槽放「决定修复方向的结构化事实」' +
          '（加载器、MC 版本、命名空间、已注册内容 ID、最近构建状态、硬约束），' +
          'memory 放叙述性约定；事实槽会被注入每轮 system 头部与续跑提示，摘要时强制保留。' +
          `确认事实后写，不要猜：loader/mcVersion/namespace 上限 ${FACTS_LIMITS.scalar} 字，` +
          `lastBuild 上限 ${FACTS_LIMITS.lastBuild} 字，registeredIds/notes 为追加去重（各 ${FACTS_LIMITS.idsMax}/${FACTS_LIMITS.notesMax} 条）。`,
        parameters: {
          type: 'object',
          properties: {
            slot: {
              type: 'string',
              enum: ['loader', 'mcVersion', 'namespace', 'lastBuild', 'registeredIds', 'notes'],
              description: '要写入的槽位'
            },
            value: { type: 'string', description: '槽内容（registeredIds/notes 追加一条，其余覆盖）' }
          },
          required: ['slot', 'value']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '无打开的项目' }
      const slot = asString(args['slot']) as FactSlot
      const validSlots: FactSlot[] = ['loader', 'mcVersion', 'namespace', 'lastBuild', 'registeredIds', 'notes']
      if (!validSlots.includes(slot)) return { ok: false, text: '', error: `未知槽位：${slot}` }
      try {
        const r = writeFactSlot(root, slot, args['value'])
        if (!r.ok) return { ok: false, text: '', error: r.reason ?? '写入失败' }
        return { ok: true, text: `已写入项目事实（${FACTS_REL_PATH} 的 ${slot} 槽），将注入后续轮次与续跑提示。` }
      } catch (e) {
        return { ok: false, text: '', error: `写入事实失败：${(e as Error).message}` }
      }
    }
  })

  return tools
}
