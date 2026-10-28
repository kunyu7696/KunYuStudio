import { defineStore } from 'pinia'
import type { ChatAttachment, ChatEntry, ChatMessage, ToolActivity } from '../../../shared/types/ai'
import { CHAT_CONTEXT_FALLBACK_CAP, CHAT_CONTEXT_TOKEN_CAP, resolveContextBudget } from '../../../shared/types/ai'
import { useSettingsStore } from './settings'
import { useProjectStore } from './project'
import { useEditorStore } from './editor'
import { useBuildStore } from './build'
import { useExplorerStore } from './explorer'
import { buildChatContextBlock } from '../utils/chatContext'
import { buildPromptWithDocs, toDisplayAttachment } from '../utils/attachment'

/** T7.4：多会话持久化；按项目作用域隔离——无项目（主页）用 '__none__'，作用域后缀为空 */
const SESSIONS_KEY = 'kunyu:ai-chat-sessions'
const ACTIVE_KEY = 'kunyu:ai-chat-active'
const SCOPE_NONE = '__none__'
/** 旧版单流水历史（仅用于首次迁移） */
const LEGACY_HISTORY_KEY = 'kunyu:ai-chat-history'
/** 每个会话持久化最多保留的最近消息条数，避免 localStorage 膨胀 */
const MAX_PERSISTED = 50
const MAX_SESSIONS = 100

/**
 * 对话历史 token 预算（估算）：只裁「历史消息」，system 与本次提问始终保留。
 * 上限随模型窗口缩放：已标注 contextWindow 的模型按 min(128k, 窗口×50%)；
 * 未标注窗口时回退保守的 48k，避免对未知窗口模型发送超长历史。
 */
const CJK_RE = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g

/** 粗略 token 估算：CJK 按 1 token/字，其余按 1 token/4 字符（与主进程 historyBudget 同口径） */
function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK_RE)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}

/** 从最旧消息开始丢弃，直到历史估算 token 进入预算；返回按原顺序的消息与被丢弃条数 */
function trimHistoryToBudget(
  history: ChatMessage[],
  budgetTokens: number = CHAT_CONTEXT_FALLBACK_CAP
): { messages: ChatMessage[]; dropped: number } {
  let total = 0
  const kept: ChatMessage[] = []
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(history[i].content ?? '')
    if (kept.length > 0 && total + cost > budgetTokens) break
    kept.unshift(history[i])
    total += cost
  }
  return { messages: kept, dropped: history.length - kept.length }
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
function genEntryId(): string {
  return genId('msg')
}
function genSessionId(): string {
  return genId('sess')
}

/** 作用域存储键：无项目作用域沿用原键名（旧数据自动成为「无项目」作用域的会话） */
function scopeSuffix(scopeKey: string): string {
  return scopeKey === SCOPE_NONE ? '' : `:${scopeKey}`
}
function sessionsKeyOf(scopeKey: string): string {
  return `${SESSIONS_KEY}${scopeSuffix(scopeKey)}`
}
function activeKeyOf(scopeKey: string): string {
  return `${ACTIVE_KEY}${scopeSuffix(scopeKey)}`
}

const SYSTEM_PROMPT =
  '你是 KunYu Studio 内置的 AI 助手，服务于 Minecraft Java 版模组开发，' +
  '覆盖 Fabric（Loom/Yarn，Java 17）、Forge（ForgeGradle/Mojmaps，Java 17）、' +
  'NeoForge（ModDevGradle/Mojmaps，Java 21）三种加载器与 Gradle 构建体系。' +
  '回答简洁专业，优先给出可直接使用的代码与文件路径建议；' +
  '代码风格必须与用户当前工程的加载器和映射一致；不确定时明确说明。'

/**
 * KunYuStudio 应用能力清单（AI 自我认知语料）：main 从参考包 kunyu_capabilities.md 读取经 IPC 下发。
 * undefined=未拉取；null=参考包缺失/拉取失败（静默缺省，不阻断问答）。
 * 首次发送前拉一次并常驻缓存——清单是静态文档，随应用更新才变化。
 */
let kunyuCapabilitiesCache: string | null | undefined

async function loadKunyuCapabilities(): Promise<string | null> {
  if (kunyuCapabilitiesCache !== undefined) return kunyuCapabilitiesCache
  try {
    kunyuCapabilitiesCache = (await window.api.ai.kunyuCapabilities()) ?? null
  } catch {
    kunyuCapabilitiesCache = null
  }
  return kunyuCapabilitiesCache
}

export interface ChatSession {
  id: string
  title: string
  /** true 时标题随首条用户消息自动生成；用户重命名后置 false */
  autoTitle: boolean
  createdAt: number
  updatedAt: number
  entries: ChatEntry[]
}

function isChatEntry(m: unknown): m is ChatEntry {
  return (
    typeof m === 'object' &&
    m !== null &&
    (((m as ChatEntry).role === 'user' || (m as ChatEntry).role === 'assistant') &&
      typeof (m as ChatEntry).content === 'string' &&
      !(m as ChatEntry).pending)
  )
}

function isDisplayAttachment(a: unknown): a is ChatAttachment {
  if (typeof a !== 'object' || a === null) return false
  const x = a as Record<string, unknown>
  return (x.kind === 'image' || x.kind === 'doc') && typeof x.name === 'string'
}

/** 持久化回填时只保留展示字段，剔除任何混入的原始 dataUrl/文档文本 */
function sanitizeAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const list = value.filter(isDisplayAttachment).map((a) => toDisplayAttachment(a))
  return list.length > 0 ? list : undefined
}

function normalizeEntries(list: unknown): ChatEntry[] {
  if (!Array.isArray(list)) return []
  return list.filter(isChatEntry).map((m) => ({
    id: m.id || genEntryId(),
    role: m.role,
    content: m.content,
    error: typeof m.error === 'string' ? m.error : undefined,
    attachments: sanitizeAttachments((m as ChatEntry).attachments)
  }))
}

function deriveTitle(entries: ChatEntry[]): string {
  const firstUser = entries.find((e) => e.role === 'user' && e.content.trim())
  if (!firstUser) return '新会话'
  const t = firstUser.content.replace(/\s+/g, ' ').trim()
  return t.length > 24 ? `${t.slice(0, 24)}…` : t
}

function persistSessions(scopeKey: string, sessions: ChatSession[], activeId: string | null): void {
  try {
    localStorage.setItem(
      sessionsKeyOf(scopeKey),
      JSON.stringify(sessions.slice(0, MAX_SESSIONS))
    )
    if (activeId) localStorage.setItem(activeKeyOf(scopeKey), activeId)
    else localStorage.removeItem(activeKeyOf(scopeKey))
  } catch {
    // localStorage 超额等异常：内存状态仍可用
  }
}

interface LoadResult {
  sessions: ChatSession[]
  activeId: string | null
}

function loadSessions(scopeKey: string): LoadResult {
  let sessions: ChatSession[] = []
  try {
    const raw = localStorage.getItem(sessionsKeyOf(scopeKey))
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        sessions = parsed
          .filter((s): s is ChatSession => typeof s === 'object' && s !== null && typeof (s as ChatSession).id === 'string')
          .map((s) => ({
            id: s.id,
            title: typeof s.title === 'string' && s.title ? s.title : '新会话',
            autoTitle: s.autoTitle !== false,
            createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
            updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
            entries: normalizeEntries(s.entries)
          }))
      }
    }
  } catch {
    sessions = []
  }

  // 旧版单流水迁移：仅「无项目」作用域首次启动时导入为一个会话
  if (sessions.length === 0 && scopeKey === SCOPE_NONE) {
    const legacy = normalizeEntries(
      (() => {
        try {
          const raw = localStorage.getItem(LEGACY_HISTORY_KEY)
          return raw ? JSON.parse(raw) : []
        } catch {
          return []
        }
      })()
    )
    if (legacy.length > 0) {
      const now = Date.now()
      sessions = [
        {
          id: genSessionId(),
          title: deriveTitle(legacy) || '历史对话',
          autoTitle: true,
          createdAt: now,
          updatedAt: now,
          entries: legacy
        }
      ]
      try {
        localStorage.removeItem(LEGACY_HISTORY_KEY)
      } catch {
        // ignore
      }
    }
  }

  let activeId: string | null = null
  try {
    activeId = localStorage.getItem(activeKeyOf(scopeKey))
  } catch {
    activeId = null
  }
  if (!activeId || !sessions.some((s) => s.id === activeId)) {
    activeId = sessions[0]?.id ?? null
  }
  return { sessions, activeId }
}

/**
 * AI 助手对话 store：服务于主界面右侧 AI 助手面板（随项目开启，见 App.vue）。
 * T7.4：多会话（新建/切换/重命名/删除/导出 Markdown），localStorage 持久化；
 * 会话按项目作用域隔离（`switchScope`）：打开项目只看到该项目的会话，
 * 回到主页看到「无项目」作用域的会话，避免跨项目混用对话与任务。
 * `entries` 始终是当前会话的工作数组，组件侧原有读写方式不变。
 * 厂商/密钥/默认提供商全部来自 settings store，本 store 不持有配置。
 */
export const useAiChatStore = defineStore('aiChat', {
  state: () => {
    const initial = loadSessions(SCOPE_NONE)
    return {
      /** 当前会话作用域：项目 id，或 SCOPE_NONE（无项目/主页） */
      scopeKey: SCOPE_NONE,
      sessions: initial.sessions as ChatSession[],
      activeSessionId: initial.activeId as string | null,
      entries: (initial.activeId
        ? initial.sessions.find((s) => s.id === initial.activeId)?.entries ?? []
        : []) as ChatEntry[],
      sending: false,
      /** 中断后丢弃晚到响应的递增序号 */
      seq: 0,
      /** 进行中的流式请求 id（用于 chatStop 中断上游连接） */
      activeStreamId: null as string | null
    }
  },

  getters: {
    activeSession(state): ChatSession | null {
      return state.sessions.find((s) => s.id === state.activeSessionId) ?? null
    },
    /** 侧边列表按最近更新倒序 */
    sortedSessions(state): ChatSession[] {
      return [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt)
    }
  },

  actions: {
    /**
     * 切换对话作用域（随项目开启/关闭，见 App.vue）：
     * 先把当前作用域的会话落盘，再载入目标作用域的会话列表与当前会话——
     * 打开项目只看得到该项目的对话，回到主页只看得到「无项目」的对话。
     * 进行中的流式请求会被中断（避免上一项目的增量写进新作用域）。
     * 传 null 表示无项目作用域。
     */
    switchScope(projectId: string | null): void {
      const key = projectId ?? SCOPE_NONE
      if (key === this.scopeKey) return
      this.syncActive()
      persistSessions(this.scopeKey, this.sessions, this.activeSessionId)
      this.seq++
      this.sending = false
      this.abortActiveStream()
      const initial = loadSessions(key)
      this.scopeKey = key
      this.sessions = initial.sessions
      this.activeSessionId = initial.activeId
      this.entries = initial.activeId
        ? (initial.sessions.find((s) => s.id === initial.activeId)?.entries ?? []).map((e) => ({
            ...e
          }))
        : []
    },

    /** 确保存在一个当前会话（发送前调用） */
    ensureSession(): string {
      if (!this.activeSessionId) {
        return this.newSession()
      }
      return this.activeSessionId
    },

    /** 中断进行中的上游流式连接（不改变气泡展示） */
    abortActiveStream(): void {
      const id = this.activeStreamId
      this.activeStreamId = null
      if (id) void window.api.ai.chatStop(id)
    },

    /** 把 entries 回写到当前会话并持久化（剔除 pending 占位） */
    syncActive(touch = false): void {
      const s = this.sessions.find((x) => x.id === this.activeSessionId)
      if (!s) return
      s.entries = this.entries.filter((e) => !e.pending).slice(-MAX_PERSISTED)
      if (s.autoTitle) s.title = deriveTitle(s.entries)
      if (touch || s.entries.length > 0) s.updatedAt = Date.now()
      persistSessions(this.scopeKey, this.sessions, this.activeSessionId)
    },

    newSession(): string {
      this.seq++
      this.sending = false
      this.abortActiveStream()
      const now = Date.now()
      const session: ChatSession = {
        id: genSessionId(),
        title: '新会话',
        autoTitle: true,
        createdAt: now,
        updatedAt: now,
        entries: []
      }
      this.sessions.unshift(session)
      this.activeSessionId = session.id
      this.entries = []
      persistSessions(this.scopeKey, this.sessions, this.activeSessionId)
      return session.id
    },

    selectSession(id: string): void {
      if (id === this.activeSessionId) return
      const target = this.sessions.find((s) => s.id === id)
      if (!target) return
      this.seq++
      this.sending = false
      this.abortActiveStream()
      this.syncActive()
      this.activeSessionId = id
      this.entries = target.entries.map((e) => ({ ...e }))
      persistSessions(this.scopeKey, this.sessions, this.activeSessionId)
    },

    renameSession(id: string, title: string): void {
      const s = this.sessions.find((x) => x.id === id)
      if (!s) return
      const t = title.trim()
      if (!t) return
      s.title = t
      s.autoTitle = false
      persistSessions(this.scopeKey, this.sessions, this.activeSessionId)
    },

    removeSession(id: string): void {
      const idx = this.sessions.findIndex((s) => s.id === id)
      if (idx < 0) return
      this.seq++
      this.sending = false
      this.abortActiveStream()
      this.sessions.splice(idx, 1)
      if (this.activeSessionId === id) {
        if (this.sessions.length > 0) {
          const next = this.sortedSessions[0]
          this.activeSessionId = next.id
          this.entries = next.entries.map((e) => ({ ...e }))
        } else {
          // 删除最后一个会话：自动新建空白会话，保证面板始终可发送
          this.newSession()
          return
        }
      }
      persistSessions(this.scopeKey, this.sessions, this.activeSessionId)
    },

    /** 清空当前会话的消息（会话本身保留） */
    clearCurrent(): void {
      this.seq++
      this.sending = false
      this.abortActiveStream()
      this.entries = []
      this.syncActive(true)
    },

    /** 生成会话的 Markdown 导出文本 */
    sessionMarkdown(id: string): { title: string; markdown: string } | null {
      const s = this.sessions.find((x) => x.id === id)
      if (!s) return null
      const lines: string[] = [`# ${s.title}`, '']
      lines.push(`> 导出时间：${new Date().toLocaleString()}`)
      lines.push('')
      for (const e of s.entries) {
        if (e.role === 'user') lines.push('## 🙋 我', '')
        else lines.push('## 🤖 AI 助手', '')
        lines.push(e.content || '（空）', '')
        if (e.error) lines.push(`> ⚠️ ${e.error}`, '')
      }
      return { title: s.title, markdown: lines.join('\n') }
    },

    /**
     * 组装发给主进程的消息：系统提示（含 T7.2 实时工程上下文）+ 已有完整对话 + 新提问。
     * 上下文在发送瞬间从 project/editor/build/explorer store 快照生成，不进入历史持久化。
     */
    buildMessages(prompt: string, images?: string[], contextWindow?: number): ChatMessage[] {
      const history: ChatMessage[] = this.entries
        .filter((e) => !e.pending && !e.error && e.content)
        .map((e) => ({ role: e.role, content: e.content }))

      let systemContent = SYSTEM_PROMPT
      // 自我认知语料常驻拼接（有无项目都要能答「KunYuStudio 有哪些功能」）
      const capabilities = kunyuCapabilitiesCache
      if (capabilities) systemContent += `\n\n${capabilities}`
      try {
        const project = useProjectStore().currentProject
        if (project) {
          const editor = useEditorStore()
          const buildStore = useBuildStore()
          const explorer = useExplorerStore()
          const tab = editor.activeTab
          const block = buildChatContextBlock({
            project: {
              name: project.name,
              type: project.type,
              loader: project.loader,
              mcVersion: project.mcVersion,
              modId: project.modId,
              path: project.path
            },
            activeFile: tab
              ? { path: tab.path, language: tab.language, content: tab.content, dirty: tab.dirty }
              : undefined,
            selection: editor.activeSelection
              ? {
                  path: editor.activeSelection.path,
                  startLine: editor.activeSelection.startLine,
                  endLine: editor.activeSelection.endLine,
                  text: editor.activeSelection.text
                }
              : undefined,
            structureRoot: explorer.rootNode,
            problems: buildStore.problems,
            lastBuild: buildStore.lastResult
              ? {
                  ok: buildStore.lastResult.ok,
                  statusText: buildStore.statusText
                }
              : null
          })
          if (block) systemContent += `\n\n${block}`
        }
      } catch {
        // 上下文组装失败不应阻断问答：退化为纯系统提示
      }

      // 历史被裁剪时给模型一句明示，避免它对「更早对话」的内容产生幻觉
      // 预算随模型窗口缩放——标注 contextWindow 后按 min(128k, 窗口×50%) 收缩
      const trimmed = trimHistoryToBudget(
        history,
        resolveContextBudget(contextWindow, CHAT_CONTEXT_TOKEN_CAP, CHAT_CONTEXT_FALLBACK_CAP)
      )
      const dropNote =
        trimmed.dropped > 0
          ? [
              {
                role: 'system' as const,
                content: `（注：本次对话更早的 ${trimmed.dropped} 条消息因超出上下文预算未随请求发送，如需引用请用户重述。）`
              }
            ]
          : []

      return [
        { role: 'system', content: systemContent },
        ...dropNote,
        ...trimmed.messages,
        { role: 'user', content: prompt, images: images && images.length > 0 ? images : undefined }
      ]
    },

    /** 发送一条消息（可携带图片/文档附件）；无可用厂商/正在发送时返回错误文案，成功返回 null */
    async send(prompt: string, attachments: ChatAttachment[] = []): Promise<string | null> {
      const text = prompt.trim()
      const docs = attachments.filter((a) => a.kind === 'doc')
      const images = attachments.filter((a) => a.kind === 'image').map((a) => a.dataUrl ?? '')
      const hasImage = images.some((u) => u.length > 0)
      if ((!text && attachments.length === 0) || this.sending) return null
      // 文档内容拼入请求文本；纯图片消息给模型一个默认引导语
      let enriched = buildPromptWithDocs(text, docs)
      if (!enriched.trim() && hasImage) enriched = '请查看我上传的图片并回答。'
      this.ensureSession()
      const settings = useSettingsStore()
      const id = settings.ai.defaultProviderId
      const provider = id ? settings.ai.providers.find((p) => p.id === id) : undefined
      if (!provider) return '尚未配置默认 AI 厂商，请先在设置中添加并设为默认'
      if (!provider.enabled) return '默认 AI 厂商已被停用，请先启用或另设默认'
      if (!provider.baseUrl) return '该厂商未配置 API 端点'
      const isLocalEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(provider.baseUrl)
      if (provider.kind === 'openai-compatible' && !provider.apiKey && !isLocalEndpoint) return '该厂商未配置 API Key'
      if (!provider.model) return '该厂商未设置模型名称'

      const seq = ++this.seq
      const streamId = genId('stream')
      const startedAt = Date.now()
      this.activeStreamId = streamId
      this.sending = true
      // 首次发送前拉取 KunYuStudio 能力清单（自我认知语料），后续走缓存
      await loadKunyuCapabilities()
      this.entries.push({
        id: genEntryId(),
        role: 'user',
        content: text,
        attachments: attachments.length > 0 ? attachments.map(toDisplayAttachment) : undefined
      })
      const pendingId = genEntryId()
      this.entries.push({ id: pendingId, role: 'assistant', content: '', pending: true })
      this.syncActive(true)

      // t71s：增量直接写入 pending 气泡；Markdown 在渲染层随 content 变化逐帧重渲染
      // 思考块：reasoning_content 增量实时进入折叠块，首个正文增量到达时定格思考耗时
      const res = await window.api.ai.chatStream(
        streamId,
        {
          providerId: provider.id,
          messages: this.buildMessages(enriched, images, provider.contextWindow)
        },
        (delta) => {
          if (seq !== this.seq) return
          const target = this.entries.find((e) => e.id === pendingId)
          if (target) {
            target.pending = false
            target.content += delta
            if (target.reasoning && !target.reasoningMs) target.reasoningMs = Date.now() - startedAt
          }
        },
        (delta) => {
          if (seq !== this.seq) return
          const target = this.entries.find((e) => e.id === pendingId)
          if (target) {
            target.pending = false
            target.reasoning = (target.reasoning ?? '') + delta
          }
        },
        // tool loop 中间态：让气泡显示「🔧 正在联网...」等
        (name, args) => {
          if (seq !== this.seq) return
          const target = this.entries.find((e) => e.id === pendingId)
          if (!target) return
          const argsSummary = summarizeToolArgs(name, args)
          const act: ToolActivity = {
            name,
            status: 'running',
            argsSummary,
            startedAt: Date.now()
          }
          target.toolActivities = [...(target.toolActivities ?? []), act]
        },
        (name, ok, summary) => {
          if (seq !== this.seq) return
          const target = this.entries.find((e) => e.id === pendingId)
          if (!target || !target.toolActivities) return
          // 找到 running 的那个并更新
          const last = [...target.toolActivities].reverse().find((a) => a.name === name && a.status === 'running')
          if (last) {
            last.status = ok ? 'done' : 'failed'
            last.summary = summary
            last.endedAt = Date.now()
          }
        }
      )

      // 中断或已被更新的请求覆盖：晚到结果直接丢弃
      if (seq !== this.seq) return null
      const target = this.entries.find((e) => e.id === pendingId)
      if (res.ok) {
        if (target) {
          target.pending = false
          if (!target.content) target.content = res.data.content || '（空回复）'
          if (target.reasoning && !target.reasoningMs) target.reasoningMs = Date.now() - startedAt
        }
      } else {
        if (target) {
          // 已有增量文本时保留已生成内容，仅在完全没收到内容时显示错误条
          if (target.content) {
            target.pending = false
          } else {
            target.pending = false
            target.content = ''
            target.error = res.errorMessage
          }
        }
      }
      this.sending = false
      this.activeStreamId = null
      this.syncActive()
      return null
    },

    /** 中断当前请求：abort 上游连接，已生成内容保留在气泡中 */
    stop(): void {
      const streamId = this.activeStreamId
      this.seq++
      this.sending = false
      this.activeStreamId = null
      if (streamId) void window.api.ai.chatStop(streamId)
      const pending = this.entries.find((e) => e.pending)
      if (pending) {
        pending.pending = false
        if (!pending.content) {
          pending.content = ''
          pending.error = '已中断'
        }
      }
      this.syncActive()
    },

    /** @deprecated 使用 clearCurrent；保留以兼容旧调用 */
    clear(): void {
      this.clearCurrent()
    }
  }
})

/** 根据 tool name + args 生成简短摘要，给气泡显示用 */
function summarizeToolArgs(name: string, args: Record<string, unknown>): string | undefined {
  switch (name) {
    case 'web_fetch': {
      const url = (args.url as string) ?? ''
      return url ? `抓 ${url.replace(/^https?:\/\//, '').slice(0, 60)}` : undefined
    }
    case 'market_search_mods': {
      const q = (args.query as string) ?? ''
      const src = (args.source as string) ?? ''
      return q ? `搜 ${src || 'Modrinth'}：${q}` : undefined
    }
    case 'kb_search': {
      const q = (args.query as string) ?? ''
      return q ? `查知识库：${q}` : undefined
    }
    case 'image_generate':
      return '生成图片…'
    default:
      return undefined
  }
}

