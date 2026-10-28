/**
 * 按阶段门控单测：fix 模式剔除 AI 出图/市场/委派工具，
 * generate 模式与缺省不受影响；修复相关的读写检索工具全部保留。
 */
import { describe, expect, it } from 'vitest'
import { filterToolDefsByMode, FIX_MODE_EXCLUDED_TOOLS } from '../generatePipeline'

function def(name: string) {
  return { type: 'function' as const, function: { name, description: '', parameters: {} } }
}

describe('filterToolDefsByMode', () => {
  const defs = [
    def('read_project_file'),
    def('write_project_file'),
    def('project_grep'),
    def('mc_state'),
    def('texture_repaint'),
    def('market_search_mods'),
    def('market_install_mod'),
    def('agent_delegate'),
    def('agent_delegate_batch'),
    def('texture_paint')
  ]

  it("mode='fix' 剔除出图/市场/委派，保留读写检索与确定性贴图工具", () => {
    const names = filterToolDefsByMode(defs, 'fix').map((d) => d.function.name)
    expect(names).toContain('read_project_file')
    expect(names).toContain('write_project_file')
    expect(names).toContain('project_grep')
    expect(names).toContain('mc_state')
    // texture_paint 是确定性像素编辑，不烧图像模型预算，保留
    expect(names).toContain('texture_paint')
    for (const excluded of FIX_MODE_EXCLUDED_TOOLS) {
      expect(names).not.toContain(excluded)
    }
  })

  it("mode='generate' 与缺省返回原列表（不裁不减）", () => {
    expect(filterToolDefsByMode(defs, 'generate')).toHaveLength(defs.length)
    expect(filterToolDefsByMode(defs, undefined)).toHaveLength(defs.length)
  })

  it('fix 模式不引入新工具，只减不增', () => {
    const filtered = filterToolDefsByMode(defs, 'fix')
    expect(filtered.length).toBeLessThan(defs.length)
    expect(filtered.every((d) => defs.includes(d))).toBe(true)
  })
})
