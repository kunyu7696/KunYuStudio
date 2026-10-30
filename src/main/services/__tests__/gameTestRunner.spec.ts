/**
 * 特性④ GameTest Runner 单测。
 *
 * 重点测 parseGameTestReport 纯函数：纯通过 / 纯失败 / 混合 / 简化前缀 / 无输出 / 多种 Fabric 1.20.1 输出格式。
 * runGameTestServer 涉及子进程，仅测防御路径（gradlew 缺失、活跃任务）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// 切断 gradleService → settingsService → electron-store → electron 链；
// runGameTestServer 默认依赖 executeGradleBuild/hasActiveRun/cancelGradle，
// 测试中全部走注入 runner 或纯函数路径，不需要真实 gradleService。
vi.mock('../gradleService', () => ({
  executeGradleBuild: vi.fn(),
  hasActiveRun: vi.fn(() => false),
  cancelGradle: vi.fn()
}))

import { listGameTestJsonFiles, parseGameTestReport, runGameTestServer } from '../gameTestRunner'
import type { GradleEvent, GradleRunInput } from '../../../shared/types/build'
import type { GradleSink } from '../gradleService'

let tmpRoot: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'gametest-runner-'))
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('parseGameTestReport - 通过', () => {
  it('标准 GameTest passed 输出 → status=pass', () => {
    const stdout = 'GameTest test_ruby passed in 25 ticks\nAll required tests passed!'
    const r = parseGameTestReport(stdout)
    expect(r.status).toBe('pass')
    expect(r.passed).toContain('test_ruby')
    expect(r.failed).toHaveLength(0)
    expect(r.summary).toContain('1 项通过')
  })

  it('多测试通过', () => {
    const stdout = 'GameTest test_a passed in 5 ticks\nGameTest test_b passed in 12 ticks'
    const r = parseGameTestReport(stdout)
    expect(r.status).toBe('pass')
    expect(r.passed).toHaveLength(2)
    expect(r.passed).toContain('test_a')
    expect(r.passed).toContain('test_b')
  })

  it('简化前缀 passed（无 GameTest 前缀）', () => {
    const stdout = 'test_simple passed'
    const r = parseGameTestReport(stdout)
    expect(r.status).toBe('pass')
    expect(r.passed).toContain('test_simple')
  })
})

describe('parseGameTestReport - 失败', () => {
  it('失败带原因', () => {
    const stdout = 'GameTest test_broken failed at BlockPos{x=0,y=0,z=0}: expected STONE but got AIR'
    const r = parseGameTestReport(stdout)
    expect(r.status).toBe('fail')
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].name).toBe('test_broken')
    expect(r.failed[0].error).toContain('expected STONE')
  })

  it('失败带 Reason 行', () => {
    const stdout = 'GameTest test_x failed at some pos\nReason: timeout exceeded\nNext line'
    const r = parseGameTestReport(stdout)
    expect(r.status).toBe('fail')
    expect(r.failed[0].name).toBe('test_x')
    expect(r.failed[0].error).toContain('timeout')
  })

  it('混合通过+失败 → status=fail，passed 仅保留真正通过的', () => {
    const stdout =
      'GameTest test_ok passed in 5 ticks\n' +
      'GameTest test_bad failed at some pos: assertion failed'
    const r = parseGameTestReport(stdout)
    expect(r.status).toBe('fail')
    expect(r.passed).toContain('test_ok')
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].name).toBe('test_bad')
  })

  it('简化失败前缀', () => {
    const stdout = 'test_solo failed'
    const r = parseGameTestReport(stdout)
    expect(r.status).toBe('fail')
    expect(r.failed[0].name).toBe('test_solo')
  })
})

describe('parseGameTestReport - 跳过', () => {
  it('空 stdout → status=skipped', () => {
    const r = parseGameTestReport('')
    expect(r.status).toBe('skipped')
    expect(r.passed).toHaveLength(0)
    expect(r.failed).toHaveLength(0)
    expect(r.summary).toContain('未捕获')
  })

  it('无 GameTest 关键字 → skipped', () => {
    const r = parseGameTestReport('Task :runGameTestServer\nBUILD SUCCESSFUL in 5s')
    expect(r.status).toBe('skipped')
  })
})

describe('parseGameTestReport - durationMs 透传', () => {
  it('durationMs 被记录', () => {
    const r = parseGameTestReport('GameTest test_a passed in 5 ticks', 12345)
    expect(r.durationMs).toBe(12345)
  })
})

describe('runGameTestServer - 防御路径', () => {
  it('项目无 gradlew → 返回 skipped', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'gametest-empty-'))
    try {
      const r = await runGameTestServer({ root: emptyDir, javaHome: '' })
      expect(r.status).toBe('skipped')
      expect(r.summary).toContain('gradlew')
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('注入 runner 模拟 GameTest 通过路径', async () => {
    // 伪 gradlew 让前置检查通过
    const fakeRoot = mkdtempSync(join(tmpdir(), 'gametest-fake-'))
    try {
      writeFileSync(join(fakeRoot, 'gradlew'), '#!/bin/sh\n')
      const fakeRunner = (_input: GradleRunInput, sink: GradleSink): string => {
        const runId = 'fake-run'
        // 模拟输出 GameTest passed + done 事件
        const event: GradleEvent = {
          type: 'output',
          runId,
          stream: 'stdout',
          text: 'GameTest test_injected passed in 3 ticks'
        }
        sink(event)
        const done: GradleEvent = {
          type: 'phase',
          runId,
          phase: 'done',
          exitCode: 0,
          cancelled: false,
          timedOut: false,
          durationMs: 100
        }
        sink(done)
        return runId
      }
      const r = await runGameTestServer({
        root: fakeRoot,
        javaHome: '',
        runner: fakeRunner as never
      })
      expect(r.status).toBe('pass')
      expect(r.passed).toContain('test_injected')
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })

  it('注入 runner 抛错 → 返回 skipped', async () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'gametest-err-'))
    try {
      writeFileSync(join(fakeRoot, 'gradlew'), '#!/bin/sh\n')
      const throwingRunner = (): string => {
        throw new Error('wrapper missing')
      }
      const r = await runGameTestServer({
        root: fakeRoot,
        javaHome: '',
        runner: throwingRunner as never
      })
      expect(r.status).toBe('skipped')
      expect(r.summary).toContain('未捕获') // stdout 为空 → 走未捕获分支
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true })
    }
  })
})

describe('listGameTestJsonFiles', () => {
  it('无 gametest 目录返回空数组', () => {
    expect(listGameTestJsonFiles(tmpRoot)).toEqual([])
  })

  it('有 gametest 目录返回 JSON 文件相对路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gametest-list-'))
    try {
      const gametestDir = join(dir, '.kunyu', 'content', 'gametest')
      // mkdirSync 在 fsService 之外手动建
      mkdirSync(gametestDir, { recursive: true })
      writeFileSync(join(gametestDir, 'a.json'), '{}')
      writeFileSync(join(gametestDir, 'b.json'), '{}')
      writeFileSync(join(gametestDir, 'ignore.txt'), 'nope')
      const files = listGameTestJsonFiles(dir)
      expect(files).toHaveLength(2)
      expect(files.some((f) => f.endsWith('a.json'))).toBe(true)
      expect(files.some((f) => f.endsWith('b.json'))).toBe(true)
      expect(files.some((f) => f.endsWith('ignore.txt'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
