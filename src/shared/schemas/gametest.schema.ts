/**
 * 特性④ GameTest 无头测试语义结构（沙箱的 Arrange → Act → Assert）。
 *
 * 用户在 .kunyu/content/gametest/*.json 用结构化 JSON 编排测试步骤，
 * 由 gameTestGenerator 转换为 Fabric 1.20.1 Yarn 映射的 GameTest .java 类。
 * runGameTestServer 无头运行，结果回填给 AcceptanceContract 的
 * gametest-runtime 断言做动态注册表内省。
 *
 * 安全边界：
 * - id 必须 snake_case + 唯一（生成 Java 方法名 test_<id>，注册结构 <id>.nbt）
 * - pos 三轴整数 0..size-1（防御手编 JSON 越界，归一化时 clamp）
 * - action 枚举严格校验，未知值在 normalize 时降级为 'groovy' 并附 reason
 */
import { validateContentId } from '../types/content'
import { sharedT } from '../i18n'

/** 测试步骤阶段 */
export type GameTestPhase = 'arrange' | 'act' | 'assert'

/** 步骤动作类型；groovy 在 GameTest 中转译为静态调用占位 */
export type GameTestActionKind =
  | 'place-block'
  | 'summon-entity'
  | 'use-item'
  | 'delay'
  | 'assert-block'
  | 'assert-entity'
  | 'groovy'

/** 单步：name/phase/action 必填，pos/args 按动作类型选填 */
export interface GameTestStep {
  name: string
  phase: GameTestPhase
  action: GameTestActionKind
  /** 相对结构原点的方块坐标 [x, y, z]，0..size-1 */
  pos?: [number, number, number]
  /** 动作参数：方块/物品/实体 id、delay ticks、groovy 脚本 等 */
  args?: Record<string, unknown>
}

/** 运行时断言（与 AcceptanceContract 的 gametest-runtime 对应） */
export interface GameTestAssertion {
  kind: 'registry-contains' | 'nbt-matches' | 'entity-attribute' | 'groovy'
  expected: string
  min?: number
  regex?: string
}

/** GameTest 语义结构 */
export interface GameTestSchema {
  kind: 'gametest'
  /** snake_case，生成方法名 test_<id> 与结构文件 <id>.nbt */
  id: string
  displayName: string
  description: string
  /** 结构尺寸 [x, y, z]，默认 [5, 5, 5] */
  size?: [number, number, number]
  /** 超时 ticks，默认 200 */
  timeoutTicks?: number
  steps: GameTestStep[]
  /** 关联的运行时断言（与 contract gametest-runtime 对应） */
  assertions?: GameTestAssertion[]
  createdAt: number
  updatedAt: number
}

export const GAME_TEST_DEFAULT_SIZE: [number, number, number] = [3, 3, 3]
export const GAME_TEST_DEFAULT_TIMEOUT_TICKS = 200

/**
 * 生成器固定使用 fabric 内置 `fabric:empty_3x3_3` 模板（无需手编 .nbt），
 * 步骤内 pos 三轴合法范围 0..2；schema.size 仅作为元数据，不影响模板。
 * 后续如需自定义结构，可扩展为生成 .nbt + 自定义 template 名。
 */
export const GAME_TEST_TEMPLATE = 'fabric:empty_3x3_3'

const GAMETEST_ID_RE = /^[a-z][a-z0-9_]*$/

/** 校验 GameTest id：snake_case，与 validateContentId 同口径 */
export function validateGameTestId(id: string): boolean {
  return GAMETEST_ID_RE.test(id) && id.length <= 64
}

/** 校验 ContentId 兼容调用（与 texture.schema 同名导出冲突避免） */
export { validateContentId }

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

function clampPos(
  pos: unknown,
  size: [number, number, number]
): [number, number, number] | undefined {
  if (!Array.isArray(pos) || pos.length !== 3) return undefined
  const [x, y, z] = pos
  return [
    clampInt(x, 0, size[0] - 1, 0),
    clampInt(y, 0, size[1] - 1, 0),
    clampInt(z, 0, size[2] - 1, 0)
  ]
}

const VALID_PHASES: GameTestPhase[] = ['arrange', 'act', 'assert']
const VALID_ACTIONS: GameTestActionKind[] = [
  'place-block',
  'summon-entity',
  'use-item',
  'delay',
  'assert-block',
  'assert-entity',
  'groovy'
]
const VALID_ASSERTION_KINDS: GameTestAssertion['kind'][] = [
  'registry-contains',
  'nbt-matches',
  'entity-attribute',
  'groovy'
]

/** 新建默认 GameTest（空 5x5x5 结构 + 1 个示例 assert 步骤） */
export function createDefaultGameTest(id: string): GameTestSchema {
  const now = Date.now()
  return {
    kind: 'gametest',
    id: id || 'new_test',
    displayName: id || sharedT('schema.gametest.newTest'),
    description: '',
    size: [...GAME_TEST_DEFAULT_SIZE] as [number, number, number],
    timeoutTicks: GAME_TEST_DEFAULT_TIMEOUT_TICKS,
    steps: [
      {
        name: sharedT('schema.gametest.placeBlock'),
        phase: 'arrange',
        action: 'place-block',
        pos: [0, 0, 0],
        args: { block: 'minecraft:stone' }
      },
      {
        name: sharedT('schema.gametest.assertBlock'),
        phase: 'assert',
        action: 'assert-block',
        pos: [0, 0, 0],
        args: { block: 'minecraft:stone' }
      }
    ],
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 存盘前规范化：size/timeoutTicks/pos clamp 到合法范围，
 * 未知 phase/action 降级为 'assert'/'groovy'，args 缺失补空对象。
 * 防御手编 JSON 越界。
 */
export function normalizeGameTestSchema(def: GameTestSchema): GameTestSchema {
  const size: [number, number, number] = Array.isArray(def.size) && def.size.length === 3
    ? [
        clampInt(def.size[0], 1, 32, 3),
        clampInt(def.size[1], 1, 32, 3),
        clampInt(def.size[2], 1, 32, 3)
      ]
    : [...GAME_TEST_DEFAULT_SIZE]

  const timeoutTicks = clampInt(def.timeoutTicks, 1, 6000, GAME_TEST_DEFAULT_TIMEOUT_TICKS)

  const steps: GameTestStep[] = Array.isArray(def.steps)
    ? def.steps.map((s) => normalizeStep(s, size))
    : []

  const assertions: GameTestAssertion[] = Array.isArray(def.assertions)
    ? def.assertions
        .filter((a) => a && VALID_ASSERTION_KINDS.includes(a.kind))
        .map((a) => ({
          kind: a.kind,
          expected: typeof a.expected === 'string' ? a.expected : '',
          min: typeof a.min === 'number' && a.min > 0 ? a.min : undefined,
          regex: typeof a.regex === 'string' && a.regex ? a.regex : undefined
        }))
    : []

  return {
    kind: 'gametest',
    id: def.id,
    displayName: typeof def.displayName === 'string' ? def.displayName : '',
    description: typeof def.description === 'string' ? def.description : '',
    size,
    timeoutTicks,
    steps,
    assertions: assertions.length > 0 ? assertions : undefined,
    createdAt: typeof def.createdAt === 'number' ? def.createdAt : Date.now(),
    updatedAt: Date.now()
  }
}

function normalizeStep(s: GameTestStep, size: [number, number, number]): GameTestStep {
  const phase: GameTestPhase = VALID_PHASES.includes(s.phase) ? s.phase : 'assert'
  const action: GameTestActionKind = VALID_ACTIONS.includes(s.action) ? s.action : 'groovy'
  return {
    name: typeof s.name === 'string' ? s.name : '',
    phase,
    action,
    pos: clampPos(s.pos, size),
    args: s.args && typeof s.args === 'object' ? { ...s.args } : undefined
  }
}

/** 校验；返回错误消息，合法返回 null */
export function validateGameTestSchema(def: GameTestSchema): string | null {
  if (!validateGameTestId(def.id)) {
    return sharedT('schema.gametest.errIdInvalid')
  }
  if (!(def.displayName || '').trim()) {
    return sharedT('schema.common.errDisplayNamePlain')
  }
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    return sharedT('schema.gametest.errStepsRequired')
  }
  for (let i = 0; i < def.steps.length; i++) {
    const s = def.steps[i]
    if (!s || typeof s.name !== 'string' || !s.name.trim()) {
      return sharedT('schema.gametest.errStepName', { i: i + 1 })
    }
    if (!VALID_PHASES.includes(s.phase)) {
      return sharedT('schema.gametest.errStepPhase', { i: i + 1, v: s.phase })
    }
    if (!VALID_ACTIONS.includes(s.action)) {
      return sharedT('schema.gametest.errStepAction', { i: i + 1, v: s.action })
    }
  }
  return null
}

/**
 * 防御性解析磁盘 JSON（未知结构）为 GameTestSchema。
 * - 非 object / kind !== 'gametest' → null
 * - 字段非法时调 normalize 兜底，validate 决定是否接受
 * 返回 { ok, def, error }
 */
export function parseGameTestDoc(raw: unknown): {
  ok: boolean
  def: GameTestSchema | null
  error: string | null
} {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, def: null, error: sharedT('schema.gametest.errDocNotObject') }
  }
  const r = raw as Record<string, unknown>
  if (r['kind'] !== 'gametest') {
    return { ok: false, def: null, error: 'kind !== gametest' }
  }
  const def = normalizeGameTestSchema(r as unknown as GameTestSchema)
  const error = validateGameTestSchema(def)
  return { ok: error === null, def: error === null ? def : null, error }
}
