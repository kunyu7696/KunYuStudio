// ---------------------------------------------------------------------------
// generate 阶段：FC 工具循环（含 bridge 模块迁移 / weaver 子任务调度）
// ---------------------------------------------------------------------------
import type { AcceptanceContract, AgentFileChange, AgentPlan, AgentToolActivity, AssertionStatus } from '../../../../shared/types/agent'
import type { GeneratedFile } from '../../../../shared/types/content'
import {
  TIER_CONFIGS,
  WEAVER_MAX_SUBTASKS,
  type TierId
} from '../../../../shared/types/tiers'
import type { AiChatResponse, ChatMessage } from '../../../../shared/types/ai'
import {
  AGENT_CONTEXT_FALLBACK_CAP,
  AGENT_CONTEXT_TOKEN_CAP,
  resolveContextBudget
} from '../../../../shared/types/ai'
import type { ContentType } from '../../../../shared/types/aiReference'
import {
  buildDispatchJobs,
  dispatchSubtasks,
  type SharedContext
} from '../tierDispatcher'
import { parseContract } from '../contractEvaluator'
import { resolveTierModel } from '../../../../shared/services/tierModelResolver'
import { getSection } from '../../settingsService'
import type { TemplateContent } from '../contextBuilder'
import { dataPath, type DataRegistryKind } from '../../../../shared/dataPath'
import { gatePaused, BudgetExceededError, type GenerateOutcome, type GeneratePipelineInput } from './types'
import { mergeFileChanges, parseCoderJson, validateFileChanges } from './planParse'
import { generateSystemPrompt, mcpCapabilitySection } from './prompts'
import { renderPlaybookSection, selectPlaybooks } from '../playbooks/index'
import { clip } from './reply'
import { ToolLoopGuard, WRITE_TOOL_NAMES, clipToolResult } from './toolGuards'
import {
  composeCompacted,
  HISTORY_SUMMARY_PROMPT,
  planHistoryCompaction
} from './historyBudget'
import { findExtraMissingContentTypes, findMissingContentTypes } from '../../contentService'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, lintTextureContent } from '../pixelize'
import { factsToPromptLine, readFacts } from '../fcTools/projectFacts'

const TOOL_RESULT_CLIP = 8_000

/** 代码型内容类型：这些意图必须有 Java 落盘或语义资产，仅资源 JSON 视为假绿灯 */
const CODE_CONTENT_TYPES = new Set(['block', 'item', 'entity', 'code'])

/**
 * 调用 AI 图像生成的 FC 工具名集合。
 *
 * texture_repaint 调 repaintTexture → imageGenService（真实 AI 出图），
 * 不走 budgetedChat，需在 applyToolCalls 里手动计一次预算。
 * texture_paint（程序化光栅化）和 texture_pixelize（本地像素化）不调 AI，不计。
 */
export const IMAGE_GEN_TOOLS = new Set<string>(['texture_repaint'])

/** 判断某工具是否调用 AI 图像生成（需计入预算） */
export function isImageGenTool(toolName: string): boolean {
  return IMAGE_GEN_TOOLS.has(toolName)
}

/**
 * 按阶段门控：build/test 治愈轮（mode='fix'）剔除的工具。
 * 这些工具与「定向改错」无关：AI 出图烧独立图像模型预算、市场检索/安装会把
 * 治愈轮带偏成选型任务、子代理委派会复制整条流水线。读/写/检索/mc_* 全部保留。
 */
export const FIX_MODE_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  'texture_repaint',
  'market_search_mods',
  'market_mod_detail',
  'market_install_mod',
  'market_list_installed',
  'agent_delegate',
  'agent_delegate_batch'
])

/** 按调用模式过滤 FC 工具定义；'generate' 或缺省返回原列表 */
export function filterToolDefsByMode<T extends { function: { name: string } }>(
  defs: T[],
  mode: 'generate' | 'fix' | undefined
): T[] {
  if (mode !== 'fix') return defs
  return defs.filter((d) => !FIX_MODE_EXCLUDED_TOOLS.has(d.function.name))
}

/**
 * 工具调用 → 渲染层活动卡片类别（读取了 X / 检索了 Y / 写入了 Z / 执行了构建）。
 * 按内置工具名前缀归类；未知/自定义 MCP 工具回退 other。
 */
export function toolActivityKind(name: string): AgentToolActivity['kind'] {
  if (/search|grep/.test(name)) return 'search'
  if (
    /^(write_project_file|content_upsert|texture_(paint|pixelize|repaint)|recipe_(create|generate)|fabric_(content_register|template_generate|data_assets_generate)|mixin_(scaffold|register)|market_install_mod)$/.test(
      name
    )
  ) {
    return 'write'
  }
  if (
    /^(gradle_build|run_game_test|mc_(launch|command|input|chat|screenshot|ensure_test_world|cleanup_test_world)|mc_test_scenario)$/.test(
      name
    )
  ) {
    return 'build'
  }
  if (
    /^(read_project_file|content_(read|list)|mc_data_lookup|.*_validate$|.*_version_check$|error_analyze|api_validate|fabric_javadoc_lookup|fabric_log_debugger|mixin_target_lookup|market_(mod_detail|list_installed)|mc_(state|world|inventory|observe_entity))$/.test(
      name
    )
  ) {
    return 'read'
  }
  return 'other'
}

/**
 * 把一次工具调用归纳为渲染层活动卡片（tool-activity 事件负载）。
 * 文件类工具带 relPath（渲染层可点击定位）；摘要取结果首行截断。
 */
export function buildToolActivity(
  callId: string,
  name: string,
  args: Record<string, unknown>,
  ok: boolean,
  resultText: string
): AgentToolActivity {
  const relPath = typeof args['relPath'] === 'string' ? args['relPath'] : undefined
  const firstLine = resultText.split('\n').find((l) => l.trim().length > 0) ?? ''
  return {
    callId,
    tool: name,
    kind: toolActivityKind(name),
    path: relPath,
    summary: clip(firstLine, 120),
    ok
  }
}

/**
 * 单条 tool 结果字符预算。
 * 一轮并行读多文件时（prompts 鼓励"一轮并行读完所有相关文件"），单条工具结果
 * 若不裁剪会把下一轮请求体顶到 40 万字符。8000 字符 ≈ 2K tokens，保留足够上下文
 * 同时避免爆炸；超出部分截断并提示原始长度。
 */
const MAX_TOOL_RESULT_CHARS = 8000

/** 微压缩后仍超 token 预算时，摘要旧轮次后保留的最近轮次数 */
const HISTORY_KEEP_ROUNDS = 3
/** 单条历史消息进摘要提示词前的字符上限 */
const HISTORY_SUMMARY_MSG_CHARS = 2000
/** 摘要输入总量字符上限 */
const HISTORY_SUMMARY_INPUT_CHARS = 24_000

/** 原地替换消息数组内容（保持引用不变，循环内多处按引用复用 messages）。 */
function replaceMessages(target: ChatMessage[], next: ChatMessage[]): void {
  target.length = 0
  target.push(...next)
}

/**
 * 判断 chat 异常是否真的是「厂商不支持工具调用」：
 * 只有报文明确指向 tools/function 能力缺失（多为 400/404/422）才允许降级为提示词模式；
 * 401/403（认证）、429（限流）、5xx、超时、上下文超限等一律原样上抛，保留真实归因。
 */
export function isFcUnsupportedError(err: unknown): boolean {
  // AiServiceError 已归类的错误（auth/model/config/timeout/network）均非工具能力问题
  const kind = (err as { kind?: unknown }).kind
  if (typeof kind === 'string' && kind !== 'server') return false
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /tool|function/i.test(msg) && /400|404|422|not support|unsupported|invalid|unknown/i.test(msg)
  )
}

/**
 * 按 filesPerRound 上限截断 files 数组。
 *
 * 修复前：完整性硬门基于完整 files 数组判 hasAnyOutput/hasCodeOutput，
 * 截断后才丢掉超额文件，可能丢掉核心 Java 仍判「完整」。
 *
 * 修复后：硬门之前先调用本函数截断，硬门基于截断后的 capped 判完整性；
 * 被丢弃的文件如实回报给 emit。
 *
 * @returns capped 保留的前 cap 个文件；dropped 被截断丢弃的文件
 */
export function applyFilesCap(
  files: AgentFileChange[],
  cap: number
): { capped: AgentFileChange[]; dropped: AgentFileChange[] } {
  const safeCap = Math.max(0, Math.floor(cap))
  if (files.length <= safeCap) return { capped: [...files], dropped: [] }
  return {
    capped: files.slice(0, safeCap),
    dropped: files.slice(safeCap)
  }
}

/**
 * 把 generateProjectContent 生成的代码/资源文件合并进 files 数组。
 *
 * 修复前：orchestrator 把 gen.files 路径只存到局部 assetFiles，
 * composeReply 收到的 files 为空 → 文件变更卡片恒 files:[]，
 * 实际 17-18 个文件已落盘却显示"无产出"。
 *
 * 合并规则：
 * - write 项 → action:'modify'（已落盘、content 留空）、accepted:true
 * - delete 项 → 跳过（删除项不进变更列表展示）
 * - FC 已写入的同路径文件保留原值（去重）
 */
export function mergeGeneratedIntoFiles(
  files: AgentFileChange[],
  generated: GeneratedFile[]
): AgentFileChange[] {
  const merged = [...files]
  for (const gf of generated) {
    if (gf.action === 'delete') continue
    if (merged.some((f) => f.path === gf.path)) continue
    merged.push({
      path: gf.path,
      action: 'modify',
      content: '',
      accepted: true
    })
  }
  return merged
}

/**
 * 合并织星档多个子任务的验收契约。
 *
 * 修复前：dispatchSubtasks 的 JobOutcome 只有 { files, notes }，
 * runToolLoop 返回的 contract 被丢弃；织星档 return 时硬编码 contract: null，
 * 导致最贵的一档反而是唯一没有任何断言/证据链的一档。
 *
 * 合并规则：
 * - 过滤 null/undefined，全空 → 返回 null
 * - 单个非空 → 原样返回（不加前缀，保留原 id）
 * - 多个非空 → assertions 拼接，id 加 `sub{i}-` 前缀防冲突；
 *   overall 按优先级归一：任一 failed→failed；任一 pending/awaiting→pending；
 *   全 verified→verified；其余→unverified（旧值 pass=verified / fail=failed / skipped=unverified 归一）
 * - summary 重写为「合并 N 个子任务契约，共 M 项断言」
 *
 * @param contracts 各子任务返回的契约（可能含 null/undefined）
 */
export function mergeSubtaskContracts(
  contracts: Array<AcceptanceContract | null | undefined>
): AcceptanceContract | null {
  const valid = contracts.filter(
    (c): c is AcceptanceContract => c != null
  )
  if (valid.length === 0) return null
  if (valid.length === 1) return valid[0]

  const merged = valid.flatMap((c, i) =>
    c.assertions.map((a) => ({
      ...a,
      id: `sub${i}-${a.id}`
    }))
  )

  const norm = (s: AssertionStatus): 'failed' | 'pending' | 'verified' | 'unverified' => {
    if (s === 'failed' || s === 'fail') return 'failed'
    if (s === 'pending' || s === 'awaiting-user') return 'pending'
    if (s === 'verified' || s === 'pass') return 'verified'
    return 'unverified'
  }
  const levels = valid.map((c) => norm(c.overall))
  let overall: AssertionStatus = 'unverified'
  if (levels.some((l) => l === 'failed')) overall = 'failed'
  else if (levels.some((l) => l === 'pending')) overall = 'pending'
  else if (levels.every((l) => l === 'verified')) overall = 'verified'

  const summary = `合并 ${valid.length} 个子任务契约，共 ${merged.length} 项断言`
  return { overall, assertions: merged, summary }
}

/**
 * 产出缺口检测（静态、零模型成本，run#7 增量假完成回归）：
 * - contentTypes 含 gui：变更中必须出现 *ScreenHandler.java 与 *Screen.java
 *   （右键容器没有这两类 = GUI 根本不存在，编译照样能过）；
 * - 本次变更的模型/blockstate JSON 引用非 minecraft 贴图时，对应 PNG 必须已在磁盘
 *   （贴图只能经 texture_paint 落盘；引用了却没生成 = 游戏内紫黑块）。
 * @returns 人类可读的缺口原因列表；空数组 = 完整
 */
export function detectGapReasons(
  acceptedFiles: AgentFileChange[],
  contentTypes: string[],
  projectPath: string | null,
  mcVersion = '1.20.1'
): string[] {
  const reasons: string[] = []
  const types = new Set(contentTypes.map((t) => t.toLowerCase()))

  if (types.has('gui')) {
    const javaBases = acceptedFiles
      .filter((f) => f.path.endsWith('.java'))
      .map((f) => f.path.split('/').pop() ?? '')
    if (!javaBases.some((b) => /ScreenHandler\.java$/.test(b))) {
      reasons.push('GUI 需求但变更中缺少 ScreenHandler 类文件（*ScreenHandler.java）')
    }
    if (!javaBases.some((b) => /Screen\.java$/.test(b))) {
      reasons.push('GUI 需求但变更中缺少 Screen 界面类文件（*Screen.java）')
    }
  }

  if (projectPath) {
    // 待扫描的模型/blockstate JSON：本次变更的 + 与本次变更同内容 id 的磁盘遗留文件
    // （上一轮已落盘的模型可能引用着本轮仍未生成的贴图，run#8 实测漏拦）。
    const scanJsons: Array<{ path: string; content: string }> = []
    const relatedIds = extractRelatedIds(acceptedFiles)
    const assetsRoot = join(projectPath, 'src/main/resources/assets')
    for (const f of acceptedFiles) {
      if (/assets\/[^/]+\/(models|blockstates)\/.*\.json$/.test(f.path)) {
        scanJsons.push({ path: f.path, content: f.content })
      }
    }
    if (existsSync(assetsRoot) && relatedIds.size > 0) {
      const namespaces = readdirSync(assetsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
      for (const ns of namespaces) {
        for (const id of relatedIds) {
          for (const cand of [
            join(assetsRoot, ns, 'blockstates', `${id}.json`),
            join(assetsRoot, ns, 'models', 'block', `${id}.json`),
            join(assetsRoot, ns, 'models', 'block', `${id}_on.json`)
          ]) {
            const rel = cand.slice(projectPath.length + 1).replace(/\\/g, '/')
            if (existsSync(cand) && !scanJsons.some((s) => s.path === rel)) {
              try {
                scanJsons.push({ path: rel, content: readFileSync(cand, 'utf8') })
              } catch {
                // 读失败忽略
              }
            }
          }
        }
      }
    }

    const missing = new Set<string>()
    for (const f of scanJsons) {
      let obj: unknown
      try {
        obj = JSON.parse(f.content)
      } catch {
        continue
      }
      for (const tex of collectTextureRefs(obj)) {
        const m = /^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.exec(tex)
        if (!m || m[1] === 'minecraft') continue
        const pngAbs = join(projectPath, 'src/main/resources/assets', m[1], 'textures', `${m[2]}.png`)
        if (!existsSync(pngAbs)) missing.add(tex)
      }
    }
    if (missing.size > 0) {
      reasons.push(
        `模型/方块状态引用的自定义贴图未生成（磁盘缺失）：${[...missing].slice(0, 8).join('、')}` +
          (missing.size > 8 ? ` 等 ${missing.size} 个` : '') +
          '。对形如 <modid>:model/<id> 的引用，调用 texture_paint（kind:"model"，id 取引用末段）即可生成对应 PNG' +
          '（textures/model/<id>.png，无需先 content_upsert）；或把引用改为已存在的贴图。' +
          'GUI 界面背景等大贴图不要用 texture_paint，改为引用原版 GUI 贴图（如 minecraft:textures/gui/container/furnace.png）。'
      )
    }

    // === blockstate 引用的模型 JSON 存在性检查（run#10 实测：模型写 blockstate 但没写 _on.json）===
    const missingModels = new Set<string>()
    const writtenPaths = new Set(acceptedFiles.map((f) => f.path))
    for (const f of scanJsons) {
      if (!f.path.includes('/blockstates/')) continue
      let obj: unknown
      try {
        obj = JSON.parse(f.content)
      } catch {
        continue
      }
      if (!obj || typeof obj !== 'object') continue
      const variants = (obj as Record<string, unknown>).variants
      if (!variants || typeof variants !== 'object') continue
      for (const entry of Object.values(variants as Record<string, unknown>)) {
        const model =
          typeof entry === 'object' && entry !== null
            ? (entry as Record<string, unknown>).model
            : null
        if (!model || typeof model !== 'string') continue
        const m = /^([a-z0-9_.-]+):([a-z0-9_./-]+)$/.exec(model)
        if (!m || m[1] === 'minecraft') continue
        const relModel = `src/main/resources/assets/${m[1]}/models/${m[2]}.json`
        if (writtenPaths.has(relModel)) continue
        const modelAbs = join(projectPath, relModel)
        if (!existsSync(modelAbs)) missingModels.add(model)
      }
    }
    if (missingModels.size > 0) {
      reasons.push(
        `blockstate 引用的模型 JSON 未生成（磁盘缺失）：${[...missingModels].slice(0, 6).join('、')}` +
          (missingModels.size > 6 ? ` 等 ${missingModels.size} 个` : '') +
          '。请用 write_project_file 落盘对应模型 JSON，或把引用改为已存在的模型。'
      )
    }

    // === 空白/纯色贴图质量闸门（实测：实体贴图 100% 透明落盘，
    // 构建照过、游戏内隐身）——「文件存在」不等于「内容可用」。
    // 只扫本轮变更相关 id（relatedIds），不碰用户既有贴图，避免误伤。 ===
    if (existsSync(assetsRoot) && relatedIds.size > 0) {
      const badTextures: string[] = []
      const nsDirs = readdirSync(assetsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
      for (const ns of nsDirs) {
        for (const id of relatedIds) {
          for (const dir of ['entity', 'model', 'item', 'block'] as const) {
            const abs = join(assetsRoot, ns, 'textures', dir, `${id}.png`)
            if (!existsSync(abs)) continue
            try {
              const err = lintTextureContent(decodePng(readFileSync(abs)))
              if (err) badTextures.push(`${ns}:${dir}/${id}（${err}）`)
            } catch {
              badTextures.push(`${ns}:${dir}/${id}（PNG 解析失败，文件损坏）`)
            }
          }
        }
      }
      if (badTextures.length > 0) {
        reasons.push(
          `贴图内容无效（空白/纯色/损坏，构建能过但游戏内隐身或紫黑块）：${badTextures.slice(0, 6).join('、')}` +
            (badTextures.length > 6 ? ` 等 ${badTextures.length} 个` : '') +
            '。item/model 贴图用 texture_paint 或 texture_pixelize 重画；' +
            'entity 贴图检查 content_upsert 的实体主色/贴图配置后重新生成。'
        )
      }
    }

    // F4-02：内容类型完整性检查——把 findMissingContentTypes 的缺口接入补救循环。
    // 此前该检查只在 generate 之后算（index.ts:1771），不回灌模型；
    // advancement 等数据驱动类型 needsCode=false + hasAnyOutput=true → 补救轮不启动。
    // 现在在补救循环内检测，缺口会随 gapReasons 回灌给模型催补。
    // 注意：block/item/entity 等代码型已由 needsCode && !hasCodeOutput() 兜底，
    // 这里只查数据驱动类型（advancement/recipe/biome/enchantment），避免与代码型门重复且破坏既有测试。
    const DATA_DRIVEN_KINDS = new Set(['advancement', 'recipe', 'biome', 'enchantment'])
    const dataDrivenTypes = contentTypes.filter((t) =>
      DATA_DRIVEN_KINDS.has(String(t).toLowerCase().trim())
    )
    if (dataDrivenTypes.length > 0) {
      const missingTypes = findMissingContentTypes(projectPath, dataDrivenTypes)
      for (const kind of missingTypes) {
        // A-01：目录名必须按版本渲染——1.20.x 复数 / 1.21+ 单数，
        // 走 dataPath 单点映射，不再硬编码 ${kind}s（biome 特判 worldgen/biome）。
        const dir =
          kind === 'biome'
            ? 'worldgen/biome'
            : dataPath(kind as DataRegistryKind, mcVersion)
        reasons.push(
          `承诺的内容类型「${kind}」未检测到产物文件。` +
            `请用 write_project_file 写入 src/main/resources/data/<命名空间>/${dir}/<id>.json，` +
            `或用 content_upsert 保存语义资产。`
        )
      }
    }

    // A-04：tag/worldgen/mixin/command 此前在 understand 可承诺但无门可检，
    // "承诺 GUI+物品只交付物品"式的部分交付会漏过。现按约定标记检测缺口。
    const EXTRA_KINDS = new Set(['tag', 'worldgen', 'mixin', 'command'])
    const extraTypes = contentTypes.filter((t) => EXTRA_KINDS.has(String(t).toLowerCase().trim()))
    if (extraTypes.length > 0) {
      for (const kind of findExtraMissingContentTypes(projectPath, extraTypes)) {
        const hint =
          kind === 'tag'
            ? '请写入 src/main/resources/data/<命名空间>/tags/<registry>/<id>.json'
            : kind === 'worldgen'
              ? '请在 src/main/resources/data/<命名空间>/worldgen/ 下写入对应 JSON（如 biome/<id>.json）'
              : kind === 'mixin'
                ? '请编写 @Mixin 类（src/main/java/...）并提供 *.mixins.json 配置'
                : '请编写命令注册类（Fabric 用 CommandRegistrationCallback，Forge/NeoForge 用 RegisterCommandsEvent）'
        reasons.push(`承诺的内容类型「${kind}」未检测到产物文件。${hint}。`)
      }
    }
  }

  return reasons
}

/** 从本次变更路径提取相关内容 id（snake_case），用于连带扫描磁盘上的同 id 资源 */
function extractRelatedIds(files: AgentFileChange[]): Set<string> {
  const ids = new Set<string>()
  const strip = (s: string): string =>
    s
      .replace(/_(screen_handler|screenhandler|screen|block_entity|blockentity|block|entity|item)$/, '')
      .trim()
  for (const f of files) {
    // recipes?/loot_tables? 同时兼容 1.20.x（复数）与 1.21+（单数）目录
    const resourceId = /(?:blockstates|models\/block|recipes?|loot_tables?\/blocks)\/([a-z0-9_]+)\.json$/.exec(
      f.path
    )
    if (resourceId) ids.add(resourceId[1])
    if (f.path.endsWith('.java')) {
      const base = (f.path.split('/').pop() ?? '').replace(/\.java$/, '')
      const snake = base.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
      const stripped = strip(snake)
      if (stripped) ids.add(stripped)
    }
  }
  return ids
}

/** 递归收集模型 JSON 中 textures 对象内的全部贴图引用字符串 */
function collectTextureRefs(node: unknown, acc: string[] = []): string[] {
  if (node && typeof node === 'object') {
    const rec = node as Record<string, unknown>
    if (rec.textures && typeof rec.textures === 'object' && !Array.isArray(rec.textures)) {
      for (const v of Object.values(rec.textures as Record<string, unknown>)) {
        if (typeof v === 'string') acc.push(v)
      }
    }
    for (const v of Object.values(rec)) collectTextureRefs(v, acc)
  }
  return acc
}

export async function runGeneratePipeline(input: GeneratePipelineInput): Promise<GenerateOutcome> {
  const { plan, tier } = input
  const tierCfg = TIER_CONFIGS[tier]

  // 1. 初始检索（确定性保底；后续模型可用工具继续检索）
  let templates = input.templates
  const references: string[] = []
  if (templates.length === 0) {
    templates = await retrieveTemplates(input, plan, references)
    input.setTemplates(templates)
  }
  input.emit('generate', {
    type: 'log',
    detail: `参考包命中 ${templates.length} 个相关模板`,
    artifact: {
      id: `${input.runId}-retrieval`,
      kind: 'retrieval',
      title: '检索产物',
      references: references.length > 0 ? references : undefined
    }
  })

  // 2a. 织星：跨档 TierDispatcher（TR-11.1，子任务可落到不同档位）
  if (tierCfg.flags.orchestrator) {
    const lockedTier = getSection('ai').manualLock.tier
    const dispatchJobs =
      lockedTier !== null
        ? buildDispatchJobs(plan).map((j) => ({ ...j, tier: lockedTier }))
        : buildDispatchJobs(plan)
    const shared: SharedContext = { goal: plan.goal }
    // 断点续跑：generate 中断（completedStage 未到 'generate'）时恢复子任务级进度
    const resumedSubtasks = input.resumeFrom?.subtaskProgress
    const resumedFiles = resumedSubtasks?.files ?? []
    let dispatchedAssetSaves = resumedSubtasks?.assetSaves ?? 0
    if (resumedSubtasks && resumedSubtasks.completed > 0) {
      input.emit('generate', {
        type: 'log',
        detail: `（续跑）恢复 Weaver 子任务进度：跳过已完成的前 ${resumedSubtasks.completed} 个子任务`
      })
    }
    const result = await dispatchSubtasks(dispatchJobs, shared, {
      skipCompleted: resumedSubtasks?.completed ?? 0,
      resumed: resumedSubtasks
        ? { files: resumedFiles, notes: resumedSubtasks.notes }
        : undefined,
      gate: async () => {
        await gatePaused(input.state)
      },
      isCanceled: () => input.state.canceled,
      resolveModel: (t) => {
        const r = resolveTierModel(t, getSection('ai'))
        return { providerId: r.providerId, model: input.request.model ?? r.model }
      },
      emit: (ev) => {
        const tname = TIER_CONFIGS[ev.job.tier].name
        const idx = `${ev.job.index + 1}/${ev.job.total}`
        if (ev.kind === 'start') {
          input.emit('generate', {
            type: 'log',
            action: ev.job.label || `子任务 ${idx}`,
            detail: `子任务 ${idx} · 档位 ${tname} · 开始`
          })
        } else if (ev.kind === 'finish') {
          input.emit('generate', {
            type: 'log',
            action: ev.job.label || `子任务 ${idx}`,
            detail: `子任务 ${idx} · 档位 ${tname} · 完成（产出 ${ev.fileCount} 个文件）`
          })
        } else if (ev.kind === 'fail') {
          input.emit('generate', {
            type: 'log',
            action: ev.job.label || `子任务 ${idx}`,
            detail: `子任务 ${idx} · 档位 ${tname} · 执行异常：${ev.error}`
          })
        } else {
          input.emit('generate', {
            type: 'log',
            detail: `子任务 ${idx} · 档位 ${tname} · 因取消未执行`
          })
        }
      },
      runJob: async (job, goal, providerId, model) => {
        const out = await runToolLoop(input, job.tier, goal, { providerId, model })
        dispatchedAssetSaves += out.assetSaves
        return out
      },
      // 子任务级断点（任务图持久化 #4）：每完成一个子任务覆盖写快照，
      // 进程崩溃/取消后续跑跳过已完成子任务
      onSubtaskProgress: (acc) => {
        input.onSubtaskCheckpoint?.({
          completed: acc.completed,
          files: acc.files,
          notes: acc.notes,
          assetSaves: dispatchedAssetSaves
        })
      }
    })
    const merged = mergeFileChanges([], result.files)
    // 织星档同样过完整性硬门：与普通档 runToolLoop 末尾同一标准——
    // 零产出 / 代码型目标缺核心 Java / 静态缺口未闭合，一律判失败不带假绿灯进入构建。
    // 最贵的一档不能反而是唯一没有验收门控的一档。
    const gateFailure = gateWeaverCompleteness(input, merged, dispatchedAssetSaves, result.notes)
    if (gateFailure) return gateFailure
    // 织星档不再硬编码 contract: null，合并各子任务契约
    const weaverContract = mergeSubtaskContracts(result.contracts ?? [])
    return {
      files: merged,
      notes: result.notes,
      assetSaves: dispatchedAssetSaves,
      contract: weaverContract
    }
  }

  // 2b. 普通档=整体一次；bridge=按迁移模块
  const jobs: Array<{ label: string; goal: string; tier: TierId }> = []
  if (tierCfg.flags.migration && plan.migrationPlan && plan.migrationPlan.modules.length > 0) {
    for (const mod of plan.migrationPlan.modules.slice(0, WEAVER_MAX_SUBTASKS)) {
      jobs.push({
        label: `迁移模块 ${mod}`,
        goal: `把「${mod}」从 ${plan.migrationPlan.sourceLoader} 迁移到 ${plan.migrationPlan.targetLoader}（目标：${plan.goal}）`,
        tier
      })
    }
  } else {
    jobs.push({ label: '', goal: plan.goal, tier })
  }

  const allFiles: AgentFileChange[] = []
  const notes: string[] = []
  let assetSaves = 0
  /** 取最后一个 job 的契约（多 job 时仅保留最后一份，避免合并复杂度爆炸） */
  let contract: AcceptanceContract | null = null
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    await gatePaused(input.state)
    if (input.state.canceled)
      return { files: allFiles, notes: notes.join('\n\n'), assetSaves, contract }
    if (jobs.length > 1) {
      input.emit('generate', {
        type: 'log',
        action: job.label,
        detail: `（${i + 1}/${jobs.length}）开始生成`
      })
    }
    const outcome = await runToolLoop(input, job.tier, job.goal)
    if (input.state.canceled)
      return { files: allFiles, notes: notes.join('\n\n'), assetSaves, contract }
    assetSaves += outcome.assetSaves
    allFiles.push(...outcome.files)
    if (outcome.notes) notes.push(jobs.length > 1 ? `【${job.label}】${outcome.notes}` : outcome.notes)
    if (outcome.contract) contract = outcome.contract
  }
  return { files: mergeFileChanges([], allFiles), notes: notes.join('\n\n'), assetSaves, contract }
}

/**
 * 织星分支完整性硬门：与 runToolLoop 末尾的三重判定同源——
 * 零产出 / 代码型目标缺核心 Java（或语义资产）/ 模型贴图等静态缺口未闭合。
 * 返回 null = 通过；否则返回判失败的 GenerateOutcome（files 清空，不带假绿灯进入构建）。
 */
function gateWeaverCompleteness(
  input: GeneratePipelineInput,
  files: AgentFileChange[],
  assetSaves: number,
  notes: string
): GenerateOutcome | null {
  const { project, plan } = input
  if (!project) return null
  const accepted = files.filter((f) => f.accepted)
  const hasOutput = accepted.length > 0 || assetSaves > 0
  if (!hasOutput) {
    input.emit('generate', {
      type: 'log',
      detail: '织星子任务全部执行完毕但仍为零产出，本次生成判定失败（不会进入构建阶段）。'
    })
    return { files: [], notes, assetSaves, contract: null }
  }
  const needsCode = plan.contentTypes.some((t) => CODE_CONTENT_TYPES.has(t.toLowerCase()))
  const hasCode = assetSaves > 0 || accepted.some((f) => f.path.endsWith('.java'))
  if (needsCode && !hasCode) {
    input.emit('generate', {
      type: 'log',
      detail:
        '织星产出不完整：仅有资源文件、缺少核心 Java 源码（或语义资产），判定失败（不会带假绿灯进入构建）。'
    })
    return { files: [], notes, assetSaves, contract: null }
  }
  const gaps = detectGapReasons(accepted, plan.contentTypes, project.path, project.mcVersion)
  if (gaps.length > 0) {
    input.emit('generate', {
      type: 'log',
      detail:
        '织星产出仍有未闭合缺口（保留已落盘文件，判定为部分完成、不带假绿灯判成功）：' +
        gaps.join('；')
    })
    // 缺口硬门退场——不再清空 files（此前会把整份已写盘成果一起作废），
    // 改为随收口结论上报缺口：verdict 封顶 partial、gaps 显式列出、runStatus 落 failed 可续跑。
    return { files, notes, assetSaves, contract: null, gaps }
  }
  return null
}

/** 参考包检索 + mcdev-mcp 机制检索（保底注入） */
async function retrieveTemplates(
  input: GeneratePipelineInput,
  plan: AgentPlan,
  references: string[]
): Promise<TemplateContent[]> {
  const { request } = input
  const templates = input.ctx
    .getTemplateContents(
      request.loader,
      request.mcVersion,
      plan.contentTypes as ContentType[],
      plan.goal
    )
    .slice(0, 5)
  for (const t of templates) {
    references.push(`${t.id}（${t.build === 'pass' ? '编译已验证' : '未验证'}）`)
  }
  // mcdev-mcp 机制类检索（失败自动回落，不阻断流水线）
  if (input.mcpReady) {
    input.emit('generate', {
      type: 'log',
      action: 'mcdev-mcp',
      detail: '调用 mc_search 检索 Minecraft 1.20.1 机制映射…'
    })
    const outcome = await input.registry.executeTool(
      'mcdev_mc_search',
      { query: plan.goal, limit: 5 },
      { loader: request.loader, mcVersion: request.mcVersion }
    )
    if (input.state.canceled) return templates
    if (outcome.ok) {
      references.push('mcdev-mcp mc_search 命中（见 generate 工具上下文）')
      input.emit('generate', { type: 'log', detail: clip(outcome.text, 600) })
    } else {
      input.emit('generate', {
        type: 'log',
        detail: `mcdev-mcp 检索失败，已回落参考包：${outcome.error ?? '未知错误'}`
      })
    }
  } else {
    input.emit('generate', {
      type: 'log',
      detail: 'mcdev-mcp 未就绪，本次仅使用本地参考包'
    })
  }
  return templates
}

// ---------------------------------------------------------------------------
// Function Calling 工具循环
// ---------------------------------------------------------------------------
/** 子任务档位对应的 provider/model 覆盖（织星跨档）；缺省用顶层 */
interface ToolLoopModelOverride {
  providerId: string
  model: string | null
}

async function runToolLoop(
  input: GeneratePipelineInput,
  tier: TierId,
  goal: string,
  modelOverride?: ToolLoopModelOverride
): Promise<GenerateOutcome> {
  const { request, project, registry, emit } = input
  const tierCfg = TIER_CONFIGS[tier]
  const effectiveProviderId = modelOverride?.providerId ?? input.providerId
  const effectiveModel = modelOverride ? modelOverride.model : input.model

  // 内置工具的 name/description/parameters 已通过 tools schema 传给模型，
  // system prompt 里再列一遍是 13K 字符的纯重复（占 system prompt 87%）。
  // 仅保留 MCP 能力简报（动态连接的第三方 server 不在 schema 里，需文字告知模型）。
  // fcUnsupported 降级（厂商不支持 FC）时不再把工具清单塞进 prompt——
  // 此时 tools=undefined 模型本就无法调用工具，详细清单无意义。
  // 修复轮按阶段门控剔除无关工具（AI 出图/市场/子代理委派）——
  // 治愈轮目标是定向改错，这些工具既无用又会诱导模型跑偏烧预算
  const chatDefs = filterToolDefsByMode(registry.getToolDefinitions(), input.mode)
  const capabilitySection = mcpCapabilitySection()
  const toolDesc = capabilitySection
  // playbook 层：按 用户原话/意图/内容类型/项目类型 选择命中规程注入（空命中不注入）
  const playbookSection = renderPlaybookSection(
    selectPlaybooks({
      message: request.message,
      intent: input.plan.intent,
      contentTypes: input.plan.contentTypes,
      projectType: project?.type ?? null
    })
  )
  let fcUnsupported = false

  // 领域事实层——项目事实槽压成一行注入头部，长任务中「加载器/版本/ID/构建状态」不衰减
  const factsLine = factsToPromptLine(readFacts(project?.path))

  // 设置关闭时硬拦截：旧持久化数据/模型误判给出的 freeform 一律降级为 schema
  const aiSettings = getSection('ai')
  const entityMode = aiSettings.entityFreeformEnabled ? input.plan.entityMode : 'schema'

  const messages: ChatMessage[] = [
    generateSystemPrompt(request, tier, input.ctx, project, toolDesc, entityMode, playbookSection, aiSettings.globalFreeformEnabled),
    ...(factsLine
      ? [{ role: 'system' as const, content: `项目事实（全轮有效，不得违背）：${factsLine}` } satisfies ChatMessage]
      : []),
    {
      role: 'user',
      content: `目标：${goal}\n内容类型：${input.plan.contentTypes.join(', ')}\n\n用户原话：${request.message}`,
      // 用户上传的参考图（如贴图样式参照）随生成首轮交给视觉模型
      images: request.images
    }
  ]

  let finalContent = ''
  let assetSaves = 0
  /**
   * 经 write_project_file 工具分片提交并通过校验的文件变更。
   * 大任务（如方块实体 + GUI 十余个文件）下，模型无法在一条回复里吐完整巨型 JSON，
   * 逐文件工具调用是主产出通道；循环结束后与最终 JSON files 合并（同路径工具版优先）。
   */
  const toolWrittenFiles: Array<{ path: string; action: 'create' | 'modify'; content: string }> = []
  // C4 护栏：重复同参调用短路 + 连续只读轮次强制收口。
  // 只读阈值 = 工具轮次 - 1（至少为 1）：高档位轮次收紧后，必须为实际写入保留至少一轮。
  const guard = new ToolLoopGuard(
    undefined,
    Math.max(1, tierCfg.toolLoopRounds - 1)
  )

  // 执行一轮 assistant 给出的工具调用并回填结果（主循环与零产出补救轮共用）
  const applyToolCalls = async (
    toolCalls: NonNullable<AiChatResponse['toolCalls']>
  ): Promise<{ names: string[]; writeSucceeded: boolean; failedCalls: number }> => {
    const roundToolNames: string[] = []
    // 按结果记账——本轮是否有写工具真正执行成功（result.ok===true）
    let writeSucceeded = false
    // 卡死检测：本轮失败的工具调用数（执行失败 + 被 repeat-guard 拦截）
    let failedCalls = 0
    for (const tc of toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        const parsed: unknown = JSON.parse(tc.function.arguments || '{}')
        if (typeof parsed === 'object' && parsed !== null) {
          args = parsed as Record<string, unknown>
        }
      } catch {
        args = { _raw: tc.function.arguments }
      }
      roundToolNames.push(tc.function.name)
      const guardCall = guard.noteCall(tc.function.name, args)
      emit('generate', {
        type: 'log',
        action: `工具 ${tc.function.name}`,
        artifact: {
          id: `tool-${tc.id}`,
          kind: 'tool-call',
          title: `工具调用 · ${tc.function.name}`,
          body: clip(tc.function.arguments, 600)
        }
      })
      let toolText: string
      let toolOk = false
      if (guardCall.blocked) {
        // repeat-guard：不再真正执行，直接把护栏提示作为该调用的结果回填
        failedCalls += 1
        emit('generate', {
          type: 'log',
          detail: `护栏拦截重复调用：${tc.function.name}（第 ${guardCall.count} 次相同参数）`
        })
        toolText = guardCall.notice ?? '重复调用已被护栏拦截'
      } else {
        // AI 出图工具（texture_repaint）不经 budgetedChat，需手动计一次预算
        if (isImageGenTool(tc.function.name)) {
          input.budget?.consumeModel()
        }
        const result = await registry.executeTool(tc.function.name, args, {
          loader: request.loader,
          mcVersion: request.mcVersion,
          // 贴图候选画廊等工具产物：实时推给渲染层（工具返回前即可见）
          toolCallId: tc.id,
          runId: input.runId,
          reportArtifact: (artifact) => emit('generate', { type: 'log', artifact }),
          // M3：agent_delegate(_batch) 子代理内部活动嵌套上报——挂到本工具卡片下
          reportToolActivity: (activity) =>
            emit('generate', { type: 'tool-activity', toolActivity: activity })
        })
        toolOk = result.ok
        if (!result.ok) failedCalls += 1
        // P1-6：仅 ok 的写入才算写入（失败/被拦截的写意图不算，护栏按结果记账）
        if (result.ok && WRITE_TOOL_NAMES.has(tc.function.name)) writeSucceeded = true
        if (result.ok && tc.function.name === 'content_upsert') assetSaves += 1
        // P2 卡死检测①：同一工具同一原因反复失败（参数不同但错因相同）→ 回填换策略提示
        const stuck = result.ok ? { stuck: false as const } : guard.noteFailure(tc.function.name, result.error)
        if (stuck.stuck && stuck.notice) {
          emit('generate', {
            type: 'log',
            detail: `卡死检测：${tc.function.name} 同类失败重复触发，已回填换策略提示`
          })
        }
        // write_project_file / edit_project_file 分片产出：工具已做路径/扩展名/占位符/括号校验；
        // T1 起已即时落盘，这里仍收集内存记账，供终点复核/合并（同路径以最后一次提交为准）。
        // edit_project_file 回传的是编辑后全文（含盘上其余部分），因此与 write 通道同权：
        // 完备性硬门（缺核心 Java）与终点 validateFileChanges 对编辑产物同样生效。
        if (
          result.ok &&
          (tc.function.name === 'write_project_file' || tc.function.name === 'edit_project_file') &&
          result.data &&
          typeof result.data === 'object' &&
          (result.data as Record<string, unknown>).__kyFileChange === true
        ) {
          const fc = result.data as { path: string; action: 'create' | 'modify'; content: string }
          const idx = toolWrittenFiles.findIndex((f) => f.path === fc.path)
          if (idx >= 0) toolWrittenFiles[idx] = fc
          else toolWrittenFiles.push(fc)
        }
        toolText = result.ok
          ? result.text
          : `工具调用失败：${result.error ?? '未知错误'}（请改用其它方式完成）`
        // P2 卡死检测①：同类失败累计到阈值时，把换策略提示并入该调用的工具结果
        if (stuck.stuck && stuck.notice) toolText = `${toolText}\n${stuck.notice}`
      }
      // T1：工具活动卡片（全工具，含被护栏拦截的调用）——运行面板实时可见「读取了 X / 写入了 Y」
      emit('generate', {
        type: 'tool-activity',
        toolActivity: buildToolActivity(tc.id, tc.function.name, args, toolOk, toolText)
      })
      messages.push({
        role: 'tool',
        toolCallId: tc.id,
        // 单文件直读放宽到 40K（工具自身已限 30K）；其他工具保持 8K 防上下文爆炸
        content: clipToolResult(
          toolText,
          tc.function.name === 'read_project_file' ? 40_000 : TOOL_RESULT_CLIP
        )
      })
    }
    return { names: roundToolNames, writeSucceeded, failedCalls }
  }

  /**
   * P2：让模型把被压缩的旧轮次摘要成一段文本（信息以摘要保留，而非直接丢弃）。
   * 走 input.chat（budgetedChat）自动计入预算；预算熔断原样上抛，其余异常由调用方回退。
   */
  const summarizeDroppedRounds = async (old: ChatMessage[]): Promise<string> => {
    const transcript = old
      .map((m) => {
        const who = m.role === 'assistant' ? '助手' : m.role === 'tool' ? '工具结果' : '用户'
        const calls = m.toolCalls?.map((tc) => tc.function.name).join('/')
        return `${who}${calls ? `（调用 ${calls}）` : ''}：${clip(m.content ?? '', HISTORY_SUMMARY_MSG_CHARS)}`
      })
      .join('\n')
    const res = await input.chat({
      providerId: effectiveProviderId,
      model: effectiveModel ?? undefined,
      messages: [
        { role: 'system', content: HISTORY_SUMMARY_PROMPT },
        { role: 'user', content: clip(transcript, HISTORY_SUMMARY_INPUT_CHARS) }
      ],
      temperature: 0.1
    })
    return (res.content ?? '').trim()
  }

  /**
   * P2 分层压缩：微压缩（截断超长 tool 结果）→ 仍超预算则摘要旧轮次。
   * 原地更新 messages。摘要失败/为空时回退为直接丢弃旧轮次（不阻断流水线）。
   */
  const compactHistoryMessages = async (): Promise<void> => {
    // 预算随模型窗口缩放——提供商标注了 contextWindow 时按 min(192k, 窗口×50%) 收缩，
    // 小窗口模型不再被固定上限打爆；未标注回退保守的 64k。
    const providerWindow = getSection('ai').providers.find((p) => p.id === effectiveProviderId)
      ?.contextWindow
    const plan = planHistoryCompaction(messages, {
      budgetTokens: resolveContextBudget(
        providerWindow,
        AGENT_CONTEXT_TOKEN_CAP,
        AGENT_CONTEXT_FALLBACK_CAP
      ),
      keepRounds: HISTORY_KEEP_ROUNDS,
      maxToolChars: MAX_TOOL_RESULT_CHARS
    })
    if (!plan.changed && !plan.needsSummary) return

    if (!plan.needsSummary) {
      replaceMessages(messages, plan.messages)
      return
    }

    let summary = ''
    try {
      summary = await summarizeDroppedRounds(plan.oldRounds)
    } catch (err) {
      // 预算熔断必须上抛（绝不能吞掉后继续烧额度）；其余异常回退为直接裁剪
      if (err instanceof BudgetExceededError) throw err
      emit('generate', {
        type: 'log',
        detail: `历史摘要失败，回退为直接裁剪旧轮次：${(err as Error).message}`
      })
    }
    replaceMessages(messages, summary ? composeCompacted(plan.head, summary, plan.recent) : plan.messages)
    emit('generate', {
      type: 'log',
      detail: summary
        ? `FC 历史超 token 预算（微压缩后约 ${plan.tokensAfterMicro} tokens，压缩前约 ${plan.tokensBefore}），已将 ${plan.oldRounds.length} 条旧消息压缩为摘要`
        : `FC 历史超 token 预算（微压缩后约 ${plan.tokensAfterMicro} tokens），已裁剪旧轮次`
    })
  }

  for (let round = 1; round <= tierCfg.toolLoopRounds; round++) {
    await gatePaused(input.state)
    if (input.state.canceled) return { files: [], notes: '', assetSaves, contract: null }
    const isLast = round === tierCfg.toolLoopRounds
    if (isLast) {
      // 最后一轮不禁止工具：复杂任务允许模型继续用 write_project_file 逐文件写完，
      // 避免逼它在一条回复里输出十几个文件的巨型 JSON（reasoner 会在思维链里草拟全部代码、
      // 耗尽输出预算后正文零产出）。已通过工具提交的文件无需再出现在 files JSON 中。
      messages.push({
        role: 'user',
        content:
          '这是最后一轮。若还有未提交的文件，请继续调用 write_project_file 逐文件提交完整内容（禁止占位符）；' +
          '所有文件提交完毕后，再输出最终 JSON：files 只保留尚未经 write_project_file 提交的补充文件' +
          '（已提交的不要重复），notes 简述实现要点。'
      })
    }
    let response: AiChatResponse
    try {
      response = await input.chat({
        providerId: effectiveProviderId,
        model: effectiveModel ?? undefined,
        messages,
        tools: fcUnsupported || chatDefs.length === 0 ? undefined : chatDefs,
        temperature: 0.2
        // maxTokens 不传：由 aiService 对思考型模型自动施加厂商安全下限
        // （DeepSeek 65536），避免思维链耗尽预算导致 files JSON 零产出
      })
    } catch (err) {
      // 预算熔断：原样上抛，由 orchestrator 顶层转失败回复（绝不能降级后继续烧额度）
      if (err instanceof BudgetExceededError) throw err
      // 仅当错误明确指向「厂商不支持 tools」时才降级为提示词模式重试同轮（P1-9 修复误判）；
      // 401/403 认证、429 限流、5xx、超时、上下文超限等一律上抛，保留真实归因
      if (!fcUnsupported && chatDefs.length > 0 && isFcUnsupportedError(err)) {
        fcUnsupported = true
        emit('generate', {
          type: 'log',
          detail: `当前模型不支持工具调用，已降级为提示词模式：${(err as Error).message}`
        })
        round -= 1
        continue
      }
      throw err
    }
    // pause() 后晚到的模型结果不再立即执行——先过暂停闸门，
    // 暂停期间不执行任何工具调用/落盘（AC-3），恢复后继续本轮
    await gatePaused(input.state)
    if (input.state.canceled) return { files: [], notes: '', assetSaves, contract: null }

    // 推理过程：把模型的 thinking/reasoning 透传给前端「思考」折叠块
    if (response.reasoning) {
      emit('generate', { type: 'log', thought: response.reasoning })
    }

    const toolCalls = response.toolCalls ?? []
    if (toolCalls.length === 0) {
      finalContent = response.content ?? ''
      // 思考型模型把输出预算花在思维链上、正文/工具调用双空（finish_reason=length 的可观测信号）：
      // 不直接判死，交给下方零产出补救轮，但留下可诊断日志（真机：max_tokens=4096 掐断 reasoner）
      if (!finalContent.trim() && response.reasoning) {
        emit('generate', {
          type: 'log',
          detail:
            `模型本轮只返回了思考过程（${response.reasoning.length} 字）而无正文或工具调用，` +
            '疑似输出预算被思维链耗尽；将进入强制补救轮。'
        })
      }
      break
    }
    // 记录 assistant 工具调用并回填结果
    messages.push({ role: 'assistant', content: response.content ?? '', toolCalls })
    const { names: roundToolNames, writeSucceeded, failedCalls } = await applyToolCalls(toolCalls)

    // P2：token 感知的分层压缩——先微压缩超长 tool 结果，仍超预算再把旧轮次摘要成文本
    await compactHistoryMessages()

    // 只读轮次上限：连续无成功写入 → 强制模型立刻收口（允许直接用 write_project_file 落盘）。
    // P1-6：按结果记账——写工具 ok:false 的轮次同样累计，不再被写意图清零
    // P2：同时统计「全失败工具轮」，连续多轮全部失败说明模型在反复试错
    const roundGuard = guard.noteRound(roundToolNames, writeSucceeded, failedCalls)
    // P2 卡死检测②：连续全失败工具轮 → 回填一次「停止试探、如实说明卡点」的提示
    const failedRoundsGuard = roundGuard.forceSynthesize
      ? { stuck: false as const }
      : guard.noteFailedRounds()
    if (failedRoundsGuard.stuck && failedRoundsGuard.notice) {
      emit('generate', {
        type: 'log',
        detail: '卡死检测：已连续多轮工具调用全部失败，已提示模型停止试探并如实说明卡点'
      })
      messages.push({ role: 'user', content: failedRoundsGuard.notice })
    }
    if (roundGuard.forceSynthesize) {
      emit('generate', {
        type: 'log',
        detail: `只读检索护栏触发（连续 ${roundGuard.readonlyStreak} 轮无写入），要求模型立即落盘收口`
      })
      messages.push({ role: 'user', content: roundGuard.notice! })
      const closing = await input.chat({
        providerId: effectiveProviderId,
        model: effectiveModel ?? undefined,
        messages,
        tools: fcUnsupported || chatDefs.length === 0 ? undefined : chatDefs,
        temperature: 0.2
      })
      // 收口轮同样先过暂停闸门，暂停期间不执行工具
      await gatePaused(input.state)
      if (input.state.canceled) return { files: [], notes: '', assetSaves, contract: null }
      if (closing.reasoning) emit('generate', { type: 'log', thought: closing.reasoning })
      // 收口轮允许直接调写工具分片落盘，有工具调用则执行；正文作为最终 JSON 解析
      if (closing.toolCalls && closing.toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: closing.content ?? '', toolCalls: closing.toolCalls })
        await applyToolCalls(closing.toolCalls)
      }
      finalContent = closing.content ?? ''
      break
    }
  }

  let parsed = parseCoderJson(finalContent)
  let files = validateFileChanges(parsed.files, project)

  // 合并分片工具产出：同路径以工具版为准（逐文件提交是模型逐字校验过的最终意图）。
  // 合并在补救循环之前也要做一次，以便正确判定「只有资源、缺核心代码」的假绿灯。
  const recomputeFiles = (): void => {
    parsed = parseCoderJson(finalContent)
    files = validateFileChanges(parsed.files, project)
    if (project && toolWrittenFiles.length > 0) {
      const validatedToolFiles = validateFileChanges(toolWrittenFiles, project)
      const acceptedToolFiles = validatedToolFiles.filter((f) => f.accepted)
      if (validatedToolFiles.some((f) => !f.accepted)) {
        const rejected = validatedToolFiles.filter((f) => !f.accepted)
        // T1：write-through 已即时落盘的文件若被终点复核拒绝（工具闸门是复核超集，
        // 此为概率趋零的兜底）→ 回滚原状：create 删文件，modify 恢复首次写入前快照
        input.writeThrough?.rollback(rejected.map((f) => f.path))
        emit('generate', {
          type: 'log',
          detail: rejected
            .map((f) => `工具文件被安全闸门拒绝：${f.path}（${f.reason ?? '未知原因'}）`)
            .join('；')
        })
      }
      files = mergeFileChanges(files, acceptedToolFiles)
    }
  }
  recomputeFiles()
  if (project && toolWrittenFiles.length > 0) {
    emit('generate', {
      type: 'log',
      detail: input.writeThrough
        ? `写文件工具共提交 ${toolWrittenFiles.length} 个文件变更，均已实时写入磁盘`
        : `写文件工具共提交 ${toolWrittenFiles.length} 个文件变更，将在生成结束统一写盘`
    })
  }

  // 产出完整性判定（反假绿灯）：
  // - 任何产出：files 非空或语义资产；
  // - 代码型目标（block/item/entity/code）必须有 Java 落盘或语义资产——
  //   仅提交资源 JSON 时旧代码仍能编译通过（run#5 实测：6 个 JSON 零 Java 却 build 绿）。
  const needsCode =
    !!project && input.plan.contentTypes.some((t) => CODE_CONTENT_TYPES.has(t.toLowerCase()))
  const hasAnyOutput = (): boolean =>
    files.some((f) => f.accepted) || assetSaves > 0
  const hasCodeOutput = (): boolean =>
    assetSaves > 0 || files.some((f) => f.accepted && f.path.endsWith('.java'))
  /** GUI/贴图等静态缺口（每轮随 files 重算） */
  let gapReasons: string[] = []
  const refreshGaps = (): void => {
    // 被安全闸门拒绝的文件必须进缺口清单：JSON files[] 通道不像 write_project_file
    // 工具那样有工具结果回传，若不在此回灌，模型只知道「没产出」，不知道
    // 「哪个文件、为什么被拒」，只能瞎猜 → 自定义类不落盘 → 注册链断裂（进游戏内容缺失）。
    const rejects = files
      .filter((f) => !f.accepted && f.reason)
      .map((f) => `${f.path} 未落盘：${f.reason}`)
    gapReasons = project
      ? [
          ...detectGapReasons(
            files.filter((f) => f.accepted),
            input.plan.contentTypes,
            project.path,
            project.mcVersion
          ),
          ...rejects
        ]
      : []
  }
  const isIncomplete = (): boolean => {
    refreshGaps()
    return !hasAnyOutput() || (needsCode && !hasCodeOutput()) || gapReasons.length > 0
  }

  // 补救-续写循环（全档统一最多 3 轮，属于零产出/不完整的异常补救，不计入档位 FC 轮次）：
  // reasoner 实测常在第 2 轮才发出第一批 write_project_file（第 1 轮陷入思考誊稿），3 轮给挤牙膏式产出留足闭合缺口的机会。
  const MAX_RESCUE_ROUNDS = 3
  let rescueRound = 0
  while (isIncomplete() && rescueRound < MAX_RESCUE_ROUNDS && project) {
    await gatePaused(input.state)
    if (input.state.canceled) return { files: [], notes: '', assetSaves, contract: null }
    rescueRound += 1
    const writtenPaths = toolWrittenFiles.map((f) => f.path)
    // 存在「被闸门拒收」的文件时，绝不能走「零产出」通用话术：该话术只会说"你没产出"，
    // 模型收不到「哪个文件、为什么被拒」，补救轮必然原地打转（实测 3 轮全空转）。
    // 有拒收原因时改走下方缺口定向话术，把 path + reason 原样回灌。
    const hasRejects = files.some((f) => !f.accepted && f.reason)
    const noOutput = !hasAnyOutput() && !hasRejects
    const lackCode = !hasRejects && needsCode && !hasCodeOutput()
    emit('generate', {
      type: 'log',
      detail: noOutput
        ? `模型零产出（无写入工具调用、files 为空），强制补救（第 ${rescueRound}/${MAX_RESCUE_ROUNDS} 轮）…`
        : lackCode
          ? `产出不完整：已提交 ${writtenPaths.length} 个文件但缺少核心 Java 实现，催写核心源码（第 ${rescueRound}/${MAX_RESCUE_ROUNDS} 轮）…`
          : `产出存在 ${gapReasons.length} 项缺口，定向催补（第 ${rescueRound}/${MAX_RESCUE_ROUNDS} 轮）：${gapReasons.join('；')}`
    })
    messages.push({
      role: 'user',
      content: noOutput
        ? '你上一轮没有产出任何成果：既没有调用写入工具，最终 JSON 的 files 数组也是空的。\n' +
          '现在必须立即完成，二选一：\n' +
          '1）【首选，适合多文件实现】逐个调用 write_project_file，每次提交一个完整源码/资源文件' +
          '（relPath 为项目相对路径，content 为完整内容，禁止占位符/TODO），连续调用直到文件齐全；\n' +
          '2）简单内容可调用 content_upsert 创建语义资产（物品/方块/实体等，含必填字段），需要贴图再调 texture_paint。\n' +
          '不要在一条回复里塞入所有文件，也不要只复述目标——逐文件提交，空回复视为失败。'
        : lackCode
          ? '你的产出不完整：已通过 write_project_file 提交以下文件——\n' +
            writtenPaths.map((p) => `- ${p}`).join('\n') +
            '\n其中没有任何核心 Java 源码。仅有资源 JSON 会导致功能根本不存在（编译仍可能通过），视为失败。\n' +
            '现在立即并行调用多个 write_project_file，连续提交本需求所需的全部核心源码文件' +
            '（通常包括：方块类、方块实体类、ScreenHandler/菜单类、Screen 界面类、注册类/入口修改等，按需求实际取舍；' +
            '已存在的文件改用 edit_project_file 以 search/replace 原地补写，不要重吐整份），' +
            '每个文件 content 必须是可编译的完整内容，禁止 TODO/占位符。\n' +
            '不要再检索、不要长篇规划、不要重发已提交的资源文件；直接连续发起 write_project_file 调用。' +
            '若核心源码确已全部提交，只回复「完成」。'
          : '你的产出经静态检查存在以下未闭合缺口（编译通过不代表这些功能存在）：\n' +
            gapReasons.map((r) => `- ${r}`).join('\n') +
            '\n已提交文件：\n' +
            writtenPaths.map((p) => `- ${p}`).join('\n') +
            '\n现在立即补齐上述缺口：缺 Java 类就并行调用 write_project_file 逐个提交完整可编译的类' +
            '（改既有类用 edit_project_file 做 search/replace，不要重吐整份）；' +
            '缺贴图就调用 texture_paint 生成与模型引用路径完全一致的 PNG（namespace 与路径都要对上）。\n' +
            '不要再做只读检索、不要长篇规划、不要重发已提交文件；直接连续发起工具调用。缺口全部闭合后只回复「完成」。'
    })
    let retry: AiChatResponse
    try {
      retry = await input.chat({
        providerId: effectiveProviderId,
        model: effectiveModel ?? undefined,
        messages,
        tools: fcUnsupported || chatDefs.length === 0 ? undefined : chatDefs,
        temperature: 0.2
      })
    } catch (err) {
      // 预算熔断：原样上抛；补救轮不再消耗额度
      if (err instanceof BudgetExceededError) throw err
      emit('generate', { type: 'log', detail: `补救轮调用失败：${(err as Error).message}` })
      retry = { content: finalContent, model: effectiveModel ?? 'unknown' }
    }
    // 补救轮先过暂停闸门，暂停期间不执行工具
    await gatePaused(input.state)
    if (input.state.canceled) return { files: [], notes: '', assetSaves, contract: null }
    if (retry.reasoning) emit('generate', { type: 'log', thought: retry.reasoning })
    const beforeWriteCount = toolWrittenFiles.length
    const retryToolCalls = retry.toolCalls ?? []
    if (retryToolCalls.length > 0) {
      messages.push({ role: 'assistant', content: retry.content ?? '', toolCalls: retryToolCalls })
      await applyToolCalls(retryToolCalls)
      // P2：补救轮同样做 token 感知的分层压缩
      await compactHistoryMessages()
      finalContent = retry.content ?? ''
      recomputeFiles()
      if (toolWrittenFiles.length > beforeWriteCount) {
        emit('generate', {
          type: 'log',
          detail: `补救轮通过 write_project_file 累计落盘 ${toolWrittenFiles.length} 个文件`
        })
      }
      if (!isIncomplete()) break
      // 仍不完整且工具通道零收获：再给一次纯 JSON 收口机会（仅零产出场景）
      if (noOutput && toolWrittenFiles.length === 0 && rescueRound < MAX_RESCUE_ROUNDS) {
        messages.push({
          role: 'user',
          content: '工具已执行完毕，但没有文件落盘。请立即输出最终 JSON 结果（files/notes），不要再调用工具。'
        })
        const closing = await input.chat({
          providerId: effectiveProviderId,
          model: effectiveModel ?? undefined,
          messages,
          tools: undefined,
          toolChoice: 'none',
          temperature: 0.2
        })
        // 纯 JSON 收口同样先过暂停闸门
        await gatePaused(input.state)
        if (input.state.canceled) return { files: [], notes: '', assetSaves, contract: null }
        if (closing.reasoning) emit('generate', { type: 'log', thought: closing.reasoning })
        finalContent = closing.content ?? ''
        recomputeFiles()
      }
    } else {
      finalContent = retry.content ?? ''
      // P2 卡死检测③（独白）：补救轮又只回了长篇解释、零工具调用零产出——
      // 连续两次即判定「催产无意义」，提前退出补救循环如实收口，不再空烧额度。
      const monologue = guard.noteMonologue(finalContent.length)
      if (monologue.stuck && monologue.notice) {
        emit('generate', {
          type: 'log',
          detail:
            `卡死检测：模型连续 ${rescueRound} 轮只解释不产出（约 ${finalContent.length} 字），` +
            '已停止追加催产提示并如实收口（避免继续消耗 API 额度）。'
        })
        recomputeFiles()
        break
      }
      recomputeFiles()
    }
  }

  // P1-4：完整性硬门必须在截断之后跑（避免「截断丢了核心 Java 仍判完整」）。
  // 修复前：硬门基于完整 files 判 hasAnyOutput/hasCodeOutput，截断后才丢超额文件，
  // 模型交 10 个文件、硬门看 10 个判完整，截断只留前 5 个可能丢核心 Java。
  // 修复后：先按档位 filesPerRound 截断，硬门基于截断后的 files 判完整性；
  // 被丢弃文件如实回报。
  if (project && files.length > tierCfg.filesPerRound) {
    const { capped, dropped } = applyFilesCap(files, tierCfg.filesPerRound)
    const preview = dropped
      .slice(0, 5)
      .map((f) => f.path)
      .join('、')
    emit('generate', {
      type: 'log',
      detail:
        `按 ${tierCfg.name}档上限截取前 ${tierCfg.filesPerRound} 个文件，丢弃后 ${dropped.length} 个：` +
        preview +
        (dropped.length > 5 ? ` 等 ${dropped.length} 个` : '') +
        '。后续硬门基于截断后的清单判断完整性。'
    })
    files = capped
  }

  // 完整性硬门：不满足就判失败，不带文件进入构建（避免「编译过=完成」的假绿灯）
  if (!hasAnyOutput()) {
    emit('generate', {
      type: 'log',
      detail: '补救后仍为零产出，本次生成判定失败（不会进入构建阶段）。'
    })
  } else if (needsCode && !hasCodeOutput()) {
    emit('generate', {
      type: 'log',
      detail:
        '产出不完整：仅有资源文件、缺少核心 Java 源码（或语义资产），判定失败（不会带假绿灯进入构建）。'
    })
    return { files: [], notes: parsed.notes ?? '', assetSaves, contract: null }
  } else {
    refreshGaps()
    if (gapReasons.length > 0) {
      emit('generate', {
        type: 'log',
        detail:
          '产出仍有未闭合缺口（保留已落盘文件，判定为部分完成、不带假绿灯判成功）：' +
          gapReasons.join('；')
      })
      // P2：缺口硬门退场——不再清空 files，改为把缺口随收口结论上报
      // （RunOutcome 据此封顶 partial + 列 gaps + 落 failed 开放续跑补齐）。
      return {
        files,
        notes: parsed.notes ?? '',
        assetSaves,
        contract: parseContract(parsed.contract),
        gaps: gapReasons
      }
    }
  }

  // 验收契约（特征③）：LLM 输出非法/缺省时 parseContract 返回 null，静默降级
  const contract = parseContract(parsed.contract)
  return { files, notes: parsed.notes, assetSaves, contract }
}
