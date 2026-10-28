import type { AiProviderConfig } from '../../../../../shared/types/ai'

// ---------- 版本矩阵健康度（技术债 #7） ----------
export interface MatrixHealthRow {
  loader: string
  mcVersion: string
  templateCount: number
  verifiedCount: number
  passRate: number
  lastVerifiedAt: string | null
  health: string
}

// ---------- 内置 observer 探针注入 ----------
export interface ObserverStatusState {
  available: boolean
  version: string | null
  injected: boolean
  modsDir: string | null
}

// ---------- 测试状态 ----------
export interface TestState {
  status: 'ok' | 'fail' | 'testing'
  latencyMs?: number
  errorMessage?: string
}

// ---------- 三栏草稿模型 ----------
/** 栏内编辑草稿：apiKeyInput 空串表示不修改已存密钥；persisted=false 表示尚未写入设置 */
export interface ProviderDraft {
  id: string
  kind: AiProviderConfig['kind']
  name: string
  baseUrl: string
  apiKeyUrl: string
  model: string
  /** 图像生成模型（贴图工坊 AI 重绘用，空串=不支持/不启用） */
  imageModel: string
  maxTokens: number
  /** 模型上下文窗口（token 数；0 = 未标注，历史预算回退固定上限） */
  contextWindow: number
  temperature: number
  apiKeyInput: string
  hasKey: boolean
  clearKey: boolean
  persisted: boolean
}

/** 编辑弹窗草稿 */
export interface McpServerDraft {
  id: string
  name: string
  command: string
  argsLine: string
  envLine: string
  enabled: boolean
  timeoutMs: number
}
