/**
 * 特性③ AcceptanceContract 验收契约评估器单测。
 *
 * 覆盖：parseContract 防御性解析、evaluateFileExists/TextureReady/BuildPass/RegistryEntry
 * 四类断言、mergeAssertions 合并、summarizeContract 摘要、readPngSize PNG 尺寸读取。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  buildContractArtifact,
  evaluateAfterBuild,
  evaluateAfterGenerate,
  evaluateAfterGameTest,
  evaluateAfterRuntimeScreenshot,
  evaluateAfterTest,
  evaluateBuildPass,
  evaluateFileExists,
  evaluateGameTestRuntime,
  evaluateRegistryEntry,
  evaluateRuntimeInventory,
  evaluateRuntimeWorld,
  evaluateTextureReady,
  evaluateUserConfirmation,
  hasPendingRuntimeAssertion,
  hasPendingUserConfirmation,
  isValidRegistryId,
  mergeAssertions,
  normalizeRegistryId,
  parseContract,
  summarizeContract
} from '../contractEvaluator'
import { createSolidPng, readPngSize, readPngSizeFromBuffer } from '../../../templates/pngGenerator'
import type {
  AcceptanceAssertion,
  AcceptanceContract,
  BuildConclusion,
  GameTestReport
} from '../../../../shared/types/agent'

function makeAssertion(overrides: Partial<AcceptanceAssertion>): AcceptanceAssertion {
  return {
    id: 'a1',
    kind: 'file-exists',
    description: '测试断言',
    expected: 'foo.txt',
    status: 'pending',
    ...overrides
  }
}

function makeContract(assertions: AcceptanceAssertion[]): AcceptanceContract {
  return { overall: 'pending', assertions, summary: '' }
}

function buildConclusion(status: 'pass' | 'fail' | 'skipped', rounds = 1): BuildConclusion {
  return { status, rounds, summary: `构建${status}`, matchedPatternIds: [] }
}

describe('parseContract', () => {
  it('合法 4 类断言 → 4 条 pending 断言，路径归一化', () => {
    const raw = {
      assertions: [
        { kind: 'file-exists', description: 'Java 主类', expected: 'src/Main.java' },
        { kind: 'texture-ready', description: '贴图', expected: 'textures/x.png', expectedSize: '16x16' },
        { kind: 'registry-entry', description: '注册类', expected: 'ModItems.java', min: 3, regex: 'register' },
        { kind: 'build-pass', description: '构建', expected: '' }
      ]
    }
    const c = parseContract(raw)
    expect(c).not.toBeNull()
    expect(c!.assertions).toHaveLength(4)
    expect(c!.assertions[0].status).toBe('pending')
    expect(c!.assertions[3].kind).toBe('build-pass')
    expect(c!.assertions[3].status).toBe('pending')
  })

  it('含非法路径（.. 和盘符）→ 对应断言标 failed+reason', () => {
    const raw = {
      assertions: [
        { kind: 'file-exists', description: '越界', expected: '../etc/passwd' },
        { kind: 'file-exists', description: '盘符', expected: 'C:/x.txt' },
        { kind: 'file-exists', description: '合法', expected: 'ok.txt' }
      ]
    }
    const c = parseContract(raw)
    expect(c!.assertions[0].status).toBe('failed')
    expect(c!.assertions[0].reason).toContain('越界')
    expect(c!.assertions[1].status).toBe('failed')
    expect(c!.assertions[1].reason).toContain('盘符')
    expect(c!.assertions[2].status).toBe('pending')
  })

  it('缺省 contract 字段 / 空数组 → 返回 null', () => {
    expect(parseContract(null)).toBeNull()
    expect(parseContract(undefined)).toBeNull()
    expect(parseContract('not-object')).toBeNull()
    expect(parseContract({})).toBeNull()
    expect(parseContract({ assertions: [] })).toBeNull()
    expect(parseContract({ assertions: 'not-array' })).toBeNull()
  })

  it('未知 kind → 该断言标 failed+reason', () => {
    const c = parseContract({ assertions: [{ kind: 'foo', expected: 'x.txt' }] })
    expect(c!.assertions[0].status).toBe('failed')
    expect(c!.assertions[0].reason).toContain('未知 kind')
  })

  it('缺 id 自动补 `${kind}-${i}`', () => {
    const c = parseContract({ assertions: [{ kind: 'build-pass', expected: '' }] })
    expect(c!.assertions[0].id).toBe('build-pass-0')
  })

  it('F-02：LLM 提供重复 id 时自动去重，保证全局唯一', () => {
    const c = parseContract({
      assertions: [
        { id: 'same', kind: 'file-exists', expected: 'a.txt' },
        { id: 'same', kind: 'file-exists', expected: 'b.txt' }
      ]
    })
    expect(c!.assertions[0].id).toBe('same')
    expect(c!.assertions[1].id).toBe('same-1')
    expect(c!.assertions[0].id).not.toBe(c!.assertions[1].id)
  })
})

describe('F-02：重复 id 不得洗白 failed 断言', () => {
  const dir = join(tmpdir(), `ky-contract-f02-${Math.random().toString(36).slice(2)}`)
  beforeAll(() => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'exists.txt'), 'hello')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('两个同 id 的 file-exists：一个不存在、一个存在 → overall 必须是 failed', () => {
    // LLM 给两条断言共用 id="same"：missing.txt（不存在）与 exists.txt（存在）
    const raw = {
      assertions: [
        { id: 'same', kind: 'file-exists', expected: 'missing.txt' },
        { id: 'same', kind: 'file-exists', expected: 'exists.txt' }
      ]
    }
    const contract = parseContract(raw)!
    const evaluated = evaluateAfterGenerate(dir, contract)

    // 去重后两条断言各自保留自己的评估结果
    const statuses = evaluated.assertions.map((a) => a.status)
    expect(statuses).toContain('failed')
    expect(statuses).toContain('verified')
    // overall 只要有 failed 就必须是 failed，不能被同 id 的 verified 项洗白
    expect(evaluated.overall).toBe('failed')
    expect(evaluated.summary).toContain('1 项失败')
  })
})

describe('evaluateFileExists', () => {
  const dir = join(tmpdir(), `ky-contract-fe-${Math.random().toString(36).slice(2)}`)
  beforeAll(() => mkdirSync(dir, { recursive: true }))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('文件存在 → verified（附 file 证据）', () => {
    const p = join(dir, 'exists.txt')
    writeFileSync(p, 'hello')
    const r = evaluateFileExists(dir, makeAssertion({ expected: 'exists.txt' }))
    expect(r.status).toBe('verified')
    expect(r.actual).toBe('存在')
    expect(r.evidence?.type).toBe('file')
    expect(r.evidence?.path).toBe(p)
    expect(r.evidence?.timestamp).toBeTruthy()
  })

  it('文件不存在 → failed+actual=不存在', () => {
    const r = evaluateFileExists(dir, makeAssertion({ expected: 'missing.txt' }))
    expect(r.status).toBe('failed')
    expect(r.actual).toBe('不存在')
  })

  it('无 project → unverified（中性灰，不是「没问题」）', () => {
    const r = evaluateFileExists(null, makeAssertion({ expected: 'any.txt' }))
    expect(r.status).toBe('unverified')
  })

  it('非法路径 → failed+reason', () => {
    const r = evaluateFileExists(dir, makeAssertion({ expected: '../escape.txt' }))
    expect(r.status).toBe('failed')
    expect(r.reason).toContain('越界')
  })
})

describe('evaluateTextureReady', () => {
  const dir = join(tmpdir(), `ky-contract-tx-${Math.random().toString(36).slice(2)}`)
  beforeAll(() => mkdirSync(dir, { recursive: true }))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('正确 16x16 PNG + expectedSize=16x16 → verified', () => {
    writeFileSync(join(dir, 'tex16.png'), createSolidPng(255, 0, 0, 16))
    const r = evaluateTextureReady(dir, makeAssertion({ kind: 'texture-ready', expected: 'tex16.png', expectedSize: '16x16' }))
    expect(r.status).toBe('verified')
    expect(r.actual).toBe('16x16')
    expect(r.evidence?.type).toBe('file')
  })

  it('PNG 尺寸不符期望 → failed+actual', () => {
    writeFileSync(join(dir, 'tex32.png'), createSolidPng(0, 255, 0, 32))
    const r = evaluateTextureReady(dir, makeAssertion({ kind: 'texture-ready', expected: 'tex32.png', expectedSize: '16x16' }))
    expect(r.status).toBe('failed')
    expect(r.actual).toBe('32x32')
  })

  it('文件不是 PNG → failed', () => {
    writeFileSync(join(dir, 'notpng.txt'), 'this is text')
    const r = evaluateTextureReady(dir, makeAssertion({ kind: 'texture-ready', expected: 'notpng.txt' }))
    expect(r.status).toBe('failed')
    expect(r.actual).toBe('非合法 PNG')
  })

  it('expectedSize 缺省 → 仅校验是合法 PNG', () => {
    writeFileSync(join(dir, 'texAny.png'), createSolidPng(0, 0, 255, 64))
    const r = evaluateTextureReady(dir, makeAssertion({ kind: 'texture-ready', expected: 'texAny.png' }))
    expect(r.status).toBe('verified')
    expect(r.actual).toBe('64x64')
  })

  it('无 project → unverified', () => {
    const r = evaluateTextureReady(null, makeAssertion({ kind: 'texture-ready', expected: 'any.png' }))
    expect(r.status).toBe('unverified')
  })
})

describe('evaluateBuildPass', () => {
  it('build.status=pass → verified（附 command+exitCode 证据）', () => {
    const r = evaluateBuildPass(makeAssertion({ kind: 'build-pass', expected: '' }), buildConclusion('pass', 3))
    expect(r.status).toBe('verified')
    expect(r.actual).toContain('通过')
    expect(r.evidence?.type).toBe('command')
    expect(r.evidence?.command).toBe('gradlew clean build')
    expect(r.evidence?.exitCode).toBeUndefined()
  })

  it('build.status=fail → failed+reason=summary（附证据）', () => {
    const build = { ...buildConclusion('fail', 2), exitCode: 1 }
    const r = evaluateBuildPass(makeAssertion({ kind: 'build-pass', expected: '' }), build)
    expect(r.status).toBe('failed')
    expect(r.reason).toContain('构建fail')
    expect(r.evidence?.exitCode).toBe(1)
  })

  it('build=null → unverified', () => {
    const r = evaluateBuildPass(makeAssertion({ kind: 'build-pass', expected: '' }), null)
    expect(r.status).toBe('unverified')
  })

  it('build.status=skipped → unverified', () => {
    const r = evaluateBuildPass(makeAssertion({ kind: 'build-pass', expected: '' }), buildConclusion('skipped', 0))
    expect(r.status).toBe('unverified')
  })
})

describe('evaluateRegistryEntry', () => {
  const dir = join(tmpdir(), `ky-contract-re-${Math.random().toString(36).slice(2)}`)
  beforeAll(() => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ModItems.java'), 'register(register)\nregister(register)\nregister(register)')
    writeFileSync(join(dir, 'empty.txt'), 'no matches here')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('min 满足 → verified', () => {
    const r = evaluateRegistryEntry(dir, makeAssertion({
      kind: 'registry-entry',
      expected: 'ModItems.java',
      min: 3,
      regex: 'register'
    }))
    expect(r.status).toBe('verified')
    expect(r.actual).toContain('匹配')
  })

  it('min 不足 → failed+actual', () => {
    const r = evaluateRegistryEntry(dir, makeAssertion({
      kind: 'registry-entry',
      expected: 'ModItems.java',
      min: 10,
      regex: 'register'
    }))
    expect(r.status).toBe('failed')
    expect(r.actual).toContain('匹配')
  })

  it('regex 不匹配 → failed', () => {
    const r = evaluateRegistryEntry(dir, makeAssertion({
      kind: 'registry-entry',
      expected: 'empty.txt',
      min: 1,
      regex: 'register'
    }))
    expect(r.status).toBe('failed')
  })

  it('无 min/regex → 等同 file-exists', () => {
    const r = evaluateRegistryEntry(dir, makeAssertion({ kind: 'registry-entry', expected: 'ModItems.java' }))
    expect(r.status).toBe('verified')
    expect(r.actual).toBe('存在')
  })

  it('非法正则 → failed+reason', () => {
    const r = evaluateRegistryEntry(dir, makeAssertion({
      kind: 'registry-entry',
      expected: 'ModItems.java',
      regex: '([invalid'
    }))
    expect(r.status).toBe('failed')
    expect(r.reason).toMatch(/Invalid regular expression|正则|Unterminated/)
  })
})

describe('mergeAssertions', () => {
  it('同 id 替换，不在 patch 的保留', () => {
    const base = makeContract([
      makeAssertion({ id: 'a1', kind: 'file-exists', status: 'pass' }),
      makeAssertion({ id: 'a2', kind: 'build-pass', status: 'pending' })
    ])
    const merged = mergeAssertions(base, [makeAssertion({ id: 'a2', kind: 'build-pass', status: 'pass' })])
    expect(merged.assertions[0].status).toBe('pass')
    expect(merged.assertions[1].status).toBe('pass')
  })
})

describe('summarizeContract', () => {
  it('全 verified → overall=verified', () => {
    const c = summarizeContract(makeContract([
      makeAssertion({ status: 'verified' }),
      makeAssertion({ status: 'verified' })
    ]))
    expect(c.overall).toBe('verified')
    expect(c.summary).toContain('2/2 通过')
  })

  it('任一 failed → overall=failed', () => {
    const c = summarizeContract(makeContract([
      makeAssertion({ status: 'verified' }),
      makeAssertion({ status: 'failed' }),
      makeAssertion({ status: 'unverified' })
    ]))
    expect(c.overall).toBe('failed')
    expect(c.summary).toContain('1 项失败')
    expect(c.summary).toContain('1 项未验证')
  })

  it('含 pending 无 failed → overall=pending', () => {
    const c = summarizeContract(makeContract([
      makeAssertion({ status: 'verified' }),
      makeAssertion({ status: 'pending' })
    ]))
    expect(c.overall).toBe('pending')
    expect(c.summary).toContain('1 项待评')
  })

  it('全 unverified 无 failed → overall=unverified', () => {
    const c = summarizeContract(makeContract([
      makeAssertion({ status: 'unverified' }),
      makeAssertion({ status: 'unverified' })
    ]))
    expect(c.overall).toBe('unverified')
  })
})

describe('evaluateAfterGenerate / Build / Test 分阶段入口', () => {
  const dir = join(tmpdir(), `ky-contract-stage-${Math.random().toString(36).slice(2)}`)
  beforeAll(() => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.java'), 'register\nregister')
    writeFileSync(join(dir, 'b.png'), createSolidPng(1, 2, 3, 16))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('evaluateAfterGenerate 评估①④，②③ 仍 pending', () => {
    const c = makeContract([
      makeAssertion({ id: 'f1', kind: 'file-exists', expected: 'a.java' }),
      makeAssertion({ id: 't1', kind: 'texture-ready', expected: 'b.png', expectedSize: '16x16' }),
      makeAssertion({ id: 'r1', kind: 'registry-entry', expected: 'a.java', min: 1, regex: 'register' }),
      makeAssertion({ id: 'b1', kind: 'build-pass', expected: '' })
    ])
    const after = evaluateAfterGenerate(dir, c)
    expect(after.assertions[0].status).toBe('verified')
    expect(after.assertions[1].status).toBe('verified')
    expect(after.assertions[2].status).toBe('pending')
    expect(after.assertions[3].status).toBe('pending')
    expect(after.overall).toBe('pending')
  })

  it('evaluateAfterBuild 评估③，② 仍 pending', () => {
    const c = makeContract([
      makeAssertion({ id: 'b1', kind: 'build-pass', expected: '', status: 'pending' }),
      makeAssertion({ id: 'r1', kind: 'registry-entry', expected: 'a.java', status: 'pending' })
    ])
    const after = evaluateAfterBuild(c, buildConclusion('pass', 1))
    expect(after.assertions[0].status).toBe('verified')
    expect(after.assertions[1].status).toBe('pending')
    expect(after.overall).toBe('pending')
  })

  it('evaluateAfterTest 评估②', () => {
    const c = makeContract([
      makeAssertion({ id: 'r1', kind: 'registry-entry', expected: 'a.java', min: 1, regex: 'register', status: 'pending' }),
      makeAssertion({ id: 'b1', kind: 'build-pass', expected: '', status: 'verified' })
    ])
    const after = evaluateAfterTest(dir, c)
    expect(after.assertions[0].status).toBe('verified')
    expect(after.overall).toBe('verified')
  })

  it('buildContractArtifact 工厂产物', () => {
    const c = summarizeContract(makeContract([
      makeAssertion({ id: 'a1', kind: 'build-pass', expected: '', status: 'verified' })
    ]))
    const art = buildContractArtifact('run-contract', c)
    expect(art.kind).toBe('contract')
    expect(art.id).toBe('run-contract')
    expect(art.contract).toBe(c)
    expect(art.title).toContain('通过')
  })
})

describe('readPngSize', () => {
  it('createSolidPng 生成的 16x16 PNG → {w:16,h:16}', () => {
    const buf = createSolidPng(0, 0, 0, 16)
    const size = readPngSizeFromBuffer(buf)
    expect(size).toEqual({ w: 16, h: 16 })
  })

  it('createSolidPng 生成的 32x32 PNG → {w:32,h:32}', () => {
    const buf = createSolidPng(0, 0, 0, 32)
    const size = readPngSizeFromBuffer(buf)
    expect(size).toEqual({ w: 32, h: 32 })
  })

  it('截断 buffer (<24B) → null', () => {
    const buf = Buffer.alloc(10)
    expect(readPngSizeFromBuffer(buf)).toBeNull()
  })

  it('签名错误 → null', () => {
    const buf = Buffer.alloc(24)
    buf.write('NOTAPNG', 0, 'ascii')
    expect(readPngSizeFromBuffer(buf)).toBeNull()
  })

  it('从磁盘读取合法 PNG', () => {
    const dir = join(tmpdir(), `ky-png-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'disk.png')
    writeFileSync(p, createSolidPng(255, 0, 0, 16))
    expect(readPngSize(p)).toEqual({ w: 16, h: 16 })
    rmSync(dir, { recursive: true, force: true })
  })

  it('从磁盘读取不存在的文件 → null', () => {
    expect(readPngSize(join(tmpdir(), `nope-${Date.now()}.png`))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 特性④：gametest-runtime 断言评估（由 GameTest 报告动态判定）
// ---------------------------------------------------------------------------

function makeGameTestReport(overrides: Partial<GameTestReport> = {}): GameTestReport {
  return {
    status: 'pass',
    passed: ['test_ruby_block'],
    failed: [],
    summary: 'GameTest 1 项通过',
    durationMs: 1500,
    ...overrides
  }
}

function makeRuntimeAssertion(overrides: Partial<AcceptanceAssertion> = {}): AcceptanceAssertion {
  return {
    id: 'rt1',
    kind: 'gametest-runtime',
    description: '注册条目运行时',
    expected: 'test_ruby_block',
    status: 'pending',
    ...overrides
  }
}

describe('parseContract - gametest-runtime', () => {
  it('合法 gametest-runtime 断言 → pending，不校验路径', () => {
    const raw = {
      assertions: [{ kind: 'gametest-runtime', description: '运行时', expected: 'test_x' }]
    }
    const c = parseContract(raw)
    expect(c).not.toBeNull()
    expect(c!.assertions).toHaveLength(1)
    expect(c!.assertions[0].kind).toBe('gametest-runtime')
    expect(c!.assertions[0].status).toBe('pending')
    expect(c!.assertions[0].expected).toBe('test_x')
  })

  it('gametest-runtime 即使 expected 含特殊字符也 pass（不视作路径）', () => {
    const raw = {
      assertions: [{ kind: 'gametest-runtime', description: 'x', expected: '../etc/passwd' }]
    }
    const c = parseContract(raw)
    expect(c!.assertions[0].status).toBe('pending')
    expect(c!.assertions[0].reason).toBeUndefined()
  })
})

describe('evaluateGameTestRuntime', () => {
  it('report.passed 含 expected → verified+actual=通过', () => {
    const a = evaluateGameTestRuntime(makeGameTestReport(), makeRuntimeAssertion())
    expect(a.status).toBe('verified')
    expect(a.actual).toBe('通过')
  })

  it('report.failed 含 expected → failed+reason', () => {
    const report = makeGameTestReport({
      status: 'fail',
      passed: [],
      failed: [{ name: 'test_ruby_block', error: 'expected STONE got AIR' }]
    })
    const a = evaluateGameTestRuntime(report, makeRuntimeAssertion())
    expect(a.status).toBe('failed')
    expect(a.reason).toContain('expected STONE')
  })

  it('report=null → unverified+reason=无报告', () => {
    const a = evaluateGameTestRuntime(null, makeRuntimeAssertion())
    expect(a.status).toBe('unverified')
    expect(a.reason).toContain('无 GameTest 报告')
  })

  it('report.status=skipped → unverified', () => {
    const report = makeGameTestReport({ status: 'skipped', passed: [], failed: [] })
    const a = evaluateGameTestRuntime(report, makeRuntimeAssertion())
    expect(a.status).toBe('unverified')
  })

  it('expected 不在 passed 也不在 failed → unverified+未覆盖', () => {
    const report = makeGameTestReport({ passed: ['test_other'], failed: [] })
    const a = evaluateGameTestRuntime(report, makeRuntimeAssertion({ expected: 'test_unknown' }))
    expect(a.status).toBe('unverified')
    expect(a.reason).toContain('test_unknown')
  })
})

describe('evaluateAfterGameTest', () => {
  it('report=null → 所有 gametest-runtime 断言标 unverified', () => {
    const contract = makeContract([
      makeRuntimeAssertion({ id: 'r1' }),
      makeRuntimeAssertion({ id: 'r2', expected: 'test_other' })
    ])
    const evaluated = evaluateAfterGameTest(null, contract)
    expect(evaluated.overall).toBe('unverified')
    expect(evaluated.assertions.every((a) => a.status === 'unverified')).toBe(true)
    expect(evaluated.summary).toContain('2 项未验证')
  })

  it('report.passed 含 expected → verified；summary 含通过计数', () => {
    const contract = makeContract([makeRuntimeAssertion({ id: 'r1', expected: 'test_ruby_block' })])
    const evaluated = evaluateAfterGameTest(makeGameTestReport(), contract)
    expect(evaluated.overall).toBe('verified')
    expect(evaluated.assertions[0].status).toBe('verified')
    expect(evaluated.summary).toContain('1/1 通过')
  })

  it('混合 pending + 已评估：仅评估 pending 的', () => {
    const alreadyPass = makeRuntimeAssertion({ id: 'r0', status: 'verified' })
    const pending = makeRuntimeAssertion({ id: 'r1', expected: 'test_ruby_block' })
    const contract = makeContract([alreadyPass, pending])
    const evaluated = evaluateAfterGameTest(makeGameTestReport(), contract)
    // 已评估的保持原样
    expect(evaluated.assertions[0].status).toBe('verified')
    // pending 被评估
    expect(evaluated.assertions[1].status).toBe('verified')
    expect(evaluated.summary).toContain('2/2 通过')
  })

  it('非 gametest-runtime 断言不受影响', () => {
    const fileAssert: AcceptanceAssertion = {
      id: 'f1',
      kind: 'file-exists',
      description: '文件',
      expected: 'foo.txt',
      status: 'pending'
    }
    const contract = makeContract([fileAssert, makeRuntimeAssertion({ id: 'r1' })])
    const evaluated = evaluateAfterGameTest(makeGameTestReport(), contract)
    // file-exists 保持 pending（由 evaluateAfterGenerate 处理）
    expect(evaluated.assertions[0].status).toBe('pending')
    // gametest-runtime 被评估为 verified
    expect(evaluated.assertions[1].status).toBe('verified')
  })
})

// ---------------------------------------------------------------------------
// 第三类 oracle：user-confirmation（人工看真机截图确认）
// ---------------------------------------------------------------------------

describe('parseContract - user-confirmation', () => {
  it('接受 user-confirmation，且 expected 是描述文本不做路径校验', () => {
    const raw = {
      assertions: [
        {
          kind: 'user-confirmation',
          description: '红宝石块外观',
          expected: '手持视角下纹理接近深红色六面体，六个面都有描边'
        }
      ]
    }
    const c = parseContract(raw)
    expect(c).not.toBeNull()
    expect(c?.assertions[0]?.kind).toBe('user-confirmation')
    expect(c?.assertions[0]?.status).toBe('pending')
  })
})

describe('evaluateUserConfirmation / evaluateAfterRuntimeScreenshot', () => {
  function confirmAssertion(overrides: Partial<AcceptanceAssertion> = {}): AcceptanceAssertion {
    return makeAssertion({
      id: 'uc1',
      kind: 'user-confirmation',
      description: 'GUI 排版正常',
      expected: '按钮不重叠、文字不超框',
      ...overrides
    })
  }

  it('有截图 → awaiting-user + evidencePath + screenshot 证据，绝不自动判 verified', () => {
    const a = evaluateUserConfirmation(confirmAssertion(), 'C:/tmp/shot.png')
    expect(a.status).toBe('awaiting-user')
    expect(a.actual).toBe('待人工核对')
    expect(a.evidencePath).toBe('C:/tmp/shot.png')
    expect(a.evidence?.type).toBe('screenshot')
    expect(a.evidence?.path).toBe('C:/tmp/shot.png')
  })

  it('无截图 → unverified 并给观察通道引导', () => {
    const a = evaluateUserConfirmation(confirmAssertion(), null)
    expect(a.status).toBe('unverified')
    expect(a.reason).toContain('真机截图')
  })

  it('批量入口只处理 pending 的 user-confirmation，overall 保持 pending（未全 verified）', () => {
    const pass = makeAssertion({ id: 'f1', kind: 'file-exists', status: 'verified' })
    const waiting = confirmAssertion({ id: 'uc1' })
    const evaluated = evaluateAfterRuntimeScreenshot(makeContract([pass, waiting]), '/tmp/x.png')
    expect(evaluated.assertions[1]?.status).toBe('awaiting-user')
    expect(evaluated.overall).toBe('pending')
    expect(evaluated.summary).toContain('1 项待人工看截图确认')
  })

  it('hasPendingUserConfirmation 覆盖 pending 与 awaiting-user 两种状态', () => {
    expect(hasPendingUserConfirmation(makeContract([confirmAssertion()]))).toBe(true)
    expect(
      hasPendingUserConfirmation(
        makeContract([confirmAssertion({ status: 'awaiting-user', evidencePath: '/x.png' })])
      )
    ).toBe(true)
    expect(
      hasPendingUserConfirmation(makeContract([makeAssertion({ kind: 'file-exists', status: 'verified' })]))
    ).toBe(false)
  })

  it('summarizeContract 单独 awaiting-user 不判 pass 也不判 fail', () => {
    const c = summarizeContract(makeContract([confirmAssertion({ status: 'awaiting-user' })]))
    expect(c.overall).toBe('pending')
    expect(c.summary).toContain('0/1 通过')
  })

  it('buildContractArtifact 携带 evidencePath 供卡片渲染缩略图', () => {
    const a = evaluateUserConfirmation(confirmAssertion(), '/tmp/shot.png')
    const art = buildContractArtifact('run-x', makeContract([a]))
    expect(art.contract?.assertions[0]?.evidencePath).toBe('/tmp/shot.png')
  })
})

// ---------------------------------------------------------------------------
// P0-a：真机断言（runtime-world / runtime-inventory）—— 由代码读取运行中游戏判定
// ---------------------------------------------------------------------------

describe('normalizeRegistryId / isValidRegistryId', () => {
  it('缺省命名空间补 minecraft:', () => {
    expect(normalizeRegistryId('stone')).toBe('minecraft:stone')
  })

  it('大写归一为小写', () => {
    expect(normalizeRegistryId('MyMod:Ruby_Block')).toBe('mymod:ruby_block')
  })

  it('保留显式命名空间并去空白', () => {
    expect(normalizeRegistryId('  mymod:ruby  ')).toBe('mymod:ruby')
  })

  it('合法注册名判定（含缺省命名空间）', () => {
    expect(isValidRegistryId('stone')).toBe(true)
    expect(isValidRegistryId('mymod:ruby_block')).toBe(true)
    expect(isValidRegistryId('bad name')).toBe(false)
    expect(isValidRegistryId('')).toBe(false)
  })
})

describe('parseContract - runtime-world / runtime-inventory', () => {
  it('合法 runtime-world（带整数坐标）→ pending 且保留 x/y/z', () => {
    const c = parseContract({
      assertions: [
        { kind: 'runtime-world', description: '方块', expected: 'mymod:ruby_block', x: 0, y: 64, z: 0 }
      ]
    })
    expect(c).not.toBeNull()
    const a = c!.assertions[0]
    expect(a.kind).toBe('runtime-world')
    expect(a.status).toBe('pending')
    expect(a.x).toBe(0)
    expect(a.y).toBe(64)
    expect(a.z).toBe(0)
  })

  it('坐标取整（Math.trunc，负数向零截断）', () => {
    const c = parseContract({
      assertions: [{ kind: 'runtime-world', expected: 'stone', x: 1.9, y: 64.2, z: -3.7 }]
    })
    const a = c!.assertions[0]
    expect(a.x).toBe(1)
    expect(a.y).toBe(64)
    expect(a.z).toBe(-3)
  })

  it('runtime-world 缺任一坐标 → failed+reason', () => {
    const c = parseContract({
      assertions: [{ kind: 'runtime-world', expected: 'stone', x: 0, y: 64 }]
    })
    expect(c!.assertions[0].status).toBe('failed')
    expect(c!.assertions[0].reason).toContain('坐标')
  })

  it('runtime-* expected 非法注册名 → failed+reason（不做路径校验）', () => {
    const c = parseContract({
      assertions: [
        { kind: 'runtime-world', expected: 'has space', x: 0, y: 0, z: 0 },
        { kind: 'runtime-inventory', expected: 'bad name' }
      ]
    })
    expect(c!.assertions[0].status).toBe('failed')
    expect(c!.assertions[0].reason).toContain('注册名')
    expect(c!.assertions[1].status).toBe('failed')
    expect(c!.assertions[1].reason).toContain('注册名')
  })

  it('合法 runtime-inventory（无坐标要求）→ pending', () => {
    const c = parseContract({
      assertions: [{ kind: 'runtime-inventory', expected: 'mymod:ruby' }]
    })
    expect(c!.assertions[0].kind).toBe('runtime-inventory')
    expect(c!.assertions[0].status).toBe('pending')
  })
})

describe('evaluateRuntimeWorld', () => {
  function worldAssertion(overrides: Partial<AcceptanceAssertion> = {}): AcceptanceAssertion {
    return {
      id: 'rw1',
      kind: 'runtime-world',
      description: '方块',
      expected: 'mymod:ruby_block',
      x: 10,
      y: 64,
      z: -5,
      status: 'pending',
      ...overrides
    }
  }

  it('reading=null → unverified（离线不是「没问题」）', () => {
    const a = evaluateRuntimeWorld(worldAssertion(), null)
    expect(a.status).toBe('unverified')
    expect(a.reason).toContain('观察通道')
  })

  it('读到的方块与期望相符（大小写归一化）→ verified', () => {
    const a = evaluateRuntimeWorld(worldAssertion({ expected: 'MyMod:Ruby_Block' }), { block: 'mymod:ruby_block' })
    expect(a.status).toBe('verified')
    expect(a.actual).toBe('mymod:ruby_block')
    expect(a.evidence?.type).toBe('command')
    expect(a.evidence?.command).toContain('get_block 10 64 -5')
  })

  it('读到的方块不符 → failed+actual+reason', () => {
    const a = evaluateRuntimeWorld(worldAssertion(), { block: 'minecraft:air' })
    expect(a.status).toBe('failed')
    expect(a.actual).toBe('minecraft:air')
    expect(a.reason).toContain('期望')
  })
})

describe('evaluateRuntimeInventory', () => {
  function invAssertion(overrides: Partial<AcceptanceAssertion> = {}): AcceptanceAssertion {
    return {
      id: 'ri1',
      kind: 'runtime-inventory',
      description: '背包',
      expected: 'mymod:ruby',
      status: 'pending',
      ...overrides
    }
  }

  it('ids=null → unverified', () => {
    const a = evaluateRuntimeInventory(invAssertion(), null)
    expect(a.status).toBe('unverified')
  })

  it('背包含期望物品（大小写归一化）→ verified', () => {
    const a = evaluateRuntimeInventory(invAssertion({ expected: 'MyMod:Ruby' }), ['mymod:ruby', 'minecraft:stone'])
    expect(a.status).toBe('verified')
    expect(a.evidence?.type).toBe('command')
    expect(a.evidence?.command).toBe('mc_inventory')
  })

  it('背包未含期望物品 → failed', () => {
    const a = evaluateRuntimeInventory(invAssertion(), ['minecraft:stone'])
    expect(a.status).toBe('failed')
    expect(a.actual).toContain('未找到')
  })
})

describe('hasPendingRuntimeAssertion', () => {
  it('存在 pending runtime-* → true', () => {
    const c = makeContract([
      makeAssertion({ id: 'r1', kind: 'runtime-world', expected: 'stone', x: 0, y: 0, z: 0 })
    ])
    expect(hasPendingRuntimeAssertion(c)).toBe(true)
  })

  it('已评估的 runtime-* → false', () => {
    const c = makeContract([
      makeAssertion({ id: 'r1', kind: 'runtime-inventory', expected: 'stone', status: 'verified' })
    ])
    expect(hasPendingRuntimeAssertion(c)).toBe(false)
  })

  it('无 runtime-* → false', () => {
    expect(hasPendingRuntimeAssertion(makeContract([makeAssertion({ status: 'pending' })]))).toBe(false)
  })
})
