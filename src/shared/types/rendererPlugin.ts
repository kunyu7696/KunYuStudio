/**
 * 渲染层声明式插件（v0：语言着色贡献点）。
 *
 * 与 MCP 工具插件并列的第二种插件形态：纯 JSON、零代码执行——
 * 插件用一个 plugin.json 声明 Monarch 语法高亮规则，主进程负责扫描、
 * 解析与校验，渲染层校验后注册进 Monaco。因为不可执行，渲染层插件
 * 天然不需要权限模型；这也是示例插件（resources/plugins/snbt-colors）
 * 与开发文档（docs/PLUGINS.md）所演示的形态。
 */

/** 语言贡献点：一门 Monarch 语法高亮语言 */
export interface LanguageContribution {
  /** 语言 id（小写字母开头，字母/数字/中划线；全局唯一，与内置语言冲突时跳过） */
  id: string
  /** 展示别名（Monaco 语言选择器显示名） */
  aliases?: string[]
  /** 关联文件扩展名（含点，如 [".snbt"]；打开对应文件时编辑器按此选择语言） */
  extensions?: string[]
  /**
   * Monarch tokenizer：内联对象，或相对插件目录的 JSON 文件名（如 "language.json"）。
   * JSON 中正则一律写成字符串（如 "#.*$"），Monaco 编译时再转 RegExp。
   */
  monarch: Record<string, unknown> | string
  /** 语言配置（注释符号/括号/自动闭合），对应 monaco.languages.LanguageConfiguration */
  configuration?: Record<string, unknown>
}

/** plugin.json 清单 */
export interface RendererPluginManifest {
  /** 插件 id（反向域名风格，如 kunyu.snbt-colors） */
  id: string
  name: string
  version: string
  description?: string
  author?: string
  contributes: {
    languages?: LanguageContribution[]
  }
}

/** 校验通过后、交给渲染层注册的插件载荷（monarch 引用已解析为内联对象） */
export interface LoadedRendererPlugin {
  manifest: RendererPluginManifest
  languages: Array<Omit<LanguageContribution, 'monarch'> & { monarch: Record<string, unknown> }>
  /** builtin = 安装包内置（官方示例）；user = 用户插件目录（userData/plugins） */
  origin: 'builtin' | 'user'
}

/** plugin:list-renderer 返回：坏插件不拖垮整体，逐个记入 errors */
export interface RendererPluginListResult {
  ok: boolean
  plugins: LoadedRendererPlugin[]
  /** 用户插件目录绝对路径（文档与 UI 提示用） */
  userPluginsDir: string
  errors: Array<{ pluginDir: string; error: string }>
}

export interface RendererPluginValidation {
  ok: boolean
  errors: string[]
  manifest?: RendererPluginManifest
}

const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/i
const LANGUAGE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/
const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.-]+)?$/
const EXTENSION_RE = /^\.[a-z0-9]{1,12}$/i
/** monarch 外部引用只允许插件目录内的简单 JSON 文件名（杜绝 ../ 目录逃逸） */
const MONARCH_FILE_RE = /^[\w.-]+\.json$/
const MAX_LANGUAGES = 10
const MAX_ARRAY_ITEMS = 8

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateLanguage(raw: unknown, index: number, errors: string[]): void {
  const at = `contributes.languages[${index}]`
  if (!isRecord(raw)) {
    errors.push(`${at} 必须是对象`)
    return
  }
  if (typeof raw.id !== 'string' || !LANGUAGE_ID_RE.test(raw.id)) {
    errors.push(`${at}.id 非法：需小写字母开头的字母/数字/中划线（≤32 字符）`)
  }
  if (raw.aliases !== undefined) {
    if (!Array.isArray(raw.aliases) || raw.aliases.length > MAX_ARRAY_ITEMS || !raw.aliases.every((a) => typeof a === 'string')) {
      errors.push(`${at}.aliases 必须是不超过 ${MAX_ARRAY_ITEMS} 项的字符串数组`)
    }
  }
  if (raw.extensions !== undefined) {
    if (
      !Array.isArray(raw.extensions) ||
      raw.extensions.length > MAX_ARRAY_ITEMS ||
      !raw.extensions.every((e) => typeof e === 'string' && EXTENSION_RE.test(e))
    ) {
      errors.push(`${at}.extensions 必须是不超过 ${MAX_ARRAY_ITEMS} 项的扩展名数组（如 ".snbt"）`)
    }
  }
  if (typeof raw.monarch === 'string') {
    if (!MONARCH_FILE_RE.test(raw.monarch)) {
      errors.push(`${at}.monarch 引用只允许插件目录内的简单 JSON 文件名（如 "language.json"）`)
    }
  } else if (!isRecord(raw.monarch)) {
    errors.push(`${at}.monarch 必须是对象或 JSON 文件名`)
  }
  if (raw.configuration !== undefined && !isRecord(raw.configuration)) {
    errors.push(`${at}.configuration 必须是对象`)
  }
}

/**
 * 校验 plugin.json 结构（主进程与渲染层共用同一份，双层防御）。
 * 只认白名单字段、只做结构校验；Monarch 内容本身由 Monaco 编译时兜底。
 */
export function validateRendererPlugin(raw: unknown): RendererPluginValidation {
  const errors: string[] = []
  if (!isRecord(raw)) {
    return { ok: false, errors: ['plugin.json 必须是 JSON 对象'] }
  }
  if (typeof raw.id !== 'string' || !PLUGIN_ID_RE.test(raw.id)) {
    errors.push('id 非法：需字母/数字开头，可含 . 与 -（≤64 字符）')
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0 || raw.name.length > 60) {
    errors.push('name 必须是 1-60 字符的非空字符串')
  }
  if (typeof raw.version !== 'string' || !VERSION_RE.test(raw.version)) {
    errors.push('version 必须是语义化版本号（如 1.0.0）')
  }
  if (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 200)) {
    errors.push('description 必须是不超过 200 字符的字符串')
  }
  if (raw.author !== undefined && (typeof raw.author !== 'string' || raw.author.length > 60)) {
    errors.push('author 必须是不超过 60 字符的字符串')
  }
  if (!isRecord(raw.contributes)) {
    errors.push('缺少 contributes 对象（当前支持的唯一贡献点：languages）')
  } else if (raw.contributes.languages !== undefined) {
    const langs = raw.contributes.languages
    if (!Array.isArray(langs) || langs.length === 0 || langs.length > MAX_LANGUAGES) {
      errors.push(`contributes.languages 必须是 1-${MAX_LANGUAGES} 项的数组`)
    } else {
      langs.forEach((l, i) => validateLanguage(l, i, errors))
    }
  }
  return errors.length === 0
    ? { ok: true, errors: [], manifest: raw as unknown as RendererPluginManifest }
    : { ok: false, errors }
}
