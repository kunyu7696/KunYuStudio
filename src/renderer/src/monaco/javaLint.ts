import type * as Monaco from 'monaco-editor'

/**
 * 轻量 Java 语法检查器。
 * 不做完整语义分析（那需要 JDT.LS），仅检测明显的语法结构错误：
 * - 未闭合的字符串 / 字符字面量
 * - 未闭合的注释
 * - 括号 / 花括号 / 方括号不匹配
 * - 行尾缺少分号（语句行启发式判断）
 *
 * 完整语义错误（类名、类型、重载）由后续接入 JDT.LS 提供。
 */
export interface LintMarker {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  message: string
  severity: 'error' | 'warning'
}

export function lintJava(source: string): LintMarker[] {
  const markers: LintMarker[] = []
  const lines = source.split('\n')
  const stack: { char: string; line: number; col: number }[] = []
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const closers = new Set([')', '}', ']'])

  let inBlockComment = false
  let inLineComment = false
  let inString = false
  let inChar = false
  let stringStartLine = 0
  let stringStartCol = 0

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    inLineComment = false
    let i = 0
    while (i < line.length) {
      const ch = line[i]
      const next = line[i + 1]

      // 块注释
      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false
          i += 2
          continue
        }
        i++
        continue
      }
      if (inLineComment) break

      // 字符串
      if (inString) {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '"') {
          inString = false
        }
        i++
        continue
      }
      if (inChar) {
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === "'") {
          inChar = false
        }
        i++
        continue
      }

      // 注释起始
      if (ch === '/' && next === '/') {
        inLineComment = true
        break
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true
        i += 2
        continue
      }
      // 字符串 / 字符
      if (ch === '"') {
        inString = true
        stringStartLine = li
        stringStartCol = i
        i++
        continue
      }
      if (ch === "'") {
        inChar = true
        i++
        continue
      }
      // 括号
      if (ch in pairs) {
        stack.push({ char: ch, line: li, col: i })
      } else if (closers.has(ch)) {
        const top = stack.pop()
        if (!top || pairs[top.char] !== ch) {
          markers.push({
            startLineNumber: li + 1,
            startColumn: i + 1,
            endLineNumber: li + 1,
            endColumn: i + 2,
            message: `不匹配的闭合符 '${ch}'`,
            severity: 'error'
          })
        }
      }
      i++
    }

    // 行末未闭合字符串（跨行字符串在 Java 中非法）
    if (inString) {
      markers.push({
        startLineNumber: stringStartLine + 1,
        startColumn: stringStartCol + 1,
        endLineNumber: li + 1,
        endColumn: line.length + 1,
        message: '未闭合的字符串字面量',
        severity: 'error'
      })
      inString = false
    }
  }

  // 未闭合的块注释
  if (inBlockComment) {
    markers.push({
      startLineNumber: lines.length,
      startColumn: 1,
      endLineNumber: lines.length,
      endColumn: 2,
      message: '未闭合的块注释',
      severity: 'error'
    })
  }

  // 栈中剩余的未闭合括号
  for (const item of stack) {
    markers.push({
      startLineNumber: item.line + 1,
      startColumn: item.col + 1,
      endLineNumber: item.line + 1,
      endColumn: item.col + 2,
      message: `未闭合的 '${item.char}'`,
      severity: 'error'
    })
  }

  // 分号启发式：非空、非注释、非块结构行末尾缺少 ;  {  }
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trimEnd()
    if (!line.trim()) continue
    const trimmed = line.trim()
    if (
      trimmed.endsWith(';') ||
      trimmed.endsWith('{') ||
      trimmed.endsWith('}') ||
      trimmed.endsWith(',') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('@') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('package ') ||
      trimmed.endsWith(')') ||
      trimmed.endsWith(':')
    ) {
      continue
    }
    // 仅对看起来像语句的行报警（包含 = 或 方法调用）
    if (/[=;()]/.test(trimmed) && !trimmed.endsWith('{') && !trimmed.endsWith('}')) {
      // 跳过明显的控制结构行
      if (/^(if|for|while|switch|else|do|try|catch|finally|synchronized)\b/.test(trimmed)) continue
      // 跳过注解行
      if (/^@/.test(trimmed)) continue
      const col = line.length - line.trimStart().length + trimmed.length
      markers.push({
        startLineNumber: li + 1,
        startColumn: col,
        endLineNumber: li + 1,
        endColumn: col + 1,
        message: '语句可能缺少分号',
        severity: 'warning'
      })
    }
  }

  return markers
}

/** 将 lint 结果转换为 Monaco marker */
export function toMonacoMarkers(markers: LintMarker[]): Monaco.editor.IMarkerData[] {
  return markers.map((m) => ({
    startLineNumber: m.startLineNumber,
    startColumn: m.startColumn,
    endLineNumber: m.endLineNumber,
    endColumn: m.endColumn,
    message: m.message,
    severity: m.severity === 'error' ? 8 : 4
  }))
}
