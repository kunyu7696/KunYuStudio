<template>
  <div class="pm-view" :class="{ 'is-workspace': inWorkspace }">
    <!-- 已打开项目：代码工作区 -->
    <div v-if="inWorkspace" class="pm-workspace">
      <section class="pmw-pane">
        <ExplorerView />
      </section>
    </div>

    <!-- 未打开项目：欢迎页（项目列表在左侧侧边栏） -->
    <template v-else>
      <header class="pm-header">
        <h1>项目管理</h1>
        <p class="pm-subtitle">从左侧选择项目打开，或点 ＋ 创建、⊥ 导入</p>
      </header>

      <div v-if="projectStore.loading" class="pm-loading">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>加载中…</span>
      </div>

      <template v-else>
        <div class="pm-hint">
          <el-icon :size="56" class="pm-hint-icon"><FolderOpened /></el-icon>
          <h2>{{ projectStore.projects.length > 0 ? '请选择一个项目' : '还没有项目' }}</h2>
          <p v-if="projectStore.projects.length > 0">
            左侧项目列表已有 {{ projectStore.projects.length }} 个项目，点一下打开
          </p>
          <p v-else>点击左侧 ＋ 创建第一个项目，或 ⊥ 导入已有项目文件夹</p>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue'
import { FolderOpened, Loading } from '@element-plus/icons-vue'
import { useProjectStore } from '../../stores/project'

const projectStore = useProjectStore()

const ExplorerView = defineAsyncComponent(() => import('./ExplorerView.vue'))

/** 是否处于项目工作区（有打开的项目） */
const inWorkspace = computed(() => Boolean(projectStore.currentProject))

onMounted(() => {
  void projectStore.refresh()
})
</script>

<style scoped>
.pm-view {
  height: 100%;
  overflow-y: auto;
  padding: 24px 32px;
}

/* 工作区态：铺满内容区，由内部两个 pane 互斥显示 */
.pm-view.is-workspace {
  padding: 0;
  overflow: hidden;
}

.pm-workspace {
  position: relative;
  height: 100%;
  background: var(--ky-bg-panel);
  overflow: hidden;
}

.pmw-pane {
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.pm-header {
  margin-bottom: 20px;
}

.pm-header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: var(--ky-text);
}

.pm-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ky-text-dim);
}

.pm-loading {
  height: 60%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ky-text-sub);
}

.pm-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 0 28px;
  color: var(--ky-text-dim);
}

.pm-hint-icon {
  color: var(--ky-accent);
  opacity: 0.5;
}

.pm-hint h2 {
  margin: 0;
  font-size: 18px;
  color: var(--ky-text-sub);
}

.pm-hint p {
  margin: 0;
  font-size: 13px;
  color: var(--ky-text-dim);
}
</style>
