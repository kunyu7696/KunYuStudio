/**
 * javap 桥接器：以 jar 为 classpath 批量调用 JDK 自带 javap，
 * 将 -c -p -v 输出解析为结构化类模型（供静态规则引擎消费）。
 *
 * 无需解压：`javap -c -p -v -cp <jar> <fqn...>`；
 * 类名按命令行长度分批（Windows CreateProcess 约 32k 字符上限）。
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { getSection } from '../settingsService'

export interface Instruction {
  /** 助记符（invokevirtual / getstatic / new …） */
  opcode: string
  /** 原始参数（如 #10） */
  rawArg: string
  /** 行内解析引用（// 后的完整声明），无则空 */
  ref: string
}

export interface AnnotationInfo {
  /** 注解全限定类型 */
  type: string
  /** javap 行内参数原文（如 method="tick()V"），无参为空 */
  params: string
}

export interface ParsedMethod {
  name: string
  descriptor: string
  isStatic: boolean
  isSynchronized: boolean
  isNative: boolean
  instructions: Instruction[]
  annotations: AnnotationInfo[]
}

export interface ParsedField {
  name: string
  type: string
  isStatic: boolean
  isFinal: boolean
  isVolatile: boolean
  annotations: AnnotationInfo[]
}

export interface ParsedClass {
  name: string
  superClass: string | null
  interfaces: string[]
  isInterface: boolean
  methods: ParsedMethod[]
  fields: ParsedField[]
  classAnnotations: AnnotationInfo[]
}

export interface BatchProgress {
  batch: number
  totalBatches: number
  classes: number
}

export interface JavapBridge {
  analyze(
    jarPath: string,
    classFqns: string[],
    onBatch?: (progress: BatchProgress) => void
  ): ParsedClass[]
}

/** 单批类名拼接的命令行字符预算 */
const COMMAND_CHAR_BUDGET = 20_000
const JAVAP_TIMEOUT_MS = 120_000

/**
 * jar 内 class 条目路径 → 全限定类名（内部类含 $，保留）。
 * 排除任意位置的 META-INF/（MR-JAR 版本化类；部分 jar 将其重定位在非根包下）。
 */
export function classEntryToFqn(entryPath: string): string | null {
  if (!entryPath.endsWith('.class')) return null
  if (entryPath.startsWith('META-INF/') || entryPath.includes('/META-INF/')) return null
  return entryPath.slice(0, -6).split('/').join('.')
}

/** 解析 javap 完整输出（可能含多个类） */
export function parseJavapOutput(text: string): ParsedClass[] {
  const lines = text.split(/\r?\n/)
  const classes: ParsedClass[] = []
  let current: ParsedClass | null = null
  /** 当前成员（注解归属用）；null = 类级 */
  let currentMethod: ParsedMethod | null = null
  let currentField: ParsedField | null = null
  let inCode = false
  let annotationTarget: 'class' | 'method' | 'field' = 'class'

  const pushClass = (): void => {
    if (current) classes.push(current)
  }

  for (const line of lines) {
    // 类头：public/final/abstract ... class|interface|enum name [extends ...] [implements ...] {
    const header = /\b(class|interface|enum)\s+([\w.$]+)(.*)\{?\s*$/.exec(line)
    if (header && /^\S/.test(line) && !line.includes(':') && !line.startsWith('//')) {
      pushClass()
      const kind = header[1]
      const tail = header[3] ?? ''
      const extendsMatch = /\bextends\s+([\w.$]+)/.exec(tail)
      const implementsMatch = /\bimplements\s+(.+?)\s*\{?$/.exec(tail)
      current = {
        name: header[2]!,
        superClass: extendsMatch ? (extendsMatch[1] ?? null) : null,
        interfaces: implementsMatch
          ? (implementsMatch[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        isInterface: kind === 'interface',
        methods: [],
        fields: [],
        classAnnotations: []
      }
      currentMethod = null
      currentField = null
      inCode = false
      annotationTarget = 'class'
      continue
    }
    if (!current) continue

    // RuntimeVisibleAnnotations：后续 N: #x(@Annotation) 行归属当前目标
    if (/^\s*RuntimeVisible(?:Type)?Annotations:\s*$/.test(line)) {
      annotationTarget = currentMethod ? 'method' : currentField ? 'field' : 'class'
      continue
    }

    // 注解行：  N: #x(@Type(params))
    const annotationLine = /^\s+\d+:\s+#\d+\s*\(@([\w.$]+)(?:\((.*)\))?\)\s*$/.exec(line)
    if (annotationLine) {
      const info: AnnotationInfo = {
        type: annotationLine[1]!,
        params: annotationLine[2] ?? ''
      }
      if (annotationTarget === 'method' && currentMethod) currentMethod.annotations.push(info)
      else if (annotationTarget === 'field' && currentField) currentField.annotations.push(info)
      else current.classAnnotations.push(info)
      continue
    }

    // 成员行（2 空格缩进）
    if (/^  \S/.test(line)) {
      const member = parseMemberLine(line)
      if (member?.kind === 'method') {
        currentMethod = {
          name: member.name,
          descriptor: '',
          isStatic: member.isStatic,
          isSynchronized: false,
          isNative: member.isNative,
          instructions: [],
          annotations: []
        }
        current.methods.push(currentMethod)
        currentField = null
        inCode = false
        annotationTarget = 'method'
        continue
      }
      if (member?.kind === 'field') {
        currentField = {
          name: member.name,
          type: member.type,
          isStatic: member.isStatic,
          isFinal: member.isFinal,
          isVolatile: false,
          annotations: []
        }
        current.fields.push(currentField)
        currentMethod = null
        inCode = false
        annotationTarget = 'field'
        continue
      }
    }

    if (/^    descriptor:\s+(.+)$/.test(line)) {
      const desc = /^    descriptor:\s+(.+)$/.exec(line)![1]!
      if (currentMethod) currentMethod.descriptor = desc
      if (currentField) currentField.type = descriptorToType(desc)
      continue
    }

    // flags 行：提取 ACC_SYNCHRONIZED / ACC_VOLATILE
    const flagsLine = /^    flags:\s*\([^)]*\)\s*(.*)$/.exec(line)
    if (flagsLine) {
      const flags = flagsLine[1] ?? ''
      if (currentMethod && flags.includes('ACC_SYNCHRONIZED')) {
        currentMethod.isSynchronized = true
      }
      if (currentField && flags.includes('ACC_VOLATILE')) {
        currentField.isVolatile = true
      }
      continue
    }

    if (/^    Code:\s*$/.test(line)) {
      inCode = true
      continue
    }

    // 指令行：  N: opcode args [// ref]
    const instr = /^\s+\d+:\s+(\w+)\s*(.*)$/.exec(line)
    if (instr && inCode && currentMethod) {
      const rest = instr[2] ?? ''
      const refSplit = /^(.*?)\s*\/\/\s*(.*)$/.exec(rest)
      currentMethod.instructions.push({
        opcode: instr[1]!,
        rawArg: refSplit ? refSplit[1]!.trim() : rest.trim(),
        ref: refSplit ? refSplit[2]!.trim() : ''
      })
      continue
    }

    // Code 区结束：其他属性行（LineNumberTable/LocalVariableTable/StackMapTable/Exceptions…）
    if (/^    \S/.test(line) && !/^    Code:/.test(line)) {
      inCode = false
    }
  }
  pushClass()
  return classes
}

interface MemberLine {
  kind: 'method' | 'field'
  name: string
  type: string
  isStatic: boolean
  isFinal: boolean
  isNative: boolean
}

/** 解析 2 空格缩进的成员声明行（javap 风格） */
function parseMemberLine(line: string): MemberLine | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('//')) return null
  const isMethod = /\(.*\)\s*;?$/.test(trimmed)
  const flags = /\bstatic\b/.test(trimmed)
  const isFinal = /\bfinal\b/.test(trimmed)
  const isNative = /\bnative\b/.test(trimmed)

  // 去掉修饰符
  const withoutFlags = trimmed
    .replace(/\b(public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;$/, '')

  if (isMethod) {
    const m = /([\w.$<>]+)\s*\(/.exec(withoutFlags)
    if (!m) return null
    return { kind: 'method', name: m[1]!, type: '', isStatic: flags, isFinal, isNative }
  }

  // 字段：type name
  const parts = withoutFlags.split(' ')
  if (parts.length < 2) return null
  const name = parts[parts.length - 1]!
  const type = parts.slice(0, -1).join(' ')
  if (!/^[A-Za-z_][\w$]*$/.test(name)) return null
  return { kind: 'field', name, type, isStatic: flags, isFinal, isNative: false }
}

/** 字段 descriptor → 可读类型（数组/对象） */
function descriptorToType(desc: string): string {
  let suffix = ''
  let i = 0
  while (desc[i] === '[') {
    suffix += '[]'
    i += 1
  }
  const map: Record<string, string> = {
    V: 'void', Z: 'boolean', B: 'byte', C: 'char',
    S: 'short', I: 'int', J: 'long', F: 'float', D: 'double'
  }
  const base = desc[i] === 'L' ? desc.slice(i + 1, desc.indexOf(';', i)).split('/').join('.') : (map[desc[i] ?? ''] ?? desc)
  return base + suffix
}

export function createJavapBridge(javaHome?: string): JavapBridge {
  function resolveJavap(): string {
    const home =
      javaHome ??
      getSection('java').globalJdkHome ??
      'C:\\Program Files\\Java\\jdk-17'
    return join(home, 'bin', process.platform === 'win32' ? 'javap.exe' : 'javap')
  }

  function analyze(
    jarPath: string,
    classFqns: string[],
    onBatch?: (progress: BatchProgress) => void
  ): ParsedClass[] {
    const batches = splitBatches(classFqns)
    const javap = resolveJavap()
    const all: ParsedClass[] = []
    batches.forEach((batch, index) => {
      let output: string
      try {
        output = execFileSync(
          javap,
          ['-c', '-p', '-v', '-cp', jarPath, ...batch],
          {
            timeout: JAVAP_TIMEOUT_MS,
            maxBuffer: 256 * 1024 * 1024,
            windowsHide: true,
            encoding: 'utf8'
          }
        )
      } catch (err) {
        const code = (err as { code?: string; message?: string }).code
        if (code === 'ENOENT') {
          throw new Error(`未找到 javap（${javap}），请在设置中指定 JDK 17 路径`)
        }
        throw new Error(`javap 执行失败：${(err as Error).message}`)
      }
      all.push(...parseJavapOutput(output))
      onBatch?.({ batch: index + 1, totalBatches: batches.length, classes: batch.length })
    })
    return all
  }

  return { analyze }
}

/** 按命令行字符预算将类名分批 */
function splitBatches(fqns: string[]): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let used = 0
  for (const fqn of fqns) {
    if (current.length > 0 && used + fqn.length + 1 > COMMAND_CHAR_BUDGET) {
      batches.push(current)
      current = []
      used = 0
    }
    current.push(fqn)
    used += fqn.length + 1
  }
  if (current.length > 0) batches.push(current)
  return batches
}
