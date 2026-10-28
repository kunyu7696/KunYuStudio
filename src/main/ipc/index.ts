import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { initAiRuntime } from '../services/ai/bootstrap'
import { createLauncherService, createSystemDeps, type LauncherPaths } from '../services/launcherService'
import { getDb } from '../services/db'
import { createProfileRepository, type ProfileRepository } from '../services/performance/profileRepository'
import type { IpcContext } from './context'
import { setTrustedWindow } from './handle'
import { registerAppHandlers } from './handlers/appHandlers'
import { registerProjectHandlers } from './handlers/projectHandlers'
import { registerFsHandlers } from './handlers/fsHandlers'
import { registerContentHandlers } from './handlers/contentHandlers'
import { registerBuildHandlers } from './handlers/buildHandlers'
import { registerMcHandlers } from './handlers/mcHandlers'
import { registerAiChatHandlers } from './handlers/aiChatHandlers'
import { registerKnowledgePackHandlers } from './handlers/knowledgePackHandlers'
import { registerAiRuntimeHandlers } from './handlers/aiRuntimeHandlers'
import { registerObserverHandlers } from './handlers/observerHandlers'
import { registerMarketHandlers } from './handlers/marketHandlers'
import { registerModLibraryHandlers } from './handlers/modLibraryHandlers'
import { registerProfileHandlers } from './handlers/profileHandlers'
import { registerSandboxHandlers } from './handlers/sandboxHandlers'
import { registerLauncherHandlers } from './handlers/launcherHandlers'
import { registerEditorPackHandlers } from './handlers/editorPackHandlers'
import { registerModpackHandlers } from './handlers/modpackHandlers'
import { registerCiHandlers } from './handlers/ciHandlers'
import { registerIntegrationHandlers } from './handlers/integrationHandlers'
import { registerVcsHandlers } from './handlers/vcsHandlers'
import { registerPluginHandlers } from './handlers/pluginHandlers'
import { registerDshHandlers } from './handlers/dshHandlers'
import { registerKunyuHandlers } from './handlers/kunyuHandlers'
import { registerJavaHandlers } from './handlers/javaHandlers'
import { registerModelerHandlers } from './handlers/modelerHandlers'
import { registerUpdateHandlers } from './handlers/updateHandlers'
import { registerDecompileHandlers } from './handlers/decompileHandlers'
import { registerAudioHandlers } from './handlers/audioHandlers'
import { registerFtbQuestHandlers } from './handlers/ftbQuestHandlers'
import { registerPatchouliHandlers } from './handlers/patchouliHandlers'
import { registerKubejsHandlers } from './handlers/kubejsHandlers'

/**
 * 注册所有主进程 IPC 处理器。
 * 统一使用 ipcMain.handle（invoke 请求-响应模式）；
 * 长耗时任务后续通过 webContents.send 推送进度（on 模式）。
 *
 * 本文件只做运行时上下文构建与各领域 registrar 聚合，
 * 具体通道处理逻辑见 handlers/ 目录下按领域拆分的模块。
 */
export function registerIpcHandlers(win: BrowserWindow): void {
  // 绑定可信主窗口：危险通道的 handle 包装据此校验发送方
  setTrustedWindow(win)
  // 画像仓储惰性单例（prepare 语句复用）
  let profileRepo: ProfileRepository | null = null

  // 启动器集成：持久化文件放在 userData/launcher/ 下（dev 模式已重定向到 .dev-userdata/launcher/）
  const launcherDataDir = join(app.getPath('userData'), 'launcher')
  const launcherPaths: LauncherPaths = {
    recordsFile: join(launcherDataDir, 'records.json'),
    manualLaunchersFile: join(launcherDataDir, 'manual-launchers.json'),
    activeInstanceFile: join(launcherDataDir, 'active-instance.json'),
    integrationsFile: join(launcherDataDir, 'integrations.json')
  }

  const ctx: IpcContext = {
    win,
    activeProject: { current: null },
    aiRuntime: initAiRuntime(),
    profiles: () => {
      if (!profileRepo) profileRepo = createProfileRepository(getDb())
      return profileRepo
    },
    launcherService: createLauncherService(createSystemDeps(), launcherPaths)
  }

  registerAppHandlers(ctx)
  registerProjectHandlers(ctx)
  registerFsHandlers(ctx)
  registerContentHandlers(ctx)
  registerBuildHandlers(ctx)
  registerMcHandlers(ctx)
  registerAiChatHandlers(ctx)
  registerKnowledgePackHandlers()
  registerAiRuntimeHandlers(ctx)
  registerObserverHandlers(ctx)
  registerMarketHandlers(ctx)
  registerModLibraryHandlers(ctx)
  registerProfileHandlers(ctx)
  registerSandboxHandlers()
  registerLauncherHandlers(ctx)
  registerEditorPackHandlers(ctx)
  registerModpackHandlers(ctx)
  registerCiHandlers(ctx)
  registerIntegrationHandlers(ctx)
  registerVcsHandlers(ctx)
  registerPluginHandlers(ctx)
  registerDshHandlers(ctx)
  registerKunyuHandlers(ctx)
  registerJavaHandlers(ctx)
  registerModelerHandlers(ctx)
  registerUpdateHandlers(ctx)
  registerDecompileHandlers(ctx)
  registerAudioHandlers(ctx)
  registerFtbQuestHandlers()
  registerPatchouliHandlers()
  registerKubejsHandlers()
}
