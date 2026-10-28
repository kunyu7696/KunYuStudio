<template>
  <div class="spv">
    <!-- 未打开项目 -->
    <div v-if="!project" class="spv-empty">
      <el-icon :size="46" class="spv-empty-icon"><Sunny /></el-icon>
      <h2>光影包编辑器</h2>
      <p>创建与编辑 Iris / OptiFine 光影包：GLSL 着色器、选项配置与多语言</p>
      <p class="spv-empty-sub">请先在
        <el-link type="primary" @click="ui.setActiveModule('project-manager')">项目管理</el-link>
        中打开一个项目
      </p>
    </div>

    <!-- 已打开项目但尚未初始化光影包 -->
    <div v-else-if="!meta" class="spv-empty">
      <el-icon :size="46" class="spv-empty-icon"><Sunny /></el-icon>
      <h2>创建光影包</h2>
      <p>{{ layoutMode === 'standalone'
        ? '在项目根初始化光影包结构（shaders/）'
        : '在当前项目 shaderpacks/ 目录中初始化光影包结构' }}</p>
      <div class="spv-create">
        <div v-if="layoutMode === 'embedded'" class="spv-row">
          <label class="spv-label">包 ID <span class="spv-req">*</span></label>
          <el-input v-model="createPackId" size="small" class="spv-ctl" placeholder="如 my_shaders" />
        </div>
        <p v-if="layoutMode === 'embedded'" class="spv-hint">目录名（小写字母/数字/下划线），将创建于 shaderpacks/&lt;包 ID&gt;/</p>
        <div class="spv-row">
          <label class="spv-label">光影名称 <span class="spv-req">*</span></label>
          <el-input v-model="createName" size="small" class="spv-ctl" placeholder="如 My Shaders" />
        </div>
        <div class="spv-row">
          <label class="spv-label">光影加载器</label>
          <el-radio-group v-model="createLoader" size="small">
            <el-radio-button value="iris">Iris</el-radio-button>
            <el-radio-button value="optifine">OptiFine</el-radio-button>
          </el-radio-group>
        </div>
        <div class="spv-row">
          <label class="spv-label">目标版本</label>
          <el-radio-group v-model="createMcVersion" size="small">
            <el-radio-button v-for="v in Object.keys(RESOURCE_PACK_FORMATS)" :key="v" :value="v">{{ v }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="spv-row">
          <label class="spv-label">光影版本</label>
          <el-input v-model="createVersion" size="small" class="spv-ctl-sm" placeholder="1.0.0" />
        </div>
        <div class="spv-row">
          <label class="spv-label">描述</label>
          <el-input v-model="createDesc" size="small" placeholder="光影包描述" />
        </div>
        <el-button type="primary" :loading="initializing" @click="onInit">
          <el-icon><Check /></el-icon> 初始化光影包
        </el-button>
      </div>
    </div>

    <!-- 已初始化：分类树在 SideBar，此处仅编辑区 -->
    <div v-else class="spv-body">
      <main class="spv-main spv-main-full">
        <header class="spv-meta-head">
          <span class="spv-meta-name">{{ meta.name }}</span>
          <el-tag size="small" type="info" effect="plain">{{ meta.loader }}</el-tag>
          <el-tag size="small" type="info" effect="plain">{{ meta.mcVersion }}</el-tag>
          <el-button
            size="small"
            class="spv-export-btn"
            :loading="exporting"
            @click="onExportZip"
          >
            <el-icon><Download /></el-icon> 导出 zip
          </el-button>
        </header>
        <!-- 未选中文件 -->
        <div v-if="!isEditing" class="spv-main-empty">
          <el-icon :size="38" class="spv-empty-icon"><Document /></el-icon>
          <p>从左侧选择或新建一个着色器文件</p>
          <p class="spv-main-hint">shaders.properties 与 .lang 支持表单 / 源码双模式；GLSL 着色器走源码模式（含语法高亮与片段）</p>
        </div>

        <template v-else>
          <header class="spv-file-head">
            <div class="spv-file-meta">
              <code class="spv-file-path">{{ filePreview }}</code>
              <span v-if="dirty" class="spv-dirty" title="未保存" />
            </div>
            <div class="spv-file-actions">
              <el-button size="small" :disabled="!dirty" @click="onDiscard">放弃</el-button>
              <el-button size="small" type="primary" :loading="saving" @click="onSave">
                <el-icon><Check /></el-icon> 保存
              </el-button>
            </div>
          </header>

          <!-- 新建文件参数 -->
          <div v-if="editingNew" class="spv-new-row">
            <template v-if="isPipelineCategory && availableSubpasses.length > 0">
              <label class="spv-label">子 pass</label>
              <el-select
                size="small"
                class="spv-new-pass"
                :model-value="newId"
                placeholder="选择子 pass（可覆盖）"
                filterable
                @change="onSubpassPick"
              >
                <el-option
                  v-for="sp in availableSubpasses"
                  :key="sp.name"
                  :value="sp.name"
                  :label="sp.name"
                >
                  <div class="spv-pass-opt">
                    <code>{{ sp.name }}</code>
                    <span>{{ sp.description }}</span>
                  </div>
                </el-option>
              </el-select>
            </template>
            <label class="spv-label">文件名</label>
            <el-input v-model="newId" size="small" class="spv-new-id" placeholder="如 gbuffers_terrain" />
            <template v-if="isPipelineCategory">
              <label class="spv-label">阶段</label>
              <el-radio-group v-model="newStage" size="small">
                <el-radio-button
                  v-for="s in stageOptions"
                  :key="s.value"
                  :value="s.value"
                >{{ s.label }}</el-radio-button>
              </el-radio-group>
            </template>
          </div>

          <p v-if="validator.errors.value.length > 0" class="spv-errors">
            <span v-for="(er, i) in validator.errors.value" :key="i" class="spv-error">{{ er }}</span>
          </p>

          <!-- 表单 / 源码双模式编辑区（GLSL 为仅源码 + 片段） -->
          <PackDualEditor
            v-model:form-value="formValue"
            v-model:form-context="formContext"
            v-model:source-text="draftText"
            v-model:mode="editMode"
            :form="activeForm"
            :language="sourceLanguage"
            :snippets="sourceSnippets"
            :source-hint="noFormHint"
            @change="dirty = true"
          />
        </template>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ShaderPackView：光影包编辑器主视图。
 * 未初始化时提供创建表单，初始化后为「分类树 + 编辑区」布局。
 * 管线文件（gbuffers/composite/deferred/shadow/final/prepare）新建时选顶点/片元/几何阶段，
 * 自动生成最小 GLSL 模板（OptiFine 传统 GLSL 120 写法，Iris 兼容）；
 * lib/lang 生成对应占位模板，shaders.properties 初始化时自动创建。
 * 编辑区为「表单 / 源码」双模式：shaders.properties 与 .lang 走键值表单，
 * GLSL 着色器与 lib 为仅源码模式（Monaco glsl 高亮 + 片段插入）。
 */
import { computed, ref, watch } from 'vue'
import { Check, Document, Download, Sunny } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  McVersionLike,
  ShaderFileCategory,
  ShaderLoader,
  ShaderPackFile,
  ShaderPackMeta,
  ShaderStage,
  SubpassInfo
} from '../../../../shared/schemas/shaderpack.schema'
import { RESOURCE_PACK_FORMATS } from '../../../../shared/schemas/resourcepack/formats'
import {
  createShaderFileTemplate,
  getShaderCategories,
  getShaderStageOptions,
  shaderFileRelPath
} from '../../../../shared/schemas/shaderpack.schema'
import { getShaderpackForm, shaderpackForm } from '../../../../shared/schemas/shaderpack/forms'
import type { CategoryForm } from '../../../../shared/schemas/forms'
import { GLSL_SNIPPETS } from '../../../../shared/sourceSnippets'
import type { SnippetGroup } from '../../../../shared/sourceSnippets'
import { validateContentId } from '../../../../shared/types/content'
import type { PackLayoutMode } from '../../../../shared/types/ipc'
import { useProjectStore } from '../../stores/project'
import { useUiStore } from '../../stores/ui'
import { useShaderPackStore } from '../../stores/shaderpack'
import PackDualEditor from '../../components/pack/PackDualEditor.vue'
import { useSchemaValidate } from '../../components/pack/useSchemaValidate'
import { locale } from '../../i18n'

const projectStore = useProjectStore()
const ui = useUiStore()
const spStore = useShaderPackStore()
const validator = useSchemaValidate()

/** 分类注册表与阶段选项随语言切换重建（冻结常量为 zh-CN） */
const shaderCategories = computed(() => getShaderCategories(locale.value))
const stageOptions = computed(() => getShaderStageOptions(locale.value))

const project = computed(() => projectStore.currentProject)
/** 布局模式：模组项目 shaderpacks/<id>；独立光影包项目根即包根 */
const layoutMode = computed<PackLayoutMode>(() =>
  project.value?.type === 'mod' ? 'embedded' : 'standalone'
)
const meta = ref<ShaderPackMeta | null>(null)

// 初始化表单
const createPackId = ref('my_shaders')
const createName = ref('My Shaders')
const createLoader = ref<ShaderLoader>('iris')
const createMcVersion = ref<McVersionLike>('1.20.1')
const createVersion = ref('1.0.0')
const createDesc = ref('')
const initializing = ref(false)

// 编辑区
const editingFile = ref<ShaderPackFile | null>(null)
const editingNew = ref(false)
const newCategory = ref<ShaderFileCategory | null>(null)
const newId = ref('')
const newStage = ref<ShaderStage>('vertex')
const dirty = ref(false)
const saving = ref(false)
const exporting = ref(false)
const draftText = ref('')
/** 编辑模式：表单（键值 Schema）/ 源码（Monaco） */
const editMode = ref<'form' | 'source'>('form')
/** 表单值（仅 schema 覆盖的字段） */
const formValue = ref<Record<string, unknown>>({})
/** 注释等原文档上下文，保存时回写到文件头 */
const formContext = ref<unknown>({})

const PIPELINE_CATEGORIES: ShaderFileCategory[] = [
  'gbuffers',
  'shadow',
  'shadowcomp',
  'prepare',
  'begin',
  'setup',
  'composite',
  'deferred',
  'final'
]

const isEditing = computed(() => editingNew.value || editingFile.value !== null)
const isPipelineCategory = computed(
  () => newCategory.value !== null && PIPELINE_CATEGORIES.includes(newCategory.value)
)

/** 当前新建类别的可用子 pass 清单（用于下拉） */
const availableSubpasses = computed<SubpassInfo[]>(() => {
  if (!editingNew.value || !newCategory.value) return []
  return shaderCategories.value.find((c) => c.key === newCategory.value)?.subpasses ?? []
})

/** 子 pass 下拉选中后自动填入文件名 */
function onSubpassPick(passName: string): void {
  newId.value = passName
}
const activeId = computed(() => (editingNew.value ? newId.value : editingFile.value?.id ?? ''))
const activeCategory = computed<ShaderFileCategory | null>(() =>
  editingNew.value ? newCategory.value : editingFile.value?.category ?? null
)

/** 当前编辑目标的扩展名（新建态按阶段 / 类别推导） */
const activeExt = computed(() => {
  if (!editingNew.value) return editingFile.value?.ext ?? ''
  const cat = newCategory.value
  if (!cat) return ''
  if (PIPELINE_CATEGORIES.includes(cat)) {
    return stageOptions.value.find((s) => s.value === newStage.value)?.ext ?? ''
  }
  if (cat === 'lib') return '.glsl'
  if (cat === 'lang') return '.lang'
  if (cat === 'config') return '.properties'
  return ''
})

/** 当前文件类别的表单定义；null 表示仅源码（GLSL 着色器与 lib），随语言切换重建 */
const activeForm = computed<CategoryForm | null>(() => {
  const cat = activeCategory.value
  return cat ? getShaderpackForm(cat, activeExt.value, locale.value) : null
})

/** 仅源码类别是否走 GLSL 高亮与片段 */
const isGlsl = computed(() => {
  const cat = activeCategory.value
  if (!cat) return false
  return PIPELINE_CATEGORIES.includes(cat) || cat === 'lib'
})

const sourceLanguage = computed(() => (isGlsl.value ? 'glsl' : 'ini'))
const sourceSnippets = computed<SnippetGroup[] | undefined>(() =>
  isGlsl.value ? GLSL_SNIPPETS : undefined
)
const noFormHint = computed(() =>
  isGlsl.value
    ? 'GLSL 着色器为纯源码编辑：点击下方片段可插入骨架与内建变量说明'
    : '该文件暂无表单结构，请在源码模式中编辑'
)
const filePreview = computed(() => {
  const m = meta.value
  if (!m) return ''
  if (editingNew.value) {
    const cat = newCategory.value
    if (!cat) return ''
    const rel = shaderFileRelPath(cat, newId.value || '—', newStage.value)
    return layoutMode.value === 'standalone' ? rel : `shaderpacks/${m.packId}/${rel}`
  }
  return layoutMode.value === 'standalone'
    ? editingFile.value?.relPath ?? ''
    : `shaderpacks/${m.packId}/${editingFile.value?.relPath ?? ''}`
})

watch(
  () => project.value?.path,
  () => void loadMeta(),
  { immediate: true }
)

/** 项目切换后重读光影包元数据 */
async function loadMeta(): Promise<void> {
  meta.value = null
  spStore.setFiles([])
  spStore.select(null)
  resetEditing()
  const p = project.value
  if (!p) return
  try {
    const m = await window.api.shaderpack.getMeta(p.path)
    meta.value = m
    if (m) spStore.setFiles(await window.api.shaderpack.listFiles(p.path, layoutMode.value))
    else if (p.modId && layoutMode.value === 'embedded') createPackId.value = `${p.modId}_shaders`
  } catch (err) {
    ElMessage.error(`读取光影包失败：${(err as Error).message}`)
  }
}

async function onInit(): Promise<void> {
  const p = project.value
  if (!p) return
  initializing.value = true
  try {
    meta.value = await window.api.shaderpack.init(
      p.path,
      {
        packId: createPackId.value.trim(),
        name: createName.value.trim(),
        loader: createLoader.value,
        mcVersion: createMcVersion.value,
        version: createVersion.value.trim(),
        description: createDesc.value.trim()
      },
      layoutMode.value
    )
    spStore.setFiles(await window.api.shaderpack.listFiles(p.path, layoutMode.value))
    ElMessage.success(`光影包已初始化：${meta.value.name}`)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    initializing.value = false
  }
}

/** 导出可分发 zip：产物固定在项目 dist/<packId>.zip（zip 顶层为 shaders/） */
async function onExportZip(): Promise<void> {
  const p = project.value
  if (!p) return
  if (dirty.value) {
    ElMessage.warning('当前文件有未保存修改，请先保存再导出')
    return
  }
  exporting.value = true
  try {
    const outPath = await window.api.shaderpack.exportZip(p.path, layoutMode.value)
    ElMessage.success(`已导出：${outPath}`)
  } catch (err) {
    ElMessage.error(`导出失败：${(err as Error).message}`)
  } finally {
    exporting.value = false
  }
}

function resetEditing(): void {
  editingFile.value = null
  editingNew.value = false
  newCategory.value = null
  newId.value = ''
  newStage.value = 'vertex'
  dirty.value = false
  draftText.value = ''
  editMode.value = 'form'
  formValue.value = {}
  formContext.value = {}
  validator.reset()
}

function onSelect(file: ShaderPackFile): void {
  if (editingFile.value?.relPath === file.relPath && !editingNew.value) return
  void selectAfterGuard(file)
}

async function selectAfterGuard(file: ShaderPackFile): Promise<void> {
  if (dirty.value && !(await guardDirty())) return
  editingNew.value = false
  newCategory.value = null
  editingFile.value = file
  await loadFile(file)
}

async function guardDirty(): Promise<boolean> {
  try {
    await ElMessageBox.confirm('当前文件有未保存的修改，切换将丢弃这些修改，是否继续？', '未保存的修改', {
      type: 'warning'
    })
    return true
  } catch {
    return false
  }
}

/** 载入既有文件：可表单化类别解析进表单，GLSL 无表单则走源码模式 */
async function loadFile(file: ShaderPackFile): Promise<void> {
  const p = project.value
  if (!p) return
  validator.reset()
  formValue.value = {}
  formContext.value = {}
  try {
    const text = await window.api.shaderpack.readFile(p.path, file.relPath, layoutMode.value)
    draftText.value = text
    const form = shaderpackForm(file.category, file.ext)
    if (!form) {
      editMode.value = 'source'
    } else {
      const doc = form.parse(text)
      if (doc) {
        formValue.value = doc.value
        formContext.value = doc.context
        editMode.value = 'form'
      } else {
        ElMessage.warning('文件内容无法解析为键值结构，已切换为源码模式')
        editMode.value = 'source'
      }
    }
    dirty.value = false
  } catch (err) {
    ElMessage.error(`读取文件失败：${(err as Error).message}`)
  }
}

function onCreate(category: ShaderFileCategory): void {
  if (dirty.value) {
    void createAfterGuard(category)
    return
  }
  beginCreate(category)
}

async function createAfterGuard(category: ShaderFileCategory): Promise<void> {
  if (!(await guardDirty())) return
  beginCreate(category)
}

function beginCreate(category: ShaderFileCategory): void {
  editingFile.value = null
  editingNew.value = true
  newCategory.value = category
  newId.value = ''
  newStage.value = 'vertex'
  formValue.value = {}
  formContext.value = {}
  validator.reset()
  const form = shaderpackForm(category, activeExt.value)
  if (form) {
    const def = form.createDefault()
    formValue.value = def
    draftText.value = form.serialize(def, {})
    editMode.value = 'form'
  } else {
    draftText.value = createShaderFileTemplate(category, 'new_shader', newStage.value)
    editMode.value = 'source'
  }
  dirty.value = true
}

/** 切换阶段时刷新最小 GLSL 模板；有表单的类别（lang/config）不受阶段影响 */
watch(newStage, (stage) => {
  const cat = newCategory.value
  if (!editingNew.value || !cat) return
  if (shaderpackForm(cat, activeExt.value)) return
  draftText.value = createShaderFileTemplate(cat, newId.value || 'new_shader', stage)
  dirty.value = true
})

async function onDiscard(): Promise<void> {
  if (editingNew.value) {
    resetEditing()
    return
  }
  if (editingFile.value) await loadFile(editingFile.value)
}

async function onSave(): Promise<void> {
  const p = project.value
  const cat = activeCategory.value
  if (!p || !cat) return
  const id = activeId.value.trim()
  if (!validateContentId(id)) {
    ElMessage.warning('文件名不合法：小写字母开头，仅含小写字母、数字、下划线')
    return
  }
  // 内容来源：表单模式由 schema 回写（含注释），源码模式直接取草稿
  const form = activeForm.value
  let contentText = draftText.value
  if (form && editMode.value === 'form') {
    if (!validator.validate(form.schema, formValue.value)) {
      ElMessage.warning('表单校验未通过，请查看错误提示')
      return
    }
    contentText = form.serialize(formValue.value, formContext.value)
  }
  if (!contentText.trim()) {
    ElMessage.warning('文件内容不能为空')
    return
  }
  const relPath = shaderFileRelPath(cat, id, newStage.value)
  saving.value = true
  try {
    const file = await window.api.shaderpack.writeFile(
      p.path,
      relPath,
      contentText,
      layoutMode.value
    )
    ElMessage.success(`已保存 ${file.relPath}`)
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

async function onDelete(file: ShaderPackFile): Promise<void> {
  const p = project.value
  if (!p) return
  try {
    await ElMessageBox.confirm(`确认删除 ${file.relPath}？该文件将从项目中移除。`, '删除文件', {
      type: 'warning'
    })
  } catch {
    return
  }
  try {
    await window.api.shaderpack.deleteFile(p.path, file.relPath, layoutMode.value)
    ElMessage.success(`已删除 ${file.id}`)
    if (editingFile.value?.relPath === file.relPath) resetEditing()
    await refreshFiles()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

async function refreshFiles(): Promise<void> {
  const p = project.value
  if (!p) return
  spStore.setFiles(await window.api.shaderpack.listFiles(p.path, layoutMode.value))
}

// 监听 SideBar 分类树的选中/新建/删除信号
watch(
  () => spStore.active,
  (file) => {
    if (file) onSelect(file)
  }
)
watch(
  () => spStore.createSignal,
  (sig) => {
    if (sig) {
      onCreate(sig.category)
      spStore.clearSignals()
    }
  }
)
watch(
  () => spStore.deleteSignal,
  (sig) => {
    if (sig) {
      void onDelete(sig.file)
      spStore.clearSignals()
    }
  }
)
</script>

<style scoped>
.spv {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-panel);
  overflow: hidden;
}
.spv-empty {
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
.spv-empty-icon {
  opacity: 0.3;
  margin-bottom: 8px;
}
.spv-empty h2 {
  font-size: 16px;
  font-weight: 500;
  color: var(--ky-text-sub);
  margin: 0;
}
.spv-empty p {
  font-size: 13px;
  margin: 0;
}
.spv-empty-sub {
  font-size: 12px !important;
}
.spv-create {
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
.spv-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.spv-label {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.spv-req {
  color: #f38ba8;
}
.spv-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.spv-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.spv-meta-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
}
.spv-meta-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}
.spv-export-btn {
  margin-left: auto;
}
.spv-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.spv-main-full {
  width: 100%;
}
.spv-main-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ky-text-dim);
}
.spv-main-hint {
  font-size: 11px !important;
  opacity: 0.8;
}
.spv-file-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
}
.spv-file-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.spv-file-path {
  font-size: 11.5px;
  color: var(--ky-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spv-dirty {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ky-accent);
  flex-shrink: 0;
}
.spv-file-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.spv-new-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 0;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.spv-new-id {
  width: 200px;
}
.spv-new-pass {
  width: 260px;
}
.spv-pass-opt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}
.spv-pass-opt code {
  font-size: 12px;
  font-family: var(--ky-mono, monospace);
  color: var(--ky-accent);
}
.spv-pass-opt span {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.spv-errors {
  margin: 8px 14px 0;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid color-mix(in srgb, #f38ba8 45%, transparent);
  border-radius: 6px;
  background: rgba(243, 139, 168, 0.1);
}
.spv-error {
  font-size: 11px;
  color: #f38ba8;
  word-break: break-all;
}
</style>
