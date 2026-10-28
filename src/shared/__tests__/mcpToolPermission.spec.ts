/**
 * mcpToolPermission（TR #4）纯函数测试：三组映射。
 */
import { describe, expect, it } from 'vitest'
import { getMcpToolPermission } from '../mcpToolPermission'

describe('getMcpToolPermission', () => {
  it('read：白名单检索工具', () => {
    expect(getMcpToolPermission('template_search')).toBe('read')
    expect(getMcpToolPermission('kb_search')).toBe('read')
    expect(getMcpToolPermission('mc_data_lookup')).toBe('read')
    expect(getMcpToolPermission('mc_state')).toBe('read')
    expect(getMcpToolPermission('content_list')).toBe('read')
    expect(getMcpToolPermission('market_search_mods')).toBe('read')
  })

  it('read：mcdev_ 前缀只读静态工具', () => {
    expect(getMcpToolPermission('mcdev_mc_search')).toBe('read')
    expect(getMcpToolPermission('mcdev_mc_get_class')).toBe('read')
  })

  it('interact：内容写入类', () => {
    expect(getMcpToolPermission('content_upsert')).toBe('interact')
    expect(getMcpToolPermission('write_project_file')).toBe('interact')
    expect(getMcpToolPermission('texture_paint')).toBe('interact')
    expect(getMcpToolPermission('recipe_create')).toBe('interact')
    expect(getMcpToolPermission('mixin_scaffold')).toBe('interact')
  })

  it('admin：命令执行/安装/游戏控制/未知工具', () => {
    expect(getMcpToolPermission('gradle_build')).toBe('admin')
    expect(getMcpToolPermission('market_install_mod')).toBe('admin')
    expect(getMcpToolPermission('mc_command')).toBe('admin')
    expect(getMcpToolPermission('mc_input')).toBe('admin')
    expect(getMcpToolPermission('unknown_tool')).toBe('admin')
  })
})
