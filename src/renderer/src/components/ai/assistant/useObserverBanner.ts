import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useProjectStore } from '../../../stores/project'
import { useSettingsStore } from '../../../stores/settings'

/** 提示自动消退时长（ms）：5–10s 区间，取 8s */
const HINT_MS = 8_000

/**
 * 内置探针 kunyu-observer-agent 的 AI 助手轻提示。
 * 开关只在「设置 → AI → 内置探针」里操作；这里只负责在探针被关闭时
 * 于 AI 助手顶部提示一次，8 秒后自动消退，不常驻、不提供开关。
 */
export function useObserverBanner(options: { agentMode: { value: boolean } }) {
  const { agentMode } = options
  const projectStore = useProjectStore()
  const settings = useSettingsStore()

  const hintVisible = ref(false)
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const shouldHint = computed(
    () =>
      agentMode.value &&
      !!projectStore.currentProject &&
      settings.ai.observerAutoInject === false
  )

  function clearTimer(): void {
    if (hideTimer !== null) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  function showHint(): void {
    clearTimer()
    hintVisible.value = true
    hideTimer = setTimeout(() => {
      hintVisible.value = false
      hideTimer = null
    }, HINT_MS)
  }

  function dismissHint(): void {
    clearTimer()
    hintVisible.value = false
  }

  watch(shouldHint, (v) => (v ? showHint() : dismissHint()), { immediate: true })
  onBeforeUnmount(clearTimer)

  return { observerHintVisible: hintVisible, dismissObserverHint: dismissHint }
}
