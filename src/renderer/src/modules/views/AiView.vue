<template>
  <div class="ai-view">
    <!-- 步骤指示器 -->
    <header class="av-head">
      <div class="av-steps">
        <template v-for="(s, i) in stepTitles" :key="s">
          <div class="av-step" :class="{ 'is-active': step === i + 1, 'is-done': step > i + 1 }">
            <span class="av-step-num">{{ step > i + 1 ? '✓' : i + 1 }}</span>
            <span class="av-step-title">{{ s }}</span>
          </div>
          <span v-if="i < stepTitles.length - 1" class="av-step-line" />
        </template>
      </div>
    </header>

    <div class="av-body">
      <!-- ============ Step 1：创意输入 ============ -->
      <section v-if="step === 1" class="av-pane av-pane-center">
        <img class="av-hero-icon" src="../../assets/app-icon.png" alt="KunYu Studio" />
        <h1 class="av-hero-title">KunYu Studio</h1>
        <p class="av-hero-sub">{{ heroSub }}</p>

        <!-- 未配置提供商 -->
        <div v-if="!hasProvider" class="av-empty">
          <p class="av-empty-title">{{ t('aiView.noProviderTitle') }}</p>
          <p class="av-empty-desc">{{ t('aiView.noProviderDesc') }}</p>
          <el-button type="primary" @click="openAiSettings">{{ t('aiView.addProvider') }}</el-button>
        </div>

        <template v-else>
          <el-input
            v-model="idea"
            type="textarea"
            :rows="4"
            resize="none"
            class="av-idea-input"
            :placeholder="ideaPlaceholder"
            @keydown.enter.exact.prevent="startPlan"
          />
          <div class="av-suggestions">
            <button
              v-for="s in suggestions"
              :key="s"
              type="button"
              class="av-chip"
              @click="idea = s"
            >{{ s }}</button>
          </div>

          <!-- 开始行：模组/整合包左右切换开关 + 开始 AI 规划 -->
          <div class="av-start-row">
            <div class="av-type-switch" role="group" :aria-label="t('aiView.typeSwitchAria')">
              <button
                type="button"
                class="av-type-opt"
                :class="{ 'is-active': projectType === 'mod' }"
                @click="setProjectType('mod')"
              >{{ t('aiView.makeMod') }}</button>
              <button
                type="button"
                class="av-type-opt"
                :class="{ 'is-active': projectType === 'modpack' }"
                @click="setProjectType('modpack')"
              >{{ t('aiView.makeModpack') }}</button>
            </div>
            <el-button
              type="primary"
              size="large"
              class="av-primary-btn"
              :disabled="!idea.trim()"
              @click="startPlan"
            >
              <el-icon class="av-btn-icon"><MagicStick /></el-icon>{{ t('aiView.startPlan') }}
            </el-button>
          </div>
        </template>
      </section>

      <!-- ============ Step 2：AI 规划 + 创意库 ============ -->
      <section v-else-if="step === 2" class="av-pane">
        <!-- 进度轨道：规划阶段驱动 understand，让用户看到 AI 正在拆解任务 -->
        <AgentTrack />

        <template v-if="planning">
          <div class="av-planning">
            <div class="av-planning-cube" />
            <p class="av-planning-title">{{ t('aiView.planningTitle') }}</p>
            <p class="av-planning-sub">{{ t('aiView.planningSub') }}</p>
            <el-button text @click="cancelPlan">{{ t('common.cancel') }}</el-button>
          </div>
        </template>

        <template v-else-if="planError">
          <div class="av-planning">
            <p class="av-planning-title">{{ t('aiView.planFailed') }}</p>
            <p class="av-planning-sub">{{ planError }}</p>
            <div class="av-row">
              <el-button @click="step = 1">{{ t('aiView.backToIdea') }}</el-button>
              <el-button type="primary" @click="startPlan">{{ t('aiView.retry') }}</el-button>
            </div>
          </div>
        </template>

        <template v-else-if="draft">
          <div class="av-section-head">
            <h2 class="av-section-title">{{ draft.suggestedName || t('aiView.planTitle', { type: typeLabel }) }}</h2>
            <p class="av-section-sub">{{ t('aiView.ideaPoolInfo', { n: pickedIds.size }) }}</p>
          </div>

          <div class="av-block">
            <div class="av-block-label">
              <span class="av-block-label-main">{{ t('aiView.summaryLabel') }}</span>
              <span class="av-block-label-sub">{{ t('aiView.summarySub') }}</span>
            </div>
            <el-input v-model="editableSummary" type="textarea" :rows="3" resize="none" />
          </div>

          <div class="av-block">
            <div class="av-block-label">
              <span class="av-block-label-main">{{ t('aiView.ideaLibLabel') }}</span>
              <span class="av-block-label-sub">{{ t('aiView.ideaLibSub') }}</span>
            </div>
            <div class="av-idea-grid">
              <div
                v-for="ideaItem in sortedIdeas"
                :key="ideaItem.id"
                class="av-idea-card"
                :class="{ 'is-picked': pickedIds.has(ideaItem.id) }"
                @click="toggleIdea(ideaItem.id)"
              >
                <span v-if="ideaItem.recommended" class="av-idea-badge">{{ t('aiView.recommended') }}</span>
                <button
                  v-if="pickedIds.has(ideaItem.id)"
                  type="button"
                  class="av-idea-remove"
                  :title="t('aiView.removeFromPool')"
                  @click.stop="toggleIdea(ideaItem.id)"
                >
                  <el-icon :size="12"><Close /></el-icon>
                </button>
                <p class="av-idea-title">{{ ideaItem.title }}</p>
                <p class="av-idea-desc">{{ ideaItem.description }}</p>
                <span class="av-idea-action">{{ pickedIds.has(ideaItem.id) ? t('aiView.picked') : t('aiView.pick') }}</span>
              </div>
            </div>
          </div>

          <div class="av-footer">
            <el-button @click="cancelPlan">{{ t('common.cancel') }}</el-button>
            <el-button :disabled="planning" @click="startPlan">{{ t('aiView.replan') }}</el-button>
            <el-button type="primary" class="av-primary-btn" @click="step = 3">{{ t('aiView.confirmBuild') }}</el-button>
          </div>
        </template>
      </section>

      <!-- ============ Step 3：构建配置 ============ -->
      <section v-else-if="step === 3" class="av-pane">
        <div class="av-section-head">
          <h2 class="av-section-title">{{ t('aiView.buildConfigTitle') }}</h2>
          <p class="av-section-sub">{{ t('aiView.buildConfigSub') }}</p>
        </div>

        <div class="av-block">
          <div class="av-block-label">
            <span class="av-block-label-main">{{ t('aiView.nameLabel', { type: typeLabel }) }}</span>
            <span class="av-block-label-sub">{{ t('aiView.nameSub') }}</span>
          </div>
          <el-input v-model="modName" :placeholder="draft?.suggestedName || t('aiView.namePlaceholder')" />
        </div>

        <div class="av-block">
          <div class="av-block-label"><span class="av-block-label-main">{{ t('aiView.loaderLabel') }}</span></div>
          <div class="av-loader-grid">
            <div
              v-for="l in loaderCards"
              :key="l.id"
              class="av-loader-card"
              :class="{ 'is-active': loader === l.id }"
              @click="onLoaderChange(l.id)"
            >
              <span class="av-loader-count">{{ t('aiView.versionCount', { n: loaderVersionCount(l.id) }) }}</span>
              <p class="av-loader-name">{{ l.label }}</p>
              <p class="av-loader-desc">{{ l.desc }}</p>
            </div>
          </div>
          <div class="av-version-row">
            <el-select v-model="mcVersion" :placeholder="t('aiView.mcVersionPlaceholder')" class="av-version-select">
              <el-option v-for="v in mcOptions" :key="v" :label="`MC ${v}`" :value="v" />
            </el-select>
            <el-select v-model="loaderVersion" :placeholder="t('aiView.loaderVersionPlaceholder')" class="av-version-select">
              <el-option v-for="v in loaderVersionOptions" :key="v" :label="v" :value="v" />
            </el-select>
          </div>
          <p v-if="isModpack" class="av-eula-hint">
            {{ t('aiView.modpackEulaNote') }}
          </p>
        </div>

        <div class="av-block">
          <div class="av-block-label">
            <span class="av-block-label-main">{{ t('aiView.tierLabel') }}</span>
            <span class="av-block-label-sub">{{ tierHint }}</span>
          </div>
          <div class="av-tier-grid" :style="{ gridTemplateColumns: `repeat(${tierCards.length}, 1fr)` }">
            <div
              v-for="tc in tierCards"
              :key="tc.id"
              class="av-tier-card"
              :class="{ 'is-active': tier === tc.id }"
              @click="tier = tc.id"
            >
              <p class="av-tier-name">{{ tc.name }}<span class="av-tier-title">{{ tc.title }}</span></p>
              <p class="av-tier-desc">{{ tc.positioning }}</p>
            </div>
          </div>
        </div>

        <div class="av-block">
          <div class="av-block-label">
            <span class="av-block-label-main">{{ t('aiView.pathLabel') }}</span>
            <span class="av-block-label-sub">{{ t('aiView.pathSub', { type: typeLabel }) }}</span>
          </div>
          <div class="av-path-row">
            <el-input :model-value="finalPath" readonly :placeholder="t('aiView.pathPlaceholder')" />
            <el-button @click="pickDirectory">
              <el-icon class="av-btn-icon"><FolderOpened /></el-icon>{{ t('aiView.browse') }}
            </el-button>
          </div>
        </div>

        <div class="av-footer">
          <el-button @click="step = 2">{{ t('aiView.back') }}</el-button>
          <el-button
            type="primary"
            size="large"
            class="av-primary-btn"
            :loading="creating"
            :disabled="!canStartBuild"
            @click="startBuild"
          >{{ t('aiView.startBuild') }}</el-button>
        </div>
      </section>

      <!-- ============ Step 4：制作中 / 完成 ============ -->
      <section v-else class="av-pane">
        <div class="av-section-head">
          <h2 class="av-section-title">
            {{ buildDone ? t('aiView.buildDone') : t('aiView.building') }} · {{ buildingName }}
          </h2>
          <p class="av-section-sub">
            <span class="av-status-dot" :class="buildDotClass" />
            {{ buildStatusText }} · {{ t('aiView.artifactCount', { n: artifactCount }) }}
          </p>
        </div>

        <!-- 五节点流水线轨道（复用 Agent 面板同款组件） -->
        <AgentTrack />

        <div class="av-stage-list">
          <div v-for="s in agents.stages" :key="s.id" class="av-stage-row">
            <span class="av-status-dot" :class="phaseDotClass(s.phase)" />
            <div class="av-stage-main">
              <div class="av-stage-head">
                <span class="av-stage-name">{{ s.name }} · {{ s.title }}</span>
                <span v-if="s.artifacts.length" class="av-stage-count">{{ t('aiView.stageOutputs', { n: s.artifacts.length }) }}</span>
              </div>
              <p class="av-stage-action">{{ s.action }}</p>
              <p v-if="s.logs.length" class="av-stage-log">{{ s.logs[s.logs.length - 1] }}</p>
            </div>
          </div>
        </div>

        <div v-if="buildDone && agents.lastReply" class="av-reply">
          <div class="av-block-label"><span class="av-block-label-main">{{ t('aiView.summaryTitle') }}</span></div>
          <p class="av-reply-text">{{ agents.lastReply }}</p>
        </div>

        <div class="av-footer">
          <template v-if="!buildDone">
            <el-button type="danger" plain @click="agents.cancel()">{{ t('aiView.cancelBuild') }}</el-button>
          </template>
          <template v-else>
            <el-button @click="resetAll">{{ t('aiView.makeAnother') }}</el-button>
            <el-button type="primary" class="av-primary-btn" @click="openUnifiedEditor">
              {{ t('aiView.openWorkshop') }}
            </el-button>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, FolderOpened, MagicStick } from '@element-plus/icons-vue'
import AgentTrack from '../../components/ai/AgentTrack.vue'
import { useAiAgentsStore } from '../../stores/aiAgents'
import { useAiMonitorStore } from '../../stores/aiMonitor'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import { useI18n } from '../../i18n'
import { TIER_CONFIGS, type TierId } from '../../../../shared/types/tiers'
import type { ModLoader } from '../../../../shared/types/project'
import type { ComboMatrixCell } from '../../../../shared/types/monitor'
import type { ModPlanDraft, PlanProjectType } from '../../../../shared/types/planner'
import type { AgentPhaseState } from '../../../../shared/types/agent'

const { t } = useI18n()

const stepTitles = computed(() => [t('aiView.step1'), t('aiView.step2'), t('aiView.step3'), t('aiView.step4')])

const loaderCards = computed<{ id: ModLoader; label: string; desc: string }[]>(() => [
  { id: 'fabric', label: 'Fabric', desc: t('aiView.loaderFabricDesc') },
  { id: 'neoforge', label: 'NeoForge', desc: t('aiView.loaderNeoforgeDesc') },
  { id: 'forge', label: 'Forge', desc: t('aiView.loaderForgeDesc') }
])

/** 各制作类型开放的档位：模组三档创作；整合包走织星档（配包子任务调度） */
const TIER_IDS_BY_TYPE: Record<PlanProjectType, TierId[]> = {
  mod: ['sprinter', 'artisan', 'master'],
  modpack: ['weaver']
}

const DEFAULT_TIER_BY_TYPE: Record<PlanProjectType, TierId> = {
  mod: 'artisan',
  modpack: 'weaver'
}

const agents = useAiAgentsStore()
const monitor = useAiMonitorStore()
const projectStore = useProjectStore()
const settings = useSettingsStore()
const ui = useUiStore()

// ---------------- 向导状态 ----------------
const step = ref(1)
/** 制作类型：模组 / 整合包（Step1 开关控制，驱动规划提示词、档位与项目创建） */
const projectType = ref<PlanProjectType>('mod')
const idea = ref('')

const isModpack = computed(() => projectType.value === 'modpack')
const typeLabel = computed(() => (isModpack.value ? t('aiView.typeModpack') : t('aiView.typeMod')))
const heroSub = computed(() => (isModpack.value ? t('aiView.heroModpack') : t('aiView.heroMod')))
const ideaPlaceholder = computed(() => (isModpack.value ? t('aiView.placeholderModpack') : t('aiView.placeholderMod')))
const suggestions = computed(() =>
  isModpack.value
    ? [t('aiView.sugModpack1'), t('aiView.sugModpack2'), t('aiView.sugModpack3'), t('aiView.sugModpack4')]
    : [t('aiView.sugMod1'), t('aiView.sugMod2'), t('aiView.sugMod3'), t('aiView.sugMod4')]
)

const tierCards = computed(() =>
  TIER_IDS_BY_TYPE[projectType.value].map((id) => ({
    id,
    name: TIER_CONFIGS[id].name,
    title: TIER_CONFIGS[id].title,
    positioning: TIER_CONFIGS[id].positioning
  }))
)
const tierHint = computed(() =>
  isModpack.value
    ? t('aiView.tierHintModpack')
    : t('aiView.tierHintMod')
)

// Step 3 的档位提前声明：setProjectType 需要切换默认档位
const tier = ref<TierId>('artisan')

function setProjectType(type: PlanProjectType): void {
  if (projectType.value === type) return
  projectType.value = type
  tier.value = DEFAULT_TIER_BY_TYPE[type]
}

// Step 2：规划
const planning = ref(false)
const planError = ref('')
const draft = ref<ModPlanDraft | null>(null)
const editableSummary = ref('')
/** 想法池：已挑中的创意 id */
const pickedIds = ref<Set<string>>(new Set())
/** 规划请求序号：迟到的响应直接丢弃（用户点了取消/重新规划） */
let planSeq = 0

// Step 3：构建配置
const modName = ref('')
const loader = ref<ModLoader>('fabric')
const mcVersion = ref('1.20.1')
const loaderVersion = ref('')
const parentDir = ref('')
const creating = ref(false)

// Step 4：制作
const buildStarted = ref(false)
const buildingName = ref('')

const hasProvider = computed(
  () => settings.ai.providers.some((p) => p.enabled) && Boolean(settings.ai.defaultProviderId)
)

/** 监测状态不可用时的兜底组合（与新建项目向导一致） */
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
    note: '内置兜底数据'
  }
]

const cells = computed<ComboMatrixCell[]>(() =>
  monitor.monitor?.cells.length ? monitor.monitor.cells : FALLBACK_CELLS
)

const loaderCells = computed(() => cells.value.filter((c) => c.loader === loader.value))

function loaderVersionCount(id: ModLoader): number {
  return new Set(cells.value.filter((c) => c.loader === id).map((c) => c.mcVersion)).size
}

/** MC 版本选项：同加载器下去重，优先 active 组合排前 */
const mcOptions = computed<string[]>(() => {
  const seen = new Map<string, boolean>()
  for (const c of loaderCells.value) {
    const prev = seen.get(c.mcVersion)
    if (prev === undefined || (c.active && !prev)) seen.set(c.mcVersion, c.active)
  }
  return [...seen.entries()].sort((a, b) => Number(b[1]) - Number(a[1])).map(([v]) => v)
})

const loaderVersionOptions = computed<string[]>(() => {
  const matched = loaderCells.value.filter((c) => c.mcVersion === mcVersion.value)
  const pool = matched.length ? matched : loaderCells.value
  return [...new Set(pool.map((c) => c.loaderVersion))]
})

/** 推荐创意置顶，其余保持原顺序 */
const sortedIdeas = computed(() => {
  if (!draft.value) return []
  return [...draft.value.ideas].sort((a, b) => Number(b.recommended) - Number(a.recommended))
})

const effectiveName = computed(() => modName.value.trim() || draft.value?.suggestedName || '')

const finalPath = computed(() => {
  if (!parentDir.value) return ''
  const fallback = isModpack.value ? 'kunyu-modpack' : 'kunyu-mod'
  const folder = safeFolderName(effectiveName.value) || fallback
  return `${parentDir.value}\\${folder}`
})

const canStartBuild = computed(
  () => Boolean(parentDir.value) && Boolean(mcVersion.value) && Boolean(loaderVersion.value) && !creating.value && !agents.running
)

// ---------------- Step 4 派生状态 ----------------
const buildDone = computed(() => buildStarted.value && !agents.running)
const artifactCount = computed(() =>
  agents.stages.reduce((n, s) => n + s.artifacts.length, 0)
)
const buildStatusText = computed(() => {
  if (!buildStarted.value) return t('aiView.statusCreating')
  if (agents.running) return agents.activeStage ? t('aiView.statusStageBusy', { name: agents.activeStage.name }) : t('aiView.statusBusy')
  if (agents.canceled) return t('aiView.statusCanceled')
  // 无最终回复 = 运行未能启动/中途失败（错误详情在右侧 AI 面板会话里）
  return agents.lastReply ? t('aiView.statusDone') : t('aiView.statusFailed')
})
const buildDotClass = computed(() => {
  if (!buildStarted.value || agents.running) return 'is-busy'
  if (agents.canceled || !agents.lastReply) return 'is-fail'
  return 'is-ok'
})

function phaseDotClass(phase: AgentPhaseState): string {
  switch (phase) {
    case 'running':
      return 'is-busy'
    case 'done':
      return 'is-ok'
    case 'error':
      return 'is-fail'
    default:
      return 'is-idle'
  }
}

// ---------------- 行为 ----------------
function openAiSettings(): void {
  ui.setSettingsCategory('ai')
  ui.setActiveModule('settings', { rememberForSettings: true })
}

async function startPlan(): Promise<void> {
  const text = idea.value.trim()
  if (!text || planning.value) return
  const seq = ++planSeq
  planning.value = true
  planError.value = ''
  step.value = 2
  // 驱动 AgentTrack 的 understand 阶段：让用户看到 AI 正在拆解任务
  agents.beginPlanning(text)
  try {
    const res = await window.api.agent.plan(text, projectType.value)
    if (seq !== planSeq) return // 已取消/重新规划
    if (!res.ok) {
      planError.value = res.errorMessage
      agents.finishPlanning(false, res.errorMessage)
      return
    }
    draft.value = res.plan
    editableSummary.value = res.plan.summary
    // 默认把推荐创意放进想法池
    pickedIds.value = new Set(res.plan.ideas.filter((i) => i.recommended).map((i) => i.id))
    if (!modName.value && res.plan.suggestedName) modName.value = res.plan.suggestedName
    agents.finishPlanning(true, res.plan.summary)
  } catch (err) {
    if (seq !== planSeq) return
    const msg = (err as Error).message
    planError.value = msg
    agents.finishPlanning(false, msg)
  } finally {
    if (seq === planSeq) planning.value = false
  }
}

function cancelPlan(): void {
  planSeq++ // 让进行中的规划响应失效
  planning.value = false
  planError.value = ''
  step.value = 1
}

function toggleIdea(id: string): void {
  const next = new Set(pickedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  pickedIds.value = next
}

function onLoaderChange(id: ModLoader): void {
  loader.value = id
  // 切换到当前加载器的首选组合（优先 active）
  const group = cells.value.filter((c) => c.loader === id)
  const preferred = group.find((c) => c.active) ?? group[0]
  if (preferred) {
    mcVersion.value = preferred.mcVersion
    loaderVersion.value = preferred.loaderVersion
  }
}

async function pickDirectory(): Promise<void> {
  const dir = await window.api.dialog.selectDirectory()
  if (dir) parentDir.value = dir
}

function safeFolderName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '_')
}

/** 组合交给流水线的完整制作需求：原始创意 + 规划概要 + 想法池创意 */
function buildMessage(): string {
  const picked = (draft.value?.ideas ?? []).filter((i) => pickedIds.value.has(i.id))
  const parts = [
    isModpack.value
      ? `【整合包创意】${idea.value.trim()}`
      : `【模组创意】${idea.value.trim()}`,
    `【规划概要】${editableSummary.value.trim()}`
  ]
  if (picked.length > 0) {
    parts.push(
      '【选中的创意方向】\n' +
        picked.map((i, idx) => `${idx + 1}. ${i.title}：${i.description}`).join('\n')
    )
  }
  parts.push(
    isModpack.value
      ? '请按以上规划，在这个新整合包项目里完成配装：从市场安装所需模组、写好配置与 overrides，产出可启动的整合包。'
      : '请按以上规划，在这个新项目里把模组完整做出来。'
  )
  return parts.join('\n\n')
}

async function startBuild(): Promise<void> {
  if (!canStartBuild.value) return
  creating.value = true
  try {
    const dateName = new Date().toLocaleDateString('zh-CN')
    const name = effectiveName.value || (isModpack.value ? t('aiView.defaultNameModpack', { date: dateName }) : t('aiView.defaultNameMod', { date: dateName }))

    if (isModpack.value) {
      // 整合包：只持久化 loader/mcVersion/loaderVersion（清单必需），无 modId/namespace
      const project = await projectStore.create({
        name,
        type: 'modpack',
        path: finalPath.value,
        loader: loader.value,
        mcVersion: mcVersion.value,
        loaderVersion: loaderVersion.value,
        description: editableSummary.value.trim()
      })
      await projectStore.open(project.id)

      buildingName.value = name
      agents.setTier(tier.value)
      agents.setTarget(loader.value, mcVersion.value)
      buildStarted.value = true
      step.value = 4
      await agents.run(buildMessage())
      return
    }

    // modId 必须过注册名强校验；中文名派生不出合法 id 时给时间戳兜底
    let modId = await window.api.project.deriveModId(name)
    if (!/^[a-z][a-z0-9_]*$/.test(modId)) {
      modId = `aimod${Date.now().toString(36)}`
    }
    const project = await projectStore.create({
      name,
      type: 'mod',
      path: finalPath.value,
      loader: loader.value,
      mcVersion: mcVersion.value,
      loaderVersion: loaderVersion.value,
      modId,
      namespace: modId,
      description: editableSummary.value.trim()
    })
    await projectStore.open(project.id)

    buildingName.value = name
    agents.setTier(tier.value)
    agents.setTarget(loader.value, mcVersion.value)
    buildStarted.value = true
    step.value = 4
    // 失败文案由 store 写入 AI 面板会话；此处仅保证视图进入制作态
    await agents.run(buildMessage())
  } catch (err) {
    ElMessage.error(t('aiView.createFailed', { msg: (err as Error).message }))
  } finally {
    creating.value = false
  }
}

function openUnifiedEditor(): void {
  ui.setActiveModule('unified')
}

function resetAll(): void {
  step.value = 1
  idea.value = ''
  draft.value = null
  editableSummary.value = ''
  pickedIds.value = new Set()
  planError.value = ''
  modName.value = ''
  buildStarted.value = false
  buildingName.value = ''
}

onMounted(async () => {
  // 版本矩阵（加载器/MC 版本选项）；失败时走兜底组合
  await monitor.init().catch(() => undefined)
  // 自动选当前加载器的首选 active 组合，避免加载器版本留空导致无法开始制作
  onLoaderChange(loader.value)
})
</script>

<style scoped>
.ai-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ---------- 步骤指示器 ---------- */
.av-head {
  padding: 14px 24px 0;
}
.av-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.av-step {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ky-text-dim, #909399);
  font-size: 13px;
}
.av-step-num {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  border: 1px solid var(--ky-text-dim, #909399);
}
.av-step.is-active {
  color: var(--ky-accent);
}
.av-step.is-active .av-step-num {
  border-color: var(--ky-accent);
  background: var(--ky-accent);
  color: #11111b;
  font-weight: 600;
}
.av-step.is-done {
  color: var(--ky-accent);
}
.av-step.is-done .av-step-num {
  border-color: var(--ky-accent);
  color: var(--ky-accent);
}
.av-step-line {
  width: 42px;
  height: 1px;
  background: var(--el-border-color, #3a3a44);
}

/* ---------- 主体 ---------- */
.av-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 28px;
}
.av-pane {
  max-width: 860px;
  margin: 0 auto;
}
.av-pane-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding-top: 6vh;
}
.av-hero-icon {
  width: 72px;
  height: 72px;
  object-fit: cover;
}
.av-hero-title {
  margin: 12px 0 8px;
  font-size: 26px;
  font-weight: 700;
}
.av-hero-sub {
  margin: 0 0 24px;
  color: var(--ky-text-dim, #909399);
  font-size: 14px;
}
.av-idea-input {
  width: 100%;
  max-width: 640px;
}
.av-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin: 14px 0 22px;
  max-width: 640px;
}
.av-chip {
  border: 1px solid var(--el-border-color, #3a3a44);
  background: transparent;
  color: var(--ky-text-dim, #b0b0ba);
  border-radius: 14px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.av-chip:hover {
  border-color: var(--ky-accent);
  color: var(--ky-accent);
}

/* 开始行：类型开关 + 主按钮 */
.av-start-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* 模组/整合包 左右切换开关 */
.av-type-switch {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--el-border-color, #3a3a44);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.03);
}
.av-type-opt {
  border: none;
  background: transparent;
  color: var(--ky-text-dim, #b0b0ba);
  font-size: 13px;
  font-weight: 600;
  padding: 7px 18px;
  border-radius: 18px;
  cursor: pointer;
  transition: all 0.18s ease;
}
.av-type-opt:hover {
  color: var(--ky-text, #e6e6ef);
}
.av-type-opt.is-active {
  background: var(--ky-accent);
  color: #11111b;
}

/* 整合包 EULA 提示 */
.av-eula-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
  line-height: 1.6;
}
.av-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.av-empty-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.av-empty-desc {
  color: var(--ky-text-dim, #909399);
  font-size: 13px;
  margin: 0 0 8px;
  max-width: 420px;
}

/* 主按钮：品牌蓝底白字 */
.av-primary-btn {
  --el-button-bg-color: var(--ky-accent);
  --el-button-border-color: var(--ky-accent);
  --el-button-text-color: #ffffff;
  --el-button-hover-bg-color: var(--ky-accent-hover);
  --el-button-hover-border-color: var(--ky-accent-hover);
  --el-button-hover-text-color: #ffffff;
  --el-button-active-bg-color: var(--ky-accent-active);
  --el-button-active-border-color: var(--ky-accent-active);
  font-weight: 600;
}
.av-btn-icon {
  margin-right: 4px;
}

/* ---------- Step 2 规划 ---------- */
.av-planning {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10vh 0 0;
}
.av-planning-cube {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--ky-accent);
  animation: av-cube-breathe 1.2s ease-in-out infinite;
}
@keyframes av-cube-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(0.82);
    opacity: 0.6;
  }
}
.av-planning-title {
  font-size: 16px;
  font-weight: 600;
  margin: 10px 0 0;
}
.av-planning-sub {
  color: var(--ky-text-dim, #909399);
  font-size: 13px;
  margin: 0 0 12px;
}
.av-row {
  display: flex;
  gap: 10px;
}

.av-section-head {
  margin-bottom: 16px;
}
.av-section-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
}
.av-section-sub {
  margin: 0;
  color: var(--ky-text-dim, #909399);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.av-block {
  margin-bottom: 18px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color, #3a3a44);
  border-radius: 8px;
}
.av-block-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}
.av-block-label-main {
  color: var(--ky-accent);
  font-size: 13px;
  font-weight: 600;
}
.av-block-label-sub {
  color: var(--ky-text-dim, #909399);
  font-size: 12px;
}

.av-idea-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.av-idea-card {
  position: relative;
  border: 1px solid var(--el-border-color, #3a3a44);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.av-idea-card:hover {
  border-color: var(--ky-accent);
}
.av-idea-card.is-picked {
  border-color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.06);
}
.av-idea-badge {
  position: absolute;
  top: -1px;
  right: -1px;
  background: var(--ky-accent);
  color: #11111b;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 0 8px 0 8px;
}
.av-idea-remove {
  position: absolute;
  bottom: 8px;
  right: 8px;
  border: none;
  background: transparent;
  color: var(--ky-text-dim, #909399);
  cursor: pointer;
  padding: 2px;
}
.av-idea-remove:hover {
  color: #f56c6c;
}
.av-idea-title {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 600;
}
.av-idea-desc {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--ky-text-dim, #b0b0ba);
  line-height: 1.6;
}
.av-idea-action {
  font-size: 12px;
  color: var(--ky-accent);
}

/* ---------- Step 3 配置 ---------- */
.av-loader-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.av-loader-card {
  position: relative;
  border: 1px solid var(--el-border-color, #3a3a44);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
}
.av-loader-card:hover {
  border-color: var(--ky-accent);
}
.av-loader-card.is-active {
  border-color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.06);
}
.av-loader-count {
  position: absolute;
  top: 10px;
  right: 12px;
  font-size: 11px;
  color: var(--ky-text-dim, #909399);
}
.av-loader-name {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
}
.av-loader-desc {
  margin: 0;
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
}
.av-version-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}
.av-version-select {
  flex: 1;
}

.av-tier-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.av-tier-card {
  border: 1px solid var(--el-border-color, #3a3a44);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
}
.av-tier-card:hover {
  border-color: var(--ky-accent);
}
.av-tier-card.is-active {
  border-color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.06);
}
.av-tier-name {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 700;
}
.av-tier-title {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--ky-text-dim, #909399);
}
.av-tier-desc {
  margin: 0;
  font-size: 12px;
  color: var(--ky-text-dim, #909399);
}

.av-path-row {
  display: flex;
  gap: 10px;
}

/* ---------- Step 4 制作 ---------- */
.av-status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.av-status-dot.is-ok {
  background: #67c23a;
  box-shadow: 0 0 6px rgba(103, 194, 58, 0.5);
}
.av-status-dot.is-busy {
  background: #e6a23c;
  box-shadow: 0 0 6px rgba(230, 162, 60, 0.5);
  animation: av-pulse 1.2s ease-in-out infinite;
}
.av-status-dot.is-fail {
  background: #f56c6c;
}
.av-status-dot.is-idle {
  background: #909399;
}
@keyframes av-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.av-stage-list {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.av-stage-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border: 1px solid var(--el-border-color, #3a3a44);
  border-radius: 8px;
  padding: 10px 12px;
}
.av-stage-row .av-status-dot {
  margin-top: 6px;
}
.av-stage-main {
  flex: 1;
  min-width: 0;
}
.av-stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.av-stage-name {
  font-size: 13px;
  font-weight: 600;
}
.av-stage-count {
  font-size: 11px;
  color: var(--ky-accent);
}
.av-stage-action {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--ky-text-dim, #b0b0ba);
}
.av-stage-log {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--ky-text-dim, #909399);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.av-reply {
  margin-top: 16px;
  border: 1px solid var(--el-border-color, #3a3a44);
  border-radius: 8px;
  padding: 14px 16px;
}
.av-reply-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.av-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
</style>
