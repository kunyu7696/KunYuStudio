/**
 * 动画控制器（B1-2，v2）：状态机定义 → 生成链消费。
 *
 * 定位：控制器是「什么时候播什么动画」的生成链元数据，存放在
 * `doc.formatData.controllers`（数组，v2 仅消费第一个），随文档落盘/撤销栈
 * 自动继承——本模块只提供纯函数读写与校验，UI/生成器各取所需。
 *
 * 与 Bedrock .animation_controllers.json 的关系：同名概念不同消费端——
 * KunYu 主链走 GeckoLib（Java 侧谓词），Bedrock 控制器 JSON（molang 表达式）
 * 的四谓词文档化子集互操作见 formats/bedrockController.ts（B5-2，
 * always/is_moving/is_attacking/is_hurt ↔ 规范 molang 形）。
 */
import { CONTROLLER_CONDITIONS } from './types'
import type { ControllerCondition, ModelAnimationController, ModelDocument } from './types'

/** 条件谓词的中文标签（UI 下拉与 Java 代码注释共用） */
export const CONTROLLER_CONDITION_LABELS: Record<ControllerCondition, string> = {
  always: '总是',
  is_moving: '移动中',
  is_attacking: '攻击中',
  is_hurt: '受伤中'
}

/* ------------------------------------------------------------------ */
/* 读写（不可变）                                                        */
/* ------------------------------------------------------------------ */

/** 从 formatData 读控制器列表（非数组/条目非法 → 空表） */
export function getControllers(doc: ModelDocument): ModelAnimationController[] {
  const raw = doc.formatData?.controllers
  if (!Array.isArray(raw)) return []
  return raw.filter(isController)
}

function isController(v: unknown): v is ModelAnimationController {
  if (!v || typeof v !== 'object') return false
  const c = v as ModelAnimationController
  return (
    typeof c.name === 'string' &&
    typeof c.initialState === 'string' &&
    Array.isArray(c.states) &&
    Array.isArray(c.transitions)
  )
}

/** 写回控制器列表（空数组删除键，保持 formatData 干净） */
export function withControllers(doc: ModelDocument, list: ModelAnimationController[]): ModelDocument {
  const formatData = { ...(doc.formatData ?? {}) }
  if (list.length === 0) delete formatData.controllers
  else formatData.controllers = list
  return { ...doc, formatData, meta: { ...doc.meta, updatedAt: Date.now() } }
}

/** upsert 单个控制器（按 name 去重替换，无名追加） */
export function upsertController(doc: ModelDocument, ctrl: ModelAnimationController): ModelDocument {
  const list = getControllers(doc)
  const at = list.findIndex((c) => c.name === ctrl.name)
  const next = at >= 0 ? [...list.slice(0, at), ctrl, ...list.slice(at + 1)] : [...list, ctrl]
  return withControllers(doc, next)
}

/** 删除控制器（按 name；不存在原样返回） */
export function removeController(doc: ModelDocument, name: string): ModelDocument {
  const list = getControllers(doc)
  if (!list.some((c) => c.name === name)) return doc
  return withControllers(doc, list.filter((c) => c.name !== name))
}

/* ------------------------------------------------------------------ */
/* 校验（UI 保存前与生成器消费前共用）                                     */
/* ------------------------------------------------------------------ */

export interface ControllerIssue {
  code:
    | 'initial_state_missing'
    | 'duplicate_state'
    | 'state_animation_missing'
    | 'transition_endpoint_missing'
    | 'condition_unknown'
  message: string
}

/**
 * 校验控制器：初始状态存在、状态名唯一、引用动画在文档内、转移端点已知、
 * 条件在枚举子集内。返回空数组 = 可进生成链。
 */
export function validateController(doc: ModelDocument, ctrl: ModelAnimationController): ControllerIssue[] {
  const issues: ControllerIssue[] = []
  const stateNames = new Set<string>()
  for (const s of ctrl.states) {
    if (stateNames.has(s.name)) {
      issues.push({ code: 'duplicate_state', message: `控制器「${ctrl.name}」状态「${s.name}」重复` })
    }
    stateNames.add(s.name)
    if (!doc.animations[s.animation]) {
      issues.push({
        code: 'state_animation_missing',
        message: `控制器「${ctrl.name}」状态「${s.name}」引用的动画 ${s.animation} 不存在`
      })
    }
  }
  if (ctrl.states.length > 0 && !stateNames.has(ctrl.initialState)) {
    issues.push({
      code: 'initial_state_missing',
      message: `控制器「${ctrl.name}」初始状态「${ctrl.initialState}」不在状态列表中`
    })
  }
  for (const t of ctrl.transitions) {
    if (!stateNames.has(t.from) || !stateNames.has(t.to)) {
      issues.push({
        code: 'transition_endpoint_missing',
        message: `控制器「${ctrl.name}」转移 ${t.from} → ${t.to} 的端点不在状态列表中`
      })
    }
    if (!(CONTROLLER_CONDITIONS as readonly string[]).includes(t.condition)) {
      issues.push({
        code: 'condition_unknown',
        message: `控制器「${ctrl.name}」转移条件「${t.condition}」不在 v2 谓词子集内`
      })
    }
  }
  return issues
}

/**
 * 生成链消费入口：取首个控制器，校验全过返回它，否则返回 null
 * （生成器回退 idle/walk 硬编码，坏状态机不阻断生成——与 P4-gen
 * 「文档损坏回退模板动画」同约定）。
 */
export function resolveEntityController(doc: ModelDocument): ModelAnimationController | null {
  const first = getControllers(doc)[0]
  if (!first) return null
  return validateController(doc, first).length === 0 ? first : null
}
