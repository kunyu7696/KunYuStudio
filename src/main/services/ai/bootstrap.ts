/**
 * AI 运行时引导：在 app ready 后初始化参考包、漂移监测、编译探针、
 * mcdev-mcp 与五档 Agent 编排器单例。
 * 全部幂等；任何单项异常都不阻断应用启动（状态面板会显示错误原因）。
 */
import { app } from 'electron'
import { join } from 'node:path'
import { getSection } from '../settingsService'
import { getDb } from '../db'
import { createModelProvisionService, type ModelProvisionService } from '../modelProvisionService'
import {
  getReferenceService,
  initReferencePackage
} from './referencePackageService'
import { getMonitorService, initMonitorService } from './monitorService'
import { getProbeService, initProbeService } from './probeService'
import { getMcpClient, initMcpClient } from './mcpClient'
import { getOrchestrator, initOrchestrator } from './orchestrator'
import { kbModelsDir } from './kbRagSingleton'
import { isPackagedRuntime } from '../../runtimeEnv'

let initialized = false
let modelsSingleton: ModelProvisionService | null = null

/** A3：惰性单例（db prepare 复用；构造本身无 IO） */
export function getModelProvisionService(): ModelProvisionService {
  if (!modelsSingleton) {
    modelsSingleton = createModelProvisionService({
      modelsDir: kbModelsDir(),
      db: getDb(),
      // 离线安装包预置模型目录：prod 读 resourcesPath/models，dev 读工作区 resources/models
      // （由 scripts/fetch-models.mjs 拉取；目录缺失时自动回退在线下载）
      bundledModelsDir: () =>
        isPackagedRuntime(app)
          ? join(process.resourcesPath, 'models')
          : join(process.cwd(), 'resources', 'models')
    })
  }
  return modelsSingleton
}

export interface AiRuntime {
  reference: ReturnType<typeof getReferenceService>
  monitor: NonNullable<ReturnType<typeof getMonitorService>>
  probe: NonNullable<ReturnType<typeof getProbeService>>
  mcp: ReturnType<typeof initMcpClient>
  orchestrator: ReturnType<typeof getOrchestrator>
  /** A3 离线模型预置流水线（清单/缓存校验/预取） */
  models: ModelProvisionService
}

export function initAiRuntime(): AiRuntime {
  if (initialized) {
    return {
      reference: getReferenceService(),
      monitor: getMonitorService()!,
      probe: getProbeService()!,
      mcp: getMcpClient()!,
      orchestrator: getOrchestrator(),
      models: getModelProvisionService()
    }
  }

  const reference = initReferencePackage()
  const monitor = initMonitorService(reference)
  const probe = initProbeService(reference)
  // init 反编译需要 JDK：注入用户在「Java 环境」配置的全局 JDK
  const mcp = initMcpClient({
    javaHome: () => getSection('java').globalJdkHome || undefined
  })
  const orchestrator = initOrchestrator()

  // mcdev-mcp 已内置：默认后台自动连接，首次使用自动初始化 1.20.1 索引（约 2GB）。
  // enable() 立即返回 initializing/connecting 状态，不阻塞应用启动；失败软降级到状态面板。
  // 其 8 个只读静态工具经 MCPToolAdapter 进入 orchestrator 内的 ToolRegistry，
  // 按 ready 状态动态出现在 generate 阶段的 Function Calling 定义列表。
  if (getSection('ai').mcpEnabled) {
    void mcp.enable().catch(() => {
      /* 状态分级已在 client 内消化 */
    })
  }

  initialized = true
  return { reference, monitor, probe, mcp, orchestrator, models: getModelProvisionService() }
}
