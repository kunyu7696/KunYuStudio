/**
 * buildFailureLayers 九层分类单测（P1①）。
 * 每层一组代表性日志信号 + 流水线序优先级 + category 映射 + 空证据兜底。
 */
import { describe, expect, it } from 'vitest'
import type { ErrorPattern, MatchedErrorPattern } from '../../../../../shared/types/aiReference'
import { classifyBuildFailure, isSameFailure } from '../buildFailureLayers'

function fakePattern(id: string, category: string): MatchedErrorPattern {
  const pattern: ErrorPattern = {
    id,
    category,
    categoryLabel: category,
    errorType: 'test',
    pattern: 'x',
    severity: 'major',
    mcVersions: ['1.20.1'],
    loaders: ['fabric'],
    cause: 'c',
    solution: 's',
    exampleError: 'e'
  }
  return { pattern, matchedText: 'x' }
}

describe('classifyBuildFailure：九层信号各自命中', () => {
  const cases: Array<[string, string, string]> = [
    // [期望层, 日志片段, 期望证据关键词]
    ['toolchain', 'FAILURE: Unsupported class file major version 65', 'class file major version'],
    ['toolchain', 'error: release version 17 not supported', 'release version 17'],
    ['dependency', 'Could not resolve net.fabricmc:yarn:1.20.1+build.999', 'Could not resolve'],
    ['dependency', 'Could not GET https://maven.example.com/x.pom received status code 401', '401'],
    ['compile', '> Task :compileJava FAILED\nFoo.java:12: error: cannot find symbol', 'compileJava'],
    ['compile', 'Compilation failed; see the compiler error output for details.', 'Compilation failed'],
    ['resources', '> Task :processResources FAILED', 'processResources'],
    ['resources', 'com.google.gson.JsonSyntaxException: Expected name at line 3', 'JsonSyntaxException'],
    ['packaging', '> Task :remapJar FAILED', 'remapJar'],
    ['packaging', 'Failed to remap jar with tiny-remapper', 'remap'],
    ['bootstrap', 'Error: Could not find or load main class net.fabricmc.loader.impl.launch.knot.KnotClient', 'main class'],
    ['bootstrap', 'Could not find entrypoint class com.example.Main', 'entrypoint'],
    ['mixin', 'Mixin apply failed: mixins.demo.json:DemoMixin -> InjectionError', 'Mixin apply failed'],
    ['mixin', 'Critical injection failure in demo.mixins.json', 'Critical injection failure'],
    ['registry', 'java.lang.IllegalArgumentException: Identifier demo:foo already registered', 'already registered'],
    ['registry', 'No such entry in registry minecraft:item: demo:bar', 'No such entry'],
    ['gameplay', 'java.lang.NullPointerException: Cannot invoke tick() during world update\nException ticking entity', 'Exception ticking'],
    ['gameplay', 'Exception in server tick loop', 'server tick loop']
  ]
  for (const [layer, log, evidence] of cases) {
    it(`${layer}：${evidence}`, () => {
      const r = classifyBuildFailure(log, [])
      expect(r).not.toBeNull()
      expect(r!.layer).toBe(layer)
      expect(r!.evidence).toContain(evidence)
      expect(r!.fixHint.length).toBeGreaterThan(0)
      expect(r!.label).toMatch(/层$/)
    })
  }
})

describe('classifyBuildFailure：优先级与兜底', () => {
  it('早层胜出：依赖信号 + 编译信号同时出现 → dependency（级联失败取根因层）', () => {
    const log =
      'Could not resolve net.fabricmc:yarn:1.20.1\n> Task :compileJava FAILED\nerror: cannot find symbol'
    const r = classifyBuildFailure(log, [])
    expect(r!.layer).toBe('dependency')
  })

  it('工具链比依赖更早：JAVA_HOME 报错 + Could not resolve → toolchain', () => {
    const log = 'JAVA_HOME is not set\nCould not resolve net.fabricmc:yarn:1.20.1'
    const r = classifyBuildFailure(log, [])
    expect(r!.layer).toBe('toolchain')
  })

  it('category 映射：无日志信号但命中 mixin_error 模式 → mixin', () => {
    const r = classifyBuildFailure('some generic gradle output', [fakePattern('ERR_MIX_001', 'mixin_error')])
    expect(r!.layer).toBe('mixin')
    expect(r!.evidence).toContain('ERR_MIX_001')
  })

  it('category 映射：api_fabrication → compile', () => {
    const r = classifyBuildFailure('generic output', [fakePattern('ERR_API_001', 'api_fabrication')])
    expect(r!.layer).toBe('compile')
  })

  it('category 映射：json_error → resources', () => {
    const r = classifyBuildFailure('generic output', [fakePattern('ERR_JSON_001', 'json_error')])
    expect(r!.layer).toBe('resources')
  })

  it('早层日志信号压过晚层 category：依赖信号 + mixin 模式 → dependency', () => {
    const r = classifyBuildFailure('Could not resolve net.fabricmc:yarn:1.20.1', [
      fakePattern('ERR_MIX_001', 'mixin_error')
    ])
    expect(r!.layer).toBe('dependency')
  })

  it('空日志 + 无模式 → null', () => {
    expect(classifyBuildFailure('', [])).toBeNull()
  })

  it('无任何信号的日志 + 无模式 → null（走原有未命中路径）', () => {
    expect(classifyBuildFailure('BUILD FAILED in 3s\n1 actionable task', [])).toBeNull()
  })
})

describe('isSameFailure：同一失败重现判定（P7 假设-证伪）', () => {
  it('同层即证伪：两轮都败在 compile（证据逐字不同也算）', () => {
    const prev = classifyBuildFailure('Foo.java:12: error: cannot find symbol', [])
    const next = classifyBuildFailure('Bar.java:99: error: incompatible types', [])
    expect(prev!.layer).toBe('compile')
    expect(next!.layer).toBe('compile')
    expect(isSameFailure(prev, next)).toBe(true)
  })

  it('换层不证伪：compile → mixin 视为诊断有进展', () => {
    const prev = classifyBuildFailure('error: cannot find symbol', [])
    const next = classifyBuildFailure('Mixin apply failed: InjectionError', [])
    expect(isSameFailure(prev, next)).toBe(false)
  })

  it('任一侧无分类 → false（无法判定证伪，保持原修复路径）', () => {
    const cls = classifyBuildFailure('error: cannot find symbol', [])
    expect(isSameFailure(null, cls)).toBe(false)
    expect(isSameFailure(cls, null)).toBe(false)
    expect(isSameFailure(null, null)).toBe(false)
  })
})
