import { describe, expect, it } from 'vitest'
import { parsePlanDraft } from '../plannerService'

describe('parsePlanDraft', () => {
  it('解析标准 JSON', () => {
    const raw = JSON.stringify({
      suggestedName: '规则异变',
      summary: '在 Minecraft 中重建一座遵守规则才能生存的动物园。',
      ideas: [
        { title: '三册动态守则', description: '开局给游客守则，入职后解锁员工守则。', recommended: true },
        { title: '单册游客守则', description: '只保留游客守则一本规则。', recommended: false }
      ]
    })
    const draft = parsePlanDraft(raw)
    expect(draft).not.toBeNull()
    expect(draft!.suggestedName).toBe('规则异变')
    expect(draft!.summary).toContain('动物园')
    expect(draft!.ideas).toHaveLength(2)
    expect(draft!.ideas[0].recommended).toBe(true)
    expect(draft!.ideas[0].id).toBe('idea-1')
  })

  it('容忍代码围栏与首尾杂质', () => {
    const raw =
      '好的，这是规划：\n```json\n{"suggestedName":"南瓜灯","summary":"加一个魔法南瓜灯。",' +
      '"ideas":[{"title":"发光","description":"右键照亮。","recommended":true}]}\n```\n以上。'
    const draft = parsePlanDraft(raw)
    expect(draft).not.toBeNull()
    expect(draft!.ideas).toHaveLength(1)
  })

  it('recommended 缺失或非 true 时按 false 处理', () => {
    const raw = JSON.stringify({
      summary: '概要',
      ideas: [{ title: 'A', description: 'd' }]
    })
    const draft = parsePlanDraft(raw)
    expect(draft!.ideas[0].recommended).toBe(false)
    expect(draft!.suggestedName).toBe('')
  })

  it('丢弃坏 idea 而不是整体失败', () => {
    const raw = JSON.stringify({
      summary: '概要',
      ideas: [
        { title: '', description: '缺标题' },
        'not-an-object',
        { title: '好创意', description: '可用' }
      ]
    })
    const draft = parsePlanDraft(raw)
    expect(draft!.ideas).toHaveLength(1)
    expect(draft!.ideas[0].title).toBe('好创意')
  })

  it('超过 8 条截断', () => {
    const raw = JSON.stringify({
      summary: '概要',
      ideas: Array.from({ length: 12 }, (_, i) => ({
        title: `创意${i}`,
        description: `描述${i}`
      }))
    })
    const draft = parsePlanDraft(raw)
    expect(draft!.ideas).toHaveLength(8)
  })

  it.each([
    ['空串', ''],
    ['非 JSON', '完全不是 JSON 的回答'],
    ['缺 summary', '{"ideas":[{"title":"a","description":"b"}]}'],
    ['ideas 全坏', '{"summary":"概要","ideas":[{"title":""}]}'],
    ['JSON 语法错误', '{"summary": "概要", ideas: [']
  ])('无法解析时返回 null：%s', (_label, raw) => {
    expect(parsePlanDraft(raw)).toBeNull()
  })
})
