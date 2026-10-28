<!--
  活动栏「FTB 任务书」：config/ftbquests/quests/chapters/*.snbt 章节编辑器
  - 左栏章节列表（新建/删除/选择），右栏章节表单 + 任务表格
  - 任务类型固定 item（提交物品），奖励 item 可选；依赖以标签展示（拖拽连线画布不在本版）
  - 保存经主进程重写为规范 SNBT（与生成器 buildFtbQuestChapter 互逆）
-->
<template>
  <div class="fq-view">
    <header class="fq-header">
      <div class="fq-heading">
        <h2>{{ t('ftbquest.title') }}</h2>
        <p>{{ t('ftbquest.subtitle') }}</p>
      </div>
      <div class="fq-actions">
        <el-button :icon="Plus" type="primary" @click="openChapterDialog()">
          {{ t('ftbquest.newChapter') }}
        </el-button>
        <el-button :icon="Refresh" :loading="loadingList" @click="reloadChapters">
          {{ t('ftbquest.refresh') }}
        </el-button>
      </div>
    </header>

    <el-alert
      v-for="(w, i) in warnings"
      :key="i"
      :title="t('ftbquest.parseFailed', { file: w })"
      type="warning"
      :closable="false"
      class="fq-warning"
    />

    <div class="fq-body">
      <!-- 章节列表 -->
      <div class="fq-chapters">
        <el-table
          :data="chapters"
          size="small"
          highlight-current-row
          max-height="520"
          @current-change="onSelectChapter"
        >
          <el-table-column prop="id" :label="t('ftbquest.colChapterId')" min-width="130" />
          <el-table-column prop="title" :label="t('ftbquest.colName')" min-width="110" />
          <el-table-column
            prop="questCount"
            :label="t('ftbquest.colQuestCount')"
            width="60"
            align="center"
          />
          <el-table-column label="" width="60" align="center">
            <template #default="{ row }">
              <el-button
                size="small"
                text
                type="danger"
                :icon="Delete"
                @click.stop="onDeleteChapter(row.id)"
              />
            </template>
          </el-table-column>
        </el-table>
        <p v-if="chapters.length === 0" class="fq-dim fq-empty">
          {{ t('ftbquest.emptyChapters') }}
        </p>
      </div>

      <!-- 章节明细 -->
      <div v-if="chapter" class="fq-detail">
        <el-form label-width="80px" size="small" class="fq-form">
          <el-form-item :label="t('ftbquest.labelId')">
            <el-input v-model="chapter.id" :disabled="saving" @input="dirty = true" />
          </el-form-item>
          <el-form-item :label="t('ftbquest.labelTitle')">
            <el-input v-model="chapter.title" @input="dirty = true" />
          </el-form-item>
          <el-form-item :label="t('ftbquest.labelIcon')">
            <el-input v-model="chapter.icon" placeholder="minecraft:book" @input="dirty = true" />
          </el-form-item>
        </el-form>

        <div class="fq-quests-head">
          <span class="fq-quests-title">
            {{ t('ftbquest.questsTitle', { n: chapter.quests.length }) }}
          </span>
          <el-button size="small" :icon="Plus" @click="openQuestDialog()">
            {{ t('ftbquest.newQuest') }}
          </el-button>
        </div>
        <el-table :data="chapter.quests" size="small" max-height="320">
          <el-table-column prop="id" :label="t('ftbquest.colQuestId')" min-width="110" />
          <el-table-column prop="title" :label="t('ftbquest.colQuestTitle')" min-width="110" />
          <el-table-column prop="item" :label="t('ftbquest.colItem')" min-width="150" />
          <el-table-column :label="t('ftbquest.colReward')" min-width="140">
            <template #default="{ row }">
              <span v-if="row.reward">{{ row.reward.item }} ×{{ row.reward.count }}</span>
              <span v-else class="fq-dim">—</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('ftbquest.colDeps')" min-width="140">
            <template #default="{ row }">
              <el-tag
                v-for="d in row.dependencies"
                :key="d"
                size="small"
                effect="plain"
                class="fq-dep-tag"
              >
                {{ d }}
              </el-tag>
              <span v-if="row.dependencies.length === 0" class="fq-dim">
                {{ t('ftbquest.none') }}
              </span>
            </template>
          </el-table-column>
          <el-table-column :label="t('ftbquest.colActions')" width="110">
            <template #default="{ row, $index }">
              <el-button size="small" text :icon="Edit" @click="openQuestDialog(row as FtbQuest, $index)" />
              <el-button size="small" text type="danger" :icon="Delete" @click="removeQuest($index)" />
            </template>
          </el-table-column>
        </el-table>

        <div class="fq-save-bar">
          <span v-if="dirty" class="fq-dirty">{{ t('ftbquest.unsaved') }}</span>
          <el-button
            type="primary"
            :icon="Check"
            :loading="saving"
            :disabled="!dirty"
            @click="onSaveChapter"
          >
            {{ t('ftbquest.saveChapter') }}
          </el-button>
        </div>
      </div>
      <div v-else class="fq-detail fq-placeholder">
        <p class="fq-dim">{{ t('ftbquest.placeholder') }}</p>
      </div>
    </div>

    <!-- 新建章节对话框 -->
    <el-dialog v-model="chapterDialog.visible" :title="t('ftbquest.newChapter')" width="420px">
      <el-form label-width="80px" size="small">
        <el-form-item :label="t('ftbquest.labelId')">
          <el-input
            v-model="chapterDialog.id"
            :placeholder="t('ftbquest.chapterIdPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('ftbquest.labelTitle')">
          <el-input
            v-model="chapterDialog.title"
            :placeholder="t('ftbquest.chapterTitlePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('ftbquest.labelIcon')">
          <el-input
            v-model="chapterDialog.icon"
            :placeholder="t('ftbquest.iconPlaceholder')"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="chapterDialog.visible = false">{{ t('ftbquest.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="onCreateChapter">
          {{ t('ftbquest.create') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 任务编辑对话框 -->
    <el-dialog
      v-model="questDialog.visible"
      :title="questDialog.index >= 0 ? t('ftbquest.editQuest') : t('ftbquest.addQuest')"
      width="480px"
    >
      <el-form label-width="90px" size="small">
        <el-form-item :label="t('ftbquest.colQuestId')">
          <el-input v-model="questDialog.id" :placeholder="t('ftbquest.questIdPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('ftbquest.colQuestTitle')">
          <el-input
            v-model="questDialog.title"
            :placeholder="t('ftbquest.questTitlePlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('ftbquest.labelDescription')">
          <el-input
            v-model="questDialog.description"
            type="textarea"
            :rows="3"
            :placeholder="t('ftbquest.descriptionPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="t('ftbquest.colItem')">
          <el-input v-model="questDialog.item" :placeholder="t('ftbquest.itemPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('ftbquest.colReward')">
          <el-switch v-model="questDialog.hasReward" :active-text="t('ftbquest.rewardToggle')" />
        </el-form-item>
        <template v-if="questDialog.hasReward">
          <el-form-item :label="t('ftbquest.labelRewardItem')">
            <el-input
              v-model="questDialog.rewardItem"
              :placeholder="t('ftbquest.rewardItemPlaceholder')"
            />
          </el-form-item>
          <el-form-item :label="t('ftbquest.labelRewardCount')">
            <el-input-number v-model="questDialog.rewardCount" :min="1" :max="9999" />
          </el-form-item>
        </template>
        <el-form-item v-if="questDialog.dependencies.length > 0" :label="t('ftbquest.colDeps')">
          <el-tag
            v-for="d in questDialog.dependencies"
            :key="d"
            size="small"
            effect="plain"
            class="fq-dep-tag"
          >
            {{ d }}
          </el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="questDialog.visible = false">{{ t('ftbquest.cancel') }}</el-button>
        <el-button type="primary" @click="applyQuestDialog">{{ t('ftbquest.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Delete, Edit, Plus, Refresh } from '@element-plus/icons-vue'
import type {
  FtbQuest,
  FtbQuestChapter,
  FtbQuestChapterSummary
} from '../../../../shared/types/ftbquest'
import { useProjectStore } from '../../stores/project'
import { t } from '../../i18n'

const projectStore = useProjectStore()
const root = computed(() => projectStore.currentProject?.path ?? '')

const chapters = ref<FtbQuestChapterSummary[]>([])
const warnings = ref<string[]>([])
const chapter = ref<FtbQuestChapter | null>(null)
/** 打开章节时的磁盘 id（保存时作 prevId，支持重命名） */
const chapterDiskId = ref('')
const loadingList = ref(false)
const saving = ref(false)
const dirty = ref(false)

const chapterDialog = reactive({ visible: false, id: '', title: '', icon: 'minecraft:book' })
const questDialog = reactive({
  visible: false,
  index: -1,
  id: '',
  title: '',
  description: '',
  item: 'minecraft:stone',
  hasReward: false,
  rewardItem: 'minecraft:bread',
  rewardCount: 1,
  dependencies: [] as string[]
})

async function reloadChapters(): Promise<void> {
  if (!root.value) return
  loadingList.value = true
  try {
    const res = await window.api.ftbQuest.list(root.value)
    chapters.value = res.chapters
    warnings.value = res.warnings
    if (chapter.value && !res.chapters.some((c) => c.id === chapterDiskId.value)) {
      chapter.value = null
      dirty.value = false
    }
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loadingList.value = false
  }
}

async function onSelectChapter(row: FtbQuestChapterSummary | null): Promise<void> {
  if (!row || (chapter.value && row.id === chapterDiskId.value)) return
  if (dirty.value) {
    try {
      await ElMessageBox.confirm(
        t('ftbquest.discardConfirm'),
        t('ftbquest.discardTitle'),
        {
          type: 'warning',
          confirmButtonText: t('ftbquest.discardBtn'),
          cancelButtonText: t('ftbquest.cancel')
        }
      )
    } catch {
      return
    }
  }
  try {
    chapter.value = await window.api.ftbQuest.read(root.value, row.id)
    chapterDiskId.value = row.id
    dirty.value = false
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function openChapterDialog(): void {
  chapterDialog.id = ''
  chapterDialog.title = ''
  chapterDialog.icon = 'minecraft:book'
  chapterDialog.visible = true
}

async function onCreateChapter(): Promise<void> {
  const id = chapterDialog.id.trim()
  if (!id || !chapterDialog.title.trim()) {
    ElMessage.warning(t('ftbquest.chapterFieldsRequired'))
    return
  }
  saving.value = true
  try {
    await window.api.ftbQuest.save(root.value, {
      id,
      title: chapterDialog.title.trim(),
      icon: chapterDialog.icon.trim() || 'minecraft:book',
      quests: []
    })
    ElMessage.success(t('ftbquest.chapterCreated', { id }))
    chapterDialog.visible = false
    await reloadChapters()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

async function onDeleteChapter(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('ftbquest.deleteChapterConfirm', { id }),
      t('ftbquest.deleteChapterTitle'),
      {
        type: 'warning',
        confirmButtonText: t('ftbquest.delete'),
        cancelButtonText: t('ftbquest.cancel')
      }
    )
  } catch {
    return
  }
  try {
    await window.api.ftbQuest.remove(root.value, id)
    ElMessage.success(t('ftbquest.chapterDeleted', { id }))
    if (chapterDiskId.value === id) {
      chapter.value = null
      dirty.value = false
    }
    await reloadChapters()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function openQuestDialog(quest?: FtbQuest, index = -1): void {
  questDialog.index = quest ? index : -1
  questDialog.id = quest?.id ?? ''
  questDialog.title = quest?.title ?? ''
  questDialog.description = (quest?.description ?? []).join('\n')
  questDialog.item = quest?.item ?? 'minecraft:stone'
  questDialog.hasReward = !!quest?.reward
  questDialog.rewardItem = quest?.reward?.item ?? 'minecraft:bread'
  questDialog.rewardCount = quest?.reward?.count ?? 1
  questDialog.dependencies = [...(quest?.dependencies ?? [])]
  questDialog.visible = true
}

function applyQuestDialog(): void {
  if (!chapter.value) return
  const id = questDialog.id.trim()
  if (!id || !questDialog.title.trim()) {
    ElMessage.warning(t('ftbquest.questFieldsRequired'))
    return
  }
  const dup = chapter.value.quests.some((q, i) => q.id === id && i !== questDialog.index)
  if (dup) {
    ElMessage.warning(t('ftbquest.questDuplicate', { id }))
    return
  }
  const quest: FtbQuest = {
    id,
    title: questDialog.title.trim(),
    description: questDialog.description
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    dependencies: questDialog.dependencies,
    item: questDialog.item.trim() || 'minecraft:stone',
    ...(questDialog.hasReward
      ? { reward: { item: questDialog.rewardItem.trim() || 'minecraft:bread', count: questDialog.rewardCount } }
      : {})
  }
  if (questDialog.index >= 0) chapter.value.quests[questDialog.index] = quest
  else chapter.value.quests.push(quest)
  dirty.value = true
  questDialog.visible = false
}

function removeQuest(index: number): void {
  chapter.value?.quests.splice(index, 1)
  dirty.value = true
}

async function onSaveChapter(): Promise<void> {
  if (!chapter.value) return
  saving.value = true
  try {
    await window.api.ftbQuest.save(root.value, chapter.value, chapterDiskId.value)
    ElMessage.success(t('ftbquest.chapterSaved', { id: chapter.value.id }))
    chapterDiskId.value = chapter.value.id
    dirty.value = false
    await reloadChapters()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(reloadChapters)
</script>

<style scoped>
.fq-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  height: 100%;
  overflow: auto;
}

.fq-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.fq-heading h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.fq-heading p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  max-width: 640px;
}

.fq-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.fq-warning {
  margin-bottom: 4px;
}

.fq-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.fq-chapters {
  width: 380px;
  flex-shrink: 0;
}

.fq-empty {
  padding: 12px 4px;
  font-size: 12px;
}

.fq-detail {
  flex: 1;
  min-width: 0;
}

.fq-placeholder {
  padding: 48px 0;
  text-align: center;
}

.fq-form {
  max-width: 480px;
}

.fq-quests-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 8px 0;
}

.fq-quests-title {
  font-size: 13px;
  font-weight: 600;
}

.fq-dep-tag {
  margin-right: 4px;
}

.fq-save-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.fq-dirty {
  color: var(--el-color-warning);
  font-size: 12px;
}

.fq-dim {
  color: var(--el-text-color-secondary);
}
</style>
