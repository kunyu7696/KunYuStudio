import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import { executeActions } from '../../services/performance/actionExecutor'
import {
  analyzeAndStore,
  analyzeModsDirectory,
  importJfr,
  importSpark
} from '../../services/performance/pipelineService'
import { assertWithinRoot } from '../../services/fsService'
import { getSection } from '../../services/settingsService'
import type {
  LeaderboardQuery,
  PlannedAction,
  ProfileKey
} from '../../../shared/schemas/performance/profile'
import type { IpcContext } from '../context'
import { handle } from '../handle'

/** M8 模组性能画像：排行榜 + 单画像详情 */
export function registerProfileHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.PROFILE_LEADERBOARD, (_event, query: LeaderboardQuery) =>
    ctx.profiles().leaderboard(query)
  )
  ipcMain.handle(IpcChannels.PROFILE_GET, (_event, key: ProfileKey) => ctx.profiles().getProfile(key))
  // PROFILE_APPLY_ACTIONS：modsRoot/configRoot 原先直接来自渲染层且只做词法校验，
  // 攻击者可传 C:\\...\\Startup 把任意目录改名/删除/写配置。handle 包装做：
  // - 发送方必须为主窗口顶层帧
  // - schema 校验 actions 为数组
  // - assertWithinRoot 校验 modsRoot/configRoot 落在某个已注册项目根内
  //   （合法场景：modsRoot=<project>/run/mods、configRoot=<project>/run/config，均在打开项目根下）
  handle(
    IpcChannels.PROFILE_APPLY_ACTIONS,
    [
      {
        type: 'object',
        required: ['modsRoot', 'configRoot', 'actions'],
        properties: {
          modsRoot: { type: 'string', minLength: 1, maxLength: 4096 },
          configRoot: { type: 'string', minLength: 1, maxLength: 4096 },
          actions: { type: 'array', items: { type: 'object' }, maxItems: 1024 }
        }
      }
    ],
    (
      _event,
      input: { modsRoot: string; configRoot: string; actions: PlannedAction[] }
    ) => {
      assertWithinRoot(input.modsRoot)
      assertWithinRoot(input.configRoot)
      return executeActions(input.modsRoot, input.configRoot, input.actions)
    }
  )
  ipcMain.handle(
    IpcChannels.PROFILE_ANALYZE_DIRECTORY,
    (_event, input: { dir: string; loader: string; mcVersion: string }) =>
      analyzeModsDirectory(ctx.profiles(), input)
  )
  ipcMain.handle(
    IpcChannels.PROFILE_IMPORT_JAR,
    (_event, input: { jarPath: string; loader: string; mcVersion: string }) =>
      analyzeAndStore(ctx.profiles(), input)
  )
  ipcMain.handle(
    IpcChannels.PROFILE_IMPORT_JFR,
    async (
      _event,
      input: {
        jfrPath: string
        jdkHome?: string | null
        loader?: string
        mcVersion?: string
      }
    ) =>
      importJfr(ctx.profiles(), {
        ...input,
        jdkHome: input.jdkHome ?? getSection('java').globalJdkHome
      })
  )
  ipcMain.handle(
    IpcChannels.PROFILE_IMPORT_SPARK,
    (_event, input: { filePath: string; loader?: string; mcVersion?: string }) =>
      importSpark(ctx.profiles(), { filePath: input.filePath, loader: input.loader, mcVersion: input.mcVersion })
  )
}
