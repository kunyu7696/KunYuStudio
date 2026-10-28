/**
 * 只读检索类 chat 工具（从 toolRegistry.ts builtinChatTools 拆出）：
 * template_search / kb_search / mc_data_lookup / fabric_docs_search / mc_wiki_search /
 * error_analyze / version_check / api_validate / project_grep / read_project_file。
 *
 * 其他域片段（gameControl/content/recipe/mixin/validation/forgeNeo/fabric/market）
 * 的聚合在 toolRegistry.ts 的 createToolRegistry 中完成，本文件只含只读检索。
 */
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { clipToolText } from './textClip'
import { PROJECT_SOURCE_FILE_EXT_ALLOWED, PROJECT_SOURCE_FILE_EXT_RE } from './projectFilePolicy'
import { searchProjectCode } from '../projectGrep'
import { corpusLabel, formatHits, getKnowledgeBase, type KnowledgeCorpus } from '../../knowledgeSearch'
import type { McDataKind } from '../../mcDataService'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'

export function builtinRetrievalTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'template_search',
        description:
          '检索本地参考包中已验证的 Minecraft 模组代码模板与官方示例工程（Fabric/Forge/NeoForge）。' +
          '生成代码前必须先调用本工具获取模板与 API 用法。' +
          '注意：模板以代码结构为准，具体 API 签名以当前项目版本为准；版本差异点应再用 kb_search 或 web_search 确认。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索关键词（中文或英文均可）' },
            types: {
              type: 'array',
              items: { type: 'string' },
              description: '内容类型过滤：block/item/entity/recipe/gui/mixin/worldgen/advancement/command/enchantment/tag/project'
            },
            limit: { type: 'number', description: '返回模板数量上限，默认 6' }
          },
          required: ['query']
        }
      }
    },
    execute: (args, ctx) => {
      const cb = deps.contextBuilder
      if (!cb) return { ok: false, text: '', error: 'contextBuilder 不可用' }
      const query = typeof args['query'] === 'string' ? args['query'] : ''
      if (!query) return { ok: false, text: '', error: 'query 不能为空' }
      const types = Array.isArray(args['types'])
        ? (args['types'].filter((v): v is string => typeof v === 'string') as never)
        : (cb.detectContentTypes(query) as never)
      const limit = typeof args['limit'] === 'number' ? Math.min(12, Math.max(1, args['limit'])) : 6
      const templates = cb
        .getTemplateContents(ctx.loader, ctx.mcVersion, types, query)
        .slice(0, limit)
      const text =
        templates.length === 0
          ? '参考包未命中模板；请凭版本指纹谨慎生成，避免编造 API。'
          : templates
              .map(
                (t) =>
                  `===== 模板 ${t.id}（${t.file}，${t.build === 'pass' ? '编译已验证' : '未验证'}）=====\n${t.content}`
              )
              .join('\n\n')
      return {
        ok: true,
        text: clipToolText(text),
        data: { count: templates.length, ids: templates.map((t) => t.id) }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'kb_search',
        description:
          '本地知识库语义检索（本机 embedding，离线可用）：覆盖参考包全部模板源码、系统提示与说明文档，' +
          '比 template_search 粒度更细（按代码片段命中）。' +
          '在编写注册类代码（Blocks/Items/EntityType 注册、Identifier、Registry key）或拿不准标准 ID / Yarn 映射名之前，' +
          '必须先调用本工具取得本地实证片段，严禁凭记忆编造类名或 ID。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '自然语言问题或要找的 API/标识符，如“如何注册一个自定义方块 Identifier of”' },
            limit: { type: 'number', description: '返回片段数上限，默认 6，最大 10' }
          },
          required: ['query']
        }
      }
    },
    visibility: 'kb-rag',
    execute: async (args) => {
      if (!deps.kbRag) return { ok: false, text: '', error: '本地知识库（RAG）未启用' }
      const query = typeof args['query'] === 'string' ? args['query'] : ''
      if (!query.trim()) return { ok: false, text: '', error: 'query 不能为空' }
      const limit = typeof args['limit'] === 'number' ? Math.min(10, Math.max(1, Math.trunc(args['limit']))) : 6
      const kb = await deps.kbRag()
      if (!kb) return { ok: false, text: '', error: '本地知识库初始化失败，请检查参考包是否完整' }
      const res = await kb.search(query, limit)
      if (res.hits.length === 0) {
        return {
          ok: true,
          text: '本地知识库未命中相关片段；请改用 template_search 或显式声明“无本地依据”，避免编造 API。',
          data: { count: 0, degraded: res.degraded }
        }
      }
      const body = res.hits
        .map(
          (h, i) =>
            `===== 片段 ${i + 1} ${h.chunk.relPath}#${h.chunk.index}（相关度 ${h.score.toFixed(3)}）=====\n${h.chunk.text}`
        )
        .join('\n\n')
      const notice = res.degraded
        ? `[提示] 向量模型不可用，以下为关键词降级结果${res.reason ? `：${res.reason}` : ''}。引用时请以片段原文为准。\n\n`
        : ''
      return {
        ok: true,
        text: clipToolText(notice + body),
        data: { count: res.hits.length, degraded: res.degraded }
      }
    }
  })

  /* ---------------- 结构化原版数据（mc_data_lookup） ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_data_lookup',
        description:
          '查询 Minecraft 1.20.1 原版结构化数据（离线）：方块/物品/实体/附魔/状态效果/生物群系/粒子/食物的' +
          '标准注册名与数值参数（方块硬度、物品堆叠/耐久、实体碰撞箱、附魔最高级、食物饱食度等），' +
          '以及任意物品的原版合成/烧炼配方。支持中文口语名（钻石矿/僵尸/锋利）、英文名与注册名。' +
          '写配方 ingredients、战利品表、属性数值或拿不准注册名时必须先调用，严禁凭记忆编造 ID 或数值。',
        parameters: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['block', 'item', 'entity', 'enchantment', 'effect', 'biome', 'particle', 'food', 'recipe'],
              description:
                '数据类别：block 方块（硬度/材质/掉落）/ item 物品（堆叠/耐久）/ entity 实体（碰撞箱/分类）/ ' +
                'enchantment 附魔 / effect 状态效果 / biome 生物群系 / particle 粒子 / food 食物（饱食）/ ' +
                'recipe 按产物查配方。省略时全类检索（recipe 必须显式指定）'
            },
            query: { type: 'string', description: '查询词：中文名 / 英文名 / 注册名，如“钻石矿”“diamond ore”“zombie”“铁锭怎么合成”' },
            limit: { type: 'number', description: '返回条数上限，默认 8，最大 30' }
          },
          required: ['query']
        }
      }
    },
    available: () => {
      const svc = deps.mcData ? deps.mcData() : null
      return svc ? svc.available() : false
    },
    execute: (args) => {
      const svc = deps.mcData ? deps.mcData() : null
      if (!svc) return { ok: false, text: '', error: '原版结构化数据未就绪（resources/mcdata 缺失）' }
      const query = typeof args['query'] === 'string' ? args['query'] : ''
      if (!query.trim()) return { ok: false, text: '', error: 'query 不能为空' }
      const limit = typeof args['limit'] === 'number' ? Math.min(30, Math.max(1, Math.trunc(args['limit']))) : 8

      if (args['kind'] === 'recipe') {
        const recipes = svc.recipes(query, limit)
        const text =
          recipes.length === 0
            ? `未在原版配方表中找到「${query}」的产物配方。`
            : recipes
                .map(
                  (r, i) =>
                    `配方 ${i + 1}（${r.type}）：${r.output} ×${r.count}\n` +
                    `成分：${r.ingredients.join('、') || '无'}` +
                    (r.pattern ? `\n形状：\n${r.pattern.map((p) => `  ${p}`).join('\n')}` : '')
                )
                .join('\n\n')
        return { ok: true, text: clipToolText(text), data: { count: recipes.length } }
      }

      const kinds =
        typeof args['kind'] === 'string'
          ? [args['kind'] as McDataKind]
          : (['block', 'item', 'entity', 'enchantment', 'effect', 'biome', 'food'] as McDataKind[])
      const { entries } = svc.lookup(query, kinds, limit)
      if (entries.length === 0) {
        return { ok: true, text: `原版数据未命中「${query}」；请确认译名或改用更通用的关键词。`, data: { count: 0 } }
      }
      const text = entries
        .map((e) => {
          const facts = Object.entries(e.facts)
            .filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
            .map(([k, v]) => `${k}=${Array.isArray(v) ? (v as unknown[]).slice(0, 12).join('|') : String(v)}`)
            .join('，')
          return `[${e.kind}] minecraft:${e.name}（${e.displayName}${e.zhName ? `/${e.zhName}` : ''}）${facts ? `\n  ${facts}` : ''}`
        })
        .join('\n')
      return {
        ok: true,
        text: clipToolText(text),
        data: { count: entries.length, names: entries.map((e) => `${e.kind}:${e.name}`) }
      }
    }
  })

  /* ---------------- 离线 Fabric 文档 / 中文百科 / KubeJS 检索 ---------------- */
  const makeKnowledgeTool = (
    name: string,
    corpus: KnowledgeCorpus,
    description: string
  ): RegisteredTool => ({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name,
        description,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索词或具体问题（中文/英文/类名均可）' },
            limit: { type: 'number', description: '返回片段数上限，默认 6，最大 15' }
          },
          required: ['query']
        }
      }
    },
    available: () => getKnowledgeBase(corpus).available(),
    execute: (args) => {
      const query = typeof args['query'] === 'string' ? args['query'] : ''
      if (!query.trim()) return { ok: false, text: '', error: 'query 不能为空' }
      const limit = typeof args['limit'] === 'number' ? Math.min(15, Math.max(1, Math.trunc(args['limit']))) : 6
      const kb = getKnowledgeBase(corpus)
      if (!kb.available()) {
        return { ok: false, text: '', error: `${corpusLabel(corpus)}语料未就绪（resources/knowledge 缺失）` }
      }
      const hits = kb.search(query, limit)
      return {
        ok: true,
        text: clipToolText(formatHits(hits, corpusLabel(corpus))),
        data: { count: hits.length }
      }
    }
  })

  tools.push(
    makeKnowledgeTool(
      'fabric_docs_search',
      'fabric',
      '检索 KunYuStudio 内置的 Fabric 1.20.1 离线开发文档（原创中文摘要，Yarn 映射）：' +
        '工程结构/注册系统/事件回调/网络包/ScreenHandler 容器/NBT 持久化/Mixin 注入/实体 AI/' +
        '标签与数据包/战利品表/世界生成/客户端渲染。写 Fabric 代码前先检索对应篇章核对 API 用法。'
    ))
  tools.push(
    makeKnowledgeTool(
      'mc_wiki_search',
      'mcwiki',
      '检索 KunYuStudio 内置的 Minecraft 中文开发百科（原创术语词条，离线）：命名空间/属性系统/伤害类型/' +
        'AI 目标/合成配方/进度/资源包与数据包结构/粒子声音文本/附魔与状态效果/命令与 mcfunction/' +
        '食物饱食/GameTest。需要解释原版机制或确认术语时使用；查具体注册名与数值用 mc_data_lookup。'
    ))
  tools.push(
    makeKnowledgeTool(
      'kubejs_docs_search',
      'kubejs',
      '检索 KunYuStudio 内置的 KubeJS 脚本文档（离线速查）：ServerEvents.recipes 配方事件（添加/移除/替换）/' +
        'StartupEvents.registry 物品与方块注册（builder 链、类型、食物、工具/盔甲 tier、创造栏）/' +
        'ServerEvents.tags 标签编辑（add/remove/标签套标签/行为标签/正则批量）/' +
        'BlockEvents/ItemEvents 交互事件（可取消性、1.18.2 旧语法对照）/' +
        'ItemEvents.modification 修改既有物品与方块（含 1.21.1 失效 API 警示、tier 默认值表）。' +
        '写整合包 KubeJS 脚本前先检索核对 API 用法与版本分叉（1.18.2 vs 1.19.2+ vs 1.20+ vs 1.21）。'
    ))

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'error_analyze',
        description: '分析 Gradle 构建日志，匹配本地已知错误模式库并给出成因与修复建议。',
        parameters: {
          type: 'object',
          properties: {
            log: { type: 'string', description: '构建日志（可只给尾部 8k 字符）' }
          },
          required: ['log']
        }
      }
    },
    execute: (args, ctx) => {
      const cb = deps.contextBuilder
      if (!cb) return { ok: false, text: '', error: 'contextBuilder 不可用' }
      const log = typeof args['log'] === 'string' ? args['log'] : ''
      if (!log.trim()) return { ok: false, text: '', error: 'log 不能为空' }
      const matches = cb.matchErrorPatterns(ctx.loader, ctx.mcVersion, log)
      const text =
        matches.length === 0
          ? '未命中已知错误模式，请基于日志本身分析根因。'
          : matches
              .map((m) => `- ${m.pattern.id}\n  成因：${m.pattern.cause}\n  修复：${m.pattern.solution}`)
              .join('\n')
      return {
        ok: true,
        text,
        data: { patternIds: matches.map((m) => m.pattern.id) }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'version_check',
        description: '查询加载器/Minecraft 版本组合的激活状态与支持矩阵，确认目标环境可用。',
        parameters: {
          type: 'object',
          properties: {
            combo: { type: 'string', description: '组合 id（如 fabric-1.20.1）；缺省查全部' }
          },
          required: []
        }
      }
    },
    execute: (_args, ctx) => {
      const reference = deps.reference
      if (!reference) return { ok: false, text: '', error: 'reference 不可用' }
      const cells = reference.listMatrixCells()
      const text = cells
        .map(
          (c) =>
            `- ${c.loader} ${c.mcVersion}：${c.active ? '激活' : '储备（未启用真实构建回测）'}`
        )
        .join('\n')
      const current = cells.find((c) => c.loader === ctx.loader && c.mcVersion === ctx.mcVersion)
      return {
        ok: true,
        text: `当前目标组合 ${ctx.loader} ${ctx.mcVersion}：${
          current?.active ? '激活' : '储备组合（参考包 manifest 未激活该组合）'
        }\n${text}`
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'api_validate',
        description:
          '校验即将生成的代码是否遵守目标版本指纹与映射声明（初版规则检查：跨 loader import、client 类误用等）。',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: '待检查的 Java 代码片段' }
          },
          required: ['code']
        }
      }
    },
    execute: (_args, ctx) => {
      const cb = deps.contextBuilder
      if (!cb) return { ok: false, text: '', error: 'contextBuilder 不可用' }
      const code = typeof _args['code'] === 'string' ? _args['code'] : ''
      if (!code.trim()) return { ok: false, text: '', error: 'code 不能为空' }
      const issues: string[] = []
      if (ctx.loader === 'fabric' && /net\.minecraftforge|cpw\.mods/.test(code)) {
        issues.push('检测到 Forge 专属包（net.minecraftforge/cpw.mods）：目标 loader 是 Fabric，必须改用 Fabric API。')
      }
      if (!ctx.loader.includes('forge') && /@Mod\(/.test(code) && /net\.minecraft\.client/.test(code.split('@Mod')[1] ?? '')) {
        issues.push('@Mod 入口类中直接引用 client 类：需拆分到 client entrypoint 或用 DistExecutor 等价物。')
      }
      const text =
        (issues.length > 0 ? `发现 ${issues.length} 个问题：\n${issues.map((i) => `- ${i}`).join('\n')}` : '未发现明显规则问题。') +
        `\n\n版本指纹：${cb.getVersionFingerprint(ctx.loader, ctx.mcVersion) || '（无）'}\n` +
        `映射声明：${cb.buildMappingDeclaration(ctx.loader)}`
      return { ok: issues.length === 0, text: clipToolText(text), data: { issues } }
    }
  })

  // 用户工程源码检索（区别于只覆盖参考包的 kb_search）：无打开项目时不暴露
  tools.push({
    kind: 'chat',
    visibility: 'project',
    def: {
      type: 'function',
      function: {
        name: 'project_grep',
        description:
          '在当前用户工程源码内做正则检索（Java/Gradle/JSON/toml/mcfunction/properties/md），' +
          '用于核对工程现状：已有注册名、包结构、mod id、用户手改的实现。' +
          '与 kb_search 的区别：本工具搜的是「用户项目文件」，kb_search 搜的是「内置参考包」。' +
          '自动跳过 build/.gradle/run/node_modules/.kunyu 等目录。',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'JavaScript 正则表达式源码（无需字面量斜杠），如 Registry\\.register' },
            glob: { type: 'string', description: '可选文件名通配，如 *.java、*.gradle；缺省检索全部白名单源码类型' },
            ignoreCase: { type: 'boolean', description: '是否忽略大小写，默认 false' },
            maxResults: { type: 'number', description: '返回命中条数上限，默认 40，最大 100' }
          },
          required: ['pattern']
        }
      }
    },
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目，project_grep 不可用' }
      const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : ''
      const glob = typeof args['glob'] === 'string' && args['glob'].trim() ? args['glob'] : undefined
      const ignoreCase = args['ignoreCase'] === true
      const maxResults = typeof args['maxResults'] === 'number' ? args['maxResults'] : undefined
      const res = searchProjectCode(root, { pattern, glob, ignoreCase, maxResults })
      if (!res.ok) return { ok: false, text: '', error: res.error }
      const body =
        res.hits.length === 0
          ? `工程内未命中（已扫描 ${res.filesScanned} 个文件）。`
          : res.hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n')
      return {
        ok: true,
        text: clipToolText(body + (res.truncated ? '\n…（命中过多已截断，请用更精确的 pattern 或 glob 缩小范围）' : '')),
        data: { count: res.hits.length, truncated: res.truncated, filesScanned: res.filesScanned }
      }
    }
  })

  // 单文件直读（read_project_file）：增量修改时一轮并行读完相关源文件，
  // 替代模型用 project_grep 逐行挤内容的低效读法（实测后者吃掉整个 FC 轮次）。
  tools.push({
    kind: 'chat',
    visibility: 'project',
    def: {
      type: 'function',
      function: {
        name: 'read_project_file',
        description:
          '读取当前项目内单个源码/资源文件的完整原文（Java/JSON/mcmeta/properties/toml/lang/glsl 等）。' +
          '修改已有文件前用它读取真实现状（包名、注册写法、已有字段），可在一轮里并行调用多个；' +
          '不要用 project_grep 拼文件全文。单次上限 30000 字符，超大文件请缩小到具体文件。',
        parameters: {
          type: 'object',
          properties: {
            relPath: {
              type: 'string',
              description: '项目相对路径，POSIX 或反斜杠均可，如 src/main/java/com/x/Foo.java'
            }
          },
          required: ['relPath']
        }
      }
    },
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const norm = String(args['relPath'] ?? '').replace(/\\/g, '/')
      if (/^[a-zA-Z]:/.test(norm) || norm.startsWith('//')) {
        return { ok: false, text: '', error: '拒绝绝对路径/UNC 路径' }
      }
      const posix = norm.replace(/^\/+/, '')
      if (!posix || posix.split('/').some((s) => s === '' || s === '.' || s === '..')) {
        return { ok: false, text: '', error: '路径为空或包含 . / .. / 空段，已拒绝' }
      }
      if (!PROJECT_SOURCE_FILE_EXT_RE.test(posix)) {
        return {
          ok: false,
          text: '',
          error: `扩展名不在允许列表（${PROJECT_SOURCE_FILE_EXT_ALLOWED.join('/')}）：${posix}`
        }
      }
      const rootAbs = resolve(root)
      const abs = resolve(rootAbs, posix)
      const rel = relative(rootAbs, abs)
      if (rel.startsWith('..') || resolve(rootAbs) === abs) {
        return { ok: false, text: '', error: '路径逃逸项目根，已拒绝' }
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        return { ok: false, text: '', error: `文件不存在：${posix}` }
      }
      if (statSync(abs).size > 120_000) {
        return { ok: false, text: '', error: `文件过大（>120KB），read_project_file 仅支持小中型源码文件：${posix}` }
      }
      const content = readFileSync(abs, 'utf8')
      if (content.length > 30_000) {
        return { ok: false, text: '', error: `文件超过 30000 字符（实际 ${content.length}），请改为读取更具体的文件或片段：${posix}` }
      }
      return {
        ok: true,
        text: `// FILE: ${posix}（${content.length} 字符）\n${content}`,
        data: { path: posix, chars: content.length }
      }
    }
  })

  return tools
}
