<template>
  <div class="rpv">
    <!-- 未打开项目 -->
    <div v-if="!project" class="rpv-empty">
      <el-icon :size="46" class="rpv-empty-icon"><Files /></el-icon>
      <h2>{{ t('resourcepack.emptyTitle') }}</h2>
      <p>{{ t('resourcepack.emptyDesc') }}</p>
      <p class="rpv-empty-sub">{{ t('resourcepack.openPrefix') }}
        <el-link type="primary" @click="ui.setActiveModule('project-manager')">{{ t('resourcepack.openProjectManager') }}</el-link>
        {{ t('resourcepack.openSuffix') }}
      </p>
    </div>

    <!-- 已打开项目但尚未初始化资源包 -->
    <div v-else-if="!meta" class="rpv-empty">
      <el-icon :size="46" class="rpv-empty-icon"><Files /></el-icon>
      <h2>{{ t('resourcepack.createTitle') }}</h2>
      <p>{{ t(layoutMode === 'standalone' ? 'resourcepack.createDescStandalone' : 'resourcepack.createDescEmbedded') }}</p>
      <div class="rpv-create">
        <div v-if="layoutMode === 'embedded'" class="rpv-row">
          <label class="rpv-label">{{ t('resourcepack.packId') }} <span class="rpv-req">*</span></label>
          <el-input v-model="createPackId" size="small" class="rpv-ctl" :placeholder="t('resourcepack.packIdPlaceholder')" />
        </div>
        <p v-if="layoutMode === 'embedded'" class="rpv-hint">{{ t('resourcepack.packIdHint') }}</p>
        <div class="rpv-row">
          <label class="rpv-label">{{ t('resourcepack.name') }} <span class="rpv-req">*</span></label>
          <el-input v-model="createName" size="small" class="rpv-ctl" :placeholder="t('resourcepack.namePlaceholder')" />
        </div>
        <div class="rpv-row">
          <label class="rpv-label">{{ t('resourcepack.targetVersion') }}</label>
          <el-select v-model="createMcVersion" size="small" class="rpv-ctl-sm">
            <el-option
              v-for="v in RESOURCE_PACK_VERSIONS"
              :key="v.value"
              :value="v.value"
              :label="v.label"
            />
          </el-select>
        </div>
        <div class="rpv-row">
          <label class="rpv-label">{{ t('resourcepack.namespace') }} <span class="rpv-req">*</span></label>
          <el-input v-model="createNamespace" size="small" class="rpv-ctl-sm" :placeholder="t('resourcepack.namespacePlaceholder')" />
        </div>
        <p class="rpv-hint">{{ t('resourcepack.namespaceHint') }}</p>
        <div class="rpv-row">
          <label class="rpv-label">{{ t('resourcepack.description') }}</label>
          <el-input v-model="createDesc" size="small" :placeholder="t('resourcepack.descriptionPlaceholder')" />
        </div>
        <el-button type="primary" :loading="initializing" @click="onInit">
          <el-icon><Check /></el-icon> {{ t('resourcepack.init') }}
        </el-button>
      </div>
    </div>

    <!-- 已初始化：分类树在 SideBar，此处仅编辑区 -->
    <div v-else class="rpv-body">
      <main class="rpv-main rpv-main-full">
        <header class="rpv-meta-head">
          <span class="rpv-meta-name">{{ meta.name }}</span>
          <el-tag size="small" type="info" effect="plain">{{ meta.mcVersion }}</el-tag>
          <el-tag size="small" type="info" effect="plain">format {{ meta.packFormat }}</el-tag>
          <el-button size="small" class="rpv-icon-btn" @click="onImportIcon">
            <el-icon><Picture /></el-icon> {{ hasIcon ? t('resourcepack.replaceIcon') : t('resourcepack.uploadIcon') }}
          </el-button>
          <el-button size="small" class="rpv-icon-btn" :loading="exporting" @click="onExportZip">
            <el-icon><Download /></el-icon> {{ t('resourcepack.exportZip') }}
          </el-button>
        </header>
        <!-- 未选中文件 -->
        <div v-if="!isEditing" class="rpv-main-empty">
          <el-icon :size="38" class="rpv-empty-icon"><Document /></el-icon>
          <p>{{ t('resourcepack.selectFile') }}</p>
          <p class="rpv-main-hint">{{ t('resourcepack.selectFileHint') }}</p>
        </div>

        <!-- 贴图：像素画编辑器（新建 texture 或已有 .png） -->
        <ResourceTexturePanel
          v-else-if="textureTarget && meta"
          :root="projectPath"
          :mode="layoutMode"
          :namespace="meta.namespace"
          :path-prefix="texturePathPrefix"
          :file="editingNew ? null : editingFile"
          :sub-dirs="textureSubDirs"
          @saved="onTextureSaved"
          @dirty="(v) => (textureDirty = v)"
        />

        <!-- 二进制文件：.ogg 试听 / .png 看图，其余提示 -->
        <div v-else-if="!editingNew && !currentEditable" class="rpv-main-empty">
          <template v-if="currentExt === '.ogg'">
            <el-icon :size="38" class="rpv-empty-icon"><Headset /></el-icon>
            <p>{{ currentRelPath }}</p>
            <audio v-if="binaryPreview?.kind === 'audio'" class="rpv-audio" controls :src="binaryPreview.url" />
            <p v-else class="rpv-main-hint">{{ t('resourcepack.audioLoading') }}</p>
          </template>
          <template v-else-if="currentExt === '.png'">
            <p>{{ currentRelPath }}</p>
            <img v-if="binaryPreview?.kind === 'image'" class="rpv-binimg" :src="binaryPreview.url" alt="" />
            <p v-else class="rpv-main-hint">{{ t('resourcepack.imageLoading') }}</p>
          </template>
          <template v-else>
            <el-icon :size="38" class="rpv-empty-icon"><Picture /></el-icon>
            <p>{{ currentRelPath }}</p>
            <p class="rpv-main-hint">{{ t('resourcepack.binaryHint', { ext: currentExt }) }}</p>
          </template>
        </div>

        <template v-else>
          <header class="rpv-file-head">
            <div class="rpv-file-meta">
              <code class="rpv-file-path">{{ filePreview }}</code>
              <span v-if="dirty" class="rpv-dirty" :title="t('resourcepack.unsaved')" />
            </div>
            <div class="rpv-file-actions">
              <el-button size="small" :disabled="!dirty" @click="onDiscard">{{ t('resourcepack.discard') }}</el-button>
              <el-button size="small" type="primary" :loading="saving" @click="onSave">
                <el-icon><Check /></el-icon> {{ t('resourcepack.save') }}
              </el-button>
            </div>
          </header>

          <!-- 新建文件参数 -->
          <div v-if="editingNew" class="rpv-new-row">
            <template v-if="newCategoryInfo">
              <template v-if="newCategoryInfo.subDirs.length > 0">
                <label class="rpv-label">{{ t('resourcepack.subDir') }}</label>
                <el-select v-model="newSub" size="small" class="rpv-sub">
                  <el-option value="" :label="t('resourcepack.noSubDir')" />
                  <el-option
                    v-for="s in newCategoryInfo.subDirs"
                    :key="s"
                    :value="s"
                    :label="s"
                  />
                </el-select>
              </template>
              <template v-if="newCategory === 'item_model'">
                <label class="rpv-label">{{ t('resourcepack.template') }}</label>
                <el-select
                  v-model="newTemplateId"
                  size="small"
                  class="rpv-sub"
                  @change="onTemplateChange"
                >
                  <el-option
                    v-for="tpl in itemModelTemplates"
                    :key="tpl.id"
                    :value="tpl.id"
                    :label="templateLabel(tpl)"
                    :title="templateHint(tpl)"
                  />
                </el-select>
              </template>
              <label class="rpv-label">{{ t('resourcepack.fileName') }}</label>
              <el-input
                v-model="newName"
                size="small"
                class="rpv-new-name"
                :placeholder="t('resourcepack.fileNamePlaceholder')"
              />
            </template>
          </div>

          <p v-if="validator.errors.value.length > 0" class="rpv-errors">
            <span v-for="(er, i) in validator.errors.value" :key="i" class="rpv-error">{{ er }}</span>
          </p>

          <!-- 表单 / 源码双模式编辑区（模型文件旁挂只读 3D 预览） -->
          <div class="rpv-editor-row">
            <PackDualEditor
              v-model:form-value="formValue"
              v-model:form-context="formContext"
              v-model:source-text="draftText"
              v-model:mode="editMode"
              class="rpv-editor-main"
              :form="activeForm"
              :form-renderer="activeFormRenderer"
              :language="sourceLanguage"
              :source-hint="noFormHint"
              @change="onEditorChange"
            />
            <ResourceModelPreview
              v-if="showModelPreview"
              :root="projectPath"
              :mode="layoutMode"
              :model-text="liveModelText"
            />
          </div>
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ResourcePackView：资源包编辑器主视图。
 * 未初始化时提供创建表单（命名空间默认项目 modId），初始化后为「分类树 + 编辑区」布局。
 * 编辑区三态：贴图走像素画编辑器；模型 / 方块状态 / 语言 / 音效 / 字体 / pack.mcmeta
 * 走「表单 / 源码」双模式；二进制文件（.png 之外的 .ogg/.ttf 等）仅提示。
 * pack.png 通过系统文件选择器导入。
 */
import { computed, ref, watch } from 'vue'
import { Check, Document, Download, Files, Headset, Picture } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  ResourceFileCategory,
  ResourcePackFile,
  ResourcePackMeta
} from '../../../../shared/schemas/resourcepack.schema'
import {
  createResourceFileTemplate,
  RESOURCE_PACK_VERSIONS,
  resourceFileRelPath,
  resourceCategoryInfo
} from '../../../../shared/schemas/resourcepack.schema'
import { getResourcepackForm, resourcepackForm } from '../../../../shared/schemas/resourcepack/forms'
import { createItemModelDoc, getItemModelTemplates, itemModelTemplateById } from '../../../../shared/schemas/resourcepack/itemModel'
import type { ItemModelTemplate } from '../../../../shared/schemas/resourcepack/itemModel'
import type { CategoryForm } from '../../../../shared/schemas/forms'
import type { PackLayoutMode } from '../../../../shared/types/ipc'
import { useProjectStore } from '../../stores/project'
import { useUiStore } from '../../stores/ui'
import { useResourcePackStore } from '../../stores/resourcepack'
import ResourceTexturePanel from './ResourceTexturePanel.vue'
import ItemModelTreeEditor from './itemModel/ItemModelTreeEditor.vue'
import ResourceModelPreview from './ResourceModelPreview.vue'
import PackDualEditor from '../../components/pack/PackDualEditor.vue'
import { useSchemaValidate } from '../../components/pack/useSchemaValidate'
import { locale, t, te } from '../../i18n'

const projectStore = useProjectStore()
const ui = useUiStore()
const rpStore = useResourcePackStore()
const validator = useSchemaValidate()

const project = computed(() => projectStore.currentProject)
/** 布局模式：模组项目 resourcepacks/<id>；独立资源包项目根即包根 */
const layoutMode = computed<PackLayoutMode>(() =>
  project.value?.type === 'mod' ? 'embedded' : 'standalone'
)
const meta = ref<ResourcePackMeta | null>(null)
const files = computed(() => rpStore.files)

// 初始化表单
const createPackId = ref('my_pack')
const createName = ref('My Resource Pack')
const createMcVersion = ref('1.20.1')
const createNamespace = ref('mymod')
const createDesc = ref('')
const initializing = ref(false)

// 编辑区
const editingFile = ref<ResourcePackFile | null>(null)
const editingNew = ref(false)
const newCategory = ref<ResourceFileCategory | null>(null)
const newSub = ref('')
const newName = ref('')
const dirty = ref(false)
const saving = ref(false)
const draftText = ref('')
/** 编辑模式：表单（Schema 驱动）/ 源码（Monaco） */
const editMode = ref<'form' | 'source'>('form')
/** 表单值（仅 schema 覆盖的字段） */
const formValue = ref<Record<string, unknown>>({})
/** 原文档上下文，保存时用于保留表单未覆盖字段 */
const formContext = ref<unknown>({})

const isEditing = computed(() => editingNew.value || editingFile.value !== null)
const currentRelPath = computed(() => (editingNew.value ? '' : editingFile.value?.relPath ?? ''))
const currentExt = computed(() => editingFile.value?.ext ?? '')
const currentEditable = computed(() => editingFile.value?.editable ?? false)
const hasIcon = computed(() => files.value.some((f) => f.relPath === 'pack.png'))

const projectPath = computed(() => project.value?.path ?? '')

/** 当前编辑目标的包子路径（新建态用文件名判定扩展名） */
const activeRelPath = computed(() => {
  if (editingNew.value) return newName.value.trim()
  return editingFile.value?.relPath ?? ''
})

/** 当前类别（新建态取新建类别） */
const activeCategory = computed(() =>
  editingNew.value ? newCategory.value : (editingFile.value?.category ?? null)
)

/** 物品模型定义走递归树编辑器，其余类别用通用 SchemaForm */
const activeFormRenderer = computed(() =>
  activeCategory.value === 'item_model' ? ItemModelTreeEditor : undefined
)

/** 新建物品模型定义时的预置模板 */
const newTemplateId = ref('single')

/** 预置模板清单随语言切换重建（冻结常量为 zh-CN） */
const itemModelTemplates = computed(() => getItemModelTemplates(locale.value))

/** 模板文案走语言包，缺失时回落共享注册表里的中文原名（新增模板不受影响） */
function templateText(tpl: ItemModelTemplate, field: 'label' | 'hint'): string {
  const key = `resourcepack.itemModel.template.${tpl.id}.${field}`
  return te(key) ? t(key) : tpl[field]
}

function templateLabel(tpl: ItemModelTemplate): string {
  return templateText(tpl, 'label')
}

function templateHint(tpl: ItemModelTemplate): string {
  return templateText(tpl, 'hint')
}

/** 当前目标类别的表单定义；null 表示该文件仅支持源码模式（随语言切换重建） */
const activeForm = computed<CategoryForm | null>(() => {
  if (editingNew.value) {
    return newCategory.value ? getResourcepackForm(newCategory.value, activeRelPath.value, locale.value) : null
  }
  const file = editingFile.value
  return file ? getResourcepackForm(file.category, file.relPath, locale.value) : null
})

/** 模型文件旁挂只读 3D 预览（新建与既有 model 类别均生效） */
const showModelPreview = computed(() => activeCategory.value === 'model' && isEditing.value)

/** 预览用实时模型文本：源码模式随 draftText，表单模式随 change 序列化 */
const liveModelText = ref('')
watch(draftText, (v) => {
  liveModelText.value = v
})

/** 二进制资源预览（.ogg 试听 / .png 看图） */
const binaryPreview = ref<{ kind: 'audio' | 'image'; url: string } | null>(null)

function onEditorChange(): void {
  dirty.value = true
  // 表单模式下保持模型预览与表单值同步（源码模式由 draftText 的 watch 覆盖）
  if (showModelPreview.value && editMode.value === 'form' && activeForm.value) {
    liveModelText.value = activeForm.value.serialize(formValue.value, formContext.value)
  }
}

/** 源码模式的 Monaco 语言 id */
const sourceLanguage = computed(() => {
  const rel = activeRelPath.value
  if (rel.endsWith('.lang') || rel.endsWith('.properties')) return 'ini'
  if (!rel || rel.endsWith('.json') || rel.endsWith('.mcmeta')) return 'json'
  return 'plaintext'
})

const noFormHint = computed(() => {
  const rel = activeRelPath.value
  if (rel.endsWith('.lang') || rel.endsWith('.properties')) {
    return t('resourcepack.noFormKeyValueHint')
  }
  return t('resourcepack.noFormStructureHint')
})

/** 像素画编辑器接管的目标：新建 texture 类别，或打开已有 .png */
const textureTarget = computed(() =>
  editingNew.value
    ? newCategory.value === 'texture'
    : editingFile.value?.category === 'texture' && editingFile.value.ext === '.png'
)
const textureSubDirs = computed(() => resourceCategoryInfo('texture')?.subDirs ?? [])
const texturePathPrefix = computed(() =>
  layoutMode.value === 'standalone' ? '' : `resourcepacks/${meta.value?.packId ?? ''}/`
)
/** 像素画编辑器的未保存标记（文本草稿之外的第二处脏源） */
const textureDirty = ref(false)

const newCategoryInfo = computed(() =>
  newCategory.value ? resourceCategoryInfo(newCategory.value) : null
)

const filePreview = computed(() => {
  const m = meta.value
  if (!m) return ''
  if (editingNew.value) {
    const cat = newCategoryInfo.value
    if (!cat || !newName.value) return layoutMode.value === 'standalone' ? '—' : 'resourcepacks/—'
    const rel = resourceFileRelPath(m.namespace, cat, newSub.value, newName.value)
    return layoutMode.value === 'standalone' ? rel : `resourcepacks/${m.packId}/${rel}`
  }
  return layoutMode.value === 'standalone'
    ? editingFile.value?.relPath ?? ''
    : `resourcepacks/${m.packId}/${editingFile.value?.relPath ?? ''}`
})

watch(
  () => project.value?.path,
  () => void loadMeta(),
  { immediate: true }
)

async function loadMeta(): Promise<void> {
  meta.value = null
  rpStore.setFiles([])
  rpStore.select(null)
  resetEditing()
  const p = project.value
  if (!p) return
  try {
    const m = await window.api.resourcepack.getMeta(p.path)
    meta.value = m
    // 树内缩略图懒加载需要项目上下文（setContext 会清空旧缓存）
    rpStore.setContext(p.path, layoutMode.value)
    if (m) rpStore.setFiles(await window.api.resourcepack.listFiles(p.path, layoutMode.value))
    else if (layoutMode.value === 'embedded' && p.modId) {
      createPackId.value = `${p.modId}_pack`
      createNamespace.value = p.modId
    }
  } catch (err) {
    ElMessage.error(t('resourcepack.readMetaFailed', { error: (err as Error).message }))
  }
}

async function onInit(): Promise<void> {
  const p = project.value
  if (!p) return
  initializing.value = true
  try {
    meta.value = await window.api.resourcepack.init(
      p.path,
      {
        packId: createPackId.value.trim(),
        name: createName.value.trim(),
        mcVersion: createMcVersion.value,
        description: createDesc.value.trim(),
        namespace: createNamespace.value.trim()
      },
      layoutMode.value
    )
    rpStore.setFiles(await window.api.resourcepack.listFiles(p.path, layoutMode.value))
    ElMessage.success(t('resourcepack.initialized', { name: meta.value.name }))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    initializing.value = false
  }
}

function resetEditing(): void {
  editingFile.value = null
  editingNew.value = false
  newCategory.value = null
  newSub.value = ''
  newName.value = ''
  dirty.value = false
  textureDirty.value = false
  draftText.value = ''
  editMode.value = 'form'
  formValue.value = {}
  formContext.value = {}
  validator.reset()
}

/** 文本草稿与像素画任一有未保存修改 */
const anyDirty = computed(() => dirty.value || textureDirty.value)

function onSelect(file: ResourcePackFile): void {
  if (editingFile.value?.relPath === file.relPath && !editingNew.value) return
  void selectAfterGuard(file)
}

async function selectAfterGuard(file: ResourcePackFile): Promise<void> {
  if (anyDirty.value && !(await guardDirty())) return
  editingNew.value = false
  newCategory.value = null
  editingFile.value = file
  await loadFile(file)
}

async function guardDirty(): Promise<boolean> {
  try {
    await ElMessageBox.confirm(t('resourcepack.dirtyConfirm'), t('resourcepack.dirtyTitle'), {
      type: 'warning'
    })
    return true
  } catch {
    return false
  }
}

/** 载入既有文件：可表单化类别解析进表单，解析失败或无表单则回落源码模式 */
async function loadFile(file: ResourcePackFile): Promise<void> {
  const p = project.value
  validator.reset()
  formValue.value = {}
  formContext.value = {}
  binaryPreview.value = null
  if (!p || !file.editable) {
    draftText.value = ''
    editMode.value = 'form'
    dirty.value = false
    // 二进制资源：.ogg 加载试听；.png（如 pack.png）加载看图
    if (p && file.ext === '.ogg') {
      try {
        binaryPreview.value = {
          kind: 'audio',
          url: await window.api.resourcepack.readSound(p.path, file.relPath, layoutMode.value)
        }
      } catch (err) {
        ElMessage.error((err as Error).message)
      }
    } else if (p && file.ext === '.png') {
      try {
        binaryPreview.value = {
          kind: 'image',
          url: await window.api.resourcepack.readTexture(p.path, file.relPath, layoutMode.value)
        }
      } catch (err) {
        ElMessage.error((err as Error).message)
      }
    }
    return
  }
  try {
    const text = await window.api.resourcepack.readFile(p.path, file.relPath, layoutMode.value)
    draftText.value = text
    const form = resourcepackForm(file.category, file.relPath)
    if (!form) {
      editMode.value = 'source'
    } else {
      const doc = form.parse(text)
      if (doc) {
        formValue.value = doc.value
        formContext.value = doc.context
        editMode.value = 'form'
      } else {
        ElMessage.warning(t('resourcepack.invalidJsonFallback'))
        editMode.value = 'source'
      }
    }
    dirty.value = false
  } catch (err) {
    ElMessage.error(t('resourcepack.readFileFailed', { error: (err as Error).message }))
  }
}

function onCreate(category: ResourceFileCategory): void {
  if (anyDirty.value) {
    void createAfterGuard(category)
    return
  }
  beginCreate(category)
}

async function createAfterGuard(category: ResourceFileCategory): Promise<void> {
  if (!(await guardDirty())) return
  beginCreate(category)
}

function beginCreate(category: ResourceFileCategory): void {
  const info = resourceCategoryInfo(category)
  if (!info || !info.creatable) {
    ElMessage.warning(t('resourcepack.categoryNotCreatable'))
    return
  }
  editingFile.value = null
  editingNew.value = true
  newCategory.value = category
  newSub.value = ''
  newName.value = ''
  textureDirty.value = false
  formValue.value = {}
  formContext.value = {}
  validator.reset()
  // 贴图走像素画编辑器，不预填文本模板
  if (category === 'texture') {
    draftText.value = ''
    editMode.value = 'form'
    dirty.value = false
    return
  }
  const form = resourcepackForm(category, '')
  if (form) {
    const def =
      category === 'item_model'
        ? createItemModelDoc(itemModelTemplateById(newTemplateId.value)?.build() ?? { type: 'minecraft:model', model: 'mypack:item/example' })
        : form.createDefault()
    formValue.value = def
    draftText.value = form.serialize(def, {})
    editMode.value = 'form'
  } else {
    draftText.value = createResourceFileTemplate(category)
    editMode.value = 'source'
  }
  dirty.value = true
}

/** 新建物品模型定义时切换配方模板：重建表单值与源码草稿 */
function onTemplateChange(): void {
  const form = activeForm.value
  if (!form || newCategory.value !== 'item_model') return
  const def = createItemModelDoc(
    itemModelTemplateById(newTemplateId.value)?.build() ?? { type: 'minecraft:model', model: 'mypack:item/example' }
  )
  formValue.value = def
  draftText.value = form.serialize(def, {})
  dirty.value = true
}

/** 像素画保存成功后：切到该文件并刷新树 */
async function onTextureSaved(file: ResourcePackFile): Promise<void> {
  editingNew.value = false
  newCategory.value = null
  editingFile.value = file
  await refreshFiles()
}

async function onDiscard(): Promise<void> {
  if (editingNew.value) {
    resetEditing()
    return
  }
  if (editingFile.value) await loadFile(editingFile.value)
}

async function onSave(): Promise<void> {
  const p = project.value
  const m = meta.value
  const cat = newCategoryInfo.value
  if (!p || !m) return
  let relPath: string
  if (editingNew.value) {
    if (!cat) return
    const fileName = newName.value.trim()
    if (!fileName) {
      ElMessage.warning(t('resourcepack.needFileName'))
      return
    }
    relPath = resourceFileRelPath(m.namespace, cat, newSub.value, fileName)
  } else {
    relPath = editingFile.value?.relPath ?? ''
  }
  // 内容来源：表单模式由 schema 合并原文档生成，源码模式直接取草稿
  const form = activeForm.value
  let contentText = draftText.value
  if (form && editMode.value === 'form') {
    if (!validator.validate(form.schema, formValue.value)) {
      ElMessage.warning(t('resourcepack.formInvalid'))
      return
    }
    contentText = form.serialize(formValue.value, formContext.value)
  }
  // JSON 文件保存前做解析校验（pack.mcmeta 等同样适用）
  if (relPath.endsWith('.json')) {
    try {
      JSON.parse(contentText)
    } catch (err) {
      ElMessage.error(t('resourcepack.jsonInvalid', { error: (err as Error).message }))
      return
    }
  }
  if (!contentText.trim()) {
    ElMessage.warning(t('resourcepack.emptyContent'))
    return
  }
  saving.value = true
  try {
    const file = await window.api.resourcepack.writeFile(
      p.path,
      relPath,
      contentText,
      layoutMode.value
    )
    ElMessage.success(t('resourcepack.saved', { path: file.relPath }))
    editingNew.value = false
    newCategory.value = null
    editingFile.value = file
    await refreshFiles()
    await loadFile(file)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

async function onDelete(file: ResourcePackFile): Promise<void> {
  const p = project.value
  if (!p) return
  try {
    await ElMessageBox.confirm(
      t('resourcepack.deleteConfirm', { path: file.relPath }),
      t('resourcepack.deleteTitle'),
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await window.api.resourcepack.deleteFile(p.path, file.relPath, layoutMode.value)
    ElMessage.success(t('resourcepack.deleted', { id: file.id }))
    if (editingFile.value?.relPath === file.relPath) resetEditing()
    await refreshFiles()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function onImportIcon(): Promise<void> {
  const p = project.value
  if (!p) return
  const src = await window.api.dialog.selectImage()
  if (!src) return
  try {
    await window.api.resourcepack.importIcon(p.path, src, layoutMode.value)
    ElMessage.success(t('resourcepack.iconUpdated'))
    await refreshFiles()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

/** 导出可分发 zip：产物固定在项目 dist/<packId>.zip（zip 顶层 = pack.mcmeta + assets/） */
const exporting = ref(false)
async function onExportZip(): Promise<void> {
  const p = project.value
  if (!p) return
  if (dirty.value || textureDirty.value) {
    ElMessage.warning(t('resourcepack.exportDirty'))
    return
  }
  exporting.value = true
  try {
    const outPath = await window.api.resourcepack.exportZip(p.path, layoutMode.value)
    ElMessage.success(t('resourcepack.exported', { path: outPath }))
  } catch (err) {
    ElMessage.error(t('resourcepack.exportFailed', { error: (err as Error).message }))
  } finally {
    exporting.value = false
  }
}

async function refreshFiles(): Promise<void> {
  const p = project.value
  if (!p) return
  rpStore.setFiles(await window.api.resourcepack.listFiles(p.path, layoutMode.value))
}

// 监听 SideBar 分类树的选中/新建/删除信号
watch(
  () => rpStore.active,
  (file) => {
    if (file) onSelect(file)
  }
)
watch(
  () => rpStore.createSignal,
  (sig) => {
    if (sig) {
      onCreate(sig.category)
      rpStore.clearSignals()
    }
  }
)
watch(
  () => rpStore.deleteSignal,
  (sig) => {
    if (sig) {
      void onDelete(sig.file)
      rpStore.clearSignals()
    }
  }
)
// 树的导入信号（当前仅音效类别）：系统选择器选 .ogg → 主进程复制进包
watch(
  () => rpStore.importSignal,
  (sig) => {
    if (sig) {
      void onImportSound()
      rpStore.clearSignals()
    }
  }
)

async function onImportSound(): Promise<void> {
  const p = project.value
  if (!p) return
  const src = await window.api.dialog.selectFile({ title: t('resourcepack.importSoundTitle'), extensions: ['ogg'] })
  if (!src) return
  try {
    const rel = await window.api.resourcepack.importSound(p.path, src, layoutMode.value)
    ElMessage.success(t('resourcepack.importedSound', { path: rel }))
    await refreshFiles()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}
</script>

<style scoped>
.rpv {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-panel);
  overflow: hidden;
}
.rpv-editor-row {
  display: flex;
  flex: 1;
  min-height: 0;
}
.rpv-editor-main {
  flex: 1;
  min-width: 0;
}
.rpv-audio {
  width: 320px;
  max-width: 90%;
}
.rpv-binimg {
  max-width: 320px;
  max-height: 320px;
  image-rendering: pixelated;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: repeating-conic-gradient(rgba(255, 255, 255, 0.08) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px;
}
.rpv-empty {
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
.rpv-empty-icon {
  opacity: 0.3;
  margin-bottom: 8px;
}
.rpv-empty h2 {
  font-size: 16px;
  font-weight: 500;
  color: var(--ky-text-sub);
  margin: 0;
}
.rpv-empty p {
  font-size: 13px;
  margin: 0;
}
.rpv-empty-sub {
  font-size: 12px !important;
}
.rpv-create {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  width: 400px;
  max-width: 90%;
  text-align: left;
  padding: 16px;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: var(--ky-bg-sidebar);
}
.rpv-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rpv-label {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.rpv-req {
  color: #f38ba8;
}
.rpv-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.rpv-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.rpv-meta-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
}
.rpv-meta-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
  margin-right: 4px;
}
.rpv-icon-btn {
  margin-left: auto;
}
.rpv-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.rpv-main-full {
  width: 100%;
}
.rpv-main-empty {
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
.rpv-main-hint {
  font-size: 11px !important;
  opacity: 0.8;
}
.rpv-file-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
}
.rpv-file-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.rpv-file-path {
  font-size: 11.5px;
  color: var(--ky-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rpv-dirty {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ky-accent);
  flex-shrink: 0;
}
.rpv-file-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.rpv-new-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 0;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.rpv-sub {
  width: 120px;
}
.rpv-new-name {
  width: 220px;
}
.rpv-errors {
  margin: 8px 14px 0;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid color-mix(in srgb, #f38ba8 45%, transparent);
  border-radius: 6px;
  background: rgba(243, 139, 168, 0.1);
}
.rpv-error {
  font-size: 11px;
  color: #f38ba8;
  word-break: break-all;
}
</style>
