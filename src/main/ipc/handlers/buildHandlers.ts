import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import { detectJdk } from '../../services/jdkService'
import { provisionJdk } from '../../services/jdkProvisionService'
import { cancelGradle, startGradle } from '../../services/gradleService'
import type {
  GradleRunInput,
  JdkProvisionInput,
  JdkProvisionProgress,
  JdkRequirements
} from '../../../shared/types/build'
import type { ModLoader } from '../../../shared/types/project'
import { jdkRequirementsFor, jdkRequirementsForMcVersion } from '../../templates/loaderVersionMatrix'
import type { IpcContext } from '../context'

/** JDK_DETECT 的检测上下文：loader+mcVersion 按版本矩阵推导；requirements 直接指定 */
interface JdkDetectContext {
  loader?: string | null
  mcVersion?: string | null
  requirements?: JdkRequirements
}

/** 构建与运行（M5） */
export function registerBuildHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.GRADLE_RUN, (_event, input: GradleRunInput) =>
    startGradle(ctx.win, input)
  )
  ipcMain.handle(IpcChannels.GRADLE_CANCEL, (_event, runId?: string) => cancelGradle(runId))
  ipcMain.handle(
    IpcChannels.JDK_DETECT,
    (_event, configuredPath?: string | null, context?: JdkDetectContext) => {
      if (context?.requirements) return detectJdk(configuredPath, context.requirements)
      const loader = context?.loader
      const mcVersion = context?.mcVersion
      if (loader && mcVersion && ['fabric', 'forge', 'neoforge'].includes(loader)) {
        return detectJdk(configuredPath, jdkRequirementsFor(loader as ModLoader, mcVersion))
      }
      // 零配置向导（无项目上下文）：按纯 MC 版本推导（26.3 → JDK 25），
      // 不能落 1.20.1 时代默认，否则 26.3 目标永远推不到 JDK 25
      if (mcVersion) return detectJdk(configuredPath, jdkRequirementsForMcVersion(mcVersion))
      return detectJdk(configuredPath)
    }
  )
  // 零配置运行环境 3a：应用内一键下载/安装 JDK，进度经 JDK_PROVISION_EVENT 推送
  ipcMain.handle(IpcChannels.JDK_PROVISION, (_event, input: JdkProvisionInput) => {
    const send = (p: JdkProvisionProgress): void => {
      try {
        if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.JDK_PROVISION_EVENT, p)
      } catch {
        /* 窗口已销毁不影响置备 */
      }
    }
    return provisionJdk(input, send)
  })
}
