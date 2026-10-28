import { defineStore } from 'pinia'
import type {
  ComboHealth,
  McpStatus,
  MonitorEvent,
  MonitorState,
  ProbeStatus
} from '../../../shared/types/monitor'
import type { LoaderId } from '../../../shared/types/aiReference'
import { useAiAgentsStore } from './aiAgents'

const IDLE_PROBE: ProbeStatus = {
  comboId: 'fabric-1.20.1',
  phase: 'idle',
  progress: 0,
  message: '尚未执行编译回测',
  health: 'unknown',
  at: ''
}

/**
 * 版本漂移监测 store：17 组合矩阵、上游检查、真实编译探针进度，
 * 以及 mcdev-mcp 状态（设置面板复用）。
 */
export const useAiMonitorStore = defineStore('aiMonitor', {
  state: () => ({
    initialized: false,
    monitor: null as MonitorState | null,
    probe: { ...IDLE_PROBE } as ProbeStatus,
    mcp: null as McpStatus | null,
    /** 矩阵弹层开关（组件直接绑定） */
    matrixOpen: false,
    eventSeq: 0,
    /** mcp 初始化/连接进度轮询句柄 */
    mcpPollTimer: null as ReturnType<typeof setInterval> | null
  }),

  getters: {
    checking(state): boolean {
      return state.monitor?.checking ?? false
    },
    activeCell(state) {
      return (id: string) => state.monitor?.cells.find((c) => c.id === id) ?? null
    },
    /** active 组合（M7 仅 fabric-1.20.1） */
    activeCells(state) {
      return state.monitor?.cells.filter((c) => c.active) ?? []
    },
    groups(state): Array<{ loader: LoaderId; label: string; cells: MonitorState['cells'] }> {
      const cells = state.monitor?.cells ?? []
      const order: Array<{ loader: LoaderId; label: string }> = [
        { loader: 'fabric', label: 'Fabric' },
        { loader: 'forge', label: 'Forge' },
        { loader: 'neoforge', label: 'NeoForge' }
      ]
      return order.map((g) => ({
        loader: g.loader,
        label: g.label,
        cells: cells.filter((c) => c.loader === g.loader)
      }))
    },
    recentDrift(state) {
      return (state.monitor?.events ?? []).slice(0, 8)
    },
    /** 面板头芯片展示用：active 组合健康 */
    chipHealth(state): ComboHealth {
      const active = state.monitor?.cells.find((c) => c.active)
      return active?.health ?? 'unknown'
    },
    probeRunning(state): boolean {
      return !['idle', 'pass', 'fail', 'skipped'].includes(state.probe.phase)
    }
  },

  actions: {
    async init(): Promise<void> {
      if (this.initialized) return
      this.initialized = true
      window.api.on('monitor:event', (event: unknown, status?: unknown) => {
        this.handleEvent(event as MonitorEvent, status as ProbeStatus | undefined)
      })
      await Promise.all([this.refreshState(), this.refreshMcpStatus()])
      this.ensureMcpPolling()
    },

    handleEvent(event: MonitorEvent, status?: ProbeStatus): void {
      this.eventSeq = event.seq
      if (status) this.probe = status
      if (event.type === 'check-finished' || event.type === 'combo-drift') {
        void this.refreshState()
      }
    },

    async refreshState(): Promise<void> {
      this.monitor = await window.api.monitor.getState()
    },

    async refreshMcpStatus(): Promise<void> {
      this.mcp = await window.api.mcp.getStatus()
      this.ensureMcpPolling()
    },

    /** initializing/connecting 期间 2s 轮询，进入终态自动停止 */
    ensureMcpPolling(): void {
      const transient =
        this.mcp?.kind === 'initializing' || this.mcp?.kind === 'connecting'
      if (transient && this.mcpPollTimer === null) {
        this.mcpPollTimer = setInterval(() => {
          void window.api.mcp.getStatus().then((s) => {
            this.mcp = s
            if (s.kind !== 'initializing' && s.kind !== 'connecting') {
              this.stopMcpPolling()
            }
          })
        }, 2000)
      } else if (!transient) {
        this.stopMcpPolling()
      }
    },

    stopMcpPolling(): void {
      if (this.mcpPollTimer !== null) {
        clearInterval(this.mcpPollTimer)
        this.mcpPollTimer = null
      }
    },

    async checkNow(): Promise<void> {
      // 乐观置 checking，事件/结果都会刷新状态
      if (this.monitor) this.monitor.checking = true
      try {
        this.monitor = await window.api.monitor.check()
      } finally {
        await this.refreshState()
      }
    },

    /** 对指定组合执行真实编译回测（M13 创建项目向导内触发）；缺省仍为 fabric-1.20.1 */
    async runActiveProbe(comboId = 'fabric-1.20.1'): Promise<void> {
      const status = await window.api.monitor.runProbe(comboId)
      this.probe = status
      await this.refreshState()
    },

    async setMcpEnabled(enabled: boolean): Promise<void> {
      this.mcp = await window.api.mcp.setEnabled(enabled)
      this.ensureMcpPolling()
    },

    async refreshMcp(): Promise<void> {
      this.mcp = await window.api.mcp.refresh()
      this.ensureMcpPolling()
    },

    /** 矩阵选中 active 组合 → 切换 Agent 目标（无项目时生效） */
    selectCombo(loader: LoaderId, mcVersion: string): void {
      const agents = useAiAgentsStore()
      agents.setTarget(loader, mcVersion)
    }
  }
})
