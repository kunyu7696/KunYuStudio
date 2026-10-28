/**
 * 模组元数据与 Mixin 配置解析（静态分析 JSON 层）。
 *
 * - fabric.mod.json：modId / 名称 / 版本 / 依赖 / Mixin 配置清单
 * - 每个 mixin 配置：包名、环境（main/client/server）、mixin 类与显式目标
 *
 * 注：字符串形式 mixin 的真实 @Mixin 目标与注入类型（@Inject/@Overwrite…）
 * 需字节码层补充（javap 桥接，Task 4/5），本层只解析 JSON 显式信息。
 */
import type { ZipReader } from './jarReader'

export type MixinEnvironment = 'client' | 'main' | 'server'

export interface FabricModInfo {
  modId: string
  modName: string
  version: string
  hardDeps: string[]
  softDeps: string[]
  mixinConfigs: Array<{ path: string; environment: '*' | MixinEnvironment }>
}

export interface MixinEntry {
  /** mixin 类全名 */
  mixinClass: string
  /** 对象形式显式声明的目标类；字符串形式为 null（字节码层补） */
  target: string | null
}

export interface MixinConfigInfo {
  path: string
  package: string
  environment: MixinEnvironment
  entries: MixinEntry[]
}

export interface ModMetadataSummary {
  fabric: FabricModInfo
  mixins: MixinConfigInfo[]
  classCount: number
}

/** fabric depends 中属于环境而非第三方模组的键 */
const SYSTEM_DEP_KEYS = new Set(['fabricloader', 'minecraft', 'java'])

/** 从 jar 提取模组元数据；非 Fabric 模组或缺失文件时抛错 */
export function extractModMetadata(reader: ZipReader): ModMetadataSummary {
  if (!reader.has('fabric.mod.json')) {
    throw new Error('jar 内未找到 fabric.mod.json，不是 Fabric 模组或已损坏')
  }
  const fabric = parseFabricModJson(reader.read('fabric.mod.json').toString('utf8'))
  const mixins: MixinConfigInfo[] = []
  for (const ref of fabric.mixinConfigs) {
    if (!reader.has(ref.path)) continue
    const env: MixinEnvironment = ref.environment === '*' ? 'main' : ref.environment
    try {
      mixins.push(parseMixinConfig(ref.path, reader.read(ref.path).toString('utf8'), env))
    } catch {
      // 单个 mixin 配置损坏不阻断整体解析
    }
  }
  const classCount = reader.entries().filter(
    (e) =>
      !e.isDirectory &&
      e.path.endsWith('.class') &&
      !e.path.startsWith('META-INF/') &&
      !e.path.includes('/META-INF/')
  ).length
  return { fabric, mixins, classCount }
}

export function parseFabricModJson(text: string): FabricModInfo {
  const obj = parseJsonObject(text)
  const modId = asString(obj['id'])
  if (!modId) throw new Error('fabric.mod.json 缺少 id 字段')

  const hardDeps = collectDepKeys(obj['depends']).filter((k) => !SYSTEM_DEP_KEYS.has(k))
  const softDeps = collectDepKeys(obj['recommends'])
  const extraSoft = collectDepKeys(obj['suggests'])
  const mixinConfigs = parseMixinRefs(obj['mixins'])

  return {
    modId,
    modName: asString(obj['name']) || modId,
    version: asString(obj['version']) || '0.0.0',
    hardDeps,
    softDeps: Array.from(new Set([...softDeps, ...extraSoft])),
    mixinConfigs
  }
}

export function parseMixinConfig(
  path: string,
  text: string,
  environment: MixinEnvironment
): MixinConfigInfo {
  const obj = parseJsonObject(text)
  const packageName = asString(obj['package'])
  if (!packageName) throw new Error(`mixin 配置 ${path} 缺少 package`)

  const entries: MixinEntry[] = []
  collectMixinEntries(obj['mixins'], packageName, entries)
  if (environment === 'client') collectMixinEntries(obj['client'], packageName, entries)
  if (environment === 'server') collectMixinEntries(obj['server'], packageName, entries)

  return { path, package: packageName, environment, entries }
}

/** mixins 数组元素：字符串（类名）或 { target, mixins: [...] } */
function collectMixinEntries(value: unknown, packageName: string, acc: MixinEntry[]): void {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (typeof item === 'string') {
      acc.push({ mixinClass: `${packageName}.${item}`, target: null })
      continue
    }
    if (typeof item === 'object' && item !== null) {
      const o = item as Record<string, unknown>
      const target = asString(o['target']) || null
      const subMixins = Array.isArray(o['mixins']) ? o['mixins'] : []
      for (const sub of subMixins) {
        if (typeof sub === 'string') {
          acc.push({ mixinClass: `${packageName}.${sub}`, target })
        }
      }
    }
  }
}

function parseMixinRefs(value: unknown): FabricModInfo['mixinConfigs'] {
  if (!Array.isArray(value)) return []
  const out: FabricModInfo['mixinConfigs'] = []
  for (const item of value) {
    if (typeof item === 'string') {
      out.push({ path: item, environment: '*' })
    } else if (typeof item === 'object' && item !== null) {
      const o = item as Record<string, unknown>
      const config = asString(o['config'])
      if (config) {
        const env = asString(o['environment'])
        out.push({
          path: config,
          environment: env === 'client' || env === 'server' ? env : '*'
        })
      }
    }
  }
  return out
}

function collectDepKeys(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>)
}

function parseJsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('JSON 根节点不是对象')
  }
  return value as Record<string, unknown>
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
