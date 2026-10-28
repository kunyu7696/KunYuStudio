/**
 * mcpToolFilter（M19）纯函数测试：三态过滤、parse 白名单重建。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOOL_FILTER,
  applyToolFilter,
  isMcpToolFilterMode,
  isToolAllowed,
  parseMcpToolFilter
} from '../mcpToolFilter'

describe('isMcpToolFilterMode', () => {
  it('接受三种合法 mode', () => {
    expect(isMcpToolFilterMode('all')).toBe(true)
    expect(isMcpToolFilterMode('allowlist')).toBe(true)
    expect(isMcpToolFilterMode('blocklist')).toBe(true)
  })
  it('拒绝非法 mode', () => {
    expect(isMcpToolFilterMode('none')).toBe(false)
    expect(isMcpToolFilterMode('')).toBe(false)
    expect(isMcpToolFilterMode(undefined)).toBe(false)
    expect(isMcpToolFilterMode(1)).toBe(false)
  })
})

describe('parseMcpToolFilter', () => {
  it('空/非法输入收敛到缺省 all', () => {
    expect(parseMcpToolFilter(undefined)).toEqual(DEFAULT_TOOL_FILTER)
    expect(parseMcpToolFilter(null)).toEqual(DEFAULT_TOOL_FILTER)
    expect(parseMcpToolFilter('allowlist')).toEqual(DEFAULT_TOOL_FILTER)
    expect(parseMcpToolFilter({})).toEqual(DEFAULT_TOOL_FILTER)
  })
  it('合法 allowlist 透传', () => {
    expect(parseMcpToolFilter({ mode: 'allowlist', tools: ['read_file', 'write_file'] })).toEqual({
      mode: 'allowlist',
      tools: ['read_file', 'write_file']
    })
  })
  it('非法 mode 收敛为 all（忽略 tools）', () => {
    expect(parseMcpToolFilter({ mode: 'xxx', tools: ['a'] })).toEqual({ mode: 'all', tools: ['a'] })
  })
  it('tools 去重/去空串/去非字符串/限长 128', () => {
    const long = 'x'.repeat(200)
    const r = parseMcpToolFilter({
      mode: 'blocklist',
      tools: ['a', 'a', '', 1, null, long]
    })
    expect(r.mode).toBe('blocklist')
    expect(r.tools).toEqual(['a', 'x'.repeat(128)])
  })
})

describe('isToolAllowed', () => {
  it('filter 缺省或 mode=all 时全部允许', () => {
    expect(isToolAllowed('any_tool', undefined)).toBe(true)
    expect(isToolAllowed('any_tool', null)).toBe(true)
    expect(isToolAllowed('any_tool', { mode: 'all', tools: ['x'] })).toBe(true)
  })
  it('allowlist：仅列表内允许', () => {
    const f = { mode: 'allowlist' as const, tools: ['read_file'] }
    expect(isToolAllowed('read_file', f)).toBe(true)
    expect(isToolAllowed('write_file', f)).toBe(false)
  })
  it('blocklist：列表内拒绝，其余允许', () => {
    const f = { mode: 'blocklist' as const, tools: ['delete_file'] }
    expect(isToolAllowed('delete_file', f)).toBe(false)
    expect(isToolAllowed('read_file', f)).toBe(true)
  })
})

describe('applyToolFilter', () => {
  const tools = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
  it('all/缺省返回原列表（保持顺序与引用）', () => {
    expect(applyToolFilter(tools, undefined)).toBe(tools)
    expect(applyToolFilter(tools, { mode: 'all', tools: [] })).toBe(tools)
  })
  it('allowlist 过滤并保持顺序', () => {
    expect(applyToolFilter(tools, { mode: 'allowlist', tools: ['c', 'a'] })).toEqual([
      { name: 'a' },
      { name: 'c' }
    ])
  })
  it('blocklist 过滤并保持顺序', () => {
    expect(applyToolFilter(tools, { mode: 'blocklist', tools: ['b'] })).toEqual([
      { name: 'a' },
      { name: 'c' }
    ])
  })
})
