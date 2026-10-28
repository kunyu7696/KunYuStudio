/**
 * P1 视觉自审（visualReview，方案 A）单测：
 * 三视图渲染/截图/视觉模型/读写文件全部 mock，验证硬门一票否决、指标护栏、
 * 回写上限、失败契约（回滚）与降级路径。
 */
import { describe, expect, it, vi } from 'vitest'
import type { AgentFileChange } from '../../../shared/types/agent'
import type { Raster } from '../ai/pixelize'
import type { ModelSnapshotResult } from '../ai/modelSnapshot'
import {
  applyModelFix,
  findModelAssetPaths,
  parseReviewAnswer,
  runVisualReview,
  VISUAL_REVIEW_MAX_ROUNDS,
  VISUAL_REVIEW_PASS_SCORE,
  type VisualReviewDeps,
  type VisualReviewShot
} from '../ai/orchestrator/visualReview'

const SHOT: VisualReviewShot = { dataUrl: 'data:image/png;base64,AAA', savedPath: 'C:/tmp/shot.png' }
const MODEL_ABS = 'C:/proj/assets/demo/models/item/katana.json'
const MODEL_JSON = JSON.stringify({
  parent: 'item/handheld',
  elements: [{ name: 'blade', from: [7.4, 5, 7.4], to: [8.6, 15.5, 8.6] }],
  display: { gui: { rotation: [30, 225, 0] } }
})

const GATE_IDS = ['identifiable', 'proportionate', 'noFloating', 'noBlackFace', 'textureBound'] as const

/** 拼装评审应答 JSON；gateFail 指定一扇不过的硬门 */
function answerJson(score: number, opts: { feedback?: string; gateFail?: string; fix?: unknown } = {}): string {
  const gates: Record<string, { pass: boolean; note: string }> = {}
  for (const id of GATE_IDS) {
    gates[id] = { pass: id !== opts.gateFail, note: id === opts.gateFail ? '看不出目标物特征' : '' }
  }
  return JSON.stringify({
    score,
    feedback: opts.feedback ?? '',
    gates,
    ...(opts.fix ? { fix: opts.fix } : {})
  })
}

/** 中心 80×80 棋盘格：occupancy≈0.17、对比/边缘充足、不贴边 */
function goodRaster(): Raster {
  const data = new Uint8ClampedArray(192 * 192 * 4)
  for (let y = 56; y < 136; y++) {
    for (let x = 56; x < 136; x++) {
      const on = (x + y) % 2 === 0
      data.set(on ? [220, 220, 220, 255] : [20, 20, 20, 255], (y * 192 + x) * 4)
    }
  }
  return { width: 192, height: 192, data }
}

function makeSnapshot(raster: Raster = goodRaster()): ModelSnapshotResult {
  const mk = (view: 'front' | 'side' | 'iso') => ({ view, raster, dataUrl: 'data:image/png;base64,AAA' })
  return { views: [mk('front'), mk('side'), mk('iso')], warnings: [] }
}

const EMPTY_SNAPSHOT: ModelSnapshotResult = {
  views: [
    { view: 'front', raster: { width: 192, height: 192, data: new Uint8ClampedArray(192 * 192 * 4) }, dataUrl: 'data:image/png;base64,AAA' },
    { view: 'side', raster: { width: 192, height: 192, data: new Uint8ClampedArray(192 * 192 * 4) }, dataUrl: 'data:image/png;base64,AAA' },
    { view: 'iso', raster: { width: 192, height: 192, data: new Uint8ClampedArray(192 * 192 * 4) }, dataUrl: 'data:image/png;base64,AAA' }
  ],
  warnings: []
}

function makeFiles(paths: Array<[string, boolean]>): AgentFileChange[] {
  return paths.map(([path, accepted]) => ({ path, action: 'create', content: '', accepted }) as AgentFileChange)
}

function makeDeps(overrides: Partial<VisualReviewDeps> = {}) {
  const written: Array<[string, string]> = []
  const deps: VisualReviewDeps = {
    snapshot: vi.fn(() => makeSnapshot()),
    capture: vi.fn(async () => SHOT),
    ask: vi.fn(async () => answerJson(VISUAL_REVIEW_PASS_SCORE + 10, { feedback: '造型合格' })),
    readFile: vi.fn((abs: string) => (abs === MODEL_ABS ? MODEL_JSON : null)),
    writeFile: vi.fn((abs: string, content: string) => {
      written.push([abs, content])
    }),
    ...overrides
  }
  return { deps, written }
}

describe('findModelAssetPaths', () => {
  it('挑出已写盘的模型 JSON，去重且拒绝未接受/非模型路径', () => {
    const files = makeFiles([
      ['assets/demo/models/item/katana.json', true],
      ['assets/demo/models/item/katana.json', true],
      ['src/main/java/demo/Katana.java', true],
      ['assets/demo/models/item/rejected.json', false],
      ['assets/demo/textures/item/katana.png', true]
    ])
    expect(findModelAssetPaths(files)).toEqual(['assets/demo/models/item/katana.json'])
  })
})

describe('parseReviewAnswer', () => {
  it('解析纯 JSON 并截断分数到 0-100', () => {
    expect(parseReviewAnswer('{"score":120,"feedback":"x"}')).toMatchObject({ score: 100, feedback: 'x' })
    expect(parseReviewAnswer('{"score":-5,"feedback":"x"}')).toMatchObject({ score: 0 })
  })
  it('容忍围栏与前后杂言', () => {
    const raw = '好的，评审如下：\n```json\n{"score":55,"feedback":"太扁","fix":{"elements":[]}}\n```'
    expect(parseReviewAnswer(raw)).toMatchObject({ score: 55, feedback: '太扁' })
  })
  it('缺 score 或无法解析时返回 null', () => {
    expect(parseReviewAnswer('{"feedback":"x"}')).toBeNull()
    expect(parseReviewAnswer('没有 JSON')).toBeNull()
    expect(parseReviewAnswer('{broken')).toBeNull()
  })
  it('解析五项硬门；硬门缺失/结构不全 → gates 为 null', () => {
    const ok = parseReviewAnswer(answerJson(90, { gateFail: 'noFloating' }))
    expect(ok!.gates).toHaveLength(5)
    expect(ok!.gates!.find((g) => g.id === 'noFloating')!.pass).toBe(false)
    expect(parseReviewAnswer('{"score":90,"feedback":"x"}')!.gates).toBeNull()
    expect(parseReviewAnswer('{"score":90,"gates":{"identifiable":{"pass":true}}}')!.gates).toBeNull()
    expect(parseReviewAnswer('{"score":90,"gates":{"identifiable":{"note":"x"},"proportionate":{"pass":true},"noFloating":{"pass":true},"noBlackFace":{"pass":true},"textureBound":{"pass":true}}}')!.gates).toBeNull()
  })
})

describe('applyModelFix', () => {
  it('elements 整体替换、display 浅合并、parent 移除', () => {
    const { deps, written } = makeDeps()
    const ok = applyModelFix(deps, MODEL_ABS, {
      elements: [{ name: 'b', from: [7, 0, 7], to: [9, 15, 9] }],
      display: { thirdperson_righthand: { scale: [1.4, 1.4, 1.4] } }
    })
    expect(ok).toBe(true)
    const out = JSON.parse(written[0]![1]) as Record<string, unknown>
    expect(out['parent']).toBeUndefined()
    expect((out['elements'] as unknown[]).length).toBe(1)
    const display = out['display'] as Record<string, unknown>
    expect(display['gui']).toEqual({ rotation: [30, 225, 0] })
    expect(display['thirdperson_righthand']).toEqual({ scale: [1.4, 1.4, 1.4] })
  })
  it('非法 elements / 空 fix / 文件不可读时不写盘', () => {
    const { deps } = makeDeps()
    expect(applyModelFix(deps, MODEL_ABS, { elements: [{ from: [0, 0], to: [1, 1, 1] }] })).toBe(false)
    expect(applyModelFix(deps, MODEL_ABS, {})).toBe(false)
    expect(applyModelFix(deps, 'C:/nope.json', { elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] })).toBe(false)
    expect(deps.writeFile).not.toHaveBeenCalled()
  })
})

describe('runVisualReview', () => {
  it('首评达标：pass（硬门全过+指标达标）且不发生回写', async () => {
    const { deps } = makeDeps()
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('pass')
    expect(out.score).toBe(VISUAL_REVIEW_PASS_SCORE + 10)
    expect(out.rounds).toBe(0)
    expect(out.screenshotPath).toBe(SHOT.savedPath)
    expect(out.evidence).toBe('mixed')
    expect(out.gates).toHaveLength(5)
    expect(out.metrics).not.toBeNull()
    expect(out.rolledBack).toBe(false)
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it('不达标 → 回写 → 复评达标：rounds=1，重渲染+重抓真机帧', async () => {
    const fix = { elements: [{ name: 'blade', from: [7, 0, 7], to: [9, 15, 9] }] }
    const ask = vi
      .fn()
      .mockResolvedValueOnce(answerJson(40, { feedback: '太扁', fix }))
      .mockResolvedValueOnce(answerJson(88, { feedback: '修好后合格' }))
    const { deps, written } = makeDeps({ ask })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('pass')
    expect(out.rounds).toBe(1)
    expect(written.length).toBe(1)
    expect(deps.capture).toHaveBeenCalledTimes(2)
    expect(deps.snapshot).toHaveBeenCalledTimes(2)
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it('硬门一票否决：score 远超阈值但一扇不过 → fail（不受分数豁免）', async () => {
    const ask = vi.fn(async () => answerJson(96, { feedback: '像根棍子', gateFail: 'identifiable' }))
    const { deps } = makeDeps({ ask })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('fail')
    expect(out.score).toBe(96)
    expect(out.feedback).toContain('identifiable')
    expect(out.gates!.find((g) => g.id === 'identifiable')!.pass).toBe(false)
  })

  it('指标越界：score 与硬门全过仍 fail（客观护栏）', async () => {
    const { deps } = makeDeps({ snapshot: vi.fn(() => EMPTY_SNAPSHOT) })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('fail')
    expect(out.metricViolations!.length).toBeGreaterThan(0)
    expect(out.feedback).toContain('指标越界')
  })

  it('失败契约：连续不达标轮次封顶 → fail + 回滚模型文件到评审前状态', async () => {
    const fix = { display: { thirdperson_righthand: { scale: [1.5, 1.5, 1.5] } } }
    const ask = vi.fn().mockResolvedValue(answerJson(30, { feedback: '还是扁', fix }))
    const { deps, written } = makeDeps({ ask })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('fail')
    expect(out.rounds).toBe(VISUAL_REVIEW_MAX_ROUNDS)
    /* 3 次 fix 回写 + 1 次回滚 */
    expect(written.length).toBe(VISUAL_REVIEW_MAX_ROUNDS + 1)
    expect(out.rolledBack).toBe(true)
    expect(written[written.length - 1]![1]).toBe(MODEL_JSON)
    expect(out.feedback).toContain('回滚')
  })

  it('未发生回写的 fail 不回滚（rolledBack=false）', async () => {
    const ask = vi.fn(async () => '看起来还行，加油吧')
    const { deps, written } = makeDeps({ ask })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('fail')
    expect(out.rolledBack).toBe(false)
    expect(written.length).toBe(0)
  })

  it('应答缺硬门结论：按不过处理（保守判 fail）', async () => {
    const ask = vi.fn(async () => '{"score":95,"feedback":"不错"}')
    const { deps } = makeDeps({ ask })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('fail')
    expect(out.gates!.every((g) => g.note === '评审未给出该门结论')).toBe(true)
  })

  it('离线渲染不可用但真机在线：仅凭真机画面评审（evidence=live）', async () => {
    const { deps } = makeDeps({ snapshot: vi.fn(() => null) })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('pass')
    expect(out.evidence).toBe('live')
    expect(out.metrics).toBeNull()
  })

  it('真机离线但离线渲染可用：正常评审（evidence=offline）', async () => {
    const { deps } = makeDeps({ capture: vi.fn(async () => null) })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('pass')
    expect(out.evidence).toBe('offline')
    expect(out.screenshotPath).toBeNull()
  })

  it('两条证据通道全离线：skipped，不提问不写盘', async () => {
    const { deps } = makeDeps({ snapshot: vi.fn(() => null), capture: vi.fn(async () => null) })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('skipped')
    expect(out.score).toBeNull()
    expect(deps.ask).not.toHaveBeenCalled()
    expect(deps.writeFile).not.toHaveBeenCalled()
  })

  it('无模型资产：skipped', async () => {
    const { deps } = makeDeps()
    const out = await runVisualReview(deps, [], '随便')
    expect(out.status).toBe('skipped')
    expect(deps.ask).not.toHaveBeenCalled()
  })

  it('fix 不合法时直接 fail（不空转轮次、不回滚）', async () => {
    const ask = vi.fn(async () => answerJson(40, { feedback: '扁', fix: { elements: [{ from: [0, 0], to: [1, 1, 1] }] } }))
    const { deps, written } = makeDeps({ ask })
    const out = await runVisualReview(deps, [MODEL_ABS], '一把武士刀')
    expect(out.status).toBe('fail')
    expect(out.rounds).toBe(0)
    expect(out.rolledBack).toBe(false)
    expect(written.length).toBe(0)
  })
})
