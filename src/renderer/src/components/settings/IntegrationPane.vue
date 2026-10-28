<template>
  <div class="pane">
    <header class="pane-head">
      <h2>{{ t('settings.integration.title') }}</h2>
      <p>{{ t('settings.integration.desc') }}</p>
    </header>

    <!-- 外部 Agent CLI -->
    <SettingsSection :title="t('settings.integration.agentSection')">
      <p class="it-hint">{{ t('settings.integration.agentHint') }}</p>
      <SettingsRow
        v-for="agent in agents"
        :key="agent.id"
        :label="agent.name"
        :data-setting-id="`integration-agent-${agent.id}`"
      >
        <span class="ext-dot" :class="dotClass(agent)"></span>
        <el-input
          v-model="agentPaths[agent.id]"
          :placeholder="agent.found ? agent.path : t('settings.integration.pathPh')"
          spellcheck="false"
          class="it-agent-path"
          @change="savePath(agent.id)"
        />
        <span class="it-agent-ver">{{ agent.found ? agent.version || t('settings.integration.detected') : t('settings.integration.notDetected') }}</span>
      </SettingsRow>
      <div class="it-actions">
        <el-button :loading="detecting" @click="detect">{{ t('settings.integration.redetect') }}</el-button>
        <span v-if="detectError" class="it-err">{{ detectError }}</span>
      </div>
    </SettingsSection>

    <!-- 派发任务给外部 Agent（KunYu 作为 client 调 CLI） -->
    <SettingsSection :title="t('settings.integration.dispatchSection')">
      <SettingsRow
        :label="t('settings.integration.enableDispatch')"
        :desc="t('settings.integration.enableDispatchDesc')"
        data-setting-id="integration-external-agent-enabled"
      >
        <el-switch
          :model-value="settings.integration.externalAgentEnabled"
          :active-text="t('settings.integration.allowDispatch')"
          @change="toggleExternalAgent"
        />
      </SettingsRow>
      <template v-if="settings.integration.externalAgentEnabled">
      <p class="it-hint">
        {{ t('settings.integration.dispatchA1') }}<strong>{{ t('settings.integration.dispatchStrong') }}</strong>{{ t('settings.integration.dispatchA2') }}<code>read-only</code>{{ t('settings.integration.dispatchA3') }}<code>workspace-write</code> / <code>acceptEdits</code>{{ t('settings.integration.dispatchA4') }}
      </p>
      <p class="it-hint">
        {{ t('settings.integration.loginA') }}<code>codex login</code>{{ t('settings.integration.loginB') }}<code>claude</code>{{ t('settings.integration.loginC') }}
      </p>
      <p class="it-hint it-warn">
        {{ t('settings.integration.warnA') }}<strong>{{ t('settings.integration.warnStrong') }}</strong>{{ t('settings.integration.warnB') }}
      </p>
      <SettingsRow :label="t('settings.integration.targetAgent')" data-setting-id="integration-run-agent">
        <el-select
          v-model="agentRunner.agentId"
          size="small"
          style="width: 200px"
          :disabled="agentRunner.running"
          :placeholder="t('settings.integration.selectCliPh')"
        >
          <el-option
            v-for="a in foundAgents"
            :key="a.id"
            :value="a.id"
            :label="`${a.name} · ${a.version || t('settings.integration.detected')}`"
          />
        </el-select>
        <span class="it-agent-ver">{{ projectPath || t('topbar.noProject') }}</span>
      </SettingsRow>
      <SettingsRow
        :label="t('settings.integration.allowWrite')"
        :desc="t('settings.integration.allowWriteDesc')"
        data-setting-id="integration-run-write"
      >
        <el-switch v-model="agentRunner.writeAccess" :disabled="agentRunner.running" />
      </SettingsRow>
      <div class="it-run">
        <el-input
          v-model="agentRunner.prompt"
          type="textarea"
          :rows="3"
          resize="vertical"
          :disabled="agentRunner.running"
          :placeholder="t('settings.integration.promptPh')"
        />
        <div class="it-actions">
          <el-button
            type="primary"
            :loading="agentRunner.starting"
            :disabled="agentRunner.running || !canRun"
            @click="startRun"
          >
            {{ t('settings.integration.run') }}
          </el-button>
          <el-button :disabled="!agentRunner.running" @click="agentRunner.stop()">{{ t('settings.integration.stop') }}</el-button>
          <span
            v-if="agentRunner.exit"
            class="it-exit"
            :class="agentRunner.exit.ok ? 'is-ok' : 'is-fail'"
          >
            {{ t('settings.integration.exitCode', { code: agentRunner.exit.code ?? '—' }) }} · {{ (agentRunner.exit.durationMs / 1000).toFixed(1) }}s
            <template v-if="agentRunner.exit.signal"> · {{ t('settings.integration.signal') }} {{ agentRunner.exit.signal }}</template>
          </span>
          <span v-else-if="agentRunner.running" class="it-exit">{{ t('settings.integration.running') }}</span>
        </div>
        <pre v-if="agentRunner.log" class="it-log">{{ agentRunner.log }}</pre>
      </div>
      </template>
    </SettingsSection>

    <!-- MCP 桥接 -->
    <SettingsSection :title="t('settings.integration.bridgeSection')">
      <p class="it-hint">
        {{ t('settings.integration.bridgeHint') }}
      </p>
      <SettingsRow
        label="MCP 桥接"
        :desc="t('settings.integration.bridgeDesc')"
        data-setting-id="integration-mcp-bridge-enabled"
      >
        <span class="ext-dot" :class="bridgeDotClass"></span>
        <el-switch
          :model-value="settings.integration.mcpBridgeEnabled"
          :active-text="t('settings.integration.enableBridge')"
          @change="toggleBridge"
        />
      </SettingsRow>
      <SettingsRow
        :label="t('settings.integration.port')"
        :desc="t('settings.integration.portDesc')"
        data-setting-id="integration-mcp-bridge-port"
      >
        <el-input-number
          :model-value="settings.integration.mcpBridgePort"
          :min="0"
          :max="65535"
          size="small"
          :disabled="bridge.running"
          @change="savePort"
        />
      </SettingsRow>
      <SettingsRow
        :label="t('settings.integration.authMode')"
        data-setting-id="integration-mcp-auth-mode"
      >
        <el-select
          :model-value="settings.integration.mcpAuthMode"
          size="small"
          style="width: 220px"
          @change="saveAuthMode"
        >
          <el-option value="session" :label="t('settings.integration.authSession')" />
          <el-option value="always" :label="t('settings.integration.authAlways')" />
        </el-select>
      </SettingsRow>
      <template v-if="bridge.running">
        <p class="it-endpoint">
          {{ t('settings.integration.endpoint') }}<code>{{ bridge.endpoint }}</code>
          {{ t('settings.integration.toolsExposed', { n: bridge.toolCount }) }}<span v-if="bridge.pendingAuth">{{ t('settings.integration.pendingAuth', { n: bridge.pendingAuth }) }}</span>{{ t('settings.integration.pendingEnd') }}
        </p>
        <p class="it-endpoint">
          {{ t('settings.integration.accessToken') }}<code>{{ bridge.token ?? '' }}</code>
        </p>
        <p class="it-hint">
          {{ t('settings.integration.tokenA') }}<code>Authorization: Bearer {{ bridge.token ?? '' }}</code>{{ t('settings.integration.tokenB') }}<code>x-kunyu-token</code>{{ t('settings.integration.tokenC') }}<code>?token=</code>{{ t('settings.integration.tokenD') }}
        </p>
      </template>
      <p v-else-if="bridge.error" class="it-err">{{ t('settings.integration.startFail', { error: bridge.error }) }}</p>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../../stores/settings'
import { useProjectStore } from '../../stores/project'
import { useExternalAgentStore } from '../../stores/externalAgent'
import { useI18n } from '../../i18n'
import type { ExternalAgentInfo, McpBridgeStatus } from '../../../../shared/types/integration'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'

const settings = useSettingsStore()
const project = useProjectStore()
const agentRunner = useExternalAgentStore()
const { t } = useI18n()

const agents = ref<ExternalAgentInfo[]>([])
const agentPaths = reactive<Record<'codex' | 'claude-code', string>>({ codex: '', 'claude-code': '' })
const detecting = ref(false)
const detectError = ref('')

const bridge = ref<McpBridgeStatus>({
  running: false,
  port: 0,
  toolCount: 0,
  pendingAuth: 0,
  endpoint: ''
})

let statusTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  agentPaths.codex = settings.integration.codexPath
  agentPaths['claude-code'] = settings.integration.claudeCodePath
  agentRunner.attach()
  await detect()
  await refreshBridgeStatus()
  // 桥接状态轮询（待授权计数等）
  statusTimer = setInterval(refreshBridgeStatus, 3000)
})

onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer)
})

function dotClass(agent: ExternalAgentInfo): Record<string, boolean> {
  return { 'is-ok': agent.found, 'is-fail': !agent.found }
}

const bridgeDotClass = computed<Record<string, boolean>>(() => ({
  'is-ok': bridge.value.running,
  'is-fail': !bridge.value.running && !!bridge.value.error,
  'is-idle': !bridge.value.running && !bridge.value.error
}))

async function detect(): Promise<void> {
  detecting.value = true
  detectError.value = ''
  try {
    agents.value = await window.api.integration.detectAgents()
  } catch (err) {
    detectError.value = (err as Error).message
  } finally {
    detecting.value = false
  }
}

async function refreshBridgeStatus(): Promise<void> {
  try {
    bridge.value = await window.api.integration.getBridgeStatus()
  } catch {
    /* 面板轮询失败静默 */
  }
}

async function savePath(id: 'codex' | 'claude-code'): Promise<void> {
  const patch =
    id === 'codex' ? { codexPath: agentPaths.codex.trim() } : { claudeCodePath: agentPaths['claude-code'].trim() }
  await settings.patchSection('integration', patch)
  await detect()
}

async function toggleBridge(val: string | number | boolean): Promise<void> {
  const enabled = Boolean(val)
  await settings.patchSection('integration', { mcpBridgeEnabled: enabled })
  try {
    bridge.value = enabled
      ? await window.api.integration.startBridge()
      : await window.api.integration.stopBridge()
  } catch (err) {
    ElMessage.error(t('settings.integration.bridgeOpFailed', { error: (err as Error).message }))
    return
  }
  if (enabled && !bridge.value.running) {
    ElMessage.error(t('settings.integration.bridgeStartFailed', { error: bridge.value.error ?? t('settings.unknownError') }))
  }
}

async function savePort(port: number | undefined): Promise<void> {
  if (!port) return
  await settings.patchSection('integration', { mcpBridgePort: port })
}

async function saveAuthMode(mode: string | number | boolean): Promise<void> {
  await settings.patchSection('integration', {
    mcpAuthMode: mode === 'always' ? 'always' : 'session'
  })
}

/** 外部 Agent 派发总开关（默认关闭） */
async function toggleExternalAgent(value: string | number | boolean): Promise<void> {
  await settings.patchSection('integration', { externalAgentEnabled: value === true })
}

// ---------------------------------------------------------------- 外部 Agent 派发

const foundAgents = computed(() => agents.value.filter((a) => a.found))
const projectPath = computed(() => project.currentProject?.path ?? '')
const canRun = computed(
  () => !!projectPath.value && !!agentRunner.agentId && agentRunner.prompt.trim().length > 0
)

// 检测完成后自动选中第一个可用的 CLI
watch(
  foundAgents,
  (list) => {
    if (!agentRunner.agentId && list.length > 0) agentRunner.agentId = list[0].id
  },
  { immediate: true }
)

async function startRun(): Promise<void> {
  if (agentRunner.writeAccess) {
    try {
      await ElMessageBox.confirm(
        t('settings.integration.writeConfirmBody'),
        t('settings.integration.writeConfirmTitle'),
        {
          type: 'warning',
          confirmButtonText: t('settings.integration.writeConfirmOk'),
          cancelButtonText: t('settings.integration.writeConfirmCancel')
        }
      )
    } catch {
      agentRunner.writeAccess = false
      return
    }
  }
  try {
    await agentRunner.run(projectPath.value)
  } catch (err) {
    ElMessage.error(t('settings.integration.dispatchFailed', { error: (err as Error).message }))
  }
}
</script>

<style scoped>
.pane { display: flex; flex-direction: column; max-width: 760px; }
.pane-head h2 { margin: 0; font-size: 17px; font-weight: 600; }
.pane-head p { margin: 4px 0 16px; font-size: 12px; color: var(--ky-text-dim); }
.it-hint { margin: 10px 0; font-size: 11.5px; color: var(--ky-text-dim); }
.it-hint code { background: var(--ky-bg-hover); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
.it-actions { display: flex; gap: 10px; align-items: center; padding: 4px 0 10px; }
.it-agent-path { width: 280px; }
.it-agent-ver { width: 130px; flex-shrink: 0; font-size: 11.5px; color: var(--ky-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.it-endpoint { margin: 8px 0 0; font-size: 12px; color: var(--ky-text-sub); }
.it-endpoint code { background: var(--ky-bg-hover); padding: 2px 6px; border-radius: 4px; font-size: 11.5px; }
.it-err { font-size: 12px; color: #f87171; }
.it-warn { color: var(--el-color-warning); }
.it-run { display: flex; flex-direction: column; gap: 8px; padding: 4px 0 8px; }
.it-exit { font-size: 12px; color: var(--ky-text-dim); }
.it-exit.is-ok { color: var(--ky-accent); }
.it-exit.is-fail { color: var(--el-color-danger); }
.it-log {
  margin: 0;
  padding: 8px 10px;
  max-height: 320px;
  overflow: auto;
  background: var(--ky-bg-hover);
  border-radius: 4px;
  font-family: var(--ky-font-mono, Consolas, monospace);
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--ky-text-sub);
}
.ext-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ky-text-dim); flex-shrink: 0; }
.ext-dot.is-ok { background: var(--ky-accent); box-shadow: 0 0 6px rgba(var(--ky-accent-rgb), 0.7); }
.ext-dot.is-fail { background: var(--el-color-danger); }
.ext-dot.is-idle { background: var(--ky-text-dim); }
</style>
