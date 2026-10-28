/**
 * aiChat 对话作用域隔离测试：AI 助手对话随项目开启/关闭切换作用域
 * （打开项目只看得到该项目的会话，回主页只看得到「无项目」的会话），
 * 避免跨项目混用对话与任务。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAiChatStore } from '../aiChat'

const NO_PROJECT_KEY = 'kunyu:ai-chat-sessions'
const scopeKey = (id: string): string => `kunyu:ai-chat-sessions:${id}`

/** window.api 打桩：切换作用域会中断进行中的流（调 ai.chatStop） */
const chatStop = vi.fn().mockResolvedValue(undefined)

function seedMessage(content: string): void {
  const chat = useAiChatStore()
  chat.ensureSession()
  chat.entries.push({ id: `msg-${content}`, role: 'user', content })
  chat.syncActive(true)
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  ;(window as unknown as { api: { ai: { chatStop: typeof chatStop } } }).api = {
    ai: { chatStop }
  }
  chatStop.mockClear()
})

describe('aiChat 作用域隔离（对话随项目开启）', () => {
  it('默认作用域为「无项目」，会话写入无后缀的键', () => {
    const chat = useAiChatStore()
    expect(chat.scopeKey).toBe('__none__')
    seedMessage('主页的问题')
    expect(localStorage.getItem(NO_PROJECT_KEY)).toContain('主页的问题')
    expect(localStorage.getItem(scopeKey('pA'))).toBeNull()
  })

  it('切换项目后载入该项目自己的会话，项目会话互不可见', () => {
    const chat = useAiChatStore()
    seedMessage('主页的问题')

    chat.switchScope('pA')
    expect(chat.scopeKey).toBe('pA')
    // 新项目作用域下没有主页的会话
    expect(chat.sessions.length).toBe(0)
    expect(chat.entries).toEqual([])
    seedMessage('A 项目的问题')

    chat.switchScope('pB')
    expect(chat.entries).toEqual([])
    seedMessage('B 项目的问题')

    // 回到 A：只恢复 A 的会话，B 与主页的数据不串入
    chat.switchScope('pA')
    expect(chat.sessions.length).toBe(1)
    expect(chat.entries.map((e) => e.content)).toEqual(['A 项目的问题'])
    expect(localStorage.getItem(scopeKey('pA'))).toContain('A 项目的问题')
    expect(localStorage.getItem(scopeKey('pA'))).not.toContain('B 项目的问题')
    expect(localStorage.getItem(scopeKey('pB'))).toContain('B 项目的问题')
  })

  it('回到主页作用域恢复主页会话，不被项目会话污染', () => {
    const chat = useAiChatStore()
    seedMessage('主页的问题')
    chat.switchScope('pA')
    seedMessage('A 项目的问题')

    chat.switchScope(null)

    expect(chat.scopeKey).toBe('__none__')
    expect(chat.entries.map((e) => e.content)).toEqual(['主页的问题'])
  })

  it('切换作用域会中断进行中的流式请求（丢弃晚到增量）', () => {
    const chat = useAiChatStore()
    chat.activeStreamId = 'stream-old'
    const seqBefore = chat.seq

    chat.switchScope('pA')

    expect(chat.activeStreamId).toBeNull()
    expect(chatStop).toHaveBeenCalledWith('stream-old')
    expect(chat.seq).toBeGreaterThan(seqBefore)
    expect(chat.sending).toBe(false)
  })

  it('同一作用域重复调用是 no-op，不清空当前会话', () => {
    const chat = useAiChatStore()
    chat.switchScope('pA')
    seedMessage('A 项目的问题')
    const before = chat.entries

    chat.switchScope('pA')

    expect(chat.entries).toBe(before)
  })
})
