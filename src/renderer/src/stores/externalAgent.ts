import { defineStore } from 'pinia'
import type {
  ExternalAgentChunk,
  ExternalAgentExit,
  ExternalAgentRunRequest
} from '../../../shared/types/integration'

/**
 * 外部 Agent 派发状态：放在 store 里而不是设置面板组件内，
 * 这样切换设置分区（组件卸载）时仍在跑的任务与输出不会丢。
 */
const MAX_LOG_CHARS = 120_000

let detach: (() => void) | null = null

export const useExternalAgentStore = defineStore('external-agent', {
  state: () => ({
    runId: '',
    running: false,
    starting: false,
    /** 输出缓冲（stdout+stderr 合并，超出上限裁掉最前面） */
    log: '',
    exit: null as ExternalAgentExit | null,
    agentId: '' as '' | ExternalAgentRunRequest['agentId'],
    prompt: '',
    writeAccess: false
  }),

  actions: {
    /** 订阅主进程输出事件（设置面板挂载时调用，幂等） */
    attach(): void {
      if (detach) return
      const offChunk = window.api.integration.onAgentChunk((chunk) => this.onChunk(chunk))
      const offExit = window.api.integration.onAgentExit((exit) => this.onExit(exit))
      detach = () => {
        offChunk()
        offExit()
        detach = null
      }
    },

    append(text: string): void {
      this.log += text
      if (this.log.length > MAX_LOG_CHARS) {
        this.log = this.log.slice(this.log.length - MAX_LOG_CHARS)
      }
    },

    onChunk(chunk: ExternalAgentChunk): void {
      if (chunk.runId !== this.runId) return
      this.append(chunk.text)
    },

    onExit(exit: ExternalAgentExit): void {
      if (exit.runId !== this.runId) return
      this.running = false
      this.exit = exit
      if (exit.error) this.append(`\n[启动失败] ${exit.error}\n`)
    },

    /** 派发任务；cwd 必须是当前项目根（主进程会再校验） */
    async run(cwd: string): Promise<void> {
      if (!this.agentId) throw new Error('请选择一个已检测到的外部 Agent')
      this.starting = true
      this.exit = null
      this.log = ''
      try {
        const started = await window.api.integration.runAgent({
          agentId: this.agentId,
          prompt: this.prompt,
          cwd,
          writeAccess: this.writeAccess
        })
        this.runId = started.runId
        this.running = true
        this.append(`$ ${started.command}\n$ cwd: ${cwd}${started.writeAccess ? '（可写）' : '（只读）'}\n\n`)
      } finally {
        this.starting = false
      }
    },

    async stop(): Promise<void> {
      if (!this.runId) return
      await window.api.integration.stopAgent(this.runId)
    }
  }
})
