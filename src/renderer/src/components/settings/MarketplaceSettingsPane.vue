<template>
  <div class="pane">
    <header class="pane-head">
      <h2>{{ t('settings.marketplace.title') }}</h2>
      <p>{{ t('settings.marketplace.desc') }}</p>
    </header>

    <SettingsSection :title="t('settings.marketplace.credentials')">
      <SettingsRow label="CurseForge API Key" data-setting-id="marketplace-curseforge-api-key">
        <div class="mp-key-row">
          <el-input
            v-model="localKey"
            type="password"
            show-password
            :placeholder="t('settings.marketplace.keyPh')"
            spellcheck="false"
            class="mp-key"
          />
          <el-button :loading="testing" @click="testConnection">{{ t('settings.marketplace.testBtn') }}</el-button>
          <el-button type="primary" :disabled="!localKey.trim()" @click="save">{{ t('common.save') }}</el-button>
        </div>
      </SettingsRow>
      <p v-if="testResult" class="mp-result" :class="testResult.ok ? 'ok' : 'err'">
        {{ testResult.ok ? t('settings.marketplace.testOk', { ms: testResult.latencyMs }) : t('settings.marketplace.testFail', { error: testResult.error ?? '' }) }}
      </p>
      <p class="mp-hint">
        {{ t('settings.marketplace.hintA') }}<el-link type="primary" @click="openCf">{{ t('settings.marketplace.hintLink') }}</el-link>{{ t('settings.marketplace.hintB') }}
      </p>
    </SettingsSection>

    <SettingsSection :title="t('settings.marketplace.mirror')">
      <SettingsRow
        :label="t('settings.marketplace.allowMcim')"
        :desc="t('settings.marketplace.mcimDesc')"
        data-setting-id="marketplace-allow-cf-mirror"
      >
        <el-checkbox :model-value="settings.marketplace.allowCfMirror" @change="onToggleMirror" />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection title="Modrinth">
      <SettingsRow
        label="Modrinth"
        :desc="t('settings.marketplace.modrinthDesc')"
        data-setting-id="marketplace-modrinth"
      />
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { useI18n } from '../../i18n'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'

const settings = useSettingsStore()
const { t } = useI18n()

const localKey = ref('')
const testing = ref(false)
const testResult = ref<{ ok: boolean; latencyMs: number; error?: string } | null>(null)

onMounted(() => {
  localKey.value = settings.marketplace.curseforgeApiKey
})

watch(
  () => settings.marketplace.curseforgeApiKey,
  (v) => {
    localKey.value = v
  }
)

async function testConnection(): Promise<void> {
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await window.api.market.testCf(localKey.value.trim())
  } catch (err) {
    testResult.value = { ok: false, latencyMs: 0, error: (err as Error).message }
  } finally {
    testing.value = false
  }
}

async function save(): Promise<void> {
  await settings.patchSection('marketplace', { curseforgeApiKey: localKey.value.trim() })
}

/** 镜像开关即时落盘（P1-10：镜像回退默认关闭，必须显式开启） */
async function onToggleMirror(val: string | number | boolean): Promise<void> {
  await settings.patchSection('marketplace', { allowCfMirror: Boolean(val) })
}

function openCf(): void {
  void window.api.shell.openExternal('https://console.curseforge.com/#/api-keys')
}
</script>

<style scoped>
.pane { display: flex; flex-direction: column; max-width: 760px; }
.pane-head h2 { margin: 0; font-size: 17px; font-weight: 600; }
.pane-head p { margin: 4px 0 16px; font-size: 12px; color: var(--ky-text-dim); }
.mp-key-row { display: flex; gap: 8px; align-items: center; width: 440px; }
.mp-key { flex: 1; }
.mp-result { margin: 0 0 10px; font-size: 12px; }
.mp-result.ok { color: #4ade80; }
.mp-result.err { color: #f87171; }
.mp-hint { margin: 0 0 10px; font-size: 11.5px; color: var(--ky-text-dim); }
</style>
