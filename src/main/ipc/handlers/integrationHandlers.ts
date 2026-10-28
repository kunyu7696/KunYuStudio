import { app, ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { ExternalAgentRunRequest, McpAuthDecision } from '../../../shared/types/integration'
import { getSection } from '../../services/settingsService'
import { getAllProjects } from '../../services/projectService'
import { initIntegrationService } from '../../services/integrationService'
import { createExternalAgentService } from '../../services/externalAgentService'
import type { IpcContext } from '../context'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 集成域 IPC：外部 Agent CLI 检测 + KunYu MCP 桥接。
 * MCP 桥接的工具表直接复用 orchestrator 的 ToolRegistry；
 * 写/敏感工具执行前经 integration:auth-request 事件弹窗，等待渲染层 respondAuth。
 */
export function registerIntegrationHandlers(ctx: IpcContext): void {
  const service = initIntegrationService({
    getRegistry: () => ctx.aiRuntime.orchestrator.getRegistry(),
    sendAuthRequest: (req) => {
      if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.INTEGRATION_AUTH_REQUEST, req)
    },
    settings: () => getSection('integration'),
    projectContext: () => {
      const root = ctx.activeProject.current
      if (!root) return null
      const project = getAllProjects().find((p) => p.path === root)
      if (!project) return null
      // 整合包等项目类型 loader 为 null，执行上下文回退 fabric（多数工具仍可用）
      return { loader: project.loader ?? 'fabric', mcVersion: project.mcVersion }
    },
    auditLog: {
      getPath: () => join(app.getPath('userData'), 'mcp-audit.jsonl'),
      appendFile: (path: string, line: string) => {
        try {
          appendFileSync(path, line, 'utf8')
        } catch {
          /* 日志写失败不能影响主流程 */
        }
      }
    }
  })

  ipcMain.handle(IpcChannels.INTEGRATION_DETECT_AGENTS, () => service.detectAgents())
  ipcMain.handle(IpcChannels.INTEGRATION_START_BRIDGE, () => service.startBridge())
  ipcMain.handle(IpcChannels.INTEGRATION_STOP_BRIDGE, () => service.stopBridge())
  ipcMain.handle(IpcChannels.INTEGRATION_GET_BRIDGE_STATUS, () => service.getBridgeStatus())
  ipcMain.handle(IpcChannels.INTEGRATION_AUTH_RESPOND, (_event, decision: McpAuthDecision) => {
    service.respondAuth(decision)
  })

  // 外部 Agent 派发：KunYu 作为 client 调 Codex / Claude Code 非交互执行任务
  const agentRunner = createExternalAgentService({
    settings: () => getSection('integration'),
    activeProjectRoot: () => ctx.activeProject.current,
    sendChunk: (chunk) => {
      if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.INTEGRATION_AGENT_CHUNK, chunk)
    },
    sendExit: (exit) => {
      if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.INTEGRATION_AGENT_EXIT, exit)
    }
  })
  ipcMain.handle(IpcChannels.INTEGRATION_RUN_AGENT, (_event, req: ExternalAgentRunRequest) =>
    agentRunner.run(req)
  )
  ipcMain.handle(IpcChannels.INTEGRATION_STOP_AGENT, (_event, runId: string) =>
    agentRunner.stop(runId)
  )

  // 设置里开了桥接开关：启动时自动监听（静默失败，状态在 pane 里可见）
  if (getSection('integration').mcpBridgeEnabled) {
    void service.startBridge().catch(() => {
      /* 错误已写入 bridgeStatus.error */
    })
  }
}
