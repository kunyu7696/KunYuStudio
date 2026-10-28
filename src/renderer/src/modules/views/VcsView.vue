<template>
  <div class="vcs-view">
    <!-- 顶部：项目选择 + 刷新 -->
    <div class="vcs-toolbar">
      <el-select v-model="selectedProjectId" :placeholder="t('vcs.selectProject')" class="vcs-project-select" @change="onProjectChange">
        <el-option v-for="p in projectStore.projects" :key="p.id" :label="p.name" :value="p.id" />
      </el-select>
      <el-button :icon="Refresh" :loading="loading" @click="refresh">{{ t('vcs.refresh') }}</el-button>
    </div>

    <div v-if="!currentProject" class="vcs-empty">
      <el-empty :description="t('vcs.emptySelectProject')" />
    </div>
    <div v-else-if="!gitStatus?.isRepo" class="vcs-init-wrap">
      <el-card class="vcs-init-card" shadow="never">
        <div class="vcs-init-body">
          <el-icon class="vcs-init-icon"><FolderOpened /></el-icon>
          <h3>{{ t('vcs.initTitle') }}</h3>
          <p>
            {{ t('vcs.initBodyLead') }}<code>.git</code>{{ t('vcs.initBodyTail') }}
          </p>
          <el-button
            type="primary"
            :icon="Plus"
            :loading="vcsStore.initializing"
            @click="doInitRepo"
          >
            {{ t('vcs.initButton') }}
          </el-button>
        </div>
      </el-card>
    </div>

    <template v-else>
      <!-- 仓库状态卡片 -->
      <el-card class="vcs-status-card" shadow="never">
        <div class="vcs-status-grid">
          <div class="vcs-status-item">
            <span class="vcs-status-label">{{ t('vcs.currentBranch') }}</span>
            <el-dropdown trigger="click" @command="onBranchCommand">
              <el-tag type="primary" size="large" effect="dark">
                {{ gitStatus.branch }}
                <el-icon class="el-icon--right"><arrow-down /></el-icon>
              </el-tag>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="b in branches" :key="b.name" :command="b.name">
                    <span :style="{ color: b.current ? '#409eff' : '' }">{{ b.current ? '● ' : '' }}{{ b.name }}</span>
                    <span v-if="b.upstream" style="color: #909399; margin-left: 8px">{{ b.upstream }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item divided command="__create__">{{ t('vcs.createBranch') }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <div class="vcs-status-item">
            <span class="vcs-status-label">{{ t('vcs.totalCommits') }}</span>
            <span class="vcs-status-value">{{ gitStatus.totalCommits }}</span>
          </div>
          <div class="vcs-status-item">
            <span class="vcs-status-label">{{ t('vcs.workspace') }}</span>
            <el-tag :type="gitStatus.clean ? 'success' : 'warning'" size="large">
              {{ gitStatus.clean ? t('vcs.workspaceClean') : t('vcs.workspaceDirty') }}
            </el-tag>
          </div>
          <div class="vcs-status-item">
            <span class="vcs-status-label">{{ t('vcs.staged') }}</span>
            <span class="vcs-status-value" :class="{ 'vcs-value-warn': gitStatus.staged > 0 }">
              {{ gitStatus.staged }}
            </span>
          </div>
          <div class="vcs-status-item">
            <span class="vcs-status-label">{{ t('vcs.unstaged') }}</span>
            <span class="vcs-status-value" :class="{ 'vcs-value-warn': gitStatus.modified > 0 }">
              {{ gitStatus.modified }}
            </span>
          </div>
          <div class="vcs-status-item">
            <span class="vcs-status-label">{{ t('vcs.untracked') }}</span>
            <span class="vcs-status-value" :class="{ 'vcs-value-warn': gitStatus.untracked > 0 }">
              {{ gitStatus.untracked }}
            </span>
          </div>
        </div>
      </el-card>

      <el-tabs v-model="activeTab" class="vcs-tabs">
        <!-- Tab 1: 变更管理 -->
        <el-tab-pane :label="totalChanges > 0 ? t('vcs.tabChangesCount', { n: totalChanges }) : t('vcs.tabChanges')" name="changes">
          <div v-if="!statusDetail || totalChanges === 0" class="vcs-empty">
            <el-empty :description="t('vcs.emptyClean')" />
          </div>
          <div v-else class="vcs-changes">
            <!-- 暂存区 -->
            <el-card v-if="statusDetail.staged.length" class="vcs-change-group" shadow="never">
              <template #header>
                <div class="vcs-change-group-head">
                  <span>{{ t('vcs.staged') }} <el-tag size="small" type="success">{{ statusDetail.staged.length }}</el-tag></span>
                  <div>
                    <el-button size="small" @click="unstageAll">{{ t('vcs.unstageAll') }}</el-button>
                    <el-button size="small" type="primary" :icon="Check" @click="openCommit">{{ t('vcs.commit') }}</el-button>
                  </div>
                </div>
              </template>
              <div class="vcs-change-list">
                <div v-for="f in statusDetail.staged" :key="'s-' + f.path" class="vcs-change-row">
                  <el-tag size="small" type="success" effect="plain">{{ statusLabel(f.status) }}</el-tag>
                  <span class="vcs-change-path" @click="showDiff(f.path, true)">{{ f.path }}</span>
                  <el-button size="small" text @click="unstageFile(f.path)">{{ t('vcs.unstage') }}</el-button>
                </div>
              </div>
            </el-card>

            <!-- 未暂存 -->
            <el-card v-if="statusDetail.modified.length" class="vcs-change-group" shadow="never">
              <template #header>
                <div class="vcs-change-group-head">
                  <span>{{ t('vcs.modifiedGroup') }} <el-tag size="small" type="warning">{{ statusDetail.modified.length }}</el-tag></span>
                  <el-button size="small" type="primary" @click="stageAllModified">{{ t('vcs.stageAll') }}</el-button>
                </div>
              </template>
              <div class="vcs-change-list">
                <div v-for="f in statusDetail.modified" :key="'m-' + f.path" class="vcs-change-row">
                  <el-tag size="small" type="warning" effect="plain">{{ statusLabel(f.status) }}</el-tag>
                  <span class="vcs-change-path" @click="showDiff(f.path, false)">{{ f.path }}</span>
                  <el-button size="small" text type="primary" @click="stageFile(f.path)">{{ t('vcs.stage') }}</el-button>
                </div>
              </div>
            </el-card>

            <!-- 未跟踪 -->
            <el-card v-if="statusDetail.untracked.length" class="vcs-change-group" shadow="never">
              <template #header>
                <div class="vcs-change-group-head">
                  <span>{{ t('vcs.untracked') }} <el-tag size="small" type="info">{{ statusDetail.untracked.length }}</el-tag></span>
                  <el-button size="small" type="primary" @click="stageAllUntracked">{{ t('vcs.stageAll') }}</el-button>
                </div>
              </template>
              <div class="vcs-change-list">
                <div v-for="f in statusDetail.untracked" :key="'u-' + f.path" class="vcs-change-row">
                  <el-tag size="small" type="info" effect="plain">{{ t('vcs.tagNew') }}</el-tag>
                  <span class="vcs-change-path">{{ f.path }}</span>
                  <el-button size="small" text type="primary" @click="stageFile(f.path)">{{ t('vcs.stage') }}</el-button>
                </div>
              </div>
            </el-card>

            <div class="vcs-changes-actions">
              <el-button type="primary" :icon="Plus" @click="stageAll">{{ t('vcs.stageAllChanges') }}</el-button>
              <el-button type="success" :icon="Check" :disabled="!statusDetail.staged.length" @click="openCommit">
                {{ t('vcs.commitStaged', { n: statusDetail.staged.length }) }}
              </el-button>
            </div>
          </div>
        </el-tab-pane>

        <!-- Tab 2: 提交历史 -->
        <el-tab-pane :label="t('vcs.tabLog')" name="log">
          <div v-if="!gitLog.length" class="vcs-empty">
            <el-empty :description="t('vcs.emptyLog')" />
          </div>
          <el-table v-else :data="gitLog" class="vcs-log-table" stripe @row-click="onLogRowClick">
            <el-table-column prop="shortHash" :label="t('vcs.colCommit')" width="100">
              <template #default="{ row }">
                <code class="vcs-hash">{{ row.shortHash }}</code>
              </template>
            </el-table-column>
            <el-table-column prop="message" :label="t('vcs.colMessage')" min-width="300" show-overflow-tooltip />
            <el-table-column prop="author" :label="t('vcs.colAuthor')" width="150" show-overflow-tooltip />
            <el-table-column :label="t('vcs.colTime')" width="180">
              <template #default="{ row }">{{ formatDate(row.date) }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- Tab 3: 分支与远程 -->
        <el-tab-pane :label="t('vcs.tabBranches')" name="branches">
          <el-row :gutter="20">
            <el-col :span="12">
              <el-card shadow="never">
                <template #header>
                  <div class="vcs-card-head">
                    <span>{{ t('vcs.localBranches') }}</span>
                    <el-button size="small" type="primary" :icon="Plus" @click="openCreateBranch">{{ t('vcs.newBranch') }}</el-button>
                  </div>
                </template>
                <div v-if="!branches.length" class="vcs-empty">
                  <el-empty :description="t('vcs.emptyBranches')" :image-size="60" />
                </div>
                <div v-else class="vcs-branch-list">
                  <div v-for="b in branches" :key="b.name" class="vcs-branch-row">
                    <div class="vcs-branch-info">
                      <el-tag v-if="b.current" size="small" type="primary" effect="dark">{{ t('vcs.tagCurrent') }}</el-tag>
                      <span class="vcs-branch-name">{{ b.name }}</span>
                      <code class="vcs-branch-hash">{{ b.shortHash }}</code>
                      <el-tag v-if="b.upstream" size="small" effect="plain">{{ b.upstream }}</el-tag>
                    </div>
                    <div v-if="!b.current" class="vcs-branch-actions">
                      <el-button size="small" text type="primary" @click="checkoutBranch(b.name)">{{ t('vcs.checkout') }}</el-button>
                      <el-button size="small" text type="danger" @click="deleteBranch(b.name)">{{ t('vcs.delete') }}</el-button>
                    </div>
                  </div>
                </div>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card shadow="never">
                <template #header>
                  <div class="vcs-card-head">
                    <span>{{ t('vcs.remotes') }}</span>
                    <div class="vcs-card-head-actions">
                      <el-button size="small" :icon="Plus" @click="openAddRemote">{{ t('vcs.addRemote') }}</el-button>
                      <el-button-group>
                        <el-button size="small" :icon="Refresh" @click="fetchRemote">fetch</el-button>
                        <el-button size="small" type="success" @click="pull">pull</el-button>
                        <el-button size="small" type="primary" @click="pushCurrent">push</el-button>
                      </el-button-group>
                    </div>
                  </div>
                </template>
                <div v-if="!remotes.length" class="vcs-empty">
                  <el-empty :description="t('vcs.emptyRemotes')" :image-size="60">
                    <el-button size="small" type="primary" :icon="Plus" @click="openAddRemote">
                      {{ t('vcs.addRemoteButton') }}
                    </el-button>
                  </el-empty>
                </div>
                <div v-else class="vcs-remote-list">
                  <div v-for="r in remotes" :key="r.name" class="vcs-remote-row">
                    <div class="vcs-remote-main">
                      <div class="vcs-remote-name">{{ r.name }}</div>
                      <div class="vcs-remote-url">fetch: {{ r.fetchUrl }}</div>
                      <div class="vcs-remote-url">push: {{ r.pushUrl }}</div>
                    </div>
                    <el-button size="small" text type="danger" @click="doRemoveRemote(r.name)">{{ t('vcs.removeRemote') }}</el-button>
                  </div>
                </div>
              </el-card>
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- Tab 4: Tag -->
        <el-tab-pane :label="tags.length ? t('vcs.tabTagsCount', { n: tags.length }) : t('vcs.tabTags')" name="tags">
          <el-card shadow="never">
            <template #header>
              <div class="vcs-card-head">
                <span>{{ t('vcs.tagListTitle') }}</span>
                <el-button size="small" type="primary" :icon="Plus" @click="openCreateTag">{{ t('vcs.newTag') }}</el-button>
              </div>
            </template>
            <div v-if="!tags.length" class="vcs-empty">
              <el-empty :description="t('vcs.emptyTags')" :image-size="60" />
            </div>
            <el-table v-else :data="tags" stripe>
              <el-table-column prop="name" :label="t('vcs.colTagName')" min-width="200" />
              <el-table-column prop="shortHash" :label="t('vcs.colPointsTo')" width="120">
                <template #default="{ row }"><code>{{ row.shortHash }}</code></template>
              </el-table-column>
              <el-table-column prop="message" :label="t('vcs.colDescription')" min-width="200" show-overflow-tooltip />
            </el-table>
          </el-card>
        </el-tab-pane>

        <!-- Tab 5: 构建产物 -->
        <el-tab-pane :label="t('vcs.tabArtifacts')" name="artifacts">
          <div v-if="!artifacts.length" class="vcs-empty">
            <el-empty :description="t('vcs.emptyArtifacts')" />
          </div>
          <el-table v-else :data="artifacts" stripe>
            <el-table-column label="" width="52" align="center">
              <template #default="{ row }">
                <el-icon :size="18" class="vcs-artifact-icon" :class="`is-${row.kind}`">
                  <component :is="artifactIcon(row.kind)" />
                </el-icon>
              </template>
            </el-table-column>
            <el-table-column :label="t('vcs.colKind')" width="80">
              <template #default="{ row }">
                <el-tag :type="artifactTagType(row.kind)" size="small">{{ row.kind.toUpperCase() }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="name" :label="t('vcs.colFileName')" min-width="250" show-overflow-tooltip />
            <el-table-column :label="t('vcs.colSize')" width="120">
              <template #default="{ row }">{{ formatSize(row.size) }}</template>
            </el-table-column>
            <el-table-column :label="t('vcs.colModified')" width="180">
              <template #default="{ row }">{{ formatDate(row.modifiedAt) }}</template>
            </el-table-column>
            <el-table-column :label="t('vcs.colActions')" width="200">
              <template #default="{ row }">
                <el-button size="small" text type="primary" @click="showInFolder(row.path)">{{ t('vcs.locate') }}</el-button>
                <el-button size="small" text @click="copyPath(row.path)">{{ t('vcs.copyPath') }}</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </template>

    <!-- diff 抽屉 -->
    <el-drawer v-model="diffVisible" :title="diffPath" size="60%">
      <pre v-if="diffContent" class="vcs-diff">{{ diffContent }}</pre>
      <el-empty v-else :description="t('vcs.noDiff')" />
    </el-drawer>

    <!-- commit 弹窗 -->
    <el-dialog v-model="commitVisible" :title="t('vcs.commitDialogTitle')" width="500px">
      <el-input
        v-model="commitMessage"
        type="textarea"
        :rows="5"
        :placeholder="t('vcs.commitPlaceholder')"
        resize="none"
      />
      <template #footer>
        <el-button @click="commitVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="committing" @click="doCommit">{{ t('vcs.commit') }}</el-button>
      </template>
    </el-dialog>

    <!-- 提交详情抽屉 -->
    <el-drawer v-model="detailVisible" size="50%">
      <template #header>
        <span v-if="commitDetail">{{ commitDetail.shortHash }} - {{ commitDetail.message }}</span>
      </template>
      <div v-if="commitDetail" class="vcs-commit-detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item :label="t('vcs.colAuthor')">{{ commitDetail.author }} ({{ commitDetail.email }})</el-descriptions-item>
          <el-descriptions-item :label="t('vcs.colTime')">{{ formatDate(commitDetail.date) }}</el-descriptions-item>
          <el-descriptions-item :label="t('vcs.statInsertions')" :span="1">
            <span style="color: #67c23a">+{{ commitDetail.insertions }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('vcs.statDeletions')" :span="1">
            <span style="color: #f56c6c">-{{ commitDetail.deletions }}</span>
          </el-descriptions-item>
        </el-descriptions>
        <h4>{{ t('vcs.changedFiles', { n: commitDetail.files.length }) }}</h4>
        <el-table :data="commitDetail.files" size="small" stripe>
          <el-table-column prop="path" :label="t('vcs.colFile')" min-width="250" show-overflow-tooltip />
          <el-table-column :label="t('vcs.colAdd')" width="80">
            <template #default="{ row }">
              <span style="color: #67c23a">+{{ row.insertions }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('vcs.colDel')" width="80">
            <template #default="{ row }">
              <span style="color: #f56c6c">-{{ row.deletions }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <!-- 新建分支弹窗 -->
    <el-dialog v-model="branchDialogVisible" :title="t('vcs.branchDialogTitle')" width="400px">
      <el-form label-position="top">
        <el-form-item :label="t('vcs.branchName')">
          <el-input v-model="newBranchName" placeholder="feature/xxx" />
        </el-form-item>
        <el-form-item :label="t('vcs.branchBase')">
          <el-select v-model="newBranchBase" :placeholder="t('vcs.branchBasePlaceholder')" clearable filterable>
            <el-option v-for="b in branches" :key="b.name" :label="b.name" :value="b.name" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="branchDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="doCreateBranch">{{ t('vcs.create') }}</el-button>
      </template>
    </el-dialog>

    <!-- 新建 tag 弹窗 -->
    <el-dialog v-model="tagDialogVisible" :title="t('vcs.tagDialogTitle')" width="400px">
      <el-form label-position="top">
        <el-form-item :label="t('vcs.tagName')">
          <el-input v-model="newTagName" placeholder="v1.0.0" />
        </el-form-item>
        <el-form-item :label="t('vcs.tagMessage')">
          <el-input v-model="newTagMessage" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tagDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="doCreateTag">{{ t('vcs.create') }}</el-button>
      </template>
    </el-dialog>

    <!-- 添加远程仓库弹窗 -->
    <el-dialog v-model="remoteDialogVisible" :title="t('vcs.remoteDialogTitle')" width="480px">
      <el-form label-position="top">
        <el-form-item :label="t('vcs.remoteName')">
          <el-input v-model="newRemoteName" placeholder="origin" />
        </el-form-item>
        <el-form-item :label="t('vcs.remoteUrl')">
          <el-input v-model="newRemoteUrl" placeholder="https://github.com/user/repo.git" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="remoteDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="addingRemote" @click="doAddRemote">{{ t('vcs.addRemote') }}</el-button>
      </template>
    </el-dialog>

    <div v-if="error" class="vcs-error">
      <el-alert type="error" :title="error" closable @close="vcsStore.error = ''" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ArrowDown,
  Box,
  Check,
  Document,
  Files,
  FolderOpened,
  Picture,
  Plus,
  Refresh
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useProjectStore } from '../../stores/project'
import { useVcsStore } from '../../stores/vcs'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const projectStore = useProjectStore()
const vcsStore = useVcsStore()

const activeTab = ref<'changes' | 'log' | 'branches' | 'tags' | 'artifacts'>('changes')
const selectedProjectId = ref<string>('')

// 弹窗状态
const diffVisible = ref(false)
const diffPath = ref('')
const diffContent = ref('')
const commitVisible = ref(false)
const commitMessage = ref('')
const committing = ref(false)
const detailVisible = ref(false)
const branchDialogVisible = ref(false)
const newBranchName = ref('')
const newBranchBase = ref('')
const tagDialogVisible = ref(false)
const newTagName = ref('')
const newTagMessage = ref('')
const remoteDialogVisible = ref(false)
const newRemoteName = ref('origin')
const newRemoteUrl = ref('')
const addingRemote = ref(false)

const currentProject = computed(() => projectStore.currentProject)
const loading = computed(() => vcsStore.loading)
const error = computed(() => vcsStore.error)
const gitLog = computed(() => vcsStore.gitLog)
const gitStatus = computed(() => vcsStore.gitStatus)
const artifacts = computed(() => vcsStore.artifacts)
const statusDetail = computed(() => vcsStore.statusDetail)
const branches = computed(() => vcsStore.branches)
const remotes = computed(() => vcsStore.remotes)
const tags = computed(() => vcsStore.tags)
const commitDetail = computed(() => vcsStore.commitDetail)

const totalChanges = computed(() => {
  const d = statusDetail.value
  if (!d) return 0
  return d.staged.length + d.modified.length + d.untracked.length
})

onMounted(async () => {
  if (currentProject.value) {
    selectedProjectId.value = currentProject.value.id
    await refresh()
  }
})

watch(selectedProjectId, async (id) => {
  if (id) {
    await projectStore.open(id)
    await refresh()
  }
})

function onProjectChange(): void {
  // watch 已处理
}

async function refresh(): Promise<void> {
  const project = projectStore.projects.find((p) => p.id === selectedProjectId.value)
  if (!project) return
  await vcsStore.refresh(project.path)
}

function statusLabel(s: string): string {
  const keyMap: Record<string, string> = { M: 'statusM', A: 'statusA', D: 'statusD', R: 'statusR', '??': 'statusA' }
  const key = keyMap[s]
  return key ? t(`vcs.${key}`) : s
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return bytes + ' B'
}

function artifactTagType(kind: string): 'success' | 'warning' | 'info' {
  if (kind === 'jar') return 'success'
  if (kind === 'zip') return 'warning'
  return 'info'
}

/** 产物文件类型图标：jar（模组产物）/ zip（整合包）/ 图片 / 其它 */
function artifactIcon(kind: string) {
  if (kind === 'jar') return Box
  if (kind === 'zip') return Files
  if (kind === 'png' || kind === 'jpg' || kind === 'image') return Picture
  return Document
}

// ---------- 变更操作 ----------
async function stageFile(path: string): Promise<void> {
  const ok = await vcsStore.stageFile(path)
  if (ok) ElMessage.success(t('vcs.stagedOk'))
  else ElMessage.error(vcsStore.error || t('vcs.stageFailed'))
}

async function unstageFile(path: string): Promise<void> {
  const ok = await vcsStore.unstageFile(path)
  if (ok) ElMessage.success(t('vcs.unstagedOk'))
  else ElMessage.error(vcsStore.error || t('vcs.unstageFailed'))
}

async function stageAllModified(): Promise<void> {
  const d = statusDetail.value
  if (!d) return
  for (const f of d.modified) await vcsStore.stageFile(f.path)
}

async function stageAllUntracked(): Promise<void> {
  const d = statusDetail.value
  if (!d) return
  for (const f of d.untracked) await vcsStore.stageFile(f.path)
}

async function stageAll(): Promise<void> {
  const ok = await vcsStore.stageAll()
  if (ok) ElMessage.success(t('vcs.stagedAllOk'))
  else ElMessage.error(vcsStore.error || t('vcs.stageFailed'))
}

async function unstageAll(): Promise<void> {
  const d = statusDetail.value
  if (!d) return
  for (const f of d.staged) await vcsStore.unstageFile(f.path)
}

function openCommit(): void {
  commitMessage.value = ''
  commitVisible.value = true
}

async function doCommit(): Promise<void> {
  if (!commitMessage.value.trim()) {
    ElMessage.warning(t('vcs.commitEmpty'))
    return
  }
  committing.value = true
  try {
    const r = await vcsStore.commit(commitMessage.value)
    if (r.ok) {
      ElMessage.success(t('vcs.commitOk'))
      commitVisible.value = false
    } else {
      ElMessage.error(r.error || t('vcs.commitFailed'))
    }
  } finally {
    committing.value = false
  }
}

async function showDiff(path: string, staged: boolean): Promise<void> {
  diffPath.value = path
  diffContent.value = await vcsStore.getDiff(path, staged)
  diffVisible.value = true
}

// ---------- 分支 ----------
async function onBranchCommand(cmd: string): Promise<void> {
  if (cmd === '__create__') {
    openCreateBranch()
    return
  }
  const ok = await vcsStore.checkoutBranch(cmd)
  if (ok) ElMessage.success(t('vcs.switchedTo', { name: cmd }))
  else ElMessage.error(vcsStore.error || t('vcs.switchFailed'))
}

function openCreateBranch(): void {
  newBranchName.value = ''
  newBranchBase.value = ''
  branchDialogVisible.value = true
}

async function doCreateBranch(): Promise<void> {
  if (!newBranchName.value.trim()) {
    ElMessage.warning(t('vcs.branchNameEmpty'))
    return
  }
  const ok = await vcsStore.createBranch(newBranchName.value.trim(), newBranchBase.value || undefined)
  if (ok) {
    ElMessage.success(t('vcs.branchCreated'))
    branchDialogVisible.value = false
  } else {
    ElMessage.error(vcsStore.error || t('vcs.createFailed'))
  }
}

async function checkoutBranch(name: string): Promise<void> {
  const ok = await vcsStore.checkoutBranch(name)
  if (ok) ElMessage.success(t('vcs.switchedTo', { name }))
  else ElMessage.error(vcsStore.error || t('vcs.switchFailed'))
}

async function deleteBranch(name: string): Promise<void> {
  const confirmed = await ElMessageBox.confirm(t('vcs.confirmDeleteBranch', { name }), t('vcs.confirmTitle'), { type: 'warning' }).catch(
    () => false
  )
  if (!confirmed) return
  const ok = await vcsStore.deleteBranch(name)
  if (ok) ElMessage.success(t('vcs.deleted'))
  else ElMessage.error(vcsStore.error || t('vcs.deleteFailed'))
}

// ---------- 仓库初始化 ----------
async function doInitRepo(): Promise<void> {
  const r = await vcsStore.initRepo()
  if (r.ok) {
    ElMessage.success(r.detail || t('vcs.repoInitialized'))
    await refresh()
  } else {
    ElMessage.error(r.error || t('vcs.initFailed'))
  }
}

// ---------- 远程 ----------
function openAddRemote(): void {
  newRemoteName.value = remotes.value.length ? '' : 'origin'
  newRemoteUrl.value = ''
  remoteDialogVisible.value = true
}

async function doAddRemote(): Promise<void> {
  if (!newRemoteUrl.value.trim()) {
    ElMessage.warning(t('vcs.remoteUrlEmpty'))
    return
  }
  addingRemote.value = true
  try {
    const r = await vcsStore.addRemote(newRemoteName.value.trim() || 'origin', newRemoteUrl.value.trim())
    if (r.ok) {
      ElMessage.success(r.detail || t('vcs.remoteAdded'))
      remoteDialogVisible.value = false
    } else {
      ElMessage.error(r.error || t('vcs.addRemoteFailed'))
    }
  } finally {
    addingRemote.value = false
  }
}

async function doRemoveRemote(name: string): Promise<void> {
  const confirmed = await ElMessageBox.confirm(t('vcs.confirmRemoveRemote', { name }), t('vcs.confirmTitle'), { type: 'warning' }).catch(
    () => false
  )
  if (!confirmed) return
  const r = await vcsStore.removeRemote(name)
  if (r.ok) ElMessage.success(r.detail || t('vcs.removed'))
  else ElMessage.error(r.error || t('vcs.removeFailed'))
}

async function fetchRemote(): Promise<void> {
  const r = await vcsStore.fetch()
  if (r.ok) ElMessage.success(r.summary || t('vcs.fetchOk'))
  else ElMessage.error(r.error || t('vcs.fetchFailed'))
}

async function pull(): Promise<void> {
  const r = await vcsStore.pull()
  if (r.ok) ElMessage.success(r.summary || t('vcs.pullOk'))
  else ElMessage.error(r.error || t('vcs.pullFailed'))
}

async function pushCurrent(): Promise<void> {
  if (!gitStatus.value) return
  const remote = remotes.value[0]?.name
  if (!remote) {
    ElMessage.warning(t('vcs.noRemote'))
    return
  }
  const hasUpstream = branches.value.find((b) => b.current)?.upstream
  const r = await vcsStore.push(remote, gitStatus.value.branch, !hasUpstream)
  if (r.ok) ElMessage.success(r.summary || t('vcs.pushOk'))
  else ElMessage.error(r.error || t('vcs.pushFailed'))
}

// ---------- log 详情 ----------
async function onLogRowClick(row: { hash: string }): Promise<void> {
  await vcsStore.loadCommitDetail(row.hash)
  detailVisible.value = true
}

// ---------- tag ----------
function openCreateTag(): void {
  newTagName.value = ''
  newTagMessage.value = ''
  tagDialogVisible.value = true
}

async function doCreateTag(): Promise<void> {
  if (!newTagName.value.trim()) {
    ElMessage.warning(t('vcs.tagNameEmpty'))
    return
  }
  const ok = await vcsStore.createTag(newTagName.value.trim(), newTagMessage.value.trim())
  if (ok) {
    ElMessage.success(t('vcs.tagCreated'))
    tagDialogVisible.value = false
  } else {
    ElMessage.error(vcsStore.error || t('vcs.createFailed'))
  }
}

// ---------- 产物 ----------
async function showInFolder(path: string): Promise<void> {
  await window.api.shell.showItemInFolder(path)
}

function copyPath(path: string): void {
  navigator.clipboard.writeText(path).then(
    () => ElMessage.success(t('vcs.pathCopied')),
    () => ElMessage.error(t('vcs.copyFailed'))
  )
}
</script>

<style scoped>
.vcs-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.vcs-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.vcs-project-select {
  width: 300px;
}

.vcs-empty {
  padding: 60px 0;
}

/* 产物类型图标：颜色区分 jar / zip / 图片 / 其它 */
.vcs-artifact-icon {
  vertical-align: middle;
}

.vcs-artifact-icon.is-jar {
  color: var(--el-color-success);
}

.vcs-artifact-icon.is-zip {
  color: var(--el-color-warning);
}

.vcs-artifact-icon.is-png,
.vcs-artifact-icon.is-jpg,
.vcs-artifact-icon.is-image {
  color: var(--el-color-primary);
}

.vcs-artifact-icon.is-other {
  color: var(--el-text-color-secondary);
}

.vcs-status-card {
  margin-bottom: 16px;
}

.vcs-status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
}

.vcs-status-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vcs-status-label {
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
}

.vcs-status-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--ky-text, #303133);
}

.vcs-value-warn {
  color: #e6a23c;
}

.vcs-tabs {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.vcs-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow: auto;
}

.vcs-changes {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.vcs-change-group-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vcs-change-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vcs-change-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--ky-border, #ebeef5);
}

.vcs-change-path {
  flex: 1;
  cursor: pointer;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: var(--ky-text, #303133);
}

.vcs-change-path:hover {
  color: #409eff;
  text-decoration: underline;
}

.vcs-changes-actions {
  display: flex;
  gap: 10px;
  padding: 12px 0;
}

.vcs-log-table {
  flex: 1;
}

.vcs-hash {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  background: var(--ky-code-bg, #f5f7fa);
  padding: 2px 6px;
  border-radius: 3px;
}

.vcs-card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.vcs-card-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vcs-init-wrap {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}

.vcs-init-card {
  max-width: 620px;
  width: 100%;
}

.vcs-init-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 16px 8px;
}

.vcs-init-icon {
  font-size: 44px;
  color: var(--ky-text-dim, #909399);
}

.vcs-init-body h3 {
  margin: 8px 0 0;
  font-size: 16px;
}

.vcs-init-body p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ky-text-dim, #909399);
}

.vcs-init-body code {
  font-family: 'Courier New', monospace;
  background: var(--ky-code-bg, #f5f7fa);
  padding: 1px 4px;
  border-radius: 3px;
}

.vcs-branch-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vcs-branch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 4px;
  border-bottom: 1px solid var(--ky-border, #ebeef5);
}

.vcs-branch-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vcs-branch-name {
  font-weight: 500;
}

.vcs-branch-hash {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
}

.vcs-branch-actions {
  display: flex;
  gap: 4px;
}

.vcs-remote-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vcs-remote-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--ky-card-bg, #fafafa);
  border-radius: 4px;
}

.vcs-remote-main {
  min-width: 0;
}

.vcs-remote-name {
  font-weight: 600;
  margin-bottom: 4px;
}

.vcs-remote-url {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
  word-break: break-all;
}

.vcs-diff {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--ky-code-bg, #f5f7fa);
  padding: 16px;
  border-radius: 4px;
  margin: 0;
}

.vcs-commit-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.vcs-commit-detail h4 {
  margin: 8px 0;
}

.vcs-error {
  margin-top: 16px;
}
</style>
