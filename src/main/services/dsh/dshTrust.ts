/**
 * DSH 插件信任门控：主进程内加载的**唯一前置闸门**。
 *
 * 插件经 `await import()` 在主进程执行，拥有与本应用相同的系统能力，因此不能"装上就跑"：
 * 1. 首次加载前必须由用户在插件卡片上显式授权；
 * 2. 授权绑定「包内容指纹」（package.json + 入口文件哈希），包被升级/替换后自动失效，
 *    必须重新授权（防止授权后被静默替换成恶意代码）；
 * 3. 授权同时记录插件在 package.json `kunyu.permissions` 中声明的宿主能力，
 *    宿主只注入已授权能力对应的服务；未声明即取不到。
 *
 * 明确边界：这是**知情同意**闸门，不是沙箱。授权后插件仍以主进程完整权限运行，
 * 在进程内无法再收敛其文件/网络/子进程能力。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshPluginsRoot } from './dshCatalog'

/** 插件可声明的宿主能力（与 ctx 服务一一对应） */
export const DSH_PERMISSIONS = ['tools', 'systemPrompt'] as const
export type DshPermission = (typeof DSH_PERMISSIONS)[number]

/** 信任判定结果（对外展示 + 宿主加载判定共用） */
export interface DshTrustSnapshot {
  /** trusted=已授权且包未变；untrusted=从未授权；changed=包内容变更，原授权失效 */
  state: 'trusted' | 'untrusted' | 'changed'
  /** 当前包内容指纹（入口或 package.json 缺失时为 null，必然不可授权） */
  fingerprint: string | null
  /** 插件声明的宿主能力（仅已识别的白名单项） */
  declared: DshPermission[]
  /** 已授权生效的宿主能力（未授权时为空） */
  granted: DshPermission[]
}

interface TrustRecord {
  fingerprint: string
  permissions: DshPermission[]
  approvedAt: number
}

type TrustFile = Record<string, TrustRecord>

function trustFilePath(): string {
  return join(dshPluginsRoot(), 'kunyu.dsh-trust.json')
}

function readTrustFile(): TrustFile {
  const p = trustFilePath()
  if (!existsSync(p)) return {}
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return raw as TrustFile
  } catch {
    // 信任文件损坏 → 视为无任何授权（fail-closed，不静默放行）
    return {}
  }
}

function writeTrustFile(file: TrustFile): void {
  mkdirSync(dshPluginsRoot(), { recursive: true })
  writeFileSync(trustFilePath(), JSON.stringify(file, null, 2), 'utf-8')
}

/** 插件包目录 */
export function pluginPackageDir(npm: string): string {
  return join(dshPluginsRoot(), 'node_modules', ...npm.split('/'))
}

/** 读取插件 package.json（缺失/损坏返回 null） */
function readPluginPkg(npm: string): Record<string, unknown> | null {
  const p = join(pluginPackageDir(npm), 'package.json')
  if (!existsSync(p)) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 解析插件入口（package.json exports['.'] / main，默认 index.js） */
export function entryPathOf(npm: string): string | null {
  const pkg = readPluginPkg(npm)
  if (!pkg) return null
  let entry: string | undefined
  const dot = (pkg['exports'] as Record<string, unknown> | undefined)?.['.']
  if (typeof dot === 'string') entry = dot
  else if (dot && typeof dot === 'object' && 'default' in (dot as Record<string, unknown>)) {
    entry = String((dot as Record<string, unknown>).default)
  } else if (typeof pkg['main'] === 'string') {
    entry = pkg['main']
  }
  const abs = join(pluginPackageDir(npm), entry ?? 'index.js')
  return existsSync(abs) ? abs : null
}

/** 插件声明的宿主能力；未知项忽略（宿主无法提供，也不会授予） */
export function declaredPermissionsOf(npm: string): DshPermission[] {
  const pkg = readPluginPkg(npm)
  const kunyu = pkg?.['kunyu'] as Record<string, unknown> | undefined
  const raw = kunyu?.['permissions']
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is DshPermission => (DSH_PERMISSIONS as readonly string[]).includes(String(p)))
}

/**
 * 包内容指纹：package.json + 入口文件的 SHA-256。
 * 任一缺失返回 null——指纹都无法确定时不允许授权。
 */
export function pluginFingerprint(npm: string): string | null {
  const pkgPath = join(pluginPackageDir(npm), 'package.json')
  const entry = entryPathOf(npm)
  if (!existsSync(pkgPath) || !entry) return null
  try {
    const hash = createHash('sha256')
    hash.update(readFileSync(pkgPath))
    hash.update(Buffer.from([0]))
    hash.update(readFileSync(entry))
    return hash.digest('hex')
  } catch {
    return null
  }
}

/** 当前信任状态（只读，不写文件） */
export function trustStateOf(npm: string): DshTrustSnapshot {
  const fingerprint = pluginFingerprint(npm)
  const declared = declaredPermissionsOf(npm)
  const file = readTrustFile()
  const rec = file[npm]
  if (!fingerprint) return { state: 'untrusted', fingerprint: null, declared, granted: [] }
  if (!rec) return { state: 'untrusted', fingerprint, declared, granted: [] }
  if (rec.fingerprint !== fingerprint) return { state: 'changed', fingerprint, declared, granted: [] }
  const granted = Array.isArray(rec.permissions)
    ? rec.permissions.filter((p): p is DshPermission => (DSH_PERMISSIONS as readonly string[]).includes(p))
    : []
  return { state: 'trusted', fingerprint, declared, granted }
}

/** 是否可加载：必须已授权且包内容与授权时一致 */
export function isPluginTrusted(npm: string): boolean {
  return trustStateOf(npm).state === 'trusted'
}

/**
 * 授权插件运行：记录当前指纹与声明能力（只授予声明项）。
 * 指纹无法确定时拒绝授权（返回 false），避免对未知内容签发信任。
 */
export function approvePlugin(npm: string): boolean {
  const snapshot = trustStateOf(npm)
  if (!snapshot.fingerprint) return false
  const file = readTrustFile()
  file[npm] = {
    fingerprint: snapshot.fingerprint,
    permissions: snapshot.declared.slice(),
    approvedAt: Date.now()
  }
  writeTrustFile(file)
  return true
}

/** 撤销授权（卸载/用户主动撤销时调用；不存在也视为成功） */
export function revokePlugin(npm: string): void {
  const file = readTrustFile()
  if (!(npm in file)) return
  delete file[npm]
  writeTrustFile(file)
}
