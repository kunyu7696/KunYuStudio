<!--
  活动栏「音效工坊」：合成 / MIDI / 导入 → FFmpeg 转 OGG → sounds.json 注册
  - 合成器：jfxr/sfxr 风格参数（本模块 sfxr.ts 纯算法），Web Audio 试听
  - MIDI：极简 SMF 解析 + 渲染（midi.ts），适合旋律草稿快速素材化
  - 导入：本地 wav/mp3/ogg/flac/m4a/aac；BeepBox 走「导出 WAV → 导入」链路
  - 落地：assets/<ns>/sounds/*.ogg + assets/<ns>/sounds.json 事件注册
-->
<template>
  <div class="audio-view">
    <header class="au-header">
      <div class="au-heading">
        <h2>{{ t('audio.title') }}</h2>
        <p>{{ t('audio.subtitle', { namespace: library?.namespace ?? '…' }) }}</p>
      </div>
      <div class="au-actions">
        <el-tag v-if="tool?.installed" type="success" effect="plain">
          FFmpeg {{ tool.version || t('audio.ffmpegReady') }}
        </el-tag>
        <el-tag
          v-if="tool?.installed && tool.integrity === 'unverified'"
          type="warning"
          effect="plain"
          :title="t('audio.ffmpegIntegrityUnverifiedTip')"
        >
          {{ t('audio.ffmpegIntegrityUnverified') }}
        </el-tag>
        <el-tag v-if="!tool?.installed" type="info" effect="plain">{{ t('audio.ffmpegNotInstalled') }}</el-tag>
        <el-button
          v-if="tool && !tool.installed"
          :icon="Download"
          :loading="downloadingTool"
          @click="onEnsureTool"
        >
          {{ t('audio.downloadFfmpeg') }}
        </el-button>
        <el-button :icon="Refresh" :loading="loadingList" @click="reloadLibrary">{{ t('audio.refresh') }}</el-button>
      </div>
    </header>

    <div v-if="busy || phaseText" class="au-progress">
      <el-icon v-if="busy" class="is-loading"><Loading /></el-icon>
      <span>{{ phaseText }}</span>
      <span v-if="downloadPct !== null" class="au-pct">{{ downloadPct }}%</span>
    </div>

    <el-tabs v-model="tab" class="au-tabs">
      <!-- ======================= 参数合成器 ======================= -->
      <el-tab-pane :label="t('audio.tabSynth')" name="synth">
        <div class="au-synth">
          <div class="au-presets">
            <el-button
              v-for="p in SFXR_PRESETS"
              :key="p.key"
              size="small"
              @click="applyPreset(p.params)"
            >
              {{ presetName(p.key) }}
            </el-button>
            <el-button size="small" :icon="RefreshLeft" @click="randomize">{{ t('audio.random') }}</el-button>
          </div>
          <div class="au-synth-grid">
            <el-form label-width="96px" size="small" class="au-form">
              <el-form-item :label="t('audio.wave')">
                <el-radio-group v-model="params.wave" @change="renderSynth">
                  <el-radio-button value="square">{{ t('audio.waveSquare') }}</el-radio-button>
                  <el-radio-button value="sawtooth">{{ t('audio.waveSawtooth') }}</el-radio-button>
                  <el-radio-button value="sine">{{ t('audio.waveSine') }}</el-radio-button>
                  <el-radio-button value="noise">{{ t('audio.waveNoise') }}</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item :label="t('audio.baseFreq')">
                <el-slider v-model="params.baseFreq" :min="40" :max="2000" :step="1" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item :label="t('audio.freqSlide')">
                <el-slider v-model="params.freqSlide" :min="-1" :max="1" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item :label="t('audio.freqDeltaSlide')">
                <el-slider v-model="params.freqDeltaSlide" :min="-1" :max="1" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item v-if="params.wave === 'square'" :label="t('audio.duty')">
                <el-slider v-model="params.squareDuty" :min="0" :max="1" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item :label="t('audio.vibratoDepth')">
                <el-slider v-model="params.vibratoDepth" :min="0" :max="1" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
            </el-form>
            <el-form label-width="96px" size="small" class="au-form">
              <el-form-item :label="t('audio.attack')">
                <el-slider v-model="params.attackTime" :min="0" :max="1" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item :label="t('audio.sustain')">
                <el-slider v-model="params.sustainTime" :min="0" :max="2" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item :label="t('audio.decay')">
                <el-slider v-model="params.decayTime" :min="0.05" :max="2" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item :label="t('audio.sustainPunch')">
                <el-slider v-model="params.sustainPunch" :min="0" :max="1" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item :label="t('audio.lpFilter')">
                <el-slider v-model="params.lpFilterFreq" :min="200" :max="22050" :step="50" show-input @change="renderSynth" />
              </el-form-item>
              <el-form-item :label="t('audio.volume')">
                <el-slider v-model="params.volume" :min="0" :max="1" :step="0.01" show-input @change="renderSynth" />
              </el-form-item>
            </el-form>
          </div>
          <canvas ref="synthCanvasRef" class="au-wave" width="640" height="96"></canvas>
          <div class="au-save-bar">
            <el-button type="primary" :icon="VideoPlay" @click="playSynth">{{ t('audio.preview') }}</el-button>
            <el-input v-model="synthStem" :placeholder="t('audio.stemPlaceholderSynth')" class="au-stem" />
            <el-button type="success" :icon="Check" :loading="saving" @click="saveSynth">{{ t('audio.saveToProject') }}</el-button>
          </div>
        </div>
      </el-tab-pane>

      <!-- ======================= MIDI 导入 ======================= -->
      <el-tab-pane :label="t('audio.tabMidi')" name="midi">
        <div class="au-midi">
          <p class="au-hint">{{ t('audio.midiHint') }}</p>
          <el-button type="primary" :icon="FolderOpened" @click="onPickMidi">{{ t('audio.selectMidi') }}</el-button>
          <template v-if="midiSong">
            <el-descriptions :column="3" border size="small" class="au-midi-meta">
              <el-descriptions-item :label="t('audio.notes')">{{ midiSong.notes.length }}</el-descriptions-item>
              <el-descriptions-item :label="t('audio.tracks')">{{ midiSong.trackCount }}</el-descriptions-item>
              <el-descriptions-item :label="t('audio.duration')">{{ t('audio.durationValue', { value: midiSong.durationSec.toFixed(1) }) }}</el-descriptions-item>
            </el-descriptions>
            <div class="au-save-bar">
              <el-button type="primary" :icon="VideoPlay" @click="playMidi">{{ t('audio.preview') }}</el-button>
              <el-input v-model="midiStem" :placeholder="t('audio.stemPlaceholderMidi')" class="au-stem" />
              <el-button type="success" :icon="Check" :loading="saving" @click="saveMidi">{{ t('audio.saveToProject') }}</el-button>
            </div>
          </template>
        </div>
      </el-tab-pane>

      <!-- ======================= 文件导入 ======================= -->
      <el-tab-pane :label="t('audio.tabImport')" name="import">
        <div class="au-import">
          <p class="au-hint">
            {{ t('audio.importHintPrefix') }}<el-link type="primary" @click="openBeepBox">{{ t('audio.importHintLink') }}</el-link>{{ t('audio.importHintSuffix') }}
          </p>
          <el-button type="primary" :icon="FolderOpened" :loading="saving" @click="onPickAudio">
            {{ t('audio.selectAudio') }}
          </el-button>
        </div>
      </el-tab-pane>

      <!-- ======================= 声音库 ======================= -->
      <el-tab-pane :label="t('audio.tabLibrary')" name="library">
        <div class="au-library">
          <div class="au-lib-head">
            <span class="au-lib-title">{{ t('audio.soundFiles', { n: library?.files.length ?? 0 }) }}</span>
            <el-button size="small" type="primary" :icon="Plus" @click="openEventDialog()">{{ t('audio.registerEvent') }}</el-button>
          </div>
          <el-table :data="library?.files ?? []" size="small" max-height="260">
            <el-table-column prop="stem" :label="t('audio.fileName')" min-width="160" />
            <el-table-column :label="t('audio.size')" width="90">
              <template #default="{ row }">{{ Math.round(row.sizeBytes / 1024) }} KB</template>
            </el-table-column>
            <el-table-column :label="t('audio.registeredEvents')" min-width="200">
              <template #default="{ row }">
                <el-tag v-for="e in row.events" :key="e" size="small" effect="plain" class="au-ev-tag">{{ e }}</el-tag>
                <span v-if="row.events.length === 0" class="au-dim">{{ t('audio.notRegistered') }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="t('audio.actions')" width="150">
              <template #default="{ row }">
                <el-button size="small" text :icon="VideoPlay" @click="playLibrary(row.stem)" />
                <el-button size="small" text :icon="Plus" @click="openEventDialog(row.stem)" />
                <el-button size="small" text type="danger" :icon="Delete" @click="onRemoveSound(row.stem)" />
              </template>
            </el-table-column>
          </el-table>

          <div class="au-lib-head au-ev-head">
            <span class="au-lib-title">{{ t('audio.soundEvents', { n: library?.events.length ?? 0 }) }}</span>
          </div>
          <el-table :data="library?.events ?? []" size="small" max-height="220">
            <el-table-column prop="name" :label="t('audio.eventName')" min-width="180" />
            <el-table-column :label="t('audio.referencedSounds')" min-width="200">
              <template #default="{ row }">{{ row.sounds.join(', ') }}</template>
            </el-table-column>
            <el-table-column prop="subtitle" :label="t('audio.subtitleKey')" min-width="140">
              <template #default="{ row }"><span class="au-dim">{{ row.subtitle || '—' }}</span></template>
            </el-table-column>
            <el-table-column :label="t('audio.actions')" width="110">
              <template #default="{ row }">
                <el-button size="small" text :icon="Edit" @click="openEventDialog(undefined, row as SoundEventEntry)" />
                <el-button size="small" text type="danger" :icon="Delete" @click="onUnregister(row.name)" />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 注册/编辑事件对话框 -->
    <el-dialog
      v-model="eventDialog.visible"
      :title="eventDialog.editing ? t('audio.editEventTitle') : t('audio.registerEventTitle')"
      width="480px"
    >
      <el-form label-width="90px">
        <el-form-item :label="t('audio.eventName')">
          <el-input v-model="eventDialog.name" :placeholder="t('audio.eventNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('audio.referencedSounds')">
          <el-select v-model="eventDialog.sounds" multiple :placeholder="t('audio.soundsPlaceholder')" style="width: 100%">
            <el-option
              v-for="f in library?.files ?? []"
              :key="f.stem"
              :label="f.stem"
              :value="`${library?.namespace}:${f.stem}`"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('audio.subtitleKey')">
          <el-input v-model="eventDialog.subtitle" :placeholder="t('audio.subtitlePlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="eventDialog.visible = false">{{ t('audio.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveEvent">{{ t('audio.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Check,
  Delete,
  Download,
  Edit,
  FolderOpened,
  Loading,
  Plus,
  Refresh,
  RefreshLeft,
  VideoPlay
} from '@element-plus/icons-vue'
import { IpcChannels } from '../../../../shared/types/ipc'
import type { AudioEvent, AudioLibrary, AudioToolStatus, SoundEventEntry } from '../../../../shared/types/audio'
import { useProjectStore } from '../../stores/project'
import {
  DEFAULT_SFXR_PARAMS,
  SFXR_PRESETS,
  SFXR_SAMPLE_RATE,
  synthesize,
  type SfxrParams
} from './sfxr'
import { encodeWavPcm16 } from './wav'
import { parseMidi, renderMidi, type MidiSong } from './midi'
import { t } from '../../i18n'

const projectStore = useProjectStore()
const root = computed(() => projectStore.currentProject?.path ?? '')

const tool = ref<AudioToolStatus | null>(null)
const downloadingTool = ref(false)
const busy = ref(false)
const saving = ref(false)
const loadingList = ref(false)
const phaseText = ref('')
const downloadPct = ref<number | null>(null)
const tab = ref('synth')
const library = ref<AudioLibrary | null>(null)

/* ------------------------------ 合成器 ------------------------------ */
const params = reactive<SfxrParams>({ ...DEFAULT_SFXR_PARAMS })
const synthSamples = ref<Float32Array>(synthesize(params))
const synthStem = ref('')
const synthCanvasRef = ref<HTMLCanvasElement | null>(null)

function renderSynth(): void {
  synthSamples.value = synthesize(params)
  drawWave()
}

function applyPreset(p: Partial<SfxrParams>): void {
  Object.assign(params, DEFAULT_SFXR_PARAMS, p)
  renderSynth()
}

function presetName(key: string): string {
  return t(`audio.preset.${key}`)
}

function randomize(): void {
  applyPreset({ seed: (Math.random() * 0xffffffff) >>> 0 })
  params.baseFreq = 100 + Math.random() * 900
  params.freqSlide = Math.random() * 1.4 - 0.7
  params.wave = (['square', 'sawtooth', 'sine', 'noise'] as const)[Math.floor(Math.random() * 4)]!
  renderSynth()
}

function drawWave(): void {
  const canvas = synthCanvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { width, height } = canvas
  ctx.clearRect(0, 0, width, height)
  ctx.strokeStyle = '#409eff'
  ctx.beginPath()
  const data = synthSamples.value
  const step = Math.max(1, Math.floor(data.length / width))
  for (let x = 0; x < width; x++) {
    let min = 1
    let max = -1
    for (let i = x * step; i < Math.min(data.length, (x + 1) * step); i++) {
      const v = data[i]!
      if (v < min) min = v
      if (v > max) max = v
    }
    ctx.moveTo(x, ((1 - max) / 2) * height)
    ctx.lineTo(x, ((1 - min) / 2) * height)
  }
  ctx.stroke()
}

let audioCtx: AudioContext | null = null
function playSamples(samples: Float32Array): void {
  audioCtx ??= new AudioContext({ sampleRate: SFXR_SAMPLE_RATE })
  const buf = audioCtx.createBuffer(1, samples.length, SFXR_SAMPLE_RATE)
  buf.getChannelData(0).set(samples)
  const src = audioCtx.createBufferSource()
  src.buffer = buf
  src.connect(audioCtx.destination)
  src.start()
}

function playSynth(): void {
  playSamples(synthSamples.value)
}

/** 文件名主干净化：转合法内容 ID（小写字母开头，仅 a-z0-9_） */
function sanitizeStem(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(s) ? s.slice(0, 64) : `snd_${s}`.slice(0, 64)
}

async function convertBytes(stem: string, wav: Uint8Array, fileName: string): Promise<void> {
  if (!root.value) return
  saving.value = true
  try {
    await window.api.audio.convert({
      root: root.value,
      stem,
      source: { kind: 'bytes', data: wav, fileName }
    })
    ElMessage.success(t('audio.savedOgg', { stem }))
    await reloadLibrary()
    tab.value = 'library'
  } catch (err) {
    ElMessage.error(t('audio.saveFailed', { error: (err as Error).message }))
  } finally {
    saving.value = false
  }
}

async function saveSynth(): Promise<void> {
  const stem = sanitizeStem(synthStem.value || 'synth_sound')
  synthStem.value = stem
  await convertBytes(stem, encodeWavPcm16(synthSamples.value), `${stem}.wav`)
}

/* ------------------------------ MIDI ------------------------------ */
const midiSong = ref<MidiSong | null>(null)
const midiSamples = ref<Float32Array | null>(null)
const midiStem = ref('')

async function onPickMidi(): Promise<void> {
  const path = await window.api.dialog.selectFile({ title: t('audio.selectMidiTitle'), extensions: ['mid', 'midi'] })
  if (!path) return
  try {
    const bytes = await window.api.audio.readSource(path)
    midiSong.value = parseMidi(bytes)
    midiSamples.value = renderMidi(midiSong.value)
    midiStem.value = sanitizeStem(path.split(/[\\/]/).pop() ?? 'midi')
  } catch (err) {
    ElMessage.error(t('audio.midiParseFailed', { error: (err as Error).message }))
  }
}

function playMidi(): void {
  if (midiSamples.value) playSamples(midiSamples.value)
}

async function saveMidi(): Promise<void> {
  if (!midiSamples.value) return
  const stem = sanitizeStem(midiStem.value || 'midi_theme')
  midiStem.value = stem
  await convertBytes(stem, encodeWavPcm16(midiSamples.value), `${stem}.wav`)
}

/* ------------------------------ 文件导入 ------------------------------ */
async function onPickAudio(): Promise<void> {
  const path = await window.api.dialog.selectFile({
    title: t('audio.selectAudioTitle'),
    extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac']
  })
  if (!path || !root.value) return
  const stem = sanitizeStem(path.split(/[\\/]/).pop() ?? 'sound')
  saving.value = true
  try {
    await window.api.audio.convert({ root: root.value, stem, source: { kind: 'path', srcPath: path } })
    ElMessage.success(t('audio.importedOgg', { stem }))
    await reloadLibrary()
    tab.value = 'library'
  } catch (err) {
    ElMessage.error(t('audio.importFailed', { error: (err as Error).message }))
  } finally {
    saving.value = false
  }
}

async function openBeepBox(): Promise<void> {
  await window.api.shell.openExternal('https://www.beepbox.co')
}

/* ------------------------------ 声音库 ------------------------------ */
async function reloadLibrary(): Promise<void> {
  if (!root.value) return
  loadingList.value = true
  try {
    library.value = await window.api.audio.list(root.value)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loadingList.value = false
  }
}

async function playLibrary(stem: string): Promise<void> {
  if (!root.value) return
  try {
    const url = await window.api.audio.readSound(root.value, stem)
    void new Audio(url).play()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function onRemoveSound(stem: string): Promise<void> {
  try {
    await ElMessageBox.confirm(t('audio.deleteSoundConfirm', { stem }), t('audio.deleteSoundTitle'), {
      type: 'warning',
      confirmButtonText: t('audio.delete'),
      cancelButtonText: t('audio.cancel')
    })
  } catch {
    return
  }
  if (!root.value) return
  await window.api.audio.removeSound(root.value, stem)
  await reloadLibrary()
}

const eventDialog = reactive({
  visible: false,
  editing: false,
  name: '',
  sounds: [] as string[],
  subtitle: ''
})

function openEventDialog(presetStem?: string, editing?: { name: string; sounds: string[]; subtitle?: string }): void {
  eventDialog.editing = Boolean(editing)
  eventDialog.name = editing?.name ?? ''
  eventDialog.sounds = editing
    ? [...editing.sounds]
    : presetStem && library.value
      ? [`${library.value.namespace}:${presetStem}`]
      : []
  eventDialog.subtitle = editing?.subtitle ?? ''
  eventDialog.visible = true
}

async function saveEvent(): Promise<void> {
  if (!root.value) return
  if (!eventDialog.name.trim() || eventDialog.sounds.length === 0) {
    ElMessage.warning(t('audio.eventRequired'))
    return
  }
  saving.value = true
  try {
    await window.api.audio.registerEvent(root.value, {
      name: eventDialog.name.trim(),
      sounds: eventDialog.sounds,
      subtitle: eventDialog.subtitle.trim() || undefined
    })
    ElMessage.success(t('audio.eventSaved', { name: eventDialog.name }))
    eventDialog.visible = false
    await reloadLibrary()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

async function onUnregister(name: string): Promise<void> {
  if (!root.value) return
  await window.api.audio.unregisterEvent(root.value, name)
  await reloadLibrary()
}

/* ------------------------------ 工具与进度 ------------------------------ */
async function loadToolStatus(): Promise<void> {
  tool.value = await window.api.audio.ffmpegStatus()
}

async function onEnsureTool(): Promise<void> {
  downloadingTool.value = true
  try {
    tool.value = await window.api.audio.ensureFfmpeg()
    ElMessage.success(t('audio.ffmpegDone'))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    downloadingTool.value = false
  }
}

let offEvent: (() => void) | null = null

onMounted(async () => {
  drawWave()
  await Promise.all([loadToolStatus(), reloadLibrary()])
  offEvent = window.api.on(IpcChannels.AUDIO_EVENT, (...args: unknown[]) => {
    const ev = args[0] as AudioEvent
    if (ev.phase === 'tool-download') {
      phaseText.value = t('audio.downloadingTool')
      downloadPct.value =
        ev.totalBytes && ev.loadedBytes ? Math.round((ev.loadedBytes / ev.totalBytes) * 100) : null
      busy.value = true
    } else if (ev.phase === 'converting') {
      phaseText.value = t('audio.converting', { file: ev.file ?? ev.message ?? '' })
      downloadPct.value = null
      busy.value = true
    } else {
      busy.value = false
      downloadPct.value = null
      phaseText.value = ev.phase === 'done' ? '' : (ev.error ?? t('audio.failed'))
    }
  })
})

onBeforeUnmount(() => {
  offEvent?.()
  void audioCtx?.close()
})
</script>

<style scoped>
.audio-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px 20px;
  gap: 12px;
  overflow: auto;
}
.au-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.au-heading h2 {
  margin: 0 0 6px;
  font-size: 18px;
}
.au-heading p {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  max-width: 640px;
}
.au-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}
.au-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.au-pct {
  font-variant-numeric: tabular-nums;
}
.au-tabs {
  flex: 1;
  min-height: 0;
}
.au-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.au-synth-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
  max-width: 980px;
}
.au-form :deep(.el-slider) {
  width: 100%;
}
.au-wave {
  width: 640px;
  height: 96px;
  margin: 8px 0;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-fill-color-lighter);
}
.au-save-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}
.au-stem {
  width: 240px;
}
.au-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.au-midi-meta {
  margin: 12px 0;
  max-width: 640px;
}
.au-lib-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 4px 0 8px;
}
.au-ev-head {
  margin-top: 16px;
}
.au-lib-title {
  font-size: 13px;
  font-weight: 600;
}
.au-ev-tag {
  margin-right: 4px;
}
.au-dim {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}
</style>
