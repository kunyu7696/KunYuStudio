<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('wizard.title')"
    width="720px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    @update:model-value="(v) => emit('update:modelValue', v)"
    @closed="reset"
  >
    <el-steps :active="step" finish-status="success" align-center class="wizard-steps">
      <el-step :title="t('wizard.stepBasic')" />
      <el-step :title="t('wizard.stepConfig')" />
    </el-steps>

    <div class="wizard-body">
      <!-- 步骤 1：基础信息 -->
      <div v-if="step === 0" class="step">
        <el-form :model="form" label-width="90px" label-position="right">
          <el-form-item :label="t('wizard.projectType')" required>
            <div class="type-grid">
              <button
                v-for="opt in typeOptions"
                :key="opt.value"
                type="button"
                class="type-card"
                :class="{ active: form.type === opt.value }"
                @click="form.type = opt.value"
              >
                <el-icon :size="22"><component :is="opt.icon" /></el-icon>
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </el-form-item>

          <el-form-item :label="t('wizard.projectName')" required>
            <el-input
              v-model="form.name"
              :placeholder="t('wizard.namePlaceholder')"
              maxlength="64"
              @input="onNameChange"
            />
          </el-form-item>

          <el-form-item :label="t('wizard.projectPath')" required>

            <div class="path-row">
              <el-input
                v-model="form.path"
                :placeholder="t('wizard.pathPlaceholder')"
                @input="pathTouched = true"
              >
                <template #append>
                  <el-button :icon="FolderOpened" @click="pickDirectory" />
                </template>
              </el-input>
            </div>
            <div class="form-hint">{{ t('wizard.pathHint') }}</div>
          </el-form-item>
        </el-form>
      </div>

      <!-- 步骤 2：版本与配置 -->
      <div v-else class="step">
        <el-form :model="form" label-width="100px" label-position="right">
          <el-form-item :label="t('wizard.projectName')">
            <span class="readonly">{{ form.name }}</span>
          </el-form-item>
          <el-form-item :label="t('wizard.projectType')">
            <span class="readonly">{{ typeLabel }}</span>
          </el-form-item>
          <el-form-item :label="t('wizard.projectPath')">
            <span class="readonly path-text">{{ form.path }}</span>
          </el-form-item>

          <template v-if="form.type === 'mod' || form.type === 'modpack'">
            <el-form-item :label="t('wizard.loader')" required>
              <el-radio-group v-model="form.loader" size="small" @change="onLoaderChange">
                <el-radio-button value="fabric">Fabric</el-radio-button>
                <el-radio-button value="forge">Forge</el-radio-button>
                <el-radio-button value="neoforge">NeoForge</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <el-form-item :label="t('wizard.versionPick')" required>
              <div class="wizard-version-hint">
                {{ t('wizard.versionHint', { max: matrixMaxMc }) }}
              </div>
              <div class="wheel-row">
                <div class="wheel-col">
                  <span class="wheel-caption">{{ t('wizard.mcVersion') }}</span>
                  <WheelSelect
                    :model-value="form.mcVersion"
                    :options="mcOptions"
                    :placeholder="t('wizard.mcPlaceholder')"
                    @update:model-value="onMcChange"
                  />
                </div>
                <div class="wheel-col">
                  <span class="wheel-caption">{{ t('wizard.loaderVersion') }}</span>
                  <WheelSelect
                    :model-value="form.loaderVersion"
                    :options="loaderVersionOptions"
                    :placeholder="t('wizard.loaderPlaceholder')"
                    @update:model-value="form.loaderVersion = $event"
                  />
                </div>
              </div>
            </el-form-item>

            <el-form-item v-if="selectedCell" :label="t('wizard.comboStatus')">
              <div class="combo-row">
                <span class="combo-dot" :class="`is-${selectedCell.health}`" />
                <el-tooltip :content="t('wizard.comboActiveTip')" placement="top">
                  <el-tag size="small" :type="selectedCell.active ? 'success' : 'warning'" effect="plain">
                    {{ selectedCell.active ? t('wizard.comboActive') : t('wizard.comboReserve') }}
                  </el-tag>
                </el-tooltip>
                <span class="combo-meta">{{ t('wizard.templateCount', { n: selectedCell.templateCount }) }}</span>
                <el-button
                  size="small"
                  type="success"
                  plain
                  :loading="probeForCell"
                  @click="onProbe"
                >
                  {{ t('wizard.probeRun') }}
                </el-button>
              </div>
              <el-progress
                v-if="probeForCell && monitor.probeRunning"
                :percentage="monitor.probe.progress"
                :stroke-width="6"
                :show-text="false"
                class="combo-progress"
              />
              <p v-if="probeForCell" class="form-hint">
                {{ t('wizard.probeLine', { phase: probePhaseLabel, message: monitor.probe.message }) }}
              </p>
              <p v-else-if="selectedCell.verifiedAt" class="form-hint">
                {{ t('wizard.verifiedAt', { time: formatVerifiedAt(selectedCell.verifiedAt) }) }}
              </p>
            </el-form-item>

            <div class="matrix-wrap">
              <VersionMatrixSection
                :selected-cell-id="selectedCellId"
                hide-legacy
                @select="onMatrixSelect"
                @migrate="onMigrateRequest"
              />
            </div>
          </template>

          <!-- 模组专属：模组 ID / JDK -->
          <template v-if="form.type === 'mod'">
            <el-form-item :label="t('wizard.modId')" required>
              <el-input
                v-model="form.modId"
                :placeholder="t('wizard.modIdPlaceholder')"
                :error="modIdError"
              />
              <div class="form-hint">{{ modIdError || t('wizard.modIdHint') }}</div>
            </el-form-item>
            <el-form-item :label="t('wizard.jdkPath')">
              <div class="path-row">
                <el-input v-model="form.jdkPath" :placeholder="t('wizard.jdkPlaceholder')" readonly>
                  <template #append>
                    <el-button :icon="FolderOpened" @click="pickJdk" />
                  </template>
                </el-input>
                <div class="form-hint">{{ jdkHint }}</div>
              </div>
            </el-form-item>
          </template>

          <!-- 资源包 / 数据包 -->
          <template v-else-if="form.type === 'resourcepack' || form.type === 'datapack'">
            <el-form-item :label="t('wizard.targetVersion')" required>
              <WheelSelect
                :model-value="form.mcVersion"
                :options="packMcOptions"
                :placeholder="t('wizard.mcPlaceholder')"
                @update:model-value="form.mcVersion = $event"
              />
            </el-form-item>
            <el-form-item :label="t('wizard.namespace')">
              <el-input
                v-model="form.namespace"
                :placeholder="t('wizard.namespacePlaceholder')"
              />
              <div class="form-hint">
                {{ form.type === 'resourcepack'
                  ? t('wizard.namespaceHintRp')
                  : t('wizard.namespaceHintDp') }}
              </div>
            </el-form-item>
          </template>

          <!-- 光影包 -->
          <template v-else-if="form.type === 'shaderpack'">
            <el-form-item :label="t('wizard.shaderLoader')" required>
              <el-radio-group v-model="form.shaderLoader" size="small">
                <el-radio-button value="iris">Iris</el-radio-button>
                <el-radio-button value="optifine">OptiFine</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item :label="t('wizard.targetVersion')" required>
              <WheelSelect
                :model-value="form.mcVersion"
                :options="packMcOptions"
                :placeholder="t('wizard.mcPlaceholder')"
                @update:model-value="form.mcVersion = $event"
              />
            </el-form-item>
            <p class="form-hint">{{ t('wizard.shaderHint') }}</p>
          </template>

          <!-- 整合包：仅清单 + overrides，不含游戏本体（Mojang EULA） -->
          <template v-else-if="form.type === 'modpack'">
            <p class="form-hint">{{ t('wizard.modpackHint') }}</p>
          </template>

          <!-- 包类项目（资源包/数据包/光影包）：与模组一致的版本矩阵 + 组合状态（按 MC 版本单维） -->
          <template v-if="isPackType">
            <el-form-item v-if="packRepCell" :label="t('wizard.comboStatus')">
              <div class="combo-row">
                <span class="combo-dot" :class="`is-${packRepCell.health}`" />
                <el-tag size="small" :type="packRepCell.active ? 'success' : 'warning'" effect="plain">
                  {{ packRepCell.active ? t('wizard.packComboActive') : t('wizard.comboReserve') }}
                </el-tag>
                <span class="combo-meta">{{ t('wizard.templateCount', { n: packRepCell.templateCount }) }}</span>
              </div>
              <p class="form-hint">{{ t('wizard.packHealthHint') }}</p>
            </el-form-item>
            <div class="matrix-wrap">
              <VersionMatrixSection
                :pack-mc-versions="packMcVersions"
                :selected-mc-version="form.mcVersion"
                hide-legacy
                @select="onPackMatrixSelect"
              />
            </div>
          </template>
        </el-form>
      </div>
    </div>

    <template #footer>
      <div class="wizard-footer">
        <!-- 下一步被禁用时如实说明缺什么：用户不知道缺什么 -->
        <span v-if="step === 0 && !canNext" class="wizard-blocked-reason">{{ nextBlockedReason }}</span>
        <div class="wizard-footer-btns">
          <el-button @click="emit('update:modelValue', false)">{{ t('wizard.cancel') }}</el-button>
          <el-button v-if="step === 1" @click="step = 0">{{ t('wizard.prev') }}</el-button>
          <el-button v-else type="primary" :disabled="!canNext" @click="goStepTwo">{{ t('wizard.next') }}</el-button>
          <el-button v-if="step === 1" type="primary" :loading="submitting" @click="submit">
            {{ t('wizard.create') }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>

  <!-- 迁移模式引导：点击 legacy/deprecated 组合时弹出 -->
  <el-dialog
    v-model="migrateDialog.visible"
    :title="migrateDialog.deprecated ? t('wizard.migrateDeprecatedTitle') : t('wizard.migrateLegacyTitle')"
    width="440px"
    append-to-body
  >
    <div class="migrate-body">
      <template v-if="migrateDialog.deprecated">
        <p class="migrate-text">
          <strong>{{ migrateDialog.cell?.loader }}-{{ migrateDialog.cell?.mcVersion }}</strong>
        </p>
        <p class="migrate-text">
          {{ migrateDialog.cell?.note || t('wizard.migrateDeprecatedNote') }}
        </p>
      </template>
      <template v-else>
        <p class="migrate-text">
          {{ t('wizard.migrateLegacyDesc', { mc: migrateDialog.cell?.mcVersion ?? '' }) }}
        </p>
        <p class="migrate-text">
          {{ t('wizard.migrateQuestion', { target: t('wizard.defaultTarget') }) }}
        </p>
      </template>
    </div>
    <template #footer>
      <el-button @click="migrateDialog.visible = false">{{ t('wizard.cancel') }}</el-button>
      <el-button type="primary" @click="confirmMigrate">{{ t('wizard.migrateConfirm') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Box,
  Files,
  FolderOpened,
  Picture,
  Sunny,
  DataLine
} from '@element-plus/icons-vue'
import {
  PROJECT_TYPE_META,
  type CreateProjectInput,
  type ModLoader,
  type Project,
  type ProjectType
} from '../../../../shared/types/project'
import type { ComboMatrixCell } from '../../../../shared/types/monitor'
import type { LoaderId } from '../../../../shared/types/aiReference'
import { PACK_TYPE_MC_VERSIONS, type PackType } from '../../../../shared/schemas/packVersions'
import WheelSelect, { type WheelOption } from '../common/WheelSelect.vue'
import VersionMatrixSection from './VersionMatrixSection.vue'
import { useAiMonitorStore } from '../../stores/aiMonitor'
import { useSettingsStore } from '../../stores/settings'
import { t } from '../../i18n'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'created', project: Project): void
}>()

const monitor = useAiMonitorStore()
const settings = useSettingsStore()

/** JDK 行提示：留空 = 跟随全局设置/矩阵自动解析（项目级手选才固化进项目配置） */
const jdkHint = computed(() => {
  const home = settings.java.globalJdkHome?.trim()
  if (home) {
    const short = home.split(/[\\/]/).filter(Boolean).pop() ?? home
    return t('wizard.jdkHintGlobal', { name: short })
  }
  return t('wizard.jdkHintAuto')
})

const typeOptions = computed<{ value: ProjectType; label: string; icon: unknown }[]>(() => [
  { value: 'mod', label: t('wizard.typeMod'), icon: Box },
  { value: 'resourcepack', label: t('wizard.typeResourcepack'), icon: Picture },
  { value: 'datapack', label: t('wizard.typeDatapack'), icon: DataLine },
  { value: 'shaderpack', label: t('wizard.typeShaderpack'), icon: Sunny },
  { value: 'modpack', label: t('wizard.typeModpack'), icon: Files }
])

interface WizardForm {
  name: string
  type: ProjectType
  path: string
  loader: ModLoader
  mcVersion: string
  loaderVersion: string
  modId: string
  namespace: string
  shaderLoader: 'iris' | 'optifine'
  jdkPath: string
}

const defaultForm = (): WizardForm => ({
  name: '',
  type: 'mod',
  path: '',
  loader: 'fabric',
  mcVersion: '1.20.1',
  loaderVersion: '',
  modId: '',
  namespace: '',
  shaderLoader: 'iris',
  jdkPath: ''
})

const form = reactive<WizardForm>(defaultForm())
const step = ref(0)
const submitting = ref(false)
/** 浏览选择的父目录；名称变化且用户未手改路径时用于拼建议路径 */
const parentDir = ref('')
/** 用户是否手动编辑过路径（编辑后不再自动追加项目名） */
const pathTouched = ref(false)

/** 监测状态不可用时的兜底组合（与主进程 Fabric 默认模板一致） */
const FALLBACK_CELLS: ComboMatrixCell[] = [
  {
    id: 'fabric-1.20.1',
    loader: 'fabric',
    mcVersion: '1.20.1',
    loaderVersion: '0.15.11',
    mapping: 'yarn',
    jdk: 17,
    health: 'unknown',
    driftRisk: 'low',
    active: true,
    templateCount: 17,
    verifiedAt: null,
    note: ''
  }
]

/** 弹窗打开时确保版本矩阵就绪，并给加载器/版本一个默认选中组合 */
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    // 确保版本矩阵就绪；失败时使用内置兜底组合
    await monitor.init().catch(() => undefined)
    initComboSelection()
  }
)

const typeLabel = computed(
  () => typeOptions.value.find((o) => o.value === form.type)?.label ?? PROJECT_TYPE_META[form.type].label
)

const modIdError = computed(() => {
  if (form.type !== 'mod') return ''
  if (!form.modId) return ''
  return /^[a-z][a-z0-9_]*$/.test(form.modId) ? '' : t('wizard.modIdInvalid')
})

/** 矩阵单元（监测状态未就绪时回落兜底） */
const cells = computed<ComboMatrixCell[]>(() =>
  monitor.monitor?.cells.length ? monitor.monitor.cells : FALLBACK_CELLS
)

const loaderCells = computed(() => cells.value.filter((c) => c.loader === (form.loader as LoaderId)))

/** MC 版本滚轮选项：同加载器下去重，优先 ACTIVE 组合的徽标；legacy 已移至「导入项目」入口，新建向导不展示。
 *  beta（NeoForge 26.3，官方未 GA）：展示但灰显禁用，悬停说明待稳定后开放 */
const mcOptions = computed<WheelOption[]>(() => {
  const seen = new Map<string, ComboMatrixCell>()
  for (const c of loaderCells.value) {
    // 新建向导不展示遗产层（第三层），仅保留 core / extended / deprecated
    if (c.tier === 'legacy') continue
    const prev = seen.get(c.mcVersion)
    if (!prev || (c.active && !prev.active)) seen.set(c.mcVersion, c)
  }
  return [...seen.entries()].map(([mc, cell]) => {
    if (cell.health === 'deprecated') {
      return { value: mc, badge: t('wizard.badgeDeprecated'), badgeType: 'danger' as const }
    }
    if (cell.health === 'beta') {
      return {
        value: mc,
        badge: 'Beta',
        badgeType: 'info' as const,
        disabled: true,
        disabledTip: t('wizard.betaTip', {
          loader: cell.loader === 'neoforge' ? 'NeoForge' : t('wizard.loader'),
          mc
        })
      }
    }
    return {
      value: mc,
      badge: cell.active ? t('wizard.badgeActive') : t('wizard.badgeReserve'),
      badgeType: cell.active ? 'success' : ('warning' as const)
    }
  })
})

/** 加载器版本滚轮选项：跟随所选 MC 版本；beta 组合的加载器版本同样灰显 */
const loaderVersionOptions = computed<WheelOption[]>(() => {
  const matched = loaderCells.value.filter((c) => c.mcVersion === form.mcVersion)
  const pool = matched.length ? matched : loaderCells.value
  const seen = new Map<string, ComboMatrixCell>()
  for (const c of pool) {
    const prev = seen.get(c.loaderVersion)
    if (!prev || (c.active && !prev.active)) seen.set(c.loaderVersion, c)
  }
  return [...seen.entries()].map(([lv, cell]) => {
    if (cell.health === 'beta') {
      return {
        value: lv,
        badge: 'Beta',
        badgeType: 'info' as const,
        disabled: true,
        disabledTip: t('wizard.betaTipShort', { mc: cell.mcVersion })
      }
    }
    return {
      value: lv,
      badge: cell.active ? t('wizard.badgeActive') : t('wizard.badgeReserve'),
      badgeType: cell.active ? 'success' : ('warning' as const)
    }
  })
})

/** 矩阵实际登记的最高 MC 版本（提示语动态取值，杜绝与选项脱节） */
const matrixMaxMc = computed(() => {
  const versions = mcOptions.value.map((o) => String(o.value))
  return versions.length ? ([...versions].sort(compareMcVersion).at(-1) ?? '—') : '—'
})

const selectedCellId = computed(() => `${form.loader}-${form.mcVersion}`)

/** 包类项目（资源包/数据包/光影包） */
const isPackType = computed(
  () => form.type === 'resourcepack' || form.type === 'datapack' || form.type === 'shaderpack'
)

/** 本地版本号比较（按 . 分段数值升序） */
function compareMcVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 包类项目的 MC 版本代表格集合：矩阵登记版本按 MC 版本去重（同版本优先 ACTIVE 格），
 * 排除 legacy 层（走导入/迁移），core 优先 + 版本升序。
 */
const packMcCells = computed<[string, ComboMatrixCell][]>(() => {
  const seen = new Map<string, ComboMatrixCell>()
  for (const c of cells.value) {
    if (c.tier === 'legacy') continue
    const prev = seen.get(c.mcVersion)
    if (!prev || (c.active && !prev.active)) seen.set(c.mcVersion, c)
  }
  const tierOrder = (t?: string): number => (t === 'core' ? 0 : 1)
  return [...seen.entries()].sort(
    (a, b) => tierOrder(a[1].tier) - tierOrder(b[1].tier) || compareMcVersion(a[0], b[0])
  )
})

/**
 * 包类项目可选 MC 版本（P0-4）：当前类型的真实格式表白名单
 * ∩ 矩阵非 legacy 版本。不再直接用模组矩阵全集——数据包/光影包只认
 * ≤1.21.5，资源包只认 ≤1.21.9，多出的版本创建时必然失败。
 */
const packMcVersions = computed<string[]>(() => {
  const whitelist = PACK_TYPE_MC_VERSIONS[form.type as PackType]
  if (!whitelist) return packMcCells.value.map(([mc]) => mc)
  const matrix = new Set(packMcCells.value.map(([mc]) => mc))
  return whitelist.filter((v) => matrix.has(v))
})

/** 包类「目标版本」滚轮选项（徽标随矩阵健康度，跟随白名单交集） */
const packMcOptions = computed<WheelOption[]>(() =>
  packMcVersions.value.flatMap((mc) => {
    const cell = packMcCells.value.find(([m]) => m === mc)
    return cell
      ? [{
          value: mc,
          badge: cell[1].active ? t('wizard.badgeActive') : t('wizard.badgeReserve'),
          badgeType: cell[1].active ? 'success' : ('warning' as const)
        }]
      : []
  })
)

/** 包类项目的组合状态代表格：同 MC 版本下优先 Fabric ACTIVE 组合（健康度/模板数对包类同样适用） */
const packRepCell = computed<ComboMatrixCell | null>(() => {
  if (!isPackType.value) return null
  const matches = cells.value.filter((c) => c.mcVersion === form.mcVersion && c.tier !== 'legacy')
  return (
    matches.find((c) => c.loader === 'fabric' && c.active) ??
    matches.find((c) => c.loader === 'fabric') ??
    matches[0] ??
    null
  )
})

/** 包类项目从矩阵点选某 MC 版本（只取版本，不取加载器——包类无加载器概念） */
function onPackMatrixSelect(cell: ComboMatrixCell): void {
  form.mcVersion = cell.mcVersion
}

const selectedCell = computed<ComboMatrixCell | null>(() => {
  const exact = cells.value.find(
    (c) => c.loader === form.loader && c.mcVersion === form.mcVersion && c.loaderVersion === form.loaderVersion
  )
  if (exact) return exact
  // 加载器版本与矩阵登记不完全一致时，退回 loader+mc 代表格展示健康状态
  return cells.value.find((c) => c.loader === form.loader && c.mcVersion === form.mcVersion) ?? null
})

const probeForCell = computed(
  () => monitor.probe.comboId === selectedCellId.value && monitor.probe.phase !== 'idle'
)

const probePhaseLabel = computed(() => t(`wizard.phase.${monitor.probe.phase}`))

/** ISO 时间戳 → 本地可读日期（与其余界面一致，不裸露原始字符串） */
function formatVerifiedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

const canNext = computed(() => {
  if (!form.name.trim()) return false
  if (!form.path.trim()) return false
  // beta 组合（NeoForge 26.3）禁用：矩阵/向导双重拦截之外，提交前最后一道闸
  if (
    (form.type === 'mod' || form.type === 'modpack') &&
    cells.value.some(
      (c) => c.loader === form.loader && c.mcVersion === form.mcVersion && c.health === 'beta'
    )
  ) {
    return false
  }
  if (form.type === 'mod' && !form.modId) return false
  if (form.type === 'mod' && modIdError.value) return false
  // 命名空间为可选项；填写时必须合法
  if (
    (form.type === 'resourcepack' || form.type === 'datapack') &&
    form.namespace.trim() &&
    !/^[a-z][a-z0-9_]*$/.test(form.namespace.trim())
  ) {
    return false
  }
  return true
})

// 与 canNext 同源的唯一缺项说明（第一步 footer 显示，用户不再猜缺什么）
const nextBlockedReason = computed(() => {
  if (!form.name.trim()) return t('wizard.blockedName')
  if (!form.path.trim()) return t('wizard.blockedPath')
  if (
    (form.type === 'mod' || form.type === 'modpack') &&
    cells.value.some(
      (c) => c.loader === form.loader && c.mcVersion === form.mcVersion && c.health === 'beta'
    )
  ) {
    return t('wizard.blockedBeta', { mc: form.mcVersion })
  }
  if (form.type === 'mod' && !form.modId) return t('wizard.blockedModId')
  if (form.type === 'mod' && modIdError.value) {
    return t('wizard.blockedModIdInvalid', { reason: modIdError.value })
  }
  if (
    (form.type === 'resourcepack' || form.type === 'datapack') &&
    form.namespace.trim() &&
    !/^[a-z][a-z0-9_]*$/.test(form.namespace.trim())
  ) {
    return t('wizard.blockedNamespace')
  }
  return ''
})

function safeFolderName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '_')
}

function initComboSelection(): void {
  // legacy 组合走「导入项目」入口，默认选中不得落到 legacy（P2：Forge 曾被静默选中 1.18.2）；
  // beta（NeoForge 26.3）官方未 GA，默认选中同样跳过
  const source = cells.value.filter((c) => c.tier !== 'legacy' && c.health !== 'beta')
  const preferred =
    source.find((c) => c.loader === form.loader && c.active) ??
    source.find((c) => c.loader === form.loader) ??
    source[0]
  if (preferred) {
    form.loader = preferred.loader
    form.mcVersion = preferred.mcVersion
    form.loaderVersion = preferred.loaderVersion
  }
}

/** 切换加载器：重置为该加载器下的 ACTIVE（或首个）组合（排除 legacy 与 beta——向导规则不允许新建这两类） */
function onLoaderChange(loader: string | number | boolean | undefined): void {
  const target = loader as ModLoader
  form.loader = target
  const group = cells.value.filter(
    (c) => c.loader === (target as LoaderId) && c.tier !== 'legacy' && c.health !== 'beta'
  )
  const preferred = group.find((c) => c.active) ?? group[0]
  if (preferred) {
    form.mcVersion = preferred.mcVersion
    form.loaderVersion = preferred.loaderVersion
  } else {
    form.mcVersion = ''
    form.loaderVersion = ''
  }
}

/** 切换 MC 版本：加载器版本跟随该组合的登记值；legacy/deprecated 拦截弹迁移引导；beta 拦截提示 */
function onMcChange(mc: string): void {
  const matched = cells.value.find(
    (c) => c.loader === form.loader && c.mcVersion === mc && c.active
  ) ?? cells.value.find((c) => c.loader === form.loader && c.mcVersion === mc)
  // legacy/deprecated：不选中，弹迁移引导
  if (matched && (matched.health === 'deprecated' || matched.tier === 'legacy')) {
    onMigrateRequest(matched)
    return
  }
  // beta：不选中，仅提示（滚轮层面已灰显，此处为编程兜底）
  if (matched?.health === 'beta') {
    ElMessage.info(
      t('wizard.betaTip', {
        loader: matched.loader === 'neoforge' ? 'NeoForge' : t('wizard.loader'),
        mc
      })
    )
    return
  }
  form.mcVersion = mc
  if (matched) form.loaderVersion = matched.loaderVersion
  // 同步 AI Agent 目标组合
  monitor.selectCombo(form.loader as LoaderId, mc)
}

/** 从完整矩阵中点选某格；beta 组合不响应选中（矩阵格自身也灰显） */
function onMatrixSelect(cell: ComboMatrixCell): void {
  if (cell.health === 'beta') return
  form.loader = cell.loader
  form.mcVersion = cell.mcVersion
  form.loaderVersion = cell.loaderVersion
  monitor.selectCombo(cell.loader, cell.mcVersion)
}

/** 迁移模式引导对话框状态 */
const migrateDialog = reactive<{
  visible: boolean
  deprecated: boolean
  cell: ComboMatrixCell | null
}>({ visible: false, deprecated: false, cell: null })

/** legacy/deprecated 组合被点击：弹迁移引导而非选中 */
function onMigrateRequest(cell: ComboMatrixCell): void {
  migrateDialog.cell = cell
  migrateDialog.deprecated = cell.health === 'deprecated'
  migrateDialog.visible = true
}

/** 确认迁移：切到同加载器最新的 core 版本，预填名称，进入第二步 */
function confirmMigrate(): void {
  const src = migrateDialog.cell
  migrateDialog.visible = false
  if (!src) return
  // 迁移目标：同加载器的最新 core 组合（优先 1.21.1，回退 1.20.1）
  const target =
    cells.value.find((c) => c.loader === src.loader && c.tier === 'core' && c.mcVersion === '1.21.1') ??
    cells.value.find((c) => c.loader === src.loader && c.tier === 'core') ??
    cells.value.find((c) => c.loader === src.loader && c.active)
  if (target) {
    form.loader = target.loader
    form.mcVersion = target.mcVersion
    form.loaderVersion = target.loaderVersion
    monitor.selectCombo(target.loader, target.mcVersion)
  }
  if (!form.name.trim()) {
    form.name = t('wizard.migrateNameSuffix', { from: src.mcVersion, to: form.mcVersion })
  }
  ElMessage.success(
    t('wizard.migrateSuccess', { combo: `${form.loader}-${form.mcVersion}` })
  )
  goStepTwo()
}

async function onProbe(): Promise<void> {
  if (!selectedCell.value) return
  try {
    await monitor.runActiveProbe(selectedCell.value.id)
    if (monitor.probe.phase === 'pass') ElMessage.success(t('wizard.probePass'))
    if (monitor.probe.phase === 'fail') ElMessage.error(t('wizard.probeFail'))
  } catch (err) {
    ElMessage.error(t('wizard.probeFailed', { error: (err as Error).message }))
  }
}

async function onNameChange(): Promise<void> {
  if (form.type === 'mod') {
    form.modId = await window.api.project.deriveModId(form.name)
  }
  // 用户未手动改路径且已选过父目录时，随名称刷新建议文件夹
  if (!pathTouched.value && parentDir.value && form.name.trim()) {
    form.path = `${parentDir.value}\\${safeFolderName(form.name)}`
  }
}

watch(
  () => form.type,
  async (type) => {
    if (type === 'mod' && form.name) {
      form.modId = await window.api.project.deriveModId(form.name)
    }
    // P0-4：切到包类时所选版本须在该包类白名单内，否则回退到可选集最高版本
    if (type === 'resourcepack' || type === 'datapack' || type === 'shaderpack') {
      const selectable = packMcVersions.value
      if (selectable.length && !selectable.includes(form.mcVersion)) {
        form.mcVersion = selectable[selectable.length - 1]
      }
    }
  }
)

async function pickDirectory(): Promise<void> {
  const dir = await window.api.dialog.selectDirectory()
  if (!dir) return
  parentDir.value = dir
  pathTouched.value = false
  // 浏览选择的是父目录；已填名称时拼出最终项目文件夹
  form.path = form.name.trim() ? `${dir}\\${safeFolderName(form.name)}` : dir
}

async function pickJdk(): Promise<void> {
  const dir = await window.api.dialog.selectDirectory()
  if (dir) form.jdkPath = dir
}

/** 进入第二步前确保模组/整合包已有版本选择 */
function goStepTwo(): void {
  if ((form.type === 'mod' || form.type === 'modpack') && (!form.mcVersion || !form.loaderVersion)) {
    initComboSelection()
  }
  step.value = 1
}

async function submit(): Promise<void> {
  submitting.value = true
  try {
    const input: CreateProjectInput = {
      name: form.name.trim(),
      type: form.type,
      path: form.path.trim()
    }
    if (form.type === 'mod') {
      input.modId = form.modId
      input.mcVersion = form.mcVersion
      input.loader = form.loader
      input.loaderVersion = form.loaderVersion
      if (form.jdkPath) input.jdkPath = form.jdkPath
    } else if (form.type === 'modpack') {
      input.loader = form.loader
      input.mcVersion = form.mcVersion
      input.loaderVersion = form.loaderVersion
    } else if (form.type === 'resourcepack' || form.type === 'datapack') {
      input.mcVersion = form.mcVersion
      if (form.namespace.trim()) input.namespace = form.namespace.trim()
    } else if (form.type === 'shaderpack') {
      input.mcVersion = form.mcVersion
      input.shaderLoader = form.shaderLoader
    }
    const project = await window.api.project.create(input)
    ElMessage.success(t('wizard.created', { name: project.name }))
    emit('created', project)
    emit('update:modelValue', false)
  } catch (err) {
    ElMessage.error(t('wizard.createFailed', { error: (err as Error).message }))
  } finally {
    submitting.value = false
  }
}

function reset(): void {
  Object.assign(form, defaultForm())
  step.value = 0
  parentDir.value = ''
  pathTouched.value = false
}
</script>

<style scoped>
.wizard-steps {
  margin-bottom: 24px;
}

/* footer 左侧缺项说明 + 右侧按钮组 */
.wizard-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.wizard-blocked-reason {
  font-size: 12px;
  color: var(--el-color-warning);
}

.wizard-footer-btns {
  display: flex;
  gap: 10px;
  margin-left: auto;
}

.wizard-body {
  min-height: 280px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  width: 100%;
}

.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 6px;
  background: var(--ky-bg-base);
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-panel);
  cursor: pointer;
  color: var(--ky-text-sub);
  font-size: 12px;
  transition: all 0.15s ease;
  font-family: inherit;
}

.type-card:hover {
  border-color: var(--ky-accent);
  color: var(--ky-text);
}

.type-card.active {
  background: rgba(var(--ky-accent-rgb), 0.12);
  border-color: var(--ky-accent);
  color: var(--ky-accent);
}

.path-row {
  width: 100%;
}

.form-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
  margin-top: 4px;
  line-height: 1.6;
}

.readonly {
  color: var(--ky-text);
  font-size: 13px;
}

.path-text {
  font-family: var(--ky-font-mono);
  font-size: 11px;
  color: var(--ky-text-sub);
  word-break: break-all;
}

/* 两个滚轮选择栏并排 */
.wheel-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
}

.wheel-col {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.wheel-caption {
  font-size: 11px;
  color: var(--ky-text-dim);
}

.combo-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.combo-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.combo-dot.is-green {
  background: #a6e3a1;
  box-shadow: 0 0 6px rgba(166, 227, 161, 0.7);
}

.combo-dot.is-yellow {
  background: #f9e2af;
}

.combo-dot.is-red {
  background: #f38ba8;
}

.combo-dot.is-unknown {
  background: #6c7086;
}

.combo-dot.is-deprecated {
  background: #45494f;
  box-shadow: none;
}

.migrate-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.migrate-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--ky-text);
}

.combo-meta {
  font-size: 11px;
  color: var(--ky-text-dim);
}

.combo-progress {
  width: 100%;
  margin-top: 6px;
}

.matrix-wrap {
  margin: 0 0 18px 100px;
}
</style>
