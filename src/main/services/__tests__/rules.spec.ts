/**
 * R01–R10 规则测试：每条规则至少正反两例，并校验证据定位字段。
 * 夹具直接构造结构化 ParsedClass（规则只依赖模型，不依赖字节码）。
 */
import type {
  AnnotationInfo,
  Instruction,
  ParsedClass,
  ParsedField,
  ParsedMethod
} from '../performance/javapBridge'
import type { ModMetadataSummary } from '../performance/modMetadata'
import type { Rule, RuleContext } from '../performance/rules'
import {
  ALL_RULES,
  MOD_RULES,
  buildRuleContext,
  runRules
} from '../performance/rules'
import { ruleR01 } from '../performance/rules/r01BlockingMainThread'
import { ruleR02 } from '../performance/rules/r02UnsynchronizedStatic'
import { ruleR03 } from '../performance/rules/r03TickAllocation'
import { ruleR04 } from '../performance/rules/r04UnboundedCache'
import { ruleR05 } from '../performance/rules/r05StaticLifecycle'
import { ruleR06 } from '../performance/rules/r06ListenerNotUnregistered'
import { ruleR07 } from '../performance/rules/r07DuplicateRegistration'
import { ruleR08 } from '../performance/rules/r08MixinTargetOverlap'
import { ruleR09 } from '../performance/rules/r09ThreadPoolAbuse'
import { ruleR10 } from '../performance/rules/r10ResourceNotClosed'
import { describe, expect, it } from 'vitest'

// ---------- 夹具 builder ----------

function ann(type: string, params = ''): AnnotationInfo {
  return { type, params }
}

function methodCall(kind: 'Method' | 'InterfaceMethod', owner: string, name: string): Instruction {
  return { opcode: kind === 'InterfaceMethod' ? 'invokeinterface' : 'invokevirtual', rawArg: '#1', ref: `${kind} ${owner}.${name}:()V` }
}
function staticCall(owner: string, name: string, desc = '()V'): Instruction {
  return { opcode: 'invokestatic', rawArg: '#1', ref: `Method ${owner}.${name}:${desc}` }
}
function ctorCall(owner: string): Instruction {
  return { opcode: 'invokespecial', rawArg: '#1', ref: `Method ${owner}."<init>":()V` }
}
function newObj(owner: string): Instruction {
  return { opcode: 'new', rawArg: '#2', ref: `class ${owner}` }
}
function fieldWrite(owner: string, name: string, type: string): Instruction {
  return { opcode: 'putstatic', rawArg: '#3', ref: `Field ${owner}.${name}:${type}` }
}

function method(name: string, instructions: Instruction[], extra?: Partial<ParsedMethod>): ParsedMethod {
  return {
    name,
    descriptor: '()V',
    isStatic: false,
    isSynchronized: false,
    isNative: false,
    instructions,
    annotations: [],
    ...extra
  }
}

function field(name: string, type: string, extra?: Partial<ParsedField>): ParsedField {
  return {
    name,
    type,
    isStatic: false,
    isFinal: false,
    isVolatile: false,
    annotations: [],
    ...extra
  }
}

function cls(name: string, parts?: Partial<ParsedClass>): ParsedClass {
  return {
    name,
    superClass: null,
    interfaces: [],
    isInterface: false,
    methods: [],
    fields: [],
    classAnnotations: [],
    ...parts
  }
}

function metadata(mixinEntries: Array<{ mixinClass: string; target: string | null }>): ModMetadataSummary {
  return {
    fabric: { modId: 'm', modName: 'm', version: '1', hardDeps: [], softDeps: [], mixinConfigs: [] },
    mixins: [{ path: 'm.mixins.json', package: 'com.x', environment: 'main', entries: mixinEntries }],
    classCount: 0
  }
}

function ctx(classes: ParsedClass[], mixinEntries: Array<{ mixinClass: string; target: string | null }> = []): RuleContext {
  return buildRuleContext(metadata(mixinEntries), classes)
}

function hit(rule: Rule, classes: ParsedClass[], mixinEntries: Array<{ mixinClass: string; target: string | null }> = []) {
  return runRules(ctx(classes, mixinEntries), [rule])
}

const MIXIN_PKG = 'org.spongepowered.asm.mixin'
const INJECT = `${MIXIN_PKG}.injection.Inject`

// ---------- 规则用例 ----------

describe('R01 主线程阻塞', () => {
  it('@Inject + Thread.sleep 命中且证据定位', () => {
    const c = cls('com.x.M', {
      methods: [method('doIt', [staticCall('java/lang/Thread', 'sleep', '(J)V')], {
        annotations: [ann(INJECT)]
      })]
    })
    const findings = hit(ruleR01, [c])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('critical')
    expect(findings[0]?.source).toBe('static')
    expect(findings[0]?.evidence[0]).toMatchObject({ className: 'com.x.M', method: 'doIt' })
  })

  it('普通类 sleep 不命中', () => {
    const c = cls('com.x.Worker', { methods: [method('run', [staticCall('java/lang/Thread', 'sleep', '(J)V')])] })
    expect(hit(ruleR01, [c])).toHaveLength(0)
  })

  it('@Inject 但无阻塞调用不命中', () => {
    const c = cls('com.x.M', {
      methods: [method('doIt', [methodCall('Method', 'com/x/Helper', 'compute')], { annotations: [ann(INJECT)] })]
    })
    expect(hit(ruleR01, [c])).toHaveLength(0)
  })
})

describe('R02 未同步静态字段', () => {
  const c = (f: ParsedField): ParsedClass =>
    cls('com.x.C', {
      fields: [f],
      methods: [method('set', [fieldWrite('com/x/C', f.name, 'I')])]
    })

  it('可变静态字段写入命中', () => {
    const findings = hit(ruleR02, [c(field('count', 'int', { isStatic: true }))])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('static')
    expect(findings[0]?.evidence[0]).toMatchObject({ field: 'count', method: 'set', className: 'com.x.C' })
  })

  it('final 字段不命中', () => {
    expect(hit(ruleR02, [c(field('count', 'int', { isStatic: true, isFinal: true }))])).toHaveLength(0)
  })

  it('volatile 字段不命中', () => {
    expect(hit(ruleR02, [c(field('count', 'int', { isStatic: true, isVolatile: true }))])).toHaveLength(0)
  })

  it('synchronized 方法写入不命中', () => {
    const clazz = cls('com.x.C', {
      fields: [field('count', 'int', { isStatic: true })],
      methods: [method('set', [fieldWrite('com/x/C', 'count', 'I')], { isSynchronized: true })]
    })
    expect(hit(ruleR02, [clazz])).toHaveLength(0)
  })
})

describe('R03 tick 内分配', () => {
  const injectTick = (instructions: Instruction[], target = 'tick()V'): ParsedClass =>
    cls('com.x.M', {
      methods: [method('doIt', instructions, { annotations: [ann(INJECT, `method="${target}"`)] })]
    })

  it('tick + new 命中', () => {
    const findings = hit(ruleR03, [injectTick([newObj('java/util/ArrayList')])])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('heuristic')
  })

  it('render + anewarray 命中', () => {
    const c = injectTick([{ opcode: 'anewarray', rawArg: '#4', ref: 'class java/lang/String' }], 'render(F)V')
    expect(hit(ruleR03, [c])).toHaveLength(1)
  })

  it('非高频目标不命中', () => {
    expect(hit(ruleR03, [injectTick([newObj('java/util/ArrayList')], 'onInitialize()V')])).toHaveLength(0)
  })

  it('tick 但无分配不命中', () => {
    expect(hit(ruleR03, [injectTick([methodCall('Method', 'com/x/H', 'compute')])])).toHaveLength(0)
  })
})

describe('R04 无界缓存', () => {
  const cacheCls = (fieldName: string, calls: Instruction[], type = 'java.util.HashMap'): ParsedClass =>
    cls('com.x.C', {
      fields: [field(fieldName, type, { isStatic: true })],
      methods: [method('init', calls)]
    })

  it('静态 cache 只 put 命中', () => {
    const findings = hit(ruleR04, [cacheCls('cache', [methodCall('Method', 'java/util/HashMap', 'put')])])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('heuristic')
    expect(findings[0]?.evidence[0]?.field).toBe('cache')
  })

  it('存在 remove 不命中', () => {
    const c = cacheCls('cache', [
      methodCall('Method', 'java/util/HashMap', 'put'),
      methodCall('Method', 'java/util/HashMap', 'remove')
    ])
    expect(hit(ruleR04, [c])).toHaveLength(0)
  })

  it('字段名无语义不命中', () => {
    const c = cacheCls('data', [methodCall('Method', 'java/util/HashMap', 'put')])
    expect(hit(ruleR04, [c])).toHaveLength(0)
  })
})

describe('R05 静态生命周期', () => {
  it('静态持有 MC 对象命中', () => {
    const c = cls('com.x.C', { fields: [field('level', 'net.minecraft.world.level.Level', { isStatic: true })] })
    const findings = hit(ruleR05, [c])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('high')
    expect(findings[0]?.source).toBe('static')
  })

  it('实例字段不命中', () => {
    const c = cls('com.x.C', { fields: [field('level', 'net.minecraft.world.level.Level')] })
    expect(hit(ruleR05, [c])).toHaveLength(0)
  })

  it('静态非 MC 类型不命中', () => {
    const c = cls('com.x.C', { fields: [field('name', 'java.lang.String', { isStatic: true })] })
    expect(hit(ruleR05, [c])).toHaveLength(0)
  })
})

describe('R06 监听未注销', () => {
  it('register 无 unregister 命中', () => {
    const c = cls('com.x.C', { methods: [method('init', [methodCall('Method', 'com/google/common/eventbus/EventBus', 'register')])] })
    const findings = hit(ruleR06, [c])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('static')
  })

  it('register + unregister 不命中', () => {
    const c = cls('com.x.C', {
      methods: [
        method('init', [methodCall('Method', 'com/google/common/eventbus/EventBus', 'register')]),
        method('shutdown', [methodCall('Method', 'com/google/common/eventbus/EventBus', 'unregister')])
      ]
    })
    expect(hit(ruleR06, [c])).toHaveLength(0)
  })
})

describe('R07 重复注册', () => {
  it('同方法注册两次命中', () => {
    const c = cls('com.x.C', {
      methods: [method('init', [
        methodCall('Method', 'com/x/Registry', 'register'),
        methodCall('Method', 'com/x/Registry', 'register')
      ])]
    })
    const findings = hit(ruleR07, [c])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('heuristic')
  })

  it('不同方法各一次不命中', () => {
    const c = cls('com.x.C', {
      methods: [
        method('a', [methodCall('Method', 'com/x/Registry', 'register')]),
        method('b', [methodCall('Method', 'com/x/Registry', 'register')])
      ]
    })
    expect(hit(ruleR07, [c])).toHaveLength(0)
  })
})

describe('R08 Mixin 目标重叠', () => {
  const mixin = (className: string, targetMethod: string): ParsedClass =>
    cls(className, {
      methods: [method('inject', [], { annotations: [ann(INJECT, `method="${targetMethod}"`)] })]
    })

  it('两个注入点同目标方法命中', () => {
    const classes = [mixin('com.x.M1', 'tick()V'), mixin('com.x.M2', 'tick()V')]
    const entries = [
      { mixinClass: 'com.x.M1', target: 'net.minecraft.Foo' },
      { mixinClass: 'com.x.M2', target: 'net.minecraft.Foo' }
    ]
    const findings = hit(ruleR08, classes, entries)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('static')
    expect(findings[0]?.evidence).toHaveLength(2)
  })

  it('目标方法不同不命中', () => {
    const classes = [mixin('com.x.M1', 'tick()V'), mixin('com.x.M2', 'render(F)V')]
    const entries = [
      { mixinClass: 'com.x.M1', target: 'net.minecraft.Foo' },
      { mixinClass: 'com.x.M2', target: 'net.minecraft.Foo' }
    ]
    expect(hit(ruleR08, classes, entries)).toHaveLength(0)
  })
})

describe('R09 线程池滥用', () => {
  it('newCachedThreadPool 命中', () => {
    const c = cls('com.x.C', { methods: [method('init', [staticCall('java/util/concurrent/Executors', 'newCachedThreadPool')])] })
    const findings = hit(ruleR09, [c])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('static')
  })

  it('裸 Thread.start 命中', () => {
    const c = cls('com.x.C', {
      methods: [method('go', [newObj('java/lang/Thread'), ctorCall('java/lang/Thread'), methodCall('Method', 'java/lang/Thread', 'start')])]
    })
    expect(hit(ruleR09, [c])).toHaveLength(1)
  })

  it('newFixedThreadPool 不命中', () => {
    const c = cls('com.x.C', { methods: [method('init', [staticCall('java/util/concurrent/Executors', 'newFixedThreadPool')])] })
    expect(hit(ruleR09, [c])).toHaveLength(0)
  })
})

describe('R10 资源未关闭', () => {
  it('打开 FileInputStream 无 close 命中', () => {
    const c = cls('com.x.C', {
      methods: [method('read', [newObj('java/io/FileInputStream'), ctorCall('java/io/FileInputStream')])]
    })
    const findings = hit(ruleR10, [c])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('static')
  })

  it('有 close 不命中', () => {
    const c = cls('com.x.C', {
      methods: [method('read', [
        newObj('java/io/FileInputStream'),
        ctorCall('java/io/FileInputStream'),
        methodCall('Method', 'java/io/FileInputStream', 'close')
      ])]
    })
    expect(hit(ruleR10, [c])).toHaveLength(0)
  })
})

describe('注册表完整性', () => {
  it('12 条规则全部注册且 id 唯一（10 单模组 + 2 集合）', () => {
    expect(MOD_RULES).toHaveLength(10)
    expect(ALL_RULES).toHaveLength(12)
    expect(new Set(ALL_RULES.map((r) => r.id)).size).toBe(12)
  })

  it('每条规则均声明来源标签，且归属与实现一致', () => {
    const expected: Record<string, 'static' | 'runtime' | 'heuristic'> = {
      R01: 'static',
      R02: 'static',
      R03: 'heuristic',
      R04: 'heuristic',
      R05: 'static',
      R06: 'static',
      R07: 'heuristic',
      R08: 'static',
      R09: 'static',
      R10: 'static',
      R11: 'static',
      R12: 'heuristic'
    }
    for (const rule of ALL_RULES) {
      expect(rule.source, `${rule.id} 来源标签`).toBe(expected[rule.id])
    }
  })
})
