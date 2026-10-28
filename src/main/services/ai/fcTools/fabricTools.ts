/**
 * Fabric 内置 FC 工具五件套：
 *
 * - fabric_meta_version_check：查询 meta.fabricmc.net 指定 MC 版本的最新 Fabric Loader 版本
 *   （离线/503/429 软失败）。
 * - fabric_javadoc_lookup：Yarn 1.20.1 类/方法签名速查——内置高频类表（与 mixin 工具同源）+
 *   mcdev-mcp 就绪时实时反编译签名 + Fabric 语料兜底。写代码前必须先查，禁止凭记忆编造。
 * - fabric_template_generate：从 AI 参考包取 Fabric 模板（list 或按 id），做 modId/package/
 *   className 占位替换后可写盘（仅项目根内），落盘后提示 gradle_build 验证。
 * - fabric_content_register：生成 Fabric 注册骨架（Registry.register(Registries.X,
 *   new Identifier(modId, name), ...)），支持 item/block/entity，可选写盘。
 * - fabric_data_assets_generate：生成 assets/data JSON 骨架（blockstate/模型/配方/战利品表/
 *   lang 条目），命名空间取自 fabric.mod.json 的 id，可选写盘。
 *
 * 所有写盘路径限定当前打开项目根内，防 `..` 遍历；已存在文件需 overwrite=true。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { httpGetText } from '../../httpUtil'
import { getKnowledgeBase } from '../../knowledgeSearch'
import { DEFAULT_ENDPOINTS, maxVersion, parseFabricLoaderVersions } from '../upstreamSources'
import type { ContentType } from '../../../../shared/types/aiReference'
import { dataPath } from '../../../../shared/dataPath'
import {
  blockSettingsExpr,
  blockSettingsImport,
  identifierFactoryCall,
  isModernBlockSettings,
  registryImports,
  registriesConst
} from '../../../templates/fabricTemplates'
import { YARN_TARGETS } from './mixinTools'
import type { McpToolPort, RegisteredTool, ToolRegistryDeps } from '../toolRegistry'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

const JAVA_ROOT = join('src', 'main', 'java')
const RESOURCES_ROOT = join('src', 'main', 'resources')
const FABRIC_MOD_JSON = join(RESOURCES_ROOT, 'fabric.mod.json')

const ID_RE = /^[a-z][a-z0-9_]*$/
const FQCN_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

function readMcVersion(root: string): string {
  const p = join(root, 'gradle.properties')
  if (!existsSync(p)) return ''
  const m = /^minecraft_version\s*=\s*(.+)$/m.exec(readFileSync(p, 'utf-8'))
  return m ? m[1]!.trim() : ''
}

/** 从 gradle.properties 读 maven_group；失败回退 com.<modid>。 */
function resolvePackage(root: string, modId: string): string {
  const p = join(root, 'gradle.properties')
  if (existsSync(p)) {
    const m = /^maven_group\s*=\s*(.+)$/m.exec(readFileSync(p, 'utf-8'))
    if (m && FQCN_RE.test(m[1]!.trim())) return m[1]!.trim()
  }
  return `com.${modId.replace(/[^a-z0-9_]/g, '_') || 'examplemod'}`
}

function readProjectModId(root: string): string {
  const p = join(root, FABRIC_MOD_JSON)
  if (!existsSync(p)) throw new Error('未找到 src/main/resources/fabric.mod.json（需要 Fabric 项目）')
  const json = JSON.parse(readFileSync(p, 'utf-8')) as { id?: unknown }
  if (typeof json.id !== 'string' || !ID_RE.test(json.id)) throw new Error('fabric.mod.json 缺少合法 id')
  return json.id
}

/** 写盘：仅项目根内；已存在需 overwrite=true。返回相对路径。 */
function writeInProject(
  root: string,
  relPath: string,
  content: string,
  overwrite: boolean
): { ok: boolean; rel?: string; error?: string } {
  const abs = resolve(root, normalize(relPath))
  const rel = relative(resolve(root), abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, error: `目标路径越界：${relPath}` }
  }
  if (existsSync(abs) && !overwrite) {
    return { ok: false, error: `文件已存在：${rel}（如需覆盖请 overwrite=true）` }
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf-8')
  return { ok: true, rel }
}

/* ------------------------------ meta 版本查询 ------------------------------ */

async function fetchFabricLoader(mc: string): Promise<{ version: string | null; error?: string }> {
  try {
    const { text } = await httpGetText(DEFAULT_ENDPOINTS.fabricLoader(mc))
    return { version: maxVersion(parseFabricLoaderVersions(text)) }
  } catch (e) {
    return { version: null, error: (e as Error).message }
  }
}

/* ------------------------------ 内容注册骨架 ------------------------------ */

type RegisterKind = 'item' | 'block' | 'entity'

function registerSnippet(
  kind: RegisterKind,
  pkg: string,
  modId: string,
  name: string,
  className: string,
  mcVersion: string
): string {
  const constName = name.toUpperCase()
  // registry 包/常量、Identifier 工厂、BlockSettings 均按项目版本分派
  const newIdentifier = identifierFactoryCall(mcVersion)
  const idExpr = (a: string, b: string): string =>
    newIdentifier === 'Identifier.of' ? `Identifier.of(${a}, ${b})` : `new Identifier(${a}, ${b})`
  if (kind === 'item') {
    const settingsCtor = isModernBlockSettings(mcVersion) ? 'new Item.Settings()' : 'new FabricItemSettings()'
    const settingsImport = isModernBlockSettings(mcVersion) ? '' : `import net.fabricmc.fabric.api.item.v1.FabricItemSettings;\n`
    return (
      `package ${pkg}.registry;\n\n` +
      settingsImport +
      `import net.minecraft.item.Item;\n` +
      registryImports(mcVersion) +
      `import net.minecraft.util.Identifier;\n\n` +
      `/** ${modId} 物品注册表。在 ModInitializer.onInitialize 中调用 registerAll()。 */\n` +
      `public final class ${className} {\n` +
      `    public static final String MOD_ID = "${modId}";\n\n` +
      `    public static final Item ${constName} = register("${name}", new Item(${settingsCtor}));\n\n` +
      `    public static Item register(String name, Item item) {\n` +
      `        return Registry.register(${registriesConst(mcVersion, 'ITEM')}, ${idExpr('MOD_ID', 'name')}, item);\n` +
      `    }\n\n` +
      `    /** 触发类加载完成静态注册。 */\n` +
      `    public static void registerAll() {\n` +
      `        @SuppressWarnings("unused")\n` +
      `        Item ensureClassInit = ${constName};\n` +
      `    }\n\n` +
      `    private ${className}() {\n` +
      `    }\n` +
      `}\n`
    )
  }
  if (kind === 'block') {
    return (
      `package ${pkg}.registry;\n\n` +
      `` +
      blockSettingsImport(mcVersion) +
      `import net.minecraft.block.Block;\n` +
      `import net.minecraft.block.Blocks;\n` +
      registryImports(mcVersion) +
      `import net.minecraft.util.Identifier;\n\n` +
      `/** ${modId} 方块注册表。在 ModInitializer.onInitialize 中调用 registerAll()。 */\n` +
      `public final class ${className} {\n` +
      `    public static final String MOD_ID = "${modId}";\n\n` +
      `    public static final Block ${constName} = register("${name}", new Block(${blockSettingsExpr(mcVersion)}));\n\n` +
      `    public static Block register(String name, Block block) {\n` +
      `        return Registry.register(${registriesConst(mcVersion, 'BLOCK')}, ${idExpr('MOD_ID', 'name')}, block);\n` +
      `    }\n\n` +
      `    /** 方块通常还需对应 BlockItem：Registry.register(${registriesConst(mcVersion, 'ITEM')}, id, new BlockItem(block, ${isModernBlockSettings(mcVersion) ? 'new Item.Settings()' : 'new FabricItemSettings()'}))。 */\n` +
      `    public static void registerAll() {\n` +
      `        @SuppressWarnings("unused")\n` +
      `        Block ensureClassInit = ${constName};\n` +
      `    }\n\n` +
      `    private ${className}() {\n` +
      `    }\n` +
      `}\n`
    )
  }
  // entity
  return (
    `package ${pkg}.registry;\n\n` +
    `import net.fabricmc.fabric.api.object.builder.v1.entity.FabricEntityTypeBuilder;\n` +
    `import net.minecraft.entity.EntityDimensions;\n` +
    `import net.minecraft.entity.EntityType;\n` +
    `import net.minecraft.entity.SpawnGroup;\n` +
    registryImports(mcVersion) +
    `import net.minecraft.util.Identifier;\n\n` +
    `/** ${modId} 实体注册表。EntityClass 需替换为真实实体类；在 ModInitializer.onInitialize 中调用 registerAll()。 */\n` +
    `public final class ${className} {\n` +
    `    public static final String MOD_ID = "${modId}";\n\n` +
    `    // TODO: EntityClass 替换为真实实体类（如自定义 class 或 ZombieEntity）后，取消下方注释：\n` +
    `    // public static final EntityType<EntityClass> ${constName} = Registry.register(\n` +
    `    //         ${registriesConst(mcVersion, 'ENTITY_TYPE')},\n` +
    `    //         ${idExpr('MOD_ID', `"${name}"`)},\n` +
    `    //         FabricEntityTypeBuilder.create(SpawnGroup.CREATURE, EntityClass::new)\n` +
    `    //                 .dimensions(EntityDimensions.fixed(0.6f, 1.8f)).build());\n\n` +
    `    /** 触发类加载完成静态注册（实体字段就绪后自动注册）。 */\n` +
    `    public static void registerAll() {\n` +
    `    }\n\n` +
    `    private ${className}() {\n` +
    `    }\n` +
    `}\n`
  )
}

/* ------------------------------ assets/data JSON ------------------------------ */

type DataKind = 'blockstate' | 'model_block' | 'model_item' | 'recipe_shapeless' | 'loot_table_block' | 'lang_entry'

interface DataOutput {
  relPath: string
  content: string
}

function dataAssetsSnippet(
  kind: DataKind,
  ns: string,
  name: string,
  extra: { resultItem: string; ingredient: string; langKey: string; langValue: string },
  root: string
): DataOutput | { error: string } {
  const assets = (p: string): string => join(RESOURCES_ROOT, 'assets', ns, p).replace(/\\/g, '/')
  const data = (p: string): string => join(RESOURCES_ROOT, 'data', ns, p).replace(/\\/g, '/')
  // 数据目录按项目版本单数化（1.21+ recipe/loot_table）
  const mc = readMcVersion(root)
  const pretty = (o: unknown): string => `${JSON.stringify(o, null, 2)}\n`

  switch (kind) {
    case 'blockstate':
      return {
        relPath: assets(join('blockstates', `${name}.json`)),
        content: pretty({ variants: { '': { model: `${ns}:block/${name}` } } })
      }
    case 'model_block':
      return {
        relPath: assets(join('models', 'block', `${name}.json`)),
        content: pretty({
          parent: 'minecraft:block/cube_all',
          textures: { all: `${ns}:block/${name}` }
        })
      }
    case 'model_item':
      return {
        relPath: assets(join('models', 'item', `${name}.json`)),
        content: pretty({
          parent: 'minecraft:item/generated',
          textures: { layer0: `${ns}:item/${name}` }
        })
      }
    case 'recipe_shapeless':
      if (!extra.resultItem || !extra.ingredient) {
        return { error: 'recipe_shapeless 需要 resultItem 与 ingredient（注册名或裸名）' }
      }
      return {
        relPath: data(join(dataPath('recipe', mc), `${name}.json`)),
        content: pretty({
          type: 'minecraft:crafting_shapeless',
          category: 'misc',
          ingredients: [
            { item: extra.ingredient.includes(':') ? extra.ingredient : `${ns}:${extra.ingredient}` }
          ],
          result: {
            item: extra.resultItem.includes(':') ? extra.resultItem : `${ns}:${extra.resultItem}`,
            count: 1
          }
        })
      }
    case 'loot_table_block':
      return {
        relPath: data(join(dataPath('loot_table', mc), 'blocks', `${name}.json`)),
        content: pretty({
          type: 'minecraft:block',
          pools: [
            {
              bonus_rolls: 0.0,
              conditions: [{ condition: 'minecraft:survives_explosion' }],
              entries: [{ type: 'minecraft:item', name: `${ns}:${name}` }],
              rolls: 1.0
            }
          ]
        })
      }
    case 'lang_entry': {
      if (!extra.langKey || !extra.langValue) {
        return { error: 'lang_entry 需要 langKey 与 langValue（如 item.examplemod.example_item / Example Item）' }
      }
      const relPath = assets(join('lang', 'en_us.json'))
      let doc: Record<string, string> = {}
      const abs = join(root, relPath)
      if (existsSync(abs)) {
        try {
          const raw = JSON.parse(readFileSync(abs, 'utf-8')) as unknown
          if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
            for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
              if (typeof v === 'string') doc[k] = v
            }
          }
        } catch {
          return { error: `${relPath} 已存在但不是合法 JSON，请先修复或另选 kind` }
        }
      }
      doc[extra.langKey] = extra.langValue
      return { relPath, content: pretty(doc) }
    }
  }
}

/* ------------------------------ 工具导出 ------------------------------ */

export function builtinFabricTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* fabric_meta_version_check */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'fabric_meta_version_check',
        description:
          '查询 meta.fabricmc.net 中指定 MC 版本的最新 Fabric Loader 版本，' +
          '用于 gradle.properties 中 loader_version 声明。离线/503/429 时软失败并返回错误说明。',
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
      const r = await fetchFabricLoader(mc)
      if (r.error) return { ok: false, text: '', error: `查询 Fabric meta 失败：${r.error}` }
      if (!r.version) return { ok: false, text: '', error: `Fabric meta 中未找到 MC ${mc} 对应加载器版本` }
      return {
        ok: true,
        text: `Fabric Loader ${mc} 最新版本：${r.version}\n建议在 gradle.properties 中声明为：loader_version=${r.version}`,
        data: { mcVersion: mc, loaderVersion: r.version }
      }
    }
  })

  /* fabric_javadoc_lookup */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'fabric_javadoc_lookup',
        description:
          '查 Yarn 1.20.1 类/方法签名：内置高频类速查（类名/方法/端侧/建议），mcdev-mcp 就绪时追加实时反编译签名' +
          '（注意其索引可能是 Mojang official 名，写 Yarn 代码时以内置速查/语料为准），并附 Fabric 语料片段。' +
          '写 Registry/Item/Block/Screen 等代码前必须先查，禁止凭记忆编造类名与方法签名。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '类/方法关键词，如 MinecraftClient tick、Item、Screen render' },
            className: { type: 'string', description: '已知完整类名时直接给（如 net.minecraft.item.Item）' },
            methodName: { type: 'string', description: '连同 className 给定时查具体方法签名' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const query = asString(args['query']).trim()
      const className = asString(args['className']).trim()
      const methodName = asString(args['methodName']).trim()
      const tokens = (className || query)
        .toLowerCase()
        .split(/[\s.#,，、/]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)
      const methodTok = methodName.toLowerCase()
      const matched = tokens.length
        ? YARN_TARGETS.filter((t) => {
            const hay = [t.clazz, t.simple, ...t.methods, ...t.aliases].join('\n').toLowerCase()
            const classHit = tokens.some((tok) => hay.includes(tok))
            const methodHit = methodTok && t.methods.some((m) => m.toLowerCase().includes(methodTok))
            return methodTok ? classHit && methodHit : classHit
          })
        : []

      const lines: string[] = []
      if (tokens.length > 0 && matched.length > 0) {
        lines.push('## Yarn 1.20.1 内置速查命中')
        for (const t of matched) {
          lines.push(
            `### ${t.clazz}（${t.side} 侧）\n方法：\n${t.methods.map((m) => `- ${m}`).join('\n')}\n说明：${t.note}`
          )
        }
      } else if (tokens.length) {
        lines.push(`内置速查未命中「${className || query}」，以下为 mcdev 实时检索与语料结果。`)
      } else {
        lines.push(`## Yarn 1.20.1 常用类速查（共 ${YARN_TARGETS.length} 条，给 query/className 可过滤）`)
        for (const t of YARN_TARGETS) lines.push(`- [${t.side}] ${t.clazz}：${t.methods.slice(0, 3).join('、')}`)
      }

      // mcdev 实时映射（就绪时）
      const mcp: McpToolPort | undefined = deps.mcp
      if (mcp && mcp.isEnabled() && mcp.getStatus().kind === 'ready') {
        try {
          let res: { ok: boolean; text: string; error?: string }
          if (className && methodName) {
            res = await mcp.callStaticTool('mc_get_method', { className, methodName })
          } else if (className) {
            res = await mcp.callStaticTool('mc_get_class', { className, view: 'methods' })
          } else if (query) {
            res = await mcp.callStaticTool('mc_search', { query, type: 'class', limit: 8 })
          } else {
            res = { ok: true, text: '' }
          }
          if (res.text) {
            lines.push('## mcdev 实时映射（注意核对 Yarn/official 映射差异；可用 mcdev_mc_search 再查）\n' + res.text)
          }
          if (!res.ok) lines.push(`mcdev 查询失败：${res.error ?? '未知错误'}`)
        } catch (e) {
          lines.push(`mcdev 查询异常（已忽略）：${(e as Error).message}`)
        }
      } else {
        lines.push('（mcdev-mcp 未就绪：未做实时反编译核对；关键签名请用 fabric_docs_search 交叉确认）')
      }

      // 语料兜底
      const kb = getKnowledgeBase('fabric')
      if (kb.available()) {
        const q = [className, methodName, query].filter(Boolean).join(' ') || 'Yarn 映射 类 方法 签名'
        const hits = kb.search(q, 3)
        if (hits.length > 0) {
          lines.push('## 内置 Fabric 语料相关片段')
          for (const h of hits) {
            const excerpt = h.chunk.text.length > 600 ? `${h.chunk.text.slice(0, 600)}…` : h.chunk.text
            lines.push(`### ${h.chunk.title}\n${excerpt}`)
          }
        }
      }

      return { ok: true, text: clip(lines.join('\n\n')), data: { builtinMatches: matched.length } }
    }
  })

  /* fabric_template_generate */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'fabric_template_generate',
        description:
          '从 AI 参考包取 Fabric 模板：不给 templateId 时按 query/type 列出可用模板（含验证状态）；' +
          '给 templateId 时返回模板全文，并按 modId/packageName/className 做占位替换（examplemod→modId、' +
          'com.example.mod→包名、ExampleMod→类名）。write=true 时落盘 targetPath（仅项目根内，已存在需 overwrite），' +
          '落盘后必须用 gradle_build 验证编译。',
        parameters: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: '模板 id，如 fabric/1.20.1/item/simple_item.java' },
            query: { type: 'string', description: '列表模式关键词，匹配 id/file/keywords' },
            type: { type: 'string', description: '列表模式按内容类型过滤，如 item/block/entity/mixin/recipe' },
            mcVersion: { type: 'string', description: '模板组合版本，缺省读 gradle.properties 的 minecraft_version' },
            params: {
              type: 'object',
              description: '占位替换：{ modId?, packageName?, className? }，缺省从项目 fabric.mod.json / gradle.properties 推导',
              properties: {
                modId: { type: 'string' },
                packageName: { type: 'string' },
                className: { type: 'string' }
              }
            },
            write: { type: 'boolean', description: 'true 时落盘 targetPath' },
            targetPath: { type: 'string', description: 'write 时的项目内相对路径，如 src/main/java/com/x/ModItems.java' },
            overwrite: { type: 'boolean', description: '允许覆盖已存在文件' }
          },
          required: []
        }
      }
    },
    visibility: 'fabric-project',
    execute: async (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const reference = deps.reference
      if (!reference) return { ok: false, text: '', error: 'AI 参考包服务不可用（deps.reference 未注入）' }
      if (!reference.isLoaded()) {
        return { ok: false, text: '', error: `AI 参考包未加载：${reference.loadError() ?? 'unknown'}` }
      }
      const mc = asString(args['mcVersion']).trim() || readMcVersion(root) || '1.20.1'

      const templateId = asString(args['templateId']).trim()
      if (!templateId) {
        // 列表模式
        const query = asString(args['query']).trim().toLowerCase()
        const type = asString(args['type']).trim() as ContentType
        let list = reference.listTemplates('fabric', mc, type ? [type] : undefined)
        if (list.length === 0) {
          // 组合未激活时退一步：直接扫 manifest 的 fabric 模板（仍可读）
          const all = reference.getManifest()?.templates.filter((t) => t.loader === 'fabric') ?? []
          list = all.filter((t) => !type || t.contentTypes.includes(type))
          if (list.length > 0) {
            list = list.filter((t) => t.version === mc)
          }
        }
        if (query) {
          list = list.filter((t) =>
            [t.id, t.file, t.filename, ...(t.keywords ?? [])].join('\n').toLowerCase().includes(query)
          )
        }
        if (list.length === 0) {
          return { ok: false, text: '', error: `未找到匹配模板（fabric/${mc}${query ? `，query=${query}` : ''}）` }
        }
        const lines = list.map(
          (t) =>
            `- ${t.id}（${t.contentTypes.join('/')}，build=${t.build}，verified=${t.verified ?? '未回测'}）`
        )
        return {
          ok: true,
          text: clip(`可用 Fabric 模板（${list.length} 个）：\n${lines.join('\n')}\n\n用 templateId 取全文。`),
          data: { count: list.length, ids: list.map((t) => t.id) }
        }
      }

      // 取模板全文
      const tpl = reference.readTemplate(templateId)
      if (!tpl) return { ok: false, text: '', error: `模板不存在：${templateId}` }

      const p = (args['params'] ?? {}) as Record<string, unknown>
      let modId = asString(p['modId']).trim()
      if (!modId) {
        try {
          modId = readProjectModId(root)
        } catch {
          modId = ''
        }
      }
      const pkg = asString(p['packageName']).trim() || resolvePackage(root, modId || 'examplemod')
      const className = asString(p['className']).trim()

      let content = tpl.content
      if (modId && modId !== 'examplemod') content = content.split('examplemod').join(modId)
      content = content.split('com.example.mod').join(pkg)
      if (className && /^[A-Z][A-Za-z0-9_]*$/.test(className)) {
        content = content.split('ExampleMod').join(className)
      }

      const header =
        `模板：${tpl.id}（${tpl.file}，build=${tpl.build}，verified=${tpl.verified ?? '未回测'}）\n` +
        `替换：modId=${modId || '(保留 examplemod)'}，package=${pkg}${className ? `，class=${className}` : ''}`

      if (args['write'] === true) {
        const targetPath = asString(args['targetPath']).trim()
        if (!targetPath) return { ok: false, text: '', error: 'write=true 时必须提供 targetPath' }
        const w = writeInProject(root, targetPath, content, args['overwrite'] === true)
        if (!w.ok) return { ok: false, text: '', error: w.error ?? '写入失败' }
        return {
          ok: true,
          text: clip(`${header}\n已写入 ${w.rel}\n下一步：执行 gradle_build 验证编译。`),
          data: { path: w.rel, templateId: tpl.id }
        }
      }
      return { ok: true, text: clip(`${header}\n\n${content}`), data: { templateId: tpl.id } }
    }
  })

  /* fabric_content_register */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'fabric_content_register',
        description:
          '生成 Fabric 注册类骨架（Registry.register(Registries.ITEM/BLOCK/ENTITY_TYPE, ' +
          'new Identifier(modId, name), ...)），含 registerAll() 触发类加载。' +
          'write=true 时落盘 src/main/java/<包名>/registry/<className>.java（已存在需 overwrite），落盘后必须 gradle_build 验证。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['item', 'block', 'entity'], description: '注册内容类型' },
            name: { type: 'string', description: '注册 id（小写蛇形，如 ruby_pickaxe）' },
            className: { type: 'string', description: '注册类名，缺省 ModItems/ModBlocks/ModEntities' },
            write: { type: 'boolean' },
            overwrite: { type: 'boolean' }
          },
          required: ['kind', 'name']
        }
      }
    },
    visibility: 'fabric-project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const kind = asString(args['kind']) as RegisterKind
      if (kind !== 'item' && kind !== 'block' && kind !== 'entity') {
        return { ok: false, text: '', error: 'kind 必须是 item / block / entity' }
      }
      const name = asString(args['name']).trim()
      if (!ID_RE.test(name)) {
        return { ok: false, text: '', error: `name=${name} 非法：必须小写字母开头的小写蛇形 id` }
      }
      let modId: string
      try {
        modId = readProjectModId(root)
      } catch (e) {
        return { ok: false, text: '', error: (e as Error).message }
      }
      const pkg = resolvePackage(root, modId)
      const className =
        asString(args['className']).trim() ||
        (kind === 'item' ? 'ModItems' : kind === 'block' ? 'ModBlocks' : 'ModEntities')
      const java = registerSnippet(
        kind,
        pkg,
        modId,
        name,
        className,
        readMcVersion(root) || '1.20.1'
      )

      if (args['write'] === true) {
        const rel = join(JAVA_ROOT, ...pkg.split('.'), 'registry', `${className}.java`)
        const w = writeInProject(root, rel, java, args['overwrite'] === true)
        if (!w.ok) return { ok: false, text: '', error: w.error ?? '写入失败' }
        return {
          ok: true,
          text:
            `已写入 ${w.rel}\n` +
            `在 ModInitializer.onInitialize 中调用 ${className}.registerAll();\n` +
            `下一步：执行 gradle_build 验证编译。`,
          data: { path: w.rel, className, modId }
        }
      }
      return { ok: true, text: clip(java), data: { className, modId } }
    }
  })

  /* fabric_data_assets_generate */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'fabric_data_assets_generate',
        description:
          '生成 Fabric assets/data JSON 骨架并可选落盘：blockstate（方块状态）、model_block（cube_all 方块模型）、' +
          'model_item（item/generated 物品模型）、recipe_shapeless（无序配方，需 resultItem/ingredient）、' +
          'loot_table_block（方块掉落自身）、lang_entry（合并进 en_us.json，需 langKey/langValue）。' +
          '命名空间自动取 fabric.mod.json 的 id；落盘仅项目根内，已存在需 overwrite。',
        parameters: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['blockstate', 'model_block', 'model_item', 'recipe_shapeless', 'loot_table_block', 'lang_entry']
            },
            name: { type: 'string', description: '内容 id（小写蛇形；lang_entry 可省略）' },
            resultItem: { type: 'string', description: 'recipe_shapeless：产物注册名' },
            ingredient: { type: 'string', description: 'recipe_shapeless：原料注册名' },
            langKey: { type: 'string', description: 'lang_entry：键，如 item.examplemod.example_item' },
            langValue: { type: 'string', description: 'lang_entry：显示文本' },
            write: { type: 'boolean' },
            overwrite: { type: 'boolean' }
          },
          required: ['kind']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const kind = asString(args['kind']) as DataKind
      let modId: string
      try {
        modId = readProjectModId(root)
      } catch (e) {
        return { ok: false, text: '', error: (e as Error).message }
      }
      let name = asString(args['name']).trim()
      if (kind !== 'lang_entry') {
        if (!ID_RE.test(name)) {
          return { ok: false, text: '', error: `name=${name} 非法：必须小写字母开头的小写蛇形 id` }
        }
      } else if (!name) {
        name = 'en_us'
      }
      const out = dataAssetsSnippet(
        kind,
        modId,
        name,
        {
          resultItem: asString(args['resultItem']).trim(),
          ingredient: asString(args['ingredient']).trim(),
          langKey: asString(args['langKey']).trim(),
          langValue: asString(args['langValue']).trim()
        },
        root
      )
      if ('error' in out) return { ok: false, text: '', error: out.error }

      if (args['write'] === true) {
        const w = writeInProject(root, out.relPath, out.content, args['overwrite'] === true)
        if (!w.ok) return { ok: false, text: '', error: w.error ?? '写入失败' }
        return {
          ok: true,
          text: `已写入 ${w.rel}\n下一步：执行 gradle_build 验证资源打包。`,
          data: { path: w.rel, kind }
        }
      }
      return { ok: true, text: clip(`# ${out.relPath}\n${out.content}`), data: { path: out.relPath, kind } }
    }
  })

  return tools
}
