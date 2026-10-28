/**
 * 应用设置持久化服务（M6 T6.2）。
 * 基于 electron-store（userData/settings.json）；必须在 app.setPath('userData')
 * 之后、app ready 时调用 initSettings() 初始化。
 * 渲染进程只经 IPC 访问；API Key 等敏感字段随文件保存在本机 userData。
 *
 * 敏感字段加密：
 * AI 供应商 Key、市场/发布 token 落盘前经 Electron safeStorage 加密
 * （Windows DPAPI / macOS Keychain / Linux kwallet），磁盘仅存 `enc:v1:<base64>`；
 * 内存缓存与所有消费侧读到的始终是明文，行为零变化。
 * safeStorage 不可用（如部分 Linux 无钥匙串）时新写入退回明文并在启动日志告警；
 * 已存密文无法解密时按空值处理（fail-closed），绝不让 `enc:v1:...` 乱码
 * 被当成真实 Key 发给 API 提供商（fail-open）。
 */
import { app, safeStorage } from 'electron'
import {
  applyPatch,
  mergeWithDefaults,
  type AppSettings,
  type LocalePreference,
  type SettingsSection
} from '../../shared/types/settings'
import { setSharedLocale, type SharedLocale } from '../../shared/i18n'

type StoreType = import('electron-store').default<AppSettings>
let store: StoreType | null = null
let cache: AppSettings = mergeWithDefaults(undefined)

/**
 * 设置变更订阅（工具权限「保存即生效」需要主进程内存配置热刷新）。
 * setSettings 落盘后依次通知所有订阅者，传入本次 patch 与合并后的全量 next。
 * 订阅者必须同步快速返回，不得在回调内 await 长任务（异步副作用自行 void 丢出）。
 */
type SettingsSubscriber = (patch: unknown, next: AppSettings) => void
const subscribers = new Set<SettingsSubscriber>()

export function subscribeSettings(fn: SettingsSubscriber): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

const ENC_PREFIX = 'enc:v1:'

/** 按界面语言偏好同步共享层（schema 校验/选项）语言；system 取操作系统语言，非中文回落英文 */
function syncSharedLocale(pref: LocalePreference): void {
  const locale: SharedLocale =
    pref === 'zh-CN' || pref === 'en-US'
      ? pref
      : app.getLocale().toLowerCase().startsWith('zh')
        ? 'zh-CN'
        : 'en-US'
  setSharedLocale(locale)
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** 密钥加密是否可用（safeStorage）；false = 密钥将以明文落盘。供 IPC 暴露给渲染层横幅 */
export function isSecretEncryptionAvailable(): boolean {
  return canEncrypt()
}

function encryptSecret(plain: string): string {
  if (!plain || plain.startsWith(ENC_PREFIX) || !canEncrypt()) return plain
  return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
}

let warnedUndecryptable = false
function warnIfUndecryptable(): void {
  if (warnedUndecryptable) return
  warnedUndecryptable = true
  console.warn(
    '[settings] 检测到加密密钥但当前系统无法解密（safeStorage 不可用），' +
      '相关 API Key/token 已按空值处理，请到设置页重新填写。'
  )
}

function decryptSecret(value: string): string {
  if (!value || !value.startsWith(ENC_PREFIX)) return value
  if (!canEncrypt()) {
    // fail-closed：无法解密时按空值处理（与下方解密失败路径一致），
    // 绝不让 enc:v1: 密文原样流出被当成真实 Key 发给 API（fail-open）
    warnIfUndecryptable()
    return ''
  }
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    // 密文损坏/换机后 DPAPI 不可解：清空，让用户重新填写，避免把乱码当 Key 发出去
    return ''
  }
}

/** 递归处理对象中的密钥字段：direction=encrypt 落盘前，decrypt 读入后 */
function walkSecrets(settings: AppSettings, direction: 'encrypt' | 'decrypt'): AppSettings {
  const fn = direction === 'encrypt' ? encryptSecret : decryptSecret
  // structuredClone 在 Pinia/响应式对象上会失败，这里 settings 已是纯数据（merge/applyPatch 产出）
  const next = structuredClone(settings)
  for (const p of next.ai.providers) {
    if (typeof p.apiKey === 'string') p.apiKey = fn(p.apiKey)
  }
  const m = next.marketplace
  if (typeof m.curseforgeApiKey === 'string') m.curseforgeApiKey = fn(m.curseforgeApiKey)
  const pub = next.publish
  if (typeof pub.modrinthToken === 'string') pub.modrinthToken = fn(pub.modrinthToken)
  if (typeof pub.curseforgeToken === 'string') pub.curseforgeToken = fn(pub.curseforgeToken)
  // 自定义 MCP 服务的注入 env 常带凭证（如 GITHUB_TOKEN）：逐值加密（此前明文落盘）
  for (const s of next.ai.customMcpServers) {
    for (const k of Object.keys(s.env)) {
      if (typeof s.env[k] === 'string') s.env[k] = fn(s.env[k])
    }
  }
  return next
}

let warnedNoEncryption = false
function warnIfPlaintext(): void {
  if (warnedNoEncryption || canEncrypt()) return
  warnedNoEncryption = true
  console.warn(
    '[settings] safeStorage 不可用（当前系统无钥匙串），API Key/token 将以明文保存。' +
      'Windows/macOS 不受影响；Linux 请安装 gnome-keyring 或 kwallet。'
  )
}

/**
 * 下发渲染层的密钥哨兵：非空密钥替换为该值，渲染层只感知「已配置」，
 * 永不经 IPC 拿到明文。渲染层原样回传哨兵 = 「未修改」，主进程在 setSettings
 * 里把哨兵还原为缓存中的真实值（见 restoreMaskedSecrets）。
 */
export const SECRET_MASK = '__kunyu_secret_unchanged__'

const maskSecret = (v: string): string => (v ? SECRET_MASK : '')

/** 全量设置的渲染层视图：所有密钥字段掩码化 */
export function maskSecrets(s: AppSettings): AppSettings {
  const next = structuredClone(s)
  for (const p of next.ai.providers) {
    if (typeof p.apiKey === 'string') p.apiKey = maskSecret(p.apiKey)
  }
  if (typeof next.marketplace.curseforgeApiKey === 'string') {
    next.marketplace.curseforgeApiKey = maskSecret(next.marketplace.curseforgeApiKey)
  }
  if (typeof next.publish.modrinthToken === 'string') {
    next.publish.modrinthToken = maskSecret(next.publish.modrinthToken)
  }
  if (typeof next.publish.curseforgeToken === 'string') {
    next.publish.curseforgeToken = maskSecret(next.publish.curseforgeToken)
  }
  for (const srv of next.ai.customMcpServers) {
    for (const k of Object.keys(srv.env)) {
      if (typeof srv.env[k] === 'string') srv.env[k] = maskSecret(srv.env[k])
    }
  }
  return next
}

/** setSettings 合并后调用：把渲染层回传的哨兵还原为 prev 中的真实密钥（按 id/键名匹配） */
function restoreMaskedSecrets(next: AppSettings, prev: AppSettings): void {
  const unmask = (masked: string, real: string): string => (masked === SECRET_MASK ? real : masked)
  for (const p of next.ai.providers) {
    if (p.apiKey !== SECRET_MASK) continue
    const old = prev.ai.providers.find((o) => o.id === p.id)
    p.apiKey = old ? old.apiKey : ''
  }
  next.marketplace.curseforgeApiKey = unmask(next.marketplace.curseforgeApiKey, prev.marketplace.curseforgeApiKey)
  next.publish.modrinthToken = unmask(next.publish.modrinthToken, prev.publish.modrinthToken)
  next.publish.curseforgeToken = unmask(next.publish.curseforgeToken, prev.publish.curseforgeToken)
  for (const srv of next.ai.customMcpServers) {
    const old = prev.ai.customMcpServers.find((o) => o.id === srv.id)
    for (const k of Object.keys(srv.env)) {
      if (srv.env[k] === SECRET_MASK) srv.env[k] = old?.env[k] ?? ''
    }
  }
}

/**
 * 初始化设置存储：读取磁盘内容并解密敏感字段 → 与默认值合并（迁移/修复非法值）。
 * 必须在 app ready 且 userData 路径确定之后调用一次。
 */
export async function initSettings(): Promise<AppSettings> {
  const Store = (await import('electron-store')).default
  store = new Store({ name: 'settings' })
  warnIfPlaintext()
  const merged = mergeWithDefaults(store.store)
  cache = walkSecrets(merged, 'decrypt')
  // 共享层语言跟随设置（主进程侧 schema 校验错误经 IPC 直达 UI）
  syncSharedLocale(cache.general.locale)
  // 原地迁移：明文密钥首次读出后立即以密文回写
  store.store = walkSecrets(cache, 'encrypt')
  return cache
}

/** 读取全量设置（内存缓存，未初始化时返回默认值）。敏感字段为明文。 */
export function getAllSettings(): AppSettings {
  return cache
}

/** 读取单个分段。敏感字段为明文。 */
export function getSection<K extends SettingsSection>(section: K): AppSettings[K] {
  return cache[section]
}

/**
 * 合并写入部分设置（仅接受已知分段/字段），敏感字段加密落盘后返回新全量值（明文）。
 */
export function setSettings(patch: unknown): AppSettings {
  const next = applyPatch(cache, patch)
  restoreMaskedSecrets(next, cache)
  cache = next
  syncSharedLocale(next.general.locale)
  if (store) store.store = walkSecrets(next, 'encrypt')
  // 通知订阅者热刷新内存配置（如 MCP 工具权限保存即生效）
  for (const fn of subscribers) {
    try { fn(patch, next) } catch (err) { console.error('[settings] subscriber error:', err) }
  }
  return next
}
