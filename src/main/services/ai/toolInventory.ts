/**
 * 内置工具清单：工具数量的唯一口径。
 *
 * 之前 README 写 93、AI-PIPELINE 写 66，都和实际注册表对不上——因为工具是
 * **按上下文门控**动态暴露的（无项目 / 模组项目 / 整合包项目各不相同），
 * 任何单一数字都只对某个场景成立。
 *
 * 因此这里不再维护常量，而是真的构造三次 ToolRegistry 去数，
 * 结果写入 `docs/TOOLS-INVENTORY.json`，由 `toolInventory.spec.ts` 守门；
 * 文档只引用这份产物，不再手写数字。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { createToolRegistry } from './toolRegistry'

/** 清单覆盖的三种真实运行态 */
export const INVENTORY_SCENARIOS = ['chat', 'mod', 'modpack'] as const
export type InventoryScenario = (typeof INVENTORY_SCENARIOS)[number]

export interface ToolInventoryEntry {
  /** 场景中文说明（给文档用） */
  label: string
  /** 该场景下进入模型 FC 列表的工具数 */
  count: number
  /** 工具名（排序后），用于发现「哪个工具被门控掉了」 */
  tools: string[]
}

export type ToolInventory = Record<InventoryScenario, ToolInventoryEntry>

const SCENARIO_LABELS: Record<InventoryScenario, string> = {
  chat: '无项目（纯对话）',
  mod: '模组项目（Fabric）',
  modpack: '整合包项目（Fabric）'
}

function collect(scenario: InventoryScenario, root: string | null): ToolInventoryEntry {
  const registry = createToolRegistry(
    root === null
      ? {}
      : {
          projectRoot: () => root,
          projectType: () => (scenario === 'modpack' ? 'modpack' : 'mod'),
          projectLoader: () => 'fabric'
        }
  )
  const tools = registry
    .getToolDefinitions()
    .map((d) => d.function.name)
    .sort()
  return { label: SCENARIO_LABELS[scenario], count: tools.length, tools }
}

/**
 * 实测三种运行态的工具清单。
 * 每个场景用独立临时目录，避免相互污染（工具可用性会读项目根）。
 */
export function collectToolInventory(): ToolInventory {
  const result = {} as ToolInventory
  for (const scenario of INVENTORY_SCENARIOS) {
    if (scenario === 'chat') {
      result[scenario] = collect(scenario, null)
      continue
    }
    const root = mkdtempSync(join(tmpdir(), `kunyu-tools-${scenario}-`))
    registerProjectRoot(root)
    try {
      result[scenario] = collect(scenario, root)
    } finally {
      unregisterProjectRoot(root)
      rmSync(root, { recursive: true, force: true })
    }
  }
  return result
}

/** 稳定序列化（2 空格缩进 + 结尾换行），供脚本落盘与测试比对 */
export function serializeInventory(inventory: ToolInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`
}
