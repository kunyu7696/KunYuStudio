<!--
  FancyMenu 开始菜单自定义——主视图。
  左：元素列表（可加/删/选中）；中：画布；右：属性面板。
  顶栏：读取 Fabric/Forge layout.json → 编辑 → 保存。
-->
<template>
  <div class="fm-view">
    <!-- 顶栏 -->
    <div class="fm-toolbar">
      <div class="fm-toolbar-left">
        <el-button size="small" @click="onAddElement">{{ t('fancymenu.add') }}</el-button>
        <el-button size="small" :disabled="!activeId" @click="onDeleteActive">
          {{ t('fancymenu.remove') }}
        </el-button>
        <el-button size="small" :disabled="!activeId" @click="onDuplicateActive">
          {{ t('fancymenu.duplicate') }}
        </el-button>
      </div>
      <div class="fm-toolbar-center">
        <el-button size="small" plain @click="onRead">{{ t('fancymenu.reload') }}</el-button>
        <el-button size="small" type="primary" plain @click="onSave">
          {{ t('fancymenu.save') }}
        </el-button>
      </div>
      <div class="fm-toolbar-right">
        <span class="fm-path" :title="filePath ?? ''">{{ filePath ?? t('fancymenu.noLayout') }}</span>
        <el-tag
          v-if="dirty"
          size="small"
          type="warning"
          effect="light"
          class="fm-dirty-tag"
        >{{ t('fancymenu.unsaved') }}</el-tag>
      </div>
    </div>

    <!-- 三栏 -->
    <div class="fm-body">
      <!-- 左：元素列表 -->
      <aside class="fm-side fm-side-left">
        <div class="fm-side-title">{{ t('fancymenu.elementList') }} ({{ elements.length }})</div>
        <el-scrollbar height="100%">
          <ul class="fm-el-list">
            <li
              v-for="el in sortedByZ"
              :key="el.id"
              class="fm-el-item"
              :class="{ active: activeId === el.id }"
              @click="activeId = el.id"
            >
              <span class="fm-el-badge fm-el-badge--type" :class="'type-' + el.type">{{ el.type }}</span>
              <span class="fm-el-label">{{ el.name || placeholderName(el) }}</span>
              <span class="fm-el-badge fm-el-badge--z">z:{{ el.z ?? 0 }}</span>
            </li>
            <li v-if="elements.length === 0" class="fm-el-empty">
              {{ t('fancymenu.emptyListHint') }}
            </li>
          </ul>
        </el-scrollbar>
      </aside>

      <!-- 中：画布 -->
      <main class="fm-canvas-host">
        <FancyMenuCanvas
          :elements="elements"
          :active-id="activeId"
          @select="activeId = $event"
          @dirty="dirty = true"
        />
      </main>

      <!-- 右：属性面板 -->
      <aside class="fm-side fm-side-right">
        <div class="fm-side-title">{{ t('fancymenu.properties') }}</div>
        <div v-if="!activeEl" class="fm-prop-empty">
          {{ t('fancymenu.noSelection') }}
        </div>
        <el-form
          v-else
          :model="activeEl"
          label-width="72px"
          size="small"
          class="fm-prop-form"
          @change="dirty = true"
        >
          <el-form-item :label="t('fancymenu.fields.name')">
            <el-input v-model="activeEl.name" />
          </el-form-item>

          <el-form-item :label="t('fancymenu.fields.type')">
            <el-tag :type="elTypeTagColor(activeEl.type)" effect="light">{{ activeEl.type }}</el-tag>
          </el-form-item>

          <el-form-item :label="t('fancymenu.fields.anchor')">
            <el-select v-model="activeEl.anchor">
              <el-option
                v-for="a in ANCHORS"
                :key="a.value"
                :label="t('fancymenu.anchors.' + a.value)"
                :value="a.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item :label="t('fancymenu.fields.pos')">
            <div class="fm-pos-row">
              <el-input-number v-model="activeEl.x" :step="1" controls-position="right" />
              <span class="fm-pos-sep">,</span>
              <el-input-number v-model="activeEl.y" :step="1" controls-position="right" />
            </div>
          </el-form-item>

          <el-form-item :label="t('fancymenu.fields.size')">
            <div class="fm-pos-row">
              <el-input-number v-model="activeEl.width" :min="1" :step="1" controls-position="right" />
              <span class="fm-pos-sep">×</span>
              <el-input-number v-model="activeEl.height" :min="1" :step="1" controls-position="right" />
            </div>
          </el-form-item>

          <el-form-item :label="t('fancymenu.fields.z')">
            <el-input-number v-model="activeEl.z" :step="1" controls-position="right" />
          </el-form-item>

          <!-- 类型特有字段 -->
          <el-form-item
            v-if="activeEl.type === 'button' || activeEl.type === 'text'"
            :label="t('fancymenu.fields.text')"
          >
            <el-input
              v-model="(activeEl as { text: string }).text"
              :type="activeEl.type === 'text' ? 'textarea' : 'text'"
              :rows="activeEl.type === 'text' ? 2 : undefined"
            />
          </el-form-item>

          <el-form-item
            v-if="activeEl.type === 'button' || activeEl.type === 'rect'"
            :label="t('fancymenu.fields.color')"
          >
            <el-color-picker v-model="(activeEl as { color?: string }).color" show-alpha />
          </el-form-item>

          <el-form-item
            v-if="activeEl.type === 'button'"
            :label="t('fancymenu.fields.hoverColor')"
          >
            <el-color-picker v-model="(activeEl as { hoverColor?: string }).hoverColor" show-alpha />
          </el-form-item>

          <el-form-item
            v-if="activeEl.type === 'button'"
            :label="t('fancymenu.fields.action')"
          >
            <div class="fm-action-row">
              <el-select v-model="(activeEl as any).action?.type ?? 'command'" @change="ensureAction(activeEl as any)">
                <el-option value="command" :label="t('fancymenu.actions.command')" />
                <el-option value="url" :label="t('fancymenu.actions.url')" />
              </el-select>
              <el-input
                v-model="(activeEl as any).action.value"
                :placeholder="t('fancymenu.fields.actionValue')"
              />
            </div>
          </el-form-item>

          <el-form-item
            v-if="activeEl.type === 'image'"
            :label="t('fancymenu.fields.url')"
          >
            <el-input v-model="(activeEl as { url: string }).url" placeholder="minecraft:textures/..." />
          </el-form-item>

          <el-form-item
            v-if="activeEl.type === 'text'"
            :label="t('fancymenu.fields.size_px')"
          >
            <el-input-number v-model="(activeEl as any).size" :min="8" :max="72" controls-position="right" />
          </el-form-item>

          <!-- slides 轮播字段 -->
          <template v-if="activeEl.type === 'slides'">
            <el-form-item :label="t('fancymenu.fields.slideList')">
              <div class="fm-slide-list">
                <div
                  v-for="(s, i) in (activeEl as FmSlides).slides"
                  :key="i"
                  class="fm-slide-row"
                >
                  <el-select v-model="s.type" class="fm-slide-type">
                    <el-option value="image" :label="t('fancymenu.slideTypes.image')" />
                    <el-option value="local" :label="t('fancymenu.slideTypes.local')" />
                  </el-select>
                  <el-input
                    v-model="s.path"
                    class="fm-slide-path"
                    placeholder="textures/... 或本地路径"
                  />
                  <el-button
                    size="small"
                    text
                    type="danger"
                    :disabled="(activeEl as FmSlides).slides.length <= 1"
                    @click="removeSlideItem(activeEl as FmSlides, i)"
                  >−</el-button>
                </div>
                <el-button size="small" plain @click="addSlideItem(activeEl as FmSlides)">
                  {{ t('fancymenu.addSlide') }}
                </el-button>
              </div>
            </el-form-item>

            <el-form-item :label="t('fancymenu.fields.duration')">
              <el-input-number
                v-model="(activeEl as FmSlides).duration"
                :min="500"
                :step="500"
                controls-position="right"
              />
            </el-form-item>

            <el-form-item :label="t('fancymenu.fields.fadeTime')">
              <el-input-number
                v-model="(activeEl as FmSlides).fadeTime"
                :min="0"
                :step="100"
                controls-position="right"
              />
            </el-form-item>

            <el-form-item :label="t('fancymenu.fields.fitType')">
              <el-select v-model="(activeEl as FmSlides).fitType">
                <el-option value="stretch" :label="t('fancymenu.fitTypes.stretch')" />
                <el-option value="crop" :label="t('fancymenu.fitTypes.crop')" />
                <el-option value="fill" :label="t('fancymenu.fitTypes.fill')" />
              </el-select>
            </el-form-item>
          </template>

          <!-- particles 粒子字段 -->
          <template v-if="activeEl.type === 'particles'">
            <el-form-item :label="t('fancymenu.fields.particleId')">
              <el-input
                v-model="(activeEl as FmParticles).particleId"
                placeholder="minecraft:flame"
              />
            </el-form-item>

            <el-form-item :label="t('fancymenu.fields.amount')">
              <el-input-number
                v-model="(activeEl as FmParticles).amount"
                :min="1"
                :max="200"
                controls-position="right"
              />
            </el-form-item>

            <el-form-item :label="t('fancymenu.fields.origin')">
              <div class="fm-pos-row">
                <el-input-number
                  v-model="(activeEl as FmParticles).originX"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  :precision="2"
                  controls-position="right"
                />
                <span class="fm-pos-sep">,</span>
                <el-input-number
                  v-model="(activeEl as FmParticles).originY"
                  :min="0"
                  :max="1"
                  :step="0.05"
                  :precision="2"
                  controls-position="right"
                />
              </div>
            </el-form-item>

            <el-form-item :label="t('fancymenu.fields.spread')">
              <div class="fm-pos-row">
                <el-input-number
                  v-model="(activeEl as FmParticles).spreadX"
                  :min="0"
                  :step="0.1"
                  :precision="2"
                  controls-position="right"
                />
                <span class="fm-pos-sep">,</span>
                <el-input-number
                  v-model="(activeEl as FmParticles).spreadY"
                  :min="0"
                  :step="0.1"
                  :precision="2"
                  controls-position="right"
                />
              </div>
            </el-form-item>

            <el-form-item :label="t('fancymenu.fields.speed')">
              <div class="fm-pos-row">
                <el-input-number
                  v-model="(activeEl as FmParticles).speedX"
                  :step="0.05"
                  :precision="2"
                  controls-position="right"
                />
                <span class="fm-pos-sep">,</span>
                <el-input-number
                  v-model="(activeEl as FmParticles).speedY"
                  :step="0.05"
                  :precision="2"
                  controls-position="right"
                />
              </div>
            </el-form-item>

            <el-form-item :label="t('fancymenu.fields.particleSize')">
              <el-input-number
                v-model="(activeEl as FmParticles).size"
                :min="0.1"
                :step="0.1"
                :precision="1"
                controls-position="right"
              />
            </el-form-item>
          </template>
        </el-form>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import FancyMenuCanvas from './FancyMenuCanvas.vue'
import type {
  FmAnchor,
  FmButton,
  FmElement,
  FmImage,
  FmParticles,
  FmRect,
  FmSlides,
  FmText
} from '../../../../shared/types/fancymenu'
import { useProjectStore } from '../../stores/project'
import { t } from '../../i18n'

const projectStore = useProjectStore()
const root = computed(() => projectStore.currentProject?.path ?? '')
const loader = computed<string | undefined>(() =>
  projectStore.currentProject?.loader ?? undefined
)

// ---- 状态 ----
const elements = ref<FmElement[]>([])
const activeId = ref<string>('')
const filePath = ref<string | null>(null)
const dirty = ref(false)

const activeEl = computed<FmElement | null>(() =>
  elements.value.find((e) => e.id === activeId.value) ?? null
)

const sortedByZ = computed(() =>
  [...elements.value].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
)

// ---- 常量 ----
const ANCHORS: { value: FmAnchor }[] = [
  { value: 'top_left' },
  { value: 'top_center' },
  { value: 'top_right' },
  { value: 'middle_left' },
  { value: 'center' },
  { value: 'middle_right' },
  { value: 'bottom_left' },
  { value: 'bottom_center' },
  { value: 'bottom_right' }
]

// ---- 生命周期 / 外部触发 ----
defineExpose({
  async reload(): Promise<void> {
    await onRead()
  },
  async save(): Promise<{ ok: boolean; filePath?: string; error?: string }> {
    return await onSave()
  },
  dirty: () => dirty.value
})

// ---- 读 ----
async function onRead(): Promise<void> {
  if (!root.value) return
  const res = await window.api.fancymenu.read(root.value, loader.value)
  if ('error' in res) {
    ElMessage.error(t('fancymenu.readError', { error: res.error }))
    return
  }
  filePath.value = res.filePath
  elements.value = res.elements
  activeId.value = ''
  dirty.value = false
}

// ---- 存 ----
async function onSave(): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  if (!root.value) {
    ElMessage.warning(t('fancymenu.noLayout'))
    return { ok: false, error: 'no project' }
  }
  const res = await window.api.fancymenu.save(root.value, elements.value, loader.value)
  if ('error' in res) {
    ElMessage.error(t('fancymenu.saveError', { error: res.error }))
    return { ok: false, error: res.error }
  }
  filePath.value = res.filePath
  dirty.value = false
  ElMessage.success(t('fancymenu.saved', { path: res.filePath }))
  return { ok: true, filePath: res.filePath }
}

// ---- 增删改 ----
function placeholderName(el: FmElement): string {
  switch (el.type) {
    case 'button': return el.text
    case 'text': return el.text
    case 'image': return el.url.slice(el.url.lastIndexOf('/') + 1) || t('fancymenu.unnamed')
    case 'rect': return t('fancymenu.rectLabel')
    case 'slides': return t('fancymenu.slidesLabel', { n: el.slides.length })
    case 'particles': return el.particleId || t('fancymenu.particlesLabel')
  }
}

function elTypeTagColor(
  type: FmElement['type']
): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  switch (type) {
    case 'button': return 'primary'
    case 'image': return 'success'
    case 'text': return 'warning'
    case 'rect': return 'danger'
    case 'slides': return 'info'
    case 'particles': return 'info'
  }
}

function makeId(prefix = 'fm'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function onAddElement(): void {
  const prevMaxZ = elements.value.reduce((m, e) => Math.max(m, e.z ?? 0), -1)
  const idx = elements.value.length % 6
  const xOffsets = [200, 500, 800, 320, 120, 700]
  const yOffsets = [200, 400, 260, 520, 470, 520]

  let el: FmElement
  switch (idx) {
    case 0: // button
      el = {
        id: makeId('btn'),
        type: 'button',
        name: t('fancymenu.newButton'),
        anchor: 'center',
        x: xOffsets[idx],
        y: yOffsets[idx],
        width: 140,
        height: 24,
        z: prevMaxZ + 1,
        text: t('fancymenu.newButton')
      } as FmButton
      break
    case 1: // text
      el = {
        id: makeId('txt'),
        type: 'text',
        name: t('fancymenu.newText'),
        anchor: 'top_left',
        x: xOffsets[idx],
        y: yOffsets[idx],
        width: 240,
        height: 32,
        z: prevMaxZ + 1,
        text: t('fancymenu.newText'),
        size: 16
      } as FmText
      break
    case 2: // image
      el = {
        id: makeId('img'),
        type: 'image',
        name: t('fancymenu.newImage'),
        anchor: 'center',
        x: xOffsets[idx],
        y: yOffsets[idx],
        width: 256,
        height: 144,
        z: prevMaxZ + 1,
        url: ''
      } as FmImage
      break
    case 3: // rect
      el = {
        id: makeId('bg'),
        type: 'rect',
        name: t('fancymenu.newRect'),
        anchor: 'top_left',
        x: xOffsets[idx],
        y: yOffsets[idx],
        width: 400,
        height: 30,
        z: prevMaxZ + 1,
        color: '#2a2f38'
      } as FmRect
      break
    case 4: // slides
      el = {
        id: makeId('slides'),
        type: 'slides',
        name: t('fancymenu.newSlides'),
        anchor: 'top_left',
        x: 0,
        y: 0,
        width: 724,
        height: 407,
        z: prevMaxZ + 1,
        slides: [
          { type: 'image', path: 'minecraft:textures/gui/title/background/panorama_0.png' },
          { type: 'image', path: 'minecraft:textures/gui/title/background/panorama_1.png' }
        ],
        duration: 5000,
        fadeTime: 1000,
        fitType: 'stretch'
      } as FmSlides
      break
    default: // particles
      el = {
        id: makeId('particles'),
        type: 'particles',
        name: t('fancymenu.newParticles'),
        anchor: 'center',
        x: xOffsets[idx],
        y: yOffsets[idx],
        width: 320,
        height: 200,
        z: prevMaxZ + 1,
        particleId: 'minecraft:flame',
        amount: 20,
        originX: 0.5,
        originY: 0.5,
        spreadX: 1,
        spreadY: 1,
        speedX: 0.1,
        speedY: 0.1,
        size: 1
      } as FmParticles
  }
  elements.value.push(el)
  activeId.value = el.id
  dirty.value = true
}

function onDeleteActive(): void {
  if (!activeId.value) return
  void ElMessageBox.confirm(t('fancymenu.confirmDelete'), t('fancymenu.confirmTitle'), {
    confirmButtonText: t('fancymenu.confirm'),
    cancelButtonText: t('fancymenu.cancel'),
    type: 'warning'
  }).then(() => {
    elements.value = elements.value.filter((e) => e.id !== activeId.value)
    activeId.value = ''
    dirty.value = true
  }).catch(() => { /* 用户取消 */ })
}

function onDuplicateActive(): void {
  if (!activeEl.value) return
  const src = activeEl.value
  const clone: FmElement = JSON.parse(JSON.stringify(src))
  clone.id = makeId(src.type)
  clone.name = (clone.name ?? src.type) + ' (副本)'
  clone.x = src.x + 24
  clone.y = src.y + 24
  clone.z = (src.z ?? 0) + 1
  elements.value.push(clone)
  activeId.value = clone.id
  dirty.value = true
}

/** 确保 action 对象存在（从无到有时先建空壳） */
function ensureAction(el: FmButton): void {
  if (!el.action) el.action = { type: 'command', value: '' }
  dirty.value = true
}

/** 轮播图增删 */
function addSlideItem(el: FmSlides): void {
  el.slides.push({ type: 'image', path: '' })
  dirty.value = true
}

function removeSlideItem(el: FmSlides, index: number): void {
  if (el.slides.length <= 1) return
  el.slides.splice(index, 1)
  dirty.value = true
}

onMounted(onRead)
</script>

<style scoped>
.fm-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ky-surface, #111318);
  color: var(--ky-text, #e8ecf2);
}

.fm-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: var(--ky-toolbar, #14171d);
}
.fm-toolbar-left, .fm-toolbar-center { display: flex; align-items: center; gap: 6px; }
.fm-toolbar-center { flex: 1; justify-content: center; }
.fm-toolbar-right { display: flex; align-items: center; gap: 10px; }
.fm-path {
  font-size: 11px;
  color: #7a808e;
  font-family: 'Consolas', monospace;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fm-dirty-tag { cursor: default; }

.fm-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px 1fr 300px;
  gap: 0;
}

.fm-side {
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}
.fm-side-right { border-right: none; border-left: 1px solid rgba(255, 255, 255, 0.05); }

.fm-side-title {
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #9aa1ae;
  letter-spacing: 0.02em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  text-transform: uppercase;
}

.fm-canvas-host {
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  display: flex;
}

.fm-el-list { list-style: none; margin: 0; padding: 6px; }
.fm-el-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  color: #c5cad3;
  transition: background 0.1s;
}
.fm-el-item:hover { background: rgba(255,255,255,0.04); }
.fm-el-item.active { background: rgba(74, 158, 255, 0.15); color: #fff; }

.fm-el-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-family: 'Consolas', monospace;
}
.fm-el-badge--type { text-transform: uppercase; }
.fm-el-badge.type-button { background: rgba(74,158,255,0.2); color: #4a9eff; }
.fm-el-badge.type-image  { background: rgba(74, 199, 135, 0.2); color: #4ac787; }
.fm-el-badge.type-text   { background: rgba(212, 156, 74, 0.2); color: #d49c4a; }
.fm-el-badge.type-rect   { background: rgba(220, 86, 86, 0.2); color: #dc5656; }
.fm-el-badge.type-slides { background: rgba(122, 199, 255, 0.2); color: #7ac7ff; }
.fm-el-badge.type-particles { background: rgba(255, 176, 122, 0.2); color: #ffb07a; }
.fm-el-badge--z { background: rgba(255,255,255,0.06); color: #7a808e; margin-left: auto; }

.fm-el-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fm-el-empty {
  padding: 24px 12px;
  text-align: center;
  color: #5a6270;
  font-size: 12px;
}

.fm-prop-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5a6270;
  font-size: 12px;
  padding: 24px;
  text-align: center;
}

.fm-prop-form {
  padding: 10px 14px;
  overflow-y: auto;
  flex: 1;
}
.fm-pos-row {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.fm-pos-row .el-input-number { flex: 1; }
.fm-pos-sep { color: #6b7280; font-family: 'Consolas', monospace; }
.fm-action-row { display: flex; gap: 4px; width: 100%; }
.fm-action-row .el-select { width: 110px; flex-shrink: 0; }
.fm-action-row .el-input { flex: 1; }

/* 轮播图列表 */
.fm-slide-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}
.fm-slide-row {
  display: flex;
  gap: 4px;
  align-items: center;
  width: 100%;
}
.fm-slide-type { width: 70px; flex-shrink: 0; }
.fm-slide-path { flex: 1; min-width: 0; }
</style>
