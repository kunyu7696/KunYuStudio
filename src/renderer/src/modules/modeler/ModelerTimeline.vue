<template>
  <section v-if="store.doc" class="mt">
    <!-- 头部：折叠 / 动画选择与 CRUD / 属性 / 播放控制 -->
    <div class="mt-head">
      <el-icon class="mt-fold" :title="collapsed ? t('modeler.timeline.expand') : t('modeler.timeline.collapse')" @click="collapsed = !collapsed">
        <ArrowRight v-if="collapsed" /><ArrowDown v-else />
      </el-icon>
      <span class="mt-title">{{ t('modeler.timeline.title') }}</span>

      <template v-if="animSupported">
        <el-select
          class="mt-anim-select"
          size="small"
          :model-value="player.activeAnimId.value ?? ''"
          :placeholder="t('modeler.timeline.selectAnim')"
          @update:model-value="onSelectAnim"
        >
          <el-option :label="t('modeler.timeline.noPlay')" value="" />
          <el-option v-for="a in animList" :key="a.id" :label="a.name" :value="a.id" />
        </el-select>
        <el-button size="small" :icon="Plus" :title="t('modeler.timeline.newAnim')" @click="onCreateAnim" />
        <el-button
          size="small"
          :icon="Delete"
          :title="t('modeler.timeline.removeAnim')"
          :disabled="!activeAnim"
          @click="onRemoveAnim"
        />
        <el-button
          size="small"
          :icon="Upload"
          :title="t('modeler.timeline.importAnim')"
          @click="store.importAnimations()"
        />
        <el-button
          size="small"
          :icon="Download"
          :title="t('modeler.timeline.exportAnim')"
          :disabled="animList.length === 0"
          @click="store.exportAnimations()"
        />

        <template v-if="activeAnim">
          <el-divider direction="vertical" />
          <el-input
            class="mt-name"
            size="small"
            :model-value="activeAnim.name"
            :title="t('modeler.timeline.animName')"
            @update:model-value="onRenameAnim"
          />
          <span class="mt-label">{{ t('modeler.timeline.duration') }}</span>
          <el-input-number
            class="mt-num"
            size="small"
            :model-value="activeAnim.length"
            :min="0.05"
            :max="120"
            :step="0.05"
            :controls="false"
            @change="onLengthChange"
          />
          <el-select
            class="mt-loop"
            size="small"
            :model-value="activeAnim.loop"
            :title="t('modeler.timeline.loopMode')"
            @update:model-value="onLoopChange"
          >
            <el-option :label="t('modeler.timeline.loop')" value="loop" />
            <el-option :label="t('modeler.timeline.once')" value="once" />
            <el-option :label="t('modeler.timeline.hold')" value="hold" />
          </el-select>

          <el-divider direction="vertical" />
          <el-button-group>
            <el-button size="small" :icon="RefreshLeft" :title="t('modeler.timeline.backToStart')" @click="player.stop()" />
            <el-button
              size="small"
              :icon="player.playing.value ? VideoPause : VideoPlay"
              :title="player.playing.value ? t('modeler.timeline.pause') : t('modeler.timeline.play')"
              @click="player.toggle()"
            />
          </el-button-group>
          <span class="mt-time">{{ displayTime.toFixed(2) }} / {{ activeAnim.length.toFixed(2) }}s</span>
          <el-button
            size="small"
            :title="controllerBadge"
            @click="controllerDialogOpen = true"
            >{{ t('modeler.timeline.controller') }}</el-button
          >
        </template>
      </template>
      <span v-else class="mt-hint">{{ t('modeler.timeline.unsupported') }}</span>
    </div>

    <!-- B1-2 动画控制器编辑弹窗：状态机定义「什么时候播什么动画」 -->
    <el-dialog v-model="controllerDialogOpen" :title="t('modeler.timeline.controllerDialogTitle')" width="560px">
      <div v-if="store.doc" class="mtc">
        <div v-if="controller" class="mtc-body">
          <div class="mtc-row">
            <span class="mt-label">{{ t('modeler.timeline.initialState') }}</span>
            <el-select
              size="small"
              :model-value="controller.initialState"
              @update:model-value="onCtrlInitialChange"
            >
              <el-option v-for="s in controller.states" :key="s.name" :label="s.name" :value="s.name" />
            </el-select>
          </div>

          <div class="mtc-section">
            <div class="mtc-section-head">
              <span>{{ t('modeler.timeline.statesSection') }}</span>
              <el-button size="small" :icon="Plus" @click="onCtrlAddState">{{ t('modeler.timeline.addState') }}</el-button>
            </div>
            <div v-for="(s, i) in controller.states" :key="i" class="mtc-state-row">
              <el-input
                size="small"
                class="mtc-state-name"
                :model-value="s.name"
                :placeholder="t('modeler.timeline.stateName')"
                @update:model-value="(v: string) => onCtrlRenameState(i, v)"
              />
              <el-select
                size="small"
                class="mtc-state-anim"
                :model-value="s.animation"
                :placeholder="t('modeler.timeline.refAnim')"
                @update:model-value="(v: string) => onCtrlStateAnim(i, v)"
              >
                <el-option v-for="a in animList" :key="a.id" :label="a.name" :value="a.id" />
              </el-select>
              <el-button size="small" link type="danger" @click="onCtrlRemoveState(i)">{{ t('modeler.timeline.delete') }}</el-button>
            </div>
          </div>

          <div class="mtc-section">
            <div class="mtc-section-head">
              <span>{{ t('modeler.timeline.transitionsSection') }}</span>
              <el-button size="small" :icon="Plus" :disabled="controller.states.length < 2" @click="onCtrlAddTransition">{{ t('modeler.timeline.addTransition') }}</el-button>
            </div>
            <div v-for="(tr, i) in controller.transitions" :key="i" class="mtc-trans-row">
              <el-select size="small" :model-value="tr.from" @update:model-value="(v: string) => onCtrlTransition(i, 'from', v)">
                <el-option v-for="s in controller.states" :key="s.name" :label="s.name" :value="s.name" />
              </el-select>
              <span class="mt-label">→</span>
              <el-select size="small" :model-value="tr.to" @update:model-value="(v: string) => onCtrlTransition(i, 'to', v)">
                <el-option v-for="s in controller.states" :key="s.name" :label="s.name" :value="s.name" />
              </el-select>
              <el-select size="small" :model-value="tr.condition" @update:model-value="(v: string) => onCtrlTransition(i, 'condition', v)">
                <el-option v-for="c in CONTROLLER_CONDITIONS" :key="c" :label="conditionText(c)" :value="c" />
              </el-select>
              <el-button size="small" link type="danger" @click="onCtrlRemoveTransition(i)">{{ t('modeler.timeline.delete') }}</el-button>
            </div>
          </div>

          <div v-if="controllerIssues.length > 0" class="mtc-issues">
            <div v-for="(iss, i) in controllerIssues" :key="i" class="mtc-issue">⚠ {{ iss.message }}</div>
          </div>
          <div v-else class="mtc-ok">{{ t('modeler.timeline.controllerOk') }}</div>
        </div>
        <div v-else class="mtc-empty">
          <p>{{ t('modeler.timeline.controllerEmpty') }}</p>
          <el-button size="small" type="primary" :disabled="animList.length === 0" @click="onCtrlCreate">
            {{ t('modeler.timeline.createFromAnims') }}
          </el-button>
          <p v-if="animList.length === 0" class="mt-hint">{{ t('modeler.timeline.needAnim') }}</p>
        </div>
        <div class="mtc-foot">
          <template v-if="controller">
            <el-button size="small" type="danger" plain @click="onCtrlRemove">{{ t('modeler.timeline.removeController') }}</el-button>
            <el-button size="small" @click="store.exportController()">{{ t('modeler.timeline.exportController') }}</el-button>
          </template>
          <el-button size="small" @click="store.importController()">{{ t('modeler.timeline.importController') }}</el-button>
          <span class="mt-hint">{{ t('modeler.timeline.controllerFormat') }}</span>
        </div>
      </div>
    </el-dialog>

    <!-- 时间线主体 -->
    <div v-show="!collapsed" v-if="animSupported && activeAnim" class="mt-body">
      <div class="mt-scroll">
        <div class="mt-canvas" :style="{ width: `${canvasWidth}px` }">
          <!-- 标尺行 -->
          <div class="mt-row mt-ruler-row">
            <div class="mt-row-head mt-corner" />
            <div ref="rulerRef" class="mt-lane mt-ruler" @pointerdown="onScrubStart">
              <div
                v-for="tick in ticks"
                :key="tick"
                class="mt-tick"
                :class="{ 'is-major': tick % 1 === 0 }"
                :style="{ left: `${tick * PX}px` }"
              >
                <span v-if="tick % 1 === 0" class="mt-tick-label">{{ tick }}</span>
              </div>
            </div>
          </div>

          <!-- 轨道行（骨骼 × 通道） -->
          <div v-for="row in rows" :key="`${row.nodeId}:${row.channel}`" class="mt-row">
            <div class="mt-row-head" :title="`${row.nodeName} · ${row.channelLabel}`">
              <span class="mt-row-name">{{ row.nodeName }}</span>
              <span class="mt-row-channel">{{ row.channelLabel }}</span>
              <el-icon
                class="mt-row-add"
                :title="t('modeler.timeline.addKeyTip')"
                @pointerdown.stop
                @click="onAddKey(row)"
                ><Plus
              /></el-icon>
            </div>
            <div class="mt-lane" @pointerdown="onScrubStart">
              <div
                v-for="kf in row.keys"
                :key="kf.time"
                class="mt-key"
                :class="[`is-${kf.interpolation}`, { 'is-selected': isKeySelected(row, kf.time) }]"
                :style="{ left: `${kf.time * PX}px` }"
                :title="keyTitle(kf)"
                @pointerdown.stop="onKeyPointerDown($event, row, kf.time)"
              />
            </div>
          </div>

          <div v-if="rows.length === 0" class="mt-empty">
            {{ t('modeler.timeline.emptyTracks') }}
          </div>

          <!-- 播放头贯穿线 -->
          <div class="mt-playhead" :style="{ left: `${HEAD_W + displayTime * PX}px` }" />
        </div>
      </div>

      <!-- 选中关键帧编辑条：时间（移动）/ 数值 / 插值 / 删除 -->
      <div v-if="selectedKey" class="mt-keybar">
        <span class="mt-keybar-title">{{ selectedKey.nodeName }} · {{ selectedKey.channelLabel }}</span>
        <span class="mt-label">{{ t('modeler.timeline.time') }}</span>
        <el-input-number
          class="mt-num"
          size="small"
          :model-value="selectedKey.kf.time"
          :min="0"
          :max="activeAnim.length"
          :step="0.05"
          :controls="false"
          @change="onKeyTimeChange"
        />
        <span class="mt-label">{{ t('modeler.timeline.valueXyz') }}</span>
        <el-input-number
          v-for="i in [0, 1, 2]"
          :key="i"
          class="mt-num"
          size="small"
          :model-value="selectedKey.kf.value[i]"
          :controls="false"
          @change="(v: number | undefined) => onKeyValueChange(i, v)"
        />
        <el-select
          class="mt-interp"
          size="small"
          :model-value="selectedKey.kf.interpolation"
          :title="t('modeler.timeline.interpolationTip')"
          @update:model-value="onKeyInterpChange"
        >
          <el-option :label="t('modeler.timeline.interpLinear')" value="linear" />
          <el-option :label="t('modeler.timeline.interpSmooth')" value="catmullrom" />
          <el-option :label="t('modeler.timeline.interpStep')" value="step" />
        </el-select>
        <template v-if="selectedKey.kf.interpolation === 'linear'">
          <el-select
            class="mt-easing"
            size="small"
            :model-value="easingPresetName"
            :title="t('modeler.timeline.easingTip')"
            @update:model-value="onEasingPresetChange"
          >
            <el-option :label="t('modeler.timeline.easingLinear')" value="linear" />
            <el-option :label="t('modeler.timeline.easeIn')" value="easeIn" />
            <el-option :label="t('modeler.timeline.easeOut')" value="easeOut" />
            <el-option :label="t('modeler.timeline.easeInOut')" value="easeInOut" />
            <el-option :label="t('modeler.timeline.easeBack')" value="easeOutBack" />
            <el-option v-if="easingPresetName === 'custom'" :label="t('modeler.timeline.custom')" value="custom" />
          </el-select>
          <el-popover trigger="click" placement="top" :width="240">
            <template #reference>
              <el-button size="small" :title="t('modeler.timeline.curveTip')">{{ t('modeler.timeline.curve') }}</el-button>
            </template>
            <div class="mt-curve">
              <svg
                class="mt-curve-svg"
                :viewBox="`0 0 ${CURVE_W} ${CURVE_H}`"
                @pointerdown="onCurvePointerDown"
                @pointermove="onCurvePointerMove"
                @pointerup="onCurvePointerUp"
                @pointerleave="onCurvePointerUp"
              >
                <!-- 单位方框（t ∈ [0,1] × y ∈ [0,1]）与零线 -->
                <rect
                  :x="CURVE_PAD"
                  :y="curveY(1)"
                  :width="CURVE_W - CURVE_PAD * 2"
                  :height="curveY(0) - curveY(1)"
                  class="mt-curve-unit"
                />
                <polyline class="mt-curve-line" :points="curvePolyline" />
                <!-- 控制点连线 -->
                <line
                  :x1="curveX(0)"
                  :y1="curveY(0)"
                  :x2="curveX(easingCp[0])"
                  :y2="curveY(easingCp[1])"
                  class="mt-curve-handle"
                />
                <line
                  :x1="curveX(1)"
                  :y1="curveY(1)"
                  :x2="curveX(easingCp[2])"
                  :y2="curveY(easingCp[3])"
                  class="mt-curve-handle"
                />
                <circle :cx="curveX(easingCp[0])" :cy="curveY(easingCp[1])" r="5" class="mt-curve-point" />
                <circle :cx="curveX(easingCp[2])" :cy="curveY(easingCp[3])" r="5" class="mt-curve-point" />
              </svg>
              <div class="mt-curve-readout">bezier({{ easingCp.map((n) => n.toFixed(2)).join(', ') }})</div>
            </div>
          </el-popover>
        </template>
        <el-button size="small" link type="danger" @click="onDeleteSelectedKey">{{ t('modeler.timeline.deleteKey') }}</el-button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * ModelerTimeline：动画列表 CRUD + 时间线关键帧视图 + 播放控制（P4，方案 §4.6 动画模式面板）。
 *
 * - 轨道 = 骨骼（组节点）× 三通道（旋转/位移/缩放）；显示范围 = 已有通道的骨骼 ∪ 当前选中骨骼；
 * - 帧操作全部走 store.execute 命令栈：打帧（取骨骼静态变换值）、拖动移动（mergeKey 合并为
 *   一条命令）、选中帧改时间/数值/插值、删除；
 * - 播放/暂停/停止/拖动共用 animationPlayer 时间源；视口叠加由 ModelerViewport 每帧采样完成，
 *   面板本身不写场景；
 * - 时间吸附 0.05s（一个游戏刻）；播放头显示 loop 折返后的时间。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowRight, Delete, Download, Plus, RefreshLeft, Upload, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { useModelerStore } from '../../stores/modeler'
import { animationPlayer } from './core/animationPlayer'
import {
  addAnimation,
  createAnimation,
  patchAnimation,
  removeAnimation,
  removeAnimationKeyframe,
  upsertAnimationKeyframe
} from '../../../../shared/modeler/document'
import { ANIMATION_CHANNELS, KEYFRAME_TIME_EPS, resolveAnimTime } from '../../../../shared/modeler/anim'
import {
  EASING_PRESETS,
  isIdentityEasing,
  matchEasingPreset,
  normalizeEasing,
  sampleEasingCurve
} from '../../../../shared/modeler/curve'
import {
  getControllers,
  removeController,
  upsertController,
  validateController
} from '../../../../shared/modeler/controller'
import { CONTROLLER_CONDITIONS } from '../../../../shared/modeler/types'
import { getFormat } from '../../../../shared/modeler/formats'
import { isGroupNode, isCubeNode, isLocatorNode } from '../../../../shared/modeler/types'
import type {
  AnimationChannelName,
  ControllerCondition,
  Interpolation,
  Keyframe,
  LoopMode,
  ModelAnimationController,
  ModelNode,
  NodeId,
  Vec3
} from '../../../../shared/modeler/types'
import { t } from '../../i18n'

const store = useModelerStore()
const player = animationPlayer

/** 每秒像素宽（横向刻度） */
const PX = 100
/** 轨道头列宽（与 CSS 对齐，用于播放头定位） */
const HEAD_W = 168
const collapsed = ref(false)

/* ---- 活动动画与格式能力 ---- */
const animSupported = computed(() => {
  const d = store.doc
  return d ? getFormat(d.format).capabilities.animations : false
})
const animList = computed(() => (store.doc ? Object.values(store.doc.animations) : []))
const activeAnim = computed(() => {
  const id = player.activeAnimId.value
  return (id && store.doc?.animations[id]) || null
})
/** 播放头时间（loop 折返后） */
const displayTime = computed(() => {
  const anim = activeAnim.value
  return anim ? resolveAnimTime(anim, player.time.value) : 0
})

// 文档变化（含撤销）：活动动画被删则取消选择；文档关闭归零
watch(
  () => store.doc,
  (d) => {
    if (!d) {
      player.reset()
      return
    }
    const id = player.activeAnimId.value
    if (id && !d.animations[id]) player.select(null)
  }
)
onBeforeUnmount(() => player.pause())

/* ---- 动画 CRUD（全部走命令栈） ---- */
function onSelectAnim(v: string | number | boolean | undefined): void {
  player.select(typeof v === 'string' && v ? v : null)
}

function onCreateAnim(): void {
  const d = store.doc
  if (!d) return
  const names = new Set(Object.values(d.animations).map((a) => a.name))
  let name = t('modeler.timeline.defaultAnimName')
  for (let i = 2; names.has(name); i++) name = t('modeler.timeline.defaultAnimNameN', { n: i })
  const anim = createAnimation(name)
  store.execute(t('modeler.timeline.cmdNewAnim'), (doc) => addAnimation(doc, anim))
  player.select(anim.id)
}

async function onRemoveAnim(): Promise<void> {
  const anim = activeAnim.value
  if (!anim) return
  try {
    await ElMessageBox.confirm(
      t('modeler.timeline.confirmRemoveBody', { name: anim.name }),
      t('modeler.timeline.confirmRemoveTitle'),
      {
        type: 'warning',
        confirmButtonText: t('modeler.timeline.delete'),
        cancelButtonText: t('modeler.timeline.cancel')
      }
    )
  } catch {
    return
  }
  store.execute(t('modeler.timeline.cmdRemoveAnim'), (d) => removeAnimation(d, anim.id))
  player.select(null)
}

function onRenameAnim(v: string): void {
  const anim = activeAnim.value
  if (!anim) return
  store.execute(t('modeler.timeline.cmdRenameAnim'), (d) => patchAnimation(d, anim.id, { name: v }), {
    mergeKey: `anim-rename:${anim.id}`
  })
}

function onLengthChange(v: number | undefined): void {
  const anim = activeAnim.value
  if (!anim || v === undefined || !(v > 0)) return
  store.execute(t('modeler.timeline.cmdAnimLength'), (d) => patchAnimation(d, anim.id, { length: v }), {
    mergeKey: `anim-length:${anim.id}`
  })
}

function onLoopChange(v: string | number | boolean | undefined): void {
  const anim = activeAnim.value
  if (!anim) return
  store.execute(t('modeler.timeline.cmdLoop'), (d) => patchAnimation(d, anim.id, { loop: v as LoopMode }))
}

/* ---- 轨道行（骨骼 × 通道） ---- */
function channelText(c: AnimationChannelName): string {
  return t(`modeler.timeline.channel.${c}`)
}

function interpText(i: Interpolation): string {
  return t(`modeler.timeline.interp${i === 'linear' ? 'Linear' : i === 'catmullrom' ? 'Smooth' : 'Step'}`)
}

function conditionText(c: ControllerCondition): string {
  return t(`modeler.timeline.condition.${c}`)
}

function keyTitle(kf: Keyframe): string {
  return t('modeler.timeline.keyTitle', { time: kf.time.toFixed(3), interp: interpText(kf.interpolation) })
}

interface TrackRow {
  nodeId: NodeId
  nodeName: string
  channel: AnimationChannelName
  channelLabel: string
  keys: Keyframe[]
}

const rows = computed<TrackRow[]>(() => {
  const d = store.doc
  const anim = activeAnim.value
  if (!d || !anim) return []
  // Outliner 先序遍历顺序（与层级面板一致）
  const order: NodeId[] = []
  const walk = (id: NodeId): void => {
    order.push(id)
    const n = d.nodes[id]
    if (n && isGroupNode(n)) for (const c of n.children) walk(c)
  }
  for (const id of d.root) walk(id)

  const selectedId = store.selection.length === 1 ? store.selection[0]! : null
  const out: TrackRow[] = []
  for (const id of order) {
    const node = d.nodes[id]
    if (!node || !isGroupNode(node)) continue
    const ch = anim.channels[id]
    const hasKeys = ch && ANIMATION_CHANNELS.some((c) => (ch[c]?.length ?? 0) > 0)
    if (!hasKeys && id !== selectedId) continue
    for (const c of ANIMATION_CHANNELS) {
      out.push({ nodeId: id, nodeName: node.name, channel: c, channelLabel: channelText(c), keys: ch?.[c] ?? [] })
    }
  }
  return out
})

/* ---- 标尺 ---- */
const ticks = computed(() => {
  const len = activeAnim.value?.length ?? 0
  const out: number[] = []
  for (let sec = 0; sec <= len + 1e-6; sec += 0.5) out.push(Math.round(sec * 10) / 10)
  return out
})
const canvasWidth = computed(() => HEAD_W + Math.max(activeAnim.value?.length ?? 0, 0.5) * PX + 24)

/* ---- 打帧 / 选帧 / 移帧 / 删帧（全部走命令栈） ---- */
const selectedKeyRef = ref<{ nodeId: NodeId; channel: AnimationChannelName; time: number } | null>(null)

const selectedKey = computed(() => {
  const sel = selectedKeyRef.value
  const anim = activeAnim.value
  if (!sel || !anim) return null
  const node = store.doc?.nodes[sel.nodeId]
  const kf = anim.channels[sel.nodeId]?.[sel.channel]?.find((k) => Math.abs(k.time - sel.time) <= KEYFRAME_TIME_EPS)
  if (!node || !kf) return null
  return { ...sel, nodeName: node.name, channelLabel: channelText(sel.channel), kf }
})

function isKeySelected(row: TrackRow, time: number): boolean {
  const sel = selectedKeyRef.value
  return !!sel && sel.nodeId === row.nodeId && sel.channel === row.channel && Math.abs(sel.time - time) <= KEYFRAME_TIME_EPS
}

/** 打帧取值：通道 ← 节点静态变换（rotation↔rotation、position↔origin、scale↔scale??[1,1,1]） */
function currentChannelValue(node: ModelNode, channel: AnimationChannelName): Vec3 | null {
  if (channel === 'rotation') {
    return isCubeNode(node) || isGroupNode(node) ? ([...node.rotation] as Vec3) : null
  }
  if (channel === 'position') {
    if (isCubeNode(node) || isGroupNode(node)) return [...node.origin] as Vec3
    if (isLocatorNode(node)) return [...node.position] as Vec3
    return null
  }
  return isGroupNode(node) ? ([...(node.scale ?? [1, 1, 1])] as Vec3) : null
}

function onAddKey(row: TrackRow): void {
  const anim = activeAnim.value
  const node = store.doc?.nodes[row.nodeId]
  if (!anim || !node) return
  const value = currentChannelValue(node, row.channel)
  if (!value) {
    ElMessage.info(t('modeler.timeline.channelUnsupported'))
    return
  }
  const at = Math.round(player.time.value * 1000) / 1000
  store.execute(t('modeler.timeline.cmdAddKey'), (d) =>
    upsertAnimationKeyframe(d, anim.id, row.nodeId, row.channel, { time: at, value, interpolation: 'linear' })
  )
  selectedKeyRef.value = { nodeId: row.nodeId, channel: row.channel, time: at }
}

/** 移帧：删旧点 + 插新点（同一条命令；拖动时 mergeKey 合并为一条） */
function moveKeyframe(
  nodeId: NodeId,
  channel: AnimationChannelName,
  fromTime: number,
  toTime: number,
  merge: boolean
): number | null {
  const anim = activeAnim.value
  if (!anim) return null
  const kf = anim.channels[nodeId]?.[channel]?.find((k) => Math.abs(k.time - fromTime) <= KEYFRAME_TIME_EPS)
  if (!kf) return null
  const tt = Math.min(Math.max(Math.round(toTime * 1000) / 1000, 0), anim.length)
  store.execute(
    t('modeler.timeline.cmdMoveKey'),
    (d) => {
      const removed = removeAnimationKeyframe(d, anim.id, nodeId, channel, fromTime)
      return upsertAnimationKeyframe(removed, anim.id, nodeId, channel, {
        time: tt,
        value: [...kf.value] as Vec3,
        interpolation: kf.interpolation
      })
    },
    merge ? { mergeKey: `kmove:${anim.id}:${nodeId}:${channel}` } : undefined
  )
  return tt
}

/* ---- 拖动播放头（标尺/轨道空白处按下并拖动） ---- */
const rulerRef = ref<HTMLElement | null>(null)
let scrubbing = false

function eventToTime(e: PointerEvent): number {
  const el = rulerRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width)
  return Math.round(x / PX / 0.05) * 0.05
}

function onScrubStart(e: PointerEvent): void {
  if (!activeAnim.value) return
  scrubbing = true
  player.setTime(eventToTime(e))
  window.addEventListener('pointermove', onScrubMove)
  window.addEventListener('pointerup', onScrubEnd, { once: true })
}
function onScrubMove(e: PointerEvent): void {
  if (scrubbing) player.setTime(eventToTime(e))
}
function onScrubEnd(): void {
  scrubbing = false
  window.removeEventListener('pointermove', onScrubMove)
}

/* ---- 拖动关键帧 ---- */
let dragKey: { nodeId: NodeId; channel: AnimationChannelName; time: number } | null = null

function onKeyPointerDown(_e: PointerEvent, row: TrackRow, time: number): void {
  selectedKeyRef.value = { nodeId: row.nodeId, channel: row.channel, time }
  dragKey = { nodeId: row.nodeId, channel: row.channel, time }
  window.addEventListener('pointermove', onKeyDrag)
  window.addEventListener('pointerup', onKeyDragEnd, { once: true })
}
function onKeyDrag(e: PointerEvent): void {
  if (!dragKey) return
  const t2 = moveKeyframe(dragKey.nodeId, dragKey.channel, dragKey.time, eventToTime(e), true)
  if (t2 !== null) {
    dragKey.time = t2
    selectedKeyRef.value = { nodeId: dragKey.nodeId, channel: dragKey.channel, time: t2 }
  }
}
function onKeyDragEnd(): void {
  dragKey = null
  window.removeEventListener('pointermove', onKeyDrag)
}

/* ---- 选中帧编辑条 ---- */
function onKeyTimeChange(v: number | undefined): void {
  const sel = selectedKeyRef.value
  if (!sel || v === undefined) return
  const t2 = moveKeyframe(sel.nodeId, sel.channel, sel.time, v, false)
  if (t2 !== null) selectedKeyRef.value = { ...sel, time: t2 }
}

function onKeyValueChange(axis: number, v: number | undefined): void {
  const sel = selectedKey.value
  const anim = activeAnim.value
  if (!sel || !anim || v === undefined || !Number.isFinite(v)) return
  const value = [...sel.kf.value] as Vec3
  value[axis] = v
  store.execute(
    t('modeler.timeline.cmdKeyValue'),
    (d) =>
      upsertAnimationKeyframe(d, anim.id, sel.nodeId, sel.channel, {
        time: sel.kf.time,
        value,
        interpolation: sel.kf.interpolation
      }),
    { mergeKey: `kval:${anim.id}:${sel.nodeId}:${sel.channel}:${sel.kf.time}:${axis}` }
  )
}

function onKeyInterpChange(v: string | number | boolean | undefined): void {
  const sel = selectedKey.value
  const anim = activeAnim.value
  if (!sel || !anim) return
  store.execute(t('modeler.timeline.cmdInterp'), (d) =>
    upsertAnimationKeyframe(d, anim.id, sel.nodeId, sel.channel, {
      time: sel.kf.time,
      value: [...sel.kf.value] as Vec3,
      interpolation: v as Interpolation
    })
  )
}

/* ---- 缓动（B1-1 曲线编辑器）：预设 + 控制点编辑，全部走命令栈 ---- */
/** 当前帧控制点（无 easing = 线性恒等） */
const easingCp = computed<[number, number, number, number]>(() => {
  const e = selectedKey.value?.kf.easing
  return e ? [...e.cp] : [0, 0, 1, 1]
})
const easingPresetName = computed<string>(() => {
  const e = selectedKey.value?.kf.easing
  if (!e || isIdentityEasing(e)) return 'linear'
  return matchEasingPreset(e.cp) ?? 'custom'
})

function writeEasing(cp: [number, number, number, number] | null, merge: boolean): void {
  const sel = selectedKey.value
  const anim = activeAnim.value
  if (!sel || !anim) return
  const easing = cp ? normalizeEasing(cp) : undefined
  store.execute(
    t('modeler.timeline.cmdEasing'),
    (d) =>
      upsertAnimationKeyframe(d, anim.id, sel.nodeId, sel.channel, {
        time: sel.kf.time,
        value: [...sel.kf.value] as Vec3,
        interpolation: sel.kf.interpolation,
        ...(easing && !isIdentityEasing(easing) ? { easing } : {})
      }),
    merge ? { mergeKey: `keasing:${anim.id}:${sel.nodeId}:${sel.channel}:${sel.kf.time}` } : undefined
  )
}

function onEasingPresetChange(v: string | number | boolean | undefined): void {
  if (typeof v !== 'string' || v === 'custom') return
  if (v === 'linear') writeEasing(null, false)
  else writeEasing([...EASING_PRESETS[v as keyof typeof EASING_PRESETS]] as [number, number, number, number], false)
}

/* 曲线编辑弹层：固定视域 x∈[0,1]、y∈[-1,2]（覆盖回弹预设的 1.56 过冲） */
const CURVE_W = 220
const CURVE_H = 150
const CURVE_PAD = 10
const CURVE_Y_MIN = -1
const CURVE_Y_MAX = 2
function curveX(x: number): number {
  return CURVE_PAD + x * (CURVE_W - CURVE_PAD * 2)
}
function curveY(y: number): number {
  return CURVE_PAD + ((CURVE_Y_MAX - y) / (CURVE_Y_MAX - CURVE_Y_MIN)) * (CURVE_H - CURVE_PAD * 2)
}
const curvePolyline = computed(() =>
  sampleEasingCurve({ cp: easingCp.value }, 32)
    .map(([x, y]) => `${curveX(x).toFixed(1)},${curveY(Math.min(Math.max(y, CURVE_Y_MIN), CURVE_Y_MAX)).toFixed(1)}`)
    .join(' ')
)

/** 拖拽控制点：0 = p1 / 1 = p2；就近吸附选中，x 夹取 [0,1]、y 夹取视域 */
let curveDrag: 0 | 1 | null = null
function curvePointFromEvent(e: PointerEvent): [number, number] {
  const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
  const x = ((e.clientX - rect.left) / rect.width) * CURVE_W
  const y = ((e.clientY - rect.top) / rect.height) * CURVE_H
  const nx = Math.min(Math.max((x - CURVE_PAD) / (CURVE_W - CURVE_PAD * 2), 0), 1)
  const ny = CURVE_Y_MAX - ((y - CURVE_PAD) / (CURVE_H - CURVE_PAD * 2)) * (CURVE_Y_MAX - CURVE_Y_MIN)
  return [nx, Math.min(Math.max(ny, CURVE_Y_MIN), CURVE_Y_MAX)]
}
function onCurvePointerDown(e: PointerEvent): void {
  if (!selectedKey.value) return
  const [x, y] = curvePointFromEvent(e)
  const cp = easingCp.value
  const d1 = Math.hypot(x - cp[0], y - cp[1])
  const d2 = Math.hypot(x - cp[2], y - cp[3])
  curveDrag = d1 <= d2 ? 0 : 1
  ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
  applyCurveDrag(e)
}
function onCurvePointerMove(e: PointerEvent): void {
  if (curveDrag === null) return
  applyCurveDrag(e)
}
function onCurvePointerUp(): void {
  curveDrag = null
}
function applyCurveDrag(e: PointerEvent): void {
  if (curveDrag === null) return
  const [x, y] = curvePointFromEvent(e)
  const cp = [...easingCp.value] as [number, number, number, number]
  if (curveDrag === 0) {
    cp[0] = x
    cp[1] = y
  } else {
    cp[2] = x
    cp[3] = y
  }
  writeEasing(cp, true)
}

function onDeleteSelectedKey(): void {
  const sel = selectedKeyRef.value
  const anim = activeAnim.value
  if (!sel || !anim) return
  store.execute(t('modeler.timeline.cmdDeleteKey'), (d) => removeAnimationKeyframe(d, anim.id, sel.nodeId, sel.channel, sel.time))
  selectedKeyRef.value = null
}

/* ---- B1-2 动画控制器编辑（走命令栈；v2 单控制器：formatData.controllers[0]） ---- */
const controllerDialogOpen = ref(false)
const controller = computed<ModelAnimationController | null>(() => {
  const d = store.doc
  return d ? (getControllers(d)[0] ?? null) : null
})
const controllerIssues = computed(() => {
  const d = store.doc
  const c = controller.value
  return d && c ? validateController(d, c) : []
})
const controllerBadge = computed(() =>
  controller.value
    ? controllerIssues.value.length === 0
      ? t('modeler.timeline.controllerBadgeOk')
      : t('modeler.timeline.controllerBadgeIssues', { n: controllerIssues.value.length })
    : t('modeler.timeline.controllerBadgeNone')
)

function writeCtrl(label: string, next: ModelAnimationController, mergeKey?: string): void {
  store.execute(label, (d) => upsertController(d, next), mergeKey ? { mergeKey } : undefined)
}

function onCtrlCreate(): void {
  const d = store.doc
  if (!d) return
  const anims = Object.values(d.animations)
  if (anims.length === 0) return
  const idle = anims.find((a) => a.name === 'idle') ?? anims[0]!
  const walk = anims.find((a) => a.name === 'walk')
  writeCtrl(t('modeler.timeline.cmdCtrlCreate'), {
    name: 'controller',
    initialState: idle.name,
    states: walk
      ? [
          { name: idle.name, animation: idle.id },
          { name: walk.name, animation: walk.id }
        ]
      : [{ name: idle.name, animation: idle.id }],
    transitions: walk
      ? [
          { from: idle.name, to: walk.name, condition: 'is_moving' },
          { from: walk.name, to: idle.name, condition: 'always' }
        ]
      : []
  })
}

function onCtrlRemove(): void {
  const c = controller.value
  if (!c) return
  store.execute(t('modeler.timeline.cmdCtrlRemove'), (d) => removeController(d, c.name))
}

function onCtrlInitialChange(v: string | number | boolean | undefined): void {
  const c = controller.value
  if (!c || typeof v !== 'string') return
  writeCtrl(t('modeler.timeline.cmdCtrlInitial'), { ...c, initialState: v })
}

function onCtrlAddState(): void {
  const c = controller.value
  const d = store.doc
  if (!c || !d) return
  const anims = Object.values(d.animations)
  const fallback = anims.find((a) => !c.states.some((s) => s.animation === a.id)) ?? anims[0]
  if (!fallback) {
    ElMessage.info(t('modeler.timeline.noAnimToRef'))
    return
  }
  let name = 'state'
  for (let i = 2; c.states.some((s) => s.name === name); i++) name = `state${i}`
  writeCtrl(t('modeler.timeline.cmdCtrlAddState'), { ...c, states: [...c.states, { name, animation: fallback.id }] })
}

function onCtrlRenameState(i: number, v: string): void {
  const c = controller.value
  if (!c) return
  const name = v.trim()
  if (!name || c.states.some((s, j) => j !== i && s.name === name)) return
  const states = c.states.map((s, j) => (j === i ? { ...s, name } : s))
  const old = c.states[i]!.name
  const transitions = c.transitions.map((t) => ({
    ...t,
    from: t.from === old ? name : t.from,
    to: t.to === old ? name : t.to
  }))
  writeCtrl(t('modeler.timeline.cmdCtrlRenameState'), { ...c, states, transitions, initialState: c.initialState === old ? name : c.initialState }, `ctrl-rename:${i}`)
}

function onCtrlStateAnim(i: number, v: string | number | boolean | undefined): void {
  const c = controller.value
  if (!c || typeof v !== 'string') return
  writeCtrl(t('modeler.timeline.cmdCtrlStateAnim'), { ...c, states: c.states.map((s, j) => (j === i ? { ...s, animation: v } : s)) })
}

function onCtrlRemoveState(i: number): void {
  const c = controller.value
  if (!c) return
  const removed = c.states[i]!.name
  const states = c.states.filter((_, j) => j !== i)
  const transitions = c.transitions.filter((t) => t.from !== removed && t.to !== removed)
  const initialState = c.initialState === removed ? (states[0]?.name ?? '') : c.initialState
  writeCtrl(t('modeler.timeline.cmdCtrlRemoveState'), { ...c, states, transitions, initialState })
}

function onCtrlAddTransition(): void {
  const c = controller.value
  if (!c || c.states.length < 2) return
  const from = c.states[0]!.name
  const to = c.states[1]!.name
  writeCtrl(t('modeler.timeline.cmdCtrlAddTrans'), { ...c, transitions: [...c.transitions, { from, to, condition: 'always' }] })
}

function onCtrlTransition(i: number, field: 'from' | 'to' | 'condition', v: string | number | boolean | undefined): void {
  const c = controller.value
  if (!c || typeof v !== 'string') return
  const transitions = c.transitions.map((t, j) => (j === i ? { ...t, [field]: v } : t))
  writeCtrl(t('modeler.timeline.cmdCtrlTrans'), { ...c, transitions }, `ctrl-trans:${i}:${field}`)
}

function onCtrlRemoveTransition(i: number): void {
  const c = controller.value
  if (!c) return
  writeCtrl(t('modeler.timeline.cmdCtrlRemoveTrans'), { ...c, transitions: c.transitions.filter((_, j) => j !== i) })
}

</script>

<style scoped>
.mt {
  flex-shrink: 0;
  border-top: 1px solid var(--ky-border);
  display: flex;
  flex-direction: column;
  max-height: 220px;
}
.mt-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  flex-wrap: wrap;
}
.mt-fold {
  cursor: pointer;
  color: var(--ky-text-dim);
}
.mt-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-accent);
  margin-right: 4px;
}
.mt-anim-select {
  width: 150px;
}
.mt-name {
  width: 120px;
}
.mt-num {
  width: 64px;
}
.mt-loop {
  width: 76px;
}
.mt-interp {
  width: 76px;
}
.mt-easing {
  width: 82px;
}
.mt-curve {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mt-curve-svg {
  width: 100%;
  height: auto;
  background: var(--ky-bg);
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  touch-action: none;
  cursor: crosshair;
}
.mt-curve-unit {
  fill: none;
  stroke: var(--ky-border);
  stroke-dasharray: 3 3;
}
.mt-curve-line {
  fill: none;
  stroke: var(--ky-accent);
  stroke-width: 1.5;
}
.mt-curve-handle {
  stroke: var(--ky-text-dim);
  stroke-width: 1;
}
.mt-curve-point {
  fill: var(--ky-warning, #e6a23c);
  stroke: var(--ky-bg);
  stroke-width: 1;
  cursor: grab;
}
.mt-curve-readout {
  font-size: 10.5px;
  color: var(--ky-text-dim);
  font-variant-numeric: tabular-nums;
  text-align: center;
}

/* B1-2 动画控制器弹窗 */
.mtc {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mtc-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mtc-section {
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mtc-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 600;
  color: var(--ky-text);
}
.mtc-state-row,
.mtc-trans-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mtc-state-name {
  width: 120px;
}
.mtc-state-anim {
  flex: 1;
}
.mtc-issues {
  border: 1px solid var(--ky-warning, #e6a23c);
  border-radius: 4px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--ky-warning, #e6a23c) 8%, transparent);
}
.mtc-issue {
  font-size: 11px;
  color: var(--ky-warning, #e6a23c);
  line-height: 1.5;
}
.mtc-ok {
  font-size: 11px;
  color: var(--ky-success, #67c23a);
}
.mtc-empty {
  font-size: 12px;
  color: var(--ky-text);
  line-height: 1.6;
}
.mtc-foot {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--ky-border);
  padding-top: 8px;
}
.mt-label {
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.mt-time {
  font-size: 11px;
  color: var(--ky-text);
  font-variant-numeric: tabular-nums;
}
.mt-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
}

.mt-body {
  border-top: 1px solid var(--ky-border);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.mt-scroll {
  overflow-x: auto;
  overflow-y: auto;
  max-height: 130px;
}
.mt-canvas {
  position: relative;
  min-width: 100%;
}
.mt-row {
  display: flex;
  height: 22px;
}
.mt-ruler-row {
  height: 18px;
  border-bottom: 1px solid var(--ky-border);
}
.mt-row-head {
  width: 168px;
  flex-shrink: 0;
  position: sticky;
  left: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  background: var(--ky-bg);
  border-right: 1px solid var(--ky-border);
  font-size: 10.5px;
}
.mt-corner {
  border-right: 1px solid var(--ky-border);
}
.mt-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ky-text);
}
.mt-row-channel {
  flex-shrink: 0;
  font-size: 9.5px;
  color: var(--ky-text-dim);
  border: 1px solid var(--ky-border);
  border-radius: 3px;
  padding: 0 3px;
}
.mt-row-add {
  flex-shrink: 0;
  cursor: pointer;
  color: var(--ky-text-dim);
  font-size: 11px;
}
.mt-row-add:hover {
  color: var(--ky-accent);
}
.mt-lane {
  flex: 1;
  position: relative;
  cursor: crosshair;
}
.mt-ruler {
  cursor: ew-resize;
}
.mt-tick {
  position: absolute;
  top: 10px;
  bottom: 0;
  width: 1px;
  background: var(--ky-border);
}
.mt-tick.is-major {
  top: 4px;
}
.mt-tick-label {
  position: absolute;
  top: -3px;
  left: 3px;
  font-size: 9px;
  color: var(--ky-text-dim);
  user-select: none;
}
.mt-key {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  background: var(--ky-accent);
  transform: rotate(45deg);
  cursor: ew-resize;
  border: 1px solid var(--ky-bg);
}
.mt-key.is-catmullrom {
  border-radius: 50%;
  transform: none;
}
.mt-key.is-step {
  transform: none;
}
.mt-key.is-selected {
  background: var(--ky-warning, #e6a23c);
  outline: 1px solid var(--ky-warning, #e6a23c);
}
.mt-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--ky-accent);
  pointer-events: none;
  z-index: 2;
}
.mt-empty {
  padding: 10px 12px;
  font-size: 11px;
  color: var(--ky-text-dim);
  line-height: 1.6;
}
.mt-keybar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-top: 1px solid var(--ky-border);
  flex-wrap: wrap;
}
.mt-keybar-title {
  font-size: 11px;
  color: var(--ky-text);
  font-weight: 600;
}
</style>
