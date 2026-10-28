/**
 * A3 离线模型预置流水线的跨进程 DTO。
 * 主进程 service、IPC 契约与渲染层共用，避免三处漂移。
 */

/** 模型资产状态（与 model_assets.status 列一一对应） */
export type ModelAssetStatus = 'missing' | 'downloading' | 'ready' | 'failed'

/** kbRag 嵌入后端路由状态（语义检索是否离线可用） */
export type EmbedBackend = 'idle' | 'downloading' | 'embedded-ready' | 'fallback-keyword'

/** 单个预置模型的清单元数据（不含运行态） */
export interface PresetModelInfo {
  /** HuggingFace 模型 id（xenova 缓存目录也按此组织） */
  id: string
  /** 展示名 */
  name: string
  /** 用途描述 */
  description: string
  /** 预计下载体积（字节，仅用于 UI 预估展示） */
  estimatedSizeBytes: number
}

/** models:list 返回的单模型运行态视图 */
export interface ModelAssetDto extends PresetModelInfo {
  status: ModelAssetStatus
  /** 文件系统完整性检查结论（存在性） */
  cached: boolean
  /** 已落盘字节数（prefetch 成功后统计） */
  sizeBytes: number
  error: string | null
  updatedAt: number
}

export interface ModelListResult {
  models: ModelAssetDto[]
  /** kbRag 当前嵌入后端状态；RAG 未初始化过时为 null */
  kbBackend: EmbedBackend | null
}

/** kbRag 单个语料根的统计 */
export interface KbRagRootStat {
  alias: string
  files: number
  chunks: number
}

/** kbRag 索引完整状态（知识库状态面板 / ai:kb-rag-status） */
export interface KbRagStatus {
  /** 向量检索是否已就绪（模型已加载且语料已编码） */
  ready: boolean
  /** 未就绪原因（模型下载中 / 失败降级 等） */
  reason?: string
  model?: string
  chunks: number
  files: number
  /**
   * A3 离线路由状态：idle（尚未初始化）→ downloading（模型加载/语料编码中）
   * → embedded-ready（向量可用）/ fallback-keyword（失败降级为关键词检索）
   */
  backend: EmbedBackend
  /** 各语料根的文件/块分布 */
  roots: KbRagRootStat[]
  /** 向量缓存落盘字节数（无缓存为 0） */
  cacheBytes: number
  /** 是否正在监听语料目录热重载 */
  watching: boolean
}

/** 主→渲染进度事件（aiRuntime:model-event） */
export interface ModelProvisionEvent {
  modelId: string
  status: 'downloading' | 'done' | 'failed'
  /** 当前文件进度 0..100（xenova 逐文件回调，未知总量时缺省） */
  progress?: number
  loadedBytes?: number
  totalBytes?: number
  /** 当前正在下载的文件名（相对模型目录） */
  file?: string
  error?: string
}
