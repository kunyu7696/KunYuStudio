/**
 * 崩溃/启动证据标准化提取。
 *
 * 证据清单纪律：诊断启动/崩溃时
 * 必查三项标准化证据，避免「看个日志大概」式的主观结论：
 * 1. ready-line：服务端/客户端就绪行（Done (Xs)! For help, type "help"）——
 *    「启动成功」的唯一硬证据，进程创建/日志滚动都不算；
 * 2. 最深 Caused by：异常链尾部才是根因，顶行包装异常会误导修复方向；
 * 3. 首个项目自有栈帧：堆栈里第一个属于本 mod 包名的帧——修复责任分界点，
 *    在它之上是调用方，在它之下是运行时。
 *
 * 纯函数零依赖，直接 vitest；fabric_log_debugger 在 diagnose 之后追加本清单段。
 */

export interface CrashEvidence {
  /** 就绪行（如 "Done (3.21s)! For help, type \"help\""），未观察到为 null */
  readyLine: string | null
  /** 最深 Caused by 行（链尾根因），无异常链为 null */
  deepestCausedBy: string | null
  /** 首个项目自有栈帧行（\tat 开头、命中自有包线索），无命中为 null */
  firstOwnFrame: string | null
  /** Caused by 链深度（0 = 无异常链） */
  causedByDepth: number
}

const READY_LINE_RE = /Done \([\d.]+s\)!|Starting minecraft server|Backend library: LWJGL/i
const CAUSED_BY_RE = /^Caused by:\s*(.+)$/i
const STACK_FRAME_RE = /^\s*at\s+([\w.$]+)\.([\w$<>]+)\(([^)]*)\)/

/**
 * 从日志/崩溃报告提取标准化证据。
 * @param text 日志或崩溃报告全文
 * @param ownHints 自有包线索（小写子串匹配，如 modId、'com.example.mymod'）；
 *   空数组时 firstOwnFrame 恒为 null（无法判定归属，不猜）。
 */
export function extractCrashEvidence(text: string, ownHints: string[] = []): CrashEvidence {
  let readyLine: string | null = null
  let deepestCausedBy: string | null = null
  let causedByDepth = 0
  let firstOwnFrame: string | null = null
  const hints = ownHints.map((h) => h.toLowerCase()).filter((h) => h.length > 0)

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (readyLine === null && READY_LINE_RE.test(line)) readyLine = line.slice(0, 200)
    const cb = CAUSED_BY_RE.exec(line)
    if (cb) {
      causedByDepth += 1
      // 链尾即最深：每命中一行就覆盖（Caused by 链在文本中自顶向下由浅到深）
      deepestCausedBy = line.slice(0, 200)
    }
    if (firstOwnFrame === null && hints.length > 0) {
      const frame = STACK_FRAME_RE.exec(raw)
      if (frame && hints.some((h) => frame[1].toLowerCase().includes(h))) {
        firstOwnFrame = line.slice(0, 200)
      }
    }
  }

  return { readyLine, deepestCausedBy, firstOwnFrame, causedByDepth }
}

/** 渲染为诊断输出的标准化证据段（全空返回空串，调用方自然跳过） */
export function renderCrashEvidence(ev: CrashEvidence): string {
  const lines: string[] = []
  if (ev.readyLine !== null) lines.push(`就绪证据（ready-line）：${ev.readyLine}`)
  if (ev.deepestCausedBy !== null) {
    lines.push(
      `最深 Caused by（${ev.causedByDepth} 层链，根因看这条不看顶行）：${ev.deepestCausedBy}`
    )
  }
  if (ev.firstOwnFrame !== null) lines.push(`首个自有栈帧（修复责任分界点）：${ev.firstOwnFrame}`)
  if (lines.length === 0) return ''
  return `标准化证据清单：\n${lines.map((l) => `· ${l}`).join('\n')}`
}
