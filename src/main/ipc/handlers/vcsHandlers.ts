import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  addRemote,
  checkoutBranch,
  commit,
  createBranch,
  createTag,
  deleteBranch,
  fetchRemote,
  getCommitDetail,
  getDiff,
  getGitLog,
  getGitStatus,
  getStatusDetail,
  initRepo,
  listArtifacts,
  listBranches,
  listRemotes,
  listTags,
  pull,
  push,
  removeRemote,
  stageAll,
  stageFile,
  unstageFile
} from '../../services/vcsService'
import type { IpcContext } from '../context'

/** 版本与产物（M14） */
export function registerVcsHandlers(_ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.VCS_GET_GIT_LOG, (_e, root: string, limit?: number) =>
    getGitLog(root, limit)
  )
  ipcMain.handle(IpcChannels.VCS_GET_GIT_STATUS, (_e, root: string) => getGitStatus(root))
  ipcMain.handle(IpcChannels.VCS_LIST_ARTIFACTS, (_e, root: string) => listArtifacts(root))
  ipcMain.handle(IpcChannels.VCS_GET_STATUS_DETAIL, (_e, root: string) => getStatusDetail(root))
  ipcMain.handle(IpcChannels.VCS_STAGE_FILE, (_e, root: string, path: string) => stageFile(root, path))
  ipcMain.handle(IpcChannels.VCS_UNSTAGE_FILE, (_e, root: string, path: string) => unstageFile(root, path))
  ipcMain.handle(IpcChannels.VCS_STAGE_ALL, (_e, root: string) => stageAll(root))
  ipcMain.handle(IpcChannels.VCS_COMMIT, (_e, root: string, message: string) => commit(root, message))
  ipcMain.handle(
    IpcChannels.VCS_GET_DIFF,
    (_e, root: string, path: string, staged?: boolean) => getDiff(root, path, staged)
  )
  ipcMain.handle(IpcChannels.VCS_BRANCH_LIST, (_e, root: string) => listBranches(root))
  ipcMain.handle(IpcChannels.VCS_BRANCH_CHECKOUT, (_e, root: string, name: string) => checkoutBranch(root, name))
  ipcMain.handle(
    IpcChannels.VCS_BRANCH_CREATE,
    (_e, root: string, name: string, base?: string) => createBranch(root, name, base)
  )
  ipcMain.handle(IpcChannels.VCS_BRANCH_DELETE, (_e, root: string, name: string) => deleteBranch(root, name))
  ipcMain.handle(IpcChannels.VCS_REMOTE_LIST, (_e, root: string) => listRemotes(root))
  ipcMain.handle(IpcChannels.VCS_INIT, (_e, root: string) => initRepo(root))
  ipcMain.handle(IpcChannels.VCS_REMOTE_ADD, (_e, root: string, name: string, url: string) =>
    addRemote(root, name, url)
  )
  ipcMain.handle(IpcChannels.VCS_REMOTE_REMOVE, (_e, root: string, name: string) =>
    removeRemote(root, name)
  )
  ipcMain.handle(
    IpcChannels.VCS_PUSH,
    (_e, root: string, remote: string, branch: string, setUpstream?: boolean) =>
      push(root, remote, branch, setUpstream)
  )
  ipcMain.handle(IpcChannels.VCS_PULL, (_e, root: string) => pull(root))
  ipcMain.handle(IpcChannels.VCS_FETCH, (_e, root: string) => fetchRemote(root))
  ipcMain.handle(IpcChannels.VCS_COMMIT_DETAIL, (_e, root: string, hash: string) => getCommitDetail(root, hash))
  ipcMain.handle(IpcChannels.VCS_TAG_LIST, (_e, root: string) => listTags(root))
  ipcMain.handle(IpcChannels.VCS_TAG_CREATE, (_e, root: string, name: string, message: string) =>
    createTag(root, name, message)
  )
}
