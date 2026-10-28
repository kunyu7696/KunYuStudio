/**
 * FC 工具循环护栏（C4）：
 * - repeat-guard：同签名（工具名 + 规范化参数）调用达到上限后直接短路，
 *   防止模型拿着完全相同的参数反复烧 token；
 * - 只读轮次上限：连续若干轮只有只读检索、没有任何写入/构建动作，
 *   判定为「检索空转」，强制模型收口输出最终结果；
 * - 卡死检测（P2）：重复动作（repeat-guard）/ 重复错误（同工具同失败原因反复）/
 *   连续全失败工具轮 / 独白（连续多轮只解释不产出）——命中即把可自纠提示回填给模型，
 *   或在无望时让调用方提前收口，不再空烧额度；
 * - 结果截断由调用方用 clipToolResult 统一处理（截断提示前置，正文保留末尾）。
 *
 * 纯类、零依赖，便于 vitest 直接验证。
 */

/** FC 循环里会产生副作用（写语义资产/改像素/提交源码文件）的工具；其余一律视为只读 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'content_upsert',
  'write_project_file',
  'edit_project_file',
  'texture_paint',
  'texture_pixelize',
  'texture_repaint'
])

/** 同一签名最多实际执行次数（第 3 次起短路） */
export const DEFAULT_MAX_REPEAT = 2
/** 连续只读检索轮数上限，超过即强制收口 */
export const DEFAULT_MAX_READONLY_ROUNDS = 3
/** 同一失败原因（工具名 + 归一化错误文本）重复次数上限，超过即提示换策略 */
export const DEFAULT_MAX_REPEAT_ERRORS = 3
/** 连续「本轮工具调用全部失败」轮数上限 */
export const DEFAULT_MAX_FAILED_ROUNDS = 3
/** 独白判定：正文长度超过该值且零产出，记一次「只解释不产出」 */
export const MONOLOGUE_MIN_CHARS = 1200
/** 连续独白轮数上限：超过即不再追加催产提示，交由调用方如实收口 */
export const DEFAULT_MAX_MONOLOGUE_ROUNDS = 2

export interface GuardCallResult {
  /** true = 命中重复护栏，本次不应真正执行工具，直接把 notice 回填给模型 */
  blocked: boolean
  /** 该签名此前（含本次计数）出现的次数 */
  count: number
  notice?: string
}

export interface GuardRoundResult {
  /** 截至本轮的连续只读轮数 */
  readonlyStreak: number
  /** 是否达到只读上限，调用方应立即要求模型输出最终 JSON */
  forceSynthesize: boolean
  notice?: string
}

/** P2 卡死检测结论：stuck=true 时调用方应停止重试/提前收口 */
export interface GuardStuckResult {
  stuck: boolean
  /** 卡死类型，便于调用方组织日志与收口话术 */
  kind?: 'repeat-error' | 'failed-rounds' | 'monologue'
  notice?: string
}

/** 参数规范化：键排序后 JSON 序列化；非对象参数整体转字符串 */
export function normalizeArgs(args: unknown): string {
  if (args === null || typeof args !== 'object') return JSON.stringify(args)
  if (Array.isArray(args)) return JSON.stringify(args)
  const record = args as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const ordered: Record<string, unknown> = {}
  for (const k of keys) ordered[k] = record[k]
  return JSON.stringify(ordered)
}

/** 错误文本归一化：去空白与数字/行号差异，让「同一类错误」能聚合（避免每次路径不同就漏判） */
export function normalizeError(error: string): string {
  return error
    .replace(/\s+/g, ' ')
    .replace(/\d+/g, '#')
    .trim()
    .slice(0, 200)
}

export class ToolLoopGuard {
  private readonly counts = new Map<string, number>()
  private readonlyStreak = 0
  /** 收口已触发过一次（避免重复注入） */
  private forced = false
  /** P2 卡死检测：同一失败原因计数 + 连续全失败轮数 + 连续独白轮数 */
  private readonly errorCounts = new Map<string, number>()
  private failedRounds = 0
  private monologueRounds = 0
  /** 各类卡死提示只给一次，避免每轮重复刷同一条 */
  private readonly noticedKinds = new Set<string>()

  constructor(
    private readonly maxRepeat: number = DEFAULT_MAX_REPEAT,
    private readonly maxReadonlyRounds: number = DEFAULT_MAX_READONLY_ROUNDS,
    private readonly maxRepeatErrors: number = DEFAULT_MAX_REPEAT_ERRORS,
    private readonly maxFailedRounds: number = DEFAULT_MAX_FAILED_ROUNDS,
    private readonly maxMonologueRounds: number = DEFAULT_MAX_MONOLOGUE_ROUNDS
  ) {}

  static signature(name: string, args: unknown): string {
    return `${name}#${normalizeArgs(args)}`
  }

  /**
   * 记录一次工具调用意图。
   * @returns blocked=true 时调用方跳过执行，回填 notice 文本
   */
  noteCall(name: string, args: unknown): GuardCallResult {
    const sig = ToolLoopGuard.signature(name, args)
    const count = (this.counts.get(sig) ?? 0) + 1
    this.counts.set(sig, count)
    if (count > this.maxRepeat) {
      return {
        blocked: true,
        count,
        notice:
          `护栏拦截：工具 ${name} 已用完全相同的参数执行过 ${this.maxRepeat} 次，结果不会变化。` +
          '请基于已返回的内容继续，或更换参数；不要再次发起相同调用。'
      }
    }
    return { blocked: false, count }
  }

  /**
   * 一轮模型响应处理完后汇报。
   * @param toolNames 本轮模型实际调用的工具名（被 repeat-guard 拦截的也算）
   * @param writeSucceeded 本轮是否有写工具真正执行成功（result.ok===true）——
   *   P1-6 改为按结果记账：仅 ok 的写入才复位只读计数；
   *   写意图失败（ok:false / 被护栏拦截）与只读同样累计，
   *   防止模型用非法路径反复调用写工具无限空转、强制收口护栏永不触发。
   * @param failedCalls P2 卡死检测：本轮失败的工具调用数（含被拦截的实际未执行者），
   *   等于 toolNames.length 时视为「全失败轮」并累计
   */
  noteRound(toolNames: string[], writeSucceeded = false, failedCalls = 0): GuardRoundResult {
    if (toolNames.length === 0) {
      // 模型未调工具：循环本身会结束，只读计数清零以免干扰后续
      this.readonlyStreak = 0
      return { readonlyStreak: 0, forceSynthesize: false }
    }
    // P2：连续「全失败工具轮」检测（与只读计数同源判定，但语义更强：模型在反复试错）
    this.failedRounds =
      failedCalls >= toolNames.length ? this.failedRounds + 1 : 0
    if (writeSucceeded) {
      this.readonlyStreak = 0
      return { readonlyStreak: 0, forceSynthesize: false }
    }
    this.readonlyStreak += 1
    if (!this.forced && this.readonlyStreak >= this.maxReadonlyRounds) {
      this.forced = true
      return {
        readonlyStreak: this.readonlyStreak,
        forceSynthesize: true,
        notice:
          `护栏提示：已连续 ${this.readonlyStreak} 轮没有成功写入任何资产（本轮工具：${toolNames.join('/')}）。` +
          '请立即停止检索，基于现有资料开始产出：逐个调用 write_project_file 提交完整源码/资源文件' +
          '（或 content_upsert 保存语义资产）；确有信息缺口时在 notes 中说明，不得继续空转。'
      }
    }
    return { readonlyStreak: this.readonlyStreak, forceSynthesize: false }
  }

  /**
   * P2 卡死检测①——重复错误：同一工具 + 同一类失败原因反复出现时提示换策略。
   * 与 repeat-guard 的区别：repeat-guard 只认「参数完全相同」，
   * 这里认「参数不同但错因相同」（如 edit_project_file 逐文件都 search 未命中），
   * 那类情况模型会一直换参数重试、永不收敛。
   * @param error 工具返回的失败原因原文（缺省取工具名本身，表示「同类失败」）
   * @returns stuck=true 时调用方应把 notice 回填给模型；同一类错误只提示一次
   */
  noteFailure(name: string, error?: string): GuardStuckResult {
    const sig = `${name}#${normalizeError(error ?? '')}`
    const count = (this.errorCounts.get(sig) ?? 0) + 1
    this.errorCounts.set(sig, count)
    const kindKey = `repeat-error:${sig}`
    if (count > this.maxRepeatErrors && !this.noticedKinds.has(kindKey)) {
      this.noticedKinds.add(kindKey)
      return {
        stuck: true,
        kind: 'repeat-error',
        notice:
          `护栏提示：工具 ${name} 已因同一原因失败 ${count} 次（原因：${normalizeError(error ?? '未说明')}）。` +
          '继续用同样的方式重试不会成功——请改用其它工具或改变策略：' +
          '例如 search 未命中时先 read_project_file 读回原文再逐字复制片段；' +
          '路径非法时改用项目内真实存在的路径。'
      }
    }
    return { stuck: false }
  }

  /**
   * P2 卡死检测②——连续全失败工具轮：模型连续多轮发起的工具调用全部失败，
   * 说明它没有找到可行路径（或是在用写工具试探非法路径），应停止重试并如实收口。
   */
  noteFailedRounds(): GuardStuckResult {
    if (this.failedRounds >= this.maxFailedRounds && !this.noticedKinds.has('failed-rounds')) {
      this.noticedKinds.add('failed-rounds')
      return {
        stuck: true,
        kind: 'failed-rounds',
        notice:
          `护栏提示：已连续 ${this.failedRounds} 轮工具调用全部失败。请停止继续试探，` +
          '改为：先用只读工具核对一次真实路径/内容，再一次性提交正确的写入调用；' +
          '若确实无法完成，请在 notes 中如实说明卡点（不要反复重试）。'
      }
    }
    return { stuck: false }
  }

  /**
   * P2 卡死检测③——独白：模型连续多轮只输出长篇解释/规划，零工具调用零文件产出。
   * 调用方在「无工具调用且零产出」的轮次汇报；达到上限说明催产已无意义，
   * 调用方应停止追加催产提示、如实收口（不再空烧额度）。
   * @param contentChars 本轮正文长度；低于阈值不算独白（可能只是简短收尾）
   */
  noteMonologue(contentChars: number): GuardStuckResult {
    if (contentChars < MONOLOGUE_MIN_CHARS) return { stuck: false }
    this.monologueRounds += 1
    if (this.monologueRounds >= this.maxMonologueRounds && !this.noticedKinds.has('monologue')) {
      this.noticedKinds.add('monologue')
      return {
        stuck: true,
        kind: 'monologue',
        notice:
          `护栏提示：已连续 ${this.monologueRounds} 轮只输出解释/规划（约 ${contentChars} 字）而没有任何产出。` +
          '再解释也不会产生文件——请立刻动手：直接调用写入工具提交文件，或在 notes 中如实说明未能完成的原因。'
      }
    }
    return { stuck: false }
  }

  /** 产出恢复正常（成功写入或提交文件）时复位独白计数 */
  resetMonologue(): void {
    this.monologueRounds = 0
  }

  get currentReadonlyStreak(): number {
    return this.readonlyStreak
  }
}

/**
 * 工具结果截断（C4 结果截断护栏）：超长时保留末尾 max 字符并附显式提示，
 * 让模型明确感知「内容被截断」而非误以为已看到全文。
 * P1-6：改为保留尾部——工具结果的错误详情/结论/统计通常在末尾，
 * 头部多为参数回显与过程日志；截头会让模型看不到失败的真实原因
 * （本注释「从末尾保留」与旧实现 slice(0,max) 的漂移一并修正）。
 */
export function clipToolResult(text: string, max: number): string {
  if (text.length <= max) return text
  const omitted = text.length - max
  const tail = text.slice(text.length - max)
  return `…（结果过长，开头 ${omitted} 个字符已截断，以下为末尾内容；如需开头请缩小 limit 或按更精确的参数分段检索）\n${tail}`
}
