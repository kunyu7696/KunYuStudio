/**
 * 「加入组装」共用逻辑：ModLibraryPanel 卡片按钮与 ModpackView 拖放共用。
 * 真机反馈 P2-9：拖放是唯一入口，触屏/键盘/远程桌面无替代路径。
 * 抽出后两处行为一致：项目类型校验、按资源类型分流落盘、覆盖确认、store.refresh、异常兜底。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { t } from '../../i18n'
import type { ModLibraryEntry } from '../../../../shared/types/modLibrary'
import type { useModpackStore } from '../../stores/modpack'

type ModpackStore = ReturnType<typeof useModpackStore>

export interface AddLibraryModOptions {
  /** 当前项目根（来自 projectStore.currentProject?.path） */
  projectPath: string | undefined
  /** 当前项目类型（必须为 modpack） */
  projectType: string | undefined
  /** 组装计划 store，用于成功后刷新 */
  store: ModpackStore
}

/** 各资源类型的目标目录展示名（成功/冲突提示用；datapack 动态带存档名） */
const TARGET_TEXT: Record<string, string> = {
  mod: 'run/mods',
  resourcepack: 'run/resourcepacks',
  shader: 'run/shaderpacks'
}

/** 数据包落盘前选目标存档：唯一存档直接用；多存档弹选择框；无存档提示先建世界 */
async function pickDatapackWorld(projectPath: string): Promise<string | null> {
  let worlds: string[]
  try {
    worlds = await window.api.modlib.listWorlds(projectPath)
  } catch {
    worlds = []
  }
  if (worlds.length === 0) {
    ElMessage.warning(t('modlib.noWorlds'))
    return null
  }
  if (worlds.length === 1) return worlds[0]
  const worldList = worlds.join(', ')
  try {
    const { value } = await ElMessageBox.prompt(
      t('modlib.chooseWorldPrompt', { worlds: worldList }),
      t('modlib.chooseWorldTitle'),
      {
        confirmButtonText: t('modlib.confirm'),
        cancelButtonText: t('modlib.cancel'),
        inputPlaceholder: worlds[0],
        inputValidator: (v: string) =>
          worlds.includes(v?.trim()) || t('modlib.chooseWorldInvalid', { worlds: worldList })
      }
    )
    return (value as string).trim()
  } catch {
    return null
  }
}

/**
 * 把资源库条目加入当前整合包：按资源类型分流
 * （mod→run/mods，resourcepack→run/resourcepacks，shader→run/shaderpacks，
 *  datapack→run/saves/<世界名>/datapacks，modpack 拒绝并提示从新建项目导入）。
 * @returns 是否真正写入了（用户取消覆盖/取消选世界视为未写入）
 */
export async function addLibraryModToProject(
  opts: AddLibraryModOptions,
  entry: Pick<ModLibraryEntry, 'fileName' | 'name'> & Partial<Pick<ModLibraryEntry, 'resourceType'>>
): Promise<boolean> {
  const { projectPath, projectType, store } = opts
  if (!projectPath || projectType !== 'modpack') {
    ElMessage.warning(t('modlib.needModpack'))
    return false
  }
  const resourceType = entry.resourceType ?? 'mod'
  if (resourceType === 'modpack') {
    ElMessage.info(t('modlib.modpackImportHint'))
    return false
  }
  let worldName: string | undefined
  let targetText = TARGET_TEXT[resourceType] ?? 'run/mods'
  if (resourceType === 'datapack') {
    const world = await pickDatapackWorld(projectPath)
    if (!world) return false
    worldName = world
    targetText = `run/saves/${world}/datapacks`
  }
  try {
    const result = await window.api.modlib.addToProject(projectPath, entry.fileName, undefined, worldName)
    if (result.ok) {
      ElMessage.success(
        t('modlib.added', {
          name: entry.name || entry.fileName,
          target: result.message ?? targetText
        })
      )
      await store.refresh(projectPath)
      return true
    }
    if (result.conflict) {
      try {
        await ElMessageBox.confirm(
          t('modlib.conflictConfirm', { target: targetText, file: entry.fileName }),
          t('modlib.conflictTitle'),
          {
            type: 'warning',
            confirmButtonText: t('modlib.overwrite'),
            cancelButtonText: t('modlib.cancel')
          }
        )
      } catch {
        return false
      }
      const overwrite = await window.api.modlib.addToProject(projectPath, entry.fileName, true, worldName)
      if (overwrite.ok) {
        ElMessage.success(t('modlib.overwritten'))
        await store.refresh(projectPath)
        return true
      }
      ElMessage.error(overwrite.error ?? t('modlib.overwriteFailed'))
      return false
    }
    ElMessage.error(result.error ?? t('modlib.addFailed'))
    return false
  } catch (err) {
    ElMessage.error(t('modlib.addFailedDetail', { error: (err as Error).message }))
    return false
  }
}
