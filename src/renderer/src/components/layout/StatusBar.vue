<template>
  <footer class="status-bar">
    <!-- 左侧：项目 + 模块 + 构建状态 -->
    <div class="sb-left">
      <span v-if="project" class="sb-item sb-project">
        <el-icon :size="13"><FolderOpened /></el-icon>
        {{ project.name }}
      </span>
      <span class="sb-sep" />
      <span v-if="moduleLabel" class="sb-item">
        <el-icon :size="13"><Grid /></el-icon>
        {{ moduleLabel }}
      </span>
      <span v-if="build.running" class="sb-item sb-build sb-build-running">
        <el-icon :size="13" class="sb-spin"><Loading /></el-icon>
        {{ build.statusText }}
      </span>
      <span v-else-if="build.lastResult?.ok" class="sb-item sb-build sb-build-ok">
        <el-icon :size="13"><CircleCheckFilled /></el-icon>
        {{ t('status.buildSuccess') }}
      </span>
      <span v-else-if="build.lastResult" class="sb-item sb-build sb-build-fail">
        <el-icon :size="13"><CircleCloseFilled /></el-icon>
        {{ t('status.buildFail') }}
      </span>
      <span v-if="build.errorCount > 0" class="sb-item sb-err">
        <el-icon :size="13"><WarningFilled /></el-icon>
        {{ t('status.errors', { n: build.errorCount }) }}
      </span>
      <span v-if="build.warningCount > 0" class="sb-item sb-warn">
        <el-icon :size="13"><InfoFilled /></el-icon>
        {{ t('status.warnings', { n: build.warningCount }) }}
      </span>
    </div>

    <!-- 右侧：JDK + 加载器 + MC版本 + 版本号 -->
    <div class="sb-right">
      <span v-if="project" class="sb-item">
        <el-icon :size="13"><Coin /></el-icon>
        {{ loaderLabel }}
      </span>
      <span v-if="project" class="sb-item">
        <el-icon :size="13"><Monitor /></el-icon>
        {{ project.mcVersion }}
      </span>
      <span :class="['sb-item', { 'sb-jdk-warn': !jdkTag.compatible }]" :title="jdkTag.title">
        <el-icon :size="13"><Cpu /></el-icon>
        {{ jdkTag.text }}
      </span>
      <span class="sb-item sb-version">KunYu v{{ appVersion }}</span>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  CircleCheckFilled,
  CircleCloseFilled,
  Coin,
  Cpu,
  FolderOpened,
  Grid,
  InfoFilled,
  Loading,
  Monitor,
  WarningFilled
} from '@element-plus/icons-vue'
import { useProjectStore } from '../../stores/project'
import { useBuildStore } from '../../stores/build'
import { useUiStore } from '../../stores/ui'
import { t, moduleName } from '../../i18n'

const projectStore = useProjectStore()
const build = useBuildStore()
const ui = useUiStore()

const project = computed(() => projectStore.currentProject)

const moduleLabel = computed(() => {
  const m = ui.activeModule
  return m ? moduleName(m) : ''
})

const loaderLabel = computed(() => {
  switch (project.value?.loader) {
    case 'fabric': return 'Fabric'
    case 'forge': return 'Forge'
    case 'neoforge': return 'NeoForge'
    default: return project.value?.loader ?? '—'
  }
})

const jdkTag = computed(() => {
  const r = build.jdk
  if (!r?.jdk) return { text: 'Java —', compatible: true, title: t('status.jdkNotDetected') }
  return {
    text: `Java ${r.jdk.major}`,
    compatible: r.compatible,
    title: r.compatible
      ? `${r.jdk.home}`
      : `${r.message ?? t('status.jdkIncompatible')}`
  }
})

const appVersion = ref('…')
;(async () => {
  try {
    appVersion.value = await window.api.app.getVersion()
  } catch { /* ignore */ }
})()
</script>

<style scoped>
.status-bar {
  height: 24px;           /* 收窄：比顶栏 48px 薄一半 */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 10px;
  font-size: 11px;
  background: var(--ky-bg-sidebar);
  border-top: 1px solid var(--ky-border);
  color: var(--ky-text-dim);
  user-select: none;
}

.sb-left,
.sb-right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.sb-right {
  flex-shrink: 0;
}

.sb-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  line-height: 1;
}

.sb-sep {
  width: 1px;
  height: 12px;
  background: var(--ky-border);
}

.sb-project {
  color: var(--ky-text-sub);
  font-weight: 500;
}

/* 构建状态颜色 */
.sb-build-running {
  color: #fbbf24;
}
.sb-build-ok {
  color: #a6e3a1;
}
.sb-build-fail {
  color: #f38ba8;
}

.sb-err { color: #f38ba8; }
.sb-warn { color: #f9e2af; }
.sb-jdk-warn { color: #f9e2af; }

.sb-version {
  color: var(--ky-text-dim);
  opacity: 0.7;
}

.sb-spin {
  animation: sb-spin 1s linear infinite;
}
@keyframes sb-spin {
  to { transform: rotate(360deg); }
}
</style>
