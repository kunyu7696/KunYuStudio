import { ElMessage } from 'element-plus'
import { renderMarkdown, consumeCode } from '../../../utils/markdown'
import { t } from '../../../i18n'
import type { ChatEntry } from '../../../../../shared/types/ai'

export function useMarkdown() {
  function renderMd(content: string): string {
    return renderMarkdown(content)
  }

  async function writeClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 个别环境剪贴板权限受限：退化到 execCommand
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch {
        return false
      }
    }
  }

  /** 事件委托：v-html 代码块内的「复制」按钮 */
  function onBodyClick(e: MouseEvent): void {
    const target = e.target as HTMLElement | null
    const btn = target?.closest('.md-copy-btn') as HTMLElement | null
    if (!btn) return
    const id = Number(btn.dataset.codeId)
    if (!Number.isFinite(id)) return
    const code = consumeCode(id)
    if (code === undefined) {
      ElMessage.warning(t('assistant.markdown.codeExpired'))
      return
    }
    void writeClipboard(code).then((ok) => {
      if (ok) {
        ElMessage.success(t('assistant.markdown.codeCopied'))
        const old = btn.textContent
        btn.textContent = t('assistant.markdown.copiedLabel')
        window.setTimeout(() => {
          btn.textContent = old
        }, 1200)
      } else {
        ElMessage.error(t('assistant.markdown.copyFailed'))
      }
    })
  }

  /** 助手气泡快捷操作：复制整段 Markdown 原文 */
  async function copyAnswer(entry: ChatEntry): Promise<void> {
    const ok = await writeClipboard(entry.content)
    ElMessage[ok ? 'success' : 'error'](ok ? t('assistant.markdown.answerCopied') : t('assistant.markdown.copyFailed'))
  }

  return {
    renderMd,
    writeClipboard,
    onBodyClick,
    copyAnswer
  }
}
