/**
 * composeReply 结论失真修复的表驱动测试。
 *
 * 覆盖矩阵：{构建过/不过/跳过} × {文件经 FC 写入 / 经内容服务生成 / 无} × {导出 ok/跳过}
 *
 * 核心断言：
 * - 标题永远反映 RunOutcome 的真实结论，不拼接 plan.goal；
 * - 语义资产路径（assetSaves > 0）不再被误判为"零产出"；
 * - 构建失败时标题标"部分完成"而非"完成"。
 */
import { describe, expect, it } from 'vitest'
import type {
  AcceptanceContract,
  AgentFileChange,
  AgentPlan,
  BuildConclusion,
  ExportOutcome
} from '../../../../../shared/types/agent'
import { composeReply } from '../reply'
import type { ResolvedProject } from '../types'

const mockPlan: AgentPlan = {
  intent: 'code',
  contentTypes: ['item'],
  stages: ['generate', 'build'],
  goal: '新增 ruby 物品（模型自述目标句，不应出现在标题中）',
  tier: 'sprinter'
}

/** P0-5：code run 标"完成"的绿灯光谱 = 构建过 + 契约全 verified（契约缺失→部分完成） */
const verifiedContract: AcceptanceContract = {
  overall: 'verified',
  summary: '验收 1/1 通过',
  assertions: [
    { id: 'a1', kind: 'file-exists', description: '文件就位', expected: 'a.json', status: 'verified' }
  ]
}

const mockProject: ResolvedProject = {
  name: 'test-project',
  path: '/tmp/test-project',
  mcVersion: '1.20.1',
  loader: 'fabric'
} as ResolvedProject

const mockRequest = {} as never

function makeFile(path: string, accepted = true): AgentFileChange {
  return { path, action: 'create', content: '// stub', accepted, reason: accepted ? undefined : '路径逃逸' }
}

function makeBuild(status: BuildConclusion['status'], summary = '构建摘要'): BuildConclusion {
  return { status, rounds: 0, summary, matchedPatternIds: [] }
}

function makeExport(status: ExportOutcome['status'], artifacts: ExportOutcome['artifacts'] = []): ExportOutcome {
  return { status, artifacts, summary: status === 'ok' ? '导出成功' : '导出跳过' }
}

describe('composeReply：结论单一事实源（RunOutcome）', () => {
  it('构建通过 + FC 写入文件 → 标题标"完成"，文件章节展示', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java'), makeFile('src/main/resources/assets/test/lang/en_us.json')],
      build: makeBuild('pass', 'BUILD SUCCESSFUL'),
      test: null,
      export: null,
      contract: verifiedContract,
      notes: ''
    })
    expect(reply).toContain('✅ **新增/改动代码完成**')
    expect(reply).toContain('2 个文件')
    expect(reply).toContain('构建通过')
    // plan.goal 不应出现在标题中
    expect(reply).not.toContain('新增 ruby 物品')
  })

  it('P0-5：构建通过但契约缺失（计划含 generate）→ 标题标"部分完成"并明示契约未产出', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toContain('⚠️ **新增/改动代码部分完成**')
    expect(reply).toContain('验收契约未产出')
  })

  it('构建通过 + 语义资产路径（assetSaves>0）→ 不再误报"无产出"', () => {
    // 复现用户报告的假失败：文件经 content_upsert 写盘但 files 数组为空
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [], // FC 路径未填充
      assetSaves: 3, // 语义资产落盘 3 个
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: verifiedContract,
      notes: ''
    })
    expect(reply).toContain('✅ **新增/改动代码完成**')
    expect(reply).toContain('3 个语义资产')
    expect(reply).not.toContain('⚠️ 文件变更：无')
  })

  it('构建失败 + 有产出 → 标题标"部分完成"', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('fail', '3 轮修复未收敛'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toContain('⚠️ **新增/改动代码部分完成**')
    expect(reply).toContain('构建失败')
  })

  it('构建失败 + 零产出 → 标题标"未完成"', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [],
      build: makeBuild('fail', '编译错误'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toContain('❌ **新增/改动代码未完成**')
    expect(reply).toContain('构建失败')
  })

  it('构建跳过 + 零产出 → 标题标"未完成"，反幻觉兜底触发', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [],
      build: makeBuild('skipped'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toContain('❌ **新增/改动代码未完成**')
    expect(reply).toContain('⚠️ 文件变更：无')
  })

  it('构建通过 + 零产出 → 假绿灯被拦截（标"未完成"）', () => {
    // 复现 run#5 场景：6 个 JSON 零 Java 却 build 绿
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [],
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toContain('❌ **新增/改动代码未完成**')
    expect(reply).toContain('本轮无产出')
  })

  it('被拒绝的文件不记入产出，但展示在变更列表', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/Good.java', true), makeFile('../escape.java', false)],
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toContain('1 个文件')
    expect(reply).toContain('1 个被拒绝')
    expect(reply).toContain('⚠️ `../escape.java`（路径逃逸）')
  })

  it('混合产出（FC 文件 + 语义资产）→ 标题和文件章节都体现', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      assetSaves: 2,
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toContain('1 个文件 + 2 个语义资产')
    expect(reply).toContain('构建通过')
  })

  it('导出成功但构建失败 → 标题仍标"部分完成"（构建优先）', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('fail'),
      test: null,
      export: makeExport('ok', [{ kind: 'jar', path: '/tmp/test.jar' }]),
      contract: null,
      notes: ''
    })
    expect(reply).toContain('⚠️ **新增/改动代码部分完成**')
    expect(reply).toContain('构建失败')
  })

  it('P2：未闭环缺口逐条列出，并提示可断点续跑补齐', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: verifiedContract,
      generateGaps: ['src/main/java/ModBlocks.java 未落盘：花括号不配平'],
      notes: ''
    })
    expect(reply).toContain('⚠️ **新增/改动代码部分完成**')
    expect(reply).toContain('未闭环缺口')
    expect(reply).toContain('src/main/java/ModBlocks.java 未落盘：花括号不配平')
    expect(reply).toContain('可从本次断点续跑补齐缺口')
    // 已落盘的文件仍然展示（P2：缺口不再作废整份成果）
    expect(reply).toContain('1 个文件')
  })

  it('P2：成功收口时不出现缺口章节（无噪音）', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: verifiedContract,
      generateGaps: [],
      notes: ''
    })
    expect(reply).toContain('✅ **新增/改动代码完成**')
    expect(reply).not.toContain('未闭环缺口')
  })

  it('导出跳过 + 构建通过 + 有产出 → 标题标"完成"', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('pass'),
      test: null,
      export: makeExport('skipped'),
      contract: verifiedContract,
      notes: ''
    })
    expect(reply).toContain('✅ **新增/改动代码完成**')
    expect(reply).toContain('📦 导出：导出跳过')
  })
})

describe('composeReply：三态验收面板', () => {
  it('成功收口：面板逐项 ✅ 列出，计数与结论一致', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('pass', 'BUILD SUCCESSFUL'),
      test: null,
      export: null,
      contract: verifiedContract,
      notes: ''
    })
    expect(reply).toContain('📋 验收面板：')
    expect(reply).toContain('项已验证')
    expect(reply).toContain('✅ 内容产出：1 个文件 已落盘')
    expect(reply).toContain('✅ Gradle 构建：BUILD SUCCESSFUL')
    expect(reply).toContain('✅ 验收契约：验收 1/1 通过')
  })

  it('测试未触发 → 面板标 ⚪ 未验证，并附「不计入已验证」提示', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: verifiedContract,
      notes: ''
    })
    expect(reply).toContain('⚪ 游戏测试：未触发')
    expect(reply).toContain('不计入已验证')
  })

  it('构建失败 → 面板 ❌ 失败计数大于零，构建项标失败', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('fail', '编译错误'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toMatch(/📋 验收面板：\d+ 项已验证 · \d+ 项未验证 · [1-9]\d* 项失败/)
    expect(reply).toContain('❌ Gradle 构建：编译错误')
  })

  it('契约未产出（计划含 generate）→ 面板契约项标未验证', () => {
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: null,
      notes: ''
    })
    expect(reply).toContain('⚪ 验收契约：契约未产出，无法自动验收')
  })

  it('契约断言失败 → 面板契约项标 ❌；承诺类型缺失 → 面板列失败项', () => {
    const failContract: AcceptanceContract = {
      overall: 'failed',
      summary: '1 项失败',
      assertions: [
        { id: 'a1', kind: 'build-pass', description: '构建通过', expected: '', status: 'fail' }
      ]
    }
    const reply = composeReply({
      request: mockRequest,
      plan: mockPlan,
      tier: 'sprinter',
      tierMatched: [],
      project: mockProject,
      files: [makeFile('src/main/java/ModItems.java')],
      build: makeBuild('pass'),
      test: null,
      export: null,
      contract: failContract,
      missingContentTypes: ['recipe'],
      notes: ''
    })
    expect(reply).toContain('❌ 验收契约：1 项失败')
    expect(reply).toContain('❌ 承诺内容类型：recipe 未交付')
  })
})
