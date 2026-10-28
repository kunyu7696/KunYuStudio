<template>
  <div class="pane">
    <header class="pane-head">
      <h2>{{ t('settings.publish.title') }}</h2>
      <p>{{ t('settings.publish.desc') }}</p>
    </header>

    <SettingsSection title="Modrinth">
      <SettingsRow :label="t('settings.publish.mrToken')" data-setting-id="publish-modrinth-token">
        <el-input
          v-model="local.modrinthToken"
          type="password"
          show-password
          placeholder="mrp_xxx..."
          spellcheck="false"
          class="pub-input"
        />
      </SettingsRow>
      <SettingsRow :label="t('settings.publish.mrProjectId')" data-setting-id="publish-modrinth-project-id">
        <el-input
          v-model="local.modrinthProjectId"
          :placeholder="t('settings.publish.mrProjectIdPh')"
          spellcheck="false"
          class="pub-input"
        />
      </SettingsRow>
      <p class="pub-hint">
        {{ t('settings.publish.mrHintA') }}<el-link type="primary" @click="openMr">{{ t('settings.publish.mrHintLink') }}</el-link>{{ t('settings.publish.mrHintB') }}
      </p>
    </SettingsSection>

    <SettingsSection title="CurseForge">
      <SettingsRow :label="t('settings.publish.cfToken')" data-setting-id="publish-curseforge-token">
        <el-input
          v-model="local.curseforgeToken"
          type="password"
          show-password
          :placeholder="t('settings.publish.cfTokenPh')"
          spellcheck="false"
          class="pub-input"
        />
      </SettingsRow>
      <SettingsRow :label="t('settings.publish.cfProjectId')" data-setting-id="publish-curseforge-project-id">
        <el-input
          v-model="local.curseforgeProjectId"
          :placeholder="t('settings.publish.cfProjectIdPh')"
          spellcheck="false"
          class="pub-input"
        />
      </SettingsRow>
      <p class="pub-hint">
        {{ t('settings.publish.cfHintA') }}<el-link type="primary" @click="openCf">{{ t('settings.publish.cfHintLink') }}</el-link>{{ t('settings.publish.cfHintB') }}
      </p>
    </SettingsSection>

    <SettingsSection :title="t('settings.common')">
      <SettingsRow :label="t('settings.publish.defaultReleaseType')" data-setting-id="publish-default-release-type">
        <el-radio-group v-model="local.defaultReleaseType">
          <el-radio-button label="release">{{ t('settings.publish.relRelease') }}</el-radio-button>
          <el-radio-button label="beta">{{ t('settings.publish.relBeta') }}</el-radio-button>
          <el-radio-button label="alpha">{{ t('settings.publish.relAlpha') }}</el-radio-button>
        </el-radio-group>
      </SettingsRow>
    </SettingsSection>

    <footer class="pub-actions">
      <el-button type="primary" :disabled="!changed" @click="save">{{ t('common.save') }}</el-button>
      <el-button @click="reset">{{ t('settings.publish.reset') }}</el-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { useSettingsStore } from '../../stores/settings'
import { useI18n } from '../../i18n'
import type { PublishSettings } from '../../../../shared/types/settings'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'

const settings = useSettingsStore()
const { t } = useI18n()

const local = reactive<PublishSettings>({
  modrinthToken: '',
  modrinthProjectId: '',
  curseforgeToken: '',
  curseforgeProjectId: '',
  defaultReleaseType: 'release'
})

onMounted(() => {
  syncFromStore()
})

watch(
  () => settings.publish,
  () => syncFromStore(),
  { deep: true }
)

function syncFromStore(): void {
  const s = settings.publish
  local.modrinthToken = s.modrinthToken
  local.modrinthProjectId = s.modrinthProjectId
  local.curseforgeToken = s.curseforgeToken
  local.curseforgeProjectId = s.curseforgeProjectId
  local.defaultReleaseType = s.defaultReleaseType
}

const changed = computed(() => {
  const s = settings.publish
  return (
    local.modrinthToken !== s.modrinthToken ||
    local.modrinthProjectId !== s.modrinthProjectId ||
    local.curseforgeToken !== s.curseforgeToken ||
    local.curseforgeProjectId !== s.curseforgeProjectId ||
    local.defaultReleaseType !== s.defaultReleaseType
  )
})

async function save(): Promise<void> {
  await settings.patchSection('publish', {
    modrinthToken: local.modrinthToken.trim(),
    modrinthProjectId: local.modrinthProjectId.trim(),
    curseforgeToken: local.curseforgeToken.trim(),
    curseforgeProjectId: local.curseforgeProjectId.trim(),
    defaultReleaseType: local.defaultReleaseType
  })
}

function reset(): void {
  syncFromStore()
}

function openMr(): void {
  void window.api.shell.openExternal('https://modrinth.com/settings/pats')
}
function openCf(): void {
  void window.api.shell.openExternal('https://console.curseforge.com/#/api-keys')
}
</script>

<style scoped>
.pane { display: flex; flex-direction: column; max-width: 760px; }
.pane-head h2 { margin: 0; font-size: 17px; font-weight: 600; }
.pane-head p { margin: 4px 0 16px; font-size: 12px; color: var(--ky-text-dim); }
.pub-input { width: 320px; }
.pub-hint { margin: 0 0 10px; font-size: 11.5px; color: var(--ky-text-dim); }
.pub-actions { margin-top: 4px; display: flex; gap: 8px; }
</style>
