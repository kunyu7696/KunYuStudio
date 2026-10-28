/**
 * P0-5：Gradle daemon 冲突重试时复用旧 runId，避免 waitForGradleDone 挂死 + cancel 无效。
 *
 * 修复前：重试调 executeGradleBuild({ ...input }, sink) 生成新 runId，
 * waitForGradleDone 在等旧 runId 的 done 事件 → 永远不 resolve → 挂死；
 * cancel 通过 state.gradleRunId 杀旧 run，新进程不被杀 → 取消无效。
 *
 * 修复后：executeGradleBuild 接受 reuseRunId 参数，重试时传入旧 run.runId。
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const { mockSpawn, settingsState, observerJar } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  settingsState: { ai: {} as Record<string, unknown> },
  observerJar: { path: null as string | null }
}))

// mock 掉 electron / settingsService / observerService(agent 解析) / child_process
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getAppPath: () => '/app', isPackaged: false },
  BrowserWindow: class {}
}))
vi.mock('../settingsService', () => ({
  getSection: (s: string) =>
    s === 'java' ? { gradleMemoryMb: 2048 } : s === 'ai' ? settingsState.ai : {}
}))
vi.mock('../observer/observerService', () => ({
  resolveObserverAgentJar: () => observerJar.path
}))
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  spawnSync: vi.fn(),
  ChildProcess: class {}
}))

import { cancelGradle, executeGradleBuild, migrateObserverAgentVmArg, onGradleRunEvent } from '../gradleService'
import type { GradleRunInput } from '../../../shared/types/build'
import { readFileSync } from 'node:fs'

/** 构造一个最小的 mock ChildProcess（EventEmitter 满足 close 事件需求） */
function mockChild(): import('node:child_process').ChildProcess {
  const child = new EventEmitter() as unknown as import('node:child_process').ChildProcess
  Object.assign(child, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 12345,
    // POSIX 取消分支会 process.kill(-pid) 抛错后回退 child.kill('SIGTERM')，mock 必须带
    kill: vi.fn()
  })
  return child
}

function makeInput(root: string): GradleRunInput {
  return { root, tasks: ['build'], javaHome: undefined, timeoutMs: 60000 }
}

/** 写入平台对应的 wrapper 存根（gradleService 按平台选 gradlew.bat / gradlew） */
function writeWrapperStub(root: string): void {
  if (process.platform === 'win32') {
    writeFileSync(join(root, 'gradlew.bat'), '@rem stub\r\n')
  } else {
    writeFileSync(join(root, 'gradlew'), '#!/bin/sh\n')
  }
}

describe('P0-5: executeGradleBuild reuseRunId', () => {
  let root: string
  let child: import('node:child_process').ChildProcess

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-gradle-'))
    writeWrapperStub(root)
    child = mockChild()
    mockSpawn.mockReturnValue(child)
  })
  afterEach(() => {
    // emit close 清理 activeRuns，避免并发检查误判
    child.emit('close', 0, null)
    rmSync(root, { recursive: true, force: true })
    mockSpawn.mockReset()
  })

  it('不传 reuseRunId → 返回自动生成的 runId（格式 run_…）', () => {
    const result = executeGradleBuild(makeInput(root), () => {})
    expect(result).toMatch(/^run_/)
  })

  it('传入 reuseRunId → 返回值等于 reuseRunId', () => {
    const result = executeGradleBuild(makeInput(root), () => {}, 'run-reuse-me')
    expect(result).toBe('run-reuse-me')
  })
})

describe('onGradleRunEvent 生命周期事件（桌宠桥接数据源）', () => {
  let root: string
  let child: import('node:child_process').ChildProcess

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-gradle-'))
    writeWrapperStub(root)
    child = mockChild()
    mockSpawn.mockReturnValue(child)
  })
  afterEach(() => {
    child.emit('close', 0, null)
    rmSync(root, { recursive: true, force: true })
    mockSpawn.mockReset()
  })

  it('started 与 done 生命周期事件均送达监听器', () => {
    const seen: string[] = []
    const off = onGradleRunEvent((e) =>
      seen.push(`${e.phase}:${e.exitCode}:${e.tasks.join(',')}:${e.status ?? '-'}`)
    )
    executeGradleBuild(makeInput(root), () => {})
    child.emit('close', 0, null)
    off()
    expect(seen).toEqual(['started:null:build:-', 'done:0:build:success'])
  })

  it('非零退出码 → done 事件 status=fail', () => {
    const seen: Array<string | undefined> = []
    const off = onGradleRunEvent((e) => {
      if (e.phase === 'done') seen.push(e.status)
    })
    executeGradleBuild(makeInput(root), () => {})
    child.emit('close', 1, null)
    off()
    expect(seen).toEqual(['fail'])
  })

  it('cancelGradle 取消（含超时同桶）→ done 事件 status=cancel', () => {
    const seen: Array<string | undefined> = []
    const off = onGradleRunEvent((e) => {
      if (e.phase === 'done') seen.push(e.status)
    })
    const runId = executeGradleBuild(makeInput(root), () => {})
    cancelGradle(runId)
    child.emit('close', null, 'SIGTERM')
    off()
    expect(seen).toEqual(['cancel'])
  })

  it('监听器抛错不影响构建主流程，退订后不再接收', () => {
    const seen: string[] = []
    const off = onGradleRunEvent((e) => {
      seen.push(e.phase)
      if (e.phase === 'started') throw new Error('boom')
    })
    // started 阶段监听器抛错：emitRunEvent 必须吞掉，构建照常推进
    executeGradleBuild(makeInput(root), () => {})
    child.emit('close', 0, null)
    expect(seen).toEqual(['started', 'done'])
    off()

    // 退订后第二次构建不再送达（能再次 execute 也证明并发锁已正常释放）
    const child2 = mockChild()
    mockSpawn.mockReturnValue(child2)
    executeGradleBuild(makeInput(root), () => {})
    child2.emit('close', 0, null)
    expect(seen).toEqual(['started', 'done'])
  })
})

describe('migrateObserverAgentVmArg（observer 改 javaagent 后的存量项目迁移）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-migrate-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const OLD_LOOM_LINE = `            vmArg "-Dkunyu.observer.token=\${project.findProperty('kunyu.observer.token') ?: ''}"`

  it('loom vmArg 旧行 → 替换为 if(agent) javaagent 条件块，幂等', () => {
    const gradle = join(root, 'build.gradle')
    writeFileSync(gradle, `loom {\n    runs {\n        client {\n${OLD_LOOM_LINE}\n        }\n    }\n}\n`, 'utf8')
    expect(migrateObserverAgentVmArg(root)).toBe(true)
    const out = readFileSync(gradle, 'utf8')
    expect(out).toContain("if (project.findProperty('kunyu.observer.agent'))")
    expect(out).toContain('-javaagent:')
    expect(out).not.toContain('-Dkunyu.observer.token')
    // 缩进沿用旧行
    expect(out).toContain(`            if (project.findProperty('kunyu.observer.agent')) {`)
    // 幂等：第二次不再改动
    expect(migrateObserverAgentVmArg(root)).toBe(false)
    expect(readFileSync(gradle, 'utf8')).toBe(out)
  })

  it('FG7 systemProperty 旧行 → 替换为 jvmArgument 条件块', () => {
    const gradle = join(root, 'build.gradle')
    writeFileSync(
      gradle,
      `        configureEach {\n            systemProperty 'kunyu.observer.token', "\${project.findProperty('kunyu.observer.token') ?: ''}"\n        }\n`,
      'utf8'
    )
    expect(migrateObserverAgentVmArg(root)).toBe(true)
    const out = readFileSync(gradle, 'utf8')
    expect(out).toContain('jvmArgument "-javaagent:')
    expect(out).not.toContain("systemProperty 'kunyu.observer.token'")
  })

  it('无旧行 / 无 build.gradle → 零触碰', () => {
    expect(migrateObserverAgentVmArg(root)).toBe(false)
    const gradle = join(root, 'build.gradle')
    writeFileSync(gradle, `plugins { id 'java' }\n`, 'utf8')
    expect(migrateObserverAgentVmArg(root)).toBe(false)
    expect(readFileSync(gradle, 'utf8')).toBe(`plugins { id 'java' }\n`)
  })
})

describe('observerAutoInject 开关（runClient 前写入 gradle.properties）', () => {
  let root: string
  let child: import('node:child_process').ChildProcess

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-observer-switch-'))
    writeWrapperStub(root)
    child = mockChild()
    mockSpawn.mockReturnValue(child)
    observerJar.path = 'C:\\agents\\kunyu-observer-agent.jar'
    settingsState.ai = {}
  })
  afterEach(() => {
    child.emit('close', 0, null)
    rmSync(root, { recursive: true, force: true })
    mockSpawn.mockReset()
    observerJar.path = null
    settingsState.ai = {}
  })

  const launch = (): void => {
    executeGradleBuild({ root, tasks: ['runClient'], javaHome: undefined, timeoutMs: 60000 }, () => {})
  }
  const readProps = (): string => readFileSync(join(root, 'gradle.properties'), 'utf8')

  it('未设置（默认开）→ 写入 agent 路径并统一为正斜杠', () => {
    launch()
    expect(readProps()).toContain('kunyu.observer.agent=C:/agents/kunyu-observer-agent.jar')
  })

  it('显式开启 → 同样写入 agent 路径', () => {
    settingsState.ai = { observerAutoInject: true }
    launch()
    expect(readProps()).toContain('kunyu.observer.agent=C:/agents/kunyu-observer-agent.jar')
  })

  it('关闭开关 → agent 值为空串（模板 findProperty 判空跳过挂载）', () => {
    settingsState.ai = { observerAutoInject: false }
    launch()
    expect(readProps()).toMatch(/^kunyu\.observer\.agent=$/m)
  })
})
