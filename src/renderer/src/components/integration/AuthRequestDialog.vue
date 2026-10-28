<template>
  <el-dialog
    v-model="visible"
    :title="t('authDialog.title')"
    width="480px"
    :close-on-click-modal="false"
    :show-close="false"
    append-to-body
  >
    <div v-if="current" class="auth-body">
      <p class="auth-lead">
        {{ t('authDialog.lead') }}
      </p>
      <div class="auth-tool">
        <span class="auth-tool-name">{{ current.tool }}</span>
        <span v-if="current.group" class="auth-tool-group" :class="`group-${current.group}`">
          {{ groupLabel(current.group) }}
        </span>
      </div>
      <pre v-if="current.argsSummary" class="auth-args">{{ current.argsSummary }}</pre>
      <p class="auth-warn">{{ t('authDialog.warn') }}</p>
    </div>
    <template #footer>
      <el-button type="danger" plain @click="decide(false, false)">{{ t('authDialog.deny') }}</el-button>
      <el-button @click="decide(true, false)">{{ t('authDialog.allowOnce') }}</el-button>
      <el-button
        v-if="authMode === 'session'"
        type="primary"
        @click="decide(true, true)"
      >{{ t('authDialog.allowSession') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { McpAuthRequest } from '../../../../shared/types/integration'
import { useSettingsStore } from '../../stores/settings'
import { t } from '../../i18n'

/**
 * 全局 MCP 桥接授权弹窗：外部 agent 调用写/敏感工具时主进程挂起执行并推送
 * integration:auth-request，用户在此手动决定；决定经 respondAuth 回传。
 * 多个请求排队依次展示。
 */
const settings = useSettingsStore()
const queue = ref<McpAuthRequest[]>([])
const visible = ref(false)

const current = computed(() => queue.value[0] ?? null)
const authMode = computed(() => settings.integration.mcpAuthMode)

function groupLabel(group: string): string {
  switch (group) {
    case 'read':
      return t('authDialog.groupRead')
    case 'interact':
      return t('authDialog.groupInteract')
    case 'admin':
      return t('authDialog.groupAdmin')
    default:
      return group
  }
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  // preload 热重载滞后期间 api.integration 可能不存在，防御式订阅
  unsubscribe = window.api.integration?.onAuthRequest?.((req) => {
    queue.value.push(req)
    visible.value = true
  }) ?? null
})

onBeforeUnmount(() => {
  unsubscribe?.()
})

function decide(allow: boolean, rememberSession: boolean): void {
  const req = current.value
  if (!req) return
  void window.api.integration.respondAuth({ requestId: req.requestId, allow, rememberSession })
  queue.value.shift()
  if (queue.value.length === 0) visible.value = false
}
</script>

<style scoped>
.auth-body { display: flex; flex-direction: column; gap: 10px; }
.auth-lead { margin: 0; font-size: 13px; color: var(--ky-text); }
.auth-tool { display: flex; align-items: center; }
.auth-tool-name {
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.1);
  padding: 3px 10px;
  border-radius: 4px;
}
.auth-args {
  margin: 0;
  padding: 8px 10px;
  max-height: 160px;
  overflow: auto;
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-control);
  font-size: 11.5px;
  color: var(--ky-text-sub);
  white-space: pre-wrap;
  word-break: break-all;
}
.auth-warn { margin: 0; font-size: 11.5px; color: var(--ky-text-dim); }
.auth-tool-group {
  margin-left: 8px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}
.group-read { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
.group-interact { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
.group-admin { background: rgba(248, 113, 113, 0.15); color: #f87171; }
</style>
