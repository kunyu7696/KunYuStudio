import { nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAiChatStore } from '../../../stores/aiChat'
import { t } from '../../../i18n'

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function useSessionManagement(options: { focusInput: () => void }) {
  const chat = useAiChatStore()

  function onNewSession(): void {
    chat.newSession()
    void nextTick(() => options.focusInput())
  }

  function onSelectSession(id: string): void {
    chat.selectSession(id)
  }

  async function onRenameSession(id: string, current: string): Promise<void> {
    let value = ''
    try {
      const res = await ElMessageBox.prompt(t('assistant.session.renamePrompt'), t('assistant.session.renameTitle'), {
        inputValue: current,
        confirmButtonText: t('common.save'),
        cancelButtonText: t('common.cancel')
      })
      value = res.value ?? ''
    } catch {
      return
    }
    if (value.trim()) chat.renameSession(id, value.trim())
  }

  async function onDeleteSession(id: string, title: string): Promise<void> {
    try {
      await ElMessageBox.confirm(t('assistant.session.deleteConfirm', { title }), t('assistant.session.deleteTitle'), {
        type: 'warning',
        confirmButtonText: t('assistant.deleteBtn'),
        cancelButtonText: t('common.cancel')
      })
    } catch {
      return
    }
    chat.removeSession(id)
    ElMessage.success(t('assistant.session.deleted'))
  }

  async function onClear(): Promise<void> {
    try {
      await ElMessageBox.confirm(t('assistant.session.clearConfirm'), t('assistant.session.clearTitle'), {
        type: 'warning',
        confirmButtonText: t('assistant.session.clearBtn'),
        cancelButtonText: t('common.cancel')
      })
    } catch {
      return
    }
    chat.clearCurrent()
  }

  async function onExportSession(id: string): Promise<void> {
    const out = chat.sessionMarkdown(id)
    if (!out) return
    const dir = await window.api.dialog.selectDirectory()
    if (!dir) return
    const safe = out.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'chat'
    const stamp = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const suffix = `${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}`
    const target = `${dir.replace(/[\\/]+$/, '')}\\${safe}-${suffix}.md`
    try {
      await window.api.fs.writeFile(target, out.markdown)
      ElMessage.success(t('assistant.session.exported', { path: target }))
    } catch (e) {
      ElMessage.error(t('assistant.session.exportFailed', { msg: e instanceof Error ? e.message : String(e) }))
    }
  }

  return {
    chat,
    formatTime,
    onNewSession,
    onSelectSession,
    onRenameSession,
    onDeleteSession,
    onClear,
    onExportSession
  }
}
