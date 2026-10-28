import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { JavaResolveSymbolsRequest } from '../../../shared/types/java'
import { openProject } from '../../services/projectService'
import { resolveJavaSymbols } from '../../services/javaClassIndex'
import type { IpcContext } from '../context'

/** M4 Java 智能 import：项目源码类索引批量解析 */
export function registerJavaHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IpcChannels.JAVA_RESOLVE_SYMBOLS,
    (_event, input: JavaResolveSymbolsRequest) => {
      try {
        const project = openProject(input.projectId)
        if (!project) {
          return { ok: false as const, error: '未找到该项目，请重新打开项目后再试。' }
        }
        const symbols = Array.from(
          new Set(
            (Array.isArray(input.symbols) ? input.symbols : []).filter(
              (s): s is string => typeof s === 'string' && s.length > 0
            )
          )
        )
        const data = resolveJavaSymbols(project.path, input.packageName ?? '', symbols)
        return { ok: true as const, data }
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
