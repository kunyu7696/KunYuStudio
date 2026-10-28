/**
 * Patchouli 指南书共享类型。
 *
 * 对应项目内 config/<namespace>/patchouli_books/<book>/ 目录：
 * - book.json：书名/简介/版本/创造栏
 * - en_us/categories/<id>.json：类目（name/description/icon/sortnum）
 * - en_us/entries/<cat>/<id>.json：条目（name/icon/category/pages[]）
 * 页面类型第一版覆盖 text / crafting / image / spotlight 四种表单。
 */

/** 条目页面（按 type 取对应字段） */
export interface PatchouliPage {
  type: 'text' | 'crafting' | 'image' | 'spotlight'
  /** text / crafting / spotlight 页的正文（可空） */
  text?: string
  /** crafting 页：配方 id（如 kunyu:steel_ingot） */
  recipe?: string
  /** image 页：图片资源 id 列表（如 kunyu:textures/gui/x.png） */
  images?: string[]
  /** image 页：标题（可空） */
  title?: string
  /** spotlight 页：展示物品 id */
  item?: string
}

/** 条目（en_us/entries/<cat>/<id>.json） */
export interface PatchouliEntry {
  id: string
  name: string
  icon: string
  pages: PatchouliPage[]
}

/** 类目（en_us/categories/<id>.json + 其 entries/ 子目录） */
export interface PatchouliCategory {
  id: string
  name: string
  description: string
  icon: string
  sortnum: number
  entries: PatchouliEntry[]
}

/** 整本手册（book.json + 类目树） */
export interface PatchouliBook {
  /** 宿主命名空间（config/<namespace>/ 目录名） */
  namespace: string
  /** 书 id（目录名，snake_case） */
  bookId: string
  name: string
  landingText: string
  version: number
  creativeTab: string
  categories: PatchouliCategory[]
}

/** 手册列表项 */
export interface PatchouliBookSummary {
  namespace: string
  bookId: string
  name: string
  categoryCount: number
  entryCount: number
}

/** 手册列表结果：附默认命名空间（模组项目为 modId）与解析警告 */
export interface PatchouliListResult {
  books: PatchouliBookSummary[]
  /** 新建手册时的默认命名空间（模组项目=modId；整合包为空串，由用户填） */
  defaultNamespace: string
  warnings: string[]
}
