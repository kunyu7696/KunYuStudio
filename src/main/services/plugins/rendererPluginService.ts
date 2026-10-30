import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { isPackagedRuntime } from '../../runtimeEnv'
import type {
  LanguageContribution,
  LoadedRendererPlugin,
  RendererPluginListResult
} from '../../../shared/types/rendererPlugin'
import { validateRendererPlugin } from '../../../shared/types/rendererPlugin'

/**
 * 渲染层声明式插件扫描服务（主进程侧）。
 *
 * 两个扫描位置：
 * - 内置：安装包 resources/plugins（官方示例随包分发；dev 读仓库 resources/plugins）
 * - 用户：userData/plugins（用户/第三方插件投放点，每个子目录一个插件）
 *
 * 安全边界：插件是纯 JSON（零代码执行）；monarch 外部引用只允许插件目录内的
 * 简单文件名，读取时再判一次路径逃逸；坏插件不拖垮整体，逐个记入 errors。
 */

export function builtinPluginsDir(): string {
  return isPackagedRuntime(app)
    ? join(process.resourcesPath, 'plugins')
    : join(process.cwd(), 'resources', 'plugins')
}

export function userPluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

/** 加载单个插件目录：plugin.json → 校验 → 解析 monarch 外部引用为内联对象 */
async function loadOne(
  dir: string,
  origin: LoadedRendererPlugin['origin']
): Promise<LoadedRendererPlugin> {
  const raw: unknown = JSON.parse(await fs.readFile(join(dir, 'plugin.json'), 'utf8'))
  const v = validateRendererPlugin(raw)
  if (!v.ok || !v.manifest) {
    throw new Error(v.errors.join('；'))
  }
  const languages: LoadedRendererPlugin['languages'] = []
  for (const lang of v.manifest.contributes.languages ?? []) {
    languages.push({ ...lang, monarch: await resolveMonarch(dir, lang) })
  }
  return { manifest: v.manifest, languages, origin }
}

/** monarch 为字符串时读外部 JSON；路径必须落在插件目录内（双重防逃逸，校验器之外再判一次） */
async function resolveMonarch(dir: string, lang: LanguageContribution): Promise<Record<string, unknown>> {
  if (typeof lang.monarch !== 'string') return lang.monarch
  const target = resolve(dir, lang.monarch)
  if (!target.startsWith(resolve(dir) + sep)) {
    throw new Error(`monarch 引用越出插件目录：${lang.monarch}`)
  }
  const parsed: unknown = JSON.parse(await fs.readFile(target, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`monarch 文件必须是 JSON 对象：${lang.monarch}`)
  }
  return parsed as Record<string, unknown>
}

/** 扫描两个插件源并返回全部合法插件；目录不存在视为无插件（不报错） */
export async function listRendererPlugins(): Promise<RendererPluginListResult> {
  const plugins: LoadedRendererPlugin[] = []
  const errors: RendererPluginListResult['errors'] = []
  const sources: Array<{ dir: string; origin: LoadedRendererPlugin['origin'] }> = [
    { dir: builtinPluginsDir(), origin: 'builtin' },
    { dir: userPluginsDir(), origin: 'user' }
  ]
  for (const { dir, origin } of sources) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        plugins.push(await loadOne(join(dir, entry.name), origin))
      } catch (err) {
        errors.push({ pluginDir: `${origin}/${entry.name}`, error: (err as Error).message })
      }
    }
  }
  return { ok: true, plugins, userPluginsDir: userPluginsDir(), errors }
}
