<template>
  <div class="ext-view">
    <!-- ==================== 左栏：搜索 + 已安装 + 市场列表 ==================== -->
    <aside class="ext-sidebar">
      <div class="ext-sidebar-head">
        <span class="ext-title">{{ t('plugins.title') }}</span>
        <div class="ext-head-actions">
          <el-tooltip :content="t('plugins.refresh')" placement="bottom">
            <el-icon class="ext-head-icon" @click="refreshAll"><Refresh /></el-icon>
          </el-tooltip>
          <el-tooltip :content="t('plugins.addCustomTip')" placement="bottom">
            <el-icon class="ext-head-icon" @click="goToSettings"><Plus /></el-icon>
          </el-tooltip>
        </div>
      </div>

      <div class="ext-search">
        <el-input
          v-model="searchInput"
          :placeholder="t('plugins.searchPlaceholder')"
          clearable
          @keyup.enter="doSearch"
          @clear="doSearch"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
          <template #append>
            <el-button :loading="pluginStore.marketLoading" @click="doSearch">{{ t('plugins.search') }}</el-button>
          </template>
        </el-input>
        <div class="ext-chips">
          <span
            v-for="chip in quickChips"
            :key="chip"
            class="ext-chip"
            @click="quickSearch(chip)"
          >{{ chip }}</span>
        </div>
      </div>

      <div class="ext-list-scroll">
        <!-- 已安装 -->
        <div class="ext-section-label">
          {{ t('plugins.installedSection') }} <span class="ext-count">{{ mcpServers.length }}</span>
        </div>
        <div
          v-for="server in mcpServers"
          :key="server.id"
          :class="['ext-row', { 'is-selected': sel?.kind === 'installed' && sel.id === server.id }]"
          @click="sel = { kind: 'installed', id: server.id }"
        >
          <span class="ext-row-icon">{{ categoryIcon(server.category) }}</span>
          <div class="ext-row-main">
            <div class="ext-row-name">
              <span class="ext-row-name-text">{{ server.name }}</span>
              <el-tag
                v-if="isServerCertified(server)"
                size="small"
                type="success"
                effect="dark"
                round
                class="ext-row-badge"
              >{{ t('plugins.certifiedBadge') }}</el-tag>
            </div>
            <div class="ext-row-desc">{{ server.command }} {{ server.args.join(' ') }}</div>
          </div>
          <el-tag size="small" :type="permissionTagType(server.permission)" effect="plain" class="ext-row-perm">{{ permissionLabel(server.permission) }}</el-tag>
          <!-- 工具权限入口提到列表项（此前藏进详情面板，可发现性差） -->
          <button
            type="button"
            class="ext-row-toolperm"
            :title="t('plugins.toolPermTitle')"
            @click.stop="openToolPermission(server.id)"
          >{{ t('plugins.toolPerm') }}</button>
          <span :class="['mcp-status-dot', runtimeDotClass(server.runtime)]" />
        </div>
        <div v-if="mcpServers.length === 0" class="ext-list-empty">{{ t('plugins.emptyInstalled') }}</div>

        <!-- 市场结果 -->
        <div class="ext-section-label ext-section-market">
          {{ t('plugins.marketSection') }}
          <el-tag
            size="small"
            :type="pluginStore.marketSource === 'official' ? 'success' : 'warning'"
            effect="plain"
            class="ext-source-tag"
          >{{ pluginStore.marketSource === 'official' ? t('plugins.sourceOfficial') : t('plugins.sourceCurated') }}</el-tag>
        </div>
        <div v-if="pluginStore.marketLoading" v-loading="true" class="ext-list-loading" />
        <template v-else>
          <div
            v-for="plugin in pluginStore.marketEntries"
            :key="plugin.id"
            :class="['ext-row', { 'is-selected': sel?.kind === 'market' && sel.id === plugin.id }]"
            @click="sel = { kind: 'market', id: plugin.id }"
          >
            <span class="ext-row-icon">{{ plugin.icon }}</span>
            <div class="ext-row-main">
              <div class="ext-row-name">
                <span class="ext-row-name-text">{{ plugin.name }}</span>
                <el-tag
                  v-if="plugin.certified"
                  size="small"
                  type="success"
                  effect="dark"
                  round
                  class="ext-row-badge"
                >{{ t('plugins.certifiedBadge') }}</el-tag>
                <el-tag
                  v-else-if="pluginStore.isInstalled(plugin)"
                  size="small"
                  type="info"
                  effect="plain"
                  round
                  class="ext-row-badge"
                >{{ t('plugins.installedBadge') }}</el-tag>
              </div>
              <div class="ext-row-desc">{{ plugin.description || t('plugins.noDesc') }}</div>
            </div>
          </div>
          <div v-if="pluginStore.marketEntries.length === 0" class="ext-list-empty">
            {{ t('plugins.emptyMarket') }}
          </div>
          <div v-if="pluginStore.hasMoreMarket" class="ext-loadmore">
            <el-button size="small" plain :loading="pluginStore.marketLoadingMore" @click="pluginStore.loadMoreMarket()">
              {{ t('plugins.loadMore') }}
            </el-button>
          </div>
        </template>
      </div>
    </aside>

    <!-- ==================== 右栏：详情 ==================== -->
    <section class="ext-detail">
      <!-- 已安装详情 -->
      <template v-if="detailInstalled">
        <div class="ext-detail-scroll">
          <div class="ext-detail-header">
            <div class="ext-detail-icon">{{ categoryIcon(detailInstalled.category) }}</div>
            <div class="ext-detail-title-wrap">
              <div class="ext-detail-title-row">
                <h2 class="ext-detail-title">{{ detailInstalled.name }}</h2>
                <el-tag
                  v-if="isServerCertified(detailInstalled)"
                  type="success"
                  effect="dark"
                  round
                >{{ t('plugins.certifiedOfficial') }}</el-tag>
                <el-tag size="small" :type="categoryTagType(detailInstalled.category)" effect="plain">
                  {{ categoryLabel(detailInstalled.category) }}
                </el-tag>
                <el-tag size="small" :type="permissionTagType(detailInstalled.permission)" effect="plain">
                  {{ permissionLabel(detailInstalled.permission) }}
                </el-tag>
              </div>
              <code class="ext-detail-subtitle">{{ detailInstalled.command }} {{ detailInstalled.args.join(' ') }}</code>
            </div>
          </div>

          <div class="ext-detail-actions">
            <el-switch
              :model-value="detailInstalled.enabled"
              @change="(v) => toggleMcp(detailInstalled!.id, Boolean(v))"
              :active-text="t('plugins.enable')"
            />
            <el-button size="small" :loading="testing[detailInstalled.id]" @click="testMcp(detailInstalled)">
              {{ t('plugins.testConnection') }}
            </el-button>
            <el-button size="small" @click="goToSettings">{{ t('plugins.edit') }}</el-button>
            <el-button size="small" type="danger" plain @click="removeMcp(detailInstalled)">{{ t('plugins.uninstall') }}</el-button>
          </div>

          <div v-if="detailInstalled.runtime" class="ext-runtime-panel">
            <span :class="['mcp-status-dot', runtimeDotClass(detailInstalled.runtime)]" />
            <span class="ext-runtime-text">{{ runtimeStatusText(detailInstalled.runtime) }}</span>
            <el-tag v-if="detailInstalled.runtime.connected" size="small" type="success" effect="plain">
              {{ t('plugins.toolCount', { n: detailInstalled.runtime.toolCount }) }}
            </el-tag>
            <div v-if="detailInstalled.runtime.error" class="ext-runtime-error">
              {{ detailInstalled.runtime.error }}
            </div>
          </div>
          <div v-if="testResult[detailInstalled.id]" class="ext-runtime-panel">
            <el-alert
              :type="testResult[detailInstalled.id].ok ? 'success' : 'error'"
              :closable="false"
            >
              <template v-if="testResult[detailInstalled.id].ok">
                {{ t('plugins.testOk', { n: testResult[detailInstalled.id].toolCount }) }}
              </template>
              <template v-else>✗ {{ testResult[detailInstalled.id].error }}</template>
            </el-alert>
          </div>

          <div class="ext-detail-grid">
            <div class="ext-detail-main">
              <h3 class="ext-section-h3">{{ t('plugins.securityBoundary') }}</h3>
              <el-alert :type="detailInstalled.permission === 'read' ? 'success' : 'warning'" :closable="false">
                <template #title>
                  {{ t('plugins.securityTitle', { label: permissionLabel(detailInstalled.permission), boundary: permissionBoundary(detailInstalled.permission) }) }}
                </template>
                <div class="ext-sandbox-line">{{ t('plugins.sandboxLine') }}</div>
              </el-alert>

              <h3 id="ext-tool-permission" class="ext-section-h3">{{ t('plugins.toolPerm') }}</h3>
              <div class="ext-toolfilter">
                <el-radio-group v-model="toolFilterMode" size="small">
                  <el-radio-button value="all">{{ t('plugins.modeAll') }}</el-radio-button>
                  <el-radio-button value="allowlist">{{ t('plugins.modeAllowlist') }}</el-radio-button>
                  <el-radio-button value="blocklist">{{ t('plugins.modeBlocklist') }}</el-radio-button>
                </el-radio-group>
                <div class="ext-toolfilter-hint">
                  {{ toolFilterMode === 'all'
                    ? t('plugins.hintAll')
                    : toolFilterMode === 'allowlist'
                      ? t('plugins.hintAllowlist')
                      : t('plugins.hintBlocklist') }}
                </div>
                <template v-if="toolFilterMode !== 'all'">
                  <el-checkbox-group
                    v-if="availableTools.length > 0"
                    v-model="toolFilterChecked"
                    class="ext-toolfilter-list"
                  >
                    <el-checkbox
                      v-for="tool in availableTools"
                      :key="tool"
                      :value="tool"
                      class="ext-toolfilter-item"
                    >{{ tool }}</el-checkbox>
                  </el-checkbox-group>
                  <div v-else class="ext-toolfilter-empty">
                    {{ detailInstalled.runtime?.connected ? t('plugins.noToolsExposed') : t('plugins.notConnected') }}
                  </div>
                </template>
                <div class="ext-toolfilter-actions">
                  <el-button
                    size="small"
                    type="primary"
                    :disabled="!toolFilterDirty"
                    :loading="toolFilterSaving"
                    @click="saveToolFilter"
                  >{{ t('plugins.saveToolPerm') }}</el-button>
                  <span v-if="toolFilterDirty" class="ext-toolfilter-unsaved">{{ t('plugins.unsavedChanges') }}</span>
                </div>
              </div>
            </div>
            <div class="ext-detail-aside">
              <h3 class="ext-section-h3">{{ t('plugins.metaInfo') }}</h3>
              <dl class="ext-meta">
                <dt>{{ t('plugins.identifier') }}</dt><dd>{{ identifierOfServer(detailInstalled) || '—' }}</dd>
                <dt>{{ t('plugins.category') }}</dt><dd>{{ categoryLabel(detailInstalled.category) }}</dd>
                <dt>{{ t('plugins.permission') }}</dt><dd>{{ permissionLabel(detailInstalled.permission) }}</dd>
                <dt>{{ t('plugins.timeout') }}</dt><dd>{{ detailInstalled.timeoutMs / 1000 }}s</dd>
                <dt>{{ t('plugins.envVars') }}</dt><dd>{{ Object.keys(detailInstalled.env).length ? Object.keys(detailInstalled.env).join(t('plugins.listSep')) : t('plugins.none') }}</dd>
              </dl>
            </div>
          </div>
        </div>
      </template>

      <!-- 市场详情 -->
      <template v-else-if="detailMarket">
        <div class="ext-detail-scroll">
          <div class="ext-detail-header">
            <div class="ext-detail-icon ext-detail-icon-lg">{{ detailMarket.icon }}</div>
            <div class="ext-detail-title-wrap">
              <div class="ext-detail-title-row">
                <h2 class="ext-detail-title">{{ detailMarket.name }}</h2>
                <el-tag v-if="detailMarket.certified" type="success" effect="dark" round>{{ t('plugins.certifiedOfficial') }}</el-tag>
                <el-tag
                  v-else
                  size="small"
                  type="warning"
                  effect="plain"
                  round
                >{{ t('plugins.uncertified') }}</el-tag>
              </div>
              <div class="ext-detail-publisher">
                {{ detailMarket.author || t('plugins.communityAuthor') }} · {{ detailMarket.version }} ·
                {{ detailMarket.source === 'official' ? t('plugins.sourceOfficialFull') : t('plugins.sourceCuratedFull') }}
              </div>
            </div>
          </div>

          <div class="ext-detail-actions">
            <el-tag size="small" :type="categoryTagType(detailMarket.category)" effect="plain">
              {{ categoryLabel(detailMarket.category) }}
            </el-tag>
            <el-tag size="small" :type="permissionTagType(detailMarket.permission)" effect="plain">
              {{ permissionLabel(detailMarket.permission) }}
            </el-tag>
            <el-tag size="small" type="info" effect="plain">{{ detailMarket.runtime }}</el-tag>
            <span class="ext-actions-spacer" />
            <el-button
              v-if="detailMarket.homepage || detailMarket.repoUrl"
              size="small"
              text
              @click="openLink(detailMarket.homepage || detailMarket.repoUrl!)"
            >{{ t('plugins.homeRepo') }}</el-button>
            <el-button
              v-if="pluginStore.isInstalled(detailMarket)"
              size="small"
              type="success"
              plain
              disabled
            >{{ t('plugins.installedBtn') }}</el-button>
            <el-button
              v-else
              size="small"
              type="primary"
              :loading="pluginStore.installingIds.has(detailMarket.id)"
              @click="clickInstall(detailMarket)"
            >{{ t('plugins.install') }}</el-button>
          </div>

          <el-alert
            :title="detailMarket.certified ? t('plugins.certAlertTitle') : t('plugins.uncertAlertTitle')"
            :type="detailMarket.certified ? 'success' : 'error'"
            :closable="false"
            show-icon
            class="ext-security-alert"
          >
            <div v-if="!detailMarket.certified" class="ext-security-body">
              <p>{{ t('plugins.uncertP1a') }}<b>{{ detailMarket.runtime }}</b>{{ t('plugins.uncertP1b') }}<b>{{ t('plugins.uncertP1Bold') }}</b>{{ t('plugins.uncertP1c') }}</p>
              <p class="ext-security-boundary">{{ t('plugins.permBoundaryLead') }}<b>{{ permissionLabel(detailMarket.permission) }}</b>{{ t('plugins.permBoundaryMid') }}{{ permissionBoundary(detailMarket.permission) }}{{ t('plugins.uncertSandboxTail') }}</p>
            </div>
            <div v-else class="ext-security-body">
              <p>{{ t('plugins.certBodyLead') }}<b>{{ permissionLabel(detailMarket.permission) }}</b>{{ t('plugins.certBodyTail') }}</p>
            </div>
          </el-alert>

          <div class="ext-detail-grid">
            <div class="ext-detail-main">
              <h3 class="ext-section-h3">{{ t('plugins.detailsSection') }}</h3>
              <p class="ext-detail-desc">{{ detailMarket.description || t('plugins.noDesc') }}</p>

              <h3 class="ext-section-h3">{{ t('plugins.installCmdSection') }}</h3>
              <div class="ext-code-wrap">
                <code class="ext-code">{{ installCommand(detailMarket) }}</code>
              </div>
              <div class="ext-code-note">{{ t('plugins.firstRunNote', { runtime: detailMarket.runtime }) }}</div>

              <template v-if="detailMarket.envRequirements.length > 0">
                <h3 class="ext-section-h3">{{ t('plugins.envRequiredSection', { n: detailMarket.envRequirements.length }) }}</h3>
                <div
                  v-for="req in detailMarket.envRequirements"
                  :key="req.name"
                  class="ext-env-row"
                >
                  <span class="ext-env-name">{{ req.name }}</span>
                  <el-tag size="small" :type="req.required ? 'danger' : 'info'" effect="plain">
                    {{ req.required ? t('plugins.required') : t('plugins.optional') }}
                  </el-tag>
                  <el-tag v-if="req.secret" size="small" type="warning" effect="plain">{{ t('plugins.secret') }}</el-tag>
                  <span class="ext-env-desc">{{ req.description }}</span>
                </div>
              </template>
            </div>

            <div class="ext-detail-aside">
              <h3 class="ext-section-h3">{{ t('plugins.installInfoSection') }}</h3>
              <dl class="ext-meta">
                <dt>{{ t('plugins.identifier') }}</dt><dd class="ext-meta-break">{{ detailMarket.identifier }}</dd>
                <dt>{{ t('plugins.version') }}</dt><dd>{{ detailMarket.version }}</dd>
                <dt>{{ t('plugins.source') }}</dt><dd>{{ detailMarket.source === 'official' ? t('plugins.sourceOfficial') : t('plugins.sourceCurated') }}</dd>
                <dt>{{ t('plugins.author') }}</dt><dd>{{ detailMarket.author || t('plugins.communityAuthor') }}</dd>
                <dt>{{ t('plugins.permission') }}</dt><dd>
                  <el-tag size="small" :type="permissionTagType(detailMarket.permission)" effect="plain">
                    {{ permissionLabel(detailMarket.permission) }}
                  </el-tag>
                </dd>
                <dt>{{ t('plugins.category') }}</dt><dd>{{ categoryLabel(detailMarket.category) }}</dd>
                <dt>{{ t('plugins.workDir') }}</dt><dd>{{ t('plugins.workDirValue') }}</dd>
              </dl>
              <div v-if="detailMarket.repoUrl || detailMarket.homepage" class="ext-res-links">
                <h3 class="ext-section-h3">{{ t('plugins.resourcesSection') }}</h3>
                <el-link
                  v-if="detailMarket.repoUrl"
                  type="primary"
                  :underline="false"
                  @click="openLink(detailMarket.repoUrl!)"
                >{{ t('plugins.repoLink') }}</el-link>
                <el-link
                  v-if="detailMarket.homepage"
                  type="primary"
                  :underline="false"
                  @click="openLink(detailMarket.homepage!)"
                >{{ t('plugins.homeLink') }}</el-link>
              </div>
            </div>
          </div>
        </div>
      </template>

      <el-empty v-else class="ext-detail-empty" :description="t('plugins.emptyDetail')" />
    </section>

    <!-- 环境变量配置弹窗 -->
    <el-dialog v-model="envDialogVisible" :title="t('plugins.envDialogTitle')" width="520px" :close-on-click-modal="false">
      <div v-if="envTarget" class="env-dialog">
        <div class="env-dialog-plugin">
          <span class="env-dialog-icon">{{ envTarget.icon }}</span>
          <div>
            <div class="env-dialog-name">
              {{ envTarget.name }}
              <el-tag v-if="envTarget.certified" size="small" type="success" effect="dark" round>{{ t('plugins.certifiedBadge') }}</el-tag>
            </div>
            <code class="env-dialog-cmd">{{ installCommand(envTarget) }}</code>
          </div>
        </div>
        <el-alert type="info" :closable="false" class="env-dialog-hint">
          {{ t('plugins.envDialogHint') }}
        </el-alert>
        <el-form label-position="top" class="env-form">
          <el-form-item
            v-for="req in envTarget.envRequirements"
            :key="req.name"
            :label="`${req.name}${req.required ? t('plugins.requiredSuffix') : t('plugins.optionalSuffix')}`"
          >
            <el-input
              v-model="envValues[req.name]"
              :type="req.secret ? 'password' : 'text'"
              show-password
              :placeholder="req.description || req.name"
            />
            <div v-if="req.description" class="env-desc">{{ req.description }}</div>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="envDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="envInstalling" @click="confirmInstall">{{ t('plugins.install') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, h, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { usePluginStore } from '../../stores/plugin'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import { useI18n } from '../../i18n'
import { identifierFromArgs, isCertifiedIdentifier } from '../../../../shared/mcpTrust'
import type { McpToolFilter, McpToolFilterMode } from '../../../../shared/mcpToolFilter'
import type { CustomMcpServer } from '../../../../shared/types/settings'
import type { MarketPlugin, McpRuntimeStatus } from '../../../../shared/types/plugin'

const pluginStore = usePluginStore()
const settingsStore = useSettingsStore()
const uiStore = useUiStore()
const { t } = useI18n()

const testing = ref<Record<string, boolean>>({})
const testResult = ref<Record<string, { ok: boolean; toolCount: number; error?: string }>>({})

const mcpServers = computed(() => pluginStore.mcpServers)

const searchInput = ref('')
const quickChips = ['minecraft', 'filesystem', 'github', 'browser', 'memory', 'thinking']

// 左栏选中项
const sel = ref<{ kind: 'installed' | 'market'; id: string } | null>(null)

/** 列表项直达工具权限——选中该 server 并把详情面板滚动到权限编辑区 */
async function openToolPermission(id: string): Promise<void> {
  sel.value = { kind: 'installed', id }
  await nextTick()
  document.getElementById('ext-tool-permission')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const detailInstalled = computed(() =>
  sel.value?.kind === 'installed' ? mcpServers.value.find((s) => s.id === sel.value!.id) ?? null : null
)
const detailMarket = computed(() =>
  sel.value?.kind === 'market'
    ? pluginStore.marketEntries.find((p) => p.id === sel.value!.id) ?? null
    : null
)

// env 配置弹窗
const envDialogVisible = ref(false)
const envTarget = ref<MarketPlugin | null>(null)
const envValues = ref<Record<string, string>>({})
const envInstalling = ref(false)

// 工具权限编辑状态（M19）：跟随当前选中的已安装 server
const toolFilterMode = ref<McpToolFilterMode>('all')
const toolFilterChecked = ref<string[]>([])
const toolFilterSaving = ref(false)

/** 当前选中 server 的完整工具名列表（已连接时来自运行时；未连接为空） */
const availableTools = computed<string[]>(() => detailInstalled.value?.runtime?.tools ?? [])

/** 是否有未保存的工具权限修改 */
const toolFilterDirty = computed(() => {
  const s = detailInstalled.value
  if (!s) return false
  const cur: McpToolFilter = s.toolFilter ?? { mode: 'all', tools: [] }
  if (toolFilterMode.value !== cur.mode) return true
  if (toolFilterMode.value === 'all') return false
  const a = [...toolFilterChecked.value].sort()
  const b = [...cur.tools].sort()
  return a.length !== b.length || a.some((v, i) => v !== b[i])
})

// 切换选中项时把编辑态重置为该 server 的持久化值
watch(
  () => detailInstalled.value?.id,
  () => {
    const s = detailInstalled.value
    toolFilterMode.value = s?.toolFilter?.mode ?? 'all'
    toolFilterChecked.value = s?.toolFilter ? [...s.toolFilter.tools] : []
  },
  { immediate: true }
)

/** 保存工具权限：整组替换 customMcpServers 中对应项的 toolFilter */
async function saveToolFilter(): Promise<void> {
  const s = detailInstalled.value
  if (!s) return
  const filter: McpToolFilter =
    toolFilterMode.value === 'all'
      ? { mode: 'all', tools: [] }
      : { mode: toolFilterMode.value, tools: [...toolFilterChecked.value] }
  toolFilterSaving.value = true
  try {
    const list = settingsStore.ai.customMcpServers.map((srv) =>
      srv.id === s.id ? { ...srv, toolFilter: filter } : srv
    )
    await settingsStore.update({ ai: { customMcpServers: list } })
    await pluginStore.loadMcpServers()
    ElMessage.success(t('plugins.toolPermSaved'))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : t('plugins.saveFailed'))
  } finally {
    toolFilterSaving.value = false
  }
}

onMounted(async () => {
  await pluginStore.loadMcpServers()
  await pluginStore.searchMarket('minecraft')
})

// 市场结果首次到达时自动选第一个
watch(
  () => pluginStore.marketEntries[0]?.id,
  (firstId) => {
    if (firstId && (!sel.value || (sel.value.kind === 'market' && !detailMarket.value))) {
      sel.value = { kind: 'market', id: firstId }
    }
  }
)

function categoryLabel(cat: CustomMcpServer['category']): string {
  const keyMap = { texture: 'plugins.catTexture', code: 'plugins.catCode', 'game-control': 'plugins.catGameControl', general: 'plugins.catGeneral' } as const
  return t(keyMap[cat])
}

function categoryTagType(cat: CustomMcpServer['category']): 'success' | 'warning' | 'info' | 'primary' {
  const map = { texture: 'success', code: 'primary', 'game-control': 'warning', general: 'info' }
  return map[cat] as 'success' | 'warning' | 'info' | 'primary'
}

function categoryIcon(cat: CustomMcpServer['category']): string {
  const map = { texture: '🎨', code: '📊', 'game-control': '🎮', general: '🧩' }
  return map[cat]
}

function permissionLabel(perm: CustomMcpServer['permission']): string {
  const keyMap = { read: 'plugins.permRead', interact: 'plugins.permInteract', admin: 'plugins.permAdmin' } as const
  return t(keyMap[perm])
}

function permissionTagType(perm: CustomMcpServer['permission']): 'success' | 'warning' | 'danger' {
  const map = { read: 'success', interact: 'warning', admin: 'danger' }
  return map[perm] as 'success' | 'warning' | 'danger'
}

function permissionBoundary(perm: CustomMcpServer['permission']): string {
  const keyMap = {
    read: 'plugins.boundaryRead',
    interact: 'plugins.boundaryInteract',
    admin: 'plugins.boundaryAdmin'
  } as const
  return t(keyMap[perm])
}

function runtimeDotClass(runtime?: McpRuntimeStatus): string {
  if (!runtime) return 'is-idle'
  if (runtime.connected) return 'is-ok'
  if (runtime.status === 'connecting') return 'is-busy'
  if (runtime.error || runtime.status === 'error') return 'is-fail'
  return 'is-idle'
}

function runtimeStatusText(runtime: McpRuntimeStatus): string {
  if (runtime.connected) return t('plugins.statusConnected')
  if (runtime.status === 'connecting') return t('plugins.statusConnecting')
  if (runtime.error || runtime.status === 'error') return t('plugins.statusFailed')
  return t('plugins.statusDisconnected')
}

function identifierOfServer(server: CustomMcpServer): string {
  return identifierFromArgs(server.args)
}

function isServerCertified(server: CustomMcpServer): boolean {
  const id = identifierOfServer(server)
  return Boolean(id) && isCertifiedIdentifier(id)
}

/** 市场插件的启动命令预览 */
function installCommand(plugin: MarketPlugin): string {
  const args = plugin.fullArgs
    ? plugin.fullArgs
    : plugin.runtime === 'npx'
      ? ['-y', plugin.identifier, ...plugin.packageArgs, ...(plugin.extraArgs ?? [])]
      : [plugin.identifier, ...plugin.packageArgs]
  return `${plugin.runtime} ${args.join(' ')}`
}

async function doSearch(): Promise<void> {
  await pluginStore.searchMarket(searchInput.value)
}

function quickSearch(kw: string): void {
  searchInput.value = kw
  void doSearch()
}

async function refreshAll(): Promise<void> {
  await Promise.all([pluginStore.loadMcpServers(), doSearch()])
}

async function toggleMcp(id: string, enabled: boolean): Promise<void> {
  const ok = await pluginStore.toggleMcp(id, enabled)
  if (ok) {
    ElMessage.success(enabled ? t('plugins.enabled') : t('plugins.disabled'))
  } else {
    ElMessage.error(pluginStore.error || t('plugins.opFailed'))
  }
}

async function testMcp(server: CustomMcpServer): Promise<void> {
  testing.value[server.id] = true
  try {
    const result = await pluginStore.testMcp(server)
    testResult.value[server.id] = result
  } finally {
    testing.value[server.id] = false
  }
}

async function removeMcp(server: CustomMcpServer): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    t('plugins.uninstallConfirm', { name: server.name }),
    t('plugins.uninstallTitle'),
    { type: 'warning' }
  ).catch(() => false)
  if (!confirmed) return

  const ai = settingsStore.ai
  const list = ai.customMcpServers.filter((s) => s.id !== server.id)
  await settingsStore.update({ ai: { customMcpServers: list } })
  await pluginStore.loadMcpServers()
  if (sel.value?.kind === 'installed' && sel.value.id === server.id) sel.value = null
  ElMessage.success(t('plugins.uninstalled'))
}

/**
 * 点击安装：先过第三方安全确认（认证插件轻提示，未认证强警告），
 * 需要 env 的再弹配置弹窗，否则直接安装。
 */
function clickInstall(plugin: MarketPlugin): void {
  void securityConfirm(plugin).then((ok) => {
    if (!ok) return
    if (plugin.envRequirements.length === 0) {
      void runInstall(plugin, {})
      return
    }
    envTarget.value = plugin
    envValues.value = Object.fromEntries(
      plugin.envRequirements.map((r) => [r.name, r.default ?? ''])
    )
    envDialogVisible.value = true
  })
}

/** 安装前安全确认（所有插件必经；未认证第三方为强警告样式） */
async function securityConfirm(plugin: MarketPlugin): Promise<boolean> {
  const rows: Array<[string, string]> = [
    [t('plugins.rowPlugin'), plugin.name],
    [t('plugins.identifier'), plugin.identifier],
    [t('plugins.version'), plugin.version],
    [t('plugins.source'), plugin.source === 'official' ? t('plugins.sourceOfficialCommunity') : t('plugins.sourceCuratedFull')],
    [t('plugins.permission'), `${permissionLabel(plugin.permission)} — ${permissionBoundary(plugin.permission)}`],
    [t('plugins.rowCommand'), installCommand(plugin)]
  ]
  const body = h('div', { class: 'ext-install-confirm' }, [
    h(
      'p',
      { class: 'ext-install-lead' },
      plugin.certified
        ? t('plugins.confirmLeadCert')
        : t('plugins.confirmLeadUncert')
    ),
    h(
      'table',
      { class: 'ext-install-table' },
      rows.map(([k, v]) =>
        h('tr', [h('th', k), h('td', v)])
      )
    ),
    h('p', { class: 'ext-install-sandbox' },
      t('plugins.confirmSandbox'))
  ])
  try {
    await ElMessageBox({
      title: plugin.certified ? t('plugins.confirmTitleCert') : t('plugins.confirmTitleUncert'),
      message: body,
      type: plugin.certified ? 'info' : 'warning',
      confirmButtonText: plugin.certified ? t('plugins.confirmBtnCert') : t('plugins.confirmBtnUncert'),
      cancelButtonText: t('common.cancel'),
      confirmButtonClass: plugin.certified ? '' : 'el-button--danger',
      showCancelButton: true,
      closeOnClickModal: false,
      customClass: 'ext-install-messagebox'
    })
    return true
  } catch {
    return false
  }
}

async function confirmInstall(): Promise<void> {
  if (!envTarget.value) return
  const missing = envTarget.value.envRequirements
    .filter((r) => r.required && !(envValues.value[r.name] ?? '').trim())
    .map((r) => r.name)
  if (missing.length > 0) {
    ElMessage.warning(t('plugins.missingRequired', { list: missing.join(t('plugins.listSep')) }))
    return
  }
  const plugin = envTarget.value
  const values = { ...envValues.value }
  envInstalling.value = true
  try {
    envDialogVisible.value = false
    await runInstall(plugin, values)
  } finally {
    envInstalling.value = false
  }
}

async function runInstall(plugin: MarketPlugin, envValues: Record<string, string>): Promise<void> {
  // 首次安装 npx 会下载包，给出明确提示
  const loading = ElMessage({
    message: t('plugins.installing', { name: plugin.name, runtime: plugin.runtime }),
    type: 'info',
    duration: 0
  })
  try {
    const result = await pluginStore.installFromMarket(plugin, envValues)
    loading.close()
    if (result.ok) {
      // 新装插件默认工具全禁（allowlist 空表），提示用户到「工具权限」逐项放行
      const tip = t('plugins.installTip')
      if (typeof result.toolCount === 'number') {
        ElMessage.success(t('plugins.installOkTools', { n: result.toolCount, tip }))
      } else {
        ElMessage.success(t('plugins.installOkBg', { tip }))
      }
    } else {
      ElMessage.error(result.error || t('plugins.installFailed'))
    }
  } catch (err) {
    loading.close()
    ElMessage.error(err instanceof Error ? err.message : t('plugins.installFailed'))
  }
}

function openLink(url: string): void {
  void window.api?.shell?.openExternal?.(url)
}

function goToSettings(): void {
  uiStore.setActiveModule('settings', { rememberForSettings: true })
}
</script>

<style scoped>
.ext-view {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--ky-bg-base);
}

/* ---------------- 左栏 ---------------- */
.ext-sidebar {
  width: 320px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--ky-border, #2a2a38);
  background: var(--ky-bg-panel);
}

.ext-sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
}

.ext-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--ky-text, #e6e6f0);
}

.ext-head-actions {
  display: flex;
  gap: 10px;
}

.ext-head-icon {
  font-size: 16px;
  cursor: pointer;
  color: var(--ky-text-dim, #909399);
  transition: color 0.15s;
}

.ext-head-icon:hover {
  color: var(--ky-text, #e6e6f0);
}

.ext-search {
  padding: 0 16px 8px;
}

.ext-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ext-chip {
  font-size: 11px;
  padding: 2px 10px;
  border-radius: 10px;
  background: var(--ky-code-bg);
  color: var(--ky-text-dim, #a0a0b0);
  cursor: pointer;
  transition: all 0.15s;
}

.ext-chip:hover {
  background: var(--ky-bg-hover);
  color: var(--ky-text, #e6e6f0);
}

.ext-list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 16px;
}

.ext-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 10px 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--ky-text-dim, #8a8a9a);
  user-select: none;
}

.ext-section-market {
  margin-top: 8px;
  border-top: 1px solid var(--ky-border, #2a2a38);
  padding-top: 14px;
}

.ext-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--ky-bg-hover);
  color: var(--ky-text-dim, #c0c0d0);
  font-size: 10px;
}

.ext-source-tag {
  transform: scale(0.9);
  transform-origin: left center;
}

.ext-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s;
}

.ext-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.ext-row.is-selected {
  background: rgba(var(--ky-accent-rgb), 0.12);
  box-shadow: inset 2px 0 0 var(--ky-accent);
}

/* 列表项工具权限直达入口 */
.ext-row-toolperm {
  flex: none;
  align-self: center;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ky-text-dim, #9aa0b4);
  background: transparent;
  border: 1px solid var(--ky-border, rgba(255, 255, 255, 0.12));
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}

.ext-row-toolperm:hover {
  color: var(--ky-text, #e6e6f0);
  border-color: var(--ky-accent);
}

.ext-row-icon {
  font-size: 22px;
  line-height: 1.3;
}

.ext-row-main {
  flex: 1;
  min-width: 0;
}

.ext-row-name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ext-row-name-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text, #e6e6f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ext-row-badge {
  flex-shrink: 0;
}

.ext-row-desc {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ky-text-dim, #8a8a9a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Courier New', monospace;
}

.ext-list-empty {
  padding: 8px 10px 12px;
  font-size: 12px;
  color: var(--ky-text-dim, #666678);
}

.ext-list-loading {
  min-height: 120px;
}

.ext-loadmore {
  display: flex;
  justify-content: center;
  padding: 10px 0;
}

.mcp-status-dot {
  width: 8px;
  height: 8px;
  margin-top: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mcp-status-dot.is-ok {
  background: var(--ky-accent);
  box-shadow: 0 0 6px rgba(var(--ky-accent-rgb), 0.6);
}

.mcp-status-dot.is-busy {
  background: #e6a23c;
  box-shadow: 0 0 6px rgba(230, 162, 60, 0.6);
  animation: mcp-pulse 1.2s ease-in-out infinite;
}

@keyframes mcp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.mcp-status-dot.is-fail {
  background: #f56c6c;
}

.mcp-status-dot.is-idle {
  background: #5a5a6e;
}

/* ---------------- 右栏 ---------------- */
.ext-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ext-detail-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 22px 26px;
}

.ext-detail-empty {
  margin: auto;
}

.ext-detail-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.ext-detail-icon {
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  border-radius: 12px;
  background: var(--ky-code-bg);
  flex-shrink: 0;
}

.ext-detail-icon-lg {
  width: 60px;
  height: 60px;
  font-size: 36px;
}

.ext-detail-title-wrap {
  flex: 1;
  min-width: 0;
}

.ext-detail-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ext-detail-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--ky-text, #ececf4);
}

.ext-detail-subtitle {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
  word-break: break-all;
}

.ext-detail-publisher {
  margin-top: 6px;
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
}

.ext-detail-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0 14px;
  flex-wrap: wrap;
}

.ext-actions-spacer {
  flex: 1;
}

.ext-runtime-panel {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 13px;
  flex-wrap: wrap;
}

.ext-runtime-text {
  color: var(--ky-text-dim, #b0b0c0);
}

.ext-runtime-error {
  flex-basis: 100%;
  font-size: 12px;
  color: #f56c6c;
  word-break: break-all;
}

.ext-security-alert {
  margin: 8px 0 18px;
}

.ext-security-body p {
  margin: 4px 0;
  line-height: 1.6;
}

.ext-security-boundary {
  font-size: 12px;
  opacity: 0.9;
}

.ext-sandbox-line {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.85;
}

/* 工具权限（M19） */
.ext-toolfilter {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ext-toolfilter-hint {
  font-size: 12px;
  color: var(--ky-text-dim, #8a8a9a);
}

.ext-toolfilter-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 2px 16px;
  padding: 10px 12px;
  border: 1px solid var(--ky-border, #2a2a38);
  border-radius: 8px;
  max-height: 220px;
  overflow-y: auto;
}

.ext-toolfilter-item {
  margin-right: 0;
  font-family: 'Courier New', monospace;
  font-size: 12px;
}

.ext-toolfilter-empty {
  padding: 10px 12px;
  border: 1px dashed var(--ky-border, #2a2a38);
  border-radius: 8px;
  font-size: 12px;
  color: var(--ky-text-dim, #8a8a9a);
}

.ext-toolfilter-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ext-toolfilter-unsaved {
  font-size: 12px;
  color: #e6a23c;
}

.ext-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 28px;
  margin-top: 8px;
}

@media (max-width: 1080px) {
  .ext-detail-grid {
    grid-template-columns: 1fr;
  }
}

.ext-section-h3 {
  margin: 20px 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--ky-text, #d0d0e0);
}

.ext-detail-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ky-text-dim, #b0b0c0);
}

.ext-code-wrap {
  background: var(--ky-code-bg);
  border: 1px solid var(--ky-border, #2e2e40);
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
}

.ext-code {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #a5d6ff;
  white-space: nowrap;
}

.ext-code-note {
  margin-top: 6px;
  font-size: 11px;
  color: var(--ky-text-dim, #70708a);
}

.ext-env-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--ky-border, #2a2a38);
}

.ext-env-name {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  font-weight: 600;
}

.ext-env-desc {
  font-size: 11px;
  color: var(--ky-text-dim, #8a8a9a);
}

/* 右栏元信息表 */
.ext-meta {
  margin: 0;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px 12px;
  font-size: 12px;
}

.ext-meta dt {
  color: var(--ky-text-dim, #80809a);
}

.ext-meta dd {
  margin: 0;
  color: var(--ky-text, #d0d0e0);
  word-break: break-word;
}

.ext-meta-break {
  font-family: 'Courier New', monospace;
  font-size: 11px;
}

.ext-res-links {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ---------------- env 弹窗 ---------------- */
.env-dialog-plugin {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.env-dialog-icon {
  font-size: 32px;
}

.env-dialog-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
}

.env-dialog-cmd {
  font-family: 'Courier New', monospace;
  font-size: 11px;
  background: var(--ky-code-bg);
  padding: 4px 8px;
  border-radius: 4px;
}

.env-dialog-hint {
  margin-bottom: 16px;
}

.env-desc {
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
  margin-top: 4px;
}
</style>

<!-- 安装确认弹窗经 ElMessageBox 传送至 body（且内容由 h() 生成、无 scoped 标记），需用全局样式 -->
<style>
.ext-install-messagebox {
  width: 600px;
  max-width: calc(100vw - 48px);
}

.ext-install-messageBox .el-message-box__message,
.ext-install-messagebox .el-message-box__message {
  max-height: 60vh;
  overflow-y: auto;
}

.ext-install-confirm {
  font-size: 13px;
  line-height: 1.6;
}

.ext-install-lead {
  margin: 0 0 12px;
}

.ext-install-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.ext-install-table th {
  text-align: left;
  white-space: nowrap;
  padding: 5px 10px 5px 0;
  color: var(--el-text-color-secondary);
  vertical-align: top;
  font-weight: 600;
}

.ext-install-table td {
  padding: 5px 0;
  word-break: break-all;
  font-family: 'Courier New', monospace;
}

.ext-install-sandbox {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
