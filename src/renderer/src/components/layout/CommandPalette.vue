<template>
  <!-- 命令面板：Ctrl+K 唤起；模块导航 + 高频动作统一入口 -->
  <Teleport to="body">
    <div v-if="ui.commandPaletteOpen" class="cp-overlay" @mousedown.self="ui.closeCommandPalette()">
      <div class="cp-panel" role="dialog" :aria-label="t('palette.label')">
        <input
          ref="inputRef"
          v-model="query"
          class="cp-input"
          type="text"
          :placeholder="t('palette.placeholder')"
          @keydown.down.prevent="move(1)"
          @keydown.up.prevent="move(-1)"
          @keydown.enter.prevent="runActive()"
          @keydown.esc="ui.closeCommandPalette()"
        />
        <div class="cp-list" role="listbox">
          <div
            v-for="(cmd, i) in filtered"
            :key="cmd.id"
            class="cp-item"
            :class="{ active: i === activeIndex, disabled: cmd.disabled }"
            role="option"
            :aria-selected="i === activeIndex"
            @mouseenter="activeIndex = i"
            @click="runCommand(cmd)"
          >
            <el-icon :size="15" class="cp-icon"><component :is="cmd.icon" /></el-icon>
            <span class="cp-title">{{ cmd.title }}</span>
            <span v-if="cmd.hint" class="cp-hint">{{ cmd.hint }}</span>
          </div>
          <div v-if="filtered.length === 0" class="cp-empty">{{ t('palette.empty') }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChatLineRound, DocumentChecked, Plus, Refresh, VideoPlay } from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { moduleRegistry, type KunYuModule } from '../../modules'
import { useUiStore } from '../../stores/ui'
import { useProjectStore } from '../../stores/project'
import { useEditorStore } from '../../stores/editor'
import { useBuildStore } from '../../stores/build'
import { useExplorerStore } from '../../stores/explorer'
import { t, moduleName, moduleDescription } from '../../i18n'

const ui = useUiStore()
const projectStore = useProjectStore()
const editorStore = useEditorStore()
const build = useBuildStore()
const explorerStore = useExplorerStore()

interface PaletteCommand {
  id: string
  title: string
  icon: Component
  hint?: string
  /** 额外检索词（拼音/英文别名） */
  keywords?: string
  disabled?: boolean
  run: () => void | Promise<void>
}

const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

/** 与活动栏同规则：requireProject / projectTypes 不满足的模块不出现在导航命令里 */
function isEligible(mod: KunYuModule): boolean {
  const type = projectStore.currentProject?.type
  if (mod.requireProject && !type) return false
  if (mod.projectTypes && (!type || !mod.projectTypes.includes(type))) return false
  return true
}

const hasProject = computed(() => Boolean(projectStore.currentProject))

const commands = computed<PaletteCommand[]>(() => {
  const list: PaletteCommand[] = []
  // 高频动作
  list.push({
    id: 'action:new-project',
    title: t('palette.newProject'),
    icon: Plus,
    keywords: 'new create xinjian',
    run: () => ui.openWizard()
  })
  list.push({
    id: 'action:save',
    title: t('palette.saveFile'),
    icon: DocumentChecked,
    hint: t('palette.editorTab'),
    keywords: 'save baocun',
    disabled: !hasProject.value,
    run: () => editorStore.saveActive()
  })
  list.push({
    id: 'action:build',
    title: t('palette.build'),
    icon: VideoPlay,
    hint: 'Ctrl+B',
    keywords: 'build goujian',
    disabled: !hasProject.value || build.running,
    run: () => {
      const root = projectStore.currentProject?.path
      if (root) void build.build(root)
    }
  })
  list.push({
    id: 'action:build-run',
    title: t('palette.buildRun'),
    icon: VideoPlay,
    hint: 'F5',
    keywords: 'run game yunxing',
    disabled: !hasProject.value || build.running,
    run: () => {
      const root = projectStore.currentProject?.path
      if (root) void build.buildAndRun(root)
    }
  })
  if (build.running) {
    list.push({
      id: 'action:stop',
      title: t('palette.stop'),
      icon: VideoPlay,
      keywords: 'stop cancel tingzhi',
      run: () => build.cancel()
    })
  }
  list.push({
    id: 'action:refresh-tree',
    title: t('palette.refreshTree'),
    icon: Refresh,
    keywords: 'refresh shuaxin',
    disabled: !explorerStore.rootPath,
    run: () => explorerStore.refreshAll()
  })
  list.push({
    id: 'action:toggle-ai',
    title: ui.aiPanelVisible ? t('palette.hideAi') : t('palette.showAi'),
    icon: ChatLineRound,
    keywords: 'ai assistant zhushou',
    run: () => ui.toggleAiPanel()
  })
  // 模块导航
  for (const mod of moduleRegistry.list()) {
    if (!isEligible(mod)) continue
    list.push({
      id: `nav:${mod.id}`,
      title: t('palette.switchTo', { name: moduleName(mod) }),
      icon: mod.icon,
      hint: moduleDescription(mod),
      keywords: `nav ${mod.id} ${mod.name}`,
      run: () => ui.setActiveModule(mod.id)
    })
  }
  return list
})

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return commands.value
  return commands.value.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      (c.keywords ?? '').toLowerCase().includes(q) ||
      (c.hint ?? '').toLowerCase().includes(q)
  )
})

watch(
  () => ui.commandPaletteOpen,
  async (open) => {
    if (open) {
      query.value = ''
      activeIndex.value = 0
      await nextTick()
      inputRef.value?.focus()
    }
  }
)

watch(query, () => {
  activeIndex.value = 0
})

function move(delta: number): void {
  const n = filtered.value.length
  if (n === 0) return
  activeIndex.value = (activeIndex.value + delta + n) % n
}

function runActive(): void {
  const cmd = filtered.value[activeIndex.value]
  if (cmd) void runCommand(cmd)
}

async function runCommand(cmd: PaletteCommand): Promise<void> {
  if (cmd.disabled) return
  ui.closeCommandPalette()
  await cmd.run()
}
</script>

<style scoped>
.cp-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.cp-panel {
  margin-top: 12vh;
  width: 540px;
  max-width: 90vw;
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.cp-input {
  width: 100%;
  padding: 12px 14px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ky-text);
  font-size: 13px;
  font-family: inherit;
  border-bottom: 1px solid var(--ky-border);
}

.cp-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
}

.cp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--ky-text);
  font-size: 12.5px;
}

.cp-item.active {
  background: var(--ky-bg-hover);
}

.cp-item.disabled {
  opacity: 0.45;
  cursor: default;
}

.cp-icon {
  flex-shrink: 0;
  color: var(--ky-text-dim);
}

.cp-item.active .cp-icon {
  color: var(--ky-accent);
}

.cp-title {
  flex-shrink: 0;
}

.cp-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--ky-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 50%;
}

.cp-empty {
  padding: 18px;
  text-align: center;
  color: var(--ky-text-dim);
  font-size: 12px;
}
</style>
