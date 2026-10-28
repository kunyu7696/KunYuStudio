import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { FtbQuestChapter } from '../../../shared/types/ftbquest'
import {
  deleteChapter,
  listChapters,
  readChapter,
  saveChapter
} from '../../services/ftbQuestService'

/** FTB 任务书：config/ftbquests/quests/chapters/*.snbt 章节读写（无推送通道，纯请求-响应） */
export function registerFtbQuestHandlers(): void {
  ipcMain.handle(IpcChannels.FTBQUEST_LIST, (_event, root: string) => listChapters(root))
  ipcMain.handle(IpcChannels.FTBQUEST_READ, (_event, root: string, id: string) =>
    readChapter(root, id)
  )
  ipcMain.handle(
    IpcChannels.FTBQUEST_SAVE,
    (_event, root: string, chapter: FtbQuestChapter, prevId?: string) =>
      saveChapter(root, chapter, prevId)
  )
  ipcMain.handle(IpcChannels.FTBQUEST_DELETE, (_event, root: string, id: string) =>
    deleteChapter(root, id)
  )
}
