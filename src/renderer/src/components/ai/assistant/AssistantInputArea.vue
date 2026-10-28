<template>
  <!-- 输入区：圆角卡片（textarea 内嵌 + 底部控件行） -->
  <footer class="ap-input">
    <div class="ap-input-card">
      <!-- T7.3：选区解释 / 构建错误修复 快捷入口 -->
      <div v-if="selectionChip || buildErrorChip" class="ap-ctx-chips">
        <button
          v-if="selectionChip"
          type="button"
          class="ap-ctx-chip is-selection"
          :title="selectionChip.tip"
          @click="emit('explainSelection')"
        >
          {{ selectionChip.label }}
        </button>
        <button
          v-if="buildErrorChip"
          type="button"
          class="ap-ctx-chip is-error"
          :title="buildErrorChip.tip"
          @click="emit('fixBuild')"
        >
          {{ buildErrorChip.label }}
        </button>
      </div>
      <textarea
        ref="inputRef"
        v-model="draft"
        class="ap-textarea"
        rows="2"
        :placeholder="t('assistant.input.placeholder')"
        @keydown="onKeydown"
      ></textarea>
      <!-- 待发送附件：图片缩略图 / 文档条目 -->
      <div v-if="attachments.length" class="ap-attach-chips">
        <div
          v-for="(a, i) in attachments"
          :key="`${a.name}-${i}`"
          class="ap-attach-chip"
          :class="a.kind === 'image' ? 'is-image' : 'is-doc'"
        >
          <img v-if="a.thumbUrl" :src="a.thumbUrl" class="ap-attach-thumb" alt="" />
          <el-icon v-else :size="15" class="ap-attach-doc-icon"><Document /></el-icon>
          <span class="ap-attach-name" :title="a.name">{{ a.name }}</span>
          <span class="ap-attach-size">{{ formatBytes(a.size) }}</span>
          <button type="button" class="ap-attach-x" :title="t('assistant.input.removeTip')" @click="removeAttachment(i)">
            <el-icon :size="11"><Close /></el-icon>
          </button>
        </div>
      </div>
      <div class="ap-input-bar">
        <input
          ref="fileInputRef"
          type="file"
          hidden
          multiple
          :accept="ATTACHMENT_ACCEPT"
          @change="onFilePicked"
        />
        <el-tooltip :content="t('assistant.input.uploadTip', { max: MAX_ATTACHMENTS })" placement="top">
          <button
            type="button"
            class="ap-icon-btn"
            :class="{ 'has-files': attachments.length > 0 }"
            @click="pickAttachments"
          >
            <el-icon :size="15"><Plus /></el-icon>
          </button>
        </el-tooltip>
        <!-- Agent 开关直用：点主体直接开/关；右侧小箭头单独弹五档选择。
             未打开项目时禁用（面板此时是普通聊天框，不做项目工作） -->
        <div class="ap-agent-wrap" :class="{ 'is-on': agentMode && agentAvailable, 'is-disabled': !agentAvailable }">
          <button
            type="button"
            class="ap-agent-toggle"
            :disabled="!agentAvailable"
            :title="agentAvailable ? t('assistant.input.agentToggleTip') : t('assistant.input.agentDisabledTip')"
            @click="toggleAgent"
          >
            <el-icon :size="13"><Connection /></el-icon>
            <span class="ap-agent-toggle-text">{{ agentToggleLabel }}</span>
          </button>
          <el-popover
            ref="tierPopRef"
            placement="top-start"
            :width="240"
            trigger="click"
            :disabled="!agentAvailable"
            :teleported="false"
            popper-class="ap-tier-popover"
            @show="tierPopOpen = true"
            @hide="tierPopOpen = false"
          >
            <template #reference>
              <button
                type="button"
                class="ap-agent-caret-btn"
                :disabled="!agentAvailable"
                :title="agentAvailable ? t('assistant.input.tierPickTip') : t('assistant.input.tierDisabledTip')"
              >
                <el-icon :size="11" class="ap-agent-caret" :class="{ 'is-open': tierPopOpen }"><ArrowDown /></el-icon>
              </button>
            </template>
            <div class="ap-tier-pop">
              <div class="ap-tier-pop-title">{{ t('assistant.input.tierPopTitle') }}</div>
              <button
                type="button"
                class="ap-tier-item"
                :class="{ 'is-active': agentMode && !agents.selectedTier }"
                @click="pickTier(null)"
              >
                <el-icon :size="15" class="ap-tier-ico"><MagicStick /></el-icon>
                <span class="ap-tier-name">{{ t('assistant.input.tierAuto') }}</span>
                <span class="ap-tier-sub">{{ t('assistant.input.tierAutoDesc') }}</span>
                <el-icon v-if="agentMode && !agents.selectedTier" :size="14" class="ap-tier-check"><Check /></el-icon>
              </button>
              <button
                v-for="tier in TIER_METAS"
                :key="tier.id"
                type="button"
                class="ap-tier-item"
                :class="{ 'is-active': agents.selectedTier === tier.id }"
                :title="`${tier.title} · ${tier.positioning}`"
                @click="pickTier(tier.id)"
              >
                <el-icon :size="15" class="ap-tier-ico"><component :is="tierIconOf(tier.id)" /></el-icon>
                <span class="ap-tier-name">{{ tier.name }}</span>
                <span class="ap-tier-sub">{{ tier.title }}</span>
                <el-icon v-if="agents.selectedTier === tier.id" :size="14" class="ap-tier-check"><Check /></el-icon>
              </button>
            </div>
          </el-popover>
        </div>
        <!-- 模型选择：替代顶部厂商窗口，开发者点此切换模型 -->
        <el-select
          :model-value="defaultProviderId ?? ''"
          size="small"
          class="ap-provider-inline"
          :placeholder="t('assistant.input.modelPh')"
          @change="(v: string | number | boolean | undefined) => emit('providerChange', v)"
        >
          <el-option
            v-for="p in providers"
            :key="p.id"
            :label="p.model ? `${p.name} · ${p.model}` : p.name"
            :value="p.id"
          />
        </el-select>
        <span v-if="busy" class="ap-input-hint">{{ agentMode ? t('assistant.input.agentBusy') : providerName }}</span>
        <button v-if="busy" type="button" class="ap-send is-stop" :title="t('assistant.input.stopTip')" @click="emit('stop')">
          <el-icon :size="13"><Close /></el-icon>
        </button>
        <button
          v-else
          type="button"
          class="ap-send"
          :title="t('assistant.input.sendTip')"
          :disabled="!draft.trim() && attachments.length === 0"
          @click="emit('send')"
        >
          <el-icon :size="15"><Top /></el-icon>
        </button>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ArrowDown,
  Check,
  Close,
  Connection,
  Document,
  Lightning,
  MagicStick,
  Plus,
  Share,
  Switch,
  Tools,
  Top,
  Trophy
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAiAgentsStore } from '../../../stores/aiAgents'
import type { AiProviderConfig, ChatAttachment } from '../../../../../shared/types/ai'
import { TIER_METAS, type TierId } from '../../../../../shared/types/tiers'
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS,
  formatBytes,
  readAttachments
} from '../../../utils/attachment'
import type { ContextChip } from './useContextChips'
import { useI18n } from '../../../i18n'

const draft = defineModel<string>('draft', { default: '' })
const attachments = defineModel<ChatAttachment[]>('attachments', { default: () => [] })
/** 多 Agent 工程模式开关（关闭即普通厂商问答，轨道不出现） */
const agentMode = defineModel<boolean>('agentMode', { default: false })

withDefaults(
  defineProps<{
    selectionChip: ContextChip | null
    buildErrorChip: ContextChip | null
    providers: AiProviderConfig[]
    defaultProviderId: string | null
    busy: boolean
    providerName: string
    /** 是否可用 Agent 工程模式：未打开项目时为 false（面板退化为普通聊天框） */
    agentAvailable?: boolean
  }>(),
  { agentAvailable: true }
)

const emit = defineEmits<{
  send: []
  stop: []
  explainSelection: []
  fixBuild: []
  providerChange: [value: string | number | boolean | undefined]
}>()

const agents = useAiAgentsStore()
const { t } = useI18n()

const inputRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

function pickAttachments(): void {
  fileInputRef.value?.click()
}

async function onFilePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return
  const { ok, rejected } = await readAttachments(input.files)
  // 重置 value，允许再次选择同一个文件
  input.value = ''
  if (ok.length > 0) {
    const room = MAX_ATTACHMENTS - attachments.value.length
    if (room > 0) attachments.value.push(...ok.slice(0, room))
    if (ok.length > room) {
      rejected.unshift(t('assistant.input.tooMany', { max: MAX_ATTACHMENTS }))
    }
  }
  if (rejected.length > 0) ElMessage.warning(rejected.join('；'))
}

function removeAttachment(index: number): void {
  attachments.value.splice(index, 1)
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    emit('send')
  }
}

// textarea 随内容增高（限 120px）
watch(draft, async () => {
  await nextTick()
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  // scrollHeight 在布局未就绪时可能为 0，此时保持 auto 由 rows 撑高
  const h = el.scrollHeight
  if (h > 0) el.style.height = `${Math.min(h, 120)}px`
})

/** 档位下拉弹层开关（用于箭头翻转） */
const tierPopOpen = ref(false)
/** 档位弹层实例（选档后主动收起） */
const tierPopRef = ref<{ hide: () => void } | null>(null)

/** 五档图标：闪电=迅工 / 工具=匠造 / 奖杯=大师 / 交换=桥接 / 织网=织星 */
const TIER_ICONS: Record<TierId, unknown> = {
  sprinter: Lightning,
  artisan: Tools,
  master: Trophy,
  bridge: Switch,
  weaver: Share
}
function tierIconOf(id: TierId): unknown {
  return TIER_ICONS[id]
}

/** Agent 开关直用：点按钮主体直接开/关，档位选择走旁边小箭头 */
function toggleAgent(): void {
  agentMode.value = !agentMode.value
  tierPopOpen.value = false
}

/** 选择档位：null=自动匹配；选中即开启 Agent 模式 */
function pickTier(tier: TierId | null): void {
  agents.setTier(tier)
  agentMode.value = true
  tierPopOpen.value = false
  tierPopRef.value?.hide()
}

/** 开关上展示的标签：开=档位名（或自动），关=Agent */
const agentToggleLabel = computed(() => {
  if (!agentMode.value) return 'Agent'
  if (!agents.selectedTier) return t('assistant.input.agentAuto')
  return TIER_METAS.find((tier) => tier.id === agents.selectedTier)?.name ?? 'Agent'
})

defineExpose({
  focus: () => inputRef.value?.focus()
})
</script>

<style scoped>
/* 输入栏内联模型选择器（替代顶部厂商窗口） */
.ap-provider-inline {
  min-width: 0;
  flex: 1;
}
.ap-provider-inline :deep(.el-select__wrapper) {
  padding: 0 8px;
  min-height: 28px;
}

/* 输入区：底部圆角卡片，textarea 内嵌无边框 */
.ap-input {
  flex-shrink: 0;
  padding: 8px 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ap-input-card {
  border: 1px solid var(--ky-border);
  border-radius: 12px;
  background: var(--ky-bg-panel);
  padding: 4px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.ap-input-card:focus-within {
  border-color: rgba(var(--ky-accent-rgb), 0.55);
  box-shadow: 0 0 0 2px rgba(var(--ky-accent-rgb), 0.1);
}

/* T7.3：上下文快捷入口（选区解释 / 构建错误修复） */
.ap-ctx-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 2px 0;
}
.ap-ctx-chip {
  appearance: none;
  max-width: 100%;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--ky-border);
  background: var(--ky-bg-panel);
  color: var(--ky-text-sub);
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
  font-family: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.ap-ctx-chip:hover {
  border-color: var(--ky-accent);
  color: var(--ky-accent);
}
.ap-ctx-chip.is-error {
  border-color: rgba(243, 139, 168, 0.5);
  color: var(--el-color-danger);
  background: rgba(243, 139, 168, 0.08);
}
.ap-ctx-chip.is-error:hover {
  border-color: var(--el-color-danger);
  background: rgba(243, 139, 168, 0.16);
}
.ap-textarea {
  width: 100%;
  min-height: 48px;
  resize: none;
  background: transparent;
  border: none;
  color: var(--ky-text);
  font-family: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 6px 4px 2px;
  outline: none;
  box-sizing: border-box;
}
.ap-textarea::placeholder {
  color: var(--ky-text-dim);
}
.ap-input-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ap-input-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 输入栏图标按钮（上传 +） */
.ap-icon-btn {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}
.ap-icon-btn:hover {
  background: rgba(147, 153, 178, 0.14);
  color: var(--ky-text);
}
.ap-icon-btn.has-files {
  color: var(--ky-accent);
}

/* Agent 开关：主体直接开/关（绿底黑字），小箭头弹档位 */
.ap-agent-wrap {
  display: inline-flex;
  align-items: stretch;
  flex: 0 0 auto;
}
.ap-agent-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--ky-border);
  border-right: none;
  border-radius: 7px 0 0 7px;
  background: transparent;
  color: var(--ky-text-sub);
  font-family: inherit;
  font-size: 11.5px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.ap-agent-toggle:hover {
  color: var(--ky-text);
  background: rgba(147, 153, 178, 0.1);
}
.ap-agent-toggle-text {
  font-size: 11.5px;
  white-space: nowrap;
}
.ap-agent-caret-btn {
  display: inline-flex;
  align-items: center;
  padding: 0 5px;
  border: 1px solid var(--ky-border);
  border-radius: 0 7px 7px 0;
  background: transparent;
  color: var(--ky-text-sub);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.ap-agent-caret-btn:hover {
  color: var(--ky-text);
  background: rgba(147, 153, 178, 0.1);
}
/* 未打开项目：Agent 工程模式不可用（面板为普通聊天框） */
.ap-agent-wrap.is-disabled .ap-agent-toggle,
.ap-agent-wrap.is-disabled .ap-agent-caret-btn {
  opacity: 0.45;
  cursor: not-allowed;
}
.ap-agent-wrap.is-disabled .ap-agent-toggle:hover,
.ap-agent-wrap.is-disabled .ap-agent-caret-btn:hover {
  color: var(--ky-text-sub);
  background: transparent;
}
.ap-agent-wrap.is-on .ap-agent-toggle,
.ap-agent-wrap.is-on .ap-agent-caret-btn {
  border-color: var(--ky-accent);
  color: #11111b;
}
.ap-agent-wrap.is-on .ap-agent-toggle {
  background: var(--ky-accent);
  font-weight: 600;
}
.ap-agent-wrap.is-on .ap-agent-caret-btn {
  background: var(--ky-accent-hover);
  border-left: 1px solid rgba(17, 17, 27, 0.25);
}

/* 圆形发送/中断按钮 */
.ap-send {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: var(--ky-accent);
  color: #11111b;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: filter 0.15s ease, background 0.15s ease;
}
.ap-send:hover {
  filter: brightness(1.08);
}
.ap-send:disabled {
  background: rgba(147, 153, 178, 0.16);
  color: var(--ky-text-dim);
  cursor: not-allowed;
  filter: none;
}
.ap-send.is-stop {
  background: transparent;
  border: 1px solid rgba(243, 139, 168, 0.55);
  color: var(--el-color-danger);
}
.ap-send.is-stop:hover {
  background: rgba(243, 139, 168, 0.12);
  filter: none;
}

/* ---------- 附件：待发送 chips ---------- */
.ap-attach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 2px;
}
.ap-attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 3px 6px 3px 4px;
  border-radius: 8px;
  border: 1px solid var(--ky-border);
  background: var(--ky-bg-panel);
  font-size: 11px;
  color: var(--ky-text-sub);
}
.ap-attach-thumb {
  width: 34px;
  height: 34px;
  border-radius: 5px;
  object-fit: cover;
  flex-shrink: 0;
  display: block;
}
.ap-attach-doc-icon {
  color: var(--ky-accent);
  flex-shrink: 0;
  margin-left: 3px;
}
.ap-attach-name {
  max-width: 130px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ky-text);
}
.ap-attach-size {
  color: var(--ky-text-dim);
  font-size: 10px;
  flex-shrink: 0;
}
.ap-attach-x {
  appearance: none;
  border: none;
  background: transparent;
  padding: 2px;
  border-radius: 4px;
  color: var(--ky-text-dim);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.ap-attach-x:hover {
  color: var(--el-color-danger);
  background: rgba(243, 139, 168, 0.12);
}

/* Agent 按钮下拉箭头 */
.ap-agent-caret {
  transition: transform 0.2s ease;
}
.ap-agent-caret.is-open {
  transform: rotate(180deg);
}

/* 档位下拉弹层（暗色，参考图2） */
.ap-tier-pop {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ap-tier-pop-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ky-text-dim);
  padding: 4px 6px 6px;
  letter-spacing: 0.3px;
}
.ap-tier-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ky-text);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}
.ap-tier-item:hover {
  background: rgba(255, 255, 255, 0.06);
}
.ap-tier-item.is-active {
  background: rgba(var(--ky-accent-rgb), 0.12);
  color: var(--ky-accent);
}
.ap-tier-item.is-off {
  color: var(--ky-text-dim);
}
.ap-tier-ico {
  flex-shrink: 0;
  color: var(--ky-text-sub);
}
.ap-tier-item.is-active .ap-tier-ico {
  color: var(--ky-accent);
}
.ap-tier-name {
  font-weight: 600;
  flex-shrink: 0;
}
.ap-tier-sub {
  font-size: 11px;
  color: var(--ky-text-dim);
  margin-left: auto;
  white-space: nowrap;
}
.ap-tier-check {
  flex-shrink: 0;
  color: var(--ky-accent);
}
</style>
