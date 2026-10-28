/**
 * dsh-pet 版本门禁（纯函数，零依赖，便于单测）。
 *
 * 背景：坤宇不 fork、不改原作，适配层（dsh-pet-kunyu/lib）依赖原装 dsh-pet 的
 * 一组内部约定——伪 ctx 形状、session/event 帧、helper 路径、config.jsonc 结构。
 * 上游跨 minor 改约定时适配层会断，因此对"经过验证的版本档"做显式标注：
 *
 * - verified（当前 0.3.x）：适配验证档，承诺可用；
 * - unverified（更新版本 / 版本号无法识别）：不阻断，允许尝试，但给用户明确警告；
 * - unsupported（低于 0.3.0）：接口大概率缺失，startPet 硬阻断并给可读原因。
 *
 * 0.x 语义化版本约定下，^0.3.0 === >=0.3.0 <0.4.0，故验证档上界取 0.4.0（不含）。
 * 上游发布 0.4.0 并完成适配验证后，只需抬升 VERIFIED_PET_MAX_EXCLUSIVE。
 */
import type { DshPetCompatLevel } from '../../../shared/types/dsh'

/** 适配验证档的人类可读标注（直接拼进用户文案） */
export const VERIFIED_PET_VERSION_LABEL = '0.3.x'

/** 最低适配版本（低于此硬阻断） */
export const MIN_PET_VERSION = { major: 0, minor: 3, patch: 0 } as const

/** 验证档上界（不含）：当前 0.3.x → 0.4.0 */
export const VERIFIED_PET_MAX_EXCLUSIVE = { major: 0, minor: 4, patch: 0 } as const

export interface PetCompatResult {
  level: DshPetCompatLevel
  /** 非 verified 时直接展示的中文说明；verified 为空串 */
  message: string
}

export interface SemVer {
  major: number
  minor: number
  patch: number
}

/** 从宽松版本串（'0.3.6' / 'v0.3.6' / '0.4.0-beta.1'）提取三段数字；失败返回 null */
export function parseSemVer(raw: string | null | undefined): SemVer | null {
  if (!raw) return null
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw.trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/** 三段版本比较：a<b → -1；a===b → 0；a>b → 1 */
export function compareSemVer(a: SemVer, b: SemVer): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return 0
}

/**
 * 判定已安装的 dsh-pet 版本相对适配验证档的兼容性。
 * 版本读不到（null/损坏/非三段式）时按 unverified 放行——
 * 安装器已有完整性校验，此处不因版本元数据缺失而阻断既有行为。
 */
export function checkPetVersion(rawVersion: string | null | undefined): PetCompatResult {
  const v = parseSemVer(rawVersion)
  const display = rawVersion && rawVersion.trim() ? rawVersion.trim() : '未知版本'
  if (!v) {
    return {
      level: 'unverified',
      message: `dsh-pet 版本号无法识别（${display}），尚未经过坤宇适配验证（当前验证档 ${VERIFIED_PET_VERSION_LABEL}）：可尝试启动，但物理窗口、碎碎念等功能可能异常。`
    }
  }
  if (compareSemVer(v, MIN_PET_VERSION) < 0) {
    const min = `${MIN_PET_VERSION.major}.${MIN_PET_VERSION.minor}.${MIN_PET_VERSION.patch}`
    return {
      level: 'unsupported',
      message: `dsh-pet v${display} 版本过低：坤宇适配层仅适配 ${VERIFIED_PET_VERSION_LABEL}（最低 ${min}），已阻止启动。请卸载当前版本后安装 ${VERIFIED_PET_VERSION_LABEL} 版本。`
    }
  }
  if (compareSemVer(v, VERIFIED_PET_MAX_EXCLUSIVE) >= 0) {
    return {
      level: 'unverified',
      message: `dsh-pet v${display} 尚未经过坤宇适配验证（当前验证档 ${VERIFIED_PET_VERSION_LABEL}）：可尝试启动，但物理窗口、碎碎念等功能可能异常。`
    }
  }
  return { level: 'verified', message: '' }
}
