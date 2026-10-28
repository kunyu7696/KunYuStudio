<template>
  <!--
    无 DOM：仅在合适时机弹出一次非阻断通知。
    提醒「坤宇可适配 DSH 社区插件与 dsh-pet 桌宠」，但不自动安装——
    dsh-pet 是第三方社区作品（MIT），坤宇不随包分发，安装必须由用户显式触发。
  -->
  <span hidden />
</template>

<script setup lang="ts">
/**
 * 首启 DSH 提醒（与新手引导同模式：localStorage 记一次，帮助菜单可再进 DSH 页）：
 * - 已永久关闭（kunyu:dsh-first-run-hint-dismissed）→ 不弹；
 * - 全新用户首启当次让位给新手引导（尚未 onboarded）→ 下次启动再提示；
 * - 已装 dsh-pet → 不弹；
 * - 通知被关闭（暂不 / 去看看 / 自动消失）即持久化，只提醒一次。
 */
import { h, onMounted } from 'vue'
import type { NotificationHandle } from 'element-plus'
import { ElNotification } from 'element-plus'
import { useUiStore } from '../../stores/ui'
import { t } from '../../i18n'

const HINT_DISMISSED_KEY = 'kunyu:dsh-first-run-hint-dismissed'
const ONBOARDED_KEY = 'kunyu:onboarded'

/** 让位首启引导 + 窗口就绪，延迟探测 */
const HINT_DELAY_MS = 2600

const ui = useUiStore()

onMounted(() => {
  setTimeout(() => {
    void probeAndHint()
  }, HINT_DELAY_MS)
})

function dismiss(hint: NotificationHandle): void {
  localStorage.setItem(HINT_DISMISSED_KEY, '1')
  hint.close()
}

function goDsh(hint: NotificationHandle): void {
  localStorage.setItem(HINT_DISMISSED_KEY, '1')
  hint.close()
  ui.setActiveModule('dsh-plugins')
}

async function probeAndHint(): Promise<void> {
  if (localStorage.getItem(HINT_DISMISSED_KEY)) return
  if (!localStorage.getItem(ONBOARDED_KEY)) return
  let status: { petInstalled: boolean; sourceAvailable: boolean }
  try {
    status = await window.api.dsh.petStatus()
  } catch {
    // 状态通道异常不打扰用户，DSH 页内仍可自行查看
    return
  }
  if (status.petInstalled) return
  const body = status.sourceAvailable ? t('dshHint.bodyWithDesktop') : t('dshHint.bodyWithoutDesktop')
  const hint = ElNotification({
    title: t('dshHint.title'),
    position: 'bottom-right',
    duration: 12000,
    customClass: 'ky-dsh-hint',
    message: h('div', { class: 'ky-dsh-hint-body' }, [
      h('p', { class: 'ky-dsh-hint-text' }, body),
      h('div', { class: 'ky-dsh-hint-actions' }, [
        h(
          'button',
          {
            class: 'ky-dsh-hint-btn ky-dsh-hint-btn-primary',
            type: 'button',
            onClick: () => goDsh(hint)
          },
          t('dshHint.go')
        ),
        h(
          'button',
          {
            class: 'ky-dsh-hint-btn',
            type: 'button',
            onClick: () => dismiss(hint)
          },
          t('dshHint.later')
        )
      ])
    ]),
    onClose: () => {
      // 自动消失（12s）也算处理过：只提醒一次，避免每次启动打扰
      localStorage.setItem(HINT_DISMISSED_KEY, '1')
    }
  })
}
</script>

<style>
/* ElNotification 传送至 body，scoped 选择器触达不到，需全局样式（customClass 限定） */
.ky-dsh-hint {
  width: 380px;
}
.ky-dsh-hint .ky-dsh-hint-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 2px 0;
}
.ky-dsh-hint .ky-dsh-hint-text {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ky-text-sub, #606266);
}
.ky-dsh-hint .ky-dsh-hint-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.ky-dsh-hint .ky-dsh-hint-btn {
  padding: 4px 14px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--ky-border, #dcdfe6);
  background: var(--ky-bg-base, #fff);
  color: var(--ky-text, #303133);
  cursor: pointer;
  transition: all 0.15s ease;
}
.ky-dsh-hint .ky-dsh-hint-btn:hover {
  border-color: var(--ky-accent, #409eff);
  color: var(--ky-accent, #409eff);
}
.ky-dsh-hint .ky-dsh-hint-btn-primary {
  background: var(--ky-accent, #409eff);
  border-color: var(--ky-accent, #409eff);
  color: #fff;
}
.ky-dsh-hint .ky-dsh-hint-btn-primary:hover {
  opacity: 0.9;
  color: #fff;
}
</style>
