<!--
  活动栏「指南书」：Patchouli 手册编辑器
  - config/<namespace>/patchouli_books/<book>/ 直读直写（book.json + 类目 + 条目页面）
  - 页面类型：text / crafting / image / spotlight；保存为同步语义（移除已删类目/条目文件）
-->
<template>
  <div class="pb-view">
    <header class="pb-header">
      <div class="pb-heading">
        <h2>指南书（Patchouli）</h2>
        <p>
          编辑 config/&lt;命名空间&gt;/patchouli_books/ 下的手册：book.json、类目与条目页面。
          保存即落盘，游戏内持有手册即可翻阅。
        </p>
      </div>
      <div class="pb-actions">
        <el-button :icon="Plus" type="primary" @click="openBookDialog">新建手册</el-button>
        <el-button :icon="Refresh" :loading="loadingList" @click="reloadBooks">刷新</el-button>
      </div>
    </header>

    <el-alert
      v-for="(w, i) in warnings"
      :key="i"
      :title="`手册解析失败：${w}`"
      type="warning"
      :closable="false"
      class="pb-warning"
    />

    <div class="pb-body">
      <div class="pb-books">
        <el-table :data="books" size="small" highlight-current-row max-height="520" @current-change="onSelectBook">
          <el-table-column prop="bookId" label="手册 id" min-width="110" />
          <el-table-column prop="namespace" label="命名空间" min-width="90" />
          <el-table-column prop="name" label="书名" min-width="100" />
          <el-table-column label="类目/条目" width="80" align="center">
            <template #default="{ row }">{{ row.categoryCount }}/{{ row.entryCount }}</template>
          </el-table-column>
          <el-table-column label="" width="56" align="center">
            <template #default="{ row }">
              <el-button size="small" text type="danger" :icon="Delete" @click.stop="onDeleteBook(row as PatchouliBookSummary)" />
            </template>
          </el-table-column>
        </el-table>
        <p v-if="books.length === 0" class="pb-dim pb-empty">
          还没有手册。点击「新建手册」创建第一本指南书。
        </p>
      </div>

      <div v-if="book" class="pb-detail">
        <el-form label-width="90px" size="small" class="pb-form">
          <el-form-item label="命名空间">
            <el-input v-model="book.namespace" @input="dirty = true" />
          </el-form-item>
          <el-form-item label="手册 id">
            <el-input v-model="book.bookId" @input="dirty = true" />
          </el-form-item>
          <el-form-item label="书名">
            <el-input v-model="book.name" @input="dirty = true" />
          </el-form-item>
          <el-form-item label="简介">
            <el-input v-model="book.landingText" type="textarea" :rows="2" @input="dirty = true" />
          </el-form-item>
        </el-form>

        <div class="pb-sec-head">
          <span class="pb-sec-title">类目（{{ book.categories.length }}）</span>
          <el-button size="small" :icon="Plus" @click="openCategoryDialog()">新建类目</el-button>
        </div>
        <el-table
          :data="book.categories"
          size="small"
          highlight-current-row
          max-height="200"
          @current-change="(row: PatchouliCategory | null) => (activeCatId = row?.id ?? '')"
        >
          <el-table-column prop="id" label="类目 id" min-width="100" />
          <el-table-column prop="name" label="名称" min-width="90" />
          <el-table-column prop="icon" label="图标" min-width="130" />
          <el-table-column label="条目" width="56" align="center">
            <template #default="{ row }">{{ row.entries.length }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110">
            <template #default="{ row, $index }">
              <el-button size="small" text :icon="Edit" @click="openCategoryDialog(row as PatchouliCategory, $index)" />
              <el-button size="small" text type="danger" :icon="Delete" @click="book!.categories.splice($index, 1); dirty = true" />
            </template>
          </el-table-column>
        </el-table>

        <template v-if="activeCategory">
          <div class="pb-sec-head">
            <span class="pb-sec-title">条目：{{ activeCategory.name }}（{{ activeCategory.entries.length }}）</span>
            <el-button size="small" :icon="Plus" @click="openEntryDialog()">新建条目</el-button>
          </div>
          <el-table :data="activeCategory.entries" size="small" max-height="220">
            <el-table-column prop="id" label="条目 id" min-width="100" />
            <el-table-column prop="name" label="名称" min-width="90" />
            <el-table-column prop="icon" label="图标" min-width="130" />
            <el-table-column label="页面" width="56" align="center">
              <template #default="{ row }">{{ row.pages.length }}</template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{ row, $index }">
                <el-button size="small" text :icon="Edit" @click="openEntryDialog(row as PatchouliEntry, $index)" />
                <el-button size="small" text type="danger" :icon="Delete" @click="activeCategory!.entries.splice($index, 1); dirty = true" />
              </template>
            </el-table-column>
          </el-table>
        </template>

        <div class="pb-save-bar">
          <span v-if="dirty" class="pb-dirty">有未保存修改</span>
          <el-button type="primary" :icon="Check" :loading="saving" :disabled="!dirty" @click="onSaveBook">
            保存手册
          </el-button>
        </div>
      </div>
      <div v-else class="pb-detail pb-placeholder">
        <p class="pb-dim">从左侧选择一本手册开始编辑，或新建手册。</p>
      </div>
    </div>

    <!-- 新建手册对话框 -->
    <el-dialog v-model="bookDialog.visible" title="新建手册" width="440px">
      <el-form label-width="90px" size="small">
        <el-form-item label="命名空间">
          <el-input v-model="bookDialog.namespace" placeholder="通常为模组 id" />
        </el-form-item>
        <el-form-item label="手册 id">
          <el-input v-model="bookDialog.bookId" placeholder="guide" />
        </el-form-item>
        <el-form-item label="书名">
          <el-input v-model="bookDialog.name" placeholder="整合包指南" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bookDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreateBook">创建</el-button>
      </template>
    </el-dialog>

    <!-- 类目对话框 -->
    <el-dialog v-model="catDialog.visible" :title="catDialog.index >= 0 ? '编辑类目' : '新建类目'" width="440px">
      <el-form label-width="90px" size="small">
        <el-form-item label="类目 id"><el-input v-model="catDialog.id" placeholder="basics" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="catDialog.name" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="catDialog.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="catDialog.icon" placeholder="minecraft:book" /></el-form-item>
        <el-form-item label="排序号"><el-input-number v-model="catDialog.sortnum" :min="0" :max="999" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="catDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="applyCategoryDialog">确定</el-button>
      </template>
    </el-dialog>

    <!-- 条目对话框（含页面编辑） -->
    <el-dialog v-model="entryDialog.visible" :title="entryDialog.index >= 0 ? '编辑条目' : '新建条目'" width="620px">
      <el-form label-width="90px" size="small">
        <el-form-item label="条目 id"><el-input v-model="entryDialog.id" placeholder="first_steps" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="entryDialog.name" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="entryDialog.icon" placeholder="minecraft:book" /></el-form-item>
        <el-form-item label="页面">
          <div class="pb-pages">
            <div v-for="(p, pi) in entryDialog.pages" :key="pi" class="pb-page">
              <div class="pb-page-head">
                <el-select v-model="p.type" size="small" style="width: 120px">
                  <el-option label="文本" value="text" />
                  <el-option label="配方" value="crafting" />
                  <el-option label="图片" value="image" />
                  <el-option label="聚焦" value="spotlight" />
                </el-select>
                <div class="pb-page-ops">
                  <el-button size="small" text :icon="Top" :disabled="pi === 0" @click="movePage(pi, -1)" />
                  <el-button size="small" text :icon="Bottom" :disabled="pi === entryDialog.pages.length - 1" @click="movePage(pi, 1)" />
                  <el-button size="small" text type="danger" :icon="Delete" @click="entryDialog.pages.splice(pi, 1)" />
                </div>
              </div>
              <el-input
                v-if="p.type === 'crafting'"
                v-model="p.recipe"
                size="small"
                placeholder="配方 id（如 minecraft:stone_pickaxe）"
                class="pb-page-field"
              />
              <template v-if="p.type === 'image'">
                <el-input
                  v-model="p.title"
                  size="small"
                  placeholder="图片标题（可空）"
                  class="pb-page-field"
                />
                <el-input
                  :model-value="(p.images ?? []).join('\n')"
                  size="small"
                  type="textarea"
                  :rows="2"
                  placeholder="图片资源 id，每行一个（如 kunyu:textures/gui/x.png）"
                  class="pb-page-field"
                  @update:model-value="(v: string) => (p.images = v.split('\n').map((s) => s.trim()).filter(Boolean))"
                />
              </template>
              <el-input
                v-if="p.type === 'spotlight'"
                v-model="p.item"
                size="small"
                placeholder="展示物品 id"
                class="pb-page-field"
              />
              <el-input
                v-if="p.type !== 'image'"
                v-model="p.text"
                size="small"
                type="textarea"
                :rows="2"
                placeholder="正文文本"
                class="pb-page-field"
              />
            </div>
            <el-button size="small" :icon="Plus" @click="entryDialog.pages.push({ type: 'text', text: '' })">
              添加页面
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="entryDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="applyEntryDialog">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Bottom, Check, Delete, Edit, Plus, Refresh, Top } from '@element-plus/icons-vue'
import type {
  PatchouliBook,
  PatchouliBookSummary,
  PatchouliCategory,
  PatchouliEntry,
  PatchouliPage
} from '../../../../shared/types/patchouli'
import { useProjectStore } from '../../stores/project'

const projectStore = useProjectStore()
const root = computed(() => projectStore.currentProject?.path ?? '')

const books = ref<PatchouliBookSummary[]>([])
const warnings = ref<string[]>([])
const defaultNamespace = ref('')
const book = ref<PatchouliBook | null>(null)
/** 打开手册时的磁盘位置（保存时作 prev，支持重命名/迁移命名空间） */
const bookPrev = ref({ namespace: '', bookId: '' })
const activeCatId = ref('')
const loadingList = ref(false)
const saving = ref(false)
const dirty = ref(false)

const bookDialog = reactive({ visible: false, namespace: '', bookId: '', name: '' })
const catDialog = reactive({
  visible: false,
  index: -1,
  id: '',
  name: '',
  description: '',
  icon: 'minecraft:book',
  sortnum: 0
})
const entryDialog = reactive({
  visible: false,
  index: -1,
  id: '',
  name: '',
  icon: 'minecraft:book',
  pages: [] as PatchouliPage[]
})

const activeCategory = computed(
  () => book.value?.categories.find((c) => c.id === activeCatId.value) ?? null
)

async function reloadBooks(): Promise<void> {
  if (!root.value) return
  loadingList.value = true
  try {
    const res = await window.api.patchouli.list(root.value)
    books.value = res.books
    warnings.value = res.warnings
    defaultNamespace.value = res.defaultNamespace
    if (book.value && !res.books.some((b) => b.namespace === bookPrev.value.namespace && b.bookId === bookPrev.value.bookId)) {
      book.value = null
      dirty.value = false
    }
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    loadingList.value = false
  }
}

async function onSelectBook(row: PatchouliBookSummary | null): Promise<void> {
  if (!row || (row.namespace === bookPrev.value.namespace && row.bookId === bookPrev.value.bookId)) return
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('当前手册有未保存修改，切换将丢弃。继续？', '未保存修改', {
        type: 'warning',
        confirmButtonText: '丢弃并切换',
        cancelButtonText: '取消'
      })
    } catch {
      return
    }
  }
  try {
    book.value = await window.api.patchouli.read(root.value, row.namespace, row.bookId)
    bookPrev.value = { namespace: row.namespace, bookId: row.bookId }
    activeCatId.value = book.value.categories[0]?.id ?? ''
    dirty.value = false
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function openBookDialog(): void {
  bookDialog.namespace = defaultNamespace.value
  bookDialog.bookId = ''
  bookDialog.name = ''
  bookDialog.visible = true
}

async function onCreateBook(): Promise<void> {
  const ns = bookDialog.namespace.trim()
  const id = bookDialog.bookId.trim()
  if (!ns || !id || !bookDialog.name.trim()) {
    ElMessage.warning('命名空间、手册 id 与书名不能为空')
    return
  }
  saving.value = true
  try {
    await window.api.patchouli.save(root.value, {
      namespace: ns,
      bookId: id,
      name: bookDialog.name.trim(),
      landingText: `${bookDialog.name.trim()}——本整合包导引手册。`,
      version: 1,
      creativeTab: 'misc',
      categories: []
    })
    ElMessage.success(`手册 ${ns}/${id} 已创建`)
    bookDialog.visible = false
    await reloadBooks()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

async function onDeleteBook(row: PatchouliBookSummary): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除手册 ${row.namespace}/${row.bookId}？整个目录将被移除。`,
      '删除手册',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await window.api.patchouli.remove(root.value, row.namespace, row.bookId)
    ElMessage.success(`手册 ${row.bookId} 已删除`)
    if (bookPrev.value.namespace === row.namespace && bookPrev.value.bookId === row.bookId) {
      book.value = null
      dirty.value = false
    }
    await reloadBooks()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

function openCategoryDialog(cat?: PatchouliCategory, index = -1): void {
  catDialog.index = cat ? index : -1
  catDialog.id = cat?.id ?? ''
  catDialog.name = cat?.name ?? ''
  catDialog.description = cat?.description ?? ''
  catDialog.icon = cat?.icon ?? 'minecraft:book'
  catDialog.sortnum = cat?.sortnum ?? 0
  catDialog.visible = true
}

function applyCategoryDialog(): void {
  if (!book.value) return
  const id = catDialog.id.trim()
  if (!id || !catDialog.name.trim()) {
    ElMessage.warning('类目 id 与名称不能为空')
    return
  }
  const dup = book.value.categories.some((c, i) => c.id === id && i !== catDialog.index)
  if (dup) {
    ElMessage.warning(`类目 id ${id} 已存在`)
    return
  }
  if (catDialog.index >= 0) {
    const old = book.value.categories[catDialog.index]
    if (old.id !== id && old.entries.length > 0) {
      ElMessage.warning('该类目已有条目，改 id 会断开条目归属；请先移空条目')
      return
    }
    book.value.categories[catDialog.index] = {
      ...old,
      id,
      name: catDialog.name.trim(),
      description: catDialog.description,
      icon: catDialog.icon.trim() || 'minecraft:book',
      sortnum: catDialog.sortnum
    }
  } else {
    book.value.categories.push({
      id,
      name: catDialog.name.trim(),
      description: catDialog.description,
      icon: catDialog.icon.trim() || 'minecraft:book',
      sortnum: catDialog.sortnum,
      entries: []
    })
    activeCatId.value = id
  }
  dirty.value = true
  catDialog.visible = false
}

function openEntryDialog(entry?: PatchouliEntry, index = -1): void {
  entryDialog.index = entry ? index : -1
  entryDialog.id = entry?.id ?? ''
  entryDialog.name = entry?.name ?? ''
  entryDialog.icon = entry?.icon ?? 'minecraft:book'
  entryDialog.pages = (entry?.pages ?? []).map((p) => ({ ...p, images: p.images ? [...p.images] : undefined }))
  entryDialog.visible = true
}

function movePage(index: number, delta: number): void {
  const pages = entryDialog.pages
  const target = index + delta
  if (target < 0 || target >= pages.length) return
  const [p] = pages.splice(index, 1)
  pages.splice(target, 0, p)
}

function applyEntryDialog(): void {
  if (!activeCategory.value) return
  const id = entryDialog.id.trim()
  if (!id || !entryDialog.name.trim()) {
    ElMessage.warning('条目 id 与名称不能为空')
    return
  }
  const dup = activeCategory.value.entries.some((e, i) => e.id === id && i !== entryDialog.index)
  if (dup) {
    ElMessage.warning(`条目 id ${id} 已存在`)
    return
  }
  if (entryDialog.pages.length === 0) {
    ElMessage.warning('至少需要一个页面')
    return
  }
  const entry: PatchouliEntry = {
    id,
    name: entryDialog.name.trim(),
    icon: entryDialog.icon.trim() || 'minecraft:book',
    pages: entryDialog.pages.map((p) => ({ ...p }))
  }
  if (entryDialog.index >= 0) activeCategory.value.entries[entryDialog.index] = entry
  else activeCategory.value.entries.push(entry)
  dirty.value = true
  entryDialog.visible = false
}

async function onSaveBook(): Promise<void> {
  if (!book.value) return
  saving.value = true
  try {
    await window.api.patchouli.save(root.value, book.value, bookPrev.value)
    ElMessage.success(`手册 ${book.value.bookId} 已保存`)
    bookPrev.value = { namespace: book.value.namespace, bookId: book.value.bookId }
    dirty.value = false
    await reloadBooks()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(reloadBooks)
</script>

<style scoped>
.pb-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  height: 100%;
  overflow: auto;
}

.pb-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.pb-heading h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.pb-heading p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  max-width: 640px;
}

.pb-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.pb-warning {
  margin-bottom: 4px;
}

.pb-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.pb-books {
  width: 420px;
  flex-shrink: 0;
}

.pb-empty {
  padding: 12px 4px;
  font-size: 12px;
}

.pb-detail {
  flex: 1;
  min-width: 0;
}

.pb-placeholder {
  padding: 48px 0;
  text-align: center;
}

.pb-form {
  max-width: 520px;
}

.pb-sec-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 10px 0 6px;
}

.pb-sec-title {
  font-size: 13px;
  font-weight: 600;
}

.pb-save-bar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.pb-dirty {
  color: var(--el-color-warning);
  font-size: 12px;
}

.pb-dim {
  color: var(--el-text-color-secondary);
}

.pb-pages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.pb-page {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px;
}

.pb-page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.pb-page-field {
  margin-bottom: 6px;
}
</style>
