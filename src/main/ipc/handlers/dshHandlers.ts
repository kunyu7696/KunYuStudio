/**
 * DSH 社区插件兼容宿主 IPC：状态聚合、安装/卸载/重载。
 */
import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { IpcContext } from '../context'
import {
  detectDshEnv,
  installDshPlugin,
  removeDshPlugin
} from '../../services/dsh/dshInstaller'
import { getDshPluginStatuses, loadAllDshPlugins } from '../../services/dsh/dshHost'
import { approvePlugin, revokePlugin } from '../../services/dsh/dshTrust'
import { isDedicatedPlugin, catalogManifestExists, readCatalogEntries, readInstalledRecords } from '../../services/dsh/dshCatalog'
import { bridgeGradleEventsToPet, petStatus, startPet, stopPet } from '../../services/dsh/petService'
import type { DshCatalogState } from '../../../shared/types/dsh'

/** DSH 插件：目录 + 已装 + 宿主加载状态（渲染层 DshView 数据源） */
export function registerDshHandlers(_ctx: IpcContext): void {
  // 手动 Gradle 构建 → 桌宠事件桥（幂等注册，桌宠未启动时事件静默丢弃）
  bridgeGradleEventsToPet()

  ipcMain.handle(IpcChannels.DSH_GET_STATE, async () => {
    const [env, records] = await Promise.all([
      detectDshEnv(),
      loadAllDshPlugins().then(() => {
        return readInstalledRecords()
      })
    ])
    const statuses = getDshPluginStatuses()
    const installedByNpm = new Map(records.map((r) => [r.npm, r]))
    const statusByNpm = new Map(statuses.map((s) => [s.npm, s]))
    const entries = readCatalogEntries().map((entry) => {
      const installed = installedByNpm.get(entry.npm)
      const status = statusByNpm.get(entry.npm)
      return {
        ...entry,
        ...(installed ? { installed } : {}),
        ...(status ? { status } : {})
      }
    })
    const catalogNpms = new Set(entries.map((e) => e.npm))
    // 专用适配层独占的包（dsh-pet）不进通用自定义列表：状态只由专属桌宠卡表达，
    // 避免「已在运行的桌宠」旁边再挂一张永久 PENDING 的重复卡片
    const customs = records
      .filter((r) => !catalogNpms.has(r.npm) && !isDedicatedPlugin(r.npm))
      .map((r) => ({ ...r, status: statusByNpm.get(r.npm) }))
    const state: DshCatalogState = { env, entries, customs }
    // P0-3：清单未随包时显式降级（渲染层给中文提示），而非裸 ENOENT 直出
    state.catalogMissing = !catalogManifestExists()
    return state
  })

  ipcMain.handle(IpcChannels.DSH_INSTALL_PLUGIN, (_e, npmName: string, source: 'catalog' | 'custom') =>
    installDshPlugin(String(npmName ?? ''), source === 'custom' ? 'custom' : 'catalog')
  )

  ipcMain.handle(IpcChannels.DSH_REMOVE_PLUGIN, (_e, npmName: string) =>
    removeDshPlugin(String(npmName ?? ''))
  )

  ipcMain.handle(IpcChannels.DSH_RELOAD, async () => {
    await loadAllDshPlugins()
    return { ok: true }
  })

  // 信任门控：插件在主进程执行，授权/撤销后立即重载宿主让状态生效
  ipcMain.handle(IpcChannels.DSH_SET_TRUST, async (_e, npmName: string, approve: boolean) => {
    const npm = String(npmName ?? '')
    if (!npm) return { ok: false, error: '缺少插件包名' }
    if (approve) {
      if (!approvePlugin(npm)) {
        return { ok: false, error: '无法读取插件包内容（package.json / 入口文件缺失），拒绝授权' }
      }
    } else {
      revokePlugin(npm)
    }
    await loadAllDshPlugins()
    return { ok: true }
  })

  // ---------------- dsh-pet 桌宠（原装插件 + kunyu 宿主适配层） ----------------
  ipcMain.handle(IpcChannels.DSH_PET_START, () => startPet())
  ipcMain.handle(IpcChannels.DSH_PET_STOP, () => stopPet())
  ipcMain.handle(IpcChannels.DSH_PET_STATUS, () => petStatus())
}
