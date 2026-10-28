<template>
  <div class="pane">
    <header class="pane-head">
      <h2>{{ t('settings.editor.title') }}</h2>
      <p>{{ t('settings.editor.desc') }}</p>
    </header>

    <SettingsSection :title="t('settings.appearance')">
      <SettingsRow
        :label="t('settings.editor.fontFamily')"
        :desc="t('settings.editor.fontFamilyDesc')"
        data-setting-id="editor-font-family"
      >
        <el-select
          :model-value="settings.editor.fontFamily"
          filterable
          allow-create
          default-first-option
          size="small"
          class="font-select"
          @update:model-value="(v: string) => commit('fontFamily', v)"
        >
          <el-option
            v-for="f in FONT_OPTIONS"
            :key="f.value"
            :label="f.label"
            :value="f.value"
          />
        </el-select>
      </SettingsRow>

      <SettingsRow
        :label="t('settings.editor.fontSize')"
        :desc="t('settings.editor.fontSizeDesc')"
        data-setting-id="editor-font-size"
      >
        <div class="size-ctrl">
          <el-slider
            v-model="settings.editor.fontSize"
            :min="11"
            :max="24"
            :step="1"
            @change="onFontSize"
          />
          <span class="set-value">{{ settings.editor.fontSize }}px</span>
        </div>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.editor.indent')">
      <SettingsRow
        :label="t('settings.editor.tabSize')"
        :desc="t('settings.editor.tabSizeDesc')"
        data-setting-id="editor-tab-size"
      >
        <el-radio-group
          :model-value="settings.editor.tabSize"
          @update:model-value="(v) => {
            if (v === 2 || v === 4 || v === 8) commit('tabSize', v)
          }"
        >
          <el-radio-button :value="2">2</el-radio-button>
          <el-radio-button :value="4">4</el-radio-button>
          <el-radio-button :value="8">8</el-radio-button>
        </el-radio-group>
      </SettingsRow>

      <SettingsRow
        :label="t('settings.editor.insertSpaces')"
        :desc="t('settings.editor.insertSpacesDesc')"
        data-setting-id="editor-insert-spaces"
      >
        <el-switch
          :model-value="settings.editor.insertSpaces"
          @update:model-value="(v) => commit('insertSpaces', v === true)"
        />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.editor.display')">
      <SettingsRow
        :label="t('settings.editor.wordWrap')"
        :desc="t('settings.editor.wordWrapDesc')"
        data-setting-id="editor-word-wrap"
      >
        <el-switch
          :model-value="settings.editor.wordWrap"
          @update:model-value="(v) => commit('wordWrap', v === true)"
        />
      </SettingsRow>

      <SettingsRow
        :label="t('settings.editor.lineNumbers')"
        :desc="t('settings.editor.lineNumbersDesc')"
        data-setting-id="editor-line-numbers"
      >
        <el-switch
          :model-value="settings.editor.lineNumbers"
          @update:model-value="(v) => commit('lineNumbers', v === true)"
        />
      </SettingsRow>
    </SettingsSection>

    <footer class="pane-foot">
      <el-button plain size="small" @click="reset">{{ t('settings.resetSection') }}</el-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../../stores/settings'
import { useI18n } from '../../i18n'
import { DEFAULT_SETTINGS, type EditorSettings } from '../../../../shared/types/settings'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'

const settings = useSettingsStore()
const { t } = useI18n()

const FONT_OPTIONS = computed(() => [
  {
    label: t('settings.editor.fontSystemDefault'),
    value: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace"
  },
  { label: 'Cascadia Code', value: "'Cascadia Code', Consolas, monospace" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', Consolas, monospace" },
  { label: 'Consolas', value: "Consolas, 'Courier New', monospace" },
  { label: 'Courier New', value: "'Courier New', monospace" }
])

function commit<K extends keyof EditorSettings>(key: K, value: EditorSettings[K]): void {
  void settings.patchSection('editor', { [key]: value })
}

/** 滑块 v-model 直绑 store，change 时读 store 值落盘（避免受控回弹与事件值竞态） */
function onFontSize(): void {
  commit('fontSize', settings.editor.fontSize)
}

async function reset(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('settings.editor.resetConfirm'), t('settings.resetTitle'), {
      type: 'warning',
      confirmButtonText: t('settings.resetConfirmBtn'),
      cancelButtonText: t('common.cancel')
    })
  } catch {
    return
  }
  await settings.patchSection('editor', { ...DEFAULT_SETTINGS.editor })
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
.size-ctrl {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 260px;
}
.set-value {
  width: 42px;
  text-align: right;
  font-size: 12px;
  color: var(--ky-text-sub);
  font-family: var(--ky-font-mono);
}
.font-select {
  width: 260px;
}
.pane-foot {
  margin-top: 4px;
}
</style>
