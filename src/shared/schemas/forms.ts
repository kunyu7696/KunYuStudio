/**
 * 包编辑器「表单 / 源码」双模式共用的类别表单定义。
 *
 * 表单只覆盖 JSON Schema 能表达的字段子集；保存时把表单值合并回原文档，
 * 因此表单未覆盖的字段（复杂条件、函数列表、elements 等）不会丢失。
 */
import type { JsonSchema } from './jsonSchema'
import { buildKeyValueText, parseKeyValueText } from './keyValueText'

/** 表单值（仅 schema 覆盖范围）与原文档上下文 */
export interface FormDoc {
  value: Record<string, unknown>
  /** 原文档上下文：JSON 类别为原始对象，键值文本类别为注释行数组 */
  context: unknown
}

/** 单个包文件类别的表单化定义 */
export interface CategoryForm {
  /** 驱动表单渲染的 JSON Schema */
  schema: JsonSchema
  /** 新建条目的表单初值（同时作为新建文件的内容） */
  createDefault(): Record<string, unknown>
  /** 文本 → 表单值；返回 null 表示无法表单化（编辑器回落源码模式） */
  parse(text: string): FormDoc | null
  /** 表单值（+ 原文档上下文）→ 文本 */
  serialize(value: Record<string, unknown>, context: unknown): string
  /** 表单模式提示（空串表示不显示） */
  formHint: string
  /** 源码模式提示（空串表示不显示） */
  sourceHint: string
}

/** 纯对象判定（数组与 null 不算） */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** JSON 文本 → 表单值；解析失败或根不是对象时返回 null */
function parseJsonDoc(text: string): FormDoc | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return isPlainObject(parsed) ? { value: parsed, context: parsed } : null
}

/** 表单值与原文档合并输出 JSON 文本 */
function serializeJsonDoc(value: Record<string, unknown>, context: unknown): string {
  const base = isPlainObject(context) ? context : {}
  return `${JSON.stringify({ ...base, ...value }, null, 2)}\n`
}

/** JSON 文件类别表单（模型、配方、标签等） */
export function createJsonForm(input: {
  schema: JsonSchema
  createDefault: () => Record<string, unknown>
  formHint: string
  sourceHint: string
}): CategoryForm {
  return {
    schema: input.schema,
    createDefault: input.createDefault,
    parse: parseJsonDoc,
    serialize: serializeJsonDoc,
    formHint: input.formHint,
    sourceHint: input.sourceHint
  }
}

/** key=value 文本类别表单（.lang / shaders.properties） */
export function createKeyValueTextForm(input: {
  schema: JsonSchema
  createDefault: () => Record<string, unknown>
  formHint: string
  sourceHint: string
}): CategoryForm {
  return {
    schema: input.schema,
    createDefault: input.createDefault,
    parse: (text) => {
      const doc = parseKeyValueText(text)
      const value: Record<string, unknown> = {}
      for (const e of doc.entries) value[e.key] = e.value
      return { value, context: doc.comments }
    },
    serialize: (value, context) =>
      buildKeyValueText({
        comments: Array.isArray(context)
          ? context.filter((c): c is string => typeof c === 'string')
          : [],
        entries: Object.entries(value).map(([key, v]) => ({
          key,
          value: v == null ? '' : String(v)
        }))
      }),
    formHint: input.formHint,
    sourceHint: input.sourceHint
  }
}