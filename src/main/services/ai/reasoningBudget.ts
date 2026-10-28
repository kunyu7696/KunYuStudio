/**
 * 思考型模型的输出预算解析（M8 Agent + 普通对话共用）。
 *
 * 思考型模型（reasoner/R1/thinking/Z1/QwQ/K1.x/o 系列）的思维链计入输出 token 预算。
 * 若请求沿用提供商默认 maxTokens=4096/16384 这类常见小值，复杂任务上思考会耗尽
 * 预算、正文与工具调用零产出（真机 A/B 对照：同一复杂任务，
 * 小预算下 deepseek-reasoner 思考 50566 字/13182 tokens、51s 才行动；
 * max_tokens=65536 时仅思考 21 tokens、1s 即发起工具调用。
 * 大师档太阳能熔炉任务实测 62706 字思考顶满配置的 16384 预算，content 零产出）。
 *
 * 策略：调用方未显式指定预算且模型为思考型时，输出预算 = max(用户配置, 厂商安全下限)
 * ——DeepSeek 按官方建议 65536，其余厂商保守 16384；用户显式配更大值仍被尊重。
 */

/**
 * 思考型模型名特征：
 * - deepseek-reasoner / deepseek-r1
 * - qwen3-thinking / qwq-32b
 * - glm-z1-flash / glm-z1-plus
 * - kimi-k1.5
 * - o1 / o3-mini / o4（注意不匹配 openai、model 这类普通词）
 */
const REASONING_MODEL_RE =
  /(reasoner|reasoning|(?:^|[^a-z0-9])r1(?:[^a-z0-9]|$)|qwq|(?:^|[^a-z0-9])z1(?:[^a-z0-9]|$)|thinking|k1[.-]?\d|(?:^|[^a-z0-9])o[1-9](?:[^a-z0-9]|$))/i

export function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_RE.test(model)
}

/** DeepSeek（reasoner/R1 官方文档：最大 64K，建议显式 ≥64K） */
const DEEPSEEK_BASE_RE = /^https:\/\/api\.deepseek\.com/i

/**
 * 思考型模型的安全输出预算下限（按服务端点区分）。
 * 未列出的厂商取保守值 16384：足以覆盖万级 token 思维链 + 正文，
 * 又不超过主流兼容端点（Qwen/GLM/Kimi/OpenAI o 系列）的常见输出上限。
 */
function reasoningFloor(baseUrl: string | undefined): number {
  if (baseUrl && DEEPSEEK_BASE_RE.test(baseUrl)) return 65536
  return 16384
}

/**
 * 解析随请求发送的 max_tokens：
 * 思考型模型取「用户配置」与「厂商安全下限」的较大值，确保思维链不会挤占正文；
 * 用户显式传 req.maxTokens 时最高优先。
 */
export function resolveMaxTokens(
  explicit: number | undefined,
  configured: number,
  model: string,
  baseUrl?: string
): number {
  if (explicit !== undefined) return explicit
  if (isReasoningModel(model)) return Math.max(configured, reasoningFloor(baseUrl))
  return configured
}
