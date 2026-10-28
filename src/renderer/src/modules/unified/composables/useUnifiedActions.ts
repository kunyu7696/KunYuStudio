/**
 * useUnifiedActions：生成代码、反向同步、体检、建模工坊导入导出。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox, ElNotification } from 'element-plus'
import { useProjectStore } from '../../../stores/project'
import { useUnifiedStore } from '../../../stores/unified'
import { t } from '../../../i18n'

export function useUnifiedActions() {
  const projectStore = useProjectStore()
  const store = useUnifiedStore()

  const root = computed(() => projectStore.currentProject?.path || '')

  /** 资源体检进行中（项目级只读扫描） */
  const doctorLoading = ref(false)

  /** 生成代码；存在漂移文件时询问是否覆盖 */
  async function onGenerate(): Promise<void> {
    if (!store.active) return
    // 先确保属性改动已落盘为 flat schema
    const saveErr = await store.save(root.value)
    if (saveErr) {
      ElMessage.error(saveErr)
      return
    }
    const err = await store.generateJava(root.value)
    if (err) {
      ElMessage.error(err)
      return
    }
    if (store.diverged.length) {
      try {
        await ElMessageBox.confirm(
          t('unified.actions.divergedConfirm', { n: store.diverged.length }),
          t('unified.actions.divergedTitle'),
          {
            type: 'warning',
            confirmButtonText: t('unified.actions.overwrite'),
            cancelButtonText: t('unified.actions.keepManual')
          }
        )
        const err2 = await store.generateJava(root.value, [...store.diverged])
        if (err2) ElMessage.error(err2)
        else ElMessage.success(t('unified.actions.overwritten'))
      } catch {
        ElMessage.info(t('unified.actions.keptManual'))
      }
    } else {
      ElMessage.success(t('unified.actions.javaGenerated'))
    }
  }

  /** 反向同步：ModBlocks.java 手改 → 表单 */
  async function onReverseSync(): Promise<void> {
    if (!store.active) return
    const err = await store.reverseSync(root.value)
    if (err) ElMessage.warning(err)
    else ElMessage.success(t('unified.actions.reverseSynced'))
  }

  /** 内容资源体检：项目级只读扫描，结果按错误/警告分级（非模态通知，不遮挡操作） */
  async function onDoctor(): Promise<void> {
    if (!root.value) {
      ElMessage.warning(t('unified.actions.needProject'))
      return
    }
    doctorLoading.value = true
    try {
      const report = await store.runDoctor(root.value)
      if (!report.ok) {
        ElMessage.error(report.error || t('unified.actions.doctorFailed'))
        return
      }
      if (report.issues.length === 0) {
        ElMessage.success(t('unified.actions.doctorPass', { n: report.objectCount }))
        return
      }
      const errors = report.issues.filter((i) => i.level === 'error')
      const warnings = report.issues.filter((i) => i.level === 'warn')
      const lines = report.issues.map((i) => `${i.level === 'error' ? '❌' : '⚠️'} [${i.id}] ${i.message}`)
      // 非模态：右下角常驻通知，用户可继续操作编辑器；逐条阅读后手动关闭
      ElNotification({
        title: t('unified.actions.doctorReportTitle', {
          objects: report.objectCount,
          errors: errors.length,
          warnings: warnings.length
        }),
        message: lines.join('\n'),
        type: errors.length > 0 ? 'error' : 'warning',
        duration: 0,
        position: 'bottom-right',
        customClass: 'uev-doctor-notify'
      })
    } catch (err) {
      ElMessage.error(t('unified.actions.doctorError', { error: (err as Error).message }))
    } finally {
      doctorLoading.value = false
    }
  }

  /** 建模工坊：导入 Blockbench .bbmodel 到当前对象 */
  async function onImportBbmodel(): Promise<void> {
    if (!store.active) return
    const res = await store.importBbmodelIntoActive(root.value)
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(t('unified.actions.importFailed', { error: res.error }))
      return
    }
    ElMessage.success(t('unified.actions.bbImported'))
    if (res.warnings && res.warnings.length > 0) {
      ElMessageBox.alert(res.warnings.map((w) => `· ${w}`).join('\n'), t('unified.actions.importWarnTitle'), {
        confirmButtonText: t('unified.actions.gotIt')
      }).catch(() => undefined)
    }
  }

  /** 建模工坊：导出当前 3D 模型为 .bbmodel */
  async function onExportBbmodel(): Promise<void> {
    const res = await store.exportActiveBbmodel(root.value)
    if (res.canceled) return
    if (res.error) ElMessage.error(t('unified.actions.exportFailed', { error: res.error }))
    else ElMessage.success(t('unified.actions.exported', { path: res.path ?? '' }))
  }

  /** 建模工坊 B2：OBJ → 体素化（先选 8/16/32 分辨率，再弹文件框） */
  async function onImportObj(): Promise<void> {
    if (!store.active) return
    let resolution = 16
    try {
      const picked = await ElMessageBox.prompt(
        t('unified.actions.objResolution'),
        t('unified.actions.objTitle'),
        {
          confirmButtonText: t('unified.actions.objSelectFile'),
          cancelButtonText: t('common.cancel'),
          inputValue: '16',
          inputPattern: /^(8|16|32)$/,
          inputErrorMessage: t('unified.actions.objResolutionInvalid')
        }
      )
      resolution = Number(picked.value)
    } catch {
      return // 用户取消
    }
    const res = await store.importObjIntoActive(root.value, resolution)
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(t('unified.actions.objFailed', { error: res.error }))
      return
    }
    ElMessage.success(t('unified.actions.objImported'))
    if (res.warnings && res.warnings.length > 0) {
      ElMessageBox.alert(res.warnings.map((w) => `· ${w}`).join('\n'), t('unified.actions.objWarnTitle'), {
        confirmButtonText: t('unified.actions.gotIt')
      }).catch(() => undefined)
    }
  }

  return {
    doctorLoading,
    onGenerate,
    onReverseSync,
    onDoctor,
    onImportBbmodel,
    onExportBbmodel,
    onImportObj
  }
}
