<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('modpack.publishForm.title')"
    width="560px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
    @open="onOpen"
  >
    <div v-if="preflightLoading" class="pd-loading" v-loading="true" :element-loading-text="t('modpack.publishForm.checking')" />
    <template v-else-if="preflight">
      <div v-if="!anyArtifact" class="pd-err">
        {{ t('modpack.publishForm.noArtifact') }}
      </div>
      <div v-else class="pd-zip">
        <div v-if="preflight.mrpack?.exists" class="pd-zip-row">
          <span class="pd-k">Modrinth</span>
          <span class="pd-v mono">{{ preflight.mrpack.path }}</span>
          <span class="pd-v">{{ mtimeText(preflight.mrpack.mtime) }}</span>
        </div>
        <div v-else class="pd-zip-row pd-missing">
          <span class="pd-k">Modrinth</span>
          <span class="pd-v">{{ t('modpack.publishForm.mrpackMissing') }}</span>
        </div>
        <div v-if="preflight.cfZip?.exists" class="pd-zip-row">
          <span class="pd-k">CurseForge</span>
          <span class="pd-v mono">{{ preflight.cfZip.path }}</span>
          <span class="pd-v">{{ mtimeText(preflight.cfZip.mtime) }}</span>
        </div>
        <div v-else class="pd-zip-row pd-missing">
          <span class="pd-k">CurseForge</span>
          <span class="pd-v">{{ t('modpack.publishForm.cfzipMissing') }}</span>
        </div>
      </div>

      <el-alert
        v-if="contractBlocked"
        type="warning"
        :closable="false"
        class="pd-gate"
        :title="t('modpack.publishForm.gateTitle')"
        :description="t('modpack.publishForm.gateDescription', { unverified: preflight?.contractGate?.unverifiedCount ?? 0, total: preflight?.contractGate?.total ?? 0 })"
        show-icon
      />

      <el-form label-position="top" class="pd-form">
        <el-form-item :label="t('modpack.publishForm.platformLabel')">
          <div class="pd-platforms">
            <div class="pd-platform">
              <el-checkbox
                v-model="platforms.modrinth"
                :disabled="!preflight.ready?.modrinth || !preflight.mrpack?.exists"
              >
                Modrinth
              </el-checkbox>
              <p v-if="!preflight.ready?.modrinth" class="pd-warn">
                {{ t('modpack.publishForm.modrinthTokenMissing') }}
                <el-link type="primary" @click="goSettings">{{ t('modpack.publishForm.goSettings') }}</el-link>
              </p>
              <p v-else-if="!preflight.mrpack?.exists" class="pd-warn">{{ t('modpack.publishForm.mrpackMissingShort') }}</p>
            </div>
            <div class="pd-platform">
              <el-checkbox
                v-model="platforms.curseforge"
                :disabled="!preflight.ready?.curseforge || !preflight.cfZip?.exists"
              >
                CurseForge
              </el-checkbox>
              <p v-if="!preflight.ready?.curseforge" class="pd-warn">
                {{ t('modpack.publishForm.curseforgeTokenMissing') }}
                <el-link type="primary" @click="goSettings">{{ t('modpack.publishForm.goSettings') }}</el-link>
              </p>
              <p v-else-if="!preflight.cfZip?.exists" class="pd-warn">{{ t('modpack.publishForm.cfzipMissingShort') }}</p>
            </div>
          </div>
        </el-form-item>

        <el-form-item :label="t('modpack.publishForm.versionNumber')">
          <el-input v-model="form.versionNumber" :placeholder="t('modpack.publishForm.versionPlaceholder')" spellcheck="false" />
        </el-form-item>
        <el-form-item :label="t('modpack.publishForm.versionTitle')">
          <el-input v-model="form.title" :placeholder="t('modpack.publishForm.titlePlaceholder')" spellcheck="false" />
        </el-form-item>
        <el-form-item :label="t('modpack.publishForm.changelog')">
          <el-input
            v-model="form.changelog"
            type="textarea"
            :rows="4"
            :placeholder="t('modpack.publishForm.changelogPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('modpack.publishForm.releaseType')">
          <el-radio-group v-model="form.releaseType">
            <el-radio-button label="release">{{ t('modpack.publishForm.releaseRelease') }}</el-radio-button>
            <el-radio-button label="beta">{{ t('modpack.publishForm.releaseBeta') }}</el-radio-button>
            <el-radio-button label="alpha">{{ t('modpack.publishForm.releaseAlpha') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="preflight.cfVersions" :label="t('modpack.publishForm.cfMatch')">
          <div v-if="preflight.cfVersions.ready" class="pd-cf-ok">
            {{ t('modpack.publishForm.cfMatched', { n: preflight.cfVersions.gameVersionIds.length, mc: mcVersion, loader }) }}
          </div>
          <div v-else class="pd-cf-warn">
            <p>{{ t('modpack.publishForm.cfNoMatch') }}</p>
            <div class="pd-suggestions">
              <el-tag v-for="s in preflight.cfVersions.suggestions" :key="s" size="small" class="pd-tag">
                {{ s }}
              </el-tag>
            </div>
          </div>
        </el-form-item>
      </el-form>
    </template>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ t('modpack.publishForm.cancel') }}</el-button>
      <el-button
        type="primary"
        :loading="publishing"
        :disabled="!canPublish"
        @click="onPublish"
      >
        {{ t('modpack.publishForm.confirmPublish') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import { useProjectStore } from '../../stores/project'
import { useI18n } from '../../i18n'
import type { PublishModpackResult, PublishPreflightResult } from '../../../../shared/types/modpack'

const props = defineProps<{
  modelValue: boolean
  zipPath: string
  cfZipPath?: string
  mcVersion: string
  loader: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'published', results: PublishModpackResult): void
}>()

const settings = useSettingsStore()
const ui = useUiStore()
const projectStore = useProjectStore()
const { t, locale } = useI18n()

const preflight = ref<PublishPreflightResult | null>(null)
const preflightLoading = ref(false)
const publishing = ref(false)

const platforms = reactive({ modrinth: true, curseforge: true })
const form = reactive({
  versionNumber: '',
  title: '',
  changelog: '',
  releaseType: 'release' as 'release' | 'beta' | 'alpha'
})

const mtimeText = (mtime?: number): string => {
  if (!mtime) return '—'
  return new Date(mtime).toLocaleString(locale.value)
}

/** 至少一个平台有产物（P0-6：产物存在性按平台判定，路径来自主进程预检） */
const anyArtifact = computed(
  () => !!(preflight.value?.mrpack?.exists || preflight.value?.cfZip?.exists)
)

/** 勾选平台的产物是否齐备 */
const selectedArtifactsReady = computed(() => {
  const p = preflight.value
  if (!p) return false
  const mrOk = !platforms.modrinth || !p.ready?.modrinth || !!p.mrpack?.exists
  const cfOk = !platforms.curseforge || !p.ready?.curseforge || !!p.cfZip?.exists
  return mrOk && cfOk
})

/** 验收门禁（#1）：契约含未验证项时禁用直发 */
const contractBlocked = computed(() => (preflight.value?.contractGate?.unverifiedCount ?? 0) > 0)

const canPublish = computed(() => {
  const p = preflight.value
  if (!p || !(p.mrpack?.exists || p.cfZip?.exists)) return false
  if (contractBlocked.value) return false
  if (!form.versionNumber.trim() || !form.title.trim()) return false
  const anySelected =
    (platforms.modrinth && p.ready?.modrinth) || (platforms.curseforge && p.ready?.curseforge)
  return Boolean(anySelected) && selectedArtifactsReady.value
})

async function onOpen(): Promise<void> {
  const path = projectStore.currentProject?.path
  if (!path) return
  preflightLoading.value = true
  preflight.value = null
  try {
    const res = await window.api.modpack.publishPreflight(path)
    if (res.ok) {
      preflight.value = res
      form.releaseType = settings.publish.defaultReleaseType
      if (!form.title) form.title = `${projectStore.currentProject?.name ?? t('modpack.publishForm.defaultPackName')} ${form.versionNumber}`
    } else {
      ElMessage.error(res.error ?? t('modpack.publishForm.preflightFailed'))
      emit('update:modelValue', false)
    }
  } catch (err) {
    ElMessage.error(t('modpack.publishForm.preflightFailedDetail', { error: (err as Error).message }))
    emit('update:modelValue', false)
  } finally {
    preflightLoading.value = false
  }
}

function goSettings(): void {
  emit('update:modelValue', false)
  ui.setSettingsCategory('publish')
  ui.setActiveModule('settings', { rememberForSettings: true })
}

async function onPublish(): Promise<void> {
  const path = projectStore.currentProject?.path
  if (!path || !preflight.value) return

  const selected: ('modrinth' | 'curseforge')[] = []
  // P0-6：只勾选「token 就绪 + 产物存在」的平台；产物路径以主进程预检结果为准（与上传对齐）
  if (platforms.modrinth && preflight.value.ready?.modrinth && preflight.value.mrpack?.exists)
    selected.push('modrinth')
  if (platforms.curseforge && preflight.value.ready?.curseforge && preflight.value.cfZip?.exists)
    selected.push('curseforge')
  if (selected.length === 0) return

  try {
    await ElMessageBox.confirm(
      t('modpack.publishForm.confirmBody'),
      t('modpack.publishForm.confirmTitle'),
      {
        type: 'warning',
        confirmButtonText: t('modpack.publishForm.confirmPublish'),
        cancelButtonText: t('modpack.publishForm.cancel')
      }
    )
  } catch {
    return
  }

  publishing.value = true
  try {
    const result = await window.api.modpack.publish(
      path,
      {
        zipPath: preflight.value.mrpack?.path || props.zipPath,
        cfZipPath: preflight.value.cfZip?.path || props.cfZipPath || undefined,
        versionNumber: form.versionNumber.trim(),
        title: form.title.trim(),
        changelog: form.changelog.trim(),
        releaseType: form.releaseType
      },
      selected
    )
    if (result.ok && result.results) {
      const lines = result.results.map((r) => {
        if (r.ok && r.url) return `${r.platform === 'modrinth' ? 'Modrinth' : 'CurseForge'}：${r.url}`
        return `${r.platform === 'modrinth' ? 'Modrinth' : 'CurseForge'}：${t('modpack.publishForm.failed', { error: r.error ?? t('modpack.publishForm.unknownError') })}`
      })
      ElMessageBox.alert(lines.join('\n'), t('modpack.publishForm.resultTitle'), {
        confirmButtonText: t('modpack.publishForm.gotIt'),
        type: result.results.every((r) => r.ok) ? 'success' : 'warning'
      })
      emit('published', result)
      emit('update:modelValue', false)
    } else {
      ElMessage.error(result.error ?? t('modpack.publishForm.publishFailed'))
    }
  } catch (err) {
    ElMessage.error(t('modpack.publishForm.publishFailedDetail', { error: (err as Error).message }))
  } finally {
    publishing.value = false
  }
}
</script>

<style scoped>
.pd-loading { height: 120px; }
.pd-err { color: #f87171; font-size: 13px; }
.pd-gate { margin-bottom: 12px; }
.pd-zip { margin-bottom: 12px; padding: 10px 12px; border-radius: 6px; background: var(--ky-bg-hover); }
.pd-zip-row { display: flex; gap: 12px; margin-bottom: 4px; font-size: 12px; }
.pd-zip-row .pd-k { width: 72px; }
.pd-missing .pd-v { color: #f87171; }
.pd-k { width: 56px; color: var(--ky-text-dim); flex-shrink: 0; }
.pd-v { color: var(--ky-text); word-break: break-all; }
.mono { font-family: 'Cascadia Code', 'JetBrains Mono', monospace; }
.pd-form { margin-top: 4px; }
.pd-platforms { display: flex; flex-direction: column; gap: 6px; }
.pd-platform { display: flex; align-items: center; gap: 10px; }
.pd-warn { margin: 0; font-size: 12px; color: #f87171; }
.pd-cf-ok { font-size: 12px; color: #4ade80; }
.pd-cf-warn { font-size: 12px; color: #fbbf24; }
.pd-suggestions { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.pd-tag { margin-right: 2px; }
</style>
