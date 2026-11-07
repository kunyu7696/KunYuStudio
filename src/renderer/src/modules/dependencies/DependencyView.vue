<!--
  活动栏「构建依赖」：模组项目的 Maven 依赖管理
  - 只读写带 kunyu 标记的行（// kunyu:dep: / // kunyu:maven:），用户手写内容零触碰
  - 添加 = 幂等改写 build.gradle 的 repositories / dependencies，撤销 = 删掉对应行
  - 编译期依赖（modImplementation / implementation）与运行期 run/mods 是两条链路
-->
<template>
  <div class="dp-view">
    <header class="dp-header">
      <div class="dp-heading">
        <h2>{{ t('dependency.title') }}</h2>
        <p>{{ t('dependency.desc') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="reload">
        {{ t('dependency.refresh') }}
      </el-button>
    </header>

    <el-alert
      v-if="!hasBuildGradle"
      type="warning"
      :closable="false"
      :title="t('dependency.noBuildGradle')"
    />

    <template v-else>
      <section class="dp-add">
        <div class="dp-add-title">{{ t('dependency.addTitle') }}</div>
        <div class="dp-add-row">
          <el-input
            v-model="form.notation"
            :placeholder="t('dependency.coordinatePh')"
            clearable
            class="dp-add-coord"
            @keyup.enter="onAdd"
          />
          <el-select v-model="form.configuration" class="dp-add-config">
            <el-option v-for="c in configurations" :key="c" :label="c" :value="c" />
          </el-select>
        </div>
        <div class="dp-add-row">
          <el-input
            v-model="form.repository"
            :placeholder="t('dependency.repositoryPh')"
            clearable
            class="dp-add-repo"
            @keyup.enter="onAdd"
          />
          <el-button type="primary" :icon="Plus" :loading="submitting" @click="onAdd">
            {{ t('dependency.add') }}
          </el-button>
        </div>
        <p class="dp-hint">{{ configHint }}</p>
      </section>

      <section class="dp-list">
        <div class="dp-sec-head">
          <span class="dp-sec-title">
            {{ t('dependency.managedDeps', { n: state.dependencies.length }) }}
          </span>
        </div>
        <el-table :data="state.dependencies" size="small" :empty-text="t('dependency.emptyDeps')">
          <el-table-column prop="notation" :label="t('dependency.colNotation')" min-width="280" />
          <el-table-column prop="configuration" :label="t('dependency.colConfig')" width="150" />
          <el-table-column :label="t('dependency.colAction')" width="90" align="center">
            <template #default="{ row }">
              <el-button
                size="small"
                text
                type="danger"
                :icon="Delete"
                :loading="removing === row.notation"
                @click="onRemove(row as ProjectDependency)"
              />
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="dp-list">
        <div class="dp-sec-head">
          <span class="dp-sec-title">
            {{ t('dependency.managedRepos', { n: state.repositories.length }) }}
          </span>
        </div>
        <div v-if="state.repositories.length" class="dp-repos">
          <el-tag
            v-for="url in state.repositories"
            :key="url"
            closable
            type="info"
            :disable-transitions="true"
            @close="onRemoveRepository(url)"
          >
            {{ url }}
          </el-tag>
        </div>
        <p v-else class="dp-hint">{{ t('dependency.emptyRepos') }}</p>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete, Plus, Refresh } from '@element-plus/icons-vue'
import type {
  DependencyConfiguration,
  DependencyFileState,
  DependencyOpResult,
  ProjectDependency
} from '../../../../shared/types/dependency'
import { useProjectStore } from '../../stores/project'
import { useI18n } from '../../i18n'

const { t } = useI18n()
const projectStore = useProjectStore()
const root = computed(() => projectStore.currentProject?.path ?? '')
const loader = computed(() => projectStore.currentProject?.loader ?? null)

const configurations: DependencyConfiguration[] = [
  'modImplementation',
  'implementation',
  'compileOnly',
  'runtimeOnly',
  'api'
]

const state = ref<DependencyFileState>({
  dependencies: [],
  repositories: [],
  hasBuildGradle: false
})
const hasBuildGradle = computed(() => state.value.hasBuildGradle)
const loading = ref(false)
const submitting = ref(false)
const removing = ref('')

const form = reactive({
  notation: '',
  configuration: 'modImplementation' as DependencyConfiguration,
  repository: ''
})

const configHint = computed(() =>
  loader.value === 'fabric' ? t('dependency.hintFabric') : t('dependency.hintOther', { loader: loader.value ?? '' })
)

/** 切换项目时按加载器重置默认配置，避免 Fabric 项目添加后残留实现 */
watch(
  loader,
  (next) => {
    form.configuration = next === 'fabric' ? 'modImplementation' : 'implementation'
  },
  { immediate: true }
)

watch(root, () => {
  if (root.value) void reload()
})

async function reload(): Promise<void> {
  if (!root.value) return
  loading.value = true
  try {
    state.value = await window.api.dependency.state(root.value)
  } finally {
    loading.value = false
  }
}

async function onAdd(): Promise<void> {
  if (!root.value) return
  const notation = form.notation.trim()
  if (!notation) {
    ElMessage.warning(t('dependency.needNotation'))
    return
  }
  submitting.value = true
  try {
    const res = await window.api.dependency.add(root.value, {
      notation,
      configuration: form.configuration,
      repository: form.repository.trim() || undefined
    })
    if (applyResult(res)) {
      ElMessage.success(res.ok && res.changed ? t('dependency.added', { notation }) : t('dependency.unchanged', { notation }))
      form.notation = ''
      form.repository = ''
    }
  } finally {
    submitting.value = false
  }
}

async function onRemove(row: ProjectDependency): Promise<void> {
  if (!root.value) return
  removing.value = row.notation
  try {
    const res = await window.api.dependency.remove(root.value, row.notation)
    if (applyResult(res)) ElMessage.success(t('dependency.removed', { notation: row.notation }))
  } finally {
    removing.value = ''
  }
}

async function onRemoveRepository(url: string): Promise<void> {
  if (!root.value) return
  const res = await window.api.dependency.removeRepository(root.value, url)
  if (applyResult(res)) ElMessage.success(t('dependency.repoRemoved'))
}

/** 结果统一落状态；失败弹错并返回 false */
function applyResult(res: DependencyOpResult): boolean {
  if (!res.ok) {
    ElMessage.error(res.error)
    return false
  }
  state.value = res.state
  return true
}

onMounted(reload)
</script>

<style scoped>
.dp-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  height: 100%;
  overflow: auto;
}

.dp-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.dp-heading h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.dp-heading p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  max-width: 700px;
  line-height: 1.6;
}

.dp-add {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 12px;
}

.dp-add-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.dp-add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.dp-add-coord {
  flex: 1;
}

.dp-add-config {
  width: 170px;
  flex-shrink: 0;
}

.dp-add-repo {
  flex: 1;
}

.dp-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dp-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.dp-sec-title {
  font-size: 13px;
  font-weight: 600;
}

.dp-repos {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
