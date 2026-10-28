<template>
  <div class="dsh-view">
    <div class="dsh-head">
      <div>
        <div class="dsh-title">{{ t('dsh.title') }}</div>
        <div class="dsh-sub">
          {{ t('dsh.sub') }}
        </div>
      </div>
      <div class="dsh-head-actions">
        <el-input
          v-model="customNpm"
          class="dsh-custom-input"
          size="small"
          :placeholder="t('dsh.customPlaceholder')"
          clearable
        />
        <el-button size="small" :disabled="!customNpm.trim()" @click="onInstallCustom">
          {{ t('dsh.installCustom') }}
        </el-button>
        <el-tooltip :content="t('dsh.reloadTip')" placement="bottom">
          <el-button size="small" :icon="Refresh" :loading="store.loading" @click="store.reload()" />
        </el-tooltip>
      </div>
    </div>

    <!-- P1-7：DSH 插件无沙箱，常驻完整权限声明 -->
    <el-alert
      :title="t('dsh.permNotice')"
      type="warning"
      :closable="false"
      class="dsh-env"
      show-icon
    />

    <!-- 环境状态 -->
    <el-alert
      v-if="envMessage"
      :title="envMessage"
      type="warning"
      :closable="false"
      class="dsh-env"
    />
    <el-alert
      v-else
      :title="t('dsh.envReady', { version: env?.nodeVersion ?? '' })"
      type="success"
      :closable="false"
      class="dsh-env"
    />

    <div v-if="store.error" class="dsh-error">{{ store.error }}</div>
    <!-- P0-3：精选清单未随包携带时显式降级提示（自定义安装/桌宠不受影响） -->
    <el-alert
      v-if="store.state?.catalogMissing"
      :title="t('dsh.catalogMissing')"
      type="warning"
      :closable="false"
      class="dsh-env"
    />

    <!-- dsh-pet 桌宠 -->
    <el-card class="dsh-card dsh-pet-card" shadow="hover">
      <div class="dsh-card-head">
        <span class="dsh-card-name">{{ t('dsh.petName') }}</span>
        <el-tag size="small" :type="petRunning ? 'success' : 'info'" effect="plain">
          {{ petRunning ? t('dsh.petRunning', { port: store.pet?.port ?? '' }) : t('dsh.petStopped') }}
        </el-tag>
        <el-tag v-if="store.pet?.petVersion" size="small" type="success" effect="light" class="dsh-card-ver">
          v{{ store.pet.petVersion }}
        </el-tag>
      </div>
      <div class="dsh-card-desc">
        {{ t('dsh.petDesc') }}
      </div>
      <!-- 第三方来源/许可常驻说明：dsh-pet 不随坤宇安装包分发，按需用户显式获取 -->
      <div class="dsh-card-license">
        {{ t('dsh.petLicenseLead') }}
        <el-link
          type="primary"
          :underline="false"
          href="javascript:void(0)"
          @click="openUpstream"
        >{{ t('dsh.petLicenseLink') }}</el-link>
        {{ t('dsh.petLicenseTail', { source: petSourceText }) }}
      </div>
      <!-- 版本门禁：验证档外的新版本只警告不阻断（unsupported 的硬阻断原因走 error） -->
      <el-alert
        v-if="store.pet?.petInstalled && store.pet.compat === 'unverified'"
        :title="store.pet.compatMessage ?? t('dsh.petCompatFallback')"
        type="info"
        :closable="false"
        class="dsh-card-note"
      />
      <el-alert
        v-if="store.pet?.error"
        :title="store.pet.error"
        type="warning"
        :closable="false"
        class="dsh-card-note"
      />
      <el-alert
        v-else-if="store.pet && !store.pet.petInstalled && !store.pet.sourceAvailable"
        :title="t('dsh.petNotFound')"
        type="info"
        :closable="false"
        class="dsh-card-note"
      />
      <el-alert
        v-else-if="store.pet && !store.pet.electronFound"
        :title="t('dsh.petNoElectron')"
        type="info"
        :closable="false"
        class="dsh-card-note"
      />
      <div class="dsh-card-actions">
        <el-button
          v-if="!petRunning"
          size="small"
          type="primary"
          :loading="store.petBusy"
          @click="onPetStart"
        >{{ t('dsh.petStart') }}</el-button>
        <el-button v-else size="small" type="danger" plain :loading="store.petBusy" @click="onPetStop">
          {{ t('dsh.petStop') }}
        </el-button>
      </div>
    </el-card>

    <!-- 插件卡片 -->
    <div class="dsh-grid">
      <el-card
        v-for="entry in catalogEntries"
        :key="entry.id"
        class="dsh-card"
        shadow="hover"
      >
        <div class="dsh-card-head">
          <span class="dsh-card-name">{{ entry.name }}</span>
          <el-tag size="small" :type="entry.category === 'tool' ? 'success' : 'info'" effect="plain">
            {{ entry.category === 'tool' ? t('dsh.kindTool') : t('dsh.kindUi') }}
          </el-tag>
          <el-tag v-if="entry.installed" size="small" type="success" effect="light" class="dsh-card-ver">
            v{{ entry.installed.version }}
          </el-tag>
        </div>
        <div class="dsh-card-desc">{{ entry.description }}</div>
        <div class="dsh-card-npm">{{ entry.npm }}</div>

        <el-alert
          v-if="entry.uiNote"
          :title="entry.uiNote"
          type="info"
          :closable="false"
          class="dsh-card-note"
        />
        <template v-if="entry.status">
          <el-alert
            v-if="entry.status.state === 'active'"
            :title="t('dsh.activeTools', { n: entry.status.tools.length })"
            type="success"
            :closable="false"
            class="dsh-card-note"
          />
          <el-alert
            v-else-if="entry.status.reason"
            :title="entry.status.state === 'error' ? t('dsh.stateError') : t('dsh.stateInactive')"
            :description="entry.status.reason"
            type="warning"
            :closable="false"
            class="dsh-card-note"
          />
          <div v-if="entry.status.tools.length > 0" class="dsh-card-tools">
            <el-tag v-for="tool in entry.status.tools" :key="tool" size="small" type="info" effect="plain">
              {{ tool }}
            </el-tag>
          </div>
        </template>

        <div class="dsh-card-actions">
          <!-- 信任门控：未授权/授权失效时出现「授权运行」，已授权可撤销 -->
          <el-button
            v-if="entry.status && entry.status.trustState !== 'trusted'"
            size="small"
            type="warning"
            plain
            :loading="store.busy.has(entry.npm)"
            @click="onGrantTrust(entry.npm, entry.name, entry.status.declaredPermissions)"
          >{{ t('dsh.trustGrant') }}</el-button>
          <el-button
            v-else-if="entry.status?.trustState === 'trusted'"
            size="small"
            text
            :loading="store.busy.has(entry.npm)"
            @click="onRevokeTrust(entry.npm)"
          >{{ t('dsh.trustRevoke') }}</el-button>
          <el-button
            v-if="!entry.installed"
            size="small"
            type="primary"
            :loading="store.busy.has(entry.npm)"
            :disabled="!envOk"
            @click="onInstall(entry)"
          >{{ t('dsh.install') }}</el-button>
          <el-button
            v-else
            size="small"
            type="danger"
            plain
            :loading="store.busy.has(entry.npm)"
            @click="onRemove(entry.npm)"
          >{{ t('dsh.uninstall') }}</el-button>
        </div>
      </el-card>

      <!-- 自定义安装的包 -->
      <el-card v-for="c in customEntries" :key="c.npm" class="dsh-card" shadow="hover">
        <div class="dsh-card-head">
          <span class="dsh-card-name">{{ c.npm }}</span>
          <el-tag size="small" type="warning" effect="plain">{{ t('dsh.customTag') }}</el-tag>
          <el-tag size="small" type="success" effect="light" class="dsh-card-ver">v{{ c.version }}</el-tag>
        </div>
        <template v-if="c.status">
          <el-alert
            v-if="c.status.state === 'active'"
            :title="t('dsh.activeTools', { n: c.status.tools.length })"
            type="success"
            :closable="false"
            class="dsh-card-note"
          />
          <el-alert
            v-else-if="c.status.reason"
            :title="c.status.state === 'error' ? t('dsh.stateError') : t('dsh.stateInactive')"
            :description="c.status.reason"
            type="warning"
            :closable="false"
            class="dsh-card-note"
          />
          <div v-if="c.status.tools.length > 0" class="dsh-card-tools">
            <el-tag v-for="tool in c.status.tools" :key="tool" size="small" type="info" effect="plain">
              {{ tool }}
            </el-tag>
          </div>
        </template>
        <div class="dsh-card-actions">
          <el-button
            v-if="c.status && c.status.trustState !== 'trusted'"
            size="small"
            type="warning"
            plain
            :loading="store.busy.has(c.npm)"
            @click="onGrantTrust(c.npm, c.npm, c.status.declaredPermissions)"
          >{{ t('dsh.trustGrant') }}</el-button>
          <el-button
            v-else-if="c.status?.trustState === 'trusted'"
            size="small"
            text
            :loading="store.busy.has(c.npm)"
            @click="onRevokeTrust(c.npm)"
          >{{ t('dsh.trustRevoke') }}</el-button>
          <el-button
            size="small"
            type="danger"
            plain
            :loading="store.busy.has(c.npm)"
            @click="onRemove(c.npm)"
          >{{ t('dsh.uninstall') }}</el-button>
        </div>
      </el-card>
    </div>

    <!-- 首次安装 dsh-pet 前的第三方确认闸（不分发、显式同意后才获取） -->
    <el-dialog
      v-model="consentVisible"
      :title="t('dsh.consentTitle')"
      width="560px"
      append-to-body
      :close-on-click-modal="false"
    >
      <div class="dsh-consent">
        <p>
          {{ t('dsh.consentP1a') }}<strong>PC2005-cloud</strong>{{ t('dsh.consentP1b') }}<strong>{{ t('dsh.consentP1c') }}</strong>{{ t('dsh.consentP1d') }}<strong>{{ petSourceText }}</strong>{{ t('dsh.consentP1e') }}
        </p>
        <ul>
          <li>{{ t('dsh.consentLi1') }}</li>
          <li>{{ t('dsh.consentLi2') }}</li>
          <li>{{ t('dsh.consentLi3') }}</li>
          <li>{{ t('dsh.consentLi4') }}</li>
        </ul>
        <el-checkbox v-model="consentDontAsk">{{ t('dsh.consentDontAsk') }}</el-checkbox>
      </div>
      <template #footer>
        <el-button @click="consentVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="confirmPetConsent">{{ t('dsh.consentOk') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
/**
 * DSH 社区插件页：精选目录 + 自定义 npm 安装 + 兼容宿主加载状态。
 * 工具类插件激活后，其 ctx.tools.register 的工具自动进入坤宇 AI 工具循环。
 */
import { computed, onMounted, ref } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useDshStore } from '../../stores/dsh'
import { useI18n } from '../../i18n'
import type { DshCatalogEntry } from '../../../../shared/types/dsh'

const { t } = useI18n()
const store = useDshStore()
const customNpm = ref('')

const env = computed(() => store.state?.env)
const envOk = computed(() => Boolean(env.value?.nodeOk && env.value?.npmOk))
const envMessage = computed(() => env.value?.message ?? '')

const catalogEntries = computed(() => store.state?.entries ?? [])
const customEntries = computed(() => store.state?.customs ?? [])
const petRunning = computed(() => Boolean(store.pet?.running))

onMounted(() => {
  void store.load()
  void store.petStatus()
})

/* ---- dsh-pet 首次安装第三方同意闸（只提示一次；与首启提醒同走 localStorage） ---- */
const PET_CONSENT_KEY = 'kunyu:dsh-pet-install-consent'
const DSH_PET_REPO_URL = 'https://github.com/PC2005-cloud/dsh-pet'
const consentVisible = ref(false)
const consentDontAsk = ref(false)

/** 本次获取渠道（随状态探测结果差异化文案）：本机 DSH 复制优先，否则 npm */
const petSourceText = computed(() =>
  store.pet?.sourceAvailable ? t('dsh.sourceFromLocal') : t('dsh.sourceFromNpm')
)

function openUpstream(): void {
  void window.api.shell.openExternal(DSH_PET_REPO_URL)
}

async function onPetStart(): Promise<void> {
  // 未安装且未确认过第三方说明 → 先过同意闸，确认后由 confirmPetConsent 续跑
  if (!store.pet?.petInstalled && !localStorage.getItem(PET_CONSENT_KEY)) {
    consentDontAsk.value = false
    consentVisible.value = true
    return
  }
  await doPetStart()
}

async function confirmPetConsent(): Promise<void> {
  if (consentDontAsk.value) localStorage.setItem(PET_CONSENT_KEY, '1')
  consentVisible.value = false
  await doPetStart()
}

async function doPetStart(): Promise<void> {
  await store.petStart()
  if (store.pet?.running) ElMessage.success(t('dsh.petStarted'))
  else if (store.pet?.error) ElMessage.error(store.pet.error)
}

async function onPetStop(): Promise<void> {
  await store.petStop()
  if (!store.pet?.running) ElMessage.success(t('dsh.petStoppedOk'))
  else if (store.pet?.error) ElMessage.error(store.pet.error)
}

async function onInstall(entry: DshCatalogEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('dsh.installConfirmLead', { name: entry.name, npm: entry.npm }) + t('dsh.permWarning'),
      t('dsh.installTitle'),
      {
        type: 'warning',
        confirmButtonText: t('dsh.installConfirmBtn'),
        cancelButtonText: t('common.cancel')
      }
    )
  } catch {
    return
  }
  const res = await store.install(entry.npm)
  if (res.ok) ElMessage.success(t('dsh.installed', { name: entry.name }))
  else ElMessage.error(res.error ?? t('dsh.installFailed'))
}

async function onInstallCustom(): Promise<void> {
  const npmName = customNpm.value.trim()
  if (!npmName) return
  try {
    await ElMessageBox.confirm(
      t('dsh.customConfirmLead', { npm: npmName }) + t('dsh.permWarning'),
      t('dsh.customInstallTitle'),
      {
        type: 'warning',
        confirmButtonText: t('dsh.installConfirmBtn'),
        cancelButtonText: t('common.cancel')
      }
    )
  } catch {
    return
  }
  const res = await store.installCustom(npmName)
  if (res.ok) {
    ElMessage.success(t('dsh.installed', { name: npmName }))
    customNpm.value = ''
  } else {
    ElMessage.error(res.error ?? t('dsh.installFailed'))
  }
}

async function onRemove(npmName: string): Promise<void> {
  const res = await store.remove(npmName)
  if (res.ok) ElMessage.success(t('dsh.uninstalled', { name: npmName }))
  else ElMessage.error(res.error ?? t('dsh.uninstallFailed'))
}

/* ---------- 信任门控：插件在主进程执行，授权前不加载 ---------- */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c] as string)
}

/** 授权前二次确认：明示主进程完整权限 + 该插件声明的宿主能力（绑定当前包内容指纹） */
async function onGrantTrust(npm: string, label: string, declared?: string[]): Promise<void> {
  const perms = declared && declared.length > 0 ? declared.join('、') : t('dsh.trustNone')
  try {
    await ElMessageBox.confirm(
      t('dsh.trustBody', { name: escapeHtml(label), npm: escapeHtml(npm), perms: escapeHtml(perms) }),
      t('dsh.trustTitle'),
      {
        type: 'warning',
        dangerouslyUseHTMLString: true,
        confirmButtonText: t('dsh.trustOk'),
        cancelButtonText: t('common.cancel')
      }
    )
  } catch {
    return
  }
  const res = await store.setTrust(npm, true)
  if (res.ok) ElMessage.success(t('dsh.trustGranted', { npm }))
  else ElMessage.error(res.error ?? t('dsh.installFailed'))
}

async function onRevokeTrust(npm: string): Promise<void> {
  const res = await store.setTrust(npm, false)
  if (res.ok) ElMessage.success(t('dsh.trustRevoked', { npm }))
  else ElMessage.error(res.error ?? t('dsh.installFailed'))
}
</script>

<style scoped>
.dsh-view {
  padding: 16px 20px;
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
}
.dsh-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.dsh-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--ky-text);
}
.dsh-sub {
  font-size: 12px;
  color: var(--ky-text-secondary, #909399);
  margin-top: 4px;
}
.dsh-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.dsh-custom-input {
  width: 260px;
}
.dsh-env {
  margin-bottom: 12px;
}
.dsh-error {
  color: var(--el-color-danger);
  font-size: 12px;
  margin-bottom: 12px;
}
.dsh-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}
.dsh-pet-card {
  margin-bottom: 12px;
}
.dsh-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dsh-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ky-text);
}
.dsh-card-ver {
  margin-left: auto;
}
.dsh-card-desc {
  font-size: 12px;
  color: var(--ky-text-secondary, #909399);
  margin: 8px 0 4px;
  min-height: 32px;
}
.dsh-card-license {
  font-size: 11px;
  line-height: 1.7;
  color: var(--ky-text-dim, #909399);
  margin: 4px 0 2px;
}
.dsh-consent p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ky-text);
  margin: 0 0 10px;
}
.dsh-consent ul {
  margin: 0 0 12px;
  padding-left: 20px;
}
.dsh-consent li {
  font-size: 12px;
  line-height: 1.8;
  color: var(--ky-text-sub, #606266);
}
.dsh-card-npm {
  font-size: 11px;
  color: var(--ky-text-secondary, #909399);
  opacity: 0.8;
  margin-bottom: 8px;
}
.dsh-card-note {
  margin: 8px 0;
}
.dsh-card-note :deep(.el-alert__title),
.dsh-card-note :deep(.el-alert__description) {
  font-size: 12px;
}
.dsh-card-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 8px 0;
}
.dsh-card-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
