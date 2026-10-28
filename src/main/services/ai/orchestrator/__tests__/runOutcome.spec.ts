/**
 * deriveRunOutcome 验收收口测试（P0-2 完整性 / P0-4 verdict 看测试与契约）。
 */
import { describe, expect, it } from 'vitest'
import type {
  AcceptanceContract,
  AgentFileChange,
  BuildConclusion,
  TestOutcome
} from '../../../../../shared/types/agent'
import { deriveRunOutcome, type DeriveOutcomeInput } from '../runOutcome'

const acceptedFile: AgentFileChange = {
  path: 'src/main/java/A.java', action: 'create', content: 'x', accepted: true
}
const passBuild: BuildConclusion = {
  status: 'pass', rounds: 1, summary: 'BUILD SUCCESSFUL', matchedPatternIds: []
}

function baseInput(over: Partial<DeriveOutcomeInput> = {}): DeriveOutcomeInput {
  return {
    files: [], assetSaves: 0, build: null, test: null,
    visualReview: null, export: null, contract: null,
    missingContentTypes: [],
    // 默认 false = verify 类 run（无 generate 阶段，契约缺失不扣分）；code 类测试显式传 true
    contractExpected: false, ...over
  }
}

describe('deriveRunOutcome 验收收口（P0-2 / P0-4）', () => {
  it('构建通过 + 有产出 + 承诺全交付 + 测试契约无失败 → success', () => {
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild }))
    expect(o.verdict).toBe('success')
    expect(o.gaps).toEqual([])
  })

  it('P0-2：承诺的 recipe 未交付 → 降为 partial，gaps 指明缺失类型', () => {
    const o = deriveRunOutcome(
      baseInput({ files: [acceptedFile], build: passBuild, missingContentTypes: ['recipe'] })
    )
    expect(o.verdict).toBe('partial')
    expect(o.gaps.join('')).toContain('recipe')
  })

  it('P0-4：游戏测试明确失败 → partial，gaps 指明测试未过', () => {
    const test: TestOutcome = { status: 'gametest-fail', screenshotPath: null, summary: '1 项失败' }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, test }))
    expect(o.verdict).toBe('partial')
    expect(o.gaps.join('')).toContain('测试')
  })

  it('P0-4：契约含 failed 断言 → partial，gaps 指明断言失败', () => {
    const contract: AcceptanceContract = {
      overall: 'failed', summary: '1 项失败',
      assertions: [{ id: 'a1', kind: 'build-pass', description: '构建通过', expected: '', status: 'fail' }]
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, contract }))
    expect(o.verdict).toBe('partial')
    expect(o.gaps.join('')).toContain('断言')
    expect(o.runStatus).toBe('failed')
  })

  it('P2：generate 上报静态缺口（缺 Java / 被闸门拒收）→ partial + 逐条列出 + 落 failed 可续跑', () => {
    const o = deriveRunOutcome(
      baseInput({
        files: [acceptedFile],
        build: passBuild,
        contract: { overall: 'verified', summary: 'ok', assertions: [] },
        generateGaps: ['src/main/java/B.java 未落盘：花括号不配平', '缺少贴图 assets/x/textures/item/c.png']
      })
    )
    expect(o.verdict).not.toBe('success')
    expect(o.verdict).toBe('partial')
    expect(o.runStatus).toBe('failed')
    // 缺口原文逐条透出（不再只剩一句「生成失败」，用户能看到已落盘了什么、还差什么）
    expect(o.gaps).toContain('src/main/java/B.java 未落盘：花括号不配平')
    expect(o.gaps).toContain('缺少贴图 assets/x/textures/item/c.png')
    expect(o.headline).toContain('验收未达标')
  })

  it('P2：静态缺口 + 无产出 → failed（缺口不掩盖零产出）', () => {
    const o = deriveRunOutcome(baseInput({ files: [], build: passBuild, generateGaps: ['缺核心 Java'] }))
    expect(o.verdict).toBe('failed')
    expect(o.runStatus).toBe('failed')
  })

  it('仅含 awaiting-user 人工确认项 → 封顶 partial 但落 completed（不烧续跑额度）', () => {
    const contract: AcceptanceContract = {
      overall: 'pending', summary: '1 项待确认',
      assertions: [
        {
          id: 'a1', kind: 'user-confirmation', description: '进游戏确认效果', expected: '',
          status: 'awaiting-user'
        }
      ]
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, contract }))
    expect(o.verdict).toBe('partial')
    expect(o.gaps).toEqual([])
    expect(o.runStatus).toBe('completed')
    expect(o.headline).toContain('待人工确认')
  })

  it('awaiting-user 与真实失败并存 → 仍落 failed（失败不被待确认项稀释）', () => {
    const contract: AcceptanceContract = {
      overall: 'failed', summary: '1 失败 1 待确认',
      assertions: [
        { id: 'a1', kind: 'build-pass', description: '构建通过', expected: '', status: 'fail' },
        { id: 'a2', kind: 'user-confirmation', description: '进游戏确认', expected: '', status: 'awaiting-user' }
      ]
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, contract }))
    expect(o.verdict).toBe('partial')
    expect(o.runStatus).toBe('failed')
  })
})

describe('deriveRunOutcome 未验证不得 completed（P0-5）', () => {
  it('P0-5：构建通过 + 断言 unverified（压根没评估）→ partial + failed（不得 completed），gaps 指明未评估', () => {
    const contract: AcceptanceContract = {
      overall: 'unverified', summary: '1 项未评估',
      assertions: [{ id: 'a1', kind: 'gametest-runtime', description: '游戏实测', expected: '', status: 'unverified' }]
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, contract }))
    expect(o.verdict).toBe('partial')
    expect(o.gaps.join('')).toContain('未评估')
    expect(o.runStatus).toBe('failed')
    expect(o.headline).toContain('未评估')
  })

  it('P0-5：pending/skipped 与 awaiting-user 并存 → 仍 failed（未评估项不被人工确认项稀释）', () => {
    const contract: AcceptanceContract = {
      overall: 'pending', summary: '1 未评估 1 待确认',
      assertions: [
        { id: 'a1', kind: 'registry-entry', description: '注册条目', expected: 'a.json', status: 'pending' },
        { id: 'a2', kind: 'user-confirmation', description: '进游戏确认', expected: '', status: 'awaiting-user' }
      ]
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, contract }))
    expect(o.runStatus).toBe('failed')
  })

  it('P0-5：contractExpected 且契约缺失（LLM 未回契约）→ 封顶 partial + failed，gaps 指明契约未产出', () => {
    const o = deriveRunOutcome(
      baseInput({ files: [acceptedFile], build: passBuild, contractExpected: true })
    )
    expect(o.verdict).toBe('partial')
    expect(o.gaps.join('')).toContain('验收契约未产出')
    expect(o.runStatus).toBe('failed')
  })

  it('P0-5：verify 类 run（contractExpected=false）契约缺失不扣分 → 仍 success（回归保护）', () => {
    const o = deriveRunOutcome(
      baseInput({ files: [acceptedFile], build: passBuild, contractExpected: false })
    )
    expect(o.verdict).toBe('success')
    expect(o.gaps).toEqual([])
    expect(o.runStatus).toBe('completed')
  })

  it('P0-5：旧值 skipped 归入未评估 → failed（与 unverified 同等对待）', () => {
    const contract: AcceptanceContract = {
      overall: 'unverified', summary: '1 项跳过',
      assertions: [{ id: 'a1', kind: 'texture-ready', description: '贴图就位', expected: 'a.png', status: 'skipped' }]
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, contract }))
    expect(o.runStatus).toBe('failed')
  })
})

describe('deriveRunOutcome 环境阻塞不得误判失败（P0-b）', () => {
  const envSkip: BuildConclusion = {
    status: 'skipped',
    rounds: 0,
    summary: '项目目录缺少 gradlew，无法构建；请先通过新建项目向导生成完整工程。',
    matchedPatternIds: [],
    blockedByEnvironment: true
  }

  it('环境阻塞 + 有产出 + 无真实失败信号 → inconclusive（不冒充失败，也不冒充完成）', () => {
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: envSkip }))
    expect(o.verdict).toBe('inconclusive')
    expect(o.runStatus).toBe('inconclusive')
    expect(o.headline).toContain('无法判定')
    expect(o.gaps).toEqual([])
  })

  it('环境阻塞 + 零产出 + 无真实失败信号 → 仍 inconclusive（工具链问题不归罪模型）', () => {
    const o = deriveRunOutcome(baseInput({ files: [], build: envSkip }))
    expect(o.verdict).toBe('inconclusive')
    expect(o.runStatus).toBe('inconclusive')
  })

  it('环境阻塞但存在真实失败信号（断言失败）→ 不判 inconclusive（真实失败不被环境掩盖）', () => {
    const contract: AcceptanceContract = {
      overall: 'failed', summary: '1 项失败',
      assertions: [
        { id: 'a1', kind: 'file-exists', description: '文件就位', expected: 'a.json', status: 'failed' }
      ]
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: envSkip, contract }))
    expect(o.verdict).not.toBe('inconclusive')
    expect(o.runStatus).toBe('failed')
  })

  it('回归保护：普通 skipped（无环境标记）+ 零产出 → 仍 failed（不误放宽）', () => {
    const plainSkip: BuildConclusion = {
      status: 'skipped', rounds: 0, summary: '没有打开的项目，无法执行真实 Gradle 构建。',
      matchedPatternIds: []
    }
    const o = deriveRunOutcome(baseInput({ files: [], build: plainSkip }))
    expect(o.verdict).toBe('failed')
    expect(o.runStatus).toBe('failed')
  })
})

describe('deriveRunOutcome 三态验收面板', () => {
  it('全绿场景：产出/构建/测试/契约全部 verified，无未验证与失败项', () => {
    const test: TestOutcome = { status: 'gametest-ok', screenshotPath: null, summary: '2 项通过' }
    const contract: AcceptanceContract = {
      overall: 'verified', summary: '验收 1/1 通过',
      assertions: [
        { id: 'a1', kind: 'file-exists', description: '文件就位', expected: 'a.json', status: 'verified' }
      ]
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, test, contract }))
    const byId = Object.fromEntries(o.checks.map((c) => [c.id, c]))
    expect(byId.output.state).toBe('verified')
    expect(byId.build.state).toBe('verified')
    expect(byId.test.state).toBe('verified')
    expect(byId.contract.state).toBe('verified')
    expect(o.checks.some((c) => c.state !== 'verified')).toBe(false)
  })

  it('测试跳过/未触发 → 面板标未验证（inconclusive 不得计入已验证）', () => {
    const skipped: TestOutcome = { status: 'skipped', screenshotPath: null, summary: '通道离线' }
    const o1 = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, test: skipped }))
    expect(o1.checks.find((c) => c.id === 'test')).toMatchObject({
      state: 'inconclusive', evidence: '通道离线'
    })
    const o2 = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild }))
    expect(o2.checks.find((c) => c.id === 'test')).toMatchObject({
      state: 'inconclusive', evidence: '未触发'
    })
  })

  it('构建失败/测试失败 → 面板对应项标失败', () => {
    const o = deriveRunOutcome(
      baseInput({
        files: [acceptedFile],
        build: { status: 'fail', rounds: 3, summary: '编译错误', matchedPatternIds: [] },
        test: { status: 'gametest-fail', screenshotPath: null, summary: '1 项失败' }
      })
    )
    expect(o.checks.find((c) => c.id === 'build')?.state).toBe('failed')
    expect(o.checks.find((c) => c.id === 'test')?.state).toBe('failed')
  })

  it('契约含 failed 断言 → 契约项失败；unverified 断言 → 契约项未验证并注明数量', () => {
    const failC: AcceptanceContract = {
      overall: 'failed', summary: '1 项失败',
      assertions: [{ id: 'a1', kind: 'build-pass', description: '构建通过', expected: '', status: 'fail' }]
    }
    const c1 = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, contract: failC }))
      .checks.find((c) => c.id === 'contract')
    expect(c1?.state).toBe('failed')

    const unvC: AcceptanceContract = {
      overall: 'unverified', summary: '1 项未评估',
      assertions: [
        { id: 'a1', kind: 'gametest-runtime', description: '游戏实测', expected: '', status: 'unverified' }
      ]
    }
    const c2 = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild, contract: unvC }))
      .checks.find((c) => c.id === 'contract')
    expect(c2?.state).toBe('inconclusive')
    expect(c2?.evidence).toContain('未评估')
  })

  it('contractExpected 且契约缺失 → 契约项未验证（契约未产出）；verify 类 run 不上契约项', () => {
    const o1 = deriveRunOutcome(
      baseInput({ files: [acceptedFile], build: passBuild, contractExpected: true })
    )
    expect(o1.checks.find((c) => c.id === 'contract')?.state).toBe('inconclusive')
    expect(o1.checks.find((c) => c.id === 'contract')?.evidence).toContain('契约未产出')

    const o2 = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild }))
    expect(o2.checks.find((c) => c.id === 'contract')).toBeUndefined()
  })

  it('承诺类型缺失/静态缺口 → 面板显式列失败项', () => {
    const o = deriveRunOutcome(
      baseInput({
        files: [acceptedFile],
        build: passBuild,
        missingContentTypes: ['recipe'],
        generateGaps: ['缺贴图 x.png']
      })
    )
    expect(o.checks.find((c) => c.id === 'promised-types')?.state).toBe('failed')
    expect(o.checks.find((c) => c.id === 'promised-types')?.evidence).toContain('recipe')
    expect(o.checks.find((c) => c.id === 'generate-gaps')?.state).toBe('failed')
  })

  it('环境阻塞构建 → 面板标未验证而非失败（工具链问题不归罪内容）', () => {
    const envSkip: BuildConclusion = {
      status: 'skipped', rounds: 0, summary: '项目目录缺少 gradlew',
      matchedPatternIds: [], blockedByEnvironment: true
    }
    const o = deriveRunOutcome(baseInput({ files: [acceptedFile], build: envSkip }))
    expect(o.checks.find((c) => c.id === 'build')?.state).toBe('inconclusive')
  })

  it('零产出 → 内容产出项失败（与假绿灯拦截对齐）', () => {
    const o = deriveRunOutcome(baseInput({ files: [], build: passBuild }))
    expect(o.checks.find((c) => c.id === 'output')).toMatchObject({
      state: 'failed', evidence: '本轮无产出'
    })
  })

  it('视觉自审未触发不上面板；触发后按状态标三态', () => {
    const o1 = deriveRunOutcome(baseInput({ files: [acceptedFile], build: passBuild }))
    expect(o1.checks.find((c) => c.id === 'visual')).toBeUndefined()

    const o2 = deriveRunOutcome(
      baseInput({
        files: [acceptedFile],
        build: passBuild,
        visualReview: {
          status: 'skipped', score: null, feedback: '无模型文件', rounds: 0, screenshotPath: null
        }
      })
    )
    expect(o2.checks.find((c) => c.id === 'visual')).toMatchObject({
      state: 'inconclusive', evidence: '无模型文件'
    })
  })
})
