/**
 * ContextBuilder：
 *
 * 纯检索/装配层：从只读参考包取模板/API/错误模式，按项目上下文填充
 * system_prompt_base.md 的占位符。不做网络请求、不写盘（overlay 回写属
 * probeService）。依赖以 ReferenceService 接口注入，便于无 Electron 验证。
 */
import type { ReferenceService } from './referencePackageService'
import type {
  ApiIndexEntry,
  ContentType,
  LoaderId,
  MatchedErrorPattern,
  TemplateProvenance
} from '../../../shared/types/aiReference'
import type { ComboHealth } from '../../../shared/types/monitor'

/** 单次注入模板硬上限（PDF p433：MAX_INJECTION_TEMPLATES = 5） */
export const MAX_INJECTION_TEMPLATES = 5
/** API 索引注入上限（控制 token） */
export const MAX_INJECTION_API = 12

/** 参考包缺失时的最小骨架（NFR-3 软降级：仍锁定环境与基本输出约束） */
const FALLBACK_PROMPT_SKELETON = `你是 KunYu Studio 的 Minecraft 模组开发助手。
当前环境：{{LOADER}} {{MC_VERSION}} / JDK {{JAVA_VERSION}} / modId={{MOD_ID}} / package={{PACKAGE_NAME}}。
{{MAPPING_DECLARATION}}

参考包未能加载，不得编造 API；没有把握的内容必须显式声明不确定。

{{REFERENCE_TEMPLATES}}

{{REFERENCE_API}}

{{ERROR_PATTERN_CONTEXT}}
`

/**
 * 内容类型关键词表（PDF p433 映射表 + 附录文件名词汇）。
 * 参考包无独立「药水效果」类型，药水/效果类需求归并到 item（食物/物品模板）。
 */
const CONTENT_TYPE_KEYWORDS: Array<{ type: ContentType; words: string[] }> = [
  { type: 'block', words: ['方块', 'block', 'blockstate', '方块状态', '掉落', 'loot', '方块实体', 'block entity'] },
  { type: 'item', words: ['物品', 'item', '工具', 'tool', '盔甲', 'armor', '食物', 'food', '药水', 'potion', '效果'] },
  { type: 'entity', words: ['实体', 'entity', '生物', 'mob', '属性', 'attribute', '渲染器', 'renderer', '刷怪蛋', 'spawn egg'] },
  { type: 'recipe', words: ['配方', 'recipe', '合成', 'shaped', 'shapeless', '熔炼', 'smelting', '锻造', 'smithing', '切石', 'stonecutting'] },
  { type: 'gui', words: ['界面', 'gui', 'screen', '屏幕', '菜单', 'menu'] },
  { type: 'mixin', words: ['混入', 'mixin', '注入', 'inject', '字节码', 'bytecode', 'modifyarg'] },
  { type: 'worldgen', words: ['世界生成', 'worldgen', 'biome', '群系', '生物群系', '矿石', 'ore', '地物', 'feature'] },
  { type: 'advancement', words: ['进度', '成就', 'advancement', 'criteria', 'trigger'] },
  { type: 'command', words: ['指令', '命令', 'command', 'brigadier'] },
  { type: 'enchantment', words: ['附魔', 'enchantment', 'enchant'] },
  { type: 'tag', words: ['标签', 'tag'] },
  { type: 'project', words: ['工程', '项目骨架', 'build.gradle', 'gradle.properties', 'fabric.mod.json', '入口', 'entrypoint', 'loom', '构建配置', '环境搭建', 'project'] }
]

export interface PromptContext {
  loader: LoaderId
  mcVersion: string
  javaVersion?: string
  yarnVersion?: string
  modId?: string
  packageName?: string
  /** 用户原话（用于关键词检索与 API 相关性打分） */
  userMessage?: string
  /** 显式指定内容类型；不传则由 userMessage 检测 */
  contentTypes?: ContentType[]
  /** 构建修复场景：错误日志全文 */
  errorLog?: string
}

export interface TemplateContent {
  id: string
  type: ContentType
  file: string
  provenance: TemplateProvenance
  build: 'pending' | 'pass' | 'fail'
  content: string
}

/** 用户文本 -> 内容类型（多类型按首次命中顺序去重；空命中默认 block，PDF p433） */
export function detectContentTypes(text: string | undefined | null): ContentType[] {
  if (!text) return ['block']
  const lower = text.toLowerCase()
  const hits: Array<{ type: ContentType; pos: number }> = []
  for (const { type, words } of CONTENT_TYPE_KEYWORDS) {
    let best = -1
    for (const w of words) {
      const idx = lower.indexOf(w.toLowerCase())
      if (idx !== -1 && (best === -1 || idx < best)) best = idx
    }
    if (best !== -1) hits.push({ type, pos: best })
  }
  if (hits.length === 0) return ['block']
  hits.sort((a, b) => a.pos - b.pos)
  return hits.map((h) => h.type)
}

export interface ContextBuilder {
  detectContentTypes(text: string): ContentType[]
  getTemplateContents(
    loader: LoaderId,
    version: string,
    types: readonly ContentType[],
    query?: string
  ): TemplateContent[]
  matchErrorPatterns(loader: LoaderId, version: string, logText: string): MatchedErrorPattern[]
  getErrorFixContext(
    loader: LoaderId,
    version: string,
    logText: string
  ): { matches: MatchedErrorPattern[]; relatedTemplates: TemplateContent[] }
  getVersionFingerprint(loader: LoaderId, version: string): string
  getHealthStatus(loader: LoaderId, version: string): ComboHealth
  buildDriftWarning(loader: LoaderId, version: string): string
  buildMappingDeclaration(loader: LoaderId): string
  buildSystemPrompt(ctx: PromptContext): string
}

function comboId(loader: LoaderId, version: string): string {
  return `${loader}-${version}`
}

export function createContextBuilder(service: ReferenceService): ContextBuilder {
  /**
   * 模板相关性打分：
   * - 请求类型命中 +2
   * - 文件名词干（snake_case 拆分，如 blockstate/loot/table）精确命中 +4
   * - manifest 关键词精确命中 +3、前缀命中（loot→loot table）+1
   * - 中文整句子串命中 +1（类别中文词被同类模板共享，仅作弱信号）
   * 不做「token 包含关键词」方向匹配（blockstate 含 block 会误顶 block_entity）。
   */
  function scoreTemplate(
    keywords: string[],
    filename: string,
    type: ContentType,
    types: readonly ContentType[],
    enTokens: string[],
    rawQueryLower: string
  ): number {
    let score = 0
    if (types.includes(type)) score += 2
    const stemWords = filename
      .replace(/\.[a-z]+$/i, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2)
    const lowerKeywords = keywords.map((k) => k.toLowerCase())
    for (const tok of enTokens) {
      if (stemWords.includes(tok)) score += 4
      for (const k of lowerKeywords) {
        if (k === tok) {
          score += 3
        } else if (tok.length >= 4 && k.startsWith(tok)) {
          score += 1
        }
      }
    }
    if (rawQueryLower) {
      for (const k of lowerKeywords) {
        if (/[\u4e00-\u9fa5]/.test(k) && rawQueryLower.includes(k)) score += 1
      }
    }
    return score
  }

  function tokenize(query: string | undefined): string[] {
    if (!query) return []
    return Array.from(
      new Set(
        query
          .toLowerCase()
          .split(/[^a-z0-9_]+/)
          .filter((t) => t.length >= 2)
      )
    ).slice(0, 24)
  }

  return {
    detectContentTypes,

    getTemplateContents(loader, version, types, query) {
      const all = service.listTemplates(loader, version) // inactive 组合天然返回 []
      if (all.length === 0) return []
      const tokens = tokenize(query)
      const rawLower = (query ?? '').toLowerCase()
      const scored = all.map((t) => {
        const view = service.readTemplate(t.id)
        return {
          t,
          content: view?.content ?? '',
          score: scoreTemplate(t.keywords, t.filename, t.type, types, tokens, rawLower)
        }
      })
      const typeOrder = new Map(types.map((ty, i) => [ty, i]))
      return scored
        .filter((s) => s.score > 0)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score
          const oa = typeOrder.get(a.t.type) ?? 99
          const ob = typeOrder.get(b.t.type) ?? 99
          if (oa !== ob) return oa - ob
          // 同分时规范入口模板（simple_*）优先，其余按文件名稳定排序
          const sa = a.t.filename.startsWith('simple_') ? 0 : 1
          const sb = b.t.filename.startsWith('simple_') ? 0 : 1
          if (sa !== sb) return sa - sb
          return a.t.file.localeCompare(b.t.file)
        })
        .slice(0, MAX_INJECTION_TEMPLATES)
        .map((s) => ({
          id: s.t.id,
          type: s.t.type,
          file: s.t.file,
          provenance: s.t.provenance,
          build: s.t.build,
          content: s.content
        }))
    },

    matchErrorPatterns(loader, version, logText) {
      return service.matchErrorPatterns(loader, version, logText)
    },

    getErrorFixContext(loader, version, logText) {
      const matches = service.matchErrorPatterns(loader, version, logText)
      // 从命中的错误模式反推相关内容类型，取最多 3 个相关模板
      const relatedTypes = new Set<ContentType>()
      for (const m of matches) {
        // 错误模式 id/文案里出现的类型词（ERR_MX_*→mixin、ERR_BD_*→project、ERR_JSON→block）
        if (m.pattern.id.includes('MX')) relatedTypes.add('mixin')
        if (m.pattern.id.includes('BD')) relatedTypes.add('project')
        if (m.pattern.id.includes('JSON')) relatedTypes.add('block')
        if (m.pattern.id.includes('MAP')) relatedTypes.add('block')
        for (const { type, words } of CONTENT_TYPE_KEYWORDS) {
          if (words.some((w) => m.pattern.cause.toLowerCase().includes(w.toLowerCase()))) {
            relatedTypes.add(type)
          }
        }
      }
      const relatedTemplates =
        relatedTypes.size > 0
          ? this.getTemplateContents(loader, version, Array.from(relatedTypes), logText).slice(0, 3)
          : []
      return { matches, relatedTemplates }
    },

    getVersionFingerprint(loader, version) {
      const fp = service.getFingerprint(comboId(loader, version))
      if (!fp) {
        return `组合 ${loader} ${version}：未登记版本指纹（储备组合，参考包 manifest 未激活）。`
      }
      const pin = fp.templatePin
      const lines = [
        `- 加载器：${loader}（${fp.loaderVersion}）`,
        `- Minecraft：${fp.mcVersion}`,
        `- 映射：${fp.mapping}`,
        `- JDK：${fp.jdk}`,
        `- 漂移风险：${fp.driftRisk}`
      ]
      if (pin) {
        if (fp.loader === 'fabric') {
          lines.push(
            `- 模板钉版工具链：Yarn ${pin.yarnMappings} / Loader ${pin.loaderVersion} / Fabric API ${pin.fabricApi} / Loom ${pin.loom} / Gradle ${pin.gradle}`
          )
        } else {
          const plugin = fp.loader === 'forge' ? 'ForgeGradle' : 'ModDevGradle'
          lines.push(
            `- 模板钉版工具链：${plugin} ${pin.loom} / ${fp.loader} ${pin.loaderVersion} / Gradle ${pin.gradle}`
          )
        }
      }
      return lines.join('\n')
    },

    getHealthStatus(loader, version) {
      return service.getComboHealth(comboId(loader, version))
    },

    buildDriftWarning(loader, version) {
      const health = service.getComboHealth(comboId(loader, version))
      const fp = service.getFingerprint(comboId(loader, version))
      if (health === 'green') return ''
      if (health === 'yellow') {
        return (
          `⚠ 漂移警告：${loader} ${version} 上游加载器可能已发布新构建（当前登记 ${fp?.loaderVersion ?? '?'}` +
          '），模板尚未重新编译验证。生成代码前请提示用户：写法可能需要微调，建议执行一次编译回测后再交付。'
        )
      }
      if (health === 'red') {
        return (
          `⛔ 高风险：${loader} ${version} 最近一次真实编译回测失败，参考模板可能已与当前工具链漂移。` +
          '必须明确告知用户模板可能失效，代码需人工验证；不要声称代码可以直接编译通过。'
        )
      }
      return `ℹ 待验证：${loader} ${version} 尚未进行真实编译回测（health=unknown）。模板来自参考包快照，建议回测签字后再作为「已验证」交付。`
    },

    buildMappingDeclaration(loader) {
      const manifest = service.getManifest()
      const info = manifest?.mappingTypes[loader]
      if (!info) return `映射声明：未在参考包中找到 ${loader} 的映射信息。`
      const peers = manifest?.mappingTypes
      return [
        `本项目使用 ${info.type === 'yarn' ? 'Yarn（Fabric 官方）' : 'Mojang 官方'}映射。`,
        `- 标识符类：${info.identifierClass}`,
        `- 注册表类：${info.registryClass}`,
        info.description,
        peers
          ? `禁止混用其他映射：${Object.entries(peers)
              .filter(([k]) => k !== loader)
              .map(([k, v]) => `${k}→${v.identifierClass}`)
              .join('，')}。`
          : ''
      ]
        .filter(Boolean)
        .join('\n')
    },

    buildSystemPrompt(ctx) {
      const base = service.getSystemPromptBase()
      const health = this.getHealthStatus(ctx.loader, ctx.mcVersion)
      const types =
        ctx.contentTypes && ctx.contentTypes.length > 0
          ? ctx.contentTypes
          : detectContentTypes(ctx.userMessage)
      const templates = this.getTemplateContents(
        ctx.loader,
        ctx.mcVersion,
        types,
        ctx.userMessage
      )
      const fp = service.getFingerprint(comboId(ctx.loader, ctx.mcVersion))
      const javaVersion = ctx.javaVersion ?? (fp ? String(fp.jdk) : '17')
      const modId = ctx.modId?.trim() || 'examplemod（未检测到项目上下文，占位值）'
      const packageName =
        ctx.packageName?.trim() || 'com.example.mod（未检测到项目上下文，占位值）'

      const projectContext = ctx.modId
        ? [
            `当前项目：loader=${ctx.loader}，mc=${ctx.mcVersion}，java=${javaVersion}`,
            `modId=${ctx.modId}，basePackage=${ctx.packageName ?? 'com.example.mod'}`,
            ctx.yarnVersion ? `yarn=${ctx.yarnVersion}` : ''
          ]
            .filter(Boolean)
            .join('\n')
        : `未检测到已打开项目：按 ${ctx.loader} ${ctx.mcVersion} / JDK ${javaVersion} 环境给出代码片段，使用占位 modId 与包名，不执行写盘。`

      const templatesBlock =
        templates.length > 0
          ? templates
              .map(
                (t) =>
                  `### 文件：${t.file}（类型 ${t.type}，回测状态 ${t.build}，来源 ${t.provenance}）\n${t.content}`
              )
              .join('\n\n---\n\n')
          : `参考包未命中当前内容类型（${types.join(', ')}）的模板；必须显式声明「参考包未覆盖此功能」，仅基于已知 API 给出保守建议。`

      const apiBlock = buildApiBlock(service, ctx, types)

      const errorBlock = ctx.errorLog
        ? this.getErrorFixContext(ctx.loader, ctx.mcVersion, ctx.errorLog)
        : null
      const errorContext = errorBlock
        ? formatErrorContext(errorBlock.matches, errorBlock.relatedTemplates, ctx.errorLog ?? '')
        : '本次不是构建修复场景；无错误日志上下文。'

      const driftWarning = this.buildDriftWarning(ctx.loader, ctx.mcVersion)

      const replacements: Record<string, string> = {
        LOADER: ctx.loader,
        MC_VERSION: ctx.mcVersion,
        JAVA_VERSION: javaVersion,
        MOD_ID: modId,
        PACKAGE_NAME: packageName,
        MAPPING_DECLARATION: this.buildMappingDeclaration(ctx.loader),
        PROJECT_CONTEXT: projectContext,
        VERSION_FINGERPRINT: this.getVersionFingerprint(ctx.loader, ctx.mcVersion),
        HEALTH_STATUS: healthLabel(health),
        DRIFT_WARNING: driftWarning,
        REFERENCE_TEMPLATES: templatesBlock,
        REFERENCE_API: apiBlock,
        ERROR_PATTERN_CONTEXT: errorContext
      }

      let prompt = (base ?? FALLBACK_PROMPT_SKELETON).replace(
        /\{\{([A-Z_]+)\}\}/g,
        (m, key: string) => replacements[key] ?? m
      )
      // 不允许任何未填充占位符流出（NFR：不确定要显式声明，不暴露模板变量）
      prompt = prompt.replace(/\{\{[A-Z_]+\}\}/g, '（未提供）')
      return prompt
    }
  }
}

/* ------------------------------------------------------------------ */
/* 内部装配工具                                                        */
/* ------------------------------------------------------------------ */

function healthLabel(health: ComboHealth): string {
  switch (health) {
    case 'green':
      return 'green（最近真实编译回测通过，模板可信）'
    case 'yellow':
      return 'yellow（上游加载器已更新，待重新回测）'
    case 'red':
      return 'red（最近回测失败，模板可能失效）'
    case 'unknown':
      return 'unknown（尚未回测）'
    case 'deprecated':
      return 'deprecated（已废弃，框架级不可用，建议迁移到 core 版本）'
    case 'beta':
      return 'beta（上游仍为官方 Beta，矩阵已登记但禁用，禁止在新建项目中使用，待官方 GA）'
  }
}

function buildApiBlock(
  service: ReferenceService,
  ctx: PromptContext,
  types: ContentType[]
): string {
  const manifest = service.getManifest()
  if (!manifest) return 'API 索引不可用（参考包未加载）。'
  const entries = manifest.apiIndex.filter(
    (e) => e.loaders.includes(ctx.loader) && e.mcVersions.includes(ctx.mcVersion)
  )
  if (entries.length === 0) return `参考包 API 索引未收录 ${ctx.loader} ${ctx.mcVersion} 的条目。`

  const haystack = `${ctx.userMessage ?? ''} ${types.join(' ')}`.toLowerCase()
  const scored = entries.map((e) => {
    const text = `${e.classPath} ${e.member ?? ''} ${e.signature}`.toLowerCase()
    let score = 0
    for (const tok of haystack.split(/[^a-z0-9_]+/).filter((t) => t.length >= 3)) {
      if (text.includes(tok)) score += 1
    }
    // 内容类型加权：类型词命中条目类名
    return { e, score }
  })
  const picked = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INJECTION_API)
    .map((s) => s.e)
  const list = (picked.length > 0 ? picked : entries.slice(0, 6))
  return list.map(formatApiEntry).join('\n')
}

function formatApiEntry(e: ApiIndexEntry): string {
  return `- [${e.kind}] ${e.signature} <${e.classPath}>${e.commonError ? `\n  易错：${e.commonError}` : ''}`
}

function formatErrorContext(
  matches: MatchedErrorPattern[],
  related: TemplateContent[],
  errorLog: string
): string {
  if (matches.length === 0) {
    return `错误模式库未命中以下日志，必须如实告知用户「参考包未收录该错误」，不要编造修复方案：\n${truncate(errorLog, 1200)}`
  }
  const blocks = matches.map((m, i) => {
    const p = m.pattern
    return [
      `### 命中 ${i + 1}：${p.id}（${p.categoryLabel}/${p.errorType}，${p.severity}）`,
      `日志片段：${m.matchedText}`,
      `原因：${p.cause}`,
      `修复：${p.solution}`,
      p.fixCode ? `修复代码：\n${p.fixCode}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  })
  if (related.length > 0) {
    blocks.push(
      `相关模板：\n${related.map((t) => `- ${t.file}`).join('\n')}`
    )
  }
  return blocks.join('\n\n')
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n...（日志已截断）`
}
