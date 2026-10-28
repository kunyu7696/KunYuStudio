import { useUiStore } from '../../../stores/ui'

export function useResize() {
  const ui = useUiStore()

  // ---------- 左缘拖拽调宽 ----------
  function startResize(e: MouseEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = ui.aiPanelWidth
    const onMove = (ev: MouseEvent): void => {
      // 面板在右侧：向左拖增大宽度
      ui.setAiPanelWidth(startWidth + (startX - ev.clientX))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return {
    startResize
  }
}
