/**
 * Forge / NeoForge 内置 FC 工具四件套：
 *
 * - forge_mods_toml_validate / neoforge_mods_toml_validate：
 *   校验 src/main/resources/META-INF/mods.toml（Forge）或 neoforge.mods.toml（NeoForge）
 *   的必填字段、modId 合法性、entrypoints 类文件存在性、依赖与许可证声明。
 * - forge_meta_version_check / neoforge_meta_version_check：
 *   查询 Forge maven 与 NeoForge maven 的最新加载器版本，离线/429 时软失败。
 *
 * 项目 loader 判定：读取 mods.toml / neoforge.mods.toml 是否存在；
 * gradle.properties 中 minecraft_version 提供 MC 版本兜底。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'smol-toml'
import {
  DEFAULT_ENDPOINTS,
  fetchTextResilient,
  parseMavenVersions,
  pickForgeVersion,
  pickNeoForgeVersion
} from '../upstreamSources'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

const JAVA_ROOT = join('src', 'main', 'java')
const FORGE_TOML = join('src', 'main', 'resources', 'META-INF', 'mods.toml')
const NEOFORGE_TOML = join('src', 'main', 'resources', 'META-INF', 'neoforge.mods.toml')

/** 简单 TOML 安全包装：smol-toml 的 parse 遇到非法输入会抛异常 */
function safeParseToml(text: string): Record<string, unknown> | null {
  try {
    const doc = parse(text)
    return typeof doc === 'object' && doc !== null && !Array.isArray(doc)
      ? (doc as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function readMcVersion(root: string): string {
  const p = join(root, 'gradle.properties')
  if (!existsSync(p)) return ''
  const m = /^minecraft_version\s*=\s*(.+)$/m.exec(readFileSync(p, 'utf-8'))
  return m ? m[1].trim() : ''
}

/** 检测项目 loader：以 mods.toml 存在性为准，避免 fabric.mod.json 误导。 */
function detectLoader(root: string): 'forge' | 'neoforge' | null {
  if (existsSync(join(root, FORGE_TOML))) return 'forge'
  if (existsSync(join(root, NEOFORGE_TOML))) return 'neoforge'
  return null
}

/* ------------------------------ mods.toml 校验 ------------------------------ */

function validateModsToml(
  root: string,
  relPath: string,
  loader: 'forge' | 'neoforge'
): { ok: boolean; text: string; errors: string[]; warnings: string[] } {
  const abs = join(root, relPath)
  const errors: string[] = []
  const warnings: string[] = []
  if (!existsSync(abs)) {
    return { ok: false, text: `未找到 ${relPath}`, errors: [`未找到 ${relPath}`], warnings }
  }
  const raw = readFileSync(abs, 'utf-8')
  const doc = safeParseToml(raw)
  if (!doc) {
    return { ok: false, text: `${relPath} 不是合法 TOML`, errors: ['TOML 解析失败'], warnings }
  }

  // modLoader / loaderVersion 与 loader 硬绑定
  const modLoader = asString(doc['modLoader'])
  if (!modLoader) {
    errors.push('缺少 modLoader 字段（通常为 javafml）')
  } else if (modLoader !== 'javafml') {
    warnings.push(`modLoader=${modLoader}：非 javafml 入口需自行确保可用`)
  }
  const loaderVersion = asString(doc['loaderVersion'])
  if (!loaderVersion) {
    errors.push(`缺少 loaderVersion 字段（${loader} 最低版本范围，如 [47,)）`)
  }

  // license
  if (!asString(doc['license'])) warnings.push('缺少 license 字段（建议 MIT 等）')

  // issueTrackerURL（可选）
  if (doc['issueTrackerURL'] !== undefined && typeof doc['issueTrackerURL'] !== 'string') {
    warnings.push('issueTrackerURL 应为字符串 URL')
  }

  // mods 数组
  const mods = doc['mods']
  if (!Array.isArray(mods) || mods.length === 0) {
    errors.push('缺少 [[mods]] 数组：至少声明一个 modId')
    return { ok: false, text: `${errors.length} 个错误\n${errors.map((e) => `- ${e}`).join('\n')}`, errors, warnings }
  }

  // entrypoints 与主类存在性校验
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i]
    if (typeof m !== 'object' || m === null) {
      errors.push(`[[mods]][${i}] 必须是表对象`)
      continue
    }
    const modId = asString(m['modId'])
    if (!modId) {
      errors.push(`[[mods]][${i}] 缺少 modId`)
      continue
    }
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(modId)) {
      errors.push(`modId=${modId}：必须 2..64 位小写字母/数字/_/-，且字母开头`)
    }
    const version = asString(m['version'])
    if (!version) warnings.push(`[[mods]][${i}] 缺少 version（Gradle 展开时用 "${version}" 占位）`)

    // entrypoints 校验（Forge/NeoForge 均为类名字符串）
    const entrypoints = m['entrypoints']
    if (entrypoints !== undefined) {
      if (typeof entrypoints !== 'object' || entrypoints === null || Array.isArray(entrypoints)) {
        errors.push(`[[mods]][${i}] entrypoints 必须是对象（如 { client = "..." }）`)
      } else {
        for (const [side, cls] of Object.entries(entrypoints as Record<string, unknown>)) {
          const clsName = asString(cls)
          if (!clsName) {
            errors.push(`[[mods]][${i}] entrypoints.${side} 必须是类名字符串`)
            continue
          }
          if (!/^[a-z][a-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(clsName)) {
            errors.push(`[[mods]][${i}] entrypoints.${side} 类名不像完整全限定名：${clsName}`)
            continue
          }
          const javaRel = join(JAVA_ROOT, `${clsName.replace(/\./g, '/')}.java`)
          if (!existsSync(join(root, javaRel))) {
            errors.push(`入口类文件不存在：${javaRel}（${side}）`)
          }
        }
      }
    }

    // dependencies 表
    const deps = m['dependencies']
    if (deps !== undefined && (typeof deps !== 'object' || deps === null || Array.isArray(deps))) {
      warnings.push(`[[mods]][${i}] dependencies 应为表（如 { minecraft = "[1.20.1,)" }）`)
    }
  }

  const text =
    errors.length === 0
      ? `${relPath} 校验通过 ✓（${warnings.length} 条警告）` +
        (warnings.length ? `\n${warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : '')
      : `${relPath} 发现 ${errors.length} 个错误${warnings.length ? `、${warnings.length} 条警告` : ''}：\n` +
        `${errors.map((e) => `- ✗ ${e}`).join('\n')}` +
        (warnings.length ? `\n警告：\n${warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : '')
  return { ok: errors.length === 0, text, errors, warnings }
}

/* ------------------------------ maven 版本查询 ------------------------------ */

async function fetchForgeVersions(mc: string): Promise<{ version: string | null; error?: string }> {
  try {
    const text = await fetchTextResilient([DEFAULT_ENDPOINTS.forgeMaven, DEFAULT_ENDPOINTS.forgeMavenMirror])
    const all = parseMavenVersions(text)
    const v = pickForgeVersion(all, mc)
    return { version: v }
  } catch (e) {
    return { version: null, error: (e as Error).message }
  }
}

async function fetchNeoForgeVersions(mc: string): Promise<{ version: string | null; error?: string }> {
  try {
    const text = await fetchTextResilient([
      DEFAULT_ENDPOINTS.neoforgeMaven,
      DEFAULT_ENDPOINTS.neoforgeMavenMirror
    ])
    const all = parseMavenVersions(text)
    const v = pickNeoForgeVersion(all, mc)
    return { version: v }
  } catch (e) {
    return { version: null, error: (e as Error).message }
  }
}

/* ------------------------------ 工具导出 ------------------------------ */

export function builtinForgeNeoTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* forge_mods_toml_validate */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'forge_mods_toml_validate',
        description:
          '校验当前 Forge 项目的 src/main/resources/META-INF/mods.toml：modLoader/loaderVersion/license 必填字段、' +
          '[[mods]] 数组中 modId 合法性、entrypoints 类文件存在性、dependencies 结构。' +
          '报 error 的项会导致构建或加载失败；warning 为规范提醒。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const loader = detectLoader(root)
      if (loader !== 'forge') {
        return { ok: false, text: '', error: `当前项目不是 Forge（检测为 ${loader ?? '未知'}）` }
      }
      const r = validateModsToml(root, FORGE_TOML, 'forge')
      return { ok: r.ok, text: clip(r.text), data: { valid: r.ok, errors: r.errors, warnings: r.warnings } }
    }
  })

  /* neoforge_mods_toml_validate */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'neoforge_mods_toml_validate',
        description:
          '校验当前 NeoForge 项目的 src/main/resources/META-INF/neoforge.mods.toml：modLoader/loaderVersion/license 必填字段、' +
          '[[mods]] 数组中 modId 合法性、entrypoints 类文件存在性、dependencies 结构。' +
          '报 error 的项会导致构建或加载失败；warning 为规范提醒。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const loader = detectLoader(root)
      if (loader !== 'neoforge') {
        return { ok: false, text: '', error: `当前项目不是 NeoForge（检测为 ${loader ?? '未知'}）` }
      }
      const r = validateModsToml(root, NEOFORGE_TOML, 'neoforge')
      return { ok: r.ok, text: clip(r.text), data: { valid: r.ok, errors: r.errors, warnings: r.warnings } }
    }
  })

  /* forge_meta_version_check */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'forge_meta_version_check',
        description:
          '查询 Maven 中央仓库（maven.minecraftforge.net）中 Forge 针对指定 MC 版本的最新加载器版本，' +
          '用于 build.gradle 中 forgeVersion 声明。离线/503/429 时软失败并返回错误说明。',
        parameters: {
          type: 'object',
          properties: {
            mcVersion: { type: 'string', description: 'Minecraft 版本，如 1.20.1；缺省读项目 gradle.properties' }
          },
          required: []
        }
      }
    },
    visibility: 'project',
    execute: async (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      let mc = asString(args['mcVersion']).trim()
      if (!mc) mc = readMcVersion(root)
      if (!mc) return { ok: false, text: '', error: '未提供 mcVersion 且 gradle.properties 中无 minecraft_version' }
      const r = await fetchForgeVersions(mc)
      if (r.error) return { ok: false, text: '', error: `查询 Forge maven 失败：${r.error}` }
      if (!r.version) return { ok: false, text: '', error: `Forge maven 中未找到 MC ${mc} 对应版本` }
      return {
        ok: true,
        text: `Forge ${mc} 最新加载器版本：${r.version}\n建议在 build.gradle 中声明为：forgeVersion = "${mc}-${r.version}"`,
        data: { mcVersion: mc, forgeVersion: r.version }
      }
    }
  })

  /* neoforge_meta_version_check */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'neoforge_meta_version_check',
        description:
          '查询 NeoForge Maven（maven.neoforged.net）中针对指定 MC 版本的最新 NeoForge 版本，' +
          '用于 build.gradle 中 neoForgeVersion 声明。离线/503/429 时软失败并返回错误说明。',
        parameters: {
          type: 'object',
          properties: {
            mcVersion: { type: 'string', description: 'Minecraft 版本，如 1.20.1；缺省读项目 gradle.properties' }
          },
          required: []
        }
      }
    },
    visibility: 'project',
    execute: async (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      let mc = asString(args['mcVersion']).trim()
      if (!mc) mc = readMcVersion(root)
      if (!mc) return { ok: false, text: '', error: '未提供 mcVersion 且 gradle.properties 中无 minecraft_version' }
      const r = await fetchNeoForgeVersions(mc)
      if (r.error) return { ok: false, text: '', error: `查询 NeoForge maven 失败：${r.error}` }
      if (!r.version) return { ok: false, text: '', error: `NeoForge maven 中未找到 MC ${mc} 对应版本线` }
      return {
        ok: true,
        text: `NeoForge ${mc} 最新加载器版本：${r.version}\n建议在 build.gradle 中声明为：neoForgeVersion = "${r.version}"`,
        data: { mcVersion: mc, neoForgeVersion: r.version }
      }
    }
  })

  return tools
}
