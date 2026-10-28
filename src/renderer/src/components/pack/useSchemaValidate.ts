/**
 * Ajv Schema 校验封装：按 schema 对象缓存编译结果，输出路径化的错误列表。
 * 供 SchemaForm 消费方（数据包 / 资源包 / 光影包表单）在保存前做结构校验。
 * schema 中的自定义关键字（keyValue / enumLabels / hint）在 strict:false 下被忽略。
 */
import Ajv, { type ValidateFunction } from 'ajv'
import { ref } from 'vue'
import type { JsonSchema } from '../../../../shared/schemas/jsonSchema'
import { t } from '../../i18n'

const ajv = new Ajv({ allErrors: true, strict: false })
/** 编译缓存：schema 是模块级常量对象，用 WeakMap 避免重复编译与内存泄漏 */
const compiled = new WeakMap<object, ValidateFunction>()

export function useSchemaValidate() {
  const errors = ref<string[]>([])

  /** 校验数据；失败时 errors 填充「路径 + 原因」列表 */
  function validate(schema: JsonSchema, data: unknown): boolean {
    let fn = compiled.get(schema)
    if (!fn) {
      fn = ajv.compile(schema)
      compiled.set(schema, fn)
    }
    const ok = fn(data)
    if (ok) {
      errors.value = []
      return true
    }
    errors.value = (fn.errors ?? []).map((e) => {
      const path = e.instancePath || '/'
      return `${path} ${e.message ?? t('pack.validateFailed')}`
    })
    return false
  }

  /** 清空错误（切换条目/进入新建时调用） */
  function reset(): void {
    errors.value = []
  }

  return { errors, validate, reset }
}