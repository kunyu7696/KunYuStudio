/**
 * 特性③：AcceptanceContract 验收契约评估器（纯函数为主，单测友好）。
 *
 * 由 LLM 在 generate 阶段最终 JSON 中产出 contract（与 files/notes 同对象），
 * orchestrator 在各阶段调用本模块的 evaluate* 函数逐步填实际值，最后合并、
 * summarize 成 contract artifact 推送给渲染层。
 *
 * 安全边界：
 * - 路径校验复用 validateFileChanges 同款规则（拒 `..`/盘符/绝对路径/项目根外）
 * - ② 注册条目纯静态校验（读文件文本按 min/regex 数匹配次数），不触真机探针
 * - ⑤ gametest-runtime 由特性④ GameTest 报告评估（orchestrator 跑完 runGameTestServer 后调 evaluateAfterGameTest）
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

import type {
  AcceptanceAssertion,
  AcceptanceContract,
  AgentArtifact,
  AssertionKind,
  AssertionStatus,
  BuildConclusion,
  GameTestReport
} from '../../../shared/types/agent'
import { readPngSize } from '../../templates/pngGenerator'

// ---------------------------------------------------------------------------
// 路径校验（与 orchestrator.validateFileChanges 同款规则）
// ---------------------------------------------------------------------------

/**
 * 校验 expected 路径是否为相对项目根的合法 POSIX 路径。
 * 返回 null 表示合法；返回字符串为拒绝原因。
 */
function rejectPath(posixPath: string): string | null {
  if (!posixPath) return '路径为空'
  if (/^[a-zA-Z]:/.test(posixPath)) return '拒绝绝对路径（盘符）'
  if (isAbsolute(posixPath)) return '拒绝绝对路径'
  if (posixPath.split('/').some((seg) => seg === '..')) return '路径包含 .. 越界段'
  return null
}

/** 解析相对项目根的 POSIX 路径为绝对路径；非法返回 null。 */
function safeResolve(projectPath: string | null, posixPath: string): { abs: string; reason: null } | { abs: null; reason: string } {
  const reason = rejectPath(posixPath)
  if (reason) return { abs: null, reason }
  if (!projectPath) return { abs: null, reason: '无打开项目，跳过' }
  const root = resolve(projectPath)
  const abs = resolve(root, posixPath)
  const inside = abs === root || abs.startsWith(root + sep)
  if (!inside) return { abs: null, reason: '目标路径逃逸项目根' }
  return { abs, reason: null }
}

// ---------------------------------------------------------------------------
// parseContract：从 LLM JSON 防御性解析
// ---------------------------------------------------------------------------

const VALID_KINDS: AssertionKind[] = [
  'file-exists',
  'registry-entry',
  'build-pass',
  'texture-ready',
  'gametest-runtime',
  'user-confirmation',
  'runtime-world',
  'runtime-inventory'
]

/** 注册名（方块/物品）校验：命名空间可选，缺省补 minecraft: */
const REGISTRY_ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/

/** 归一化注册名（小写 + 补默认命名空间），供真机读取比对与 parse 校验共用。 */
export function normalizeRegistryId(raw: string): string {
  const trimmed = raw.trim().toLowerCase()
  return trimmed.includes(':') ? trimmed : `minecraft:${trimmed}`
}

/** 注册名是否合法（方块/物品）。 */
export function isValidRegistryId(raw: string): boolean {
  return REGISTRY_ID_PATTERN.test(normalizeRegistryId(raw))
}

/**
 * 从 LLM 输出的 contract 字段（未知结构）解析并归一化。
 * - 缺 contract 字段或 assertions 非数组 → 返回 null（不产契约，不影响主流程）
 * - 非法 kind 标 fail+reason
 * - 路径非法标 fail+reason（评估阶段会再次校验）
 * - 缺 id 自动补 `${kind}-${i}`
 * - 整体标 pending（待后续 evaluate* 更新）
 */
export function parseContract(raw: unknown): AcceptanceContract | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const assertionsRaw = obj['assertions']
  if (!Array.isArray(assertionsRaw) || assertionsRaw.length === 0) return null

  const assertions: AcceptanceAssertion[] = []
  const usedIds = new Set<string>()
  assertionsRaw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const a = item as Record<string, unknown>
    const kind = typeof a['kind'] === 'string' ? (a['kind'] as string) : ''
    const validKind = VALID_KINDS.includes(kind as AssertionKind) ? (kind as AssertionKind) : null

    const description = typeof a['description'] === 'string' ? a['description'] : ''
    const expected = typeof a['expected'] === 'string' ? a['expected'] : ''
    const expectedSize = typeof a['expectedSize'] === 'string' ? a['expectedSize'] : undefined
    const min = typeof a['min'] === 'number' && a['min'] > 0 ? a['min'] : undefined
    const regex = typeof a['regex'] === 'string' ? a['regex'] : undefined
    // 真机断言坐标（整数方块坐标）
    const x = typeof a['x'] === 'number' && Number.isFinite(a['x']) ? Math.trunc(a['x']) : undefined
    const y = typeof a['y'] === 'number' && Number.isFinite(a['y']) ? Math.trunc(a['y']) : undefined
    const z = typeof a['z'] === 'number' && Number.isFinite(a['z']) ? Math.trunc(a['z']) : undefined
    const rawId = typeof a['id'] === 'string' && a['id'] ? a['id'] : `${kind || 'unknown'}-${i}`
    // id 必须全局唯一：mergeAssertions 按 id 覆盖，重复 id 会让后一个 patch 项
    // 洗白前一个（把 failed 覆盖成 verified）。冲突时追加递增后缀。
    let id = rawId
    let suffix = 0
    while (usedIds.has(id)) {
      suffix += 1
      id = `${rawId}-${suffix}`
    }
    usedIds.add(id)

    if (!validKind) {
      assertions.push({
        id,
        kind: 'file-exists', // 占位，整体 fail
        description: description || `未知断言类型 ${kind}`,
        expected,
        expectedSize,
        min,
        regex,
        status: 'failed',
        reason: `未知 kind: ${kind || '(空)'}`
      })
      return
    }

    // 真机断言（runtime-world / runtime-inventory）结构校验——
    // expected 必须是合法注册名；runtime-world 还必须带整数坐标 x/y/z。
    if (validKind === 'runtime-world' || validKind === 'runtime-inventory') {
      if (!isValidRegistryId(expected)) {
        assertions.push({
          id,
          kind: validKind,
          description: description || `${validKind} 断言`,
          expected,
          x,
          y,
          z,
          status: 'failed',
          reason: `期望值不是合法注册名：${expected || '(空)'}`
        })
        return
      }
      if (validKind === 'runtime-world' && (x === undefined || y === undefined || z === undefined)) {
        assertions.push({
          id,
          kind: validKind,
          description: description || `${validKind} 断言`,
          expected,
          status: 'failed',
          reason: 'runtime-world 需要整数坐标 x / y / z'
        })
        return
      }
    }

    // build-pass / gametest-runtime / user-confirmation / runtime-* 不校验路径：
    // 前两者 expected 是测试方法名/空；user-confirmation 的 expected 是给人看的核对点描述；
    // runtime-* 的 expected 是注册名（坐标另存 x/y/z）
    if (
      validKind !== 'build-pass' &&
      validKind !== 'gametest-runtime' &&
      validKind !== 'user-confirmation' &&
      validKind !== 'runtime-world' &&
      validKind !== 'runtime-inventory'
    ) {
      const pathReason = rejectPath(expected)
      if (pathReason) {
        assertions.push({
          id,
          kind: validKind,
          description: description || `${validKind} 断言`,
          expected,
          expectedSize,
          min,
          regex,
          status: 'failed',
          reason: pathReason
        })
        return
      }
    }

    assertions.push({
      id,
      kind: validKind,
      description: description || `${validKind} 断言`,
      expected,
      expectedSize,
      min,
      regex,
      x,
      y,
      z,
      status: 'pending'
    })
  })

  if (assertions.length === 0) return null
  return {
    overall: 'pending',
    assertions,
    summary: `待评估 ${assertions.length} 项断言`
  }
}

// ---------------------------------------------------------------------------
// 各类断言评估（纯函数，仅 evaluateTextureReady 读盘）
// ---------------------------------------------------------------------------

/**
 * 评估 file-exists 断言：检查相对项目根的路径是否存在。
 * - 无项目 → unverified
 * - 文件存在 → verified（附 file 证据）
 * - 不存在 → failed+actual='不存在'
 */
export function evaluateFileExists(
  projectPath: string | null,
  a: AcceptanceAssertion
): AcceptanceAssertion {
  if (!projectPath) {
    return { ...a, status: 'unverified', reason: '无打开项目' }
  }
  const r = safeResolve(projectPath, a.expected)
  if (r.abs === null) {
    return { ...a, status: 'failed', actual: '路径非法', reason: r.reason }
  }
  if (!existsSync(r.abs)) {
    return { ...a, status: 'failed', actual: '不存在', reason: `文件未找到：${a.expected}` }
  }
  return {
    ...a,
    status: 'verified',
    actual: '存在',
    evidence: { type: 'file', path: r.abs, timestamp: new Date().toISOString() }
  }
}

/**
 * 评估 texture-ready 断言：文件存在 + 是合法 PNG + 可选尺寸对照。
 * - expectedSize 缺省 → 仅校验是合法 PNG
 * - 尺寸不符 → failed+actual=`${w}x${h}`
 */
export function evaluateTextureReady(
  projectPath: string | null,
  a: AcceptanceAssertion
): AcceptanceAssertion {
  if (!projectPath) {
    return { ...a, status: 'unverified', reason: '无打开项目' }
  }
  const r = safeResolve(projectPath, a.expected)
  if (r.abs === null) {
    return { ...a, status: 'failed', actual: '路径非法', reason: r.reason }
  }
  if (!existsSync(r.abs)) {
    return { ...a, status: 'failed', actual: '不存在', reason: `贴图未找到：${a.expected}` }
  }
  const size = readPngSize(r.abs)
  if (!size) {
    return { ...a, status: 'failed', actual: '非合法 PNG', reason: '文件不是 PNG 或已损坏' }
  }
  const actualStr = `${size.w}x${size.h}`
  if (a.expectedSize && a.expectedSize !== actualStr) {
    return {
      ...a,
      status: 'failed',
      actual: actualStr,
      reason: `尺寸不符期望 ${a.expectedSize}`
    }
  }
  return {
    ...a,
    status: 'verified',
    actual: actualStr,
    evidence: { type: 'file', path: r.abs, timestamp: new Date().toISOString() }
  }
}

/**
 * 评估 build-pass 断言：直接读 BuildConclusion.status。
 * - build=null/skipped → unverified
 * - build.status=pass → verified（附 command+exitCode 证据）
 * - build.status=fail → failed+reason=summary（附 command+exitCode 证据）
 */
export function evaluateBuildPass(
  a: AcceptanceAssertion,
  build: BuildConclusion | null
): AcceptanceAssertion {
  if (!build || build.status === 'skipped') {
    return { ...a, status: 'unverified', reason: build ? '构建阶段跳过' : '尚未构建' }
  }
  const evidence: AcceptanceAssertion['evidence'] = {
    type: 'command',
    command: 'gradlew clean build',
    exitCode: build.exitCode ?? undefined,
    timestamp: new Date().toISOString()
  }
  if (build.status === 'pass') {
    return { ...a, status: 'verified', actual: `通过（${build.rounds} 轮）`, evidence }
  }
  return {
    ...a,
    status: 'failed',
    actual: `失败（${build.rounds} 轮）`,
    reason: build.summary,
    evidence
  }
}

/**
 * 评估 registry-entry 断言：读 expected 路径文件文本，按 regex 计 match.length。
 * - 无 min/regex → 等同 file-exists
 * - 匹配次数 ≥ min → pass
 * - 不足 → fail+actual=`匹配 N 次`
 * 纯静态，不触真机探针。
 */
export function evaluateRegistryEntry(
  projectPath: string | null,
  a: AcceptanceAssertion
): AcceptanceAssertion {
  if (!projectPath) {
    return { ...a, status: 'unverified', reason: '无打开项目' }
  }
  const r = safeResolve(projectPath, a.expected)
  if (r.abs === null) {
    return { ...a, status: 'failed', actual: '路径非法', reason: r.reason }
  }
  if (!existsSync(r.abs)) {
    return { ...a, status: 'failed', actual: '不存在', reason: `注册类文件未找到：${a.expected}` }
  }
  const fileEvidence: AcceptanceAssertion['evidence'] = {
    type: 'file',
    path: r.abs,
    timestamp: new Date().toISOString()
  }
  // 无 min/regex：等同 file-exists（仅校验文件存在）
  if (!a.regex && a.min === undefined) {
    return { ...a, status: 'verified', actual: '存在', evidence: fileEvidence }
  }
  let text: string
  try {
    text = readFileSync(r.abs, 'utf8')
  } catch (err) {
    return { ...a, status: 'failed', actual: '读取失败', reason: (err as Error).message }
  }
  let re: RegExp
  try {
    re = a.regex ? new RegExp(a.regex, 'g') : /.+/g
  } catch (err) {
    return { ...a, status: 'failed', actual: '正则非法', reason: (err as Error).message }
  }
  const matches = text.match(re)
  const count = matches ? matches.length : 0
  const min = a.min ?? 1
  if (count >= min) {
    return { ...a, status: 'verified', actual: `匹配 ${count} 次`, evidence: fileEvidence }
  }
  return {
    ...a,
    status: 'failed',
    actual: `匹配 ${count} 次`,
    reason: `期望至少 ${min} 次匹配，实际 ${count} 次`
  }
}

// ---------------------------------------------------------------------------
// 合并与摘要
// ---------------------------------------------------------------------------

/**
 * 把新评估结果按 id 合并回 base contract：
 * - 同 id 替换；不在 patch 中的断言保留原状（含 pending）
 * - 重算 overall：全 verified→verified；任一 failed→failed；含 pending/awaiting→pending；否则 unverified
 */
export function mergeAssertions(
  base: AcceptanceContract,
  patch: AcceptanceAssertion[]
): AcceptanceContract {
  const patchMap = new Map(patch.map((p) => [p.id, p]))
  const merged = base.assertions.map((a) => patchMap.get(a.id) ?? a)
  return { ...base, assertions: merged, summary: '' }
}

/** 状态归一（历史数据 pass/fail/skipped → verified/failed/unverified） */
function isVerified(s: AssertionStatus): boolean {
  return s === 'verified' || s === 'pass'
}
function isFailed(s: AssertionStatus): boolean {
  return s === 'failed' || s === 'fail'
}
function isUnverified(s: AssertionStatus): boolean {
  return s === 'unverified' || s === 'skipped'
}

/** 重算整体结论 + 拼中文摘要（如"验收 3/4 通过，1 项未验证"）。 */
export function summarizeContract(c: AcceptanceContract): AcceptanceContract {
  const total = c.assertions.length
  const pass = c.assertions.filter((a) => isVerified(a.status)).length
  const fail = c.assertions.filter((a) => isFailed(a.status)).length
  const unverified = c.assertions.filter((a) => isUnverified(a.status)).length
  const pending = c.assertions.filter((a) => a.status === 'pending').length
  const awaiting = c.assertions.filter((a) => a.status === 'awaiting-user').length

  let overall: AssertionStatus
  if (fail > 0) overall = 'failed'
  else if (pending > 0 || awaiting > 0) overall = 'pending'
  else if (pass === total) overall = 'verified'
  else overall = 'unverified'

  const parts: string[] = [`验收 ${pass}/${total} 通过`]
  if (fail > 0) parts.push(`${fail} 项失败`)
  if (awaiting > 0) parts.push(`${awaiting} 项待人工看截图确认`)
  if (unverified > 0) parts.push(`${unverified} 项未验证`)
  if (pending > 0) parts.push(`${pending} 项待评`)
  const summary = parts.join('，')

  return { ...c, overall, summary }
}

/**
 * 在 generate 后立即评估①④（file-exists + texture-ready）。
 * 其余 kind（registry-entry/build-pass）保持 pending，待后续阶段填值。
 */
export function evaluateAfterGenerate(
  projectPath: string | null,
  contract: AcceptanceContract
): AcceptanceContract {
  const patch: AcceptanceAssertion[] = []
  for (const a of contract.assertions) {
    if (a.status !== 'pending') continue
    if (a.kind === 'file-exists') {
      patch.push(evaluateFileExists(projectPath, a))
    } else if (a.kind === 'texture-ready') {
      patch.push(evaluateTextureReady(projectPath, a))
    }
  }
  return summarizeContract(mergeAssertions(contract, patch))
}

/**
 * 在 build 后评估③（build-pass）。
 */
export function evaluateAfterBuild(
  contract: AcceptanceContract,
  build: BuildConclusion | null
): AcceptanceContract {
  const patch: AcceptanceAssertion[] = []
  for (const a of contract.assertions) {
    if (a.kind === 'build-pass' && a.status === 'pending') {
      patch.push(evaluateBuildPass(a, build))
    }
  }
  return summarizeContract(mergeAssertions(contract, patch))
}

/**
 * 在 test 后评估②（registry-entry）。纯静态校验，不触真机探针。
 */
export function evaluateAfterTest(
  projectPath: string | null,
  contract: AcceptanceContract
): AcceptanceContract {
  const patch: AcceptanceAssertion[] = []
  for (const a of contract.assertions) {
    if (a.kind === 'registry-entry' && a.status === 'pending') {
      patch.push(evaluateRegistryEntry(projectPath, a))
    }
  }
  return summarizeContract(mergeAssertions(contract, patch))
}

/**
 * 评估 gametest-runtime 断言：根据 GameTest 报告判定 verified/failed/unverified。
 * - expected（测试方法名）∈ report.passed → verified+actual='通过'
 * - expected ∈ report.failed → failed+reason=错误摘要
 * - report.status='skipped'（未跑/无测试）→ unverified+reason
 * - 否则（report.passed 与 failed 均不含 expected）→ unverified+'GameTest 未覆盖此方法'
 *
 * 与 registry-entry 的纯静态校验互补：gametest-runtime 走真实运行时内省。
 */
export function evaluateGameTestRuntime(
  report: GameTestReport | null,
  a: AcceptanceAssertion
): AcceptanceAssertion {
  if (!report || report.status === 'skipped') {
    return {
      ...a,
      status: 'unverified',
      reason: report ? 'GameTest 未运行' : '无 GameTest 报告'
    }
  }
  const expected = a.expected
  if (report.passed.includes(expected)) {
    return { ...a, status: 'verified', actual: '通过' }
  }
  const failEntry = report.failed.find((f) => f.name === expected)
  if (failEntry) {
    return {
      ...a,
      status: 'failed',
      actual: '失败',
      reason: failEntry.error || 'GameTest 失败（无详细原因）'
    }
  }
  return {
    ...a,
    status: 'unverified',
    actual: '未覆盖',
    reason: `GameTest 未覆盖方法 ${expected}（确认测试 id 与 contract expected 一致）`
  }
}

/**
 * 在 GameTest 跑完后评估⑤（gametest-runtime）。
 * - report=null（未跑 GameTest）→ 所有 gametest-runtime 断言标 skipped
 * - 仅评估 status='pending' 的断言；已评估的保留原状
 */
export function evaluateAfterGameTest(
  report: GameTestReport | null,
  contract: AcceptanceContract
): AcceptanceContract {
  const patch: AcceptanceAssertion[] = []
  for (const a of contract.assertions) {
    if (a.kind === 'gametest-runtime' && a.status === 'pending') {
      patch.push(evaluateGameTestRuntime(report, a))
    }
  }
  return summarizeContract(mergeAssertions(contract, patch))
}

/**
 * 评估 user-confirmation 断言（第三类 oracle：人工看真机截图）。
 *
 * 视觉效果（"看起来像红宝石""GUI 排版正常"）无法由静态检查或 GameTest 判定，
 * 因此拿到真机截图后置为 awaiting-user（不是 pass，AI 不给自己的视觉效果背书），
 * 由用户在验收卡片里对照截图人工确认；观察通道离线、没有截图时标 unverified。
 */
export function evaluateUserConfirmation(
  a: AcceptanceAssertion,
  screenshotPath: string | null
): AcceptanceAssertion {
  if (!screenshotPath) {
    return {
      ...a,
      status: 'unverified',
      reason: '未取得真机截图：以 kunyu-observer-agent 探针启动游戏并进入世界后重跑测试'
    }
  }
  return {
    ...a,
    status: 'awaiting-user',
    actual: '待人工核对',
    evidencePath: screenshotPath,
    evidence: { type: 'screenshot', path: screenshotPath, timestamp: new Date().toISOString() },
    reason: undefined
  }
}

/**
 * 真机探针（GameTest / kunyu-observer）拿到截图后，
 * 把所有 pending 的 user-confirmation 断言置为 awaiting-user 并附带证据路径。
 */
export function evaluateAfterRuntimeScreenshot(
  contract: AcceptanceContract,
  screenshotPath: string | null
): AcceptanceContract {
  const patch: AcceptanceAssertion[] = []
  for (const a of contract.assertions) {
    if (a.kind === 'user-confirmation' && a.status === 'pending') {
      patch.push(evaluateUserConfirmation(a, screenshotPath))
    }
  }
  return summarizeContract(mergeAssertions(contract, patch))
}

/** 契约里是否还有待人工确认（或未评估）的 user-confirmation 断言。 */
export function hasPendingUserConfirmation(contract: AcceptanceContract): boolean {
  return contract.assertions.some(
    (a) => a.kind === 'user-confirmation' && (a.status === 'pending' || a.status === 'awaiting-user')
  )
}

// ---------------------------------------------------------------------------
// 真机断言评估（代码读取运行中游戏后判定，非模型自述）
// ---------------------------------------------------------------------------

/**
 * 评估 runtime-world 断言：代码读取指定坐标的方块并比对上期望注册名。
 * - reading=null（观察通道离线/未进世界）→ unverified（不是「没问题」）
 * - 相符 → verified（附 command 证据）
 * - 不符 → failed + actual + reason
 */
export function evaluateRuntimeWorld(
  a: AcceptanceAssertion,
  reading: { block: string } | null
): AcceptanceAssertion {
  if (!reading) {
    return { ...a, status: 'unverified', reason: '真机观察通道离线或玩家未进入世界，未能读取方块' }
  }
  const want = normalizeRegistryId(a.expected)
  const got = normalizeRegistryId(reading.block)
  const evidence: AcceptanceAssertion['evidence'] = {
    type: 'command',
    command: `mc_world get_block ${a.x} ${a.y} ${a.z}`,
    timestamp: new Date().toISOString()
  }
  if (got === want) {
    return { ...a, status: 'verified', actual: got, evidence }
  }
  return {
    ...a,
    status: 'failed',
    actual: got,
    reason: `坐标 (${a.x},${a.y},${a.z}) 期望 ${want}，实际 ${got}`,
    evidence
  }
}

/**
 * 评估 runtime-inventory 断言：代码读取玩家背包并比对期望物品注册名（只读）。
 * - ids=null（离线/未进世界）→ unverified
 * - 背包内含期望物品 → verified；否则 → failed
 */
export function evaluateRuntimeInventory(
  a: AcceptanceAssertion,
  ids: string[] | null
): AcceptanceAssertion {
  if (!ids) {
    return { ...a, status: 'unverified', reason: '真机观察通道离线或玩家未进入世界，未能读取背包' }
  }
  const want = normalizeRegistryId(a.expected)
  const hit = ids.map(normalizeRegistryId).includes(want)
  const evidence: AcceptanceAssertion['evidence'] = {
    type: 'command',
    command: 'mc_inventory',
    timestamp: new Date().toISOString()
  }
  if (hit) {
    return { ...a, status: 'verified', actual: `背包内存在 ${want}`, evidence }
  }
  return {
    ...a,
    status: 'failed',
    actual: '背包内未找到',
    reason: `背包中未找到 ${want}`,
    evidence
  }
}

/** 契约里是否还有待真机读取判定的 runtime-* 断言（pending）。 */
export function hasPendingRuntimeAssertion(contract: AcceptanceContract): boolean {
  return contract.assertions.some(
    (a) => (a.kind === 'runtime-world' || a.kind === 'runtime-inventory') && a.status === 'pending'
  )
}

// ---------------------------------------------------------------------------
// 工厂：buildContractArtifact（类比 orchestrator.buildArtifact）
// ---------------------------------------------------------------------------

/** 构造 contract artifact，类比 orchestrator.ts#buildArtifact。 */
export function buildContractArtifact(id: string, contract: AcceptanceContract): AgentArtifact {
  const overall = contract.overall
  const label =
    overall === 'verified' || overall === 'pass'
      ? `验收通过（${contract.assertions.length} 项）`
      : overall === 'failed' || overall === 'fail'
        ? `验收未通过`
        : overall === 'unverified' || overall === 'skipped'
          ? '部分未验证'
          : '验收进行中'
  return {
    id,
    kind: 'contract',
    title: label,
    contract,
    body: contract.summary
  }
}
