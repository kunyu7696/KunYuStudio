/**
 * Playbook 层类型（SKILL playbook 层）。
 *
 * 结构化规程设计，五段结构：
 *
 *   意图触发 → 工具路由 → 工作流 → 验收门 → 失败契约
 *
 *  playbook 是纯数据 + 纯函数（不 import electron），选择/渲染全程可单测。
 * 设计定位：generate 阶段 system prompt 的「增量指引层」——主提示已有硬约束，
 * playbook 只在任务明确命中时注入对应规程的路由/验收要点，不重复全量纪律。
 */
import type { AgentIntent } from '../../../../shared/types/agent'

/**
 * 工具路由：一组有序工具 + 使用时机说明。
 * tools 必须真实存在于 FC 工具注册表（spec 用 createToolRegistry().has() 交叉校验，
 * 工具改名/删除时立刻暴露漂移）。
 */
export interface PlaybookRoute {
  tools: string[]
  note: string
}

export interface Playbook {
  id: string
  title: string
  /** 意图触发：用户原话命中任一关键词 +1（大小写不敏感子串匹配） */
  triggers: string[]
  /** 意图触发：plan.contentTypes 每命中一个 +3 */
  contentTypes?: string[]
  /** 意图触发：plan.intent 命中 +2 */
  intents?: AgentIntent[]
  /** 意图触发：项目类型命中 +2（如 modpack 走市场路由） */
  projectTypes?: string[]
  /** 工具路由 */
  route: PlaybookRoute
  /** 工作流：有序步骤（渲染时自动编号） */
  workflow: string[]
  /** 验收门：宣告完成前必须通过的检查 */
  acceptanceGates: string[]
  /** 失败契约：失败时必须遵守的行为（如实声明，不假装成功） */
  failureContract: string[]
}

export interface PlaybookSelectionInput {
  /** 用户原话 */
  message: string
  /** understand 阶段判定的意图 */
  intent?: AgentIntent | string
  /** understand 阶段判定的内容类型 */
  contentTypes?: string[]
  /** 当前项目类型（modpack 等）；无项目传 null */
  projectType?: string | null
  /** 注入条数上限（默认 3） */
  max?: number
  /** 命中阈值（默认 3 分）：低于此分不注入，避免 system prompt 膨胀 */
  threshold?: number
}
