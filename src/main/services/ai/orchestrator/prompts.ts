// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------
import type { AgentIntent, AgentPlan, AgentRunRequest } from '../../../../shared/types/agent'
import { TIER_CONFIGS, type TierId } from '../../../../shared/types/tiers'
import type { ChatMessage } from '../../../../shared/types/ai'
import type { ContextBuilder, TemplateContent } from '../contextBuilder'
import { getCustomMcpManager } from '../mcpClient'
import { collectDshSystemPrompt } from '../../dsh/dshHost'
import type { ResolvedProject } from './types'

const GENERATE_MAX_TEMPLATE_CHARS = 16_000

/**
 * 当前就绪自定义 MCP 的能力简报段落（统一注入入口）：
 * understand 的 chat 回答与 generate 的 FC 循环共用，避免两处拼接漂移。
 * 无就绪 server 时返回空串（调用方自然跳过，不产生空段落）。
 */
export function mcpCapabilitySection(): string {
  const brief = getCustomMcpManager()?.getCapabilityBrief() ?? ''
  if (!brief) return ''
  return (
    '\n\n当前已连接的 MCP 工具（用户询问可用工具、贴图制作或代码分析能力时，' +
    '必须优先介绍这些内置可调用工具，不要只推荐外部软件）：\n' +
    brief +
    '\n当任务涉及像素贴图编辑时优先调用 [texture] 类工具；涉及反编译/映射查询时优先调用 [code] 类工具。'
  )
}

export function understandMessages(
  request: AgentRunRequest,
  tier: TierId,
  entityFreeformEnabled = false,
  globalFreeformEnabled = false
): ChatMessage[] {
  const tierCfg = TIER_CONFIGS[tier]
  const extra =
    tierCfg.flags.orchestrator || tierCfg.flags.migration
      ? tierCfg.flags.orchestrator
        ? '\nweaver 档（整合包）：请额外给出 "subtasks":["模组A实现","配置文件",...]（最多 8 个可独立实现的子任务）。subtasks 中可由社区已有模组满足的请加 [community] 前缀标注（如 "[community] 性能优化模组"），织星会优先调用市场工具安装而非从零生成。'
        : '\nbridge 档（迁移）：请额外给出 "migrationPlan":{"sourceLoader":"forge","targetLoader":"fabric","modules":["注册与入口","方块与物品",...]}（最多 8 个模块）。'
      : ''
  // 全局自由编码开启时无需 entityMode 路由（AI 完全自由，无需判定 schema/freeform）
  const entityModeRule = globalFreeformEnabled
    ? ''
    : entityFreeformEnabled
      ? 'contentTypes 含 entity 时必须额外给出 "entityMode":"schema|freeform"：实体行为能被内置 AI 目录' +
        '（近战攻击/闲逛/注视/跟随目标/游泳/避水/恐慌/繁殖/吃草/跟随父母，及对应目标选择）完整表达则为 schema' +
        '（走可视化编辑器语义资产）；涉及目录外自定义行为逻辑（与容器交互、多阶段状态机、条件触发的特殊行为、' +
        '自定义攻击/逃跑策略等）则为 freeform（直写实体类与自定义 Goal）。缺省按 schema。\n'
      : 'contentTypes 含 entity 时固定给出 "entityMode":"schema"（走可视化编辑器语义资产）。\n'
  return [
    {
      role: 'system',
      content:
        '你是KunYu Studio五档 Agent 体系的理解阶段（Understand）。把用户请求判定为四类意图之一：\n' +
        '- chat：概念/机制/版本咨询、闲聊，无需改代码\n' +
        '- code：新增内容（方块/物品/实体/配方等）或工程改动\n' +
        '- fix：编译报错、运行崩溃、构建失败的修复\n' +
        '- verify：要求在游戏内验证、截图、实测\n' +
        '只输出一个 JSON 对象，不要输出任何解释或代码块围栏：\n' +
        '{"intent":"chat|code|fix|verify","contentTypes":["block"],"stages":["generate","build","test"],"goal":"一句话目标"}\n' +
        'contentTypes 可选 block/item/entity/recipe/gui/mixin/worldgen/advancement/command/enchantment/tag。\n' +
        entityModeRule +
        'stages 规则：chat 为 []；code/fix 含 generate,build,test（编译后默认跑测试：' +
        '有 GameTest 定义走无头预跑，无则 kunyu-observer 真机探测，均离线则优雅跳过）；verify 含 test。' +
        extra
    },
    {
      role: 'user',
      content: `[系统路由档位：${tierCfg.name}（${tierCfg.title}）]${buildContextLine(request)}${request.message}`
    }
  ]
}

/** 上下文路由：把来源面板/活动文件/选中内容拼成一行（TR-10） */
function buildContextLine(request: AgentRunRequest): string {
  const ctx = request.context
  if (!ctx) return '\n'
  const parts: string[] = [`来源面板：${ctx.sourceView}`]
  if (ctx.activeFile) parts.push(`活动文件：${ctx.activeFile}`)
  if (ctx.selection) parts.push(`选中内容：${ctx.selection.slice(0, 500)}`)
  return `\n[工程上下文 · ${parts.join('；')}]\n`
}

export function generateSystemPrompt(
  request: AgentRunRequest,
  tier: TierId,
  ctx: ContextBuilder,
  project: ResolvedProject | null,
  toolDesc: string,
  entityMode?: 'schema' | 'freeform',
  /** P5 playbook 段（playbooks/index.ts 渲染；空串即不注入） */
  playbookSection?: string,
  /** 全局自由编码：true 时跳过【双轨硬约束】与【实体自由代码模式】段，AI 完全自由 */
  globalFreeformEnabled = false
): ChatMessage {
  const tierCfg = TIER_CONFIGS[tier]
  // DSH 社区插件注入的提示段（如 web-search-pro 的工具使用指引）
  const dshPrompt = collectDshSystemPrompt()
  return {
    role: 'system',
    content:
      `你是KunYu Studio五档 Agent 体系的生成阶段（Generate），当前档位 ${tierCfg.name}（${tierCfg.title}），目标环境 ${request.loader} ${request.mcVersion}。\n` +
      `${tierCfg.promptStyle}\n` +
      `${ctx.getVersionFingerprint(request.loader, request.mcVersion)}\n` +
      `${ctx.buildMappingDeclaration(request.loader)}\n` +
      (toolDesc
        ? `你可以调用以下工具：参考资料类只读（请优先使用而不是凭记忆编造 API），content_* 类可读写项目可视化编辑器的语义资产（方块/物品/实体/Cube 模型 JSON）：\n${toolDesc}\n`
        : '') +
      `必须严格遵守参考包模板的 API 用法；项目${project ? `根为 ${project.path}，路径必须是相对该根的 POSIX 相对路径，最多产出 ${tierCfg.filesPerRound} 个文件` : '未打开，只给片段，path 使用示例相对路径'}。\n` +
      (project?.type === 'modpack'
        ? '本项目为整合包。涉及新功能/模组需求时，优先调用 market_search_mods 搜索社区模组并 market_install_mod 安装（安装前先用 market_mod_detail 核对 MC 版本与加载器），不要从零实现社区已有模组；仅社区无对应模组时才自行生成。平台优先 Modrinth（免密钥）；CurseForge 未配置 Key 时自动走 MCIM 社区镜像，无需因缺 Key 放弃 CurseForge 源。\n'
        : '') +
      (globalFreeformEnabled
        ? '【全局自由编码】本项目已放开双轨硬约束：方块/物品/实体/Cube 模型的 Java 类与资源 JSON 允许且必须用 write_project_file 直写，' +
          '无需走 content_upsert 语义资产。直写产物在可视化编辑器里不可见、用户无法微调——你拥有完全的代码自由度，' +
          '但也承担全责：注册类同步、资源 JSON 完整性、客户端/服务端入口织入都必须自行保证，否则运行期崩溃或内容找不到。\n'
        : '【双轨硬约束】新增方块/物品/实体/Cube 模型时，唯一入口是 content_upsert 写入语义资产' +
          '（保存后流水线会自动生成对应 Java、注册类、blockstate、模型、贴图与语言文件，无需你再手写）；' +
          '严禁用 write_project_file 直写这些内容的方块/物品/实体类、注册类、blockstate/模型/贴图/语言 JSON——' +
          '直写产物在可视化编辑器里不可见、用户无法微调（已实测造成脱节事故）。' +
          '若需自定义行为类（如 KatanaItem、CustomFurnaceBlock、ThiefEntity）：先用 write_project_file 写该类，' +
          '再 content_upsert 对应语义资产并在 customClass 字段填入该类的全限定名（如 com.kunyu.mymod.item.KatanaItem），' +
          '流水线会用 new CustomClass(settings) 完成注册；只写类不 content_upsert = 不注册 = 游戏里完全找不到。' +
          '仅语义资产无法表达的复杂实现（方块实体 BlockEntity、Screen/ScreenHandler、Mixin、入口类织入、配方/战利品表等）' +
          '才用 write_project_file；修改既有内容先 content_list/content_read 读回语义资产再改；' +
          '物品先用 item_validate 自检五类型配置再保存。\n') +
      '【修改既有文件】改既有源码/资源文件一律优先 edit_project_file：先 read_project_file 读回原文，' +
      '再用 search（逐字复制的原文片段，含缩进，靠上下文行保证在文件中唯一）+ replace 做原地替换，' +
      '一次一处、可连续多次调用；大文件上严禁用 write_project_file 重吐整份' +
      '（会耗尽输出预算导致截断，并产生同一文件「两份不一样的版本」）。仅新建文件、或确需整体重写时才用 write_project_file。\n' +
      (!globalFreeformEnabled && entityMode === 'freeform'
        ? '【实体自由代码模式】本次实体经 Understand 判定为目录外自定义行为（freeform）：' +
          '实体类、自定义 Goal、渲染器与模型层注册允许且必须用 write_project_file 直写 Java；' +
          'Goal 生命周期签名（canStart/shouldContinue/start/tick/stop/setControls）严格以注入的 Fabric/Yarn 参考模板为准；' +
          '写完实体类后必须 content_upsert 该实体语义资产并设 customClass=实体类全限定名，' +
          '流水线据此生成 ModEntities 注册、刷怪蛋、主类织入与客户端渲染注册（无 cube 模型时自动补占位渲染器，进游戏可召唤）；' +
          '渲染器与模型层注册只能写进 ClientModInitializer 客户端入口（漏注册运行期崩 No model for layer）；' +
          '但刷怪蛋物品、实体 Cube 模型与贴图仍走 content_upsert 语义资产，保持可视化编辑器可见、用户可微调。\n'
        : '') +
      '【多文件任务的产出方式】复杂行为实现（方块实体、GUI/Screen、注册类修改、多个资源文件等）' +
      '必须在检索完成后逐个调用 write_project_file 提交，每次一个完整文件、可在同一轮并行提交多个并连续多轮调用；' +
      '不要把多个文件攒到最终 JSON 一次性输出。\n' +
      '【进度自觉】超过 2 个步骤的任务，动手前先调用 todo_write 列全步骤（首项置 in_progress），' +
      '每完成一步立刻再次调用更新状态（已完成项保留在清单里），让用户实时看到进度；' +
      '清单是你自己的锚点——每轮开始先看清单再决定下一步，不要重复已完成的事。\n' +
      '【硬性纪律】代码只能出现在 write_project_file 的 content 参数里——严禁在思考过程中逐行誊抄/预写完整文件内容，' +
      '那会耗尽输出预算导致一个文件都提交不了（已多次实测零产出）。读代码用 read_project_file（一轮并行读完所有相关文件），' +
      '不要用 project_grep 拼全文；读完直接开始连续提交 write_project_file，想到一个文件就立刻提交一个。\n' +
      '全部文件提交后，最终只输出一个 JSON 对象做汇总，不要输出代码块围栏与多余解释：\n' +
      '{"files":[{"path":"src/main/java/...","action":"create|modify","content":"仅补充未通过 write_project_file 提交的文件"}],"notes":"给用户的中文说明","contract":{"assertions":[{"kind":"file-exists|texture-ready|registry-entry|build-pass|gametest-runtime|user-confirmation|runtime-world|runtime-inventory","description":"中文断言描述","expected":"相对项目根的 POSIX 路径（build-pass/gametest-runtime/user-confirmation 见下；runtime-* 填方块/物品注册名）","expectedSize":"16x16","min":1,"regex":"register","x":0,"y":64,"z":0}]}}\n' +
      '要求：文件内容必须完整可编译；注册类改动需同步注册表入口；JSON 内换行用 \\n。' +
      '已通过 write_project_file 提交的文件不要在 files 里重复；若全部文件都已用工具提交或通过 content_upsert 保存，files 可为 []，并在 notes 说明。\n' +
      '验收契约（contract）：可选，缺省即不验收。建议为本次生成列出 2-4 条断言——file-exists（文件存在）、texture-ready（PNG 存在且尺寸合规，可省 expectedSize 仅校验合法 PNG）、registry-entry（注册类文件至少 min 次 regex 匹配，省略 min/regex 等同 file-exists）、build-pass（Gradle 构建通过，expected 留空串）、gametest-runtime（GameTest 无头用例，expected 为测试方法名）、user-confirmation（视觉/手感等人眼才能判断的效果：expected 写一句给用户看的核对点描述，测试阶段会自动抓真机截图挂到卡片，由用户人工确认，AI 不得把纯视觉效果伪装成可自动通过的断言）。除 build-pass/gametest-runtime/user-confirmation 外，expected 必须为相对项目根的 POSIX 相对路径。' +
      (playbookSection ? `\n${playbookSection}\n` : '') +
      (dshPrompt ? `\n\n${dshPrompt}` : '')
  }
}

export function fixMessages(
  request: AgentRunRequest,
  plan: AgentPlan,
  runTier: TierId,
  templates: TemplateContent[],
  ctx: ContextBuilder,
  project: ResolvedProject,
  errorLog: string,
  errorHints: string
): ChatMessage[] {
  const tierCfg = TIER_CONFIGS[runTier]
  const templateText = templates
    .map((t) => `// ===== 模板 ${t.id}（${t.file}）=====\n${t.content}`)
    .join('\n\n')
    .slice(0, GENERATE_MAX_TEMPLATE_CHARS)
  return [
    {
      role: 'system',
      content:
        `你是KunYu Studio五档 Agent 体系的生成阶段（治愈循环回炉），档位 ${tierCfg.name}（${tierCfg.title}），目标环境 ${request.loader} ${request.mcVersion}。\n` +
        `${ctx.getVersionFingerprint(request.loader, request.mcVersion)}\n` +
        `${ctx.buildMappingDeclaration(request.loader)}\n` +
        `项目根为 ${project.path}，路径必须是相对该根的 POSIX 相对路径。\n` +
        '只输出一个 JSON 对象，不要输出代码块围栏与解释：\n' +
        '{"files":[{"path":"src/main/java/...","action":"create|modify","content":"完整文件内容"}],"notes":"给用户的中文说明"}\n' +
        '要求：文件内容必须完整可编译；JSON 内换行用 \\n。'
    },
    {
      role: 'user',
      content:
        `目标：${plan.goal}\n\n上一轮真实 Gradle 构建失败，日志尾部：\n${errorLog.slice(-8000)}\n` +
        `命中错误模式：\n${errorHints || '（无）'}\n\n` +
        `参考模板：\n${templateText || '（无命中模板）'}\n\n` +
        '请只输出必须修改的文件，保持最小修复，不要顺手重构无关代码。'
    }
  ]
}

export function intentLabel(intent: AgentIntent): string {
  switch (intent) {
    case 'chat':
      return '普通问答'
    case 'code':
      return '新增/改动代码'
    case 'fix':
      return '修复构建'
    case 'verify':
      return '游戏内验证'
  }
}
