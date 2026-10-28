import type { BrowserWindow } from 'electron'
import type { AiRuntime } from '../services/ai/bootstrap'
import type { LauncherService } from '../services/launcherService'
import type { ProfileRepository } from '../services/performance/profileRepository'

/**
 * 各领域 IPC registrar 共享的运行时上下文。
 * 由聚合层 index.ts 构建并传入；registrar 只消费，不自行初始化服务。
 */
export interface IpcContext {
  /** 主窗口：事件推送用（推送前各 registrar 自行判断 isDestroyed） */
  win: BrowserWindow
  /** 当前打开的项目根：project 域写入（打开/导入），MCP syncCustom 等读取 */
  activeProject: { current: string | null }
  /** M7 AI 运行时（reference/orchestrator/monitor/probe/mcp/bridge） */
  aiRuntime: AiRuntime
  /** 画像仓储惰性单例（prepare 语句复用） */
  profiles(): ProfileRepository
  /** 启动器服务：launcher 域与 modpack 启动测试共用 */
  launcherService: LauncherService
}
