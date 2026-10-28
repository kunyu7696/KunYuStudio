/**
 * 光影包编辑器主进程服务（P0）。
 * 两种布局：
 * - embedded（模组项目内嵌）：<root>/shaderpacks/<packId>/，可含多个包
 * - standalone（独立光影包项目）：项目根即包根（shaders/ 顶层结构）
 * 元数据统一存 <root>/.kunyu/shaderpack.json。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, join, normalize, relative, sep } from 'node:path'
import type {
  McVersionLike,
  ShaderFileCategory,
  ShaderLoader,
  ShaderPackFile,
  ShaderPackMeta
} from '../../shared/schemas/shaderpack.schema'
import {
  classifyShaderFile,
  createShaderPackMeta,
  shaderPropertiesTemplate,
  validateShaderPackMeta
} from '../../shared/schemas/shaderpack.schema'
import { validateContentId } from '../../shared/types/content'
import { assertWithinRoot, readFile, writeBinaryFile, writeFile } from './fsService'
import { zipDirectory } from './ai/zipUtil'

/** 布局模式：standalone=项目根即包根；embedded=模组项目内 shaderpacks/<packId> */
export type PackMode = 'standalone' | 'embedded'

function metaPath(root: string): string {
  return join(root, '.kunyu', 'shaderpack.json')
}

/** 包根目录（文件操作基准） */
function packRoot(root: string, meta: ShaderPackMeta, mode: PackMode): string {
  return mode === 'standalone' ? root : join(root, 'shaderpacks', meta.packId)
}

function shadersDir(root: string, meta: ShaderPackMeta, mode: PackMode): string {
  return join(packRoot(root, meta, mode), 'shaders')
}

/** 允许编辑的文件扩展名白名单
 *  （补 .csh=Iris compute shader、.inc=#include 公共库、.png=噪声纹理，现代光影包三要素） */
const ALLOWED_EXT = new Set([
  '.vsh', '.fsh', '.gsh', '.csh', '.glsl', '.inc', '.lang', '.properties', '.png'
])

/** 世界子目录（per-dimension 着色器；OptiFine/Iris 约定：world0=主世界 / world-1=下界 / world1=末地。
 *  world_nether / world_the_end 不是加载器识别的目录名（分维度着色器会静默不生效），已移除 */
const WORLD_DIRS = ['world0', 'world-1', 'world1'] as const
type WorldDir = (typeof WORLD_DIRS)[number]
type CollectSub = '' | 'lib' | 'lang' | WorldDir

/** 顶层 properties 白名单（除 shaders.properties 外额外收录的配置文件） */
const TOPLEVEL_PROPS = new Set(['block.properties', 'item.properties', 'entity.properties'])

/** 读取光影包元数据；未初始化返回 null */
export function readShaderPackMeta(root: string): ShaderPackMeta | null {
  assertWithinRoot(root)
  const p = metaPath(root)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')) as ShaderPackMeta
  } catch {
    return null
  }
}

/**
 * 初始化光影包（幂等）：写元数据 + 建标准目录 + 占位 shaders.properties。
 * properties 已存在时不覆盖（避免丢掉用户编辑）。
 * standalone 模式 packId 可省略（固定 default）。
 */
export function initShaderPack(
  root: string,
  input: {
    packId?: string
    name: string
    loader?: ShaderLoader
    mcVersion: McVersionLike
    version?: string
    description: string
  },
  mode: PackMode = 'embedded'
): ShaderPackMeta {
  assertWithinRoot(root)
  const meta = createShaderPackMeta({
    packId: mode === 'standalone' ? input.packId?.trim() || 'default' : input.packId ?? '',
    name: input.name,
    loader: input.loader ?? 'iris',
    mcVersion: input.mcVersion,
    version: input.version ?? '1.0.0',
    description: input.description
  })
  const err = validateShaderPackMeta(meta)
  if (err) throw new Error(err)

  const metaDir = join(root, '.kunyu')
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true })
  writeFile(metaPath(root), JSON.stringify(meta, null, 2) + '\n')

  // 标准目录：shaders/ 平铺管线文件，lib/ 与 lang/ 为子目录，world* 为 per-dimension 着色器
  const shaders = shadersDir(root, meta, mode)
  for (const sub of ['', 'lib', 'lang', ...WORLD_DIRS]) {
    const dir = sub ? join(shaders, sub) : shaders
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  // shaders.properties 仅在不存在时写占位
  const propsPath = join(shaders, 'shaders.properties')
  if (!existsSync(propsPath)) writeFile(propsPath, shaderPropertiesTemplate(meta))

  return meta
}

/** 扫描光影包全部可编辑文件（管线文件 + lib/lang + properties） */
export function listShaderFiles(root: string, mode: PackMode = 'embedded'): ShaderPackFile[] {
  const meta = readShaderPackMeta(root)
  if (!meta) return []
  assertWithinRoot(root)
  const shaders = shadersDir(root, meta, mode)
  if (!existsSync(shaders)) return []
  const result: ShaderPackFile[] = []

  /** 将绝对路径转为节点（通过扩展名白名单与目录归属过滤） */
  function collect(absDir: string, sub: CollectSub): void {
    if (!existsSync(absDir)) return
    for (const name of readdirSync(absDir)) {
      const abs = join(absDir, name)
      if (!statSync(abs).isFile()) continue
      const dot = name.lastIndexOf('.')
      if (dot <= 0) continue
      const ext = name.slice(dot).toLowerCase()
      if (!ALLOWED_EXT.has(ext)) continue
      const id = name.slice(0, dot)
      let relPath: string
      let category: ShaderFileCategory
      if (sub === 'lib') {
        relPath = `shaders/lib/${name}`
        category = 'lib'
      } else if (sub === 'lang') {
        relPath = `shaders/lang/${name}`
        category = 'lang'
      } else if (name === 'shaders.properties') {
        // shaders.properties 在顶层和世界子目录均可存在
        relPath = sub === '' ? 'shaders/shaders.properties' : `shaders/${sub}/${name}`
        category = 'config'
        result.push({ id, relPath, category, ext, updatedAt: statSync(abs).mtimeMs })
        continue
      } else if (sub === '' && TOPLEVEL_PROPS.has(name)) {
        // 顶层 block/item/entity.properties 白名单收录
        relPath = `shaders/${name}`
        category = 'config'
        result.push({ id, relPath, category, ext, updatedAt: statSync(abs).mtimeMs })
        continue
      } else if (ext === '.glsl' || ext === '.lang' || ext === '.properties') {
        // 顶层/世界子目录只接受管线文件；其余扩展名归位在子目录
        continue
      } else {
        // 管线文件：顶层或世界子目录
        relPath = sub === '' ? `shaders/${name}` : `shaders/${sub}/${name}`
        category = classifyShaderFile(id)
      }
      result.push({ id, relPath, category, ext, updatedAt: statSync(abs).mtimeMs })
    }
  }

  collect(shaders, '')
  collect(join(shaders, 'lib'), 'lib')
  collect(join(shaders, 'lang'), 'lang')
  for (const w of WORLD_DIRS) {
    collect(join(shaders, w), w)
  }

  return result.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

/** 校验 relPath：必须位于当前光影包的 shaders/ 内，且扩展名为白名单 */
function resolveSafeShaderPath(
  root: string,
  meta: ShaderPackMeta,
  mode: PackMode,
  relPath: string
): string {
  if (!relPath || relPath.includes('\0')) throw new Error('文件路径不合法')
  const normalized = normalize(relPath).split(sep).join('/')
  if (!normalized.startsWith('shaders/')) {
    throw new Error('文件必须位于光影包 shaders/ 目录内')
  }
  const shaders = shadersDir(root, meta, mode)
  const abs = join(packRoot(root, meta, mode), ...normalized.split('/'))
  const relFromShaders = relative(shaders, abs)
  if (relFromShaders.startsWith('..') || normalize(relFromShaders) === '..') {
    throw new Error('文件路径越界')
  }
  assertWithinRoot(root)
  assertWithinRoot(abs)
  const dot = normalized.lastIndexOf('.')
  const ext = dot >= 0 ? normalized.slice(dot).toLowerCase() : ''
  if (!ALLOWED_EXT.has(ext)) throw new Error(`不支持的光影文件类型: ${ext}`)
  // 文件名（去扩展名）需为安全 ID；固定配置文件放行
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const id = ext ? base.slice(0, -ext.length) : base
  if (base !== 'shaders.properties' && !validateContentId(id)) {
    throw new Error('文件名不合法：小写字母开头，仅含小写字母、数字、下划线')
  }
  return abs
}

/** PNG 文件魔数（8 字节文件头） */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,'

/** 读取光影包文件原始文本；.png 为二进制纹理，返回 data URL（编辑器可整体复制/替换） */
export function readShaderFile(
  root: string,
  relPath: string,
  mode: PackMode = 'embedded'
): string {
  const meta = requireMeta(root)
  const abs = resolveSafeShaderPath(root, meta, mode, relPath)
  if (abs.toLowerCase().endsWith('.png')) {
    const bytes = readFileSync(abs)
    return PNG_DATA_URL_PREFIX + bytes.toString('base64')
  }
  return readFile(abs).content
}

/** 写入光影包文件（新建或覆盖），返回文件节点。
 *  .png 为二进制：content 必须是 data URL（data:image/png;base64,…），按字节落盘并校验 PNG 魔数，
 *  防止文本编辑器把二进制纹理写坏。 */
export function writeShaderFile(
  root: string,
  relPath: string,
  content: string,
  mode: PackMode = 'embedded'
): ShaderPackFile {
  const meta = requireMeta(root)
  const abs = resolveSafeShaderPath(root, meta, mode, relPath)
  if (abs.toLowerCase().endsWith('.png')) {
    if (!content.startsWith(PNG_DATA_URL_PREFIX)) {
      throw new Error('PNG 为二进制纹理：请粘贴 data:image/png;base64,… 格式内容（可从图片文件导出）')
    }
    const bytes = Buffer.from(content.slice(PNG_DATA_URL_PREFIX.length), 'base64')
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
      throw new Error('PNG 数据无效：缺少 PNG 文件头（8 字节魔数）')
    }
    writeBinaryFile(abs, bytes)
    const normalized = normalize(relPath).split(sep).join('/')
    const base = normalized.slice(normalized.lastIndexOf('/') + 1)
    const dot = base.lastIndexOf('.')
    return {
      id: base.slice(0, dot),
      relPath: normalized,
      category: classifyShaderFile(base.slice(0, dot)),
      ext: '.png',
      updatedAt: statSync(abs).mtimeMs
    }
  }
  if (!content || !content.trim()) throw new Error('文件内容不能为空')
  const dir = join(abs, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFile(abs, content.endsWith('\n') ? content : content + '\n')

  const normalized = normalize(relPath).split(sep).join('/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  const id = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : ''
  let category: ShaderFileCategory
  if (normalized.startsWith('shaders/lib/')) category = 'lib'
  else if (normalized.startsWith('shaders/lang/')) category = 'lang'
  else if (ext === '.properties') category = 'config'
  else category = classifyShaderFile(id)

  return { id, relPath: normalized, category, ext, updatedAt: statSync(abs).mtimeMs }
}

/** 删除光影包文件；config（shaders.properties）不允许删除 */
export function deleteShaderFile(
  root: string,
  relPath: string,
  mode: PackMode = 'embedded'
): boolean {
  const meta = requireMeta(root)
  const abs = resolveSafeShaderPath(root, meta, mode, relPath)
  if (normalize(relPath).split(sep).join('/') === 'shaders/shaders.properties') {
    throw new Error('shaders.properties 为光影包必需文件，不允许删除')
  }
  if (!existsSync(abs)) return false
  rmSync(abs, { force: true })
  return true
}

/**
 * standalone 自动升级：项目根存在 shaders/ 目录但缺少编辑器元数据时，
 * 推导默认元数据并落盘，补全 lib/lang 与 shaders.properties。
 * 光影包没有 pack.mcmeta，MC 版本与加载器无法从文件反推，使用默认值（1.20.1 / iris）。
 * @returns 无法识别（无 shaders/）返回 null
 */
export function upgradeStandaloneShaderPack(root: string): ShaderPackMeta | null {
  assertWithinRoot(root)
  const existing = readShaderPackMeta(root)
  if (existing) return existing

  if (!existsSync(join(root, 'shaders'))) return null
  const now = Date.now()
  const meta: ShaderPackMeta = {
    packId: 'default',
    name: basename(root) || 'shaderpack',
    mcVersion: '1.20.1',
    loader: 'iris',
    version: '1.0.0',
    description: '',
    createdAt: now,
    updatedAt: now
  }
  const metaDir = join(root, '.kunyu')
  if (!existsSync(metaDir)) mkdirSync(metaDir, { recursive: true })
  writeFile(metaPath(root), JSON.stringify(meta, null, 2) + '\n')

  const shaders = join(root, 'shaders')
  for (const sub of ['', 'lib', 'lang', ...WORLD_DIRS]) {
    const dir = sub ? join(shaders, sub) : shaders
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  const propsPath = join(shaders, 'shaders.properties')
  if (!existsSync(propsPath)) writeFile(propsPath, shaderPropertiesTemplate(meta))
  return meta
}

function requireMeta(root: string): ShaderPackMeta {
  const meta = readShaderPackMeta(root)
  if (!meta) throw new Error('尚未创建光影包，请先初始化')
  return meta
}

/**
 * 导出可分发光影包 zip（OptiFine/Iris 约定：zip 顶层必须为 shaders/ 目录）。
 * 固定产物路径 <root>/dist/<packId>.zip（与整合包 dist/ 约定一致，避免渲染层
 * 传入任意写盘路径）；重复导出覆盖旧包。返回产物绝对路径。
 */
export function exportShaderPackZip(root: string, mode: PackMode = 'embedded'): string {
  assertWithinRoot(root)
  const meta = requireMeta(root)
  const packDir = packRoot(root, meta, mode)
  if (!existsSync(packDir) || !existsSync(shadersDir(root, meta, mode))) {
    throw new Error('光影包目录不完整：缺少 shaders/，无法导出')
  }
  const outZip = join(root, 'dist', `${meta.packId}.zip`)
  // zipDirectory 以 packDir 为根，条目形如 shaders/shaders.properties（无外层包名目录）
  zipDirectory(packDir, outZip)
  return outZip
}
