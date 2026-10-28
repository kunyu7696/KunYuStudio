/**
 * 动画播放器（P4，方案 §4.4「播放器只改场景对象、不写文档」）。
 *
 * 模块级单例：时间线面板（ModelerTimeline）与视口（ModelerViewport）共用同一时间源。
 * - 只持有「活动动画 id / 当前时间 / 播放标志」；采样与场景叠加由视口每帧读取
 *   本状态完成（sampleAnimation → nodeObjects），绝不写文档；
 * - rAF 时钟仅在播放中运行；loop 对 length 取模循环，once/hold 播到末尾自动暂停
 *   并停在 length（hold 的定格语义由 anim.ts 采样夹取保证）；
 * - 文档切换/动画被删时由面板侧校验并调用 select(null)/reset()。
 */
import { ref } from 'vue'
import { useModelerStore } from '../../../stores/modeler'
import type { AnimationId, ModelAnimation } from '../../../../../shared/modeler/types'

/** 活动动画（时间线编辑目标 + 视口叠加来源）；null = 不叠加 */
const activeAnimId = ref<AnimationId | null>(null)
/** 当前播放时间（秒，原始值；loop 折返由 anim.ts resolveAnimTime/sampleAnimation 负责） */
const time = ref(0)
const playing = ref(false)

let rafId = 0
let lastTs = 0

function currentAnim(): ModelAnimation | null {
  const store = useModelerStore()
  const id = activeAnimId.value
  return (id && store.doc?.animations[id]) || null
}

function tick(ts: number): void {
  rafId = requestAnimationFrame(tick)
  const dt = lastTs > 0 ? (ts - lastTs) / 1000 : 0
  lastTs = ts
  const anim = currentAnim()
  if (!anim) {
    pause()
    return
  }
  let t = time.value + dt
  if (anim.loop === 'loop' && anim.length > 0) {
    t = t % anim.length
  } else if (t >= anim.length) {
    // once/hold：播完自动暂停并停在末尾
    time.value = anim.length
    pause()
    return
  }
  time.value = t
}

function play(): void {
  const anim = currentAnim()
  if (!anim || playing.value) return
  // once/hold 已停在末尾时再次播放从头开始
  if (anim.loop !== 'loop' && time.value >= anim.length) time.value = 0
  playing.value = true
  lastTs = 0
  rafId = requestAnimationFrame(tick)
}

function pause(): void {
  playing.value = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
  lastTs = 0
}

/** 停止 = 暂停 + 回到 0 */
function stop(): void {
  pause()
  time.value = 0
}

function toggle(): void {
  if (playing.value) pause()
  else play()
}

/** 选择活动动画（切歌重置时间并暂停；重复选同一动画无操作） */
function select(id: AnimationId | null): void {
  if (id === activeAnimId.value) return
  pause()
  activeAnimId.value = id
  time.value = 0
}

/** 拖动时间（夹取到 [0, length]，不影响播放状态） */
function setTime(t: number): void {
  const anim = currentAnim()
  const max = anim ? anim.length : 0
  time.value = Math.min(Math.max(t, 0), max)
}

/** 文档关闭/项目切换时归零 */
function reset(): void {
  pause()
  activeAnimId.value = null
  time.value = 0
}

export const animationPlayer = {
  activeAnimId,
  time,
  playing,
  play,
  pause,
  stop,
  toggle,
  select,
  setTime,
  reset
}
