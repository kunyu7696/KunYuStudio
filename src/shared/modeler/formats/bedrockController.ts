/**
 * Bedrock 动画控制器文件编解码（B5-2，v2）。
 *
 * 产物契约：bedrock.dev 公开规范的 .animation_controllers.json（format_version
 * 1.10.0 文档化子集）：
 * { format_version, animation_controllers: { "controller.animation.<ns>.<name>":
 *   { initial_state, states: { <stateName>: { animations?: string[],
 *     transitions?: Array<Record<toState, molang>> } } } } }。
 * clean-room 红线：仅依据 bedrock.dev / Microsoft Learn 公开规范独立实现，
 * 不读取、不复制任何第三方编辑器（Blockbench 等）源码。
 *
 * 条件谓词 ↔ molang 映射（v2 文档化子集，均有官方文档支撑；与 Java 生成端
 * javaEntities.buildGeoPredicateFromController 的谓词语义对齐）：
 * - always       → "1.0"（molang 数值字面量恒真，进入状态即立即转移）
 * - is_moving    → "query.is_moving"（MS Learn query_is_moving：移动时 1.0）
 * - is_attacking → "variable.attack_time > 0"（MS Learn：挥击进度变量，
 *                  引擎自动写入，非攻击时 0.0）
 * - is_hurt      → "query.hurt_time > 0"（MS Learn：受伤剩余时间，否则 0）
 * 导入只认上述四个规范形（忽略空白/比较符等价形），其余任意 molang 表达式
 * 一律告警跳过——不做 molang 求值器。
 *
 * 与 .animation.json 的关系：控制器引用的动画按 bedrockAnim 同一命名规则
 * （anim.name 含 '.' 直用，否则 animation.<ns>.<name>）解析回文档动画。
 * 文档模型 v2 仅消费 formatData.controllers[0]：导出只写首个控制器，
 * 导入把目标控制器 upsert（按 name）并置顶为激活控制器。
 */
import { getControllers } from '../controller'
import { CONTROLLER_CONDITIONS } from '../types'
import type {
  ControllerCondition,
  ControllerTransition,
  ModelAnimationController,
  ModelDocument
} from '../types'
import type { BedrockFormatData } from './bedrock'
import type { FormatDowngrade, FormatExportResult, FormatImportResult } from './types'

/* ------------------------------------------------------------------ */
/* .animation_controllers.json 类型（1.10.0 公开规范子集）                */
/* ------------------------------------------------------------------ */

export interface BedrockControllerStateJson {
  /** 该状态播放的动画（客户端实体 animations 表的键；字符串 = 单动画简写） */
  animations?: string | string[]
  /** 转移表：单键对象 { 目标状态名: molang 表达式 }，按数组序求值 */
  transitions?: Array<Record<string, string>>
  /** 进入/离开状态命令与局部变量（公开规范字段；v2 不支持，导入丢弃并 info） */
  on_entry?: unknown[]
  on_exit?: unknown[]
  variables?: Record<string, unknown>
}

export interface BedrockControllerJson {
  initial_state?: string
  states?: Record<string, BedrockControllerStateJson>
}

export interface BedrockControllerFileJson {
  format_version?: string
  animation_controllers?: Record<string, BedrockControllerJson>
}

/** 导出产物类型：format_version 与 animation_controllers 保证存在 */
export interface BedrockControllerFile extends BedrockControllerFileJson {
  format_version: '1.10.0'
  animation_controllers: Record<string, BedrockControllerJson>
}

/* ------------------------------------------------------------------ */
/* 小工具（编解码模块自包含约定，与 bedrockAnim 同形）                     */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function safeIdPart(raw: string, fallback: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
  return s.length > 0 ? s : fallback
}

/** 控制器命名空间（与 bedrockAnim resolveNamespace 同规则） */
function resolveNamespace(doc: ModelDocument): string {
  const bedrock = (isRecord(doc.formatData?.bedrock) ? doc.formatData!.bedrock : {}) as BedrockFormatData
  const idf = bedrock.identifier?.replace(/^geometry\./i, '')
  return (idf && idf.replace(/[^a-zA-Z0-9_.-]/g, '_')) || safeIdPart(doc.id, 'model')
}

/* ------------------------------------------------------------------ */
/* 条件谓词 ↔ molang 映射                                                */
/* ------------------------------------------------------------------ */

/** 导出：文档谓词 → 规范 molang 表达式 */
function conditionToMolang(c: ControllerCondition): string {
  switch (c) {
    case 'always':
      return '1.0'
    case 'is_moving':
      return 'query.is_moving'
    case 'is_attacking':
      return 'variable.attack_time > 0'
    case 'is_hurt':
      return 'query.hurt_time > 0'
  }
}

/**
 * 导入：molang 表达式 → 文档谓词。只认四个规范形的等价写法
 * （去空白、比较符等价形），其余返回 null 由调用方告警跳过。
 */
function molangToCondition(raw: string): ControllerCondition | null {
  const s = raw.replace(/\s+/g, '').toLowerCase()
  if (s === '1' || s === '1.0' || s === '1.00') return 'always'
  if (s === 'query.is_moving' || s === 'query.is_moving!=0' || s === 'query.is_moving==1' || s === 'query.is_moving==1.0') {
    return 'is_moving'
  }
  if (s === 'variable.attack_time>0' || s === 'variable.attack_time!=0') return 'is_attacking'
  if (s === 'query.hurt_time>0' || s === 'query.hurt_time!=0') return 'is_hurt'
  return null
}

/* ------------------------------------------------------------------ */
/* 导出：ModelDocument → .animation_controllers.json                     */
/* ------------------------------------------------------------------ */

/** 动画 id → Bedrock 动画名（与 bedrockAnim documentToAnimations 同规则） */
function animationBedrockName(doc: ModelDocument, animId: string): string | null {
  const anim = doc.animations[animId]
  if (!anim) return null
  return anim.name.includes('.') ? anim.name : `animation.${resolveNamespace(doc)}.${safeIdPart(anim.name, 'anim')}`
}

export function documentToAnimationControllers(doc: ModelDocument): FormatExportResult<BedrockControllerFile> {
  const downgrades: FormatDowngrade[] = []
  const all = getControllers(doc)
  if (all.length === 0) {
    return {
      output: { format_version: '1.10.0', animation_controllers: {} },
      downgrades: [{ severity: 'info', code: 'no_controller', message: '文档没有动画控制器可导出' }]
    }
  }
  if (all.length > 1) {
    downgrades.push({
      severity: 'info',
      code: 'only_first_controller',
      message: `文档有 ${all.length} 个控制器，Bedrock 导出仅写入首个「${all[0]!.name}」`
    })
  }
  const ctrl = all[0]!

  const key = ctrl.name.includes('.') ? ctrl.name : `controller.animation.${resolveNamespace(doc)}.${safeIdPart(ctrl.name, 'controller')}`

  /* 状态：引用动画缺失 → 告警跳过该状态（Bedrock 状态必须落在动画上才有意义） */
  const states: Record<string, BedrockControllerStateJson> = {}
  const exportedNames = new Set<string>()
  for (const s of ctrl.states) {
    if (!s.name) {
      downgrades.push({
        severity: 'warning',
        code: 'state_name_empty',
        message: `控制器「${ctrl.name}」存在无名状态，已跳过`
      })
      continue
    }
    const animName = animationBedrockName(doc, s.animation)
    if (!animName) {
      downgrades.push({
        severity: 'warning',
        code: 'state_animation_missing',
        message: `控制器「${ctrl.name}」状态「${s.name}」引用的动画不存在，该状态已跳过`
      })
      continue
    }
    states[s.name] = { animations: [animName] }
    exportedNames.add(s.name)
  }

  /* 转移：按表序分桶到 from 状态（表序即求值优先级，与文档语义一致） */
  const transitionsByFrom = new Map<string, Array<Record<string, string>>>()
  for (const t of ctrl.transitions) {
    if (!exportedNames.has(t.from) || !exportedNames.has(t.to)) {
      downgrades.push({
        severity: 'warning',
        code: 'transition_endpoint_missing',
        message: `控制器「${ctrl.name}」转移 ${t.from} → ${t.to} 的端点不在已导出状态中，已跳过`
      })
      continue
    }
    if (!(CONTROLLER_CONDITIONS as readonly string[]).includes(t.condition)) {
      downgrades.push({
        severity: 'warning',
        code: 'condition_unknown',
        message: `控制器「${ctrl.name}」转移条件「${t.condition}」不在 v2 谓词子集内，已跳过`
      })
      continue
    }
    const bucket = transitionsByFrom.get(t.from) ?? []
    bucket.push({ [t.to]: conditionToMolang(t.condition) })
    transitionsByFrom.set(t.from, bucket)
  }
  for (const [from, list] of transitionsByFrom) states[from]!.transitions = list

  const hasInitial = exportedNames.has(ctrl.initialState)
  const initial = hasInitial ? ctrl.initialState : Object.keys(states)[0]
  if (!hasInitial) {
    downgrades.push({
      severity: 'warning',
      code: 'initial_state_missing',
      message:
        Object.keys(states).length > 0
          ? `控制器「${ctrl.name}」的初始状态「${ctrl.initialState}」未导出，回退「${initial}」`
          : `控制器「${ctrl.name}」的初始状态「${ctrl.initialState}」未导出（没有可导出状态）`
    })
  }
  if (Object.keys(states).length === 0) {
    downgrades.push({
      severity: 'warning',
      code: 'controller_empty',
      message: `控制器「${ctrl.name}」没有可导出的状态`
    })
  }

  const out: BedrockControllerJson = initial ? { initial_state: initial, states } : { states }
  return {
    output: { format_version: '1.10.0', animation_controllers: { [key]: out } },
    downgrades
  }
}

/* ------------------------------------------------------------------ */
/* 导入：.animation_controllers.json 合并进既有文档                        */
/* ------------------------------------------------------------------ */

/**
 * Bedrock 动画引用 → 文档动画 id（三级解析）：
 * 1. 全名精确：文件引用 === 文档动画 name（自有文件往返）；
 * 2. 短名后缀：文档动画 name 的尾段 === 文件引用（外来文件常引用客户端
 *    实体 animations 表的裸短名）；
 * 3. 引用尾段：文件引用的尾段 === 文档动画 name（文件带 ns 全名、文档存裸名）。
 * 都不中返回 null。
 */
function resolveAnimId(doc: ModelDocument, animName: string): string | null {
  const refTail = animName.split('.').pop()
  for (const anim of Object.values(doc.animations)) {
    if (anim.name === animName) return anim.id
  }
  for (const anim of Object.values(doc.animations)) {
    const tail = anim.name.split('.').pop()
    if (tail && tail === animName) return anim.id
  }
  if (refTail) {
    for (const anim of Object.values(doc.animations)) {
      if (anim.name === refTail) return anim.id
    }
  }
  return null
}

/**
 * 把 .animation_controllers.json 合并进既有文档。
 * v2 语义：仅消费首个控制器 → 导入也只取 animation_controllers 的首个条目，
 * upsert（按条目键为控制器 name）后置顶为激活控制器；其余条目告警忽略。
 * 返回的 doc 未命中任何可导入控制器时不变（引用相等，命令栈不产生补丁）。
 */
export function mergeControllerIntoDocument(
  input: string | BedrockControllerFileJson,
  doc: ModelDocument
): FormatImportResult {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch (e) {
      throw new Error(`.animation_controllers.json 解析失败：${String(e)}`)
    }
  }
  if (!isRecord(data) || !isRecord(data.animation_controllers)) {
    throw new Error('不是合法的 Bedrock 控制器文件：缺少 animation_controllers 对象')
  }

  const downgrades: FormatDowngrade[] = []
  const entries = Object.entries(data.animation_controllers)
  if (entries.length === 0) {
    return {
      doc,
      downgrades: [{ severity: 'info', code: 'no_controller', message: '文件中没有控制器' }]
    }
  }
  if (entries.length > 1) {
    downgrades.push({
      severity: 'info',
      code: 'only_first_controller',
      message: `文件含 ${entries.length} 个控制器，v2 仅导入首个「${entries[0]![0]}」`
    })
  }
  const [key, rawEntry] = entries[0]!
  const raw = (isRecord(rawEntry) ? rawEntry : {}) as BedrockControllerJson
  const rawStates = isRecord(raw.states) ? raw.states : {}

  /* 状态导入：动画引用解析失败 → 告警跳过该状态 */
  const stateByDoc: ModelAnimationController['states'] = []
  const stateNames = new Set<string>()
  let extrasDropped = false
  for (const [name, rawState] of Object.entries(rawStates)) {
    if (!name) continue
    const st = (isRecord(rawState) ? rawState : {}) as BedrockControllerStateJson
    if (st.on_entry !== undefined || st.on_exit !== undefined || st.variables !== undefined) {
      extrasDropped = true
    }
    const animList = Array.isArray(st.animations) ? st.animations : st.animations ? [st.animations] : []
    const firstResolvable = animList.map(String).find((a) => resolveAnimId(doc, a) !== null)
    if (!firstResolvable) {
      downgrades.push({
        severity: 'warning',
        code: 'state_animation_missing',
        message: `控制器「${key}」状态「${name}」引用的动画在文档中找不到，该状态已跳过`
      })
      continue
    }
    if (animList.length > 1) {
      downgrades.push({
        severity: 'warning',
        code: 'multi_animation_state',
        message: `控制器「${key}」状态「${name}」叠加了 ${animList.length} 段动画，v2 状态只引用一段，已取首个可解析的「${firstResolvable}」`
      })
    }
    stateByDoc.push({ name, animation: resolveAnimId(doc, firstResolvable)! })
    stateNames.add(name)
  }
  if (extrasDropped) {
    downgrades.push({
      severity: 'info',
      code: 'state_extras_dropped',
      message: `控制器「${key}」的状态含 on_entry/on_exit/variables 等附加定义，v2 不支持已丢弃`
    })
  }
  if (stateByDoc.length === 0) {
    downgrades.push({
      severity: 'warning',
      code: 'controller_empty',
      message: `控制器「${key}」没有可导入的状态`
    })
    return { doc, downgrades }
  }

  /* 转移导入：molang 只认四谓词规范形，其余告警跳过 */
  const transitions: ControllerTransition[] = []
  for (const [name, rawState] of Object.entries(rawStates)) {
    if (!stateNames.has(name) || !isRecord(rawState)) continue
    const st = rawState as BedrockControllerStateJson
    if (!Array.isArray(st.transitions)) continue
    for (const entry of st.transitions) {
      if (!isRecord(entry)) continue
      for (const [to, molangRaw] of Object.entries(entry)) {
        if (!stateNames.has(to)) {
          downgrades.push({
            severity: 'warning',
            code: 'transition_endpoint_missing',
            message: `控制器「${key}」转移 ${name} → ${to} 的目标状态未导入，已跳过`
          })
          continue
        }
        const condition =
          typeof molangRaw === 'string'
            ? molangToCondition(molangRaw)
            : Number(molangRaw) === 1
              ? 'always'
              : null
        if (!condition) {
          downgrades.push({
            severity: 'warning',
            code: 'condition_unsupported',
            message: `控制器「${key}」转移 ${name} → ${to} 的条件「${String(molangRaw)}」不在 v2 谓词子集内（Bedrock molang 任意表达式），已跳过`
          })
          continue
        }
        transitions.push({ from: name, to, condition })
      }
    }
  }

  /* initial_state 兜底：缺失/未导入 → 首个导入状态 */
  let initialState = typeof raw.initial_state === 'string' ? raw.initial_state : ''
  if (!stateNames.has(initialState)) {
    downgrades.push({
      severity: 'warning',
      code: 'initial_state_missing',
      message: `控制器「${key}」的 initial_state「${initialState || '(缺省)'}」未导入，回退首个状态「${stateByDoc[0]!.name}」`
    })
    initialState = stateByDoc[0]!.name
  }

  const imported: ModelAnimationController = {
    name: key,
    initialState,
    states: stateByDoc,
    transitions
  }

  /* upsert 按 name（条目键）替换后置顶：v2 仅消费 controllers[0]。
     不碰 meta.updatedAt——与 mergeAnimationsIntoDocument 先例一致，
     updatedAt 由命令栈侧的编辑操作维护 */
  const list = getControllers(doc).filter((c) => c.name !== key)
  const next = [imported, ...list]
  const formatData = { ...(doc.formatData ?? {}), controllers: next }
  return { doc: { ...doc, formatData }, downgrades }
}
