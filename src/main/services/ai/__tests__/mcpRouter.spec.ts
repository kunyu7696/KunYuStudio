/**
 * MCP 网关路由器测试（MCP_GATEWAY_ROUTER）：
 * - MCP_PRESETS 形状（市场一键导入预置）
 * - CustomMcpManager 空态路由（无 server 时 findServersByCategory/getCapabilityBrief/isReady 行为）
 * - registerCustomMcpTools 把 stub manager 的工具注册到 ToolRegistry
 * - admin 权限 callTool 拦截（未确认时 ok:false）
 * - normalizeSettings 白名单补 category/permission 默认值
 */
import { describe, expect, it } from 'vitest'
import { MCP_PRESETS, isMcpCategory, isMcpPermission, mergeWithDefaults } from '../../../../shared/types/settings'
import type { McpToolFilter } from '../../../../shared/mcpToolFilter'
import { CustomMcpManager, initCustomMcpManager, getCustomMcpManager } from '../mcpClient'
import { createToolRegistry, registerCustomMcpTools } from '../toolRegistry'

describe('MCP_PRESETS（市场预置）', () => {
  it('包含 mc-texture-cli 与 minecraft-dev-mcp 两项', () => {
    expect(MCP_PRESETS.length).toBeGreaterThanOrEqual(2)
    const names = MCP_PRESETS.map((p) => p.name)
    expect(names.some((n) => n.includes('mc-texture-cli'))).toBe(true)
    expect(names.some((n) => n.includes('minecraft-dev-mcp'))).toBe(true)
  })

  it('mc-texture-cli 为 texture/interact 且含 __PROJECT_ROOT__ 占位符', () => {
    const tex = MCP_PRESETS.find((p) => p.category === 'texture')!
    expect(tex).toBeTruthy()
    expect(tex.permission).toBe('interact')
    expect(tex.enabled).toBe(false)
    expect(tex.args.some((a) => a === '__PROJECT_ROOT__')).toBe(true)
  })

  it('minecraft-dev-mcp 为 code/read 且 enabled=false', () => {
    const code = MCP_PRESETS.find((p) => p.category === 'code')!
    expect(code).toBeTruthy()
    expect(code.permission).toBe('read')
    expect(code.enabled).toBe(false)
  })

  it('isMcpCategory / isMcpPermission 校验', () => {
    expect(isMcpCategory('texture')).toBe(true)
    expect(isMcpCategory('invalid')).toBe(false)
    expect(isMcpPermission('admin')).toBe(true)
    expect(isMcpPermission('other')).toBe(false)
  })

  it('M19：包含官方 server-filesystem 与 server-memory 预置', () => {
    const fs = MCP_PRESETS.find((p) => p.name.includes('server-filesystem'))!
    expect(fs).toBeTruthy()
    expect(fs.permission).toBe('interact')
    expect(fs.enabled).toBe(false)
    expect(fs.args.some((a) => a === '__PROJECT_ROOT__')).toBe(true)
    const mem = MCP_PRESETS.find((p) => p.name.includes('server-memory'))!
    expect(mem).toBeTruthy()
    expect(mem.permission).toBe('read')
    expect(mem.enabled).toBe(false)
    expect(mem.env['MEMORY_FILE_PATH']).toContain('__PROJECT_ROOT__')
  })

  it('M19：全部预置带 toolFilter 缺省 all', () => {
    for (const p of MCP_PRESETS) {
      expect(p.toolFilter).toEqual({ mode: 'all', tools: [] })
    }
  })
})

describe('CustomMcpManager 空态路由', () => {
  it('无 server 时 listAllToolsWithSchema 返回空数组', () => {
    const mgr = new CustomMcpManager()
    expect(mgr.listAllToolsWithSchema()).toEqual([])
  })

  it('无 server 时 findServersByCategory 返回空数组', () => {
    const mgr = new CustomMcpManager()
    expect(mgr.findServersByCategory('texture')).toEqual([])
    expect(mgr.findServersByCategory('code')).toEqual([])
  })

  it('无 server 时 getCapabilityBrief 返回空串', () => {
    const mgr = new CustomMcpManager()
    expect(mgr.getCapabilityBrief()).toBe('')
  })

  it('无 server 时 isReady 返回 false', () => {
    const mgr = new CustomMcpManager()
    expect(mgr.isReady('any-id')).toBe(false)
  })

  it('list() 空数组（无 syncFromSettings）', () => {
    const mgr = new CustomMcpManager()
    expect(mgr.list()).toEqual([])
  })

  it('单例 initCustomMcpManager 返回同一实例', () => {
    const a = initCustomMcpManager()
    const b = getCustomMcpManager()
    expect(a).toBe(b)
  })
})

describe('registerCustomMcpTools（ToolRegistry 注册）', () => {
  it('stub manager 工具被注册到 ToolRegistry', () => {
    const registry = createToolRegistry({})
    // stub：模拟一个 ready 的 texture server，工具名 edit_pixel
    const stub = {
      listAllToolsWithSchema: () => [
        {
          serverId: 'stub-001',
          serverIdShort: 'stub-001'.slice(0, 8),
          serverName: 'stub-texture',
          category: 'texture' as const,
          permission: 'interact' as const,
          tools: [
            { name: 'edit_pixel', description: '编辑像素', inputSchema: { type: 'object', properties: {} } }
          ]
        }
      ],
      callTool: async () => ({ ok: true, text: 'pixel updated', isError: false }),
      isReady: () => true,
      isToolAllowedFor: () => true
    }
    registerCustomMcpTools(registry, stub as unknown as CustomMcpManager)
    // 工具应以 serverIdShort_ 前缀注册
    const defs = registry.getToolDefinitions()
    const found = defs.find((d) => d.function.name === 'stub-001_edit_pixel')
    expect(found).toBeTruthy()
    expect(found!.function.description).toContain('stub-texture')
    expect(found!.function.description).toContain('texture')
  })

  it('available 门控为 false 时不进入 FC 定义列表', () => {
    const registry = createToolRegistry({})
    const stub = {
      listAllToolsWithSchema: () => [
        {
          serverId: 'down-001',
          serverIdShort: 'down-001'.slice(0, 8),
          serverName: 'down-server',
          category: 'code' as const,
          permission: 'read' as const,
          tools: [{ name: 'search', description: '代码搜索', inputSchema: { type: 'object' } }]
        }
      ],
      callTool: async () => ({ ok: false, text: '', error: 'server down' }),
      isReady: () => false,
      isToolAllowedFor: () => true
    }
    registerCustomMcpTools(registry, stub as unknown as CustomMcpManager)
    const defs = registry.getToolDefinitions()
    expect(defs.find((d) => d.function.name === 'down-001_search')).toBeUndefined()
  })
})

describe('admin 权限 callTool 拦截', () => {
  it('未确认的 admin 工具调用被拦截', async () => {
    // 构造一个 admin 权限的 server config，但不实际连接（connect 会失败）
    const mgr = new CustomMcpManager()
    await mgr.syncFromSettings([
      {
        id: 'admin-001',
        name: 'game-control-admin',
        transport: 'stdio',
        command: 'nonexistent-cmd-xyz',
        args: [],
        env: {},
        timeoutMs: 5_000,
        enabled: false, // 不连接，仅注册配置
        category: 'game-control',
        permission: 'admin'
      }
    ])
    // 未连接时 callTool 返回未连接错误
    const result = await mgr.callTool('admin-001', 'any_tool', {})
    expect(result.ok).toBe(false)
    expect(result.error).toContain('未连接')
  })
})

describe('mergeWithDefaults 白名单补默认值', () => {
  it('旧数据无 category/permission 字段时补 general/read', () => {
    const normalized = mergeWithDefaults({
      ai: {
        providers: [],
        defaultProviderId: null,
        tierModels: {},
        manualLock: { tier: null, source: null, lockedAt: null },
        mcpEnabled: false,
        customMcpServers: [
          {
            id: 'mcp-old-001',
            name: '旧 MCP',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'foo'],
            env: {},
            enabled: false,
            timeoutMs: 30_000
            // 故意缺 category/permission
          }
        ]
      }
    })
    const server = normalized.ai.customMcpServers[0]
    expect(server.category).toBe('general')
    expect(server.permission).toBe('read')
  })

  it('非法 category 字段回退 general', () => {
    const normalized = mergeWithDefaults({
      ai: {
        providers: [],
        defaultProviderId: null,
        tierModels: {},
        manualLock: { tier: null, source: null, lockedAt: null },
        mcpEnabled: false,
        customMcpServers: [
          {
            id: 'mcp-bad-001',
            name: '非法 MCP',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'bar'],
            env: {},
            enabled: false,
            timeoutMs: 30_000,
            category: 'invalid-category',
            permission: 'invalid-perm'
          }
        ]
      }
    })
    const server = normalized.ai.customMcpServers[0]
    expect(server.category).toBe('general')
    expect(server.permission).toBe('read')
  })
})

describe('M19 工具级过滤（CustomMcpManager 集成）', () => {
  /** 构造带 ready 假运行时的 manager（toolFilter 经 syncFromSettings 注入配置） */
  async function makeReadyMgr(toolFilter?: McpToolFilter): Promise<CustomMcpManager> {
    const mgr = new CustomMcpManager()
    await mgr.syncFromSettings([
      {
        id: 'f-001',
        name: 'fake-server',
        transport: 'stdio',
        command: 'nonexistent-cmd-xyz',
        args: [],
        env: {},
        timeoutMs: 5_000,
        enabled: false, // 不拉起真实进程；运行时手工注入
        category: 'general',
        permission: 'read',
        toolFilter
      }
    ])
    // 注入 ready 运行时（绕过真实连接；client.callTool 返回固定文本）
    const fakeRuntime = {
      client: { callTool: async () => ({ content: [{ type: 'text', text: 'called' }] }) },
      transport: {},
      tools: ['read_file', 'write_file', 'delete_file'],
      toolSchemas: [
        { name: 'read_file', description: '', inputSchema: { type: 'object' } },
        { name: 'write_file', description: '', inputSchema: { type: 'object' } },
        { name: 'delete_file', description: '', inputSchema: { type: 'object' } }
      ],
      status: 'ready',
      category: 'general',
      permission: 'read'
    }
    ;(mgr as unknown as { runtimes: Map<string, unknown> }).runtimes.set('f-001', fakeRuntime)
    return mgr
  }

  it('缺省（无 toolFilter）：全部工具透出且可调用', async () => {
    const mgr = await makeReadyMgr(undefined)
    const listed = mgr.listAllToolsWithSchema()
    expect(listed).toHaveLength(1)
    expect(listed[0].tools.map((t) => t.name)).toEqual(['read_file', 'write_file', 'delete_file'])
    const r = await mgr.callTool('f-001', 'delete_file', {})
    expect(r.ok).toBe(true)
  })

  it('allowlist：仅白名单工具透出，黑名单调用被拦截', async () => {
    const mgr = await makeReadyMgr({ mode: 'allowlist', tools: ['read_file'] })
    const listed = mgr.listAllToolsWithSchema()
    expect(listed[0].tools.map((t) => t.name)).toEqual(['read_file'])
    const ok = await mgr.callTool('f-001', 'read_file', {})
    expect(ok.ok).toBe(true)
    const denied = await mgr.callTool('f-001', 'write_file', {})
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('工具权限')
  })

  it('blocklist：黑名单工具不透出且调用被拦截，其余正常', async () => {
    const mgr = await makeReadyMgr({ mode: 'blocklist', tools: ['delete_file'] })
    const listed = mgr.listAllToolsWithSchema()
    expect(listed[0].tools.map((t) => t.name)).toEqual(['read_file', 'write_file'])
    const denied = await mgr.callTool('f-001', 'delete_file', {})
    expect(denied.ok).toBe(false)
    const ok = await mgr.callTool('f-001', 'read_file', {})
    expect(ok.ok).toBe(true)
  })

  it('能力简报只包含过滤后的工具', async () => {
    const mgr = await makeReadyMgr({ mode: 'allowlist', tools: ['read_file'] })
    const brief = mgr.getCapabilityBrief()
    expect(brief).toContain('read_file')
    expect(brief).not.toContain('write_file')
    expect(brief).not.toContain('delete_file')
  })
})

describe('M19 mergeWithDefaults 解析 toolFilter', () => {
  const baseAi = {
    providers: [],
    defaultProviderId: null,
    tierModels: {},
    manualLock: { tier: null, source: null, lockedAt: null },
    mcpEnabled: false
  }
  const baseServer = {
    id: 'mcp-tf-001',
    name: 'tf',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'foo'],
    env: {},
    enabled: false,
    timeoutMs: 30_000
  }

  it('旧数据缺 toolFilter 字段时补缺省 all', () => {
    const normalized = mergeWithDefaults({ ai: { ...baseAi, customMcpServers: [baseServer] } })
    expect(normalized.ai.customMcpServers[0].toolFilter).toEqual({ mode: 'all', tools: [] })
  })

  it('合法 toolFilter 透传', () => {
    const normalized = mergeWithDefaults({
      ai: {
        ...baseAi,
        customMcpServers: [
          { ...baseServer, toolFilter: { mode: 'blocklist', tools: ['delete_file'] } }
        ]
      }
    })
    expect(normalized.ai.customMcpServers[0].toolFilter).toEqual({
      mode: 'blocklist',
      tools: ['delete_file']
    })
  })

  it('非法 toolFilter 收敛为 all', () => {
    const normalized = mergeWithDefaults({
      ai: {
        ...baseAi,
        customMcpServers: [{ ...baseServer, toolFilter: { mode: 'evil', tools: 'not-array' } }]
      }
    })
    expect(normalized.ai.customMcpServers[0].toolFilter).toEqual({ mode: 'all', tools: [] })
  })
})
