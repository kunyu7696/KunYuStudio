import { app, ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  importSkillDirectory,
  importSkillFile,
  listSkills,
  readSkillFile,
  reloadSkills,
  removeSkill,
  setSkillEnabled,
  skillRootFromUserData
} from '../../services/ai/skills/store'

/** 全局技能根（`<userData>/workbench-skills`） */
function skillRoot(): string {
  return skillRootFromUserData(app.getPath('userData'))
}

/**
 * 用户技能包：安装 / 启停 / 删除 / 读取 / 重载。
 * 全部为同步文件操作（技能包体积受限额约束），软失败结果直接回渲染层。
 */
export function registerSkillHandlers(): void {
  ipcMain.handle(IpcChannels.SKILL_LIST, () => listSkills(skillRoot()))

  ipcMain.handle(IpcChannels.SKILL_IMPORT_FILE, (_event, path: string) =>
    typeof path === 'string' && path.trim()
      ? importSkillFile(skillRoot(), path)
      : { ok: false, error: '缺少文件路径' }
  )

  ipcMain.handle(IpcChannels.SKILL_IMPORT_DIR, (_event, path: string) =>
    typeof path === 'string' && path.trim()
      ? importSkillDirectory(skillRoot(), path)
      : { ok: false, error: '缺少目录路径' }
  )

  ipcMain.handle(IpcChannels.SKILL_SET_ENABLED, (_event, dirName: string, enabled: boolean) =>
    typeof dirName === 'string' && dirName.trim()
      ? setSkillEnabled(skillRoot(), dirName, enabled === true)
      : { ok: false, error: '缺少技能目录名' }
  )

  ipcMain.handle(IpcChannels.SKILL_REMOVE, (_event, dirName: string) =>
    typeof dirName === 'string' && dirName.trim()
      ? removeSkill(skillRoot(), dirName)
      : { ok: false, error: '缺少技能目录名' }
  )

  ipcMain.handle(IpcChannels.SKILL_READ, (_event, dirName: string, file?: string) => {
    if (typeof dirName !== 'string' || !dirName.trim()) {
      return { ok: false, error: '缺少技能目录名' }
    }
    return readSkillFile(skillRoot(), dirName, typeof file === 'string' ? file : 'SKILL.md')
  })

  ipcMain.handle(IpcChannels.SKILL_RELOAD, () => {
    reloadSkills(skillRoot())
  })
}
