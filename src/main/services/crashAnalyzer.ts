/**
 * 崩溃/日志根因分析器（纯函数，无 electron/fs 依赖，可直接单测）。
 *
 * 数据源两类：
 *  - crash-report 文本（run/crash-reports/*.txt）：结构化崩溃报告，优先；
 *  - latest.log 全文：无崩溃报告（游戏卡死/静默失败）时从中找 ERROR/WARN 归因。
 *
 * 输出统一 Diagnosis（分类 + 证据 + 修复建议）。遵循能力边界：只建议，不自动修复。
 */
import type { Diagnosis, LogFinding } from '../../shared/types/sandbox'

/** 诊断规则：顺序匹配，先命中先生效（更具体的规则放前面） */
export interface DiagnosisRule {
  id: string
  headline: string
  test: RegExp
  suggestion: string
}

export const DIAGNOSIS_RULES: DiagnosisRule[] = [
  {
    id: 'out-of-memory',
    headline: '内存不足（OutOfMemoryError）',
    test: /OutOfMemoryError|Java heap space|GC overhead limit/i,
    suggestion: '增大运行内存：在 Gradle 运行配置中调大 JVM 参数（如 -Xmx2G 或 -Xmx4G），并关闭其他占用内存的程序后重试。'
  },
  {
    id: 'jdk-version',
    headline: 'JDK 版本不匹配',
    test: /UnsupportedClassVersionError|class file version/i,
    suggestion: '当前 JDK 与目标 Minecraft 要求不一致：1.20.1 需 JDK 17，1.21+ 需 JDK 21。请在「运行和调试」的 JDK 环境中切换到推荐版本。'
  },
  {
    id: 'missing-dependency',
    headline: '依赖缺失或版本不兼容',
    test: /ClassNotFoundException|NoClassDefFoundError|NoSuchMethodError|NoSuchFieldError|Failed to find mod|requires .* \(/i,
    suggestion: '缺少前置模组或版本不兼容：根据异常中的类名/模组 ID，在模组市场安装对应依赖；若已安装，检查其 MC 版本与加载器版本是否匹配。'
  },
  {
    id: 'duplicate-registration',
    headline: '注册冲突（重复注册）',
    test: /already registered|duplicate registration|Registry.*already|Identifier.*already/i,
    suggestion: '同一 ID 被注册两次：检查 ModBlocks/ModItems 注册代码是否被重复调用（如 main 入口被多个 entrypoint 引用），或两个模组使用了相同 ID。'
  },
  {
    id: 'mixin',
    headline: 'Mixin 注入失败（模组兼容性）',
    test: /MixinApplyError|Mixin transformation|mixins\.json|Mixin apply failed|InvalidMixinException/i,
    suggestion: 'Mixin 找不到目标方法/字段：通常是模组与当前 MC 或其他模组版本不兼容。核对该 Mixin 适用的游戏版本，更新或移除冲突模组。'
  },
  {
    id: 'missing-resource',
    headline: '资源文件缺失',
    test: /FileNotFoundException|ResourceNotFoundException|Failed to load model|MissingTexture/i,
    suggestion: '资源路径与注册 ID 不一致：检查 assets/<modid>/ 下 blockstates/models/textures/lang 文件路径与命名空间是否和代码中的 Identifier 完全对应（全小写）。'
  },
  {
    id: 'datapack-tag',
    headline: '数据包/标签加载失败',
    test: /Couldn't parse|Failed to load tag|Error loading tags|datapack.*(error|fail)|parsing error loading/i,
    suggestion: 'data/<modid>/ 下 JSON（配方/战利品表/标签）语法或引用错误：根据报告中的文件路径定位 JSON，核对物品 ID 是否存在、逗号括号是否完整。'
  },
  {
    id: 'init-failure',
    headline: '静态初始化失败',
    test: /ExceptionInInitializerError/i,
    suggestion: '类静态字段初始化时抛错（常见于注册顺序问题：引用了尚未注册的对象）。检查静态字段的声明顺序与跨类引用。'
  },
  {
    id: 'stack-overflow',
    headline: '栈溢出（StackOverflowError）',
    test: /StackOverflowError/i,
    suggestion: '存在无限递归：检查事件回调中是否间接触发了同类事件，或 getter/递归方法缺少终止条件。'
  },
  {
    id: 'npe',
    headline: '空指针异常（NullPointerException）',
    suggestion: '某对象为 null：查看证据栈帧定位你自己的模组类（com.* 入口包），重点检查世界/玩家/注册表查找的返回值是否判空。',
    test: /NullPointerException/
  },
  {
    id: 'illegal-argument',
    headline: '非法参数（IllegalArgumentException）',
    test: /IllegalArgumentException/,
    suggestion: '向 API 传入了非法值（如负数属性、空 ID、错误枚举）：根据消息文本与栈帧检查构造方块/物品属性时的参数。'
  }
]

/** crash-report 解析中间结构 */
interface ParsedCrash {
  description: string
  headline: string
  cause: string
  /** 关键证据行：异常行 + 前若干 at 栈帧 */
  evidence: string[]
}

/** 从 crash-report 文本提取描述、headline、根因与证据行 */
function parseCrash(text: string): ParsedCrash {
  const descriptionMatch = text.match(/^Description:\s*(.+)$/m)
  const description = descriptionMatch?.[1]?.trim() ?? '崩溃报告未提供 Description'

  // Headline：Description 之后第一个含异常类型（Exception/Error）的行；
  // 找不到再退化为第一个非 at/非缩进行（兼容非标准报告）
  let headline = ''
  const afterDesc = text.slice(
    (descriptionMatch?.index ?? 0) + (descriptionMatch?.[0]?.length ?? 0)
  )
  const headLines = afterDesc.split(/\r?\n/)
  const exLine = headLines.find((line) => {
    const t = line.trim()
    if (!t || t.startsWith('at ') || t.startsWith('...') || /^--\s.*\s--$/.test(t)) return false
    return /(Exception|Error|Throwable)\b/.test(t)
  })
  for (const line of headLines) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('at ') || t.startsWith('...')) continue
    if (/^--\s.*\s--$/.test(t)) break
    headline = t
    break
  }
  if (exLine) headline = exLine.trim()
  if (!headline) headline = description

  const caused = [...text.matchAll(/^Caused by:\s*(.+)$/gm)].map((m) => m[1]?.trim() ?? '')
  const cause = caused.length > 0 ? caused[caused.length - 1]! : headline

  // 证据：根因行 + 其后最多 6 个栈帧（含 Caused by 链尾部）
  const evidence: string[] = []
  const lines = text.split(/\r?\n/)
  const causedIdxs = lines
    .map((l, i) => (/^Caused by:/.test(l.trim()) ? i : -1))
    .filter((i) => i >= 0)
  const anchor = causedIdxs[causedIdxs.length - 1] ?? lines.findIndex((l) => l.trim() === headline)
  if (anchor >= 0) {
    evidence.push(lines[anchor]!.trim())
    for (let i = anchor + 1; i < Math.min(lines.length, anchor + 8); i++) {
      const t = lines[i]!.trim()
      if (t.startsWith('at ')) evidence.push(t)
      else if (evidence.length > 1) break
    }
  }
  return { description, headline, cause, evidence: evidence.slice(0, 7) }
}

function matchRule(text: string): DiagnosisRule | null {
  return DIAGNOSIS_RULES.find((r) => r.test.test(text)) ?? null
}

/** 解析 crash-report 为结构化诊断 */
export function analyzeCrashReport(text: string, reportPath?: string): Diagnosis {
  const parsed = parseCrash(text)
  const rule = matchRule(`${parsed.cause}\n${parsed.headline}`)
  return {
    category: rule?.id ?? 'unknown',
    headline: rule?.headline ?? '未分类异常',
    cause: parsed.cause,
    evidence: parsed.evidence.length ? parsed.evidence : [parsed.description],
    suggestion: rule?.suggestion ?? '未匹配到已知模式，请查看完整崩溃报告与日志，或将报告内容提供给 AI 助手分析。',
    ...(reportPath ? { reportPath } : {})
  }
}

/** 日志高价值问题模式（用于 latest.log 扫描） */
const LOG_PATTERNS: Array<{ id: string; level: LogFinding['level']; test: RegExp }> = [
  { id: 'mixin-apply-failed', level: 'ERROR', test: /Mixin apply failed|MixinApplyError|InvalidMixinException/i },
  { id: 'missing-class', level: 'ERROR', test: /ClassNotFoundException|NoClassDefFoundError/ },
  { id: 'missing-mod', level: 'ERROR', test: /Failed to find mod|requires.*\d+\.\d+/i },
  { id: 'registry-error', level: 'ERROR', test: /already registered|duplicate registration|Registry.*already/i },
  { id: 'resource-error', level: 'ERROR', test: /ResourceNotFoundException|Failed to load model|Unable to load model/i },
  { id: 'tag-datapack-error', level: 'ERROR', test: /Failed to load tag|Error loading tags|Couldn't parse/i },
  { id: 'generic-exception', level: 'ERROR', test: /Exception|Error/ }
]

/**
 * 扫描 latest.log：优先抽取命中高价值模式的 ERROR/WARN 行。
 * 同一规范化行去重，总数限 50；泛化 Exception 规则只在没有更具体命中时兜底。
 */
export function scanGameLog(text: string): LogFinding[] {
  const findings: LogFinding[] = []
  const seen = new Set<string>()
  const genericOnly: LogFinding[] = []

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.length < 8) continue
    // log4j 行形如 [12:00:00] [Render thread/ERROR]：粗判级别
    const isError = /(^|\/)ERROR(\]|\s|$)/.test(line) || /ERROR/.test(line.slice(0, 120))
    const isWarn = /(^|\/)WARN(\]|\s|$)/.test(line)
    if (!isError && !isWarn) continue

    let matched: { id: string; level: LogFinding['level'] } | null = null
    for (const p of LOG_PATTERNS) {
      if (p.test.test(line)) {
        matched = { id: p.id, level: isWarn && !isError ? 'WARN' : p.level }
        break
      }
    }
    if (!matched) continue
    if (matched.id === 'generic-exception' && !isError) continue

    // 去重签名：异常类型 + 消息前 120 字（保留差异消息，只合并完全相同的刷屏行）
    const exSig = line.match(/([a-zA-Z_$][\w.$]*(?:Exception|Error))[^:]*:?\s*(.{0,120})/)
    // fallback 去掉行首时间戳/线程标记，使不同秒的同一日志行可合并
    const stripped = line.replace(/^\[[^\]]*\]\s*/g, '')
    const norm = exSig ? `${exSig[1]}|${exSig[2] ?? ''}` : stripped.slice(0, 200)
    if (seen.has(norm)) continue
    seen.add(norm)

    const finding: LogFinding = {
      level: matched.level,
      pattern: matched.id,
      line: line.length > 500 ? line.slice(0, 500) + '…' : line,
      evidence: extractEvidenceSnippet(line)
    }
    if (matched.id === 'generic-exception') genericOnly.push(finding)
    else findings.push(finding)
    if (findings.length >= 50) break
  }

  // 没有任何具体命中时，用少量通用异常行兜底
  if (findings.length === 0) return genericOnly.slice(0, 10)
  return findings
}

/** 从日志行中截取异常关键片段（异常类型 + 消息） */
function extractEvidenceSnippet(line: string): string {
  const m = line.match(/([a-zA-Z_$][\w.$]*(?:Exception|Error)[^:]*:?.*)$/)
  return m ? m[1]!.slice(0, 300) : line.slice(-300)
}

/**
 * 综合诊断：crash-report 优先；无报告时用日志发现归因。
 * 两者皆无则返回 null。
 */
export function diagnose(input: {
  reportText?: string | null
  reportPath?: string | null
  logText?: string | null
}): Diagnosis | null {
  if (input.reportText && input.reportText.trim()) {
    return analyzeCrashReport(input.reportText, input.reportPath ?? undefined)
  }
  const findings = input.logText ? scanGameLog(input.logText) : []
  const concrete = findings.find((f) => f.pattern !== 'generic-exception')
  const source = concrete ?? findings[0]
  if (!source) return null
  const rule = matchRule(source.evidence) ?? matchRule(source.line)
  return {
    category: rule?.id ?? source.pattern,
    headline: rule?.headline ?? `日志${source.level === 'ERROR' ? '错误' : '警告'}（${source.pattern}）`,
    cause: source.evidence || source.line,
    evidence: [source.line],
    suggestion: rule?.suggestion ?? '游戏日志中存在错误，请结合完整 latest.log 排查；必要时把该段日志提供给 AI 助手。'
  }
}
