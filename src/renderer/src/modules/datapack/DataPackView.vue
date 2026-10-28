<template>
  <div class="dpv">
    <!-- 未打开项目 -->
    <div v-if="!project" class="dpv-empty">
      <el-icon :size="46" class="dpv-empty-icon"><Collection /></el-icon>
      <h2>{{ t('datapack.emptyTitle') }}</h2>
      <p>{{ t('datapack.emptyDesc') }}</p>
      <p class="dpv-empty-sub">{{ t('datapack.openPrefix') }}
        <el-link type="primary" @click="ui.setActiveModule('project-manager')">{{ t('datapack.openProjectManager') }}</el-link>
        {{ t('datapack.openSuffix') }}
      </p>
    </div>

    <!-- 已打开项目但尚未初始化数据包 -->
    <div v-else-if="!meta" class="dpv-empty">
      <el-icon :size="46" class="dpv-empty-icon"><Collection /></el-icon>
      <h2>{{ t('datapack.createTitle') }}</h2>
      <p>{{ t(layoutMode === 'standalone' ? 'datapack.createDescStandalone' : 'datapack.createDescEmbedded') }}</p>
      <div class="dpv-create">
        <div class="dpv-row">
          <label class="dpv-label">{{ t('datapack.namespace') }}</label>
          <el-input v-model="createNamespace" size="small" class="dpv-ns" />
        </div>
        <p class="dpv-hint">
          {{ t(layoutMode === 'standalone' ? 'datapack.namespaceHintStandalone' : 'datapack.namespaceHintEmbedded') }}
        </p>
        <div class="dpv-row">
          <label class="dpv-label">{{ t('datapack.description') }}</label>
          <el-input v-model="createDesc" size="small" :placeholder="t('datapack.descriptionPlaceholder')" />
        </div>
        <div class="dpv-row">
          <label class="dpv-label">{{ t('datapack.targetVersion') }}</label>
          <el-radio-group v-model="createVersion" size="small">
            <el-radio-button value="1.20.1">1.20.1</el-radio-button>
            <el-radio-button value="1.21.1">1.21.1</el-radio-button>
          </el-radio-group>
        </div>
        <el-button type="primary" :loading="initializing" @click="onInit">
          <el-icon><Check /></el-icon> {{ t('datapack.init') }}
        </el-button>
      </div>
    </div>

    <!-- 已初始化：分类树在 SideBar，此处仅编辑区 -->
    <div v-else class="dpv-body">
      <main class="dpv-main dpv-main-full">
        <header class="dpv-meta-head">
          <span class="dpv-meta-name">{{ meta.namespace }}</span>
          <el-tag size="small" type="info" effect="plain">pack_format {{ meta.packFormat }}</el-tag>
        </header>
        <!-- 未选中条目 -->
        <div v-if="!isEditing" class="dpv-main-empty">
          <el-icon :size="38" class="dpv-empty-icon"><Document /></el-icon>
          <p>{{ t('datapack.selectHint') }}</p>
        </div>

        <template v-else>
          <header class="dpv-entry-head">
            <div class="dpv-entry-meta">
              <code class="dpv-entry-path">{{ entryPathPreview }}</code>
              <span v-if="editDirty" class="dpv-dirty" :title="t('datapack.unsaved')" />
            </div>
            <div class="dpv-entry-actions">
              <el-button size="small" :disabled="!editDirty" @click="onDiscard">{{ t('datapack.discard') }}</el-button>
              <el-button size="small" type="primary" :loading="saving" @click="onSaveEntry">
                <el-icon><Check /></el-icon> {{ t('datapack.save') }}
              </el-button>
            </div>
          </header>

          <p v-if="validator.errors.value.length > 0" class="dpv-errors">
            <span v-for="(er, i) in validator.errors.value" :key="i" class="dpv-error">{{ er }}</span>
          </p>

          <!-- 新建时输入条目 ID -->
          <div v-if="editingNew" class="dpv-id-row">
            <label class="dpv-label">{{ t('datapack.entryId') }}</label>
            <el-input v-model="newId" size="small" class="dpv-id" :placeholder="t('datapack.entryIdPlaceholder')" />
          </div>

          <!-- 表单 / 源码双模式编辑区（function 类别仅源码 + 命令片段） -->
          <PackDualEditor
            v-model:form-value="formValue"
            v-model:form-context="formContext"
            v-model:source-text="draftText"
            v-model:mode="editMode"
            :form="formDef"
            :language="sourceLanguage"
            :snippets="sourceSnippets"
            :source-hint="noFormHint"
            @change="editDirty = true"
          />
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * DataPackView：数据包编辑器主视图。
 * 未初始化时提供创建表单（命名空间默认项目 modId），初始化后为「分类树 + 编辑区」布局。
 * 编辑区为「表单 / 源码」双模式：表单化类别（配方、战利品表、进度、标签等）走专用 Schema，
 * 保存时把表单值合并回原文档以保留未覆盖字段；function 为 mcfunction 命令文本，仅源码模式。
 */
import { computed, ref, watch } from 'vue'
import { Check, Collection, Document } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  DataPackCategory,
  DataPackEntry,
  DataPackMeta,
  McVersion
} from '../../../../shared/schemas/datapack.schema'
import {
  createEntryTemplate,
  dataPackEntryPath,
  dataPackCategory
} from '../../../../shared/schemas/datapack.schema'
import { datapackForm, getDatapackForm } from '../../../../shared/schemas/datapack/forms'
import { validateContentId } from '../../../../shared/types/content'
import { MCFUNCTION_SNIPPETS } from '../../../../shared/sourceSnippets'
import type { SnippetGroup } from '../../../../shared/sourceSnippets'
import type { PackLayoutMode } from '../../../../shared/types/ipc'
import { useProjectStore } from '../../stores/project'
import { useUiStore } from '../../stores/ui'
import { useDataPackStore } from '../../stores/datapack'
import { locale, t } from '../../i18n'
import PackDualEditor from '../../components/pack/PackDualEditor.vue'
import { useSchemaValidate } from '../../components/pack/useSchemaValidate'

const projectStore = useProjectStore()
const ui = useUiStore()
const validator = useSchemaValidate()
const dpStore = useDataPackStore()

const project = computed(() => projectStore.currentProject)
/** 布局模式：模组项目内嵌 resources；独立数据包项目根即包根 */
const layoutMode = computed<PackLayoutMode>(() =>
  project.value?.type === 'mod' ? 'embedded' : 'standalone'
)
const meta = ref<DataPackMeta | null>(null)

// 初始化表单
const createNamespace = ref('mymod')
const createDesc = ref('')
const createVersion = ref<McVersion>('1.20.1')
const initializing = ref(false)

// 编辑区状态
const editingEntry = ref<DataPackEntry | null>(null)
const editingNew = ref(false)
const newCategory = ref<DataPackCategory | null>(null)
const newId = ref('')
const editMode = ref<'form' | 'source'>('form')
const editDirty = ref(false)
const saving = ref(false)
const draftText = ref('')
/** 表单值（仅 schema 覆盖的字段） */
const formValue = ref<Record<string, unknown>>({})
/** 原文档上下文（JSON 原对象），保存时用于保留表单未覆盖字段 */
const formContext = ref<unknown>({})

const isEditing = computed(() => editingNew.value || editingEntry.value !== null)
const activeCategory = computed<DataPackCategory | null>(() => {
  if (editingNew.value) return newCategory.value
  return editingEntry.value?.category ?? null
})
/** 当前类别的表单定义；null（function）表示仅源码模式（随语言切换重建） */
const formDef = computed(() =>
  activeCategory.value ? getDatapackForm(activeCategory.value, locale.value) : null
)
const sourceLanguage = computed(() =>
  activeCategory.value === 'function' ? 'mcfunction' : 'json'
)
const sourceSnippets = computed<SnippetGroup[] | undefined>(() =>
  activeCategory.value === 'function' ? MCFUNCTION_SNIPPETS : undefined
)
const noFormHint = computed(() => t('datapack.noFormHint'))
const activeId = computed(() => (editingNew.value ? newId.value : editingEntry.value?.id ?? ''))
const entryPathPreview = computed(() => {
  const m = meta.value
  const cat = activeCategory.value
  if (!m || !cat) return ''
  const id = activeId.value || '—'
  const rel = dataPackEntryPath(m.namespace, cat, m.mcVersion, id)
  return layoutMode.value === 'standalone' ? rel : `src/main/resources/${rel}`
})

watch(
  () => project.value?.path,
  () => void loadMeta(),
  { immediate: true }
)

/** 项目切换后重读数据包元数据；未初始化时预填命名空间 */
async function loadMeta(): Promise<void> {
  meta.value = null
  dpStore.setEntries([])
  dpStore.select(null)
  resetEditing()
  const p = project.value
  if (!p) return
  try {
    const m = await window.api.datapack.getMeta(p.path)
    meta.value = m
    if (m) dpStore.setEntries(await window.api.datapack.listEntries(p.path, layoutMode.value))
    else createNamespace.value = p.namespace || p.modId || 'mymod'
  } catch (err) {
    ElMessage.error(t('datapack.readMetaFailed', { error: (err as Error).message }))
  }
}

async function onInit(): Promise<void> {
  const p = project.value
  if (!p) return
  initializing.value = true
  try {
    meta.value = await window.api.datapack.init(
      p.path,
      {
        namespace: createNamespace.value.trim(),
        description: createDesc.value.trim(),
        mcVersion: createVersion.value
      },
      layoutMode.value
    )
    dpStore.setEntries(await window.api.datapack.listEntries(p.path, layoutMode.value))
    ElMessage.success(t('datapack.initialized', { namespace: meta.value.namespace }))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    initializing.value = false
  }
}

function resetEditing(): void {
  editingEntry.value = null
  editingNew.value = false
  newCategory.value = null
  newId.value = ''
  editDirty.value = false
  draftText.value = ''
  formValue.value = {}
  formContext.value = {}
  editMode.value = 'form'
  validator.reset()
}

function onSelect(entry: DataPackEntry): void {
  if (editingEntry.value?.path === entry.path && !editingNew.value) return
  void selectAfterGuard(entry)
}

async function selectAfterGuard(entry: DataPackEntry): Promise<void> {
  if (editDirty.value && !(await guardDirty())) return
  editingNew.value = false
  newCategory.value = null
  editingEntry.value = entry
  await loadEntry(entry)
}

async function guardDirty(): Promise<boolean> {
  try {
    await ElMessageBox.confirm(
      t('datapack.dirtyConfirm'),
      t('datapack.dirtyTitle'),
      { type: 'warning' }
    )
    return true
  } catch {
    return false
  }
}

/** 载入既有条目：可表单化的类别解析进表单，解析失败或无表单则回落源码模式 */
async function loadEntry(entry: DataPackEntry): Promise<void> {
  const p = project.value
  if (!p) return
  validator.reset()
  try {
    const text = await window.api.datapack.readEntry(
      p.path,
      entry.category,
      entry.id,
      layoutMode.value
    )
    draftText.value = text
    formValue.value = {}
    formContext.value = {}
    const form = datapackForm(entry.category)
    if (!form) {
      editMode.value = 'source'
    } else {
      const doc = form.parse(text)
      if (doc) {
        formValue.value = doc.value
        formContext.value = doc.context
        editMode.value = 'form'
      } else {
        ElMessage.warning(t('datapack.invalidJsonFallback'))
        editMode.value = 'source'
      }
    }
    editDirty.value = false
  } catch (err) {
    ElMessage.error(t('datapack.readEntryFailed', { error: (err as Error).message }))
  }
}

function onCreate(category: DataPackCategory): void {
  const info = dataPackCategory(category)
  if (!info) return
  if (editDirty.value) {
    void createAfterGuard(category)
    return
  }
  beginCreate(category)
}

async function createAfterGuard(category: DataPackCategory): Promise<void> {
  if (!(await guardDirty())) return
  beginCreate(category)
}

function beginCreate(category: DataPackCategory): void {
  editingEntry.value = null
  editingNew.value = true
  newCategory.value = category
  newId.value = ''
  editDirty.value = true
  validator.reset()
  const m = meta.value
  const form = datapackForm(category)
  if (form) {
    const def = form.createDefault()
    formValue.value = def
    formContext.value = {}
    draftText.value = form.serialize(def, {})
    editMode.value = 'form'
  } else {
    formValue.value = {}
    formContext.value = {}
    draftText.value = createEntryTemplate(category, 'new_entry', m?.namespace ?? 'mymod')
    editMode.value = 'source'
  }
}

async function onDiscard(): Promise<void> {
  if (editingNew.value) {
    resetEditing()
    return
  }
  if (editingEntry.value) await loadEntry(editingEntry.value)
}

async function onSaveEntry(): Promise<void> {
  const p = project.value
  const m = meta.value
  const cat = activeCategory.value
  if (!p || !m || !cat) return
  const id = activeId.value.trim()
  if (!validateContentId(id)) {
    ElMessage.warning(t('datapack.invalidId'))
    return
  }
  let contentText: string
  const form = formDef.value
  if (form && editMode.value === 'form') {
    if (!validator.validate(form.schema, formValue.value)) {
      ElMessage.warning(t('datapack.formInvalid'))
      return
    }
    contentText = form.serialize(formValue.value, formContext.value)
  } else {
    contentText = draftText.value
    if (cat !== 'function') {
      try {
        JSON.parse(contentText)
      } catch (err) {
        ElMessage.error(t('datapack.jsonInvalid', { error: (err as Error).message }))
        return
      }
    }
  }
  if (!contentText.trim()) {
    ElMessage.warning(t('datapack.emptyContent'))
    return
  }
  saving.value = true
  try {
    const entry = await window.api.datapack.writeEntry(
      p.path,
      cat,
      id,
      contentText,
      layoutMode.value
    )
    ElMessage.success(t('datapack.saved', { path: entry.path }))
    editingNew.value = false
    newCategory.value = null
    editingEntry.value = entry
    await refreshEntries()
    await loadEntry(entry)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

async function onDelete(entry: DataPackEntry): Promise<void> {
  const p = project.value
  if (!p) return
  try {
    await ElMessageBox.confirm(
      t('datapack.deleteConfirm', { path: entry.path }),
      t('datapack.deleteTitle'),
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await window.api.datapack.deleteEntry(p.path, entry.category, entry.id, layoutMode.value)
    ElMessage.success(t('datapack.deleted', { id: entry.id }))
    if (editingEntry.value?.path === entry.path) resetEditing()
    await refreshEntries()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function refreshEntries(): Promise<void> {
  const p = project.value
  if (!p) return
  dpStore.setEntries(await window.api.datapack.listEntries(p.path, layoutMode.value))
}

// 监听 SideBar 分类树的选中/新建/删除信号
watch(
  () => dpStore.active,
  (entry) => {
    if (entry) onSelect(entry)
  }
)
watch(
  () => dpStore.createSignal,
  (sig) => {
    if (sig) {
      onCreate(sig.category)
      dpStore.clearSignals()
    }
  }
)
watch(
  () => dpStore.deleteSignal,
  (sig) => {
    if (sig) {
      void onDelete(sig.entry)
      dpStore.clearSignals()
    }
  }
)
</script>

<style scoped>
.dpv {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-panel);
  overflow: hidden;
}
.dpv-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ky-text-dim);
  text-align: center;
  padding: 24px;
}
.dpv-empty-icon {
  opacity: 0.3;
  margin-bottom: 8px;
}
.dpv-empty h2 {
  font-size: 16px;
  font-weight: 500;
  color: var(--ky-text-sub);
  margin: 0;
}
.dpv-empty p {
  font-size: 13px;
  margin: 0;
}
.dpv-empty-sub {
  font-size: 12px !important;
}
.dpv-create {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  width: 380px;
  max-width: 90%;
  text-align: left;
  padding: 16px;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: var(--ky-bg-sidebar);
}
.dpv-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dpv-label {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.dpv-ns {
  max-width: 220px;
}
.dpv-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.dpv-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.dpv-meta-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
}
.dpv-meta-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}
.dpv-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dpv-main-full {
  width: 100%;
}
.dpv-main-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ky-text-dim);
}
.dpv-entry-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
}
.dpv-entry-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dpv-entry-path {
  font-size: 11.5px;
  color: var(--ky-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dpv-dirty {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ky-accent);
  flex-shrink: 0;
}
.dpv-entry-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.dpv-errors {
  margin: 8px 14px 0;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid color-mix(in srgb, #f38ba8 45%, transparent);
  border-radius: 6px;
  background: rgba(243, 139, 168, 0.1);
}
.dpv-error {
  font-size: 11px;
  color: #f38ba8;
  word-break: break-all;
}
.dpv-id-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 0;
  flex-shrink: 0;
}
.dpv-id {
  width: 240px;
}
</style>
