<template>
  <div class="inspire-view">
    <div class="iv-scroll">
      <div class="iv-column">
        <!-- ============ 头部 ============ -->
        <header class="iv-head">
          <h1 class="iv-title">{{ t('inspire.title') }}</h1>
          <p class="iv-subtitle">{{ t('inspire.subtitle') }}</p>
        </header>

        <!-- ============ AI 创意生成 ============ -->
        <section class="iv-section">
          <div class="iv-sec-head">
            <span class="iv-sec-title">{{ t('inspire.genTitle') }}</span>
            <div class="iv-type-switch" role="group" :aria-label="t('inspire.typeSwitchAria')">
              <button
                type="button"
                class="iv-type-opt"
                :class="{ 'is-active': projectType === 'mod' }"
                @click="projectType = 'mod'"
              >{{ t('inspire.typeMod') }}</button>
              <button
                type="button"
                class="iv-type-opt"
                :class="{ 'is-active': projectType === 'modpack' }"
                @click="projectType = 'modpack'"
              >{{ t('inspire.typeModpack') }}</button>
            </div>
          </div>

          <!-- 未配置提供商 -->
          <div v-if="!hasProvider" class="iv-no-provider">
            <p class="iv-no-provider-title">{{ t('inspire.noProviderTitle') }}</p>
            <p class="iv-no-provider-desc">{{ t('inspire.noProviderDesc') }}</p>
            <el-button type="primary" @click="openAiSettings">{{ t('inspire.addProvider') }}</el-button>
          </div>

          <template v-else>
            <el-input
              v-model="topic"
              type="textarea"
              :rows="3"
              resize="none"
              :placeholder="topicPlaceholder"
              @keydown.enter.exact.prevent="generate"
            />
            <div class="iv-gen-actions">
              <span v-if="planError" class="iv-error">{{ planError }}</span>
              <el-button
                type="primary"
                :loading="planning"
                :disabled="!topic.trim() || planning"
                @click="generate"
              >
                <el-icon v-if="!planning" class="el-icon--left"><MagicStick /></el-icon>
                {{ planning ? t('inspire.generating') : t('inspire.generate') }}
              </el-button>
            </div>
          </template>

          <!-- 创意卡片：推荐置顶 -->
          <div v-if="draft" class="iv-ideas">
            <div v-for="idea in sortedIdeas" :key="idea.id" class="iv-idea-card">
              <div class="iv-idea-head">
                <h3 class="iv-idea-title">{{ idea.title }}</h3>
                <span v-if="idea.recommended" class="iv-reco">{{ t('inspire.recommended') }}</span>
              </div>
              <p class="iv-idea-desc">{{ idea.description }}</p>
              <div class="iv-idea-actions">
                <el-button
                  size="small"
                  :disabled="inspire.hasAiPin(idea.title)"
                  @click="pinIdea(idea)"
                >{{ inspire.hasAiPin(idea.title) ? t('inspire.pinned') : t('inspire.pin') }}</el-button>
                <el-button size="small" type="primary" plain @click="materialize">
                  {{ t('inspire.materialize') }}
                </el-button>
              </div>
            </div>
          </div>
        </section>

        <!-- ============ 素材板 ============ -->
        <section class="iv-section">
          <div class="iv-sec-head">
            <span class="iv-sec-title">{{ t('inspire.boardTitle') }}</span>
            <div class="iv-add-btns">
              <el-button size="small" @click="openComposer('text')">{{ t('inspire.addText') }}</el-button>
              <el-button size="small" @click="openComposer('link')">{{ t('inspire.addLink') }}</el-button>
              <el-button size="small" @click="pickImage">{{ t('inspire.addImage') }}</el-button>
            </div>
          </div>

          <!-- 手动钉入表单（文本/链接） -->
          <div v-if="composer" class="iv-composer">
            <el-input v-model="composerTitle" :placeholder="t('inspire.cardTitlePlaceholder')" class="iv-composer-title" />
            <el-input
              v-if="composer === 'text'"
              v-model="composerBody"
              type="textarea"
              :rows="3"
              resize="none"
              :placeholder="t('inspire.textPlaceholder')"
            />
            <el-input
              v-else
              v-model="composerBody"
              :placeholder="t('inspire.linkPlaceholder')"
            />
            <div class="iv-composer-actions">
              <el-button size="small" @click="closeComposer">{{ t('common.cancel') }}</el-button>
              <el-button size="small" type="primary" :disabled="!composerBody.trim()" @click="submitComposer">
                {{ t('inspire.pin') }}
              </el-button>
            </div>
          </div>

          <p v-if="inspire.pins.length === 0 && !composer" class="iv-board-empty">
            {{ t('inspire.boardEmpty') }}
          </p>

          <div class="iv-pins">
            <div v-for="pin in inspire.pins" :key="pin.id" class="iv-pin" :class="`is-${pin.kind}`">
              <button
                type="button"
                class="iv-pin-del"
                :title="t('common.delete')"
                :aria-label="t('common.delete')"
                @click="inspire.removePin(pin.id)"
              >✕</button>
              <img
                v-if="pin.kind === 'image'"
                class="iv-pin-img"
                :src="imgUrl(pin.body)"
                :alt="pin.title"
              />
              <div class="iv-pin-body">
                <h4 class="iv-pin-title">{{ pin.title }}</h4>
                <p v-if="pin.kind === 'text'" class="iv-pin-text">{{ pin.body }}</p>
                <button
                  v-else-if="pin.kind === 'link'"
                  type="button"
                  class="iv-pin-link"
                  :title="pin.body"
                  @click="openLink(pin.body)"
                >{{ pin.body }}</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { MagicStick } from '@element-plus/icons-vue'
import { useUiStore } from '../../stores/ui'
import { useSettingsStore } from '../../stores/settings'
import { useInspireStore } from '../../stores/inspire'
import { useI18n } from '../../i18n'
import type { ModPlanDraft, ModPlanIdea, PlanProjectType } from '../../../../shared/types/planner'

const { t } = useI18n()
const ui = useUiStore()
const settings = useSettingsStore()
const inspire = useInspireStore()

// ---------------- AI 创意生成 ----------------
const projectType = ref<PlanProjectType>('mod')
const topic = ref('')
const planning = ref(false)
const planError = ref('')
const draft = ref<ModPlanDraft | null>(null)
/** 生成请求序号：迟到的响应直接丢弃（用户连点生成） */
let genSeq = 0

const hasProvider = computed(
  () => settings.ai.providers.some((p) => p.enabled) && Boolean(settings.ai.defaultProviderId)
)

const topicPlaceholder = computed(() =>
  projectType.value === 'modpack' ? t('inspire.placeholderModpack') : t('inspire.placeholderMod')
)

/** 推荐创意置顶，其余保持原顺序（与原规划向导一致） */
const sortedIdeas = computed(() => {
  if (!draft.value) return []
  return [...draft.value.ideas].sort((a, b) => Number(b.recommended) - Number(a.recommended))
})

/** 复用 AI 极速规划管线（agent:plan 一次性拆解，不进流水线）批量产出创意卡片 */
async function generate(): Promise<void> {
  const text = topic.value.trim()
  if (!text || planning.value) return
  const seq = ++genSeq
  planning.value = true
  planError.value = ''
  try {
    const res = await window.api.agent.plan(text, projectType.value)
    if (seq !== genSeq) return
    if (!res.ok) {
      planError.value = res.errorMessage
      return
    }
    draft.value = res.plan
  } catch (err) {
    if (seq !== genSeq) return
    planError.value = (err as Error).message
  } finally {
    if (seq === genSeq) planning.value = false
  }
}

/** 把 AI 创意钉到素材板（文本卡片） */
function pinIdea(idea: ModPlanIdea): void {
  if (inspire.hasAiPin(idea.title)) return
  inspire.addPin({ kind: 'text', title: idea.title, body: idea.description, source: 'ai' })
}

/** 创意落成新项目：回工作台模式并打开创建向导 */
function materialize(): void {
  ui.setAppMode('ide')
  ui.openWizard()
}

function openAiSettings(): void {
  ui.setAppMode('ide')
  ui.setSettingsCategory('ai')
  ui.setActiveModule('settings', { rememberForSettings: true })
}

// ---------------- 素材板 ----------------
const composer = ref<'text' | 'link' | null>(null)
const composerTitle = ref('')
const composerBody = ref('')

function openComposer(kind: 'text' | 'link'): void {
  composer.value = kind
  composerTitle.value = ''
  composerBody.value = ''
}

function closeComposer(): void {
  composer.value = null
  composerTitle.value = ''
  composerBody.value = ''
}

function submitComposer(): void {
  const kind = composer.value
  const body = composerBody.value.trim()
  if (!kind || !body) return
  const title = composerTitle.value.trim() || body.slice(0, 24)
  inspire.addPin({ kind, title, body, source: 'manual' })
  closeComposer()
}

/** 图片钉入：系统对话框选图（PNG/JPG/WebP/GIF），卡片存本地路径 */
async function pickImage(): Promise<void> {
  const path = await window.api.dialog.selectFile({
    title: t('inspire.pickImageTitle'),
    extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif']
  })
  if (!path) return
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  inspire.addPin({ kind: 'image', title: name, body: path, source: 'manual' })
}

/** 图片卡片渲染：http(s) 直用；本地绝对路径转 file://（与产物截图卡片同一约定） */
function imgUrl(body: string): string {
  if (/^https?:\/\//i.test(body)) return body
  const normalized = body.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`
  if (normalized.startsWith('/')) return `file://${normalized}`
  return body
}

function openLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  void window.api.shell.openExternal(url)
}
</script>

<style scoped>
.inspire-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg);
}

.iv-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.iv-column {
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 32px 64px;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

/* ---- 头部 ---- */
.iv-head {
  text-align: center;
}

.iv-title {
  font-size: 26px;
  font-weight: 700;
  color: var(--ky-text);
  margin: 0 0 8px;
}

.iv-subtitle {
  font-size: 13px;
  color: var(--ky-text-sub);
  margin: 0;
}

/* ---- 分区 ---- */
.iv-section {
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.iv-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.iv-sec-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ky-text);
}

/* 模组/整合包切换（复用原规划向导样式语义） */
.iv-type-switch {
  display: inline-flex;
  border: 1px solid var(--ky-border);
  border-radius: 999px;
  overflow: hidden;
}

.iv-type-opt {
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 12px;
  padding: 5px 14px;
  cursor: pointer;
  font-family: inherit;
}

.iv-type-opt.is-active {
  background: var(--ky-accent);
  color: #fff;
}

.iv-no-provider {
  text-align: center;
  padding: 24px 0 8px;
}

.iv-no-provider-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ky-text);
  margin: 0 0 6px;
}

.iv-no-provider-desc {
  font-size: 12px;
  color: var(--ky-text-sub);
  margin: 0 0 14px;
}

.iv-gen-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.iv-error {
  font-size: 12px;
  color: var(--el-color-danger, #f56c6c);
  margin-right: auto;
}

/* ---- 创意卡片 ---- */
.iv-ideas {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.iv-idea-card {
  border: 1px solid var(--ky-border);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--ky-bg);
}

.iv-idea-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.iv-idea-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ky-text);
  margin: 0;
}

.iv-reco {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--ky-accent);
  border: 1px solid var(--ky-accent);
  border-radius: 999px;
  padding: 1px 8px;
}

.iv-idea-desc {
  flex: 1;
  font-size: 12px;
  color: var(--ky-text-sub);
  line-height: 1.6;
  margin: 0;
}

.iv-idea-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ---- 素材板 ---- */
.iv-add-btns {
  display: flex;
  gap: 8px;
}

.iv-composer {
  border: 1px dashed var(--ky-border);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.iv-composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.iv-board-empty {
  font-size: 12px;
  color: var(--ky-text-dim);
  text-align: center;
  padding: 18px 0;
  margin: 0;
}

.iv-pins {
  columns: 3 240px;
  column-gap: 12px;
}

.iv-pin {
  position: relative;
  break-inside: avoid;
  margin-bottom: 12px;
  border: 1px solid var(--ky-border);
  border-radius: 10px;
  background: var(--ky-bg);
  overflow: hidden;
}

.iv-pin-del {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.iv-pin:hover .iv-pin-del {
  opacity: 1;
}

.iv-pin-img {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
}

.iv-pin-body {
  padding: 10px 12px;
}

.iv-pin-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
  margin: 0 0 4px;
  word-break: break-all;
}

.iv-pin-text {
  font-size: 12px;
  color: var(--ky-text-sub);
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.iv-pin-link {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 12px;
  color: var(--ky-accent);
  cursor: pointer;
  text-align: left;
  word-break: break-all;
  font-family: inherit;
}

.iv-pin-link:hover {
  text-decoration: underline;
}
</style>
