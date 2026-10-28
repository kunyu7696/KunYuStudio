/**
 * 整合包周边内容生成器。
 *
 * 覆盖四类整合包「非 jar」配套内容的骨架生成，全部落到项目根 config/ 或 overrides/
 * 下（组装器的 scanConfigFiles/scanOverrideFiles 自动收编进包）：
 *
 * 1. FTB Quests（config/ftbquests/quests/）：SNBT 格式章节与任务。
 *    文件头形如 `{ "quest.id": ... }` 不成立——SNBT 是无引号键的 NBT 风格文本，
 *    本生成器输出 FTB 官方约定章节结构（id/title/icon/rewards/tasks 数组）。
 * 2. Patchouli（config/<modid>/patchouli_books/<book>/）：book.json 类目与
 *    en_us 条目 JSON（官方 book.json 约定的 category/entries 结构）。
 * 3. 键位（options.txt 风格 config/<modid>-keybinds.txt 片段）：
 *    key_key.<modid>.<name>=key.keyboard.x 行，合并进 overrides/ 下的 options.txt 片段说明。
 * 4. 优化 profile（config/<modid>.properties 等）：钠/铷/Iris 常用配置键值对，
 *    按「性能档」（performance/balanced/quality）生成说明化默认值。
 *
 * 设计约定：
 * - 全部纯函数（返回 relPath→content 映射），IO 由调用方决定（可预览不落盘）；
 * - 中文注释/文案，键名严格按官方约定；
 * - 生成内容一律「说明化骨架」：能跑、结构合法，但具体玩法内容由用户/Agent 填充。
 */

// ---------------------------------------------------------------------------
// FTB Quests（SNBT）
// ---------------------------------------------------------------------------

export interface FtbQuestInput {
  /** 章节 id（snake_case，文件名用） */
  chapterId: string
  /** 章节展示名（中文可） */
  title: string
  /** 图标物品 id（如 minecraft:book） */
  icon?: string
  /** 任务列表 */
  quests: Array<{
    id: string
    title: string
    /** 任务描述行 */
    description?: string[]
    /** 前置任务 id 列表（可选；FTB 任务书编辑器保存时回写） */
    dependencies?: string[]
    /** 提交物品 id（item 任务类型） */
    item?: string
    /** 奖励物品 id 与数量 */
    reward?: { item: string; count?: number }
  }>
}

/** SNBT 字符串转义（双引号包裹，内部 " 与 \ 转义） */
function snbtStr(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 生成单个 FTB Quests 章节 SNBT（config/ftbquests/quests/chapters/<id>.snbt） */
export function buildFtbQuestChapter(input: FtbQuestInput): string {
  const icon = input.icon ?? 'minecraft:book'
  const lines: string[] = [
    '{',
    `\tid: ${snbtStr(input.chapterId)}`,
    `\ttitle: ${snbtStr(input.title)}`,
    `\ticon: ${snbtStr(icon)}`,
    '\tquests: ['
  ]
  for (const [i, q] of input.quests.entries()) {
    lines.push('\t\t{')
    lines.push(`\t\t\tid: ${snbtStr(q.id)}`)
    lines.push(`\t\t\ttitle: ${snbtStr(q.title)}`)
    if (q.description && q.description.length > 0) {
      lines.push('\t\t\tdescription: [')
      for (const d of q.description) lines.push(`\t\t\t\t${snbtStr(d)}`)
      lines.push('\t\t\t]')
    }
    if (q.dependencies && q.dependencies.length > 0) {
      lines.push('\t\t\tdependencies: [')
      for (const d of q.dependencies) lines.push(`\t\t\t\t${snbtStr(d)}`)
      lines.push('\t\t\t]')
    }
    lines.push('\t\t\ttasks: [{')
    lines.push('\t\t\t\ttype: "item"')
    lines.push(`\t\t\t\titem: ${snbtStr(q.item ?? 'minecraft:stone')}`)
    lines.push('\t\t\t}]')
    if (q.reward) {
      lines.push('\t\t\trewards: [{')
      lines.push('\t\t\t\ttype: "item"')
      lines.push(`\t\t\t\titem: ${snbtStr(q.reward.item)}`)
      lines.push(`\t\t\t\tcount: ${q.reward.count ?? 1}`)
      lines.push('\t\t\t}]')
    }
    lines.push(i + 1 < input.quests.length ? '\t\t},' : '\t\t}')
  }
  lines.push('\t]', '}')
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Patchouli
// ---------------------------------------------------------------------------

export interface PatchouliBookInput {
  /** 宿主 mod id（books 落 config/<modid>/patchouli_books/） */
  modId: string
  /** 书 id（snake_case） */
  bookId: string
  /** 书名（中文可） */
  name: string
  /** 简介（hover 显示） */
  landingText?: string
  /** 类目 */
  categories: Array<{
    id: string
    name: string
    description: string
    icon: string
    entries: Array<{
      id: string
      name: string
      icon: string
      /** 正文页文本（text 页类型） */
      pages: string[]
    }>
  }>
}

/** 生成 Patchouli book.json（config/<modid>/patchouli_books/<book>/book.json） */
export function buildPatchouliBookJson(input: PatchouliBookInput): string {
  const doc = {
    name: input.name,
    landing_text: input.landingText ?? `${input.name}——本整合包导引手册。`,
    version: 1,
    creative_tab: 'misc'
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

/** 生成 Patchouli 类目 JSON（.../en_us/categories/<id>.json） */
export function buildPatchouliCategory(
  cat: PatchouliBookInput['categories'][number]
): string {
  const doc = {
    name: cat.name,
    description: cat.description,
    icon: cat.icon,
    sortnum: 0
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

/** 生成 Patchouli 条目 JSON（.../en_us/entries/<cat>/<id>.json） */
export function buildPatchouliEntry(
  entry: PatchouliBookInput['categories'][number]['entries'][number],
  categoryId: string
): string {
  const doc = {
    name: entry.name,
    icon: entry.icon,
    category: categoryId,
    pages: entry.pages.map((text) => ({ type: 'text', text }))
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// 键位（options.txt 片段）
// ---------------------------------------------------------------------------

export interface KeybindInput {
  modId: string
  binds: Array<{
    /** 键位 id（key.<modid>.<name> 的 name 段） */
    name: string
    /** 默认键（GLFW 名，如 key.keyboard.g / key.keyboard.unknown 表示未绑定） */
    key: string
    /** 中文说明（注释行） */
    comment?: string
  }>
}

/**
 * 生成键位配置片段（config/<modid>-keybinds.txt，说明化纯文本）。
 * 内容为 options.txt 同款 key_ 行 + 中文注释头，用户可复制进存档 options.txt。
 */
export function buildKeybindSnippet(input: KeybindInput): string {
  const lines: string[] = [
    `# ${input.modId} 键位默认配置（options.txt 片段）`,
    '# 用法：把下方 key_ 行合并进存档 options.txt（重复键以后到者为准）。',
    ''
  ]
  for (const b of input.binds) {
    if (b.comment) lines.push(`# ${b.comment}`)
    lines.push(`key_key.${input.modId}.${b.name}:${b.key}`)
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 优化 profile
// ---------------------------------------------------------------------------

export type OptimizationTier = 'performance' | 'balanced' | 'quality'

export interface OptimizationProfileInput {
  /** 目标配置文件名（如 sodium-options.properties） */
  fileName: string
  tier: OptimizationTier
}

const TIER_SETTINGS: Record<OptimizationTier, Array<{ key: string; value: string; comment: string }>> = {
  performance: [
    { key: 'graphics', value: 'fast', comment: '图像品质：流畅（帧数优先）' },
    { key: 'renderDistance', value: '6', comment: '视距 6 区块（低端机推荐 4-6）' },
    { key: 'entityShadows', value: 'false', comment: '实体阴影：关闭（提升明显）' },
    { key: 'maxFps', value: '60', comment: '帧率上限 60（省电降温）' },
    { key: 'useVsync', value: 'false', comment: '垂直同步：关闭（降低输入延迟）' }
  ],
  balanced: [
    { key: 'graphics', value: 'fancy', comment: '图像品质：高品质（画质与帧数均衡）' },
    { key: 'renderDistance', value: '10', comment: '视距 10 区块' },
    { key: 'entityShadows', value: 'true', comment: '实体阴影：开启' },
    { key: 'maxFps', value: '120', comment: '帧率上限 120' },
    { key: 'useVsync', value: 'true', comment: '垂直同步：开启（防画面撕裂）' }
  ],
  quality: [
    { key: 'graphics', value: 'fabulous', comment: '图像品质：极佳（画质优先）' },
    { key: 'renderDistance', value: '16', comment: '视距 16 区块' },
    { key: 'entityShadows', value: 'true', comment: '实体阴影：开启' },
    { key: 'maxFps', value: '0', comment: '帧率不限（0=无上限）' },
    { key: 'useVsync', value: 'true', comment: '垂直同步：开启' }
  ]
}

/** 生成优化 profile 配置文件（config/<fileName>，Java properties 风格 + 中文注释） */
export function buildOptimizationProfile(input: OptimizationProfileInput): string {
  const label = input.tier === 'performance' ? '性能档' : input.tier === 'balanced' ? '均衡档' : '画质档'
  const lines: string[] = [
    `# 优化 profile（${label}）——KunYuStudio 生成，可按机器实况微调`,
    `# 键名对齐主流优化模组（Sodium/Rubidium/Iris 兼容层）通用约定。`,
    ''
  ]
  for (const s of TIER_SETTINGS[input.tier]) {
    lines.push(`# ${s.comment}`)
    lines.push(`${s.key}=${s.value}`)
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 汇总生成（relPath → content，供预览/落盘）
// ---------------------------------------------------------------------------

export interface CompanionGenResult {
  /** 项目相对 POSIX 路径 → 文件内容 */
  files: Map<string, string>
  /** 人类可读摘要（一行一条） */
  summary: string[]
}

/** 生成 FTB Quests 章节（config/ftbquests/quests/chapters/<id>.snbt） */
export function genFtbQuestChapter(input: FtbQuestInput): CompanionGenResult {
  const relPath = `config/ftbquests/quests/chapters/${input.chapterId}.snbt`
  return {
    files: new Map([[relPath, buildFtbQuestChapter(input)]]),
    summary: [`FTB Quests 章节 ${input.chapterId}（${input.quests.length} 个任务）→ ${relPath}`]
  }
}

/** 生成 Patchouli 手册骨架（book.json + 类目 + en_us 条目） */
export function genPatchouliBook(input: PatchouliBookInput): CompanionGenResult {
  const base = `config/${input.modId}/patchouli_books/${input.bookId}`
  const files = new Map<string, string>()
  files.set(`${base}/book.json`, buildPatchouliBookJson(input))
  for (const cat of input.categories) {
    files.set(`${base}/en_us/categories/${cat.id}.json`, buildPatchouliCategory(cat))
    for (const entry of cat.entries) {
      files.set(`${base}/en_us/entries/${cat.id}/${entry.id}.json`, buildPatchouliEntry(entry, cat.id))
    }
  }
  const entryCount = input.categories.reduce((n, c) => n + c.entries.length, 0)
  return {
    files,
    summary: [`Patchouli 手册 ${input.bookId}（${input.categories.length} 类目 / ${entryCount} 条目）→ ${base}/（共 ${files.size} 个文件）`]
  }
}

/** 生成键位配置片段（config/<modid>-keybinds.txt） */
export function genKeybindSnippet(input: KeybindInput): CompanionGenResult {
  const relPath = `config/${input.modId}-keybinds.txt`
  return {
    files: new Map([[relPath, buildKeybindSnippet(input)]]),
    summary: [`键位片段 ${input.modId}（${input.binds.length} 个键位）→ ${relPath}`]
  }
}

/** 生成优化 profile（config/<fileName>） */
export function genOptimizationProfile(input: OptimizationProfileInput): CompanionGenResult {
  const relPath = `config/${input.fileName}`
  return {
    files: new Map([[relPath, buildOptimizationProfile(input)]]),
    summary: [`优化 profile（${input.tier}）→ ${relPath}`]
  }
}
