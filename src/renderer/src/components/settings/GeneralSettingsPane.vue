<template>
  <div class="pane">
    <header class="pane-head">
      <h2>{{ t('settings.generalTitle') }}</h2>
      <p>{{ t('settings.generalDesc') }}</p>
    </header>

    <SettingsSection :title="t('settings.appearance')">
      <SettingsRow
        :label="t('settings.themeMode')"
        :desc="t('settings.themeModeDesc')"
        data-setting-id="general-theme-mode"
      >
        <el-radio-group
          :model-value="settings.general.themeMode"
          size="small"
          @update:model-value="onThemeMode"
        >
          <el-radio-button value="system">{{ t('settings.themeSystem') }}</el-radio-button>
          <el-radio-button value="dark">{{ t('settings.themeDark') }}</el-radio-button>
          <el-radio-button value="light">{{ t('settings.themeLight') }}</el-radio-button>
        </el-radio-group>
      </SettingsRow>

      <SettingsRow
        :label="t('settings.language')"
        :desc="t('settings.languageDesc')"
        data-setting-id="general-language"
      >
        <el-select
          :model-value="settings.general.locale"
          size="small"
          class="language-select"
          @update:model-value="onLocale"
        >
          <el-option value="zh-CN" label="简体中文" />
          <el-option value="en-US" label="English" />
          <el-option value="system" :label="t('settings.languageSystem')" />
        </el-select>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.common')">
      <SettingsRow
        :label="t('settings.zoom')"
        :desc="t('settings.zoomDesc')"
        data-setting-id="general-zoom-level"
      >
        <div class="zoom-ctrl">
          <el-slider
            v-model="settings.general.zoomLevel"
            :min="0.8"
            :max="1.5"
            :step="0.1"
            :format-tooltip="(v: number) => `${Math.round(v * 100)}%`"
            @change="onZoom"
          />
          <span class="set-value">{{ Math.round(settings.general.zoomLevel * 100) }}%</span>
        </div>
      </SettingsRow>

      <SettingsRow
        :label="t('settings.restoreLast')"
        :desc="t('settings.restoreLastDesc')"
        data-setting-id="general-restore-last-project"
      >
        <el-switch
          :model-value="settings.general.restoreLastProject"
          @update:model-value="(v) => commit('restoreLastProject', v === true)"
        />
      </SettingsRow>

      <SettingsRow
        :label="t('settings.autosave')"
        :desc="t('settings.autosaveDesc')"
        data-setting-id="general-autosave"
      >
        <el-switch
          :model-value="settings.general.autosaveEnabled"
          @update:model-value="(v) => commit('autosaveEnabled', v === true)"
        />
        <el-input-number
          :model-value="settings.general.autosaveIntervalSec"
          :min="1"
          :max="30"
          :step="1"
          :disabled="!settings.general.autosaveEnabled"
          size="small"
          controls-position="right"
          class="interval-input"
          @change="(v: number | undefined) => v && commit('autosaveIntervalSec', v)"
        />
        <span class="set-unit" :class="{ dim: !settings.general.autosaveEnabled }">{{
          t('settings.seconds')
        }}</span>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.activityModules')">
      <SettingsRow
        :label="t('settings.activityModules')"
        :desc="t('settings.activityModulesDesc')"
        data-setting-id="general-activity-modules"
      >
        <div class="hidden-mods">
          <template v-if="hiddenMods.length > 0">
            <el-tag
              v-for="m in hiddenMods"
              :key="m.id"
              closable
              size="small"
              @close="ui.restoreModule(m.id)"
              >{{ moduleName(m) }}</el-tag
            >
            <el-button size="small" @click="ui.restoreHiddenModules()">{{
              t('settings.restoreAllModules')
            }}</el-button>
          </template>
          <span v-else class="set-unit dim">{{ t('settings.noHiddenModules') }}</span>
        </div>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.update')">
      <SettingsRow
        :label="t('settings.currentVersion')"
        :desc="t('settings.currentVersionDesc')"
        data-setting-id="general-app-update"
      >
        <div class="update-ctrl">
          <el-tag size="small" effect="plain">v{{ appVersion }}</el-tag>
          <el-tag v-if="update.viaMirror" size="small" type="warning" effect="plain">{{
            t('settings.mirrorChannel')
          }}</el-tag>
          <el-button size="small" :loading="update.phase === 'checking'" @click="onCheckUpdate">
            {{ t('settings.checkUpdate') }}
          </el-button>
        </div>
      </SettingsRow>

      <SettingsRow
        v-if="update.phase === 'available'"
        :label="t('settings.newVersion')"
        :desc="
          update.manualDownloadOnly
            ? t('settings.newVersionMacDesc')
            : t('settings.newVersionDesc')
        "
        data-setting-id="general-update-available"
      >
        <div class="update-ctrl">
          <el-tag size="small" type="success">v{{ update.latestVersion }}</el-tag>
          <el-button v-if="update.manualDownloadOnly" size="small" type="primary" @click="openReleasePage">
            {{ t('settings.browserDownload') }}
          </el-button>
          <el-button v-else size="small" type="primary" @click="onDownloadUpdate">{{
            t('settings.downloadUpdate')
          }}</el-button>
        </div>
      </SettingsRow>

      <SettingsRow
        v-else-if="update.phase === 'downloading'"
        :label="t('settings.downloading')"
        :desc="
          update.bytesPerSecond
            ? t('settings.rate', { speed: formatSpeed(update.bytesPerSecond) })
            : t('settings.connecting')
        "
        data-setting-id="general-update-downloading"
      >
        <el-progress
          :percentage="update.percent ?? 0"
          :stroke-width="8"
          class="update-progress"
        />
      </SettingsRow>

      <SettingsRow
        v-else-if="update.phase === 'downloaded'"
        :label="t('settings.updateReady')"
        :desc="t('settings.updateReadyDesc')"
        data-setting-id="general-update-downloaded"
      >
        <div class="update-ctrl">
          <el-tag size="small" type="success">{{
            t('settings.downloadedTag', { version: update.latestVersion ?? '' })
          }}</el-tag>
          <el-button size="small" type="primary" @click="onInstallUpdate">{{
            t('settings.restartInstall')
          }}</el-button>
        </div>
      </SettingsRow>

      <SettingsRow
        v-else-if="update.phase === 'latest'"
        :label="t('settings.status')"
        :desc="t('settings.latestDesc')"
        data-setting-id="general-update-latest"
      >
        <el-tag size="small" type="success" effect="plain">{{ t('settings.latestTag') }}</el-tag>
      </SettingsRow>

      <SettingsRow
        v-else-if="update.phase === 'error'"
        :label="t('settings.updateFailed')"
        :desc="update.error ?? t('settings.unknownError')"
        data-setting-id="general-update-error"
      >
        <div class="update-ctrl">
          <el-button size="small" @click="onCheckUpdate">{{ t('settings.retry') }}</el-button>
          <el-button size="small" text type="primary" @click="openReleasePage">
            {{ t('settings.openReleasePage') }}
          </el-button>
        </div>
      </SettingsRow>

      <SettingsRow
        :label="t('settings.autoCheck')"
        :desc="t('settings.autoCheckDesc')"
        data-setting-id="general-update-autocheck"
      >
        <el-switch
          :model-value="settings.general.updateAutoCheck"
          @update:model-value="(v) => commit('updateAutoCheck', v === true)"
        />
      </SettingsRow>

      <SettingsRow
        :label="t('settings.mirrorPrefix')"
        :desc="t('settings.mirrorPrefixDesc')"
        data-setting-id="general-update-mirror"
      >
        <el-input
          :model-value="settings.general.updateMirrorPrefix"
          size="small"
          class="mirror-input"
          :placeholder="t('settings.mirrorPlaceholder')"
          @change="(v: string) => commit('updateMirrorPrefix', v.trim())"
        />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.ack.title')">
      <div class="legal-block">
        <p class="legal-lead">
          {{ t('settings.ack.lead') }}
        </p>

        <p class="legal-title">{{ t('settings.ack.coreTitle') }}</p>
        <ul class="legal-list">
          <li><strong>three.js</strong>{{ t('settings.ack.threeDesc') }}</li>
          <li><strong>Element Plus</strong>{{ t('settings.ack.epDesc') }}</li>
          <li><strong>Monaco Editor</strong>{{ t('settings.ack.monacoDesc') }}</li>
          <li><strong>Electron</strong>{{ t('settings.ack.electronDesc') }}</li>
          <li><strong>pngjs</strong>{{ t('settings.ack.pngjsDesc') }}</li>
        </ul>

        <p class="legal-title">{{ t('settings.ack.specTitle') }}</p>
        <ul class="legal-list">
          <li><strong>Minecraft Bedrock Edition</strong>{{ t('settings.ack.bedrockA') }}<code>geo.json</code> / <code>animation.json</code>{{ t('settings.ack.bedrockB') }}</li>
          <li><strong>Blockbench</strong>{{ t('settings.ack.bbA') }}<code>bbmodel</code>{{ t('settings.ack.bbB') }}</li>
          <li><strong>Java Edition 资源包格式</strong>{{ t('settings.ack.javaDesc') }}</li>
          <li><strong>glTF 2.0</strong>{{ t('settings.ack.gltfDesc') }}</li>
          <li><strong>Wavefront OBJ</strong>{{ t('settings.ack.objDesc') }}</li>
        </ul>

        <p class="legal-title">{{ t('settings.ack.aiTitle') }}</p>
        <ul class="legal-list">
          <li><strong>BMCLAPI</strong>{{ t('settings.ack.bmclA') }}<code>fetch-models</code>{{ t('settings.ack.bmclB') }}</li>
          <li><strong>Modrinth</strong>{{ t('settings.ack.modrinthDesc') }}</li>
          <li><strong>MCP 协议</strong>{{ t('settings.ack.mcpDesc') }}</li>
        </ul>

        <p class="legal-foot">
          {{ t('settings.ack.foot') }}
        </p>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('settings.legal.title')">
      <div class="legal-block">
        <p class="legal-title">{{ t('settings.legal.whatTitle') }}</p>
        <p class="legal-body">
          {{ t('settings.legal.whatA') }}<strong>{{ t('settings.legal.whatStrong1') }}</strong>{{ t('settings.legal.whatB') }}<strong>{{ t('settings.legal.whatStrong2') }}</strong>{{ t('settings.legal.whatC') }}
        </p>
        <p class="legal-body">{{ t('settings.legal.formerName') }}</p>

        <p class="legal-title">{{ t('settings.legal.ugcTitle') }}</p>
        <p class="legal-body">
          {{ t('settings.legal.ugcA') }}<strong>{{ t('settings.legal.ugcStrong') }}</strong>{{ t('settings.legal.ugcB') }}
        </p>

        <p class="legal-title">{{ t('settings.legal.tmTitle') }}</p>
        <p class="legal-body">
          {{ t('settings.legal.tmA') }}<strong>{{ t('settings.legal.tmStrong') }}</strong>{{ t('settings.legal.tmB') }}
        </p>

        <p class="legal-foot">
          {{ t('settings.legal.foot') }}
        </p>
      </div>
    </SettingsSection>

    <footer class="pane-foot">
      <el-button plain size="small" @click="reset">{{ t('settings.resetSection') }}</el-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import { moduleRegistry, type KunYuModule } from '../../modules'
import { t, moduleName } from '../../i18n'
import {
  DEFAULT_SETTINGS,
  type GeneralSettings,
  type LocalePreference,
  type ThemeMode
} from '../../../../shared/types/settings'
import { UPDATE_RELEASE_PAGE, type UpdateState } from '../../../../shared/types/update'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'

const settings = useSettingsStore()
const ui = useUiStore()

/** 已隐藏的活动栏模块（隐藏动作在活动栏右键菜单，恢复在这里） */
const hiddenMods = computed<KunYuModule[]>(() =>
  ui.hiddenModules
    .map((id) => moduleRegistry.get(id))
    .filter((m): m is KunYuModule => Boolean(m))
)

const appVersion = ref('')
/** 更新状态机快照：主进程推送 + 进入面板时主动拉一次 */
const update = ref<UpdateState>({ phase: 'idle', currentVersion: '' })
let offUpdate: (() => void) | null = null

onMounted(async () => {
  try {
    appVersion.value = await window.api.app.getVersion()
  } catch {
    appVersion.value = 'unknown'
  }
  try {
    update.value = await window.api.update.getState()
    offUpdate = window.api.update.onStateChanged((s) => {
      update.value = s
    })
  } catch {
    /* preload 桥不可用（如纯 web 预览）时保持 idle */
  }
})

onBeforeUnmount(() => {
  offUpdate?.()
  offUpdate = null
})

async function onCheckUpdate(): Promise<void> {
  try {
    update.value = await window.api.update.check()
  } catch (err) {
    ElMessage.error(t('settings.checkFailed', { error: (err as Error).message }))
  }
}

async function onDownloadUpdate(): Promise<void> {
  try {
    update.value = await window.api.update.download()
  } catch (err) {
    ElMessage.error(t('settings.downloadFailed', { error: (err as Error).message }))
  }
}

function onInstallUpdate(): void {
  void window.api.update.install()
}

function openReleasePage(): void {
  void window.api.shell.openExternal(UPDATE_RELEASE_PAGE)
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${bytesPerSec} B/s`
}

function commit<K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]): void {
  void settings.patchSection('general', { [key]: value })
}

function onThemeMode(v: string | number | boolean | undefined): void {
  const mode: ThemeMode = v === 'light' || v === 'system' ? v : 'dark'
  commit('themeMode', mode)
}

function onLocale(v: string | number | boolean | undefined): void {
  const pref: LocalePreference =
    v === 'en-US' || v === 'system' ? v : v === 'zh-CN' ? 'zh-CN' : settings.general.locale
  commit('locale', pref)
}

function onZoom(): void {
  commit('zoomLevel', Math.round(settings.general.zoomLevel * 100) / 100)
}

async function reset(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('settings.resetConfirm'), t('settings.resetTitle'), {
      type: 'warning',
      confirmButtonText: t('settings.resetConfirmBtn'),
      cancelButtonText: t('common.cancel')
    })
  } catch {
    return
  }
  await settings.patchSection('general', { ...DEFAULT_SETTINGS.general })
}
</script>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  max-width: 680px;
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
.zoom-ctrl {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 260px;
}
.update-ctrl {
  display: flex;
  align-items: center;
  gap: 10px;
}
.update-progress {
  width: 260px;
}
.mirror-input {
  width: 280px;
}
.language-select {
  width: 160px;
}
.set-value {
  width: 42px;
  text-align: right;
  font-size: 12px;
  color: var(--ky-text-sub);
  font-family: var(--ky-font-mono);
}
.interval-input {
  width: 96px;
}
.set-unit {
  font-size: 12px;
  color: var(--ky-text-dim);
}
.set-unit.dim {
  opacity: 0.5;
}
.hidden-mods {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  max-width: 320px;
  justify-content: flex-end;
}
.pane-foot {
  margin-top: 4px;
}
.legal-block {
  padding: 12px 14px;
  background: var(--ky-bg-soft, rgba(127,127,127,0.06));
  border-radius: 6px;
  line-height: 1.8;
  font-size: 12px;
  color: var(--ky-text-sub);
}
.legal-lead {
  margin: 0 0 12px;
  padding: 8px 12px;
  background: var(--ky-info-soft, rgba(64,158,255,0.08));
  border-left: 3px solid var(--ky-info, #409eff);
  border-radius: 3px;
  font-style: italic;
  color: var(--ky-text);
}
.legal-title {
  margin: 14px 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text);
}
.legal-title:first-child {
  margin-top: 0;
}
.legal-body {
  margin: 0 0 2px;
}
.legal-list {
  margin: 4px 0 2px 18px;
  padding: 0;
  line-height: 1.85;
}
.legal-list li {
  margin-bottom: 2px;
}
.legal-list code {
  font-size: 11px;
  padding: 1px 5px;
  background: var(--ky-bg-sub, rgba(127,127,127,0.1));
  border-radius: 3px;
  font-family: var(--ky-font-mono, monospace);
}
.legal-foot {
  margin: 14px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--ky-border-sub, rgba(127,127,127,0.15));
  font-size: 11px;
  color: var(--ky-text-dim);
  text-align: center;
}
</style>
