/**
 * Gradle done 等待表 + watchdog：
 * - runGradle 的 sink 收到 phase=done 事件时经 deliver 唤醒等待方；
 * - wait 可带超时（watchdog）：done 事件因 daemon 崩溃 / 进程被杀 / 事件投递丢失
 *   永不到达时，此前会永久挂起（UI 停在"构建中"无法恢复）——超时按
 *   timedOut=true 收口，buildLoop 既有分支会按「超时」如实报告；
 * - A-03 settle 守卫（同 recheckAssertion）：done 与 watchdog 只 settle 一次，
 *   晚到的重复 deliver 不再生效。
 *
 * 纯模块、零依赖，便于 vitest 用假时钟直测。
 */

export type GradleDoneResult = { exitCode: number | null; cancelled: boolean; timedOut: boolean }

export interface GradleWaiterTable {
  /** 等待指定 runId 的 done 事件；timeoutMs 传正值时启用 watchdog（超时按 timedOut=true 收口） */
  wait: (runId: string, timeoutMs?: number) => Promise<GradleDoneResult>
  /** 投递 done 结果；仅首个投递生效 */
  deliver: (runId: string, result: GradleDoneResult) => void
}

export function createGradleWaiterTable(): GradleWaiterTable {
  const waiters = new Map<string, (result: GradleDoneResult) => void>()

  function wait(runId: string, timeoutMs?: number): Promise<GradleDoneResult> {
    return new Promise((resolvePromise) => {
      let settled = false
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const settle = (result: GradleDoneResult): void => {
        if (settled) return
        settled = true
        if (watchdog) clearTimeout(watchdog)
        waiters.delete(runId)
        resolvePromise(result)
      }
      if (timeoutMs && timeoutMs > 0) {
        watchdog = setTimeout(() => {
          settle({ exitCode: null, cancelled: false, timedOut: true })
        }, timeoutMs)
      }
      waiters.set(runId, settle)
    })
  }

  function deliver(runId: string, result: GradleDoneResult): void {
    const waiter = waiters.get(runId)
    if (waiter) {
      waiters.delete(runId)
      waiter(result)
    }
  }

  return { wait, deliver }
}
