import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  deriveCiProjectMeta,
  exportCiWorkflows,
  getCiConfig,
  setCiConfig,
  regenerateWorkflows,
  previewWorkflows as previewCiWorkflows
} from '../../services/ci/ciExportService'
import { derivePackageName, getAllProjects } from '../../services/projectService'
import type { CiConfig } from '../../../shared/types/ci'
import type { IpcContext } from '../context'

/** 特性⑤ CI/CD 集成 */
export function registerCiHandlers(_ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.CI_GET_CONFIG, (_event, projectPath: string) => {
    return getCiConfig(projectPath)
  })
  ipcMain.handle(
    IpcChannels.CI_SET_CONFIG,
    (_event, projectPath: string, config: CiConfig) => {
      setCiConfig(projectPath, config)
    }
  )
  ipcMain.handle(
    IpcChannels.CI_PREVIEW,
    (_event, projectPath: string, config: CiConfig) => {
      const project = getAllProjects().find((p) => p.path === projectPath)
      if (!project || !project.modId) {
        return {} as Record<string, string>
      }
      const meta = deriveCiProjectMeta(project, derivePackageName(project.modId))
      return previewCiWorkflows(projectPath, config, meta)
    }
  )
  ipcMain.handle(
    IpcChannels.CI_EXPORT,
    (_event, projectPath: string, config: CiConfig) => {
      const project = getAllProjects().find((p) => p.path === projectPath)
      if (!project || !project.modId) {
        return { ok: false, workflows: [], buildScripts: [], error: '项目未找到或缺少 modId' }
      }
      const meta = deriveCiProjectMeta(project, derivePackageName(project.modId))
      return exportCiWorkflows(projectPath, config, meta)
    }
  )
  ipcMain.handle(IpcChannels.CI_REGENERATE, (_event, projectPath: string) => {
    const project = getAllProjects().find((p) => p.path === projectPath)
    if (!project || !project.modId) {
      return { ok: false, workflows: [], buildScripts: [], error: '项目未找到或缺少 modId' }
    }
    const meta = deriveCiProjectMeta(project, derivePackageName(project.modId))
    return regenerateWorkflows(projectPath, meta)
  })
}
