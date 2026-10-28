/**
 * 工具 schema 的上下文开销实测。
 * 之前从未量过 FC 工具定义实际注入的 token 总量（估算区间 10–25k），
 * 本测试按「JSON.stringify(schema) 字符量 + 同口径 token 估算」测出真实数字，
 * 输出到 stdout 供 docs/CONTEXT-MANAGEMENT.md 引用，并断言上限防止回归恶化。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createToolRegistry } from '../toolRegistry'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'

/** 与渲染层 aiChat / 主进程 historyBudget 同口径：CJK 1 字 ≈ 1 token，其余 4 字符 ≈ 1 token */
function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length
  return cjk + Math.ceil((text.length - cjk) / 4)
}

function schemaTokens(defs: ReturnType<ReturnType<typeof createToolRegistry>['getToolDefinitions']>): number {
  return estimateTokens(JSON.stringify(defs))
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-schema-budget-'))
  registerProjectRoot(root)
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('工具 schema 上下文开销实测', () => {
  it('测出无项目 / 有项目两种门控下的 schema token 总量', () => {
    const noProject = createToolRegistry()
    const noProjectDefs = noProject.getToolDefinitions()
    const noProjectTokens = schemaTokens(noProjectDefs)
    console.log(
      `[schema-budget] 无项目（聊天典型态）：${noProjectDefs.length} 个工具，` +
        `schema JSON ${JSON.stringify(noProjectDefs).length} 字符 ≈ ${noProjectTokens} token`
    )

    const withProject = createToolRegistry({ projectRoot: () => root })
    const withProjectDefs = withProject.getToolDefinitions()
    const withProjectTokens = schemaTokens(withProjectDefs)
    console.log(
      `[schema-budget] 有项目（fabric，512 上限）：${withProjectDefs.length} 个工具，` +
        `schema JSON ${JSON.stringify(withProjectDefs).length} 字符 ≈ ${withProjectTokens} token`
    )

    // 回归门：当前实测远低于此；若未来 schema 膨胀越过阈值会在 CI 暴露，而非静默吃掉窗口
    expect(noProjectTokens).toBeLessThanOrEqual(15_000)
    expect(withProjectTokens).toBeLessThanOrEqual(25_000)
  })
})
