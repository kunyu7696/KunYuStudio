<template>
  <div class="pane">
    <header class="pane-head">
      <h2>{{ t('settings.network.title') }}</h2>
      <p>{{ t('settings.network.desc') }}</p>
    </header>

    <!-- 镜像源 -->
    <SettingsSection :title="t('settings.network.mirror')">
      <SettingsRow
        :label="t('settings.network.mirrorSource')"
        :desc="settings.network.mirror === 'china'
          ? t('settings.network.mirrorChinaDesc')
          : t('settings.network.mirrorOfficialDesc')"
        data-setting-id="network-mirror"
      >
        <el-radio-group :model-value="settings.network.mirror" @change="onMirror">
          <el-radio-button value="china">{{ t('settings.network.mirrorChina') }}</el-radio-button>
          <el-radio-button value="official">{{ t('settings.network.mirrorOfficial') }}</el-radio-button>
        </el-radio-group>
      </SettingsRow>
    </SettingsSection>

    <!-- HTTP 代理 -->
    <SettingsSection :title="t('settings.network.proxy')">
      <SettingsRow
        :label="t('settings.network.httpProxy')"
        :desc="localMode === 'custom'
          ? t('settings.network.proxyCustomDesc')
          : localMode === 'none'
            ? t('settings.network.proxyNoneDesc')
            : t('settings.network.proxySystemDesc')"
        data-setting-id="network-proxy-mode"
      >
        <el-radio-group v-model="localMode" @change="onModeChange">
          <el-radio-button value="none">{{ t('settings.network.proxyNone') }}</el-radio-button>
          <el-radio-button value="system">{{ t('settings.network.proxySystem') }}</el-radio-button>
          <el-radio-button value="custom">{{ t('settings.network.proxyCustom') }}</el-radio-button>
        </el-radio-group>
      </SettingsRow>

      <template v-if="localMode === 'custom'">
        <SettingsRow :label="t('settings.network.host')" data-setting-id="network-proxy-host">
          <el-input
            v-model="localHost"
            class="nw-proxy-host"
            :placeholder="t('settings.network.hostPh')"
            spellcheck="false"
          />
        </SettingsRow>
        <SettingsRow :label="t('settings.network.port')" data-setting-id="network-proxy-port">
          <el-input-number
            v-model="localPort"
            :min="1"
            :max="65535"
            :step="1"
            controls-position="right"
            class="nw-proxy-port"
          />
        </SettingsRow>
        <p v-if="proxyError" class="nw-proxy-error">{{ proxyError }}</p>
      </template>
    </SettingsSection>

    <!-- 超时 -->
    <SettingsSection :title="t('settings.network.timeout')">
      <SettingsRow
        :label="t('settings.network.reqTimeout')"
        :desc="t('settings.network.reqTimeoutDesc')"
        data-setting-id="network-timeout"
      >
        <div class="nw-timeout">
          <!-- v-model 直绑 store：拖动即写本地，避免受控回弹；change 时读 store 值落盘 -->
          <el-slider
            v-model="settings.network.timeoutSec"
            :min="10"
            :max="120"
            :step="5"
            @change="onTimeout"
          />
          <span class="nw-timeout-value">{{ settings.network.timeoutSec }} {{ t('settings.seconds') }}</span>
        </div>
      </SettingsRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { useI18n } from '../../i18n'
import type { NetworkSettings } from '../../../../shared/types/settings'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'

const settings = useSettingsStore()
const { t } = useI18n()

// ---------- 镜像源 ----------
function onMirror(v: string | number | boolean | undefined): void {
  if (v === 'china' || v === 'official') {
    void settings.patchSection('network', { mirror: v })
  }
}

// ---------- 代理（本地表单校验，合法才提交） ----------
const localMode = ref<NetworkSettings['proxyMode']>('none')
const localHost = ref('')
const localPort = ref(1)

onMounted(() => {
  syncLocal()
})

watch(
  () => settings.network,
  () => syncLocal(),
  { deep: true }
)

function syncLocal(): void {
  localMode.value = settings.network.proxyMode
  localHost.value = settings.network.proxyHost
  localPort.value = settings.network.proxyPort >= 1 ? settings.network.proxyPort : 1
}

const proxyError = computed(() => {
  if (localMode.value !== 'custom') return ''
  if (!localHost.value.trim()) return t('settings.network.errHostRequired')
  if (!Number.isInteger(localPort.value) || localPort.value < 1 || localPort.value > 65535) {
    return t('settings.network.errPortInvalid')
  }
  return ''
})

function onModeChange(v: string | number | boolean | undefined): void {
  if (v !== 'custom') {
    // 切到非自定义档：直接提交模式
    void settings.patchSection('network', { proxyMode: v as NetworkSettings['proxyMode'] })
    return
  }
  // 切到自定义：若已有合法存量配置直接提交，否则等待输入合法
  if (!proxyError.value) {
    commitCustom()
  }
}

/** 防抖提交：避免每次击键都触发 IPC 落盘 */
let commitTimer: ReturnType<typeof setTimeout> | null = null
watch([localHost, localPort], () => {
  if (localMode.value !== 'custom' || proxyError.value) return
  if (commitTimer) clearTimeout(commitTimer)
  commitTimer = setTimeout(commitCustom, 400)
})
onBeforeUnmount(() => {
  if (commitTimer) clearTimeout(commitTimer)
})

function commitCustom(): void {
  void settings.patchSection('network', {
    proxyMode: 'custom',
    proxyHost: localHost.value.trim(),
    proxyPort: localPort.value
  })
}

// ---------- 超时 ----------
function onTimeout(): void {
  void settings.patchSection('network', { timeoutSec: settings.network.timeoutSec })
}
</script>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  max-width: 760px;
}
.pane-head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.pane-head p {
  margin: 4px 0 16px;
  font-size: 12px;
  color: var(--ky-text-dim);
}
.nw-proxy-host {
  width: 240px;
}
.nw-proxy-port {
  width: 140px;
}
.nw-proxy-error {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-color-danger);
}
.nw-timeout {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 340px;
}
.nw-timeout .el-slider {
  flex: 1;
}
.nw-timeout-value {
  width: 56px;
  text-align: right;
  font-size: 12.5px;
  color: var(--ky-text-sub);
  font-family: var(--ky-font-mono);
}
</style>
