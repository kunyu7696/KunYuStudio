import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EnchantmentSchema } from '../../../shared/schemas/enchantment.schema'
import type { EntitySchema } from '../../../shared/schemas/entity.schema'
import { dataPath } from '../../../shared/dataPath'
import { fabricModJson, mainClass } from '../../templates/fabricTemplates'
import {
  fabricTargetJdk,
  getToolchain,
  type FabricToolchain
} from '../../templates/loaderVersionMatrix'
import { assertWithinRoot, statEntry, writeFile } from '../fsService'
import { readJson, type ModContext } from './context'
import { GECKOLIB_VERSION } from './javaEntities'
import { sha1, sha1File, type GenSink, type PlannedEntry } from './sink'

export interface Manifest {
  version: 2
  files: string[]
  blockIds: string[]
  itemIds: string[]
  modelIds: string[]
  /** 本工具托管的标签文件 → 条目值（用于下轮精确移除） */
  tags: Record<string, string[]>
  /** 本工具托管的语言键（en_us/zh_cn 共用） */
  langKeys: string[]
  /** 工具最后一次产物 sha1（M12 漂移检测依据） */
  fileHashes: Record<string, string>
  /** 截止本轮仍与工具产物不一致的托管文件 */
  diverged: string[]
}

/**
 * 读取上轮清单。兼容 v1（无 hash）：返回归一化 v2 结构，
 * 调用方通过 fileHashes 为空识别"基线轮"，首轮只建档不误报漂移。
 */
export function readManifest(root: string): Manifest | null {
  const p = join(root, '.kunyu', 'content', 'generated.json')
  if (!existsSync(p)) return null
  try {
    const m = readJson(p) as Partial<Omit<Manifest, 'version'>> & { version?: number }
    if ((m.version !== 1 && m.version !== 2) || !Array.isArray(m.files)) return null
    return {
      version: 2,
      files: m.files!,
      blockIds: Array.isArray(m.blockIds) ? m.blockIds! : [],
      itemIds: Array.isArray(m.itemIds) ? m.itemIds! : [],
      modelIds: Array.isArray(m.modelIds) ? m.modelIds! : [],
      tags: m.tags && typeof m.tags === 'object' ? m.tags! : {},
      langKeys: Array.isArray(m.langKeys) ? m.langKeys! : [],
      fileHashes: m.fileHashes && typeof m.fileHashes === 'object' ? m.fileHashes! : {},
      diverged: Array.isArray(m.diverged) ? m.diverged! : []
    }
  } catch {
    return null
  }
}

/** 漂移哨兵值：sha1 为 40 位十六进制，永不可能等于该串 */
const FOREIGN_HASH_SENTINEL = '__foreign__'

/**
 * 外来文件保护登记（P1-4 兼容性兜底）。
 *
 * 背景：AI 直写 Java/资源的项目里，磁盘文件不在生成器清单内。
 * 若不登记，用户首次点「生成」时基线轮（baseline）会跳过漂移检查，
 * 生成器全量覆写同名文件（如 ModBlocks.java），AI 手写的注册/行为被静默抹掉。
 *
 * 本函数把「计划要写、磁盘已存在、但清单未知」的路径登记为哨兵 hash：
 * 下一轮生成时 diskHash ≠ 哨兵 → 判漂移 → 默认跳过并列入 diverged，
 * 由用户在冲突对话框里显式确认后才覆盖。
 *
 * 调用方应只传全量重写型路径（注册类 / assets / data），
 * 织入型文件（主类、fabric.mod.json）本就保留手写内容，无需保护。
 *
 * @returns 新登记的路径数
 */
export function protectForeignPlannedFiles(root: string, plannedRelPaths: string[]): number {
  assertWithinRoot(root)
  const manifest = readManifest(root) ?? {
    version: 2 as const,
    files: [],
    blockIds: [],
    itemIds: [],
    modelIds: [],
    tags: {},
    langKeys: [],
    fileHashes: {} as Record<string, string>,
    diverged: []
  }
  let added = 0
  for (const rp of plannedRelPaths) {
    if (Object.prototype.hasOwnProperty.call(manifest.fileHashes, rp)) continue
    if (!existsSync(join(root, rp))) continue
    manifest.fileHashes[rp] = FOREIGN_HASH_SENTINEL
    added++
  }
  if (added > 0) {
    writeFile(
      join(root, '.kunyu', 'content', 'generated.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    )
  }
  return added
}

/** 首次生成时通过 sink 清理模板自带的 example_block 占位产物 */
export function cleanupTemplateExample(ctx: ModContext, sink: GenSink): void {
  for (const p of [
    join(ctx.assetsDir, 'blockstates', 'example_block.json'),
    join(ctx.assetsDir, 'models', 'block', 'example_block.json'),
    join(ctx.assetsDir, 'models', 'item', 'example_block.json'),
    join(ctx.assetsDir, 'textures', 'block', 'example_block.png'),
    join(ctx.dataDir, ctx.modId, dataPath('loot_table', ctx.mcVersion), 'blocks', 'example_block.json')
  ]) {
    if (statEntry(p)) sink.remove(p)
  }
}

/**
 * 主类织入：有实体时确保 ModEntities 注册；无实体时移除织入痕迹。
 * 每轮都登记写入（内容不变也写），保证清理轮不会误删；保留用户其余手写内容。
 */
export function syncFabricMainClass(ctx: ModContext, entities: EntitySchema[], sink: GenSink): void {
  const mainPath = join(ctx.javaDir, `${ctx.modClassName}.java`)
  let text0 = existsSync(mainPath) ? readFileSync(mainPath, 'utf-8') : ''
  // 主类缺失：用标准模板重建（内容与项目创建模板一致）
  if (!text0.trim()) {
    text0 = mainClass({
      modId: ctx.modId,
      modName: ctx.modId,
      version: '',
      packageName: ctx.packageName,
      mcVersion: ctx.mcVersion,
      loaderVersion: '',
      loomVersion: '',
      gradleVersion: '',
      fabricVersion: '',
      yarnVersion: '',
      jdk: fabricTargetJdk(getToolchain('fabric', ctx.mcVersion) as FabricToolchain)
    })
  }
  const importLine = `import ${ctx.packageName}.registry.ModEntities;`
  const callLine = '        ModEntities.register();'
  let out = text0
  if (entities.length > 0) {
    if (!out.includes(importLine)) {
      if (out.includes(`import ${ctx.packageName}.registry.ModItems;`)) {
        out = out.replace(
          `import ${ctx.packageName}.registry.ModItems;`,
          `import ${ctx.packageName}.registry.ModItems;\n${importLine}`
        )
      } else {
        out = out.replace(/^(package [^;]+;\n)/m, `$1\n${importLine}\n`)
      }
    }
    if (!out.includes('ModEntities.register();')) {
      if (out.includes('        ModItems.register();')) {
        out = out.replace(
          '        ModItems.register();',
          `        ModItems.register();\n${callLine}`
        )
      } else {
        out = out.replace(/(public void onInitialize\(\)\s*\{)/, `$1\n${callLine}`)
      }
    }
  } else {
    out = out
      .split('\n')
      .filter(
        (l) => l.trim() !== importLine && l.trim() !== 'ModEntities.register();'
      )
      .join('\n')
  }
  sink.text(mainPath, out)
}

/** fabric.mod.json 织入客户端入口 + GeckoLib depends（无实体/无 geo 时移除）；每轮登记写入防误删 */
export function syncFabricModJson(
  ctx: ModContext,
  entities: EntitySchema[],
  sink: GenSink,
  geckolib = false
): void {
  const jsonPath = join(ctx.resourcesDir, 'fabric.mod.json')
  let raw = existsSync(jsonPath) ? readFileSync(jsonPath, 'utf-8') : ''
  const clientEntry = `${ctx.packageName}.${ctx.modClassName}Client`
  if (!raw.trim()) {
    raw = fabricModJson({
      modId: ctx.modId,
      modName: ctx.modId,
      version: '',
      packageName: ctx.packageName,
      mcVersion: ctx.mcVersion,
      loaderVersion: '',
      loomVersion: '',
      gradleVersion: '',
      fabricVersion: '',
      yarnVersion: '',
      jdk: fabricTargetJdk(getToolchain('fabric', ctx.mcVersion) as FabricToolchain)
    })
  }
  let parsed: { entrypoints?: Record<string, string[]>; depends?: Record<string, string> }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  parsed.entrypoints = parsed.entrypoints ?? {}
  const list = Array.isArray(parsed.entrypoints.client) ? parsed.entrypoints.client : []
  if (entities.length > 0) {
    if (!list.includes(clientEntry)) {
      parsed.entrypoints.client = [...list, clientEntry]
    }
  } else if (list.includes(clientEntry)) {
    parsed.entrypoints.client = list.filter((v) => v !== clientEntry)
    if (parsed.entrypoints.client.length === 0) delete parsed.entrypoints.client
  }
  // GeckoLib 运行时依赖：缺库时由加载器给出明确报错而非 NoClassDefFoundError
  const hasGeckoDep = Boolean(parsed.depends && 'geckolib' in parsed.depends)
  if (geckolib && !hasGeckoDep) {
    parsed.depends = { ...(parsed.depends ?? {}), geckolib: `>=${GECKOLIB_VERSION}` }
  } else if (!geckolib && hasGeckoDep) {
    delete parsed.depends!.geckolib
  }
  sink.text(jsonPath, `${JSON.stringify(parsed, null, 2)}\n`)
}

/**
 * Fabric 主类附魔织入：有附魔时确保 ModEnchantments.register()，无附魔时移除织入痕迹。
 * 每轮登记写入，保证清理轮不会误删主类；保留用户其余手写内容。
 */
export function syncFabricEnchantments(ctx: ModContext, enchantments: EnchantmentSchema[], sink: GenSink): void {
  const mainPath = join(ctx.javaDir, `${ctx.modClassName}.java`)
  const text0 = existsSync(mainPath) ? readFileSync(mainPath, 'utf-8') : ''
  // 主类缺失时不重建（实体织入负责重建标准主类），仅避免悬空引用
  if (!text0.trim()) return
  const importLine = `import ${ctx.packageName}.registry.ModEnchantments;`
  const callLine = '        ModEnchantments.register();'
  let out = text0
  if (enchantments.length > 0) {
    if (!out.includes(importLine)) {
      const anchorImport = `import ${ctx.packageName}.registry.ModItems;`
      if (out.includes(`import ${ctx.packageName}.registry.ModEntities;`)) {
        out = out.replace(
          `import ${ctx.packageName}.registry.ModEntities;`,
          `import ${ctx.packageName}.registry.ModEntities;\n${importLine}`
        )
      } else if (out.includes(anchorImport)) {
        out = out.replace(anchorImport, `${anchorImport}\n${importLine}`)
      } else {
        out = out.replace(/^(package [^;]+;\n)/m, `$1\n${importLine}\n`)
      }
    }
    if (!out.includes('ModEnchantments.register();')) {
      if (out.includes('        ModEntities.register();')) {
        out = out.replace(
          '        ModEntities.register();',
          `        ModEntities.register();\n${callLine}`
        )
      } else if (out.includes('        ModItems.register();')) {
        out = out.replace('        ModItems.register();', `        ModItems.register();\n${callLine}`)
      } else {
        out = out.replace(/(public void onInitialize\(\)\s*\{)/, `$1\n${callLine}`)
      }
    }
  } else {
    out = out
      .split('\n')
      .filter((l) => l.trim() !== importLine && l.trim() !== 'ModEnchantments.register();')
      .join('\n')
  }
  sink.text(mainPath, out)
}

/**
 * Forge/NeoForge(Java 路线) 主类附魔织入：
 * 有附魔时挂载 ModEnchantments.ENCHANTMENTS 到 mod 事件总线；无附魔时移除织入痕迹。
 * 兼容 47.x 无参构造器（getModEventBus()）与 20.2+ 注入构造器（IEventBus modEventBus）。
 */
export function syncMojmapEnchantmentMainClass(
  ctx: ModContext,
  active: boolean,
  sink: GenSink
): void {
  const mainPath = join(ctx.javaDir, `${ctx.modClassName}.java`)
  const text0 = existsSync(mainPath) ? readFileSync(mainPath, 'utf-8') : ''
  // 主类缺失时不重建（Forge 主类由项目模板创建），仅避免产生悬空引用
  if (!text0.trim()) return
  const importLine = `import ${ctx.packageName}.registry.ModEnchantments;`
  const callLine = '        ModEnchantments.ENCHANTMENTS.register(modEventBus);'
  let out = text0
  if (active) {
    if (!out.includes(importLine)) {
      const anchorImport = `import ${ctx.packageName}.registry.ModItems;`
      if (out.includes(anchorImport)) {
        out = out.replace(anchorImport, `${anchorImport}\n${importLine}`)
      } else {
        out = out.replace(/^(package [^;]+;\n)/m, `$1\n${importLine}\n`)
      }
    }
    if (!out.includes('ModEnchantments.ENCHANTMENTS.register(modEventBus);')) {
      if (out.includes('        ModItems.ITEMS.register(modEventBus);')) {
        out = out.replace(
          '        ModItems.ITEMS.register(modEventBus);',
          `        ModItems.ITEMS.register(modEventBus);\n${callLine}`
        )
      } else if (/IEventBus\s+modEventBus\s*=/.test(out)) {
        // 47.x 无参构造器：总线声明之后挂载
        out = out.replace(/(IEventBus\s+modEventBus\s*=[^\n]*\n)/, `$1${callLine}\n`)
      } else {
        // 20.2+ 注入构造器：构造器体首行挂载
        out = out.replace(
          /(public\s+\w+\s*\(\s*IEventBus\s+modEventBus\s*\)\s*\{)/,
          `$1\n${callLine}`
        )
      }
    }
  } else {
    out = out
      .split('\n')
      .filter(
        (l) =>
          l.trim() !== importLine &&
          l.trim() !== 'ModEnchantments.ENCHANTMENTS.register(modEventBus);'
      )
      .join('\n')
  }
  sink.text(mainPath, out)
}

/**
 * Forge/NeoForge 主类实体织入：有实体时挂载 ModEntities.ENTITIES 到 mod 事件总线；
 * 无实体时移除织入痕迹（产物文件本身由通用「清理」段按清单删除）。
 * 兼容 47.x 无参构造器（getModEventBus()）与 20.2+ 注入构造器（IEventBus modEventBus）。
 * 模式对齐 syncMojmapEnchantmentMainClass。
 */
export function syncMojmapEntitiesMainClass(ctx: ModContext, active: boolean, sink: GenSink): void {
  const mainPath = join(ctx.javaDir, `${ctx.modClassName}.java`)
  const text0 = existsSync(mainPath) ? readFileSync(mainPath, 'utf-8') : ''
  // 主类缺失时不重建（Forge/NeoForge 主类由项目模板创建），仅避免产生悬空引用
  if (!text0.trim()) return
  const importLine = `import ${ctx.packageName}.registry.ModEntities;`
  const callLine = '        ModEntities.ENTITIES.register(modEventBus);'
  let out = text0
  if (active) {
    if (!out.includes(importLine)) {
      const anchorImport = `import ${ctx.packageName}.registry.ModItems;`
      if (out.includes(anchorImport)) {
        out = out.replace(anchorImport, `${anchorImport}\n${importLine}`)
      } else {
        out = out.replace(/^(package [^;]+;\n)/m, `$1\n${importLine}\n`)
      }
    }
    if (!out.includes('ModEntities.ENTITIES.register(modEventBus);')) {
      if (out.includes('        ModItems.ITEMS.register(modEventBus);')) {
        out = out.replace(
          '        ModItems.ITEMS.register(modEventBus);',
          `        ModItems.ITEMS.register(modEventBus);\n${callLine}`
        )
      } else if (/IEventBus\s+modEventBus\s*=/.test(out)) {
        // 47.x 无参构造器：总线声明之后挂载
        out = out.replace(/(IEventBus\s+modEventBus\s*=[^\n]*\n)/, `$1${callLine}\n`)
      } else {
        // 20.2+ 注入构造器：构造器体首行挂载
        out = out.replace(
          /(public\s+\w+\s*\(\s*IEventBus\s+modEventBus\s*\)\s*\{)/,
          `$1\n${callLine}`
        )
      }
    }
  } else {
    out = out
      .split('\n')
      .filter(
        (l) =>
          l.trim() !== importLine &&
          l.trim() !== 'ModEntities.ENTITIES.register(modEventBus);'
      )
      .join('\n')
  }
  sink.text(mainPath, out)
}

export interface RunResult {
  blockIds: string[]
  itemIds: string[]
  modelIds: string[]
  tagSnapshot: Record<string, string[]>
  langKeyList: string[]
  writes: Map<string, PlannedEntry>
  deletes: Map<string, { exists: boolean; drifted: boolean; skipped: boolean }>
  keptFromDelete: Set<string>
  prevDiverged: string[]
}

/** 汇总本轮托管文件与工具产物 hash（跳过的文件沿用旧 hash，删除保护保留的文件沿用旧 hash） */
export function collectManagedFiles(
  root: string,
  run: RunResult,
  oldHashes: Record<string, string>
): { files: string[]; fileHashes: Record<string, string>; diverged: string[] } {
  const fileSet = new Set<string>([...run.writes.keys(), ...run.keptFromDelete])
  const fileHashes: Record<string, string> = {}
  for (const [rp, entry] of run.writes) {
    // mergedForeign（注册类增量合并）必须沿用旧 hash（外来哨兵/旧产物 hash）：
    // 若存 sha1(合并结果)，下轮磁盘与清单一致 → 不再漂移 → 纯生成内容直写，外来段被抹掉
    if ((entry.skipped || entry.mergedForeign) && oldHashes[rp]) {
      fileHashes[rp] = oldHashes[rp]
    } else {
      fileHashes[rp] = sha1(entry.data)
    }
  }
  for (const rp of run.keptFromDelete) {
    if (oldHashes[rp]) fileHashes[rp] = oldHashes[rp]
  }
  // 漂移 = 磁盘实况与工具最后产物不一致（跳过写入 / 删除保护留下的手改文件）；
  // mergedForeign 已把外来段并入写盘结果，不再视为待决冲突
  const diverged = [...fileSet]
    .filter((rp) => {
      const entry = run.writes.get(rp)
      if (entry?.mergedForeign) return false
      const abs = join(root, rp)
      if (!existsSync(abs)) return false
      const disk = sha1File(abs)
      return disk !== null && fileHashes[rp] !== undefined && disk !== fileHashes[rp]
    })
    .sort()
  return { files: [...fileSet].sort(), fileHashes, diverged }
}
