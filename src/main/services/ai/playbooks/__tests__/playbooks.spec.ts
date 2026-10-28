/**
 * P5 playbook 层测试：
 * - 注册表完整（6 条、id 唯一、五段齐全）
 * - 工具路由交叉校验：route.tools 全部真实存在于 FC 注册表（防工具改名漂移）
 * - 选择打分：实体/verify/modpack/chat 场景 + 阈值与上限
 * - 渲染：空命中空串；非空含五段标记
 */
import { describe, expect, it } from 'vitest'
import { createToolRegistry } from '../../toolRegistry'
import {
  PLAYBOOKS,
  renderPlaybookSection,
  scorePlaybook,
  selectPlaybooks
} from '../index'

describe('P5 playbook 注册表', () => {
  it('注册 8 条 playbook 且 id 唯一（P7 build-repair / P10 performance-design）', () => {
    expect(PLAYBOOKS).toHaveLength(8)
    const ids = PLAYBOOKS.map((p) => p.id)
    expect(new Set(ids).size).toBe(8)
  })

  it('每条 playbook 五段齐全（意图触发/工具路由/工作流/验收门/失败契约）', () => {
    for (const pb of PLAYBOOKS) {
      expect(pb.triggers.length + (pb.contentTypes?.length ?? 0) + (pb.intents?.length ?? 0)).toBeGreaterThan(0)
      expect(pb.route.tools.length).toBeGreaterThan(0)
      expect(pb.route.note.length).toBeGreaterThan(0)
      expect(pb.workflow.length).toBeGreaterThanOrEqual(2)
      expect(pb.acceptanceGates.length).toBeGreaterThanOrEqual(1)
      expect(pb.failureContract.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('工具路由引用的工具全部真实存在于 FC 注册表（含调度工具 gradle_build）', () => {
    // 无 deps 注册即含全部内置工具；has() 查原始注册表，不受可见性门控影响
    const registry = createToolRegistry()
    for (const pb of PLAYBOOKS) {
      for (const tool of pb.route.tools) {
        expect(registry.has(tool), `${pb.id} 路由引用了不存在的工具：${tool}`).toBe(true)
      }
    }
  })
})

describe('P5 playbook 选择打分', () => {
  it('实体创作任务：content-authoring 居首', () => {
    const picked = selectPlaybooks({
      message: '帮我做个会偷东西的盗贼实体',
      intent: 'code',
      contentTypes: ['entity']
    })
    expect(picked.length).toBeGreaterThan(0)
    expect(picked[0].id).toBe('content-authoring')
  })

  it('贴图任务：texture-visual 命中', () => {
    const picked = selectPlaybooks({
      message: '给这把刀画个贴图',
      intent: 'code',
      contentTypes: ['item']
    })
    const ids = picked.map((p) => p.id)
    expect(ids).toContain('texture-visual')
  })

  it('游戏内验证任务：game-test 命中', () => {
    const picked = selectPlaybooks({
      message: '进游戏验证一下实体能否刷出来',
      intent: 'verify',
      contentTypes: []
    })
    expect(picked.map((p) => p.id)).toContain('game-test')
  })

  it('整合包市场任务：knowledge-market 命中', () => {
    const picked = selectPlaybooks({
      message: '帮我加个性能优化模组',
      intent: 'code',
      contentTypes: [],
      projectType: 'modpack'
    })
    expect(picked.map((p) => p.id)).toContain('knowledge-market')
  })

  it('普通问答：低于阈值不注入（空数组）', () => {
    const picked = selectPlaybooks({
      message: '什么是生物群系？',
      intent: 'chat',
      contentTypes: []
    })
    expect(picked).toEqual([])
  })

  it('注入上限 3 条且按分数降序', () => {
    // 构造全维度命中：mixin 实体 + 贴图 + 构建 + modpack
    const picked = selectPlaybooks({
      message: '混入 mixin 贴图 构建 模组 实体 方块',
      intent: 'code',
      contentTypes: ['entity', 'mixin'],
      projectType: 'modpack'
    })
    expect(picked.length).toBeLessThanOrEqual(3)
    const scores = picked.map((p) =>
      scorePlaybook(p, {
        message: '混入 mixin 贴图 构建 模组 实体 方块',
        intent: 'code',
        contentTypes: ['entity', 'mixin'],
        projectType: 'modpack'
      })
    )
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i])
  })

  it('空 message 不崩：intent 单独（+2）不达阈值，contentTypes 命中（+3）单独即注入', () => {
    expect(selectPlaybooks({ message: '', intent: 'verify', contentTypes: [] })).toEqual([])
    const byType = selectPlaybooks({ message: '', intent: 'chat', contentTypes: ['entity'] })
    expect(byType.map((p) => p.id)).toEqual(['content-authoring'])
  })

  it('P7：修复类任务命中 build-repair 居首（诊断规程压过工程改动规程）', () => {
    const picked = selectPlaybooks({
      message: '构建失败了，帮我修复这个崩溃报错',
      intent: 'fix',
      contentTypes: []
    })
    expect(picked.length).toBeGreaterThan(0)
    expect(picked[0].id).toBe('build-repair')
  })

  it('P7 分工：纯工程改动任务命中 code-change 而非 build-repair', () => {
    const picked = selectPlaybooks({
      message: '帮我重构编辑这段 gradle 构建脚本',
      intent: 'code',
      contentTypes: []
    })
    const ids = picked.map((p) => p.id)
    expect(ids).toContain('code-change')
    expect(ids).not.toContain('build-repair')
  })

  it('P10：高频/性能任务命中 performance-design', () => {
    const picked = selectPlaybooks({
      message: '实体 tick 里每周期扫描周围玩家，有点卡顿，帮我看看性能',
      intent: 'code',
      contentTypes: []
    })
    expect(picked.map((p) => p.id)).toContain('performance-design')
  })
})

describe('P5 playbook 渲染', () => {
  it('空命中返回空串', () => {
    expect(renderPlaybookSection([])).toBe('')
  })

  it('非空渲染含规程头与五段标记', () => {
    const picked = selectPlaybooks({
      message: '帮我做个盗贼实体',
      intent: 'code',
      contentTypes: ['entity']
    })
    const section = renderPlaybookSection(picked)
    expect(section).toContain('【任务规程】')
    expect(section).toContain('◆ 内容创作规程')
    expect(section).toContain('路由：')
    expect(section).toContain('流程：1)')
    expect(section).toContain('验收：')
    expect(section).toContain('失败：')
  })

  it('满配 3 条渲染长度受控（prompt 防膨胀）', () => {
    const section = renderPlaybookSection(PLAYBOOKS.slice(0, 3))
    // 3 条约 1000~1500 字符（中文），硬上限 2400 防失控
    expect(section.length).toBeLessThan(2400)
  })
})
