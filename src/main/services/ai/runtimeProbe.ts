/**
 * P0-a：真机断言执行器。
 *
 * 把 AcceptanceContract 里「机器可判定」的 runtime-* 断言下沉到 kunyu-observer
 * 观察通道：由**代码**读取运行中游戏（指定坐标方块 / 玩家背包）后判定，
 * 而不是让模型自己读值自述、自任裁判。
 *
 * 设计边界：
 * - 只处理 runtime-world / runtime-inventory 两类 pending 断言；
 * - 单项读取异常不阻断，按 unverified 落（诚实反映「没读到」而非「通过」）；
 * - 观察通道离线（port=null）时同样标 unverified，不冒充任何结论。
 */
import type { AcceptanceAssertion, AcceptanceContract } from '../../../shared/types/agent'
import {
  evaluateRuntimeInventory,
  evaluateRuntimeWorld,
  mergeAssertions,
  summarizeContract
} from './contractEvaluator'
import { fetchBlockAt, fetchInventory } from '../observer/observerClient'

export interface RuntimeProbeDeps {
  /** 读取指定整数坐标的方块注册名 */
  fetchBlock: (port: number, pos: { x: number; y: number; z: number }) => Promise<{ block: string }>
  /** 读取玩家背包非空槽位的物品注册名列表 */
  fetchInventory: (port: number) => Promise<{ slots: { id: string }[] }>
}

const defaultDeps: RuntimeProbeDeps = {
  fetchBlock: (port, pos) => fetchBlockAt(port, pos),
  fetchInventory: (port) => fetchInventory(port)
}

/**
 * 逐条读取并判定 pending 的 runtime-world / runtime-inventory 断言，合并回契约。
 * port=null 表示观察通道离线/未进世界：所有 pending runtime 断言标 unverified。
 */
export async function evaluateRuntimeAssertions(
  port: number | null,
  contract: AcceptanceContract,
  deps: RuntimeProbeDeps = defaultDeps
): Promise<AcceptanceContract> {
  const patch: AcceptanceAssertion[] = []
  for (const a of contract.assertions) {
    if (a.status !== 'pending') continue
    if (a.kind === 'runtime-world') {
      if (port === null) {
        patch.push(evaluateRuntimeWorld(a, null))
        continue
      }
      let reading: { block: string } | null = null
      if (a.x !== undefined && a.y !== undefined && a.z !== undefined) {
        try {
          reading = await deps.fetchBlock(port, { x: a.x, y: a.y, z: a.z })
        } catch {
          reading = null
        }
      }
      patch.push(evaluateRuntimeWorld(a, reading))
    } else if (a.kind === 'runtime-inventory') {
      if (port === null) {
        patch.push(evaluateRuntimeInventory(a, null))
        continue
      }
      let ids: string[] | null = null
      try {
        const inv = await deps.fetchInventory(port)
        ids = inv.slots.map((s) => s.id)
      } catch {
        ids = null
      }
      patch.push(evaluateRuntimeInventory(a, ids))
    }
  }
  if (patch.length === 0) return contract
  return summarizeContract(mergeAssertions(contract, patch))
}
