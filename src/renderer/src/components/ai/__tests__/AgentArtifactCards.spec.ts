import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AgentArtifactCards from '../AgentArtifactCards.vue'
import type { AgentArtifact } from '../../../../../shared/types/agent'

/**
 * 聊天「产物」卡 · 贴图候选画廊契约：
 * - 多个候选渲染成横排缩略图，默认选中 AI 自动写回的那张
 * - 点选缩略图切换高亮，按钮文案跟随选中序号
 * - 「使用此候选」向上 emit { artifactId, candidateIndex }
 * - 选中项即已应用项（含父级回传的 appliedIndex）时按钮禁用并显示「已应用」
 */
function texArt(overrides: Partial<AgentArtifact> = {}): AgentArtifact {
  return {
    id: 'tex-cand-call-1',
    kind: 'texture-candidates',
    title: '贴图候选 · model/crate（2 个）',
    textureCandidates: {
      assetKind: 'model',
      assetId: 'crate',
      size: 16,
      prompt: '寒冰符文',
      provider: 'fake-image-model',
      appliedIndex: 1,
      variants: [
        { index: 1, dataUrl: 'data:image/png;base64,AA', pixels: ['#f00'], palette: ['#f00'], colorCount: 1 },
        { index: 2, dataUrl: 'data:image/png;base64,BB', pixels: ['#00f'], palette: ['#00f'], colorCount: 1 }
      ]
    },
    ...overrides
  }
}

function mountCards(artifacts: AgentArtifact[], props: Record<string, unknown> = {}) {
  return mount(AgentArtifactCards, {
    props: { artifacts, rechecking: false, ...props },
    global: { plugins: [ElementPlus] }
  })
}

describe('AgentArtifactCards · 贴图候选画廊', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('渲染候选缩略图并默认选中 AI 自动写回的那张', () => {
    const w = mountCards([texArt()])
    const thumbs = w.findAll('.art-thumb')
    expect(thumbs).toHaveLength(2)
    expect(thumbs[0].find('img').attributes('src')).toContain('data:image/png')
    // appliedIndex=1 → 第一张高亮
    expect(thumbs[0].classes()).toContain('is-active')
    expect(thumbs[1].classes()).not.toContain('is-active')
    expect(w.text()).toContain('寒冰符文')
    expect(w.text()).toContain('16×16')
  })

  it('点选缩略图切换高亮与按钮文案，并 emit 选中序号', async () => {
    const w = mountCards([texArt()], { allowApplyCandidate: true })
    const thumbs = w.findAll('.art-thumb')
    await thumbs[1].trigger('click')
    expect(thumbs[1].classes()).toContain('is-active')
    expect(thumbs[0].classes()).not.toContain('is-active')

    const btn = w.find('.art-apply-btn')
    expect(btn.text()).toBe('使用此候选 2')
    await btn.trigger('click')
    expect(w.emitted('applyCandidate')).toEqual([
      [{ artifactId: 'tex-cand-call-1', candidateIndex: 2 }]
    ])
  })

  it('选中项即已应用项时按钮禁用并显示「已应用」', async () => {
    // 父级回传 appliedIndex=1（默认选中第 1 张）
    const w = mountCards([texArt()], { allowApplyCandidate: true, appliedIndex: { 'tex-cand-call-1': 1 } })
    const btn = w.find('.art-apply-btn')
    expect(btn.text()).toBe('已应用')
    expect(btn.attributes('disabled')).toBeDefined()

    // 改选第 2 张后恢复可点（写盘幂等覆盖）
    await w.findAll('.art-thumb')[1].trigger('click')
    expect(w.find('.art-apply-btn').text()).toBe('使用此候选 2')
    expect(w.find('.art-apply-btn').attributes('disabled')).toBeUndefined()
  })

  it('写回中时按钮显示 loading 文案', () => {
    const w = mountCards([texArt()], {
      allowApplyCandidate: true,
      applyingCandidate: { artifactId: 'tex-cand-call-1', candidateIndex: 1 }
    })
    expect(w.find('.art-apply-btn').text()).toBe('写回中…')
  })

  it('未开 allowApplyCandidate 时不渲染写回操作行', () => {
    const w = mountCards([texArt()])
    expect(w.find('.art-apply-btn').exists()).toBe(false)
    expect(w.findAll('.art-thumb')).toHaveLength(2)
  })
})
