/**
 * DSH 插件目录与持久化：精选清单读取 + <userData>/dsh-plugins 安装记录。
 * 资源路径解析与 aiReferenceService 同款（dev=项目根 resources，prod=extraResources）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { isPackagedRuntime } from '../../runtimeEnv'
import type { DshCatalogEntry, DshInstalledRecord } from '../../../shared/types/dsh'

interface DshManifest {
  meta: { description: string; publicSiblingDeps: string[] }
  plugins: DshCatalogEntry[]
}

/**
 * 由坤宇**专用适配层独占管理**的插件包：不经通用 cordis 兼容宿主加载
 * （它们 inject 的服务由专属宿主注入，如 dsh-pet 的 webServer/llm/credentials；
 * 通用宿主加载只会永远 PENDING，还会与专用卡片重复）。包目录与安装记录保留，
 * 专属功能（桌宠启停）依赖它们。
 */
const KUNYU_DEDICATED_PLUGINS = new Set(['dsh-pet'])

export function isDedicatedPlugin(npm: string): boolean {
  return KUNYU_DEDICATED_PLUGINS.has(npm)
}

export function resourcesRoot(): string {
  return isPackagedRuntime(app)
    ? join(process.resourcesPath, 'dsh-plugins')
    : join(process.cwd(), 'resources', 'dsh-plugins')
}

/** 插件安装根：<userData>/dsh-plugins（npm --prefix 目标） */
export function dshPluginsRoot(): string {
  return join(app.getPath('userData'), 'dsh-plugins')
}

function manifestPath(): string {
  return join(resourcesRoot(), 'manifest.json')
}

/** 清单是否随包携带：安装包漏带 dsh-plugins 时 UI 走降级而非裸 ENOENT */
export function catalogManifestExists(): boolean {
  return existsSync(manifestPath())
}

function recordsPath(): string {
  return join(dshPluginsRoot(), 'kunyu.dsh.json')
}

export function readManifest(): DshManifest {
  const raw = JSON.parse(readFileSync(manifestPath(), 'utf-8')) as DshManifest
  if (!Array.isArray(raw.plugins)) throw new Error('DSH 清单格式错误：缺少 plugins 数组')
  return raw
}

/** 精选目录读取：清单缺失时降级为空目录（目录能力尚在：自定义安装/桌宠不受影响） */
export function readCatalogEntries(): DshCatalogEntry[] {
  if (!catalogManifestExists()) return []
  return readManifest().plugins
}

/** 自定义安装的公共同级依赖：清单缺失时降级为空（npm 自行解析依赖树） */
export function publicSiblingDeps(): string[] {
  if (!catalogManifestExists()) return []
  return readManifest().meta.publicSiblingDeps
}

export function readInstalledRecords(): DshInstalledRecord[] {
  if (!existsSync(recordsPath())) return []
  try {
    const raw = JSON.parse(readFileSync(recordsPath(), 'utf-8')) as { plugins?: DshInstalledRecord[] }
    return Array.isArray(raw.plugins) ? raw.plugins : []
  } catch {
    return []
  }
}

export function writeInstalledRecords(records: DshInstalledRecord[]): void {
  writeFileSync(recordsPath(), JSON.stringify({ plugins: records }, null, 2), 'utf-8')
}

export function upsertRecord(record: DshInstalledRecord): void {
  const list = readInstalledRecords().filter((r) => r.npm !== record.npm)
  list.push(record)
  writeInstalledRecords(list)
}

export function dropRecord(npm: string): void {
  writeInstalledRecords(readInstalledRecords().filter((r) => r.npm !== npm))
}
