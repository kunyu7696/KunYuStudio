import { computed, readonly, ref } from 'vue'

/**
 * 启动动画与「真实初始化事件」的唯一绑定点。
 *
 * 设计约束（区别于演示原型）：
 * 1. 启动层上的每一行日志、底部进度条、耗时数字，全部来自 App.vue 里真实执行的 Promise，
 *    没有任何假进度或定时器编造的步骤；
 * 2. 任何一步卡住，启动层就停在那一步继续等（超过 8 秒才兜底放行），
 *    不会出现「动画播完了但其实没加载好」；
 * 3. 点击任意位置可跳过，跳过不改变初始化流程，只是提前关掉这一层。
 *
 * 新增一步启动工作：在 BOOT_STEP_IDS 里登记 id，在语言包里补 boot.steps.<id>，
 * 然后 App.vue 用 runStep(id, fn) 包住即可，界面自动出现对应日志行。
 */

export type BootStepStatus = 'pending' | 'running' | 'done' | 'error'
export type BootPhase = 'brand' | 'scene' | 'done'

export interface BootStepState {
  status: BootStepStatus
  /** 该步骤真实耗时（毫秒），未开始时为 0 */
  ms: number
  error?: string
}

/** 启动步骤清单：顺序即日志显示顺序，也决定进度条分母 */
export const BOOT_STEP_IDS = [
  'settings',
  'theme',
  'modules',
  'probe',
  'project',
  'runtime'
] as const

export type BootStepId = (typeof BOOT_STEP_IDS)[number]

/**
 * 三段时长共同决定启动动画总时长：品牌 3s + 方块世界 3s + 淡出 1s ≈ 7s。
 * 产品要求整段不少于 6 秒且不超过 8 秒，调整时请保持三者之和落在这个区间。
 */
/** 品牌幕最短停留：步骤再快也要让品牌露个脸 */
const BRAND_MIN_MS = 3000
/** 第二幕（方块世界）停留时长 */
const SCENE_MS = 3000
/** 退场淡出时长（与 BootSplash.vue 里 .boot-splash 的 opacity 过渡时长保持一致） */
const FADE_MS = 1000
/** 兜底：步骤异常挂起时最长等待，超过就放行（须大于三段时长之和） */
const MAX_BOOT_MS = 12000

function emptySteps(): Record<BootStepId, BootStepState> {
  const out = {} as Record<BootStepId, BootStepState>
  for (const id of BOOT_STEP_IDS) out[id] = { status: 'pending', ms: 0 }
  return out
}

const visible = ref(true)
const phase = ref<BootPhase>('brand')
const steps = ref<Record<BootStepId, BootStepState>>(emptySteps())
const startedAt = ref(0)

let playing = false

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 已完成（含失败）的步骤数占比：进度条只认真实完成度 */
const progress = computed(() => {
  const total = BOOT_STEP_IDS.length
  const done = BOOT_STEP_IDS.filter((id) => {
    const s = steps.value[id].status
    return s === 'done' || s === 'error'
  }).length
  return done / total
})

const settled = computed(() =>
  BOOT_STEP_IDS.every((id) => {
    const s = steps.value[id].status
    return s === 'done' || s === 'error'
  })
)

async function play(): Promise<void> {
  if (playing) return
  playing = true
  const t0 = performance.now()

  // 品牌幕：至少露 1.8 秒，同时等待真实初始化完成
  await wait(Math.max(0, BRAND_MIN_MS - (performance.now() - t0)))
  while (!settled.value && performance.now() - t0 < MAX_BOOT_MS) {
    await wait(100)
  }
  if (!visible.value) return

  // 第二幕：方块世界 + 标语；phase 切到 done 时由 CSS 过渡完成淡出，FADE_MS 与过渡时长等长
  phase.value = 'scene'
  await wait(SCENE_MS)
  if (!visible.value) return

  phase.value = 'done'
  await wait(FADE_MS)
  visible.value = false
}

/** 在渲染层挂载时调用一次；幂等，重复调用不会重播 */
function start(): void {
  if (startedAt.value) return
  startedAt.value = performance.now()
  void play()
}

/** 跳过启动层（点击/按键）：只关界面，不打断初始化 */
function skip(): void {
  visible.value = false
  phase.value = 'done'
}

/**
 * 包住一段真实初始化工作：记录运行中/成功/失败与耗时。
 * 失败不会中断后续步骤（启动层照常放行），错误信息会显示在日志行上。
 */
async function runStep<T>(id: BootStepId, fn: () => Promise<T> | T): Promise<T | undefined> {
  const t0 = performance.now()
  steps.value[id] = { status: 'running', ms: 0 }
  try {
    const value = await fn()
    steps.value[id] = { status: 'done', ms: Math.round(performance.now() - t0) }
    return value
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    steps.value[id] = {
      status: 'error',
      ms: Math.round(performance.now() - t0),
      error: message
    }
    console.error(`[boot] step ${id} failed:`, err)
    return undefined
  }
}

export function useBootSplash() {
  return {
    visible: readonly(visible),
    phase: readonly(phase),
    steps: readonly(steps),
    progress,
    settled,
    start,
    runStep,
    skip
  }
}
