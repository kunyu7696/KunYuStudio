/**
 * AI 提供商配置与对话服务共享类型（M6 T6.3，设计文档 3.11.2）。
 * ChatMessage/AiChatRequest 等对话服务类型与提供商配置同文件维护，
 * 设置模型（settings.ts）依赖提供商类型，M7 对话面板继续复用此处类型。
 */

/** 提供商类型：OpenAI 兼容协议（豆包/OpenAI/任意兼容网关）或本地 Ollama */
export type AiProviderKind = 'openai-compatible' | 'ollama'

/** AI 提供商配置（持久化在主进程 settings.json，apiKey 不进入渲染层日志） */
export interface AiProviderConfig {
  id: string
  name: string
  kind: AiProviderKind
  /** API 根地址，如 https://ark.cn-beijing.volces.com/api/v3 / http://localhost:11434 */
  baseUrl: string
  /** API Key；Ollama 为空串 */
  apiKey: string
  /** 厂商官方申请 API Key 的页面（编辑弹窗「获取密钥」跳转用，自定义厂商为空串） */
  apiKeyUrl: string
  /** 模型名称 */
  model: string
  /**
   * 图像生成模型（可选，OpenAI 兼容 /images/generations 协议）。
   * 留空表示该供应商不做 AI 重绘；如智谱 cogview-3、豆包 seedream、dall-e-3。
   * 贴图工坊纹理重绘只使用用户自带 Key 调用，工作台本身不内置任何云端额度。
   */
  imageModel?: string
  /** 单次请求最大 Token */
  maxTokens: number
  /**
   * 模型上下文窗口（token 数，可选，用户标注）。
   * 多数厂商 /models 不返回 context length，故由用户在设置页标注；
   * 缺省/0 表示未标注，历史预算回退固定上限（聊天 48k / Agent 64k）。
   * 标注后预算 = min(固定上限, 窗口 × CONTEXT_BUDGET_WINDOW_RATIO)。
   */
  contextWindow?: number
  /** 采样温度 0-2 */
  temperature: number
  /** 是否启用（停用的提供商不出现在默认候选中） */
  enabled: boolean
}

/** 预设提供商（新建时一键带出默认端点） */
export interface AiProviderPreset {
  kind: AiProviderKind
  name: string
  baseUrl: string
  /** 厂商官方申请 API Key 的页面（Ollama 免 Key，为空串） */
  apiKeyUrl: string
  /** 推荐模型展示用，可被用户修改（默认选中第一个） */
  recommendedModel: string
  /** 预置可选模型列表（下拉框展示用），补充 recommendedModel 之外的常见模型 */
  recommendedModels?: string[]
  /** 推荐的图像生成模型（为空表示该预设不主打图像能力） */
  recommendedImageModel?: string
}

/**
 * 模型列表拉取结果（含新鲜度）。
 * 设置页据此展示「N 个模型 · 刚刚同步」，并区分是实时拉取还是缓存命中。
 */
export interface ModelListInfo {
  models: string[]
  /** 本结果的获取时间（epoch ms）；命中缓存时为缓存写入时间 */
  fetchedAt: number
  /** true 表示本次未联网，直接返回缓存 */
  fromCache: boolean
}

/** 知识库语料清单中的一个文件 */
export interface KnowledgeFileEntry {
  /** 相对语料根的 POSIX 路径，如 fabric/blocks.md */
  path: string
  sha256: string
  bytes: number
}

/** 语料包状态：指纹一致 / 有变动 / 未登记 / 久未更新 / 空 */
export type KnowledgePackState =
  | 'ok'
  | 'drifted'
  | 'missing-manifest'
  | 'outdated'
  | 'empty'

/** 知识库语料包状态（设置页展示 + 过期提示） */
export interface KnowledgePackStatus {
  state: KnowledgePackState
  corpusVersion: string | null
  generatedAt: string | null
  /** 登记日期距今天数；日期缺失/非法为 null */
  ageDays: number | null
  fileCount: number
  fingerprint: string
  /** 清单登记但磁盘缺失 */
  missingFiles: string[]
  /** 磁盘存在但清单未登记 */
  extraFiles: string[]
  /** 两边都有但内容不同 */
  changedFiles: string[]
  /** 面向用户的结论句 */
  message: string
  /** true 表示本次检测发现差异后已自动重写指纹清单（仅磁盘可写时会发生） */
  autoRefreshed?: boolean
}

/** 一条对话消息（M7 复用） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** role=tool：对应的 assistant tool_call id（Function Calling 回填） */
  toolCallId?: string
  /** role=assistant：模型请求的工具调用（原样回传给服务端） */
  toolCalls?: ToolCallItem[]
  /**
   * role=user：随消息发送的图片（data URL，如 data:image/png;base64,...）。
   * 序列化时 OpenAI 兼容协议转 vision content parts，Ollama 转 images 纯 base64 数组。
   * 历史重放不携带，仅当前提问消息使用。
   */
  images?: string[]
}

/** 用户随消息上传的附件（UI 展示 + 发送链路共用） */
export interface ChatAttachment {
  /** image=图片/照片（走视觉模型）；doc=文本类文档（内容抽取后拼入提问） */
  kind: 'image' | 'doc'
  /** 文件名（含扩展名） */
  name: string
  /** 文件字节大小 */
  size: number
  /** MIME 类型（未知为 application/octet-stream） */
  mimeType: string
  /** kind=image：原始图片 data URL（发送给模型，不持久化） */
  dataUrl?: string
  /** kind=doc：抽取的文本内容（发送时拼入提问，不持久化） */
  text?: string
  /** 气泡展示用缩略图 data URL（图片压缩后，体积小，可随会话持久化） */
  thumbUrl?: string
}

/** OpenAI 兼容 tool_calls 项（Function Calling） */
export interface ToolCallItem {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** OpenAI 兼容工具定义（JSON Schema 参数） */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** 助手面板展示用的对话条目（含发送中/错误态） */
export interface ChatEntry {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 助手回复等待中（占位气泡） */
  pending?: boolean
  /** 该条回复失败的错误文案 */
  error?: string
  /** 普通问答的推理过程（reasoning_content 原文，仅内存，不持久化） */
  reasoning?: string
  /** 思考耗时毫秒（首个正文增量到达时定格，用于「已深度思考（用时 X 秒）」） */
  reasoningMs?: number
  /** M7：五 Agent 编排运行 id（气泡下嵌入产出卡片用） */
  agentRunId?: string
  /** M7：该编排运行的意图（标签展示用） */
  agentIntent?: string
  /** 用户该条消息携带的附件（仅展示元信息与缩略图，不含原始数据） */
  attachments?: ChatAttachment[]
  /** tool loop 中间态：让气泡能显示「🔧 正在联网...」「✅ web_fetch 完成」等 */
  toolActivities?: ToolActivity[]
}

export interface ToolActivity {
  name: string
  status: 'running' | 'done' | 'failed'
  /** 执行前参数摘要（URL、查询词等） */
  argsSummary?: string
  /** 执行后结果摘要（字符数、错误信息等） */
  summary?: string
  startedAt: number
  endedAt?: number
}

/** 对话请求（主进程抽象层输入） */
export interface AiChatRequest {
  providerId: string
  /**
   * 对话消息序列。mode='complete'（FIM 补全）时不传，改用 fim 字段提供
   * prefix/suffix；主进程 runFimCompletion 会按厂商路由构造补全请求。
   */
  messages?: ChatMessage[]
  /** 覆盖提供商默认模型 */
  model?: string
  maxTokens?: number
  temperature?: number
  /** Function Calling：可调工具定义（M8 ToolRegistry） */
  tools?: ToolDefinition[]
  /** 'none' 用于最后一轮逼出最终文本；缺省由服务端决定 */
  toolChoice?: 'auto' | 'none'
  /**
   * CUE 补全模式：'complete' 走 FIM（Fill-in-the-Middle）协议，主进程按
   * providerKind/model 路由——DeepSeek-coder 走原生 FIM token + /completions，
   * 其他 OpenAI 兼容厂商用 system prompt 包装前缀/后缀走 chat 端点。
   * 缺省 'chat' 走普通对话。
   */
  mode?: 'chat' | 'complete'
  /** mode='complete' 时的 FIM 上下文（光标前/后代码 + 语言 + 可选仓库参考） */
  fim?: {
    prefix: string
    suffix: string
    language: string
    /** M3：仓库级上下文（项目代码/知识库/模板检索结果），注入 FIM prompt 作为只读参考 */
    context?: string
  }
}

/** 模型返回的 token 用量（usage 落库）；厂商未带字段时对应项缺省 */
export interface AiUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/** 对话响应 */
export interface AiChatResponse {
  content: string
  model: string
  /** 模型请求的工具调用（Function Calling）；空数组表示无 */
  toolCalls?: ToolCallItem[]
  /** 推理模型的思考过程（reasoning_content），用于前端「思考」折叠块展示 */
  reasoning?: string
  /** token 用量（OpenAI usage / Ollama eval_count 归一化）；厂商未返回时缺省 */
  usage?: AiUsage
  /** 原始协议响应（调试用，不含密钥） */
  raw?: unknown
}

/** 连接测试/请求错误归类 */
export type AiErrorKind = 'network' | 'timeout' | 'auth' | 'model' | 'server' | 'config' | 'rateLimit'

/** 连接测试结果 */
export interface AiTestResult {
  ok: boolean
  /** 成功时的往返延迟 ms */
  latencyMs?: number
  errorKind?: AiErrorKind
  errorMessage?: string
}

/**
 * IPC 层统一包装结果：成功带 data，失败带归类错误。
 * 避免依赖 ipcMain.handle 异常序列化（自定义字段 kind 会丢失）。
 */
export type AiResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorKind: AiErrorKind; errorMessage: string }

/** 流式对话过程事件（主进程 → 渲染进程，按 streamId 过滤） */
export type AiStreamEvent =
  | { streamId: string; type: 'delta'; delta: string }
  | { streamId: string; type: 'reasoning'; delta: string }
  /** tool loop 中间态：让用户知道 AI 正在联网/执行工具 */
  | { streamId: string; type: 'tool-start'; name: string; args: Record<string, unknown> }
  | { streamId: string; type: 'tool-end'; name: string; ok: boolean; summary: string }
  | { streamId: string; type: 'done'; response: AiChatResponse }
  | { streamId: string; type: 'error'; errorKind: AiErrorKind; errorMessage: string }

/** 生成提供商 id：时间戳 + 随机段，碰撞概率可忽略 */
function genProviderId(): string {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 从预设创建提供商配置：添加即带出默认端点、密钥申请页与推荐模型（M6 T4） */
export function createPresetProvider(preset: AiProviderPreset): AiProviderConfig {
  return {
    id: genProviderId(),
    name: preset.name,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    apiKey: '',
    apiKeyUrl: preset.apiKeyUrl,
    model: preset.recommendedModel,
    imageModel: preset.recommendedImageModel ?? '',
    maxTokens: 16384,
    temperature: 0.7,
    enabled: true
  }
}

/** 创建自定义大模型厂商（OpenAI 兼容协议，端点/密钥由用户补全） */
export function createCustomProvider(): AiProviderConfig {
  return {
    id: genProviderId(),
    name: '自定义大模型厂商',
    kind: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    apiKeyUrl: '',
    model: '',
    imageModel: '',
    maxTokens: 16384,
    temperature: 0.7,
    enabled: true
  }
}

/**
 * 判断是否为推理（思考型）模型：用于 UI 标记「推理」标签，以及提醒对话链路
 * 预期该模型会返回 reasoning_content（思考过程）。按模型名段匹配，避免误判。
 */
export function isReasoningModel(model: string): boolean {
  if (!model) return false
  const parts = model.toLowerCase().split(/[-_./]/)
  const keywords = ['reasoner', 'reasoning', 'thinking', 'qwq', 'z1', 'r1', 'o1', 'o3', 'o4']
  if (parts.some((p) => keywords.includes(p))) return true
  // Kimi k1.5 等带版本号的推理模型
  if (model.toLowerCase().includes('k1.5')) return true
  return false
}

/**
 * 历史预算随模型窗口缩放的比例：标注窗口后，输入历史预算 = min(上限, 窗口 × 0.5)。
 * 预留另一半给 system prompt / 工具 schema / 输出与截断余量。
 */
export const CONTEXT_BUDGET_WINDOW_RATIO = 0.5

/**
 * 已知窗口时的历史预算上限。大窗口模型（如 1M 上下文的 DeepSeek-V4）此前被 48k/64k
 * 固定上限卡死，多轮 Agent 与外部 Agent 写盘类任务频繁触发压缩。放宽后仍保留窗口 × 0.5
 * 的比例约束，小窗口模型不受影响。
 */
export const CHAT_CONTEXT_TOKEN_CAP = 128_000
export const AGENT_CONTEXT_TOKEN_CAP = 192_000

/** 窗口未标注时的保守回退：维持原固定上限，避免对未知窗口模型灌超长历史 */
export const CHAT_CONTEXT_FALLBACK_CAP = 48_000
export const AGENT_CONTEXT_FALLBACK_CAP = 64_000

/**
 * 解析实际历史预算（聊天与 Agent 两条路径同源）：
 * 窗口未标注（缺省/0/非法值）时回退 fallbackCap（默认同 cap）；标注后按比例收缩，
 * 且不超过 cap。
 */
export function resolveContextBudget(
  contextWindow: number | undefined,
  fixedCap: number,
  fallbackCap: number = fixedCap
): number {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) return fallbackCap
  return Math.min(fixedCap, Math.floor(contextWindow * CONTEXT_BUDGET_WINDOW_RATIO))
}

/** 内置提供商预设（设计文档 3.11.2） */
export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    kind: 'openai-compatible',
    name: '豆包 Doubao',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    recommendedModel: 'doubao-pro-32k',
    recommendedModels: [
      'doubao-pro-32k',
      'doubao-lite-32k',
      'doubao-vision-pro-32k',
      'doubao-embedding'
    ],
    recommendedImageModel: 'doubao-seedream-3-0-t2i-250415'
  },
  {
    kind: 'openai-compatible',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    recommendedModel: 'deepseek-chat',
    // 仅作拉取失败时的兜底；实际可选型号以厂商 /models 实时返回为准
    recommendedModels: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    kind: 'openai-compatible',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    recommendedModel: 'glm-4-flash',
    recommendedModels: ['glm-4-flash', 'glm-4', 'glm-4v', 'glm-z1-flash', 'glm-z1-plus'],
    recommendedImageModel: 'cogview-3'
  },
  {
    kind: 'openai-compatible',
    name: 'Kimi 月之暗面',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
    recommendedModel: 'kimi-k2.5',
    recommendedModels: ['kimi-k2.5', 'kimi-k2', 'kimi-k1.5']
  },
  {
    kind: 'openai-compatible',
    name: '通义千问 Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
    recommendedModel: 'qwen-plus',
    recommendedModels: [
      'qwen-plus',
      'qwen-max',
      'qwen-turbo',
      'qwen-long',
      'qwen3-thinking',
      'qwq-32b',
      'deepseek-r1'
    ]
  },
  {
    kind: 'openai-compatible',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    recommendedModel: 'gpt-4o-mini',
    recommendedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'o3-mini'],
    recommendedImageModel: 'dall-e-3'
  },
  {
    kind: 'ollama',
    name: '本地 Ollama',
    baseUrl: 'http://localhost:11434',
    apiKeyUrl: '',
    recommendedModel: ''
  }
]
