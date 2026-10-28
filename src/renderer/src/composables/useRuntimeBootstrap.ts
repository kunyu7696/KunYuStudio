import { computed, ref } from 'vue'
import { IpcChannels } from '../../../shared/types/ipc'
import type { JdkProvisionProgress } from '../../../shared/types/build'
import type { McProvisionProgress } from '../../../shared/types/mcRuntime'

/**
 * 首启零配置运行环境的后台自动置备。
 *
 * 首启时若本机既没有兼容 JDK、也没有目标版本的托管实例，就直接在后台按
 * 「JDK → Minecraft 运行时资产」的顺序下载，顶部以细条呈现进度。
 *
 * 为什么不复用「设置 → 运行环境」的向导：把首次使用者硬拽进设置页会打断
 * 首屏体验（用户还得自己找回来）。这里默认替他把准备工作做完，不想等的人
 * 点「稍后」即可隐藏进度条（主进程下载不受影响，完成后静默可用）。
 */

/** 无可参考项目时的兜底 MC 版本（与运行环境设置页的默认值保持一致） */
export const DEFAULT_MC_VERSION = '1.21.1'
/** 「已就绪」提示停留时长 */
const DONE_HIDE_MS = 6_000

export type RuntimeBootstrapPhase = 'idle' | 'detecting' | 'jdk' | 'mc' | 'done' | 'error' | 'dismissed'

export interface RuntimeBootstrapOptions {
  /** 目标 MC 版本；缺省按项目版本，再缺省用 DEFAULT_MC_VERSION */
  mcVersion?: string | null
  /** MC 下载镜像基地址（设置 → 网络）；空则官方直连 */
  mirror?: string | null
}

const phase = ref<RuntimeBootstrapPhase>('idle')
const message = ref('')
const jdkPct = ref(0)
const mcPct = ref(0)
const targetVersion = ref('')
const running = ref(false)

let doneTimer: ReturnType<typeof setTimeout> | null = null
let offJdk: (() => void) | null = null
let offMc: (() => void) | null = null
let lastOptions: RuntimeBootstrapOptions = {}

function clearTimer(): void {
  if (doneTimer !== null) {
    clearTimeout(doneTimer)
    doneTimer = null
  }
}

function detachListeners(): void {
  offJdk?.()
  offJdk = null
  offMc?.()
  offMc = null
}

function attachListeners(): void {
  detachListeners()
  offJdk = window.api.on(IpcChannels.JDK_PROVISION_EVENT, (...args: unknown[]) => {
    const ev = args[0] as JdkProvisionProgress | undefined
    if (!ev) return
    if (typeof ev.progress === 'number') jdkPct.value = ev.progress
    if (ev.message) message.value = ev.message
  })
  offMc = window.api.on(IpcChannels.MC_PROVISION_EVENT, (...args: unknown[]) => {
    const ev = args[0] as McProvisionProgress | undefined
    if (!ev) return
    if (typeof ev.progress === 'number') mcPct.value = ev.progress
    if (ev.message) message.value = ev.message
  })
}

/** 检测本机是否已具备目标版本的运行环境 */
async function needsProvision(version: string): Promise<{ jdkMajor: number | null; needMc: boolean }> {
  const detect = await window.api.jdk.detect(null, { loader: null, mcVersion: version })
  const instances = await window.api.mc.listInstances()
  const jdkReady = detect.compatible && Boolean(detect.jdk)
  return {
    jdkMajor: jdkReady ? null : detect.requiredMajor,
    needMc: !instances.some((i) => i.mcVersion === version)
  }
}

async function run(): Promise<void> {
  if (running.value) return
  running.value = true
  clearTimer()
  const version = lastOptions.mcVersion?.trim() || DEFAULT_MC_VERSION
  targetVersion.value = version
  jdkPct.value = 0
  mcPct.value = 0
  phase.value = 'detecting'
  message.value = '正在检测本机运行环境…'
  attachListeners()
  try {
    const plan = await needsProvision(version)
    if (plan.jdkMajor === null && !plan.needMc) {
      // 已经就绪：不值得打扰，直接收起
      phase.value = 'idle'
      return
    }
    if (plan.jdkMajor !== null) {
      phase.value = 'jdk'
      message.value = `正在下载 JDK ${plan.jdkMajor}…`
      const res = await window.api.jdk.provision({ major: plan.jdkMajor })
      if (!res.ok) {
        phase.value = 'error'
        message.value = `JDK 安装失败：${res.errorMessage}`
        return
      }
      jdkPct.value = 100
    }
    if (plan.needMc) {
      phase.value = 'mc'
      message.value = `正在下载 Minecraft ${version} 运行环境…`
      const mirror = lastOptions.mirror?.trim()
      const res = await window.api.mc.provision({
        mcVersion: version,
        name: version,
        mirror: mirror ? mirror : undefined
      })
      if (!res.ok) {
        phase.value = 'error'
        message.value = `运行环境准备失败：${res.errorMessage}`
        return
      }
      mcPct.value = 100
    }
    phase.value = 'done'
    message.value = `运行环境已就绪（Minecraft ${version}）`
    doneTimer = setTimeout(() => {
      if (phase.value === 'done') phase.value = 'idle'
    }, DONE_HIDE_MS)
  } catch (err) {
    phase.value = 'error'
    message.value = `运行环境准备失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    detachListeners()
    running.value = false
  }
}

export function useRuntimeBootstrap() {
  return {
    phase,
    message,
    jdkPct,
    mcPct,
    targetVersion,
    running,
    /** 进度条可见（error/done 也显示，告知结果） */
    visible: computed(
      () => phase.value !== 'idle' && phase.value !== 'dismissed'
    ),
    busy: computed(() => phase.value === 'detecting' || phase.value === 'jdk' || phase.value === 'mc'),
    /** 后台自动置备（幂等：运行中重复调用无副作用） */
    async autoStart(options: RuntimeBootstrapOptions = {}): Promise<void> {
      lastOptions = options
      await run()
    },
    /** 失败后按上次参数重试 */
    async retry(): Promise<void> {
      phase.value = 'idle'
      await run()
    },
    /** 稍后：只隐藏进度条，主进程下载继续，完成即可用 */
    dismiss(): void {
      clearTimer()
      phase.value = 'dismissed'
    }
  }
}
