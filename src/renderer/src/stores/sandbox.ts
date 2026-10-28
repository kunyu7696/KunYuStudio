import { defineStore } from 'pinia'
import { IpcChannels } from '../../../shared/types/ipc'
import type {
  SandboxConfig,
  SandboxEvent,
  SandboxProbeResult,
  SandboxReport,
  SandboxStage,
  SandboxStageStatus
} from '../../../shared/types/sandbox'

/**
 * M10 沙箱状态：阶段进度、探针流、最终报告。
 * 事件经通用 api.on(SANDBOX_EVENT) 订阅，invoke 返回值兜底最终报告。
 */
export const useSandboxStore = defineStore('sandbox', {
  state: () => ({
    running: false,
    runId: '' as string,
    stages: {} as Partial<Record<SandboxStage, { status: SandboxStageStatus; detail: string }>>,
    probes: [] as SandboxProbeResult[],
    report: null as SandboxReport | null
  }),

  getters: {
    /** 六阶段当前激活序号（el-steps 用） */
    activeStage(state): number {
      const order: SandboxStage[] = ['build', 'launch', 'wait-world', 'probes', 'collect', 'shutdown']
      let active = 0
      for (let i = 0; i < order.length; i++) {
        const rec = state.stages[order[i]]
        if (rec?.status === 'running') return i
        if (rec?.status === 'done' || rec?.status === 'failed' || rec?.status === 'skipped') active = i + 1
      }
      return Math.min(active, order.length - 1)
    }
  },

  actions: {
    async run(projectPath: string): Promise<void> {
      if (this.running) return
      this.running = true
      this.report = null
      this.probes = []
      this.stages = {}
      const config: SandboxConfig = { projectPath }

      const off = window.api.on(IpcChannels.SANDBOX_EVENT, (...args: unknown[]) => {
        const ev = args[0] as SandboxEvent
        if (!ev) return
        if (ev.type === 'phase') {
          this.stages[ev.stage] = { status: ev.status, detail: ev.action }
        } else if (ev.type === 'probe') {
          this.probes.push(ev.probe)
        } else if (ev.type === 'report') {
          this.report = ev.report
          this.runId = ev.runId
        }
      })

      try {
        const finalReport = await window.api.sandbox.run(config)
        this.report = finalReport
        this.runId = finalReport.runId
      } finally {
        off()
        this.running = false
      }
    },

    async cancel(): Promise<void> {
      await window.api.sandbox.cancel(this.runId || undefined)
    }
  }
})
