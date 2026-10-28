/**
 * ToolRegistry（M8，依《MCP 架构分析与重构建议》方案 A）。
 *
 * 进程内工具注册表：把参考包检索/错误分析/版本校验等本地能力统一封装成
 * OpenAI 兼容 Function Calling 工具，generate 阶段由模型主动调用（反幻觉循环）；
 * mcdev-mcp 的 8 个只读静态工具经 MCPToolAdapter 注入同一注册表——MCP 作为
 * 「外部工具来源」接入，而非独立调用链。
 *
 * 工具分级：
 * - chat：generate FC 循环暴露给模型（只读检索类，无副作用）
 * - scheduling：仅编排调度代码直接调用（gradle_build/project_init，不在模型循环中暴露）
 *
 * 全部软失败（ok:false + 文本说明），不阻断流水线。
 *
 * 拆分结构（本文件只保留类型与聚合点，片段按域存放于 fcTools/）：
 * - fcTools/textClip.ts            截断常量/函数（片段共享叶件）
 * - fcTools/projectFilePolicy.ts   项目源码文件白名单（read/write_project_file 共用）
 * - fcTools/chatRetrievalTools.ts  只读检索（template_search/kb_search/mc_data_lookup/知识库/错误分析/版本校验/project_grep/read_project_file）
 * - fcTools/gameControlTools.ts    P0 游戏控制（mc_* 九工具，kunyu-observer）
 * - fcTools/contentTools.ts        M12 语义资产（content_list/read/upsert、write_project_file、texture_*、model_validate、item_validate）
 * - fcTools/recipeTools.ts         P1 配方语义
 * - fcTools/mixinTools.ts          P1 Mixin
 * - fcTools/validationTools.ts     P1 校验/验证
 * - fcTools/forgeNeoTools.ts       P1 Forge/NeoForge
 * - fcTools/fabricTools.ts         P1 Fabric
 * - fcTools/marketTools.ts         社区模组市场
 * - fcTools/schedulingTools.ts     调度工具（gradle_build）
 * - fcTools/mcdevBridgeTools.ts    mcdev-mcp 与自定义 MCP 桥接（registerMcdevTools/registerCustomMcpTools）
 * - fcTools/decompileTools.ts      反编译工作区（Vineflower 产物浏览 / 启动反编译）
 * - fcTools/audioTools.ts          音效工坊（声音库浏览、sounds.json 事件注册/注销）
 * - fcTools/ftbTools.ts            FTB 任务书（章节列表/读取/整章写入）
 * - fcTools/patchouliTools.ts      Patchouli 手册（列表/读取/整本写入）
 * - fcTools/kubejsTools.ts         KubeJS 脚本（列表/读写、内置模板落盘）
 */
import type { ToolDefinition } from '../../../shared/types/ai'
import type { AgentArtifact } from '../../../shared/types/agent'
import type { LoaderId } from '../../../shared/types/aiReference'
import type { ContextBuilder } from './contextBuilder'
import type { ReferenceService } from './referencePackageService'
import type { ReadonlyStaticTool } from './mcpClient'
import { builtinRetrievalTools } from './fcTools/chatRetrievalTools'
import { builtinGameControlTools } from './fcTools/gameControlTools'
import { builtinContentTools } from './fcTools/contentTools'
import { builtinSchedulingTools } from './fcTools/schedulingTools'
import { builtinRecipeTools } from './fcTools/recipeTools'
import { builtinMixinTools } from './fcTools/mixinTools'
import { builtinValidationTools } from './fcTools/validationTools'
import { builtinForgeNeoTools } from './fcTools/forgeNeoTools'
import { builtinFabricTools } from './fcTools/fabricTools'
import { builtinMarketTools } from './fcTools/marketTools'
import { builtinTodoTools } from './fcTools/todoTools'
import { builtinWebTools } from './fcTools/webTools'
import { builtinIdeTools } from './fcTools/ideTools'
import { builtinMemoryTools } from './fcTools/memoryTools'
import { builtinSubAgentTools } from './fcTools/subAgentTools'
import { builtinModelerTools } from './fcTools/modelerTools'
import { builtinDecompileTools } from './fcTools/decompileTools'
import { builtinAudioTools } from './fcTools/audioTools'
import { builtinFtbTools } from './fcTools/ftbTools'
import { builtinPatchouliTools } from './fcTools/patchouliTools'
import { builtinKubejsTools } from './fcTools/kubejsTools'
import { BudgetExceededError } from './orchestrator/types'
import {
  annotateToolDescription,
  resolveVisibility,
  type ToolVisibilityRule
} from './fcTools/toolPolicy'

/** 工具执行结果（统一序列化后回填给模型） */
export interface ToolResult {
  ok: boolean
  text: string
  data?: unknown
  error?: string
}

/** 执行上下文：本次运行的目标组合 */
export interface ToolExecContext {
  loader: LoaderId
  mcVersion: string
  /** 授权执行调度工具（gradle_build 等）；模型调用路径不传即拒绝 */
  scheduling?: boolean
  /** 本次工具调用的 id：用于派生稳定 artifact id，避免同资产多次重绘互相覆盖 */
  toolCallId?: string
  /** 本次运行 id：run 级工具状态（如 todo_write 的清单去重）据此隔离 */
  runId?: string
  /**
   * 上报产物的出口（仅编排运行时注入，接到 emit('generate') 上）。
   * 未注入（如集成桥/单测直调）时工具侧必须用 `?.` 守卫静默跳过。
   */
  reportArtifact?: (artifact: AgentArtifact) => void
  /**
   * M3 子代理活动上报出口（仅编排运行时注入）：agent_delegate 把子代理内部
   * 工具调用逐条上报为 tool-activity（带 parentCallId 嵌套到本卡片下）。
   * 未注入时子代理静默执行（旧行为）。
   */
  reportToolActivity?: (activity: import('../../../shared/types/agent').AgentToolActivity) => void
}

/** 编排调度用的 Gradle 运行注入（与 orchestrator 同签名） */
export type GradleRunner = (
  input: { root: string; tasks: string[]; javaHome?: string; timeoutMs?: number },
  sink: (event: GradleToolEvent) => void
) => string

interface GradleToolEvent {
  type: string
  phase?: string
  exitCode?: number | null
  cancelled?: boolean
  timedOut?: boolean
  runId?: string
  text?: string
}

type ToolExecute = (
  args: Record<string, unknown>,
  ctx: ToolExecContext
) => ToolResult | Promise<ToolResult>

export interface RegisteredTool {
  def: ToolDefinition
  kind: 'chat' | 'scheduling'
  execute: ToolExecute
  /** 动态门控：返回 false 时不暴露给模型且执行被拒绝（如无打开项目） */
  available?: () => boolean
  /**
   * 可见性规则（P4）：集中目录 toolPolicy 的规则名，语义唯一维护于 resolveVisibility。
   * 与 available 互斥——同一工具只用其一，避免两套语义互相覆盖。
   */
  visibility?: ToolVisibilityRule
}

export interface McpToolPort {
  isEnabled(): boolean
  getStatus(): { kind: string }
  callStaticTool(
    name: ReadonlyStaticTool,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; text: string; error?: string }>
}

export interface KbRagPort {
  /** 本地语义检索（首次调用懒加载 embedding 模型；内部自动降级关键词） */
  search(
    query: string,
    k: number
  ): Promise<{
    hits: Array<{ chunk: { relPath: string; index: number; text: string }; score: number }>
    degraded: boolean
    reason?: string
  }>
}

export interface ToolRegistryDeps {
  contextBuilder?: ContextBuilder
  reference?: ReferenceService
  mcp?: McpToolPort
  runGradle?: GradleRunner
  javaHome?: () => string | undefined
  /**
   * 当前打开的项目根（M12 语义资产工具用）。
   * orchestrator 每次 run 解析项目后更新；返回 null 时 content_* 工具不暴露给模型。
   */
  projectRoot?: () => string | null
  /**
   * 当前项目类型（'modpack' 等），orchestrator 与 projectRoot 同步更新。
   * market_install_mod 等写盘市场工具仅对 modpack 项目暴露。
   */
  projectType?: () => string | null
  /**
   * 当前项目 loader（'fabric'/'forge'/'neoforge'），orchestrator 与 projectRoot 同步更新（per-run 注入）。
   * fabric_content_register 等 Yarn 写盘工具据此禁用：在 Forge/NeoForge（Mojmap）项目上
   * 暴露会把 registry/ModItems.java 覆盖成 Yarn 代码 → 立刻编译崩溃（P1-9）。
   * 未注入（undefined）时保持旧行为（不门控），便于测试与只读场景。
   */
  projectLoader?: () => string | null
  /**
   * 本轮用户上传的参考图（PNG data URL），texture_pixelize 等工具按序号引用。
   * orchestrator 每次 run 更新；无图时返回空数组。
   */
  referenceImages?: () => string[]
  /** C2：本地知识库 RAG 端口（xenova 本地 embedding，懒初始化） */
  kbRag?: () => Promise<KbRagPort | null>
  /** P0：Minecraft 结构化数据（minecraft-data 1.20.1 离线子集） */
  mcData?: () => import('../mcDataService').McDataService | null
  /**
   * P0：kunyu-observer 游戏观察服务探测（默认扫 127.0.0.1:9876-9886）。
   * mc_* 游戏控制工具据此连接运行中的 Minecraft；测试可注入伪端点。
   */
  observerProbe?: () => Promise<import('../observer/observerClient').ObserverEndpoint | null>
  /**
   * P1：Agent 可独立重跑无头 GameTest（run_game_test 工具）。
   * 缺省走真实 runGameTestServer；测试注入假实现。
   */
  runGameTest?: (input: {
    root: string
    javaHome: string
    timeoutMs?: number
  }) => Promise<import('../../../shared/types/agent').GameTestReport>
  /**
   * P1：Agent 可独立启动开发客户端（mc_launch 工具，等价一键运行）。
   * 未注入时 mc_launch 返回引导文案（不代启动），避免误触占用 Gradle 运行槽。
   */
  launchDevClient?: (root: string) => Promise<{ ok: boolean; text: string; error?: string }>
  /**
   * T1 write-through 端口（orchestrator per-run 注入，经 AsyncLocalStorage scope 读取）：
   * write_project_file 验收通过后立即写盘，工作台实时可见 AI 产出。
   * 返回 null（无项目 run / 测试未注入）时退回旧行为——仅登记，generate 结束统一写盘。
   */
  writeThrough?: () => import('./orchestrator/writeThrough').WriteThroughPort | null
  /**
   * M1 子代理委派开关（orchestrator 注入，读设置 ai.subAgentEnabled）。
   * 未注入视为关闭——agent_delegate 不进 FC 列表，零算力成本。
   */
  subAgentEnabled?: () => boolean
  /**
   * M1 子代理执行出口（orchestrator 注入，实现见 subAgentRunner.runSubAgent）。
   * 未注入时 agent_delegate 软失败；ctx 由工具调用点透传（与主代理同 run）。
   * M3：onToolActivity 由工具侧透传给 runner，子代理内部过程嵌套进主 run 事件流。
   */
  runSubAgent?: (input: {
    task: string
    context?: string
    ctx: ToolExecContext
    onToolActivity?: import('./subAgentRunner').SubAgentRunInput['onToolActivity']
  }) => Promise<import('./subAgentRunner').SubAgentRunResult>
}

export interface ToolRegistry {
  registerTool(
    def: ToolDefinition,
    execute: ToolExecute,
    kind?: 'chat' | 'scheduling',
    /** 动态可用性（如 mcdev-mcp 就绪状态）；返回 false 时不进入 FC 定义列表 */
    available?: () => boolean
  ): void
  /** FC 循环可用的工具定义；includeScheduling=true 时含调度工具 */
  getToolDefinitions(options?: { includeScheduling?: boolean }): ToolDefinition[]
  has(name: string): boolean
  executeTool(name: string, args: Record<string, unknown>, ctx: ToolExecContext): Promise<ToolResult>
}

interface RegisteredToolEntry {
  def: ToolDefinition
  kind: 'chat' | 'scheduling'
  execute: ToolExecute
  available?: () => boolean
}

export function createToolRegistry(deps: ToolRegistryDeps = {}): ToolRegistry {
  const tools = new Map<string, RegisteredToolEntry>()

  /**
   * 统一入库：把片段声明的 visibility 规则解析为 available 谓词后再登记。
   * 语义互斥——工具要么给出 available 闭包，要么给 visibility 规则名。
   * 命名纪律（P6）：行为级标签 + 反向路由在此唯一渲染点注入 description，
   * 片段只写功能描述；外部 MCP 桥接走 registerTool，不经本渲染。
   */
  const put = (t: RegisteredTool): void => {
    const def: ToolDefinition = {
      ...t.def,
      function: {
        ...t.def.function,
        description: annotateToolDescription(t.def.function.name, t.def.function.description)
      }
    }
    tools.set(t.def.function.name, {
      def,
      kind: t.kind,
      execute: t.execute,
      available:
        t.available ??
        (t.visibility !== undefined ? resolveVisibility(t.visibility, deps) : undefined)
    })
  }

  // 只读检索（模板/知识库/原版数据/错误分析/版本校验/工程检索）
  for (const t of builtinRetrievalTools(deps)) put(t)
  // P0 游戏控制（kunyu-observer）
  for (const t of builtinGameControlTools(deps)) put(t)
  // P1 配方语义工具（recipe_validate/recipe_create/recipe_generate）
  for (const t of builtinRecipeTools(deps)) put(t)
  // P1 Mixin 工具（target_lookup/scaffold/register/validate，Fabric+Yarn）
  for (const t of builtinMixinTools(deps)) put(t)
  // P1 校验/验证工具（fabric.mod.json 校验、游戏日志诊断、游戏内场景断言）
  for (const t of builtinValidationTools(deps)) put(t)
  // P1 Forge/NeoForge 工具（mods.toml 校验、上游版本查询）
  for (const t of builtinForgeNeoTools(deps)) put(t)
  // P1 Fabric 工具（meta 版本、Yarn javadoc 速查、模板生成、内容注册骨架、assets/data JSON）
  for (const t of builtinFabricTools(deps)) put(t)
  // 社区模组市场工具（织星整合包：搜索/详情只读全项目可用，安装/已装列表仅限整合包项目）
  for (const t of builtinMarketTools(deps)) put(t)
  // P4 待办清单（模型自维护的进度面板；无副作用，不依赖项目上下文）
  for (const t of builtinTodoTools()) put(t)
  // B1 联网检索（web_fetch：本地语料之外的在线资料出口，零配置，恒可见）
  for (const t of builtinWebTools()) put(t)
  // B2 IDE 通用（list_files/run_command：文件树视图 + 白名单命令执行，需项目上下文）
  for (const t of builtinIdeTools(deps)) put(t)
  // B3 Agent 地基（agent_memory_*：项目级持久记忆，跨会话留存，需项目上下文）
  for (const t of builtinMemoryTools(deps)) put(t)
  // M1 多代理（agent_delegate：子代理委派；visibility 由设置 ai.subAgentEnabled 门控）
  for (const t of builtinSubAgentTools(deps)) put(t)
  // M12 语义资产工具（造匠 Agent：直接读写 .kunyu/content JSON，表单/生成器同源）
  for (const t of builtinContentTools(deps)) put(t)
  // M13 建模器工程工具（AI 直接读写 .kunyu/modeler/<id>.json）
  for (const t of builtinModelerTools(deps)) put(t)
  // 反编译工作区（userData/decompiled 产物浏览 + Vineflower 启动，不依赖项目）
  for (const t of builtinDecompileTools()) put(t)
  // 音效工坊（声音库只读浏览 + sounds.json 事件注册/注销）
  for (const t of builtinAudioTools(deps)) put(t)
  // FTB 任务书（章节只读 + 整章写入 config/ftbquests/quests/chapters/）
  for (const t of builtinFtbTools(deps)) put(t)
  // Patchouli 手册（只读 + 整本同步写入 config/<ns>/patchouli_books/）
  for (const t of builtinPatchouliTools(deps)) put(t)
  // KubeJS 脚本（kubejs/*_scripts 读写 + 内置模板落盘）
  for (const t of builtinKubejsTools(deps)) put(t)
  // 调度工具（不进模型 FC 循环）
  for (const t of builtinSchedulingTools(deps)) put(t)

  return {
    registerTool(def, execute, kind = 'chat', available) {
      tools.set(def.function.name, { def, execute, kind, available })
    },

    getToolDefinitions(options) {
      const includeScheduling = options?.includeScheduling === true
      return [...tools.values()]
        .filter(
          (t) =>
            (includeScheduling || t.kind === 'chat') &&
            (t.available === undefined || t.available())
        )
        .map((t) => t.def)
    },

    has: (name) => tools.has(name),

    async executeTool(name, args, ctx) {
      const tool = tools.get(name)
      if (!tool) {
        return { ok: false, text: '', error: `未注册的工具：${name}` }
      }
      if (tool.available !== undefined && !tool.available()) {
        return { ok: false, text: '', error: "工具 " + name + " 当前不可用" }
      }
      // 调度工具（gradle_build 等）仅编排调度代码可执行；模型调用路径不传 scheduling 即拒绝
      if (tool.kind === 'scheduling' && !ctx.scheduling) {
        return { ok: false, text: '', error: "工具 " + name + " 为调度工具，不可由模型直接调用" }
      }
      try {
        return await tool.execute(args, ctx)
      } catch (err) {
        // 预算熔断必须上抛，否则熔断在工具路径失效
        if (err instanceof BudgetExceededError) throw err
        return { ok: false, text: '', error: `工具 ${name} 执行异常：${(err as Error).message}` }
      }
    }
  }
}

// MCP 桥接与文本截断（实现见片段，这里保持原导出路径兼容）
export { TOOL_RESULT_CLIP, clipToolText } from './fcTools/textClip'
export { registerMcdevTools, registerCustomMcpTools } from './fcTools/mcdevBridgeTools'
