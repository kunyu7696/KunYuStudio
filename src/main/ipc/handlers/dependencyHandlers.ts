import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { DependencyAddInput } from '../../../shared/types/dependency'
import type { Project } from '../../../shared/types/project'
import { getAllProjects } from '../../services/projectService'
import {
  addProjectDependency,
  readProjectDependencies,
  removeProjectDependency,
  removeProjectRepository
} from '../../services/mavenDependency'
import type { IpcContext } from '../context'

/**
 * 构建依赖（Maven 坐标）IPC。
 * 仅接受已登记的模组项目：依赖改写目标是项目根 build.gradle，
 * 其它项目类型（资源包/数据包/光影/整合包）没有构建脚本语义。
 */
export function registerDependencyHandlers(_ctx: IpcContext): void {
  function findModProject(projectPath: string): Project | null {
    const project = getAllProjects().find((p) => p.path === projectPath)
    if (!project || project.type !== 'mod') return null
    return project
  }

  const missing = { ok: false as const, error: '目标不是已登记的模组项目' }

  ipcMain.handle(IpcChannels.DEPENDENCY_STATE, (_event, projectPath: string) => {
    const project = findModProject(projectPath)
    if (!project) return { dependencies: [], repositories: [], hasBuildGradle: false }
    return readProjectDependencies(project.path)
  })

  ipcMain.handle(
    IpcChannels.DEPENDENCY_ADD,
    (_event, projectPath: string, input: DependencyAddInput) => {
      const project = findModProject(projectPath)
      if (!project) return missing
      return addProjectDependency(project.path, input, project.loader)
    }
  )

  ipcMain.handle(IpcChannels.DEPENDENCY_REMOVE, (_event, projectPath: string, notation: string) => {
    const project = findModProject(projectPath)
    if (!project) return missing
    return removeProjectDependency(project.path, notation)
  })

  ipcMain.handle(
    IpcChannels.DEPENDENCY_REMOVE_REPOSITORY,
    (_event, projectPath: string, url: string) => {
      const project = findModProject(projectPath)
      if (!project) return missing
      return removeProjectRepository(project.path, url)
    }
  )
}
