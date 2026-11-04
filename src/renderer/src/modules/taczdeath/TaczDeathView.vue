<!--
  TaCZ 死亡消息（TACZDeathMessage）——整合包项目可视化编辑。
  左：全局默认消息；右：按世界（维度）覆盖配置。
  每条消息下方带颜色码实时预览（&0~&f / &l &o &n &m &r）。
-->
<template>
  <div class="td-view">
    <!-- 顶栏 -->
    <div class="td-toolbar">
      <div class="td-toolbar-left">
        <el-button size="small" plain @click="onRead">{{ t('taczdeath.reload') }}</el-button>
        <el-button size="small" type="primary" plain @click="onSave">{{ t('taczdeath.save') }}</el-button>
        <el-button size="small" text @click="onResetDefaults">{{ t('taczdeath.resetDefaults') }}</el-button>
      </div>
      <div class="td-toolbar-right">
        <span class="td-path" :title="`${globalPath}\n${worldPath}`">
          {{ existsText }}
        </span>
        <el-tag v-if="dirty" size="small" type="warning" effect="light">{{ t('taczdeath.unsaved') }}</el-tag>
      </div>
    </div>

    <div class="td-body">
      <!-- 全局配置 -->
      <section class="td-col">
        <h3 class="td-col-title">
          {{ t('taczdeath.globalTitle') }}
          <span class="td-file">{{ globalFileName }}</span>
        </h3>

        <el-form label-width="110px" size="small" class="td-form" @change="dirty = true">
          <el-form-item :label="t('taczdeath.defaultWorldEnabled')">
            <el-switch v-model="global.defaultWorldEnabled" />
            <span class="td-hint">{{ t('taczdeath.defaultWorldEnabledHint') }}</span>
          </el-form-item>

          <el-form-item :label="t('taczdeath.headshotSuffix')">
            <el-input v-model="global.headshotSuffix" />
          </el-form-item>

          <div class="td-group-title">{{ t('taczdeath.playerKill') }}</div>
          <el-form-item :label="t('taczdeath.normal')">
            <el-input v-model="global.messages.player.normal" />
          </el-form-item>
          <div class="td-preview" v-html="renderPreview(global.messages.player.normal)" />
          <el-form-item :label="t('taczdeath.headshot')">
            <el-input v-model="global.messages.player.headshot" />
          </el-form-item>
          <div class="td-preview" v-html="renderPreview(global.messages.player.headshot)" />

          <div class="td-group-title">{{ t('taczdeath.animalKill') }}</div>
          <el-form-item :label="t('taczdeath.normal')">
            <el-input v-model="global.messages.animal.normal" />
          </el-form-item>
          <div class="td-preview" v-html="renderPreview(global.messages.animal.normal)" />
          <el-form-item :label="t('taczdeath.headshot')">
            <el-input v-model="global.messages.animal.headshot" />
          </el-form-item>
          <div class="td-preview" v-html="renderPreview(global.messages.animal.headshot)" />
        </el-form>
      </section>

      <!-- 世界覆盖 -->
      <section class="td-col">
        <h3 class="td-col-title">
          {{ t('taczdeath.worldsTitle') }}
          <span class="td-file">{{ worldFileName }}</span>
        </h3>

        <div class="td-worlds-head">
          <el-input
            v-model="newWorldId"
            size="small"
            :placeholder="t('taczdeath.newWorldPlaceholder')"
            class="td-new-world"
            @keyup.enter="onAddWorld"
          />
          <el-button size="small" @click="onAddWorld">{{ t('taczdeath.addWorld') }}</el-button>
        </div>

        <el-empty
          v-if="worldIds.length === 0"
          :description="t('taczdeath.noWorlds')"
          :image-size="64"
        />

        <div v-for="dim in worldIds" :key="dim" class="td-world-card">
          <div class="td-world-head">
            <el-input v-model="renameTargets[dim]" size="small" class="td-world-id" />
            <el-button size="small" text @click="onRenameWorld(dim)">{{ t('taczdeath.rename') }}</el-button>
            <el-switch
              v-model="worlds.worlds[dim].enabled"
              size="small"
              @change="dirty = true"
            />
            <span class="td-world-enabled-label">{{ t('taczdeath.enabled') }}</span>
            <el-button
              size="small"
              text
              type="danger"
              class="td-world-del"
              @click="onDeleteWorld(dim)"
            >{{ t('taczdeath.remove') }}</el-button>
          </div>

          <el-form label-width="80px" size="small" class="td-form" @change="dirty = true">
            <div class="td-group-title">{{ t('taczdeath.playerKill') }}</div>
            <el-form-item :label="t('taczdeath.normal')">
              <el-input v-model="worlds.worlds[dim].messages.player.normal" />
            </el-form-item>
            <div class="td-preview" v-html="renderPreview(worlds.worlds[dim].messages.player.normal)" />
            <el-form-item :label="t('taczdeath.headshot')">
              <el-input v-model="worlds.worlds[dim].messages.player.headshot" />
            </el-form-item>
            <div class="td-preview" v-html="renderPreview(worlds.worlds[dim].messages.player.headshot)" />

            <div class="td-group-title">{{ t('taczdeath.animalKill') }}</div>
            <el-form-item :label="t('taczdeath.normal')">
              <el-input v-model="worlds.worlds[dim].messages.animal.normal" />
            </el-form-item>
            <div class="td-preview" v-html="renderPreview(worlds.worlds[dim].messages.animal.normal)" />
            <el-form-item :label="t('taczdeath.headshot')">
              <el-input v-model="worlds.worlds[dim].messages.animal.headshot" />
            </el-form-item>
            <div class="td-preview" v-html="renderPreview(worlds.worlds[dim].messages.animal.headshot)" />
          </el-form>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectStore } from '../../stores/project'
import { t } from '../../i18n'
import type {
  TaczGlobalConfig,
  TaczWorldConfig,
  TaczWorldsFile
} from '../../../../shared/types/taczdeath'
import { TACZ_DEFAULT_GLOBAL, TACZ_DEFAULT_WORLD } from '../../../../shared/types/taczdeath'

const projectStore = useProjectStore()
const root = computed(() => projectStore.currentProject?.path ?? '')

// ---- 状态 ----
const global = ref<TaczGlobalConfig>(structuredClone(TACZ_DEFAULT_GLOBAL))
const worlds = ref<TaczWorldsFile>({ worlds: {} })
const dirty = ref(false)
const globalPath = ref('')
const worldPath = ref('')
const fileExists = reactive({ global: false, world: false })
const newWorldId = ref('')
/** 每个世界的维度 ID 编辑暂存（避免在输入过程中重建对象键导致失焦） */
const renameTargets = reactive<Record<string, string>>({})

const globalFileName = 'global_config.json'
const worldFileName = 'world_config.json'

const worldIds = computed(() => Object.keys(worlds.value.worlds))

const existsText = computed(() => {
  if (!globalPath.value) return ''
  if (!fileExists.global && !fileExists.world) return t('taczdeath.willCreate')
  return t('taczdeath.filesPresent')
})

// ---- 生命周期 ----
onMounted(onRead)

async function onRead(): Promise<void> {
  if (!root.value) return
  const res = await window.api.taczdeath.read(root.value)
  global.value = res.global
  worlds.value = res.worlds
  globalPath.value = res.globalPath
  worldPath.value = res.worldPath
  fileExists.global = res.exists.global
  fileExists.world = res.exists.world
  // 同步维度 ID 编辑暂存
  for (const k of Object.keys(renameTargets)) delete renameTargets[k]
  for (const k of Object.keys(res.worlds.worlds)) renameTargets[k] = k
  dirty.value = false
  if (res.error) ElMessage.warning(res.error)
}

async function onSave(): Promise<void> {
  if (!root.value) {
    ElMessage.warning(t('taczdeath.noProject'))
    return
  }
  const res = await window.api.taczdeath.save(root.value, global.value, worlds.value)
  if ('error' in res) {
    ElMessage.error(t('taczdeath.saveError', { error: res.error }))
    return
  }
  globalPath.value = res.globalPath
  worldPath.value = res.worldPath
  fileExists.global = true
  fileExists.world = true
  dirty.value = false
  ElMessage.success(t('taczdeath.saved'))
}

async function onResetDefaults(): Promise<void> {
  try {
    await ElMessageBox.confirm(t('taczdeath.confirmReset'), t('taczdeath.confirmTitle'), {
      confirmButtonText: t('taczdeath.confirm'),
      cancelButtonText: t('taczdeath.cancel'),
      type: 'warning'
    })
  } catch {
    return
  }
  global.value = structuredClone(TACZ_DEFAULT_GLOBAL)
  dirty.value = true
}

// ---- 世界增删改 ----
function onAddWorld(): void {
  const dim = newWorldId.value.trim()
  if (!dim) {
    ElMessage.warning(t('taczdeath.worldIdRequired'))
    return
  }
  if (worlds.value.worlds[dim]) {
    ElMessage.warning(t('taczdeath.worldExists', { dim }))
    return
  }
  worlds.value.worlds[dim] = structuredClone(TACZ_DEFAULT_WORLD) as TaczWorldConfig
  renameTargets[dim] = dim
  newWorldId.value = ''
  dirty.value = true
}

async function onDeleteWorld(dim: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('taczdeath.confirmDeleteWorld', { dim }),
      t('taczdeath.confirmTitle'),
      {
        confirmButtonText: t('taczdeath.confirm'),
        cancelButtonText: t('taczdeath.cancel'),
        type: 'warning'
      }
    )
  } catch {
    return
  }
  delete worlds.value.worlds[dim]
  delete renameTargets[dim]
  dirty.value = true
}

/** 改名 = 用新键搬移配置对象（保持插入顺序） */
function onRenameWorld(oldDim: string): void {
  const next = (renameTargets[oldDim] ?? '').trim()
  if (!next || next === oldDim) return
  if (worlds.value.worlds[next]) {
    ElMessage.warning(t('taczdeath.worldExists', { dim: next }))
    return
  }
  const rebuilt: Record<string, TaczWorldConfig> = {}
  for (const [k, v] of Object.entries(worlds.value.worlds)) {
    rebuilt[k === oldDim ? next : k] = v
  }
  worlds.value.worlds = rebuilt
  delete renameTargets[oldDim]
  renameTargets[next] = next
  dirty.value = true
}

// ---- 颜色码预览 ----

/** MC 16 色 → 主题变量（深色主题为原色，浅色主题自动加深，避免亮色在白底上看不清） */
const MC_COLORS: Record<string, string> = {
  '0': 'var(--ky-mc-0)',
  '1': 'var(--ky-mc-1)',
  '2': 'var(--ky-mc-2)',
  '3': 'var(--ky-mc-3)',
  '4': 'var(--ky-mc-4)',
  '5': 'var(--ky-mc-5)',
  '6': 'var(--ky-mc-6)',
  '7': 'var(--ky-mc-7)',
  '8': 'var(--ky-mc-8)',
  '9': 'var(--ky-mc-9)',
  a: 'var(--ky-mc-a)',
  b: 'var(--ky-mc-b)',
  c: 'var(--ky-mc-c)',
  d: 'var(--ky-mc-d)',
  e: 'var(--ky-mc-e)',
  f: 'var(--ky-mc-f)'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 把 MC 颜色码渲染成 HTML 预览。
 * 占位符先替换成示例值，再转义 HTML，最后解析 & 代码。
 */
function renderPreview(text: string): string {
  const withSample = (text || '')
    .replace(/\{killer\}/g, 'Steve')
    .replace(/\{victim\}/g, 'Alex')
    .replace(/\{gun\}/g, 'AK47')

  // 先按 & 代码切分（保留分隔符）
  const tokens = escapeHtml(withSample).split(/(&[0-9a-fk-orA-FK-OR])/)

  let color = ''
  let bold = false
  let italic = false
  let underline = false
  let strike = false

  const parts: string[] = []
  for (const tok of tokens) {
    if (!tok) continue

    const codeMatch = /^&([0-9a-fk-orA-FK-OR])$/.exec(tok)
    if (codeMatch) {
      const c = codeMatch[1].toLowerCase()
      if (MC_COLORS[c]) {
        color = MC_COLORS[c]
      } else if (c === 'l') {
        bold = true
      } else if (c === 'o') {
        italic = true
      } else if (c === 'n') {
        underline = true
      } else if (c === 'm') {
        strike = true
      } else if (c === 'r') {
        color = ''
        bold = italic = underline = strike = false
      }
      // &k（混淆）忽略
      continue
    }

    const decorations = [underline ? 'underline' : '', strike ? 'line-through' : '']
      .filter(Boolean)
      .join(' ')
    const style = [
      color ? `color:${color}` : '',
      bold ? 'font-weight:700' : '',
      italic ? 'font-style:italic' : '',
      decorations ? `text-decoration:${decorations}` : ''
    ]
      .filter(Boolean)
      .join(';')

    parts.push(style ? `<span style="${style}">${tok}</span>` : tok)
  }

  return parts.join('') || '&nbsp;'
}
</script>

<style scoped>
.td-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ky-bg-base, #111318);
  color: var(--ky-text, #e8ecf2);
}

.td-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar, #14171d);
}
.td-toolbar-left { display: flex; align-items: center; gap: 6px; }
.td-toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}
.td-path {
  font-size: 11px;
  color: var(--ky-text-dim);
  font-family: 'Consolas', monospace;
}

.td-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  overflow: hidden;
}

.td-col {
  min-width: 0;
  overflow-y: auto;
  padding: 12px 16px 40px;
}
.td-col:first-child { border-right: 1px solid var(--ky-border); }

.td-col-title {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text-sub);
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.td-file {
  font-size: 11px;
  font-weight: 400;
  color: var(--ky-text-dim);
  font-family: 'Consolas', monospace;
}

.td-form { margin-bottom: 8px; }

.td-group-title {
  font-size: 11px;
  font-weight: 600;
  color: #d49c4a;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 14px 0 6px;
}

.td-hint {
  margin-left: 8px;
  font-size: 11px;
  color: var(--ky-text-dim);
}

.td-preview {
  margin: -12px 0 10px 110px;
  padding: 6px 10px;
  min-height: 28px;
  background: var(--ky-code-bg);
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  font-size: 13px;
  line-height: 1.5;
  font-family: 'Segoe UI', sans-serif;
  word-break: break-word;
}

.td-worlds-head {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.td-new-world { flex: 1; }

.td-world-card {
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  padding: 10px 12px 14px;
  margin-bottom: 12px;
  background: var(--ky-bg-hover);
}

.td-world-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.td-world-id { flex: 1; }
.td-world-enabled-label { font-size: 11px; color: var(--ky-text-dim); }
.td-world-del { margin-left: auto; }

/* 世界卡片内预览缩进更小 */
.td-world-card .td-preview { margin-left: 80px; }
</style>
