/**
 * 游戏测试失败的信号采集、分类与诊断报告（TR-12.1 / TR-12.2）。
 *
 * 分类边界：
 * - 可自动修复：编译类 / 缺依赖 / 注册冲突 / 语法 / 材质路径 / 配方 JSON
 * - 需人工：Mixin 冲突 / 渲染异常 / 性能卡死 / 其它运行时逻辑
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

export type FixableKind =
  | 'compile'
  | 'missing-dep'
  | 'registration'
  | 'syntax'
  | 'texture-path'
  | 'recipe-json'

export type HumanKind =
  | 'human-mixin'
  | 'human-render'
  | 'human-performance'
  | 'human-runtime'

/** 一次游戏探测收集到的失败信号 */
export interface FailureSignals {
  /** 内省通过且无崩溃/致命错误 */
  passed: boolean
  crashReport: string | null
  latestLog: string | null
  introspectionOk: boolean
  introspectionError: string | null
}

export interface FailureClassification {
  fixable: boolean
  kind: FixableKind | HumanKind
  label: string
  /** 命中的原始证据片段 */
  evidence: string[]
  suggestion: string
}

interface PatternRule {
  kind: FixableKind | HumanKind
  label: string
  fixable: boolean
  patterns: RegExp[]
  suggestion: string
}

/**
 * 规则顺序敏感：先判需人工的硬信号（Mixin/渲染/性能），
 * 再判可修复类，最后对无特征失败兜底为人工运行时。
 */
const RULES: PatternRule[] = [
  {
    kind: 'human-mixin',
    label: 'Mixin 冲突 / 注入失败',
    fixable: false,
    patterns: [
      /mixin apply failed/i,
      /mixintransformererror/i,
      /critical injection problem/i,
      /injectionpointselector/i,
      /invalid descriptor for method/i,
      /target method .* was not found/i
    ],
    suggestion:
      'Mixin 注入点或目标签名与实际版本不符，需人工核对目标类/方法描述符与注入点，调整 @Inject/@Redirect 或改用兼容实现。'
  },
  {
    kind: 'human-render',
    label: '渲染异常',
    fixable: false,
    patterns: [
      /shader compile/i,
      /\bglsl\b/i,
      /vertex format/i,
      /tessellator/i,
      /rendering pipeline/i,
      /position_tex_color/i
    ],
    suggestion:
      '渲染管线/着色器层错误，自动修复风险高，需人工检查自定义 RenderLayer、Shader 与顶点格式。'
  },
  {
    kind: 'human-performance',
    label: '性能卡死 / 看门狗',
    fixable: false,
    patterns: [/watchdog/i, /tick took \d+\s*ms/i, /can't keep up/i, /server thread.*took \d+ ms/i],
    suggestion:
      '主线程卡顿或看门狗告警，需人工定位耗时逻辑（建议配合 JFR/Spark 性能画像），自动补丁无法保证正确性。'
  },
  {
    kind: 'registration',
    label: '注册冲突 / 注册对象缺失',
    fixable: true,
    patterns: [
      /duplicate registration/i,
      /already .*registered/i,
      /registering an id .* that is already/i,
      /missingregistryobject/i,
      /failed to register/i
    ],
    suggestion: '统一注册 ID/命名空间，去除重复注册或补齐缺失注册项后重新构建。'
  },
  {
    kind: 'missing-dep',
    label: '缺依赖 / API 不匹配',
    fixable: true,
    patterns: [
      /classnotfoundexception/i,
      /noclassdeffounderror/i,
      /nosuchmethoderror/i,
      /nosuchfielderror/i,
      /module .* not found/i
    ],
    suggestion:
      '补齐依赖或对齐 API 版本：检查 build.gradle 依赖声明、fabric.mod.json 的 depends 与 import 路径。'
  },
  {
    kind: 'compile',
    label: '编译失败',
    fixable: true,
    patterns: [
      /cannot find symbol/i,
      /compilation failed/i,
      /\berror:\b/i,
      /incompatible types/i,
      /cannot be applied to/i
    ],
    suggestion:
      '逐行修正编译错误。重点排查：①是否漏写了引用的类（如自定义 Goal、ScreenHandler、BlockEntity、自定义 Item/Block/Entity 子类）——' +
      '漏写的类必须用 write_project_file 补全；②自定义物品/方块/实体类必须在对应语义资产的 customClass 字段填入全限定名，' +
      '否则流水线不会注册它（表现为编译过但游戏里找不到）。'
  },
  {
    kind: 'recipe-json',
    label: '配方 JSON 错误',
    fixable: true,
    patterns: [
      /invalid .*recipe/i,
      /unknown recipe type/i,
      /recipe.*jsonparse/i,
      /ingredient.*(empty|invalid)/i,
      /recipemanager[\s\S]{0,120}json/i
    ],
    suggestion:
      '修正配方 JSON 的 type / ingredient / result 字段与路径，确保文件位于 data/<ns>/recipe(s)/。'
  },
  {
    kind: 'texture-path',
    label: '材质路径错误',
    fixable: true,
    patterns: [
      /unable to load texture/i,
      /using missing texture/i,
      /texture .*not found/i,
      /filenotfoundexception[^\n]*\.png/i
    ],
    suggestion: '核对贴图路径与命名空间，确保 .png 位于 assets/<ns>/textures/ 对应子目录。'
  },
  {
    kind: 'syntax',
    label: '语法 / 数据格式错误',
    fixable: true,
    patterns: [/jsonparseexception/i, /malformedjson/i, /syntax error/i, /unexpected token/i],
    suggestion: '按行号修正语法或 JSON 结构，注意逗号、引号与转义。'
  }
]

/** 从组合文本中提取异常/错误行（兜底证据） */
export function extractErrorLines(text: string, max = 6): string[] {
  return text
    .split(/\r?\n/)
    .filter((l) => /exception|error|caused by|crash/i.test(l))
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, max)
}

/** 分类失败信号 */
export function classifyFailure(s: FailureSignals): FailureClassification {
  if (s.passed && s.introspectionOk) {
    return {
      fixable: true,
      kind: 'compile',
      label: '未检测到失败',
      evidence: [],
      suggestion: ''
    }
  }

  const combined = [s.crashReport ?? '', s.latestLog ?? '', s.introspectionError ?? ''].join('\n')

  for (const rule of RULES) {
    const hits = new Set<string>()
    for (const pat of rule.patterns) {
      const m = combined.match(pat)
      if (m) hits.add(m[0])
    }
    if (hits.size > 0) {
      return {
        fixable: rule.fixable,
        kind: rule.kind,
        label: rule.label,
        evidence: [...hits].slice(0, 5),
        suggestion: rule.suggestion
      }
    }
  }

  // 兜底：有失败但无明确可自动修复特征 → 需人工运行时
  const evidence = extractErrorLines(combined)
  return {
    fixable: false,
    kind: 'human-runtime',
    label: '运行时逻辑错误（无明确可自动修复特征）',
    evidence: evidence.length > 0 ? evidence : ['游戏内省失败，且未采集到可识别的错误特征'],
    suggestion: '运行时异常缺少可安全自动修复的特征，需人工结合日志与堆栈定位逻辑问题。'
  }
}

// ---------------------------------------------------------------------------
// 运行目录信号采集（Gradle runClient 的 run/ 目录）
// ---------------------------------------------------------------------------
export interface RuntimeFiles {
  crashReport: string | null
  latestLog: string | null
}

const READ_CHAR_BUDGET = 16_000

/** 读取 crash-reports 中最新的一份（取前部，描述/堆栈在开头） */
function readLatestCrashReport(dir: string): string | null {
  if (!existsSync(dir)) return null
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    // mtime 相同时（同毫秒写入）按文件名降序兜底
    .sort((a, b) => b.mtime - a.mtime || (a.f < b.f ? 1 : a.f > b.f ? -1 : 0))
  if (entries.length === 0) return null
  return readFileSync(join(dir, entries[0].f), 'utf8').slice(0, READ_CHAR_BUDGET)
}

/** 读取文本文件尾部（日志关键信息多在末尾） */
export function readTail(path: string): string | null {
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf8')
  return text.length > READ_CHAR_BUDGET ? text.slice(text.length - READ_CHAR_BUDGET) : text
}

/**
 * 从任意游戏根目录采集 crash report 与 latest.log。
 * 项目 `run/` 与启动器实例的 `.minecraft`（或其上一级实例目录）都用同一套布局。
 */
export function collectGameSignals(gameRoot: string): RuntimeFiles {
  return {
    crashReport: readLatestCrashReport(join(gameRoot, 'crash-reports')),
    latestLog: readTail(join(gameRoot, 'logs', 'latest.log'))
  }
}

/** 从项目 run/ 目录采集 crash report 与 latest.log */
export function collectRuntimeSignals(projectPath: string): RuntimeFiles {
  return collectGameSignals(join(projectPath, 'run'))
}

// ---------------------------------------------------------------------------
// 诊断报告（TR-12.2）
// ---------------------------------------------------------------------------
export interface DiagnosisReportInput {
  runId: string
  /** 已完成的自愈轮次 */
  round: number
  cls: FailureClassification
  signals: FailureSignals
}

/** 组织日志摘要：保留异常/错误相关行，避免整篇倾倒 */
function makeLogExcerpt(signals: FailureSignals): string {
  const source = signals.crashReport ?? signals.latestLog ?? signals.introspectionError ?? ''
  const lines = extractErrorLines(source, 12)
  if (lines.length > 0) return lines.join('\n').slice(0, 3000)
  return source.slice(0, 3000)
}

/** 构造诊断报告 Markdown（纯函数，便于断言） */
export function buildDiagnosisReport(input: DiagnosisReportInput): string {
  const { cls, signals, round, runId } = input
  return [
    '# Agent 测试诊断报告',
    '',
    `- 运行 ID：${runId}`,
    `- 生成时间：${new Date().toISOString()}`,
    `- 已完成自愈轮次：${round}`,
    `- 失败分类：${cls.label}（${cls.kind}）`,
    `- 是否可自动修复：${cls.fixable ? '是' : '否（需人工介入）'}`,
    '',
    '## 处置建议',
    cls.suggestion,
    '',
    '## 证据',
    ...cls.evidence.map((e) => `- \`${e}\``),
    '',
    '## 日志摘要',
    '```',
    makeLogExcerpt(signals),
    '```',
    ''
  ].join('\n')
}

/** 落盘诊断报告，返回文件路径 */
export function writeDiagnosisReport(
  projectPath: string,
  runId: string,
  markdown: string
): string {
  const dir = join(projectPath, '.agent')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `diagnosis-${runId}.md`)
  writeFileSync(path, markdown, 'utf8')
  return path
}
