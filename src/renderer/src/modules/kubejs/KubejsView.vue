<!--
  活动栏「KubeJS 脚本」：kubejs/{startup,server,client}_scripts/*.js 编辑器
  - 左侧按三目录分组（startup 启动注册 / server 服务端事件 / client 客户端事件），不存在目录标记「保存时自动创建」
  - 右侧 Monaco JS 编辑（含 onEvent 事件 API 片段补全），Ctrl+S / 按钮保存落盘
  - 模板库：内置常用骨架（物品/方块注册、配方、服务端与客户端事件），一键生成新脚本
-->
<template>
  <div class="kj-view">
    <header class="kj-header">
      <div class="kj-heading">
        <h2>{{ t('kubejs.title') }}</h2>
        <p>{{ t('kubejs.subtitle') }}</p>
      </div>
      <div class="kj-actions">
        <el-dropdown trigger="click" @command="onApplyTemplate">
          <el-button :icon="MagicStick">{{ t('kubejs.templates') }}</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="tpl in templates" :key="tpl.id" :command="tpl.id">
                <div class="kj-tpl-item">
                  <span>{{ templateName(tpl) }}</span>
                  <span class="kj-dim kj-tpl-desc">{{ templateDescription(tpl) }}</span>
                </div>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button :icon="Plus" type="primary" @click="createDialog.visible = true">
          {{ t('kubejs.newScript') }}
        </el-button>
        <el-button :icon="Refresh" :loading="loadingList" @click="reload">
          {{ t('kubejs.refresh') }}
        </el-button>
      </div>
    </header>

    <el-alert
      v-for="(w, i) in warnings"
      :key="i"
      :title="t('kubejs.loadWarning', { file: w })"
      type="warning"
      :closable="false"
      class="kj-warning"
    />

    <div class="kj-body">
      <div class="kj-list">
        <div v-for="g in groups" :key="g.dir" class="kj-group">
          <div class="kj-group-head">
            <span class="kj-group-title">{{ g.title }}</span>
            <span class="kj-dim">{{ g.dir }}_scripts/</span>
          </div>
          <p v-if="missingDirs.includes(g.dir)" class="kj-dim kj-group-missing">
            {{ t('kubejs.missingDir') }}
          </p>
          <template v-else>
            <p v-if="g.scripts.length === 0" class="kj-dim kj-group-missing">
              {{ t('kubejs.emptyGroup') }}
            </p>
            <div
              v-for="f in g.scripts"
              :key="f.relPath"
              class="kj-script"
              :class="{ active: active && active.relPath === f.relPath }"
              @click="onSelectScript(f)"
            >
              <span class="kj-script-name">{{ f.stem }}.js</span>
              <span class="kj-dim kj-script-size">{{ formatSize(f.sizeBytes) }}</span>
              <el-button
                size="small"
                text
                type="danger"
                :icon="Delete"
                class="kj-script-del"
                @click.stop="onDeleteScript(f)"
              />
            </div>
          </template>
        </div>
      </div>

      <div class="kj-editor" :class="{ 'kj-editor-hidden': !active }">
        <div v-if="active" class="kj-editor-head">
          <span class="kj-editor-path">{{ active.relPath }}</span>
          <span v-if="dirty" class="kj-dirty">{{ t('kubejs.unsaved') }}</span>
          <el-button type="primary" size="small" :icon="Check" :loading="saving" :disabled="!dirty" @click="onSave">
            {{ t('kubejs.save') }}
          </el-button>
        </div>
        <div v-show="active" ref="editorRef" class="kj-monaco"></div>
        <div v-if="!active" class="kj-placeholder">
          <p class="kj-dim">{{ t('kubejs.placeholder') }}</p>
        </div>
      </div>
    </div>

    <!-- 新建脚本对话框 -->
    <el-dialog v-model="createDialog.visible" :title="t('kubejs.createTitle')" width="420px">
      <el-form label-width="90px" size="small">
        <el-form-item :label="t('kubejs.labelDir')">
          <el-select v-model="createDialog.dir" style="width: 100%">
            <el-option :label="t('kubejs.dirStartup')" value="startup" />
            <el-option :label="t('kubejs.dirServer')" value="server" />
            <el-option :label="t('kubejs.dirClient')" value="client" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('kubejs.labelStem')">
          <el-input v-model="createDialog.stem" :placeholder="t('kubejs.stemPlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog.visible = false">{{ t('kubejs.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="onCreateScript">
          {{ t('kubejs.create') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Delete, MagicStick, Plus, Refresh } from '@element-plus/icons-vue'
import { monaco, currentMonacoTheme } from '../../monaco/setup'
import { registerPackLanguages } from '../../monaco/packLanguages'
import { useProjectStore } from '../../stores/project'
import { t, te } from '../../i18n'
import type {
  KubejsScriptDir,
  KubejsScriptFile,
  KubejsTemplate
} from '../../../../shared/types/kubejs'

const projectStore = useProjectStore()
const root = computed(() => projectStore.currentProject?.path ?? '')

const scripts = ref<KubejsScriptFile[]>([])
const missingDirs = ref<KubejsScriptDir[]>([])
const warnings = ref<string[]>([])
const templates = ref<KubejsTemplate[]>([])
const active = ref<KubejsScriptFile | null>(null)
/** 最近一次落盘/读盘内容（dirty 判定基准） */
const savedContent = ref('')
const loadingList = ref(false)
const saving = ref(false)
const dirty = ref(false)

const createDialog = reactive<{ visible: boolean; dir: KubejsScriptDir; stem: string }>({
  visible: false,
  dir: 'server',
  stem: ''
})

/** 目录分组标题：kubejs.group{Startup,Server,Client} */
function groupTitle(dir: KubejsScriptDir): string {
  return t(`kubejs.group${dir.charAt(0).toUpperCase()}${dir.slice(1)}`)
}

const groups = computed(() =>
  (['startup', 'server', 'client'] as KubejsScriptDir[]).map((dir) => ({
    dir,
    title: groupTitle(dir),
    scripts: scripts.value.filter((s) => s.dir === dir)
  }))
)

/** 内置模板文案：语言包命中则翻译，否则回退主进程下发的中文原名 */
function templateName(tpl: KubejsTemplate): string {
  const key = `kubejs.templatesMap.${tpl.id}.name`
  return te(key) ? t(key) : tpl.name
}

function templateDescription(tpl: KubejsTemplate): string {
  const key = `kubejs.templatesMap.${tpl.id}.description`
  return te(key) ? t(key) : tpl.description
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/* ------------------------------ Monaco（内联轻量封装） ------------------------------ */

const editorRef = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
/** 程序化 setValue 期间置位，避免误判为用户编辑 */
let applyingExternal = false

function setEditorContent(content: string): void {
  if (!editor) return
  applyingExternal = true
  try {
    editor.setValue(content)
    editor.setScrollTop(0)
  } finally {
    applyingExternal = false
  }
}

/* ------------------------------ 数据流 ------------------------------ */

async function reload(): Promise<void> {
  if (!root.value) return
  loadingList.value = true
  try {
    const res = await window.api.kubejs.list(root.value)
    scripts.value = res.scripts
    missingDirs.value = res.missingDirs
    warnings.value = res.warnings
  } catch (err) {
    ElMessage.error(t('kubejs.loadListFailed', { error: (err as Error).message }))
  } finally {
    loadingList.value = false
  }
}

/** 切换脚本前确认丢弃未保存修改；返回是否继续 */
async function confirmDiscard(): Promise<boolean> {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm(
      t('kubejs.discardConfirm'),
      t('kubejs.discardTitle'),
      {
        type: 'warning',
        confirmButtonText: t('kubejs.discardBtn'),
        cancelButtonText: t('kubejs.cancel')
      }
    )
    return true
  } catch {
    return false
  }
}

async function openScript(file: KubejsScriptFile): Promise<void> {
  try {
    const content = await window.api.kubejs.read(root.value, file.dir, file.stem)
    active.value = file
    savedContent.value = content
    dirty.value = false
    setEditorContent(content)
  } catch (err) {
    ElMessage.error(t('kubejs.readFailed', { error: (err as Error).message }))
  }
}

async function onSelectScript(file: KubejsScriptFile): Promise<void> {
  if (active.value?.relPath === file.relPath) return
  if (!(await confirmDiscard())) return
  await openScript(file)
}

async function onSave(): Promise<void> {
  if (!active.value || !editor || !root.value) return
  const content = editor.getValue()
  saving.value = true
  try {
    await window.api.kubejs.save(root.value, active.value.dir, active.value.stem, content)
    savedContent.value = content
    dirty.value = false
    ElMessage.success(t('kubejs.saved', { path: active.value.relPath }))
    await reload()
  } catch (err) {
    ElMessage.error(t('kubejs.saveFailed', { error: (err as Error).message }))
  } finally {
    saving.value = false
  }
}

async function onDeleteScript(file: KubejsScriptFile): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('kubejs.deleteConfirm', { path: file.relPath }),
      t('kubejs.deleteTitle'),
      {
        type: 'warning',
        confirmButtonText: t('kubejs.delete'),
        cancelButtonText: t('kubejs.cancel')
      }
    )
  } catch {
    return
  }
  try {
    await window.api.kubejs.remove(root.value, file.dir, file.stem)
    if (active.value?.relPath === file.relPath) {
      active.value = null
      savedContent.value = ''
      dirty.value = false
      setEditorContent('')
    }
    ElMessage.success(t('kubejs.deleted'))
    await reload()
  } catch (err) {
    ElMessage.error(t('kubejs.deleteFailed', { error: (err as Error).message }))
  }
}

async function onCreateScript(): Promise<void> {
  if (!root.value) return
  saving.value = true
  try {
    await window.api.kubejs.save(
      root.value,
      createDialog.dir,
      createDialog.stem.trim(),
      `// ${createDialog.dir}_scripts/${createDialog.stem.trim()}.js\n`
    )
    createDialog.visible = false
    ElMessage.success(t('kubejs.created'))
    await reload()
    const file = scripts.value.find(
      (s) => s.dir === createDialog.dir && s.stem === createDialog.stem.trim()
    )
    if (file) await openScript(file)
    createDialog.stem = ''
  } catch (err) {
    ElMessage.error(t('kubejs.createFailed', { error: (err as Error).message }))
  } finally {
    saving.value = false
  }
}

async function onApplyTemplate(templateId: string): Promise<void> {
  if (!root.value) return
  if (!(await confirmDiscard())) return
  try {
    const file = await window.api.kubejs.applyTemplate(root.value, templateId)
    ElMessage.success(t('kubejs.templateApplied', { path: file.relPath }))
    await reload()
    const listed = scripts.value.find((s) => s.relPath === file.relPath)
    if (listed) await openScript(listed)
  } catch (err) {
    ElMessage.error(t('kubejs.templateFailed', { error: (err as Error).message }))
  }
}

/* ------------------------------ 生命周期 ------------------------------ */

onMounted(async () => {
  // 注册 GLSL/mcfunction/KubeJS 片段（幂等）；KubeJS 补全挂在内置 javascript 语言上
  registerPackLanguages()
  if (editorRef.value) {
    editor = monaco.editor.create(editorRef.value, {
      theme: currentMonacoTheme(),
      language: 'javascript',
      value: '',
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      wordWrap: 'off'
    })
    editor.onDidChangeModelContent(() => {
      if (!editor || applyingExternal) return
      dirty.value = editor.getValue() !== savedContent.value
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void onSave())
  }
  await reload()
  try {
    templates.value = await window.api.kubejs.templates()
  } catch {
    /* 模板库失败不阻塞主流程 */
  }
})

onBeforeUnmount(() => {
  const model = editor?.getModel()
  editor?.dispose()
  model?.dispose()
  editor = null
})
</script>

<style scoped>
.kj-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  gap: 12px;
  overflow: hidden;
}
.kj-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.kj-heading h2 {
  margin: 0 0 4px;
  font-size: 18px;
}
.kj-heading p {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.kj-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.kj-warning {
  flex-shrink: 0;
}
.kj-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 16px;
}
.kj-list {
  width: 280px;
  flex-shrink: 0;
  overflow-y: auto;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 8px;
}
.kj-group + .kj-group {
  margin-top: 12px;
}
.kj-group-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 4px 6px;
  font-size: 12px;
}
.kj-group-title {
  font-weight: 600;
}
.kj-group-missing {
  margin: 2px 6px;
  font-size: 12px;
}
.kj-script {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.kj-script:hover {
  background: var(--el-fill-color-light);
}
.kj-script.active {
  background: var(--el-color-primary-light-9);
}
.kj-script-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kj-script-size {
  font-size: 11px;
}
.kj-editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  overflow: hidden;
}
.kj-editor-hidden {
  justify-content: center;
}
.kj-editor-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.kj-editor-path {
  flex: 1;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kj-dirty {
  font-size: 12px;
  color: var(--el-color-warning);
}
.kj-monaco {
  flex: 1;
  min-height: 0;
}
.kj-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.kj-dim {
  color: var(--el-text-color-secondary);
}
.kj-tpl-item {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}
.kj-tpl-desc {
  font-size: 11px;
}
</style>
