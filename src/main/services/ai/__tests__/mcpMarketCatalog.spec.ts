/**
 * 插件市场官方认证白名单单测：
 * - 精确白名单（mc-texture-cli / mc-asset / minecraft-dev-mcp）
 * - @modelcontextprotocol/ 官方作用域
 * - 版本后缀剥离、作用域不误伤
 * - 内置目录条目的 certified 标记
 */
import { describe, expect, it } from 'vitest'
import { getBundledCatalog, isCertifiedIdentifier } from '../marketService'
import { identifierFromArgs } from '../../../../shared/mcpTrust'

describe('isCertifiedIdentifier', () => {
  it('KunYu 核验过的精确包名', () => {
    expect(isCertifiedIdentifier('mc-texture-cli')).toBe(true)
    expect(isCertifiedIdentifier('mc-asset')).toBe(true)
    expect(isCertifiedIdentifier('@mcdxai/minecraft-dev-mcp')).toBe(true)
  })

  it('MCP 官方组织作用域全部认证', () => {
    expect(isCertifiedIdentifier('@modelcontextprotocol/server-filesystem')).toBe(true)
    expect(isCertifiedIdentifier('@modelcontextprotocol/server-memory')).toBe(true)
  })

  it('自动忽略末尾版本后缀，保留 @scope', () => {
    expect(isCertifiedIdentifier('mc-texture-cli@latest')).toBe(true)
    expect(isCertifiedIdentifier('@modelcontextprotocol/server-filesystem@2024.1.5')).toBe(true)
    expect(isCertifiedIdentifier('@mcdxai/minecraft-dev-mcp@0.7.2-beta.1')).toBe(true)
  })

  it('identifierFromArgs 正确处理作用域包 @scope/pkg@version（首个 @ 不能截断）', () => {
    expect(identifierFromArgs(['-y', '@mcdxai/minecraft-dev-mcp@latest', 'mcp'])).toBe(
      '@mcdxai/minecraft-dev-mcp'
    )
    expect(identifierFromArgs(['-y', '-p', 'mc-texture-cli@latest', 'mctex-mcp'])).toBe(
      'mc-texture-cli'
    )
    expect(identifierFromArgs(['-y', 'mc-asset', 'mcp'])).toBe('mc-asset')
  })

  it('未认证第三方包返回 false', () => {
    expect(isCertifiedIdentifier('@anningui/blockbench-mcp')).toBe(false)
    expect(isCertifiedIdentifier('some-random-npm-package')).toBe(false)
    expect(isCertifiedIdentifier('@evilcorp/server-filesystem')).toBe(false)
  })

  it('相似前缀伪装不被误认（modelcontextprotocol 无 @ 或拼写微调）', () => {
    expect(isCertifiedIdentifier('modelcontextprotocol/server-x')).toBe(false)
    expect(isCertifiedIdentifier('@modelcontextprotocol-evil/server-x')).toBe(false)
  })
})

describe('内置精选目录 certified 标记', () => {
  it('白名单内置条目带官方认证', () => {
    const all = getBundledCatalog()
    const byId = new Map(all.map((p) => [p.identifier, p]))
    expect(byId.get('mc-texture-cli')?.certified).toBe(true)
    expect(byId.get('mc-asset')?.certified).toBe(true)
    expect(byId.get('@mcdxai/minecraft-dev-mcp')?.certified).toBe(true)
    expect(byId.get('@modelcontextprotocol/server-filesystem')?.certified).toBe(true)
    expect(byId.get('@modelcontextprotocol/server-github')?.certified).toBe(true)
  })

  it('Blockbench MCP 属第三方集成，不打认证', () => {
    const bb = getBundledCatalog().find((p) => p.identifier === '@anningui/blockbench-mcp')
    expect(bb?.certified).toBe(false)
  })

  it('搜索过滤后认证标记仍保留', () => {
    const hit = getBundledCatalog('texture').find((p) => p.identifier === 'mc-texture-cli')
    expect(hit?.certified).toBe(true)
  })
})
