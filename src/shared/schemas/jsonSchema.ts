/**
 * JSON Schema draft-07 子集类型。
 * 仅覆盖 SchemaForm 表单框架可渲染的结构（object/string/number/integer/boolean/array/enum/keyValue），
 * 不表达完整 draft-07 规范（不支持 oneOf/allOf/$ref 等）。
 */

/** 动态键对象：键由用户输入（语言键、音效事件名、配方字母表等） */
export interface KeyValueSchema {
  /** 键列表头 */
  keyTitle?: string
  /** 值列表头 */
  valueTitle?: string
  keyPlaceholder?: string
  valuePlaceholder?: string
  /** 值的结构（缺省 string） */
  valueSchema?: JsonSchema
}

export interface JsonSchema {
  type?: string
  title?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  /** 数组元素的结构 */
  items?: JsonSchema
  /** 枚举可选值（渲染为下拉） */
  enum?: unknown[]
  /** 枚举各项的展示标签（与 enum 等长，缺省回落 String(value)） */
  enumLabels?: string[]
  /** 新建时的缺省值 */
  default?: unknown
  /** 控件下方的补充提示 */
  hint?: string
  /** 动态键对象（渲染为「键 - 值」行编辑，键由用户输入） */
  keyValue?: KeyValueSchema
}