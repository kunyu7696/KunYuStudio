/**
 * kunyu Agent 事件 → dsh-pet session/event 桥（纯函数工厂，无宿主依赖）。
 *
 * dsh-pet 的工作状态（thinking/working/waiting/result/success/error）由
 * `session/event` 驱动（src/host/work-status.ts 的 reduceWorkStatus）；kunyu 的
 * Agent 事件是另一种粒度（phase/log/artifact/reply/error/paused/resumed）。
 * 本桥把后者映射成前者，喂给 petHost.emit('session/event', session, event)。
 *
 * 映射表（kunyu → dsh）：
 *   phase=running（run 首次）     → turn/start        （thinking）
 *   phase=waiting                 → approval/asked    （waiting，等用户）
 *   paused                        → approval/asked    （waiting）
 *   resumed                       → tool/call         （working）
 *   reply                         → turn/end(completed)
 *   error / phase=error           → turn/end(error)
 *   phase=done（started 时）      → turn/end(completed)
 *   phase=skipped（started 时）   → turn/end(aborted)（取消/超时：原作清理会话回空闲）
 *   log / artifact                → 不映射（kunyu 无工具级粒度，工作状态保持）
 *
 * turn/end 后该 run 的状态清除；同 run 重复的 running 不重复发 turn/start。
 */

/**
 * @typedef {Object} KunyuAgentEvent
 * @property {string} type            phase | log | artifact | reply | error | paused | resumed
 * @property {number} seq             事件序号（透传给 dsh 侧做防刷屏）
 * @property {string} runId           run 标识，作为 session id
 * @property {string} [phase]         waiting | running | done | error | skipped（type=phase 时）
 * @property {string} [action]        当前动作文案
 * @property {string} [detail]        补充信息
 */

/**
 * @typedef {Object} SessionEventFrame
 * @property {'turn/start'|'tool/call'|'tool/result'|'turn/end'|'approval/asked'} type
 * @property {Record<string, unknown>} data
 */

/**
 * 创建桥实例（每个宿主连接一个）。
 * @returns {{ feed(event: KunyuAgentEvent): Array<SessionEventFrame>, reset(): void }}
 */
export function createAgentEventBridge() {
  /** 已发过 turn/start 的 runId 集合 */
  const started = new Set()

  /**
   * 喂入一个 kunyu Agent 事件，返回零或多个 session/event 帧（不含 seq/session 包装）。
   * @param {KunyuAgentEvent} event
   * @returns {Array<SessionEventFrame>}
   */
  function feed(event) {
    if (!event || typeof event.type !== 'string') return []
    const runId = String(event.runId ?? '')
    switch (event.type) {
      case 'phase': {
        if (event.phase === 'running') {
          if (started.has(runId)) return []
          started.add(runId)
          return [{ type: 'turn/start', data: {} }]
        }
        if (event.phase === 'waiting') {
          if (!started.has(runId)) {
            started.add(runId)
            return [
              { type: 'turn/start', data: {} },
              { type: 'approval/asked', data: { reason: event.action ?? event.detail ?? '' } }
            ]
          }
          return [{ type: 'approval/asked', data: { reason: event.action ?? event.detail ?? '' } }]
        }
        if (event.phase === 'done') {
          if (!started.has(runId)) return []
          started.delete(runId)
          return [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }]
        }
        if (event.phase === 'error') {
          if (!started.has(runId)) return []
          started.delete(runId)
          return [{ type: 'turn/end', data: { reason: { kind: 'error' } } }]
        }
        // 取消/超时：turn/end(aborted) → 原作 turnEndState 归 null，清理会话回空闲
        if (event.phase === 'skipped') {
          if (!started.has(runId)) return []
          started.delete(runId)
          return [{ type: 'turn/end', data: { reason: { kind: 'aborted' } } }]
        }
        return []
      }
      case 'paused': {
        if (!started.has(runId)) {
          started.add(runId)
          return [
            { type: 'turn/start', data: {} },
            { type: 'approval/asked', data: { reason: event.detail ?? event.action ?? '' } }
          ]
        }
        return [{ type: 'approval/asked', data: { reason: event.detail ?? event.action ?? '' } }]
      }
      case 'resumed': {
        if (started.has(runId)) return [{ type: 'tool/call', data: { name: 'resume' } }]
        started.add(runId)
        return [{ type: 'turn/start', data: {} }]
      }
      case 'reply': {
        if (!started.has(runId)) return []
        started.delete(runId)
        return [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }]
      }
      case 'error': {
        if (!started.has(runId)) return []
        started.delete(runId)
        return [{ type: 'turn/end', data: { reason: { kind: 'error' } } }]
      }
      default:
        return []
    }
  }

  return {
    feed,
    /** 清空运行态（宿主重启等场景） */
    reset() {
      started.clear()
    }
  }
}
