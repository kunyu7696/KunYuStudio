/**
 * 灵感台 · AI 创意生成的结构化产物。
 * 由主进程 plannerService 一次性拆解用户需求生成，渲染层（灵感台视图）做创意挑选。
 */

/** 全流程制作目标类型：模组 / 整合包（决定规划提示词与后续流水线档位） */
export type PlanProjectType = 'mod' | 'modpack'

/** AI 创意库中的一条候选创意 */
export interface ModPlanIdea {
  /** 稳定 id（planner 生成，渲染层用于加入/移出想法池） */
  id: string
  /** 创意标题（短，如「三册动态守则」） */
  title: string
  /** 创意描述（1-3 句中文，说明玩法与实现要点） */
  description: string
  /** AI 是否推荐（推荐卡片在 UI 中置顶高亮） */
  recommended: boolean
}

/** 一次「AI 极速规划」的完整结构化结果 */
export interface ModPlanDraft {
  /** 模组建议名（中文名，供用户参考/改名；留空串表示模型未给出） */
  suggestedName: string
  /** 规划概要（一段话，用户可改，改完直接构建） */
  summary: string
  /** AI 创意库（通常 4-6 条） */
  ideas: ModPlanIdea[]
}
