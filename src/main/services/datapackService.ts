/**
 * 数据包编辑器主进程服务。
 * 两种布局：
 * - embedded（模组项目内嵌）：内容写 src/main/resources/data/<ns>/，pack.mcmeta 同目录
 * - standalone（独立数据包项目）：项目根即包根（pack.mcmeta + data/）
 * 元数据统一存 <root>/.kunyu/datapack.json。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DataPackCategory, DataPackEntry, DataPackMeta, McVersion } from '../../shared/schemas/datapack.schema'
import {
  DATA_PACK_CATEGORIES,
  PACK_FORMATS,
  buildPackMcmeta,
  dataPackCategory,
  dataPackEntryPath,
  mcVersionFromPackFormat,
  validateDataPackMeta
} from '../../shared/schemas/datapack.schema'
import { validateContentId } from '../../shared/types/content'
import { assertWithinRoot, readFile, writeFile } from './fsService'

/** 布局模式：standalone=项目根即包根；embedded=模组项目内 src/main/resources */
export type PackMode = 'standalone' | 'embedded'

function metaPath(root: string): string {
  return join(root, '.kunyu', 'datapack.json')
}

/** 包根目录（data/ 与 pack.mcmeta 的基准） */
function packRoot(root: string, mode: PackMode): string {
  return mode === 'standalone' ? root : join(root, 'src', 'main', 'resources')
}

/** 类别对应的文件扩展名（函数为 .mcfunction，其余为 .json） */
function entryExtension(category: DataPackCategory): string {
  return category === 'function' ? '.mcfunction' : '.json'
}

/** 条目的数据包相对路径（函数使用 .mcfunction，其余 .json） */
function entryRelPath(
  namespace: string,
  category: DataPackCategory,
  version: McVersion,
  id: string
): string {
  const rel = dataPackEntryPath(namespace, category, version, id)
  return category === 'function' ? rel.replace(/\.json$/, '.mcfunction') : rel
}

/** 读取数据包元数据；未初始化返回 null */
export function readDataPackMeta(root: string): DataPackMeta | null {
  assertWithinRoot(root)
  const p = metaPath(root)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')) as DataPackMeta
  } catch {
    return null
  }
}

/**
 * 初始化数据包：写元数据 + pack.mcmeta + 建全部类别目录（幂等，重复调用仅刷新元数据）。
 */
export function initDataPack(
  root: string,
  input: { namespace: string; description: string; mcVersion: McVersion },
  mode: PackMode = 'embedded'
): DataPackMeta {
  assertWithinRoot(root)
  const meta: DataPackMeta = {
    namespace: input.namespace,
    mcVersion: input.mcVersion,
    loader: 'fabric',
    packFormat: PACK_FORMATS[input.mcVersion] ?? (() => { throw new Error('不支持的数据包 MC 版本：' + input.mcVersion) })(),
    description: input.description,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  const metaErr = validateDataPackMeta(meta)
  if (metaErr) throw new Error(metaErr)

  const metaDir = join(root, '.kunyu')
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true })
  writeFile(metaPath(root), JSON.stringify(meta, null, 2) + '\n')

  // pack.mcmeta（幂等覆盖为当前元数据）
  const base = packRoot(root, mode)
  if (!existsSync(base)) mkdirSync(base, { recursive: true })
  writeFile(join(base, 'pack.mcmeta'), buildPackMcmeta(meta))

  // 建全部类别目录（含 data/<ns>/），空目录便于用户理解结构
  const dataDir = join(base, 'data', meta.namespace)
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  for (const cat of DATA_PACK_CATEGORIES) {
    const dir = join(dataDir, ...cat.dir(meta.mcVersion).split('/'))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  return meta
}

/** 扫描全部类别的条目列表（按类别注册表顺序，条目按 ID 排序） */
export function listDataPackEntries(root: string, mode: PackMode = 'embedded'): DataPackEntry[] {
  const meta = readDataPackMeta(root)
  if (!meta) return []
  assertWithinRoot(root)
  const dataDir = join(packRoot(root, mode), 'data', meta.namespace)
  const result: DataPackEntry[] = []
  if (!existsSync(dataDir)) return result
  for (const cat of DATA_PACK_CATEGORIES) {
    const dir = join(dataDir, ...cat.dir(meta.mcVersion).split('/'))
    if (!existsSync(dir)) continue
    const ext = entryExtension(cat.key)
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(ext)) continue
      const abs = join(dir, name)
      if (!statSync(abs).isFile()) continue
      const id = name.slice(0, -ext.length)
      try {
        result.push({
          id,
          path: entryRelPath(meta.namespace, cat.key, meta.mcVersion, id),
          category: cat.key,
          updatedAt: statSync(abs).mtimeMs
        })
      } catch {
        // 跳过非法 ID
      }
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}

/** 读取单个条目的原始文本（JSON 由渲染层解析） */
export function readDataPackEntry(
  root: string,
  category: string,
  id: string,
  mode: PackMode = 'embedded'
): string {
  const meta = requireMeta(root)
  const info = requireCategory(category)
  assertWithinRoot(root)
  if (!validateContentId(id)) throw new Error(`条目 ID 不合法: ${id}`)
  return readFile(
    join(packRoot(root, mode), ...entryRelPath(meta.namespace, info.key, meta.mcVersion, id).split('/'))
  ).content
}

/**
 * 写入单个条目（新建或覆盖），返回条目信息。
 * @param content 完整文件文本（JSON 或 mcfunction 脚本）
 */
export function writeDataPackEntry(
  root: string,
  category: string,
  id: string,
  content: string,
  mode: PackMode = 'embedded'
): DataPackEntry {
  const meta = requireMeta(root)
  const info = requireCategory(category)
  assertWithinRoot(root)
  if (!validateContentId(id)) {
    throw new Error('条目 ID 不合法：小写字母开头，仅含小写字母、数字、下划线，最长 64 字符')
  }
  if (!content || !content.trim()) throw new Error('文件内容不能为空')
  const rel = entryRelPath(meta.namespace, info.key, meta.mcVersion, id)
  const abs = join(packRoot(root, mode), ...rel.split('/'))
  assertWithinRoot(abs)
  const dir = join(abs, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFile(abs, content.endsWith('\n') ? content : content + '\n')
  return {
    id,
    path: rel,
    category: info.key,
    updatedAt: statSync(abs).mtimeMs
  }
}

/** 删除单个条目文件 */
export function deleteDataPackEntry(
  root: string,
  category: string,
  id: string,
  mode: PackMode = 'embedded'
): boolean {
  const meta = requireMeta(root)
  const info = requireCategory(category)
  assertWithinRoot(root)
  if (!validateContentId(id)) throw new Error(`条目 ID 不合法: ${id}`)
  const abs = join(
    packRoot(root, mode),
    ...entryRelPath(meta.namespace, info.key, meta.mcVersion, id).split('/')
  )
  if (!existsSync(abs)) return false
  rmSync(abs, { force: true })
  return true
}

/**
 * standalone 自动升级：项目根存在 pack.mcmeta 但缺少编辑器元数据时，
 * 从 pack.mcmeta（pack_format/description）与 data/ 目录（namespace）推导元数据并落盘，
 * 同时补全标准目录。已初始化时返回现有元数据。
 * @returns 无法识别（无 pack.mcmeta）返回 null
 */
export function upgradeStandaloneDataPack(root: string): DataPackMeta | null {
  assertWithinRoot(root)
  const existing = readDataPackMeta(root)
  if (existing) return existing

  const mcmetaAbs = join(root, 'pack.mcmeta')
  if (!existsSync(mcmetaAbs)) return null
  let packFormat: number | undefined
  let description = ''
  try {
    const parsed = JSON.parse(readFileSync(mcmetaAbs, 'utf-8').replace(/^\uFEFF/, '')) as {
      pack?: { pack_format?: number; description?: string }
    }
    packFormat = parsed.pack?.pack_format
    if (typeof parsed.pack?.description === 'string') description = parsed.pack.description
  } catch {
    return null
  }
  const mcVersion = mcVersionFromPackFormat(packFormat ?? 15)

  // namespace：data/ 下首个合法目录
  let namespace = 'mymod'
  const dataRoot = join(root, 'data')
  if (existsSync(dataRoot)) {
    const ns = readdirSync(dataRoot).find(
      (n) => statSync(join(dataRoot, n)).isDirectory() && validateContentId(n)
    )
    if (ns) namespace = ns
  }

  const now = Date.now()
  const meta: DataPackMeta = {
    namespace,
    mcVersion,
    loader: 'fabric',
    packFormat: packFormat ?? 15,
    description,
    createdAt: now,
    updatedAt: now
  }
  const metaDir = join(root, '.kunyu')
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true })
  writeFile(metaPath(root), JSON.stringify(meta, null, 2) + '\n')

  // 补全标准目录（已存在跳过）
  const dataDir = join(root, 'data', namespace)
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  for (const cat of DATA_PACK_CATEGORIES) {
    const dir = join(dataDir, ...cat.dir(mcVersion).split('/'))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  return meta
}

function requireMeta(root: string): DataPackMeta {
  const meta = readDataPackMeta(root)
  if (!meta) throw new Error('尚未创建数据包，请先初始化')
  return meta
}

function requireCategory(category: string) {
  const info = dataPackCategory(category)
  if (!info) throw new Error(`数据包类别不合法: ${category}`)
  return info
}
