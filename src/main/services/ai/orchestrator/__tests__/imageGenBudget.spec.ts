/**
 * P1-6 修复测试：AI 出图工具必须计入预算。
 *
 * 修复前：texture_repaint 调 repaintTexture（AI 图像生成），
 * 不走 budgetedChat，不计入预算熔断。
 * 预算条显示 40/144 时可能已发出数百次付费出图。
 *
 * 修复后：isImageGenTool 识别出图工具，applyToolCalls 调用前计预算。
 */
import { describe, expect, it } from 'vitest'
import { isImageGenTool, IMAGE_GEN_TOOLS } from '../generatePipeline'

describe('isImageGenTool：AI 出图工具识别', () => {
  it('texture_repaint 是 AI 出图工具', () => {
    expect(isImageGenTool('texture_repaint')).toBe(true)
  })

  it('texture_paint 不是 AI 出图（程序化生成，不调 AI）', () => {
    expect(isImageGenTool('texture_paint')).toBe(false)
  })

  it('texture_pixelize 不是 AI 出图（本地像素化，不调 AI）', () => {
    expect(isImageGenTool('texture_pixelize')).toBe(false)
  })

  it('content_upsert 不是出图工具', () => {
    expect(isImageGenTool('content_upsert')).toBe(false)
  })

  it('write_project_file 不是出图工具', () => {
    expect(isImageGenTool('write_project_file')).toBe(false)
  })

  it('空字符串不是出图工具', () => {
    expect(isImageGenTool('')).toBe(false)
  })

  it('IMAGE_GEN_TOOLS 只含 texture_repaint', () => {
    expect(IMAGE_GEN_TOOLS.size).toBe(1)
    expect(IMAGE_GEN_TOOLS.has('texture_repaint')).toBe(true)
  })
})
