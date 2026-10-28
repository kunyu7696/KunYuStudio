/**
 * 数据包编辑器语义结构（P0：项目管理 + 目录结构 + 分类文件树 + Schema 表单框架）。
 *
 * 关键版本差异（桥接 Agent 版本迁移时处理）：
 * - 目录名：1.20.1 复数（recipes/loot_tables/tags/items/...），1.21.1 单数（recipe/loot_table/tags/item/...）
 * - pack_format：1.20.1 = 15，1.21.1 = 48
 * - 配方 result.item → result.id（1.21.1）
 *
 * 数据包 JSON 是完整文件（非注入块），直接写入
 * src/main/resources/data/<namespace>/<categoryDir>/<id>.json。
 * 内嵌模组形态还需 pack.mcmeta（写 src/main/resources/pack.mcmeta，幂等）。
 */
import { validateContentId } from '../types/content'
import type { PackMcVersion } from '../types/project'
import { createDatapackDefault } from './datapack/forms'
import { dataPath, tagRegistryPath } from '../dataPath'
import { sharedT, type SharedLocale } from '../i18n'

/** 数据包元数据（存于项目 .kunyu/datapack.json） */
export interface DataPackMeta {
  /** 命名空间（默认取项目 modId） */
  namespace: string
  /** 目标 MC 版本（P0 锁定 1.20.1，字段为 1.21 预留） */
  mcVersion: McVersion
  /** 加载器（P0 锁定 fabric，字段预留） */
  loader: 'fabric' | 'forge' | 'neoforge'
  /** pack.mcmeta 的 pack_format（随 mcVersion 确定） */
  packFormat: number
  description: string
  createdAt: number
  updatedAt: number
}

/** 数据包目标 MC 版本（与版本矩阵登记的 10 个版本一致；legacy 仅供导入/迁移） */
export type McVersion = PackMcVersion

/** MC 版本 → 数据包 pack_format（官方口径） */
export const PACK_FORMATS: Record<McVersion, number> = {
  '1.16.5': 6,
  '1.18.2': 9,
  '1.19.2': 10,
  '1.20.1': 15,
  '1.20.4': 26,
  '1.20.6': 41,
  '1.21.1': 48,
  '1.21.3': 57,
  // V-01：1.21.4/1.21.5（与资源包 formats.ts 的 46/55 同批登记；数据包格式号官方口径）
  '1.21.4': 61,
  '1.21.5': 71
}

/** pack_format 反查 MC 版本（导入/升级场景） */
export function mcVersionFromPackFormat(packFormat: number): McVersion {
  for (const [version, fmt] of Object.entries(PACK_FORMATS)) {
    if (fmt === packFormat) return version as McVersion
  }
  return '1.20.1'
}

/** 数据包内容类别（计划 8 类；标签 P0 仅 items 子目录；世界生成细分两个地物子类 + 生物群系） */
export type DataPackCategory =
  | 'recipe'
  | 'loot_table'
  | 'advancement'
  | 'tag'
  | 'worldgen'
  | 'worldgen_configured_feature'
  | 'worldgen_placed_feature'
  | 'worldgen_biome'
  | 'function'
  | 'predicate'
  | 'item_modifier'

export interface DataPackCategoryInfo {
  key: DataPackCategory
  label: string
  hint: string
  /** 类别目录名（按版本差异化）；tag 返回 tags/items / tags/item */
  dir(version: McVersion): string
}

/**
 * 类别目录统一走 shared/dataPath 单点映射（1.21+ 单数，此前复数），
 * 不再在本模块维护版本表。
 */

/** 类别注册表 builder（常量在 import 时按当前语言冻结，getter 支持按语言重建） */
function buildDataPackCategories(locale?: SharedLocale): DataPackCategoryInfo[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    {
      key: 'recipe',
      label: t('schema.datapack.catRecipe'),
      hint: t('schema.datapack.catRecipeHint'),
      dir: (v) => dataPath('recipe', v)
    },
    {
      key: 'loot_table',
      label: t('schema.datapack.catLootTable'),
      hint: t('schema.datapack.catLootTableHint'),
      dir: (v) => dataPath('loot_table', v)
    },
    {
      key: 'advancement',
      label: t('schema.datapack.catAdvancement'),
      hint: t('schema.datapack.catAdvancementHint'),
      dir: (v) => dataPath('advancement', v)
    },
    {
      key: 'tag',
      label: t('schema.datapack.catTag'),
      hint: t('schema.datapack.catTagHint'),
      dir: (v) => `tags/${tagRegistryPath('item', v)}`
    },
    {
      key: 'worldgen',
      label: t('schema.datapack.catWorldgen'),
      hint: t('schema.datapack.catWorldgenHint'),
      dir: () => 'worldgen'
    },
    {
      key: 'worldgen_configured_feature',
      label: t('schema.datapack.catConfiguredFeature'),
      hint: t('schema.datapack.catConfiguredFeatureHint'),
      dir: () => 'worldgen/configured_feature'
    },
    {
      key: 'worldgen_placed_feature',
      label: t('schema.datapack.catPlacedFeature'),
      hint: t('schema.datapack.catPlacedFeatureHint'),
      dir: () => 'worldgen/placed_feature'
    },
    {
      key: 'worldgen_biome',
      label: t('schema.datapack.catBiome'),
      hint: t('schema.datapack.catBiomeHint'),
      // worldgen/biome 目录跨版本一致（单复数切换不涉及 worldgen 子目录）
      dir: () => 'worldgen/biome'
    },
    {
      key: 'function',
      label: t('schema.datapack.catFunction'),
      hint: t('schema.datapack.catFunctionHint'),
      dir: (v) => dataPath('function', v)
    },
    {
      key: 'predicate',
      label: t('schema.datapack.catPredicate'),
      hint: t('schema.datapack.catPredicateHint'),
      dir: (v) => dataPath('predicate', v)
    },
    {
      key: 'item_modifier',
      label: t('schema.datapack.catItemModifier'),
      hint: t('schema.datapack.catItemModifierHint'),
      dir: (v) => dataPath('item_modifier', v)
    }
  ]
}

/** 类别注册表（文件树分组与路径生成共用；UI 侧请用 getDataPackCategories 建立响应式） */
export const DATA_PACK_CATEGORIES: DataPackCategoryInfo[] = buildDataPackCategories()

/** 按语言取类别注册表（组件 computed 内传 locale.value 建立响应式依赖） */
export function getDataPackCategories(locale?: SharedLocale): DataPackCategoryInfo[] {
  return buildDataPackCategories(locale)
}

/** 按类别键查注册表 */
export function dataPackCategory(key: string): DataPackCategoryInfo | undefined {
  return DATA_PACK_CATEGORIES.find((c) => c.key === key)
}

/** 类别下某条目的数据包相对路径：data/<ns>/<categoryDir>/<id>.json（函数为 .mcfunction） */
export function dataPackEntryPath(
  namespace: string,
  category: DataPackCategory,
  version: McVersion,
  id: string
): string {
  const info = dataPackCategory(category)
  if (!info) throw new Error(sharedT('schema.datapack.errCategoryInvalid', { category }))
  const ext = category === 'function' ? '.mcfunction' : '.json'
  return `data/${namespace}/${info.dir(version)}/${id}${ext}`
}

/** 数据包条目（文件树节点 + 编辑区目标） */
export interface DataPackEntry {
  /** 条目 ID（不含扩展名） */
  id: string
  /** 数据包相对路径 data/<ns>/<categoryDir>/<id>.json */
  path: string
  category: DataPackCategory
  updatedAt: number
}

/** 新建数据包元数据（P0：mcVersion 锁定 1.20.1，packFormat 自动确定） */
export function createDataPackMeta(namespace: string, description: string): DataPackMeta {
  const now = Date.now()
  return {
    namespace: namespace || 'mymod',
    mcVersion: '1.20.1',
    loader: 'fabric',
    packFormat: PACK_FORMATS['1.20.1'],
    description: description || '',
    createdAt: now,
    updatedAt: now
  }
}

/** 校验数据包元数据；返回错误消息，合法返回 null */
export function validateDataPackMeta(meta: DataPackMeta): string | null {
  if (!validateContentId(meta.namespace)) {
    return sharedT('schema.common.errNamespaceInvalid')
  }
  if (!(PACK_FORMATS[meta.mcVersion] ?? 0)) {
    return sharedT('schema.common.errMcVersionUnsupported', { v: meta.mcVersion })
  }
  return null
}

/** pack.mcmeta 内容 */
export function buildPackMcmeta(meta: DataPackMeta): string {
  return `${JSON.stringify(
    {
      pack: {
        pack_format: meta.packFormat,
        description: meta.description || `${meta.namespace} 数据包`
      }
    },
    null,
    2
  )}\n`
}

/** 空函数文件模板（functions 用，非 JSON） */
function emptyFunctionTemplate(): string {
  return '# 在此编写 mcfunction 命令，每行一条\ntellraw @a {"text":"Hello from KunYu"}\n'
}

/**
 * 新建条目的内容模板。
 * 表单化类别统一取该类别的表单默认值（保证新建后「表单 ⇄ 源码」内容一致），
 * function 为命令文本，无表单结构。
 */
export function createEntryTemplate(
  category: DataPackCategory,
  /** 预留：引用本项目内容的模板将使用条目 ID（如进度标题） */
  _id: string,
  /** 预留：引用本项目内容的模板将使用命名空间 */
  _namespace: string
): string {
  if (category === 'function') return emptyFunctionTemplate()
  return `${JSON.stringify(createDatapackDefault(category), null, 2)}\n`
}
