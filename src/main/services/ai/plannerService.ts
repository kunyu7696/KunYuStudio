/**
 * 灵感台 · AI 创意生成服务（原 AiView 向导 Step2「AI 极速规划」）。
 *
 * 与编排器 understand 阶段不同：这里不进流水线、不落盘，只做一次性
 * 需求拆解——把一句话创意拆成「规划概要 + AI 创意库」，交给用户在
 * 向导中挑选/修改，确认后才进入真正的五档 Agent 制作流水线。
 *
 * 模型解析复用档位体系（固定走匠造档解析默认提供商），保证「没配
 * 提供商」时报错文案与 Agent 运行一致。
 */
import { chat } from '../aiService'
import { getSection } from '../settingsService'
import { resolveTierModel } from '../../../shared/services/tierModelResolver'
import type { ModPlanDraft, ModPlanIdea, PlanProjectType } from '../../../shared/types/planner'

const MAX_IDEAS = 8

const MOD_SYSTEM_PROMPT =
  '你是KunYu Studio的 Minecraft 模组规划师。用户会给你一句话模组创意，你要一次性拆解完整需求，' +
  '生成玩法、数值、美术和资源方案。\n' +
  '只输出一个 JSON 对象，不要输出任何解释或代码块围栏：\n' +
  '{"suggestedName":"模组中文名（简短响亮）","summary":"一段规划概要：这个模组是什么、核心玩法循环、' +
  '主要内容模块，80-160 字","ideas":[{"title":"创意标题（≤12 字）","description":"1-3 句：玩法与实现要点",' +
  '"recommended":true}]}\n' +
  'ideas 要求：4-6 条，覆盖玩法机制/内容（方块物品实体）/数值进度/美术风格等不同侧面；' +
  '把最值得做的 1-2 条标 recommended:true；每条都要具体可落地，不要空话。'

const MODPACK_SYSTEM_PROMPT =
  '你是KunYu Studio的 Minecraft 整合包配包师。用户会给你一句话整合包创意（主题/玩法方向），' +
  '你要一次性拆解出完整配包方案：核心模组选型方向、玩法模组组合、优化与性能模组、' +
  '配置/任务/自定义内容、整合体验设计。\n' +
  '只输出一个 JSON 对象，不要输出任何解释或代码块围栏：\n' +
  '{"suggestedName":"整合包中文名（简短响亮）","summary":"一段规划概要：这个整合包的主题定位、' +
  '核心玩法循环、模组组合思路，80-160 字","ideas":[{"title":"创意标题（≤12 字）",' +
  '"description":"1-3 句：要装哪类模组或做什么定制，给出具体模组方向（如科技自动化、暮色森林冒险、' +
 ' 优化性能 Sodium/铟、任务线 FTB Quests 等）","recommended":true}]}\n' +
  'ideas 要求：4-6 条，覆盖核心玩法模组/辅助与优化模组/配置定制（config/overrides）/' +
  '任务与引导/视觉氛围等不同侧面；把最值得做的 1-2 条标 recommended:true；' +
  '每条都要具体可落地，优先给出知名、可在 CurseForge/Modrinth 获取的模组方向，不要空话。'

function buildMessages(
  userIdea: string,
  projectType: PlanProjectType
): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content: projectType === 'modpack' ? MODPACK_SYSTEM_PROMPT : MOD_SYSTEM_PROMPT
    },
    { role: 'user', content: userIdea }
  ]
}

/**
 * 解析模型输出为 ModPlanDraft；无法解析时返回 null（调用方走报错）。
 * 容忍代码围栏与首尾杂质；逐字段消毒，坏 idea 丢弃而不是整体失败。
 */
export function parsePlanDraft(raw: string): ModPlanDraft | null {
  let text = raw.trim()
  // 去掉 ```json ... ``` 围栏
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  // 截取首个 { 到末个 }，容忍模型在 JSON 前后啰嗦
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  let obj: unknown
  try {
    obj = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>

  const summary = typeof rec['summary'] === 'string' ? rec['summary'].trim() : ''
  const suggestedName =
    typeof rec['suggestedName'] === 'string' ? rec['suggestedName'].trim() : ''
  if (!summary) return null

  const ideasRaw = Array.isArray(rec['ideas']) ? rec['ideas'] : []
  const ideas: ModPlanIdea[] = []
  for (const item of ideasRaw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const title = typeof r['title'] === 'string' ? r['title'].trim() : ''
    const description = typeof r['description'] === 'string' ? r['description'].trim() : ''
    if (!title || !description) continue
    ideas.push({
      id: `idea-${ideas.length + 1}`,
      title,
      description,
      recommended: r['recommended'] === true
    })
    if (ideas.length >= MAX_IDEAS) break
  }
  if (ideas.length === 0) return null
  return { suggestedName, summary, ideas }
}

/**
 * 一次性拆解用户需求 → 规划概要 + AI 创意库。
 * projectType 决定规划师人设与提示词（模组 / 整合包）。
 * 失败抛出带中文文案的 Error（IPC 层包成 { ok:false }）。
 */
export async function planModIdeas(
  userIdea: string,
  projectType: PlanProjectType = 'mod'
): Promise<ModPlanDraft> {
  const idea = userIdea.trim()
  if (!idea) {
    throw new Error(projectType === 'modpack' ? '请先描述你的整合包创意' : '请先描述你的模组创意')
  }

  const resolved = resolveTierModel('artisan', getSection('ai'))
  const response = await chat({
    providerId: resolved.providerId,
    model: resolved.model ?? undefined,
    messages: buildMessages(idea, projectType),
    temperature: 0.7
  })

  const draft = parsePlanDraft(response.content ?? '')
  if (!draft) {
    throw new Error('AI 没有返回有效的规划结果，请换个说法重试，或检查模型是否支持结构化输出')
  }
  return draft
}
