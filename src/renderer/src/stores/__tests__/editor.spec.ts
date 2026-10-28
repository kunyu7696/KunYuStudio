/**
 * editor store 流式揭示标记（T2.5）测试。
 * streamReveal：agent file-written 后置「按行渐进铺开」标记，CodeEditor 挂载/内容
 * watch 消费；TTL 4s 过期丢弃（防 FS 事件竞态导致的残留标记误播动画）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '../editor'

const PATH = 'D:/p/src/main/java/A.java'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('stream 标记：request / peek / consume', () => {
  it('request 后 peek 与 consume 均为 true', () => {
    const s = useEditorStore()
    expect(s.peekStreamReveal(PATH)).toBe(false)
    s.requestStreamReveal(PATH)
    expect(s.peekStreamReveal(PATH)).toBe(true)
    expect(s.consumeStreamReveal(PATH)).toBe(true)
  })

  it('consume 一次性：再次 consume/peek 返回 false（标记已删除）', () => {
    const s = useEditorStore()
    s.requestStreamReveal(PATH)
    expect(s.consumeStreamReveal(PATH)).toBe(true)
    expect(s.consumeStreamReveal(PATH)).toBe(false)
    expect(s.peekStreamReveal(PATH)).toBe(false)
  })

  it('peek 不消费标记（createEditor 决定初始值后仍可由 onMounted 消费）', () => {
    const s = useEditorStore()
    s.requestStreamReveal(PATH)
    expect(s.peekStreamReveal(PATH)).toBe(true)
    expect(s.peekStreamReveal(PATH)).toBe(true)
    expect(s.consumeStreamReveal(PATH)).toBe(true)
  })

  it('无标记的路径 consume/peek 均为 false', () => {
    const s = useEditorStore()
    expect(s.peekStreamReveal('D:/p/Other.java')).toBe(false)
    expect(s.consumeStreamReveal('D:/p/Other.java')).toBe(false)
  })

  it('重复 request 刷新时间戳（防抖后只播最新一次）', () => {
    const s = useEditorStore()
    s.requestStreamReveal(PATH)
    vi.setSystemTime(new Date('2026-10-18T12:00:03Z')) // +3s
    s.requestStreamReveal(PATH)
    vi.setSystemTime(new Date('2026-10-18T12:00:05.5Z')) // 距第二次 +2.5s（距第一次 +5.5s）
    expect(s.consumeStreamReveal(PATH)).toBe(true)
  })
})

describe('stream 标记：TTL 过期', () => {
  it('TTL 内（3.9s）仍有效', () => {
    const s = useEditorStore()
    s.requestStreamReveal(PATH)
    vi.setSystemTime(new Date('2026-10-18T12:00:03.9Z'))
    expect(s.peekStreamReveal(PATH)).toBe(true)
    expect(s.consumeStreamReveal(PATH)).toBe(true)
  })

  it('超过 TTL（4.1s）后 peek false、consume 丢弃标记并返回 false', () => {
    const s = useEditorStore()
    s.requestStreamReveal(PATH)
    vi.setSystemTime(new Date('2026-10-18T12:00:04.1Z'))
    expect(s.peekStreamReveal(PATH)).toBe(false)
    expect(s.consumeStreamReveal(PATH)).toBe(false)
    // 过期标记已被 consume 删除，不会残留
    expect(s.streamReveal[PATH]).toBeUndefined()
  })

  it('恰好等于 TTL（4.0s）视为过期', () => {
    const s = useEditorStore()
    s.requestStreamReveal(PATH)
    vi.setSystemTime(new Date('2026-10-18T12:00:04Z'))
    expect(s.consumeStreamReveal(PATH)).toBe(false)
  })
})

describe('图片标签：二进制预览', () => {
  const PNG_PATH = 'D:/p/src/main/resources/assets/icon.png'
  const readBinary = vi.fn()
  const readFile = vi.fn()

  beforeEach(() => {
    readBinary.mockReset()
    readFile.mockReset()
    ;(window as unknown as { api: unknown }).api = { fs: { readBinary, readFile } }
    readBinary.mockResolvedValue({
      path: PNG_PATH,
      dataBase64: Buffer.from('fake-png-bytes').toString('base64'),
      mime: 'image/png',
      size: 14,
      mtime: 123
    })
  })

  it('png 走 readBinary 建只读预览标签，不触碰文本读取', async () => {
    const s = useEditorStore()
    await s.openFile({ path: PNG_PATH, name: 'icon.png', kind: 'file', ext: 'png', size: 14, mtime: 0 })
    const tab = s.tabs.find((t) => t.path === PNG_PATH)
    expect(tab).toBeDefined()
    expect(tab!.imageDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(tab!.content).toBe('')
    expect(tab!.dirty).toBe(false)
    expect(readBinary).toHaveBeenCalledWith(PNG_PATH)
    expect(readFile).not.toHaveBeenCalled()
  })

  it('java 仍走文本读取，不建图片标签', async () => {
    readFile.mockResolvedValue({ path: PATH, content: 'class A {}', encoding: 'utf-8', mtime: 5 })
    const s = useEditorStore()
    await s.openFile({ path: PATH, name: 'A.java', kind: 'file', ext: 'java', size: 10, mtime: 0 })
    const tab = s.tabs.find((t) => t.path === PATH)
    expect(tab!.imageDataUrl).toBeUndefined()
    expect(tab!.content).toBe('class A {}')
    expect(readBinary).not.toHaveBeenCalled()
  })

  it('图片标签 save 直接跳过（只读）', async () => {
    const s = useEditorStore()
    await s.openFile({ path: PNG_PATH, name: 'icon.png', kind: 'file', ext: 'png', size: 14, mtime: 0 })
    await s.save(PNG_PATH)
    // 无写文件通道被调用即通过（api mock 里没有 writeFile）
    expect(s.tabs.find((t) => t.path === PNG_PATH)!.dirty).toBe(false)
  })
})
