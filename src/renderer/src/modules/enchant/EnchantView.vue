<template>
  <div class="enchant-view">
    <header class="enchant-header">
      <div>
        <h2>{{ t('enchant.title') }}</h2>
        <p>{{ t('enchant.subtitle') }}</p>
      </div>
      <div class="enchant-header-actions">
        <el-button :icon="Refresh" @click="reload()" :loading="loading">{{ t('enchant.refresh') }}</el-button>
        <el-button type="primary" :icon="Plus" @click="onCreate">{{ t('enchant.create') }}</el-button>
      </div>
    </header>

    <section v-if="!root" class="enchant-card">
      <div class="enchant-empty">{{ t('enchant.needProject') }}</div>
    </section>

    <div v-else class="enchant-body">
      <!-- 左：附魔列表 -->
      <aside class="enchant-list-card">
        <div class="enchant-list-title">
          {{ t('enchant.listTitle') }}
          <span class="enchant-count">{{ entries.length }}</span>
        </div>
        <el-scrollbar height="100%">
          <ul v-if="entries.length" class="enchant-list">
            <li
              v-for="e in entries"
              :key="e.id"
              :class="['enchant-list-item', { 'is-active': selectedId === e.id }]"
              @click="onSelect(e.id)"
            >
              <div class="enchant-list-main">
                <span class="enchant-list-name">{{ displayOf(e) }}</span>
                <span class="enchant-list-id">{{ e.id }}</span>
              </div>
              <el-button
                link
                :icon="Delete"
                class="enchant-list-del"
                :title="t('enchant.delete')"
                @click.stop="onDelete(e)"
              />
            </li>
          </ul>
          <div v-else class="enchant-list-empty">{{ t('enchant.emptyList') }}</div>
        </el-scrollbar>
      </aside>

      <!-- 右：编辑表单 -->
      <section v-if="form" class="enchant-card enchant-editor">
        <div class="enchant-editor-head">
          <div class="enchant-id-row">
            <label>{{ t('enchant.registryId') }}</label>
            <el-input v-model="form.id" :placeholder="t('enchant.idPlaceholder')" />
          </div>
          <div class="enchant-editor-actions">
            <el-button type="primary" :loading="saving" :disabled="Boolean(error)" @click="onSave">
              {{ t('enchant.save') }}
            </el-button>
          </div>
        </div>

        <el-alert
          v-if="error"
          :title="error"
          type="error"
          :closable="false"
          class="enchant-error"
        />

        <SchemaForm :schema="formSchema" v-model="form" />

        <div class="enchant-damage">
          <div class="enchant-damage-head">
            <span>{{ t('enchant.damageBonus') }}</span>
            <el-switch v-model="form.damageEnabled" />
          </div>
          <p class="enchant-damage-hint">
            {{ t('enchant.damageHint') }}
          </p>
          <div v-if="form.damageEnabled" class="enchant-damage-fields">
            <div class="enchant-num-field">
              <label>{{ t('enchant.damageBase') }}</label>
              <el-input-number v-model="form.damageBase" :min="0" :step="0.5" :precision="2" />
            </div>
            <div class="enchant-num-field">
              <label>{{ t('enchant.damagePerLevel') }}</label>
              <el-input-number
                v-model="form.damagePerLevel"
                :min="0"
                :step="0.5"
                :precision="2"
              />
            </div>
          </div>
        </div>
      </section>

      <section v-else class="enchant-card enchant-placeholder">
        <div class="enchant-empty">{{ t('enchant.selectOrCreate') }}</div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Plus, Refresh } from '@element-plus/icons-vue'
import SchemaForm from '../../components/pack/SchemaForm.vue'
import { useProjectStore } from '../../stores/project'
import type { ContentSummary } from '../../../../shared/types/content'
import type { EnchantmentSchema } from '../../../../shared/schemas/enchantment.schema'
import {
  fromFormModel,
  getEnchantmentFormSchema,
  newFormModel,
  toFormModel,
  validateForm,
  type EnchantFormModel
} from './enchantForm'
import { locale, t } from '../../i18n'

defineOptions({ name: 'EnchantView' })

const projectStore = useProjectStore()
const root = computed(() => projectStore.currentProject?.path ?? '')
// 依赖 locale：切换语言后重建表单 schema
const formSchema = computed(() => {
  void locale.value
  return getEnchantmentFormSchema()
})

const loading = ref(false)
const saving = ref(false)
const entries = ref<EnchantmentSchema[]>([])
const selectedId = ref('')
/** 进入编辑时的快照 id（重命名保存时作为 prevId） */
const savedId = ref('')
const form = ref<EnchantFormModel | null>(null)

const error = computed(() => (form.value ? validateForm(form.value) : null))

function displayOf(e: EnchantmentSchema): string {
  return e.displayName.zh_cn.trim() || e.displayName.en_us.trim() || e.id
}

async function reload(selectId = selectedId.value): Promise<void> {
  if (!root.value) return
  loading.value = true
  try {
    const summaries = (await window.api.content.list(root.value)) as ContentSummary[]
    const enchSummaries = summaries.filter((s) => s.kind === 'enchantment')
    const loaded: EnchantmentSchema[] = []
    for (const s of enchSummaries) {
      loaded.push((await window.api.content.load(root.value, 'enchantment', s.id)) as EnchantmentSchema)
    }
    loaded.sort((a, b) => a.id.localeCompare(b.id))
    entries.value = loaded
    if (selectId && loaded.some((e) => e.id === selectId)) {
      selectedId.value = selectId
    } else {
      selectedId.value = ''
      form.value = null
    }
  } catch (e) {
    ElMessage.error(t('enchant.loadFailed', { error: (e as Error).message }))
  } finally {
    loading.value = false
  }
}

async function onSelect(id: string): Promise<void> {
  if (!root.value) return
  const entry = entries.value.find((e) => e.id === id)
  if (!entry) return
  selectedId.value = id
  savedId.value = id
  form.value = toFormModel(entry)
}

async function onCreate(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      t('enchant.createPrompt'),
      t('enchant.createTitle'),
      {
        confirmButtonText: t('enchant.create'),
        cancelButtonText: t('common.cancel'),
        inputPattern: /^[a-z][a-z0-9_]{0,63}$/,
        inputErrorMessage: t('enchant.idInvalid')
      }
    )
    if (entries.value.some((e) => e.id === value)) {
      ElMessage.warning(t('enchant.duplicate', { id: value }))
      return
    }
    selectedId.value = value
    savedId.value = value
    form.value = newFormModel(value)
  } catch {
    // 用户取消
  }
}

async function onSave(): Promise<void> {
  if (!root.value || !form.value) return
  const err = validateForm(form.value)
  if (err) {
    ElMessage.error(err)
    return
  }
  saving.value = true
  try {
    const model = fromFormModel(form.value)
    await window.api.content.save(root.value, model, savedId.value !== model.id ? savedId.value : undefined)
    ElMessage.success(t('enchant.saved', { id: model.id }))
    await reload(model.id)
    savedId.value = model.id
  } catch (e) {
    ElMessage.error(t('enchant.saveFailed', { error: (e as Error).message }))
  } finally {
    saving.value = false
  }
}

async function onDelete(e: EnchantmentSchema): Promise<void> {
  if (!root.value) return
  try {
    await ElMessageBox.confirm(
      t('enchant.deleteConfirm', { name: displayOf(e) }),
      t('enchant.deleteTitle'),
      {
        confirmButtonText: t('enchant.deleteConfirmBtn'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
  } catch {
    return
  }
  try {
    await window.api.content.remove(root.value, 'enchantment', e.id)
    if (selectedId.value === e.id) {
      selectedId.value = ''
      form.value = null
    }
    ElMessage.success(t('enchant.deleted', { id: e.id }))
    await reload()
  } catch (err) {
    ElMessage.error(t('enchant.deleteFailed', { error: (err as Error).message }))
  }
}

onMounted(() => {
  void reload('')
})
</script>

<style scoped>
.enchant-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  gap: 14px;
  overflow: hidden;
}

.enchant-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.enchant-header h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.enchant-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  max-width: 720px;
}

.enchant-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.enchant-body {
  flex: 1;
  display: flex;
  gap: 14px;
  min-height: 0;
}

.enchant-list-card {
  width: 260px;
  flex-shrink: 0;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  padding: 10px;
  min-height: 0;
}

.enchant-list-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  padding: 2px 4px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.enchant-count {
  background: var(--el-fill-color);
  border-radius: 10px;
  padding: 0 8px;
  font-size: 12px;
}

.enchant-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.enchant-list-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.enchant-list-item:hover {
  background: var(--el-fill-color-light);
}

.enchant-list-item.is-active {
  background: var(--el-color-primary-light-9);
}

.enchant-list-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.enchant-list-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.enchant-list-id {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.enchant-list-del {
  color: var(--el-text-color-secondary);
}

.enchant-list-del:hover {
  color: var(--el-color-danger);
}

.enchant-list-empty,
.enchant-empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 24px 12px;
  text-align: center;
}

.enchant-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 16px;
}

.enchant-editor {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}

.enchant-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.enchant-editor-head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}

.enchant-id-row {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.enchant-id-row label {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.enchant-error {
  margin-bottom: 12px;
}

.enchant-damage {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.enchant-damage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
}

.enchant-damage-hint {
  margin: 6px 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.enchant-damage-fields {
  display: flex;
  gap: 24px;
}

.enchant-num-field {
  display: flex;
  align-items: center;
  gap: 10px;
}

.enchant-num-field label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
