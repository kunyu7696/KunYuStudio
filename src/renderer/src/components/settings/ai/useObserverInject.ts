import { ref } from 'vue'
import type { ObserverStatusState } from './types'

// ---------- 内置 observer-agent 探针状态 ----------
// javaagent 形态：启动游戏时自动挂载，无 mods 注入动作，
// 设置页只需展示内置状态（available / version）。
export function useObserverInject() {
  const observerStatus = ref<ObserverStatusState>({
    available: false,
    version: null,
    injected: false,
    modsDir: null
  })

  async function refreshObserverStatus(): Promise<void> {
    try {
      const s = await window.api.observer.getStatus()
      observerStatus.value = {
        available: !!s.available,
        version: s.version ?? null,
        injected: !!s.injected,
        modsDir: s.modsDir ?? null
      }
    } catch {
      /* 状态查询静默失败，不阻塞设置页 */
    }
  }

  return {
    observerStatus,
    refreshObserverStatus
  }
}
