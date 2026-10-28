import { dialog, ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  createProject,
  deleteProject,
  deriveModId,
  getAllProjects,
  importProject,
  openProject,
  relocateProject
} from '../../services/projectService'
import { registerProjectRoot, unregisterProjectRoot } from '../../services/fsService'
import { isSystemDirectory } from '../../services/systemDirs'
import { startWatching, stopWatching } from '../../services/fileWatcher'
import { upgradeStandaloneResourcePack } from '../../services/resourcepackService'
import { upgradeStandaloneDataPack } from '../../services/datapackService'
import { upgradeStandaloneShaderPack } from '../../services/shaderpackService'
import type { Project } from '../../../shared/types/project'
import type { IpcContext } from '../context'
import { handle } from '../handle'
import { resyncCustomMcpFromSettings } from './aiRuntimeHandlers'

/**
 * 打开/导入独立包项目时的自动升级：
 * 旧占位项目或外部包缺少编辑器元数据时，从现有文件推导并落盘。
 */
function upgradeStandalonePack(project: Project): void {
  if (project.type === 'resourcepack') upgradeStandaloneResourcePack(project.path)
  else if (project.type === 'datapack') upgradeStandaloneDataPack(project.path)
  else if (project.type === 'shaderpack') upgradeStandaloneShaderPack(project.path)
}

/** 项目管理 */
export function registerProjectHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.PROJECT_LIST, () => getAllProjects())
  ipcMain.handle(IpcChannels.PROJECT_CREATE, (_event, input) => {
    // S-03：与 PROJECT_RELOCATE 一致，拒绝系统目录作为项目根，
    // 否则渲染层可把系统目录登记为可写根 → 写任意扩展名 → 持久化 RCE。
    if (isSystemDirectory(input.path)) {
      throw new Error('拒绝把系统目录作为项目根')
    }
    return createProject(input)
  })
  ipcMain.handle(IpcChannels.PROJECT_OPEN, async (_event, id: string) => {
    const project = await openProject(id)
    if (project) {
      // EX-01：必须先登记项目根，upgradeStandalonePack 内部 assertWithinRoot
      // 只认进程内已注册的 allowedRoots；顺序反了会让独立包在全新会话下打开必失败。
      registerProjectRoot(project.path)
      upgradeStandalonePack(project)
      startWatching(project.path, ctx.win)
      ctx.activeProject.current = project.path
      // 项目就绪后重连绑定 __PROJECT_ROOT__ 的自定义 MCP（如 mc-texture-cli）
      void resyncCustomMcpFromSettings(project.path)
    }
    return project
  })
  ipcMain.handle(
    IpcChannels.PROJECT_DELETE,
    async (_event, id: string, deleteFiles: boolean) => {
      const list = await getAllProjects()
      const target = list.find((p) => p.id === id)
      const ok = await deleteProject(id, deleteFiles)
      if (ok && target) {
        unregisterProjectRoot(target.path)
        stopWatching()
      }
      return ok
    }
  )
  ipcMain.handle(IpcChannels.PROJECT_IMPORT, async (_event, path: string) => {
    // S-03：导入路径同样可能是渲染层直供的系统目录，必须拦截。
    if (isSystemDirectory(path)) {
      throw new Error('拒绝把系统目录作为项目根')
    }
    const project = await importProject(path)
    // EX-01：同 PROJECT_OPEN，先登记根再升级，否则独立包导入必因 assertWithinRoot 失败。
    registerProjectRoot(project.path)
    upgradeStandalonePack(project)
    startWatching(project.path, ctx.win)
    ctx.activeProject.current = project.path
    // 项目就绪后重连绑定 __PROJECT_ROOT__ 的自定义 MCP（如 mc-texture-cli）
    void resyncCustomMcpFromSettings(project.path)
    return project
  })
  // PROJECT_RELOCATE：目录被移动/改名后把记录指向新路径。
  // 安全要点：新路径必须来自主进程弹出的 OS 对话框，不信任渲染层传入的 path；
  // 且拒绝系统目录（C:\Windows / Program Files / 启动菜单 / 盘根 / 应用自身），
  // 否则攻击者可经渲染层 XSS 直接 invoke 把系统目录登记为可写根，
  // 再经 FS_WRITE_FILE 写任意扩展名 → 持久化 RCE。
  handle(
    IpcChannels.PROJECT_RELOCATE,
    [{ type: 'string', minLength: 1, maxLength: 128 }],
    async (_event, id: string): Promise<Project | undefined> => {
      const picked = await dialog.showOpenDialog(ctx.win, {
        title: '选择项目新目录',
        properties: ['openDirectory']
      })
      if (picked.canceled || picked.filePaths.length === 0) return undefined
      const newPath = picked.filePaths[0]!
      if (isSystemDirectory(newPath)) {
        throw new Error('拒绝把系统目录登记为项目根')
      }
      const project = relocateProject(id, newPath)
      registerProjectRoot(project.path)
      return project
    }
  )
  ipcMain.handle(IpcChannels.PROJECT_DERIVE_MOD_ID, (_event, name: string) => deriveModId(name))
}
