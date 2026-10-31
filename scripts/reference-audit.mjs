/**
 * AI Reference 参考包只读体检（Phase 0 + Phase 2 布局）。
 *
 * 目的：把参考包现状量化成可复核的数据：
 *   1. 布局盘点：manifest 虚拟模板数 vs 磁盘实体文件数（压缩率、复用率）
 *   2. Java 文本去重：按虚拟路径组合出正文后做规范化去重，看还剩多少真重复
 *   3. 槽位表：同一 (loader, 相对路径) 被多少个版本组合复用
 *   4. 组合差异：每个组合走 canonical 还是 variants、换行与注释头差异
 *   5. 状态分布：build/verified/provenance，以及"当前会被检索命中的未验证稿"数量
 *
 * 组合规则与 src/main/services/ai/templateStore.ts 同构（只读诊断，独立实现避免依赖 TS 构建）。
 *
 * 只读：不写参考包，不碰 overlay。唯一输出是 JSON（默认 docs/ai-reference-audit.json）。
 *
 * 用法：
 *   node scripts/reference-audit.mjs                 # 打印摘要 + 写默认 JSON
 *   node scripts/reference-audit.mjs --out <path>    # 指定 JSON 输出路径
 *   node scripts/reference-audit.mjs --no-write      # 只打印，不落盘
 *   node scripts/reference-audit.mjs --overlay <p>   # 叠加运行时 overlay 后统计有效状态
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const REF_DIR = join(ROOT, 'resources', 'ai-reference')
const MANIFEST_PATH = join(REF_DIR, 'manifest.json')
const DEFAULT_OUT = join(ROOT, 'docs', 'ai-reference-audit.json')
const DEFAULT_OVERLAY = join(ROOT, '.dev-userdata', 'ai', 'ai-reference-overlay.json')
const LOADERS = ['fabric', 'forge', 'neoforge']

function parseArgs(argv) {
  const out = { outPath: DEFAULT_OUT, write: true, overlayPath: DEFAULT_OVERLAY }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') out.outPath = resolve(argv[++i])
    else if (a === '--no-write') out.write = false
    else if (a === '--overlay') out.overlayPath = resolve(argv[++i])
  }
  return out
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, files)
    else files.push(abs)
  }
  return files
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf-8'))
}

/**
 * 文本规范化：去块注释/行注释（含 # 行注释），折叠空白，版本号统一占位。
 * 目的是让"脚本复制 + 替换版本号"产出的近重复语料暴露出同一份内容。
 */
function normalizeText(text) {
  let s = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/^\s*#(?:\s.*)?$/gm, ' ')
    .replace(/\b\d+\.\d+(?:\.\d+)?\b/g, '<VER>')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function sha1(text) {
  return createHash('sha1').update(text, 'utf-8').digest('hex')
}

/** relpath → 槽位键（去掉版本层）：templates/<loader>/<ver>/x/y.java → <loader>/x/y.java */
function slotOf(relPath) {
  const parts = relPath.split('/')
  if (parts.length >= 4 && parts[0] === 'templates') {
    return `${parts[1]}/${parts.slice(3).join('/')}`
  }
  return `_root/${parts[parts.length - 1]}`
}

/** 从模板虚拟路径取版本组合：templates/<loader>/<ver>/... */
function comboOf(relPath) {
  const parts = relPath.split('/')
  if (parts.length >= 3 && parts[0] === 'templates') return `${parts[1]}/${parts[2]}`
  return '_root/_root'
}

const COMBO_RE = /^templates\/(fabric|forge|neoforge)\/([^/]+)\/(.+)$/

/** 与 templateStore 同构的组合器（canonical → 占位符展开 → 换行 → 注释头） */
function templateStyleOf(slot) {
  if (slot.endsWith('.java') || slot.endsWith('.gradle')) return 'block'
  if (slot.endsWith('.md')) return 'html'
  if (slot.endsWith('.properties') || slot.endsWith('.toml')) return 'hash'
  return '-'
}

function pct(n, d) {
  return d === 0 ? '0%' : `${((n / d) * 100).toFixed(1)}%`
}

/* ------------------------------ 主流程 ------------------------------ */

const args = parseArgs(process.argv.slice(2))
if (!existsSync(MANIFEST_PATH)) {
  console.error(`[reference-audit] manifest 不存在：${MANIFEST_PATH}`)
  process.exit(1)
}

const manifest = readJson(MANIFEST_PATH)
const overlay = existsSync(args.overlayPath) ? readJson(args.overlayPath) : null
const activeSet = new Set(
  manifest.scopeControl.m7ActiveVersions.map((a) => `${a.loader}/${a.version}`)
)
const templatesRoot = join(REF_DIR, 'templates')

/* 0) 读压缩布局的声明文件 */
const versionRecs = new Map() // combo -> rec
for (const loader of LOADERS) {
  const dir = join(templatesRoot, 'versions', loader)
  if (!existsSync(dir)) continue
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const rec = readJson(join(dir, name))
    versionRecs.set(`${rec.loader}/${rec.mcVersion}`, rec)
  }
}
const varsByLoader = {}
for (const loader of LOADERS) {
  const p = join(templatesRoot, 'vars', `${loader}.json`)
  varsByLoader[loader] = existsSync(p) ? readJson(p).vars : {}
}

/** 虚拟路径 → 组合后正文；无法解析返回 null */
function compose(rel) {
  const m = COMBO_RE.exec(rel)
  if (!m) {
    const abs = join(REF_DIR, rel)
    return existsSync(abs) ? readFileSync(abs, 'utf-8') : null
  }
  const [, loader, mc, slot] = m
  const rec = versionRecs.get(`${loader}/${mc}`)
  if (!rec) return null
  if (rec.variants.includes(slot)) {
    const abs = join(templatesRoot, 'variants', loader, mc, slot)
    return existsSync(abs) ? readFileSync(abs, 'utf-8') : null
  }
  if (!rec.canonical.includes(slot)) return null
  const canonAbs = join(templatesRoot, 'canonical', loader, slot)
  if (!existsSync(canonAbs)) return null
  const vars = varsByLoader[loader] ?? {}
  const body = readFileSync(canonAbs, 'utf-8').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (all, name) => {
    const v = vars[name]
    if (!v) throw new Error(`占位符未定义 ${name}（${loader}/${slot}）`)
    const val = v.values?.[mc]
    return val !== undefined ? String(val) : String(v.seed)
  })
  const style = rec.noHeader?.includes(slot) ? '-' : templateStyleOf(slot)
  const text = (rec.headers?.[style] ?? '') + body
  return rec.crlf.includes(slot) ? text.replace(/\n/g, '\r\n') : text
}

/* 1) 布局盘点 */
const virtualFiles = Array.from(new Set(manifest.templates.map((t) => t.file)))
const resolved = virtualFiles.map((rel) => ({ rel, text: compose(rel) }))
const unresolved = resolved.filter((x) => x.text === null).map((x) => x.rel)
const comboVirtual = virtualFiles.filter((rel) => COMBO_RE.test(rel))
const rootVirtual = virtualFiles.filter((rel) => !COMBO_RE.test(rel))
const canonicalSlots = Array.from(versionRecs.values()).reduce((n, r) => n + r.canonical.length, 0)
const canonicalFiles = new Set()
for (const rec of versionRecs.values()) {
  for (const slot of rec.canonical) canonicalFiles.add(`${rec.loader}|${slot}`)
}
const variantSlots = Array.from(versionRecs.values()).reduce((n, r) => n + r.variants.length, 0)
const reuseRate = comboVirtual.length - variantSlots

const byLoader = {}
for (const rel of comboVirtual) {
  const loader = comboOf(rel).split('/')[0]
  byLoader[loader] = (byLoader[loader] ?? 0) + 1
}

/* 2) Java 去重（按组合后的正文，而不是磁盘文件） */
const javaVirtual = resolved.filter((x) => x.rel.endsWith('.java') && x.text !== null)
const javaByHash = new Map()
for (const { rel, text } of javaVirtual) {
  const hash = sha1(normalizeText(text))
  const g = javaByHash.get(hash) ?? []
  g.push(rel)
  javaByHash.set(hash, g)
}
const duplicateGroups = Array.from(javaByHash.entries())
  .filter(([, members]) => members.length > 1)
  .map(([hash, members]) => ({
    hash: hash.slice(0, 12),
    copies: members.length,
    distinctCombos: new Set(members.map(comboOf)).size,
    slot: slotOf(members[0]),
    members
  }))
  .sort((a, b) => b.copies - a.copies)
const distinctSlots = new Set(javaVirtual.map((x) => `${comboOf(x.rel).split('/')[0]}|${slotOf(x.rel)}`))

/* 3) 槽位表：每个槽位被多少组合复用 */
const slotMap = new Map()
for (const rec of versionRecs.values()) {
  const combo = `${rec.loader}/${rec.mcVersion}`
  for (const slot of [...rec.canonical, ...rec.variants]) {
    if (!slot.endsWith('.java')) continue
    const key = `${rec.loader}|${slot}`
    const cur = slotMap.get(key) ?? { slot, loader: rec.loader, combos: [] }
    if (!cur.combos.includes(combo)) cur.combos.push(combo)
    slotMap.set(key, cur)
  }
}
const slotTable = Array.from(slotMap.values()).sort((a, b) => b.combos.length - a.combos.length)

/* 4) 组合差异：canonical 复用 / variants 真实差异 / 换行 / 注释头 */
const comboTable = []
for (const rec of Array.from(versionRecs.values()).sort((a, b) => `${a.loader}/${a.mcVersion}`.localeCompare(`${b.loader}/${b.mcVersion}`))) {
  comboTable.push({
    combo: `${rec.loader}/${rec.mcVersion}`,
    seed: `${rec.loader}/${rec.seed}`,
    canonical: rec.canonical.length,
    variants: rec.variants.length,
    variantSlots: rec.variants,
    crlf: rec.crlf.length,
    noHeader: (rec.noHeader ?? []).length,
    headerStyles: Object.keys(rec.headers ?? {})
  })
}
const combosWithVariants = comboTable.filter((c) => c.variants > 0)

/* 5) 状态分布（manifest 基线 + overlay 有效值） */
const tpls = manifest.templates
const BUILD_ENUM = ['pending', 'pass', 'fail']
const CONTENT_TYPE_ENUM = [
  'advancement', 'block', 'command', 'enchantment', 'entity', 'gui',
  'item', 'mixin', 'project', 'recipe', 'tag', 'worldgen'
]
const KNOWN_PROVENANCE = [
  'pdf', 'scaffold', 'mdk-adapted', 'hand-curated', 'handwritten', 'manual-verified'
]
const VERIFIED_BUCKETS = { null: 0, true: 0, false: 0, versionString: 0, other: 0 }
const status = {
  total: tpls.length,
  build: {},
  verified: VERIFIED_BUCKETS,
  provenance: {},
  activeCombosWithTemplates: 0
}
const schemaAnomalies = {
  buildOutsideEnum: [],
  verifiedNotStringOrNull: [],
  provenanceOutsideUnion: [],
  loaderOutsideEnum: [],
  typeOutsideEnum: [],
  contentTypeOutsideEnum: []
}
for (const t of tpls) {
  status.build[t.build] = (status.build[t.build] ?? 0) + 1
  if (!BUILD_ENUM.includes(t.build)) schemaAnomalies.buildOutsideEnum.push(t.id)
  status.provenance[t.provenance] = (status.provenance[t.provenance] ?? 0) + 1
  if (
    !KNOWN_PROVENANCE.includes(t.provenance) &&
    !/^translated-from-/.test(t.provenance) &&
    !/^rewritten-for-/.test(t.provenance)
  ) {
    schemaAnomalies.provenanceOutsideUnion.push(t.id)
  }
  if (!['fabric', 'forge', 'neoforge'].includes(t.loader)) schemaAnomalies.loaderOutsideEnum.push(t.id)
  if (!CONTENT_TYPE_ENUM.includes(t.type)) schemaAnomalies.typeOutsideEnum.push(t.id)
  if (t.contentTypes.some((c) => !CONTENT_TYPE_ENUM.includes(c))) {
    schemaAnomalies.contentTypeOutsideEnum.push(t.id)
  }
  const verified = t.verified
  if (verified === null || verified === undefined) VERIFIED_BUCKETS.null++
  else if (verified === true) VERIFIED_BUCKETS.true++
  else if (verified === false) VERIFIED_BUCKETS.false++
  else if (typeof verified === 'string') VERIFIED_BUCKETS.versionString++
  else VERIFIED_BUCKETS.other++
  if (typeof verified !== 'string' && verified !== null) schemaAnomalies.verifiedNotStringOrNull.push(t.id)
}
status.activeCombosWithTemplates = Array.from(
  new Set(tpls.filter((t) => activeSet.has(`${t.loader}/${t.version}`)).map((t) => `${t.loader}/${t.version}`))
).length

/* 6) 检索可达性：当前 getTemplateContents 会命中哪些未验证稿（基线 / 叠加 overlay 后） */
function effectiveOf(t) {
  const eff = overlay?.templates?.[t.id]
  return { build: eff ? eff.build : t.build, verified: eff ? eff.verified : t.verified }
}
/**
 * 事实口径：build=pass，或 verified 为 true / 非空版本字符串。
 * 现存数据里存在历史脏值（build="verified"/"unverified"、verified=false 布尔），
 * 因此不能简单用 verified != null 判断。
 */
function isFactWith(build, verified) {
  if (build === 'pass') return true
  if (verified === true) return true
  if (typeof verified === 'string' && verified.trim().length > 0) return true
  return false
}
function isFact(t) {
  const { build, verified } = effectiveOf(t)
  return isFactWith(build, verified)
}
const activeTemplates = tpls.filter((t) => activeSet.has(`${t.loader}/${t.version}`))
const leak = {
  activeTemplates: activeTemplates.length,
  servedNowPool: activeTemplates.length, // 列表口径仍按 active 组合
  notFactBaseline: activeTemplates.filter((t) => !isFactWith(t.build, t.verified)).length,
  notFactEffective: activeTemplates.filter((t) => !isFact(t)).length,
  overlayApplied: Boolean(overlay),
  byCombo: {}
}
for (const t of activeTemplates) {
  const key = `${t.loader}/${t.version}`
  const cur = leak.byCombo[key] ?? { total: 0, notFact: 0 }
  cur.total++
  if (!isFact(t)) cur.notFact++
  leak.byCombo[key] = cur
}

const report = {
  generatedAt: new Date().toISOString(),
  referenceDir: REF_DIR,
  manifestVersion: manifest.manifestVersion,
  generatedAtManifest: manifest.generatedAt,
  layout: {
    templateVirtualFiles: virtualFiles.length,
    comboVirtualFiles: comboVirtual.length,
    rootSharedDocs: rootVirtual.length,
    canonicalSlots,
    canonicalFiles: canonicalFiles.size,
    variantSlots,
    versionsFiles: versionRecs.size,
    varsFiles: LOADERS.filter((l) => existsSync(join(templatesRoot, 'vars', `${l}.json`))).length,
    reuseRate: pct(reuseRate, comboVirtual.length),
    unresolved
  },
  files: {
    templatesTreeFiles: existsSync(templatesRoot) ? walk(templatesRoot).length : 0,
    byLoader,
    combosInTree: versionRecs.size,
    activeCombos: activeSet.size
  },
  javaDedup: {
    total: javaVirtual.length,
    distinctTexts: javaByHash.size,
    duplicateGroups: duplicateGroups.length,
    maxCopies: duplicateGroups[0]?.copies ?? 0,
    distinctLoaderSlots: distinctSlots.size,
    topGroups: duplicateGroups.slice(0, 10).map((g) => ({
      slot: g.slot,
      copies: g.copies,
      distinctCombos: g.distinctCombos
    }))
  },
  duplicateGroups,
  slotTable: slotTable.map((s) => ({ loader: s.loader, slot: s.slot, combos: s.combos.length })),
  combosWithVariants: combosWithVariants.map((c) => ({
    combo: c.combo,
    variants: c.variants,
    canonical: c.canonical,
    variantSlots: c.variantSlots
  })),
  comboTable,
  status,
  schemaAnomalies,
  retrievalLeak: leak,
  note: '只读体检；overlay 仅当 --overlay 路径存在时并入有效状态（默认读 .dev-userdata）。'
}

/* 控制台摘要 */
const L = report.layout
const D = report.javaDedup
console.log('==== AI Reference 只读体检 ====')
console.log(`参考包：${REF_DIR}`)
console.log(
  `布局：manifest 虚拟模板 ${L.templateVirtualFiles}（组合 ${L.comboVirtualFiles} + 共享 ${L.rootSharedDocs}）；` +
    `磁盘实体 ${report.files.templatesTreeFiles}`
)
console.log(
  `压缩：canonical 文件 ${L.canonicalFiles}（被 ${L.canonicalSlots} 处引用）+ variants ${L.variantSlots}` +
    ` + versions ${L.versionsFiles} + vars ${L.varsFiles}；复用率 ${L.reuseRate}`
)
if (L.unresolved.length > 0) console.log(`⚠ 无法组合的虚拟路径 ${L.unresolved.length}：${L.unresolved.slice(0, 5).join(', ')}`)
console.log(
  `Java 去重：${D.total} 片段 → ${D.distinctTexts} 份不同文本；` +
    `${D.duplicateGroups} 个重复组（最大 ${D.maxCopies} 份拷贝）；不同 loader+槽位 ${D.distinctLoaderSlots} 个`
)
console.log(`顶层重复组（槽位 × 拷贝数）：`)
for (const g of D.topGroups.slice(0, 5)) {
  console.log(`  - ${g.slot} ×${g.copies}（跨 ${g.distinctCombos} 组合）`)
}
console.log(
  `状态分布：build ${JSON.stringify(status.build)}；verified ${JSON.stringify(status.verified)}`
)
const prov = Object.entries(status.provenance).sort((a, b) => b[1] - a[1]).slice(0, 4)
console.log(`来源分布 Top4：${prov.map(([k, v]) => `${k}=${v}`).join('，')}`)
const anomalyCount =
  schemaAnomalies.buildOutsideEnum.length +
  schemaAnomalies.verifiedNotStringOrNull.length +
  schemaAnomalies.provenanceOutsideUnion.length +
  schemaAnomalies.loaderOutsideEnum.length +
  schemaAnomalies.typeOutsideEnum.length +
  schemaAnomalies.contentTypeOutsideEnum.length
console.log(
  `数据脏值：build 越界 ${schemaAnomalies.buildOutsideEnum.length} / ` +
    `verified 非 string|null ${schemaAnomalies.verifiedNotStringOrNull.length} / ` +
    `provenance 越界 ${schemaAnomalies.provenanceOutsideUnion.length} / ` +
    `loader 越界 ${schemaAnomalies.loaderOutsideEnum.length} / ` +
    `type 越界 ${schemaAnomalies.typeOutsideEnum.length} / ` +
    `contentTypes 越界 ${schemaAnomalies.contentTypeOutsideEnum.length}（合计 ${anomalyCount}）`
)
console.log(
  `检索泄漏：active 组合内 ${leak.activeTemplates} 条模板全部进池；` +
    `其中非事实基线 ${leak.notFactBaseline} 条，叠加 overlay 后 ${leak.notFactEffective} 条` +
    `（${pct(leak.notFactEffective, leak.activeTemplates)}）`
)
console.log(
  `真实差异（variants）：${combosWithVariants.length} 个组合存在 variants，` +
    `共 ${combosWithVariants.reduce((n, c) => n + c.variants, 0)} 个槽位`
)

if (args.write) {
  writeFileSync(args.outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
  console.log(`\nJSON 已写入：${args.outPath}`)
}
