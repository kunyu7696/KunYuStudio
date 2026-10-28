/**
 * 一键优化安全动作执行器。
 *
 * 安全红线：
 * - 只做三类操作：disable（jar → jar.disabled 改名）、remove（删除，确认后）、config（写配置文件）
 * - 所有目标必须解析到指定根目录之内，拒绝绝对路径与 `..` 越界
 * - 绝不修改第三方 jar 内容：disable/remove 只改名字/删文件；config 只允许写配置类扩展名
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'

import type {
  ActionReceipt,
  PlannedAction,
  ReceiptStatus,
  SafeActionKind
} from '../../../shared/schemas/performance/profile'

export type { ActionReceipt, PlannedAction, ReceiptStatus, SafeActionKind }

/** 允许写配置的扩展名（白名单）；jar / class 等永远不可写 */
const CONFIG_EXTENSIONS = new Set(['.json', '.properties', '.txt', '.toml', '.cfg', '.conf', '.ini'])

const DISABLED_SUFFIX = '.disabled'

export interface ResolveOk {
  ok: true
  path: string
}
export interface ResolveFail {
  ok: false
  reason: string
}

/**
 * 把相对目标安全解析到根目录内。
 * 拒绝：绝对路径、空路径、`..` 越界（normalize 后逃逸到根之外）。
 */
export function resolveInside(root: string, target: string): ResolveOk | ResolveFail {
  const normalizedTarget = target.replace(/[\\/]+$/, '')
  if (!normalizedTarget) return { ok: false, reason: '目标路径为空' }
  if (isAbsolute(normalizedTarget)) {
    return { ok: false, reason: `拒绝绝对路径：${target}` }
  }
  const rootResolved = resolve(root)
  const full = resolve(rootResolved, normalizedTarget)
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
    return { ok: false, reason: `路径越界：${target}` }
  }
  return { ok: true, path: full }
}

/** 影响预览单行（向导在执行前展示，无 IO） */
export interface PreviewLine {
  kind: SafeActionKind
  target: string
  effect: string
}

export function previewActions(actions: PlannedAction[]): PreviewLine[] {
  return actions.map((a) => {
    if (a.kind === 'disable') {
      return { kind: a.kind, target: a.target, effect: `禁用：${a.target} → ${a.target}${DISABLED_SUFFIX}` }
    }
    if (a.kind === 'remove') {
      return { kind: a.kind, target: a.target, effect: `移除：删除 ${a.target}` }
    }
    return {
      kind: a.kind,
      target: a.target,
      effect: `改配置：${a.configKey ?? ''}=${a.configValue ?? ''}（${a.target}）`
    }
  })
}

function disableOne(modsRoot: string, target: string): ActionReceipt {
  if (target.toLowerCase().endsWith(DISABLED_SUFFIX)) {
    return { kind: 'disable', target, status: 'skipped', detail: '目标已是 .disabled，无需操作' }
  }
  const inside = resolveInside(modsRoot, target)
  if (!inside.ok) return { kind: 'disable', target, status: 'rejected', detail: inside.reason }

  const disabledPath = inside.path + DISABLED_SUFFIX
  if (!existsSync(inside.path)) {
    if (existsSync(disabledPath)) {
      return { kind: 'disable', target, status: 'skipped', detail: '模组已处于禁用状态' }
    }
    return { kind: 'disable', target, status: 'rejected', detail: '待禁用文件不存在' }
  }
  if (existsSync(disabledPath)) {
    return { kind: 'disable', target, status: 'rejected', detail: '同名 .disabled 已存在，避免覆盖' }
  }
  renameSync(inside.path, disabledPath)
  return { kind: 'disable', target, status: 'done', detail: `已改名为 ${target}${DISABLED_SUFFIX}` }
}

function removeOne(modsRoot: string, target: string): ActionReceipt {
  const inside = resolveInside(modsRoot, target)
  if (!inside.ok) return { kind: 'remove', target, status: 'rejected', detail: inside.reason }
  if (!existsSync(inside.path)) {
    return { kind: 'remove', target, status: 'skipped', detail: '文件已不存在' }
  }
  rmSync(inside.path, { recursive: false, force: false })
  return { kind: 'remove', target, status: 'done', detail: '已删除' }
}

/** JSON 合并；非 JSON 按 properties 风格 upsert 键行 */
function writeConfigValue(file: string, key: string, rawValue: string): void {
  const lower = file.toLowerCase()
  const isJson = lower.endsWith('.json')
  mkdirSync(dirname(file), { recursive: true })

  if (isJson) {
    let obj: Record<string, unknown> = {}
    if (existsSync(file)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          obj = parsed as Record<string, unknown>
        }
      } catch {
        // 损坏则以空对象重写，保证动作可完成
        obj = {}
      }
    }
    let value: unknown = rawValue
    if (rawValue === 'true') value = true
    else if (rawValue === 'false') value = false
    else if (rawValue !== '' && !Number.isNaN(Number(rawValue))) value = Number(rawValue)
    obj[key] = value
    writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8')
    return
  }

  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : []
  const prefix = `${key}=`
  const replaced = lines.some((line, i, arr) => {
    if (line.startsWith(prefix)) {
      arr[i] = `${key}=${rawValue}`
      return true
    }
    return false
  })
  if (!replaced) lines.push(`${key}=${rawValue}`)
  writeFileSync(file, lines.join('\n'), 'utf8')
}

function configOne(configRoot: string, action: PlannedAction): ActionReceipt {
  const inside = resolveInside(configRoot, action.target)
  if (!inside.ok) {
    return { kind: 'config', target: action.target, status: 'rejected', detail: inside.reason }
  }
  const ext = inside.path.slice(inside.path.lastIndexOf('.')).toLowerCase()
  if (!CONFIG_EXTENSIONS.has(ext)) {
    return { kind: 'config', target: action.target, status: 'rejected', detail: `仅允许写配置文件，拒绝扩展名：${ext}` }
  }
  if (!action.configKey) {
    return { kind: 'config', target: action.target, status: 'rejected', detail: '缺少配置键' }
  }
  writeConfigValue(inside.path, action.configKey, action.configValue ?? '')
  return {
    kind: 'config',
    target: action.target,
    status: 'done',
    detail: `已写入 ${action.configKey}=${action.configValue ?? ''}`
  }
}

/**
 * 顺序执行已确认的动作；单项失败 / 拒绝不影响其他动作。
 * 未传入的动作不会产生任何磁盘变化（向导只提交勾选项）。
 */
export function executeActions(
  modsRoot: string,
  configRoot: string,
  actions: PlannedAction[]
): ActionReceipt[] {
  return actions.map((a) => {
    const base = { adviceId: a.adviceId, target: a.target }
    if (a.kind === 'disable') return { ...base, ...disableOne(modsRoot, a.target) }
    if (a.kind === 'remove') return { ...base, ...removeOne(modsRoot, a.target) }
    return { ...base, ...configOne(configRoot, a) }
  })
}
