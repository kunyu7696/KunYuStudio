/**
 * TR-12.2 / 分类：classifyFailure、buildDiagnosisReport、
 * collectRuntimeSignals、writeDiagnosisReport。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDiagnosisReport,
  classifyFailure,
  collectRuntimeSignals,
  writeDiagnosisReport,
  type FailureSignals
} from '../diagnosis'

function signalsWith(crash: string | null): FailureSignals {
  return {
    passed: false,
    crashReport: crash,
    latestLog: null,
    introspectionOk: false,
    introspectionError: null
  }
}

describe('classifyFailure', () => {
  it('Mixin 冲突 → 需人工', () => {
    const c = classifyFailure(signalsWith('org.spongepowered.asm.mixin.Mixin apply failed for X'))
    expect(c.fixable).toBe(false)
    expect(c.kind).toBe('human-mixin')
  })

  it('渲染异常 → 需人工', () => {
    const c = classifyFailure(signalsWith('Shader compile error in program'))
    expect(c.kind).toBe('human-render')
    expect(c.fixable).toBe(false)
  })

  it('编译失败 → 可修复', () => {
    const c = classifyFailure(signalsWith('Foo.java:12: error: cannot find symbol bar'))
    expect(c.fixable).toBe(true)
    expect(c.kind).toBe('compile')
  })

  it('缺依赖 → 可修复', () => {
    const c = classifyFailure(signalsWith('java.lang.ClassNotFoundException: com.example.Api'))
    expect(c.kind).toBe('missing-dep')
    expect(c.fixable).toBe(true)
  })

  it('材质路径 → 可修复', () => {
    const c = classifyFailure(signalsWith('Unable to load texture: demo:item/foo'))
    expect(c.kind).toBe('texture-path')
  })

  it('配方 JSON → 可修复', () => {
    const c = classifyFailure(signalsWith('Unknown recipe type: demo:custom'))
    expect(c.kind).toBe('recipe-json')
  })

  it('无特征运行时异常 → 兜底需人工', () => {
    const c = classifyFailure(signalsWith('java.lang.NullPointerException: Something broke'))
    expect(c.fixable).toBe(false)
    expect(c.kind).toBe('human-runtime')
    expect(c.evidence.length).toBeGreaterThan(0)
  })

  it('passed=true → 未检测到失败', () => {
    const c = classifyFailure({
      passed: true,
      crashReport: null,
      latestLog: null,
      introspectionOk: true,
      introspectionError: null
    })
    expect(c.evidence).toEqual([])
  })
})

describe('buildDiagnosisReport（TR-12.2）', () => {
  it('报告含失败分类、证据、建议与日志摘要', () => {
    const cls = classifyFailure(signalsWith('error: cannot find symbol bar'))
    const md = buildDiagnosisReport({
      runId: 'r1',
      round: 2,
      cls,
      signals: signalsWith('error: cannot find symbol bar')
    })
    expect(md).toContain('编译失败')
    expect(md).toContain('处置建议')
    expect(md).toContain('证据')
    expect(md).toContain('cannot find symbol')
    expect(md).toContain('日志摘要')
    expect(md).toContain('已完成自愈轮次：2')
  })
})

describe('collectRuntimeSignals / writeDiagnosisReport', () => {
  const dir = join(tmpdir(), `ky-diag-${Math.random().toString(36).slice(2)}`)

  it('从 run/ 目录读取最新 crash report 与 latest.log', () => {
    collectRuntimeSignals(dir) // 不存在也不抛
    const crashDir = join(dir, 'run', 'crash-reports')
    const logDir = join(dir, 'run', 'logs')
    mkdirSync(crashDir, { recursive: true })
    mkdirSync(logDir, { recursive: true })
    writeFileSync(join(crashDir, 'crash-2020.txt'), 'old')
    writeFileSync(join(crashDir, 'crash-2025.txt'), 'CRASH cannot find symbol')
    writeFileSync(join(logDir, 'latest.log'), 'LOG error: boom')

    const rt = collectRuntimeSignals(dir)
    expect(rt.crashReport).toContain('CRASH')
    expect(rt.crashReport).not.toContain('old')
    expect(rt.latestLog).toContain('boom')
  })

  it('writeDiagnosisReport 落盘到 .agent 并返回路径', () => {
    const cls = classifyFailure(signalsWith('error: x'))
    const md = buildDiagnosisReport({ runId: 'r9', round: 1, cls, signals: signalsWith('error: x') })
    const path = writeDiagnosisReport(dir, 'r9', md)
    expect(path.replace(/\\/g, '/')).toContain('.agent/diagnosis-r9.md')
    expect(existsSync(path)).toBe(true)
  })

  it('清理', () => {
    rmSync(dir, { recursive: true, force: true })
  })
})
