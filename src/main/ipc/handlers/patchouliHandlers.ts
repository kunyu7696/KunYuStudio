import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { PatchouliBook } from '../../../shared/types/patchouli'
import { deleteBook, listBooks, readBook, saveBook } from '../../services/patchouliService'

/** Patchouli 指南书：config/<namespace>/patchouli_books/<book>/ 直读直写（纯请求-响应） */
export function registerPatchouliHandlers(): void {
  ipcMain.handle(IpcChannels.PATCHOULI_LIST, (_event, root: string) => listBooks(root))
  ipcMain.handle(IpcChannels.PATCHOULI_READ, (_event, root: string, namespace: string, bookId: string) =>
    readBook(root, namespace, bookId)
  )
  ipcMain.handle(
    IpcChannels.PATCHOULI_SAVE,
    (_event, root: string, book: PatchouliBook, prev?: { namespace: string; bookId: string }) =>
      saveBook(root, book, prev)
  )
  ipcMain.handle(
    IpcChannels.PATCHOULI_DELETE,
    (_event, root: string, namespace: string, bookId: string) => deleteBook(root, namespace, bookId)
  )
}
