import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import { getModDetail, getModVersions, installMod, searchMods, testCurseforgeConnection } from '../../services/marketService'
import { translateToZh } from '../../services/translateService'
import { createProvenanceRecorder } from '../../services/modpack/provenance'
import { createPostInstallHook } from '../../services/performance/pipelineService'
import { getAllProjects } from '../../services/projectService'
import { getSection } from '../../services/settingsService'
import type { MarketInstallInput } from '../../../shared/types/market'
import type { IpcContext } from '../context'

/** M9 模组市场与社区桥接：CurseForge API Key 从设置注入 */
export function registerMarketHandlers(ctx: IpcContext): void {
  const cfKey = (): string => getSection('marketplace').curseforgeApiKey
  ipcMain.handle(IpcChannels.MARKET_SEARCH, (_event, query) => searchMods(query, cfKey()))
  ipcMain.handle(IpcChannels.MARKET_GET_DETAIL, (_event, platform, modId, projectType) =>
    getModDetail(platform, modId, cfKey(), projectType)
  )
  ipcMain.handle(IpcChannels.MARKET_GET_VERSIONS, (_event, platform, modId, projectType) =>
    getModVersions(platform, modId, cfKey(), projectType)
  )
  // 安装来源记录只在整合包项目里写：组装器据此判定模组进哪个平台清单，其余项目零变化
  ipcMain.handle(IpcChannels.MARKET_INSTALL, (_event, input: MarketInstallInput) => {
    const target = getAllProjects().find((p) => p.path === input.projectPath)
    const provenance =
      target?.type === 'modpack' ? createProvenanceRecorder(target.path) : undefined
    return installMod(input, cfKey(), createPostInstallHook(ctx.profiles()), provenance)
  })
  ipcMain.handle(IpcChannels.MARKET_TEST_CF, (_event, apiKey: string) => testCurseforgeConnection(apiKey))
  // M16 en→zh 批量翻译（市场卡片/详情 + 社区页内文本共用）
  ipcMain.handle(IpcChannels.TRANSLATE_BATCH, (_event, texts: string[]) =>
    translateToZh(Array.isArray(texts) ? texts.slice(0, 400) : [])
  )
}
