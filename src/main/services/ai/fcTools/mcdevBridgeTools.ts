/**
 * MCP 桥接工具（从 toolRegistry.ts 拆出）：
 * - registerMcdevTools：把 mcdev-mcp 的 8 个只读静态工具以 mcdev_ 前缀注册进注册表
 * - registerCustomMcpTools：把 CustomMcpManager 中所有 ready server 的工具以
 *   `{serverIdShort}_` 前缀注册进注册表
 */
import type { ToolRegistry, McpToolPort } from '../toolRegistry'
import { clipToolText } from './textClip'
import { READONLY_STATIC_TOOLS, type ReadonlyStaticTool } from '../mcpClient'
import type { CustomMcpManager } from '../mcpClient'

const MCDEV_TOOL_SPECS: Record<
  ReadonlyStaticTool,
  { summary: string; parameters: Record<string, unknown> }
> = {
  mc_search: {
    summary: '按关键词检索 Minecraft 映射类/方法/字段（mcdev-mcp）',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词' },
        type: { type: 'string', description: 'class | method | field（可选）' },
        limit: { type: 'number', description: '数量上限（可选）' }
      },
      required: ['query']
    }
  },
  mc_get_class: {
    summary: '查看映射类的字段/方法/完整定义（mcdev-mcp）',
    parameters: {
      type: 'object',
      properties: {
        className: { type: 'string', description: '完整类名（如 net.minecraft.world.level.block.Block）' },
        view: { type: 'string', description: 'fields | summary | methods | full（可选）' }
      },
      required: ['className']
    }
  },
  mc_get_method: {
    summary: '查看映射类某方法的签名与说明（mcdev-mcp）',
    parameters: {
      type: 'object',
      properties: {
        className: { type: 'string', description: '完整类名' },
        methodName: { type: 'string', description: '方法名' }
      },
      required: ['className', 'methodName']
    }
  },
  mc_list_classes: {
    summary: '列出某包下的全部映射类（mcdev-mcp）',
    parameters: {
      type: 'object',
      properties: {
        packagePath: { type: 'string', description: '包路径' },
        limit: { type: 'number', description: '数量上限（可选）' }
      },
      required: ['packagePath']
    }
  },
  mc_list_packages: {
    summary: '列出 minecraft/fabric 命名空间的包（mcdev-mcp）',
    parameters: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'minecraft | fabric（可选）' },
        limit: { type: 'number', description: '数量上限（可选）' }
      },
      required: []
    }
  },
  mc_find_hierarchy: {
    summary: '查询类的子类/实现层级（mcdev-mcp）',
    parameters: {
      type: 'object',
      properties: {
        className: { type: 'string', description: '完整类名' },
        direction: { type: 'string', description: 'subclasses | implementors' }
      },
      required: ['className', 'direction']
    }
  },
  mc_find_refs: {
    summary: '查询方法/类的调用与被调用引用（mcdev-mcp）',
    parameters: {
      type: 'object',
      properties: {
        className: { type: 'string', description: '完整类名' },
        methodName: { type: 'string', description: '方法名（可选）' },
        direction: { type: 'string', description: 'callers | callees（可选）' },
        limit: { type: 'number', description: '数量上限（可选）' }
      },
      required: ['className']
    }
  },
  mc_version: {
    summary: '查看/切换 mcdev-mcp 反编译索引版本（mcdev-mcp）',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list | set' },
        version: { type: 'string', description: 'set 时的版本号' }
      },
      required: ['action']
    }
  }
}

/**
 * 把 mcdev-mcp 的 8 个只读静态工具以 mcdev_ 前缀注册进注册表。
 * mcdev-mcp 未就绪时不注册（getToolDefinitions 自然不含这些工具）。
 *
 * mcdev-mcp 服务端是有状态的：反编译索引版本必须先经 mc_version action=set 设置，
 * 否则 mc_search 等工具直接返回「No Minecraft version is currently set」并拒绝服务
 * （真机：大师档首次运行时保底检索与模型 FC 调用都踩中）。这里在收到该特征错误时
 * 用本次运行的 ctx.mcVersion 自动 set 一次并重试，覆盖编排器保底调用与模型直调两条路径。
 */
export function registerMcdevTools(registry: ToolRegistry, mcp: McpToolPort): void {
  const isReady = () => mcp.isEnabled() && mcp.getStatus().kind === 'ready'
  const VERSION_NOT_SET_RE = /No Minecraft version is currently set/i
  for (const name of READONLY_STATIC_TOOLS) {
    const spec = MCDEV_TOOL_SPECS[name]
    registry.registerTool(
      {
        type: 'function',
        function: {
          name: `mcdev_${name}`,
          description: `${spec.summary}。version 参数由系统注入，无需指定。`,
          parameters: spec.parameters
        }
      },
      async (args, ctx) => {
        let outcome = await mcp.callStaticTool(name, args, undefined)
        // 版本未设置：按本次运行目标版本自动引导后重试一次（mc_version 自身不再递归）
        const versionHint =
          (outcome.ok && outcome.text && VERSION_NOT_SET_RE.test(outcome.text)) ||
          (!outcome.ok && outcome.error && VERSION_NOT_SET_RE.test(outcome.error))
        if (name !== 'mc_version' && versionHint && ctx?.mcVersion) {
          const setRes = await mcp.callStaticTool(
            'mc_version',
            { action: 'set', version: ctx.mcVersion },
            undefined
          )
          if (setRes.ok) outcome = await mcp.callStaticTool(name, args, undefined)
        }
        return outcome.ok
          ? { ok: true, text: clipToolText(outcome.text), data: undefined }
          : { ok: false, text: '', error: outcome.error ?? 'mcdev-mcp 调用失败' }
      },
      'chat',
      isReady
    )
  }
}

/**
 * 把 CustomMcpManager 中所有 ready server 的工具以 `{serverIdShort}_` 前缀注册进注册表。
 * 工具不可用（server 未就绪）时 available 返回 false，自动从 FC 定义列表中剔除。
 * 与 registerMcdevTools 同模式，让自定义 MCP 工具进入匠造 Agent 的 FC 循环。
 * available 同时带 isToolAllowedFor 门控（M19 防御性）：注册表快照过期时，
 * 被工具权限禁用的工具不会暴露给模型；真正拦截仍在 callTool 兜底。
 */
export function registerCustomMcpTools(
  registry: ToolRegistry,
  manager: CustomMcpManager
): void {
  const all = manager.listAllToolsWithSchema()
  for (const entry of all) {
    const prefix = `${entry.serverIdShort}_`
    const serverId = entry.serverId
    for (const tool of entry.tools) {
      registry.registerTool(
        {
          type: 'function',
          function: {
            name: `${prefix}${tool.name}`,
            description: `${tool.description}（来源：${entry.serverName}，类别 ${entry.category}）`,
            parameters: tool.inputSchema ?? { type: 'object', properties: {} }
          }
        },
        async (args) => {
          const outcome = await manager.callTool(serverId, tool.name, args)
          return outcome.ok
            ? { ok: true, text: clipToolText(outcome.text), data: undefined }
            : { ok: false, text: '', error: outcome.error ?? `调用 ${tool.name} 失败` }
        },
        'chat',
        () => manager.isReady(serverId) && manager.isToolAllowedFor(serverId, tool.name)
      )
    }
  }
}
