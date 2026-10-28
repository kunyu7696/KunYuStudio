/**
 * 五档 Agent 体系共享类型（M8，依《完整架构与代码文档》）。
 *
 * 五档：迅工 Sprinter / 匠造 Artisan / 大师 Master / 桥接 Bridge / 织星 Weaver。
 * 每档跑同一条全链路流水线（understand→generate→build→test→export），
 * 档位只控制深度（编译修复轮次 / 每轮文件数 / 工具调用轮次 / prompt 侧重）；
 * 模型默认沿用用户当前选择的厂商+模型，可在 AI 设置「分档模型」按档可选覆盖（留空即跟随）。
 *
 * 付费策略（文档定价模型）本期不做：全部免费不限量。
 */

export type TierId = 'sprinter' | 'artisan' | 'master' | 'bridge' | 'weaver'

/** 全链路流水线阶段（固定顺序，渲染层轨道直接渲染） */
export type StageId = 'understand' | 'generate' | 'build' | 'test' | 'export'

/** 档位开关：bridge 走迁移流程，weaver 走整合包子任务调度 */
export interface TierFlags {
  /** 迁移型：understand 产出 migrationPlan，generate 按模块顺序执行 */
  migration: boolean
  /** 整合包调度型：understand 拆 subtasks，generate 内联顺序执行子任务 */
  orchestrator: boolean
}

/** 单档配置 */
export interface TierConfig {
  id: TierId
  name: string
  title: string
  /** 一句话定位（UI 档位 chip 的 tooltip 与计划卡展示） */
  positioning: string
  /**
   * 真实 Gradle 构建失败后允许的自动修复（回炉）轮次上限：
   * 0 = 只构建一次直出、失败不回炉（迅工，成本最低）；
   * 总构建尝试次数 = maxBuildRounds + 1。
   */
  maxBuildRounds: number
  /** 单轮 generate 允许产出的文件变更数上限 */
  filesPerRound: number
  /**
   * generate 阶段 Function Calling 循环轮次上限（每轮一次 LLM 调用）：
   * 1 = 不做多轮检索、一次直出（迅工）；高档位允许更多轮检索-工具往返。
   */
  toolLoopRounds: number
  /** prompt 侧重（注入 generate system prompt） */
  promptStyle: string
  flags: TierFlags
}

/** 全档免费不限量（付费逻辑本期不做，仅占位便于后续接入） */
export const FREE_LIMITS = {
  /** 对话轮次：-1 不限 */
  maxConversationTurns: -1,
  /** 每日免费额度：-1 不限 */
  dailyFreeLimit: -1
} as const

export const ALL_TIER_IDS: TierId[] = ['sprinter', 'artisan', 'master', 'bridge', 'weaver']

/** 织星单次运行最多调度的子任务数（防止计划爆炸） */
export const WEAVER_MAX_SUBTASKS = 8

/**
 * run 级资源预算熔断：单次 Agent 运行的
 * 模型调用次数 / Gradle 构建次数 / 墙钟时长三维硬上限。
 * 超过任一维度即熔断停止并如实告知用户——「生成→构建修复→测试自愈」全链路的
 * 理论最坏可达上百次模型调用与数十次构建，对使用自带 API Key 的用户是直接的额度风险。
 * 数值按档位递增，覆盖各档「主生成 + 档位修复轮 + 适度自愈轮」的合理深度。
 */
export interface TierRunBudget {
  /** 模型调用总次数上限（understand/generate/构建修复/测试自愈/视觉自审全部计入） */
  maxModelCalls: number
  /** 真实 Gradle 构建总次数上限（含测试自愈触发的重建） */
  maxGradleBuilds: number
  /** 墙钟时长上限（分钟；思考型模型单轮可达数分钟，故高档位放宽） */
  maxWallMinutes: number
}

export const TIER_RUN_BUDGETS: Record<TierId, TierRunBudget> = {
  sprinter: { maxModelCalls: 24, maxGradleBuilds: 3, maxWallMinutes: 30 },
  artisan: { maxModelCalls: 48, maxGradleBuilds: 6, maxWallMinutes: 60 },
  master: { maxModelCalls: 72, maxGradleBuilds: 10, maxWallMinutes: 90 },
  bridge: { maxModelCalls: 96, maxGradleBuilds: 12, maxWallMinutes: 120 },
  weaver: { maxModelCalls: 144, maxGradleBuilds: 14, maxWallMinutes: 150 }
}

export const TIER_CONFIGS: Record<TierId, TierConfig> = {
  sprinter: {
    id: 'sprinter',
    name: '迅工',
    title: 'Sprinter',
    positioning: '模板直出，只构建一次不回炉，成本最低',
    maxBuildRounds: 0,
    filesPerRound: 5,
    toolLoopRounds: 1,
    promptStyle: '优先套用参考包模板做最小改动，保持代码精炼，禁止顺手重构。',
    flags: { migration: false, orchestrator: false }
  },
  artisan: {
    id: 'artisan',
    name: '匠造',
    title: 'Artisan',
    positioning: '对话驱动，1 轮修复，均衡默认',
    maxBuildRounds: 1,
    filesPerRound: 10,
    toolLoopRounds: 2,
    promptStyle: '结合模板与用户对话上下文生成完整实现，注重结构清晰与可维护性。',
    flags: { migration: false, orchestrator: false }
  },
  master: {
    id: 'master',
    name: '大师',
    title: 'Master',
    positioning: '深度打磨，最多 3 轮修复',
    maxBuildRounds: 3,
    filesPerRound: 20,
    toolLoopRounds: 3,
    promptStyle: '深度利用检索与工具调用，全面考虑边界情况、兼容性与性能，打磨到可交付。',
    flags: { migration: false, orchestrator: false }
  },
  bridge: {
    id: 'bridge',
    name: '桥接',
    title: 'Bridge',
    positioning: '版本迁移 / loader 转换，最多 4 轮修复',
    maxBuildRounds: 4,
    filesPerRound: 30,
    toolLoopRounds: 4,
    promptStyle: '先分析旧实现与目标 API 的差异，按模块迁移；保持行为等价，逐模块验证。',
    flags: { migration: true, orchestrator: false }
  },
  weaver: {
    id: 'weaver',
    name: '织星',
    title: 'Weaver',
    positioning: '整合包组装，调度子任务，最多 5 轮修复',
    maxBuildRounds: 5,
    filesPerRound: 50,
    toolLoopRounds: 5,
    promptStyle: '先拆解整合包为可独立验证的子任务，逐个实现并保持彼此兼容，最后统一组装。',
    flags: { migration: false, orchestrator: true }
  }
}

/** 渲染层档位选择器与计划卡共用的展示元数据 */
export interface TierMeta {
  id: TierId
  name: string
  title: string
  positioning: string
}

export const TIER_METAS: TierMeta[] = ALL_TIER_IDS.map((id) => ({
  id,
  name: TIER_CONFIGS[id].name,
  title: TIER_CONFIGS[id].title,
  positioning: TIER_CONFIGS[id].positioning
}))

export const ALL_STAGE_IDS: StageId[] = ['understand', 'generate', 'build', 'test', 'export']

/** 五阶段轨道展示元数据（渲染层与主进程事件流共用） */
export interface StageMeta {
  id: StageId
  name: string
  title: string
  responsibility: string
}

export const STAGE_METAS: StageMeta[] = [
  {
    id: 'understand',
    name: '理解',
    title: 'Understand',
    responsibility: '判意图、定内容类型、路由档位，产出结构化执行计划'
  },
  {
    id: 'generate',
    name: '生成',
    title: 'Generate',
    responsibility: 'Function Calling 工具循环检索/校验，产出结构化文件变更'
  },
  {
    id: 'build',
    name: '构建',
    title: 'Build',
    responsibility: '真实 Gradle 构建，失败匹配错误模式回炉；修复轮次按档位 0–5 轮（迅工直出不回炉）'
  },
  {
    id: 'test',
    name: '测试',
    title: 'Test',
    responsibility: 'kunyu-observer 游戏沙箱全自动运行测试：内省/截图/实测'
  },
  {
    id: 'export',
    name: '导出',
    title: 'Export',
    responsibility: '汇报构建产物 jar / 整合包 zip 与输出路径'
  }
]

/** 档位关键词路由结果 */
export interface TierRoute {
  tier: TierId
  /** 命中的关键词（展示给用户「为什么路由到这一档」） */
  matched: string[]
}
