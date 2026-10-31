/**
 * AI Reference 模板批量迁移脚本（Node 18+，无外部依赖）。
 *
 * 用法：
 *   node scripts/migrate-reference-templates.mjs --loader fabric --version 1.21.1
 *   node scripts/migrate-reference-templates.mjs --all       # 按 .migration-progress.json 全部 pending 项
 *
 * 流程（压缩布局下不再复制整棵树）：
 *   1. 以 templates/versions/<loader>/<种子>.json + templates/vars/<loader>.json 为源，
 *      组合出种子组合的每个槽位正文（不含迁移注释头）
 *   2. 按 versionFingerprints[loader/mcVersion].templatePin 替换版本号字符串
 *   3. 反推占位符在新组合的取值：逐行对齐 canonical 与目标正文，能完整解释的槽位
 *      走 canonical（只记 vars 差异）；解释不了的槽位落 templates/variants/<loader>/<mc>/
 *   4. 写 templates/versions/<loader>/<mc>.json（canonical/variants/crlf/headers/noHeader）
 *   5. 更新 manifest.json：templates 追加目标组合条目 + stats.templateCount
 *   6. 更新 .migration-progress.json 状态为 done
 *
 * 等价保障：写盘前对每个槽位用「canonical + 新 vars」重新展开并与目标正文逐字节比对，
 * 不一致就自动降级为 variant——绝不写出组合不回去的声明。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(__filename), '..')
const REF_DIR = join(ROOT, 'resources', 'ai-reference')
const TPL_DIR = join(REF_DIR, 'templates')
const MANIFEST_PATH = join(REF_DIR, 'manifest.json')
const PROGRESS_PATH = join(REF_DIR, '.migration-progress.json')

const SEED_COMBO = { fabric: '1.20.1', forge: '1.20.1', neoforge: '1.21.1' }

/* ---------------- CLI 参数 ---------------- */
function parseArgs() {
  const args = process.argv.slice(2)
  const out = { loader: null, version: null, all: false, force: false, dryRun: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--loader') out.loader = args[++i]
    else if (a === '--version') out.version = args[++i]
    else if (a === '--all') out.all = true
    else if (a === '--force') out.force = true
    else if (a === '--dry-run') out.dryRun = true
  }
  return out
}

/* ---------------- 工具 ---------------- */
function readJson(p) { return JSON.parse(readFileSync(p, 'utf-8')) }
function writeJson(p, v) { writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf-8') }

const versionPath = (loader, mc) => join(TPL_DIR, 'versions', loader, `${mc}.json`)
const varsPath = (loader) => join(TPL_DIR, 'vars', `${loader}.json`)
const canonPath = (loader, slot) => join(TPL_DIR, 'canonical', loader, slot)
const variantPath = (loader, mc, slot) => join(TPL_DIR, 'variants', loader, mc, slot)

/** 取目标组合在 versionFingerprints 里的 templatePin（含 loaderVersion/loom/gradle 等） */
function findPin(manifest, loader, mcVersion) {
  const fp = manifest.versionFingerprints.find(
    (f) => f.loader === loader && f.mcVersion === mcVersion
  )
  if (!fp) throw new Error(`versionFingerprints 缺少 ${loader}/${mcVersion}`)
  return fp
}

/** 注释头风格（与 templateStore 同构） */
function styleOf(slot) {
  if (/\.(java|gradle)$/.test(slot)) return 'block'
  if (/\.md$/.test(slot)) return 'html'
  if (/\.(properties|toml)$/.test(slot)) return 'hash'
  return '-'
}

/** 每类文本文件的「警示注释头」（只依赖样式，与具体文件名无关） */
function headerForStyle(style, seedCombo, targetCombo, pin) {
  const targetMc = targetCombo.split('/')[1]
  const docs = targetCombo.split('/')[0] === 'fabric'
    ? 'Fabric docs'
    : targetCombo.split('/')[0] === 'forge' ? 'Forge docs' : 'NeoForge docs'
  const lines = [
    `KunYuEcosystem AI Reference 模板迁移（${seedCombo} -> ${targetCombo}）`,
    `provenance: translated-from-${seedCombo.split('/')[0]}-${seedCombo.split('/')[1]}`,
    `目标 loader=${targetCombo.split('/')[0]} mc=${targetMc} loaderVersion=${pin.loaderVersion}`,
    `注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、`,
    `      加载器 DSL 在 ${targetMc} 上可能与种子版本存在差异，构建失败时`,
    `      请优先查阅 ${targetMc} 官方文档/${docs}。`,
    `verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。`
  ]
  const flat = lines.join('\n') + '\n'
  if (style === 'html') return `<!--\n${lines.map((l) => `  ${l}`).join('\n')}\n-->\n\n`
  if (style === 'hash') return lines.map((l) => `# ${l}`).join('\n') + '\n\n'
  if (style === 'block') return `/*\n${lines.map((l) => ` * ${l}`).join('\n')}\n */\n`
  return flat // style '-'：理论上不使用
}

/* ---------------- 版本替换规则 ---------------- */
/**
 * 按 loader+目标版本返回 [regex, replacement][] 替换表。
 * 替换只对「project 脚手架」和「mod manifest」做强约束；业务 .java 仅替换明确版本字符串。
 */
function buildReplacements(loader, seedMc, targetMc, pin, seedFp) {
  const t = pin.templatePin || {}
  const rules = []
  const pair = (a, b) => { if (a && b && a !== b) rules.push([new RegExp(escapeReg(String(a)), 'g'), String(b)]) }

  /* 第一步：替换种子指纹 -> 目标指纹（yarnMappings/fabricApi/gradle/loom 具体值）
   * 必须先于 MC 版本号替换，否则 1.20.1+build.10 会先被 MC 替换拆散成 1.21.1+build.10 */
  const sp = seedFp?.templatePin || {}
  pair(sp.yarnMappings, t.yarnMappings)
  pair(sp.fabricApi, t.fabricApi)
  pair(sp.loom, t.loom)

  // fabric 种子文件里被升级过的 hardcoded 字面值（来自 1.20.1 种子实际内容）
  if (loader === 'fabric') {
    if (t.yarnMappings) rules.push([/1\.20\.1\+build\.10/g, t.yarnMappings])
    if (t.fabricApi) rules.push([/0\.83\.0\+1\.20\.1/g, t.fabricApi])
    if (pin.loaderVersion) rules.push([/\b0\.16\.9\b/g, String(pin.loaderVersion)])
    // 种子 gradle.properties 注释里写的 Gradle 8.6，templatePin.gradle=8.10.2
    if (t.gradle) rules.push([/\bGradle\s+8\.6\b/g, `Gradle ${t.gradle}`])
    if (t.gradle) rules.push([/\bgradle-version 8\.6\b/g, `gradle-version ${t.gradle}`])
    if (t.gradle) rules.push([/\| `8\.6` +\|/g, `| \`${t.gradle}\`  |`])
  }

  // 加载器构建插件版本（build.gradle plugins{} 块）
  if (t.loom) {
    if (loader === 'fabric') rules.push([/id 'fabric-loom' version '[^']+'/g, `id 'fabric-loom' version '${t.loom}'`])
    if (loader === 'forge') rules.push([/id 'net\.forgegradle' version '[^']+'/g, `id 'net.minecraftforge.gradle' version '${t.loom}'`])
    if (loader === 'forge') rules.push([/id 'net\.minecraftforge\.gradle' version '[^']+'/g, `id 'net.minecraftforge.gradle' version '${t.loom}'`])
    if (loader === 'neoforge') rules.push([/id 'net\.neoforged\.moddev' version '[^']+'/g, `id 'net.neoforged.moddev' version '${t.loom}'`])
  }

  if (loader === 'fabric') {
    if (t.yarnMappings) rules.push([/yarn_mappings=.*/g, `yarn_mappings=${t.yarnMappings}`])
    if (t.fabricApi) rules.push([/fabric_version=.*/g, `fabric_version=${t.fabricApi}`])
    if (t.loaderVersion) rules.push([/loader_version=.*/g, `loader_version=${t.loaderVersion}`])
    if (t.loaderVersion) rules.push([/"fabricloader":\s*">=[^"]+"/g, `"fabricloader": ">=${t.loaderVersion}"`])
    rules.push([/"minecraft":\s*"~[^"]+"/g, `"minecraft": "~${targetMc}"`])
  } else if (loader === 'forge') {
    const forgeMajor = String(pin.loaderVersion).split('.')[0]
    rules.push([/loaderVersion\s*=\s*"\[[0-9]+,\)"/g, `loaderVersion="[${forgeMajor},)"`])
    rules.push([/modId\s*=\s*"forge"[\s\S]{0,200}?versionRange\s*=\s*"\[[0-9]+,\)"/g,
      (m) => m.replace(/versionRange\s*=\s*"\[[0-9]+,\)"/, `versionRange="[${forgeMajor},)"`)])
    rules.push([/versionRange\s*=\s*"\[[0-9.]+,1\.[0-9]+\)"/g, `versionRange="[${targetMc},${nextMinor(targetMc)})"`])
    if (t.loaderVersion) rules.push([/forge_version=.*/g, `forge_version=${t.loaderVersion}`])
    if (pin.loaderVersion) pair(seedFp?.loaderVersion, pin.loaderVersion)
  } else if (loader === 'neoforge') {
    rules.push([/loaderVersion\s*=\s*"\[[^"]+"/g, `loaderVersion="[${String(pin.loaderVersion).split('.')[0]},)"`])
    if (t.loaderVersion) rules.push([/neoforge_version=.*/g, `neoforge_version=${t.loaderVersion}`])
    if (pin.loaderVersion) pair(seedFp?.loaderVersion, pin.loaderVersion)
  }

  // JDK 版本（fabric/forge/neoforge build.gradle 多处）
  if (pin.jdk) {
    rules.push([/options\.release\s*=\s*\d+/g, `options.release = ${pin.jdk}`])
    rules.push([/JavaLanguageVersion\.of\(\d+\)/g, `JavaLanguageVersion.of(${pin.jdk})`])
    rules.push([/sourceCompatibility\s*=\s*JavaVersion\.VERSION_\d+/g, `sourceCompatibility = JavaVersion.VERSION_${pin.jdk}`])
    rules.push([/targetCompatibility\s*=\s*JavaVersion\.VERSION_\d+/g, `targetCompatibility = JavaVersion.VERSION_${pin.jdk}`])
    rules.push([/"java":\s*">=\d+"/g, `"java": ">=${pin.jdk}"`])
    if (seedFp?.jdk && seedFp.jdk !== pin.jdk) {
      rules.push([/\*\*JDK\s+\d+\*\*/g, `**JDK ${pin.jdk}**`])
      rules.push([/\bJDK\s+\d+\b/g, `JDK ${pin.jdk}`])
      rules.push([/\bJava\s+\d+\b/g, `Java ${pin.jdk}`])
      rules.push([/\| `1[78]` \|/g, `| \`${pin.jdk}\` |`])
      rules.push([/\| `21` \|/g, `| \`${pin.jdk}\` |`])
    }
  }

  /* 第二步：最后替换 MC 版本号字面值（避免上面规则中的 1.20.1 被先吃掉） */
  rules.push([new RegExp(escapeReg(seedMc), 'g'), targetMc])

  return rules
}

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** 由 1.20.4 推 1.21（用于 forge mods.toml 上限） */
function nextMinor(mc) {
  const [a, b] = mc.split('.').map((x) => parseInt(x, 10))
  return `${a}.${b + 1}`
}

function applyRules(text, rules) {
  let out = text
  for (const [re, rep] of rules) out = out.replace(re, rep)
  return out
}

/* ---------------- 组合 / 反推占位符取值 ---------------- */

/** canonical 展开（不含注释头、不做换行转换）；values 缺省回退种子值 */
function expand(canonical, vars, values) {
  return canonical.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, name) => {
    const v = vars[name]
    if (!v) throw new Error(`占位符未定义：${name}`)
    const val = values?.get(name)
    return val !== undefined ? val : String(v.seed)
  })
}

/** 单行占位符匹配器：canonical 字面段 + 每处占位符捕获一个 token */
function lineMatcher(canonLine) {
  const names = []
  let src = '^'
  let last = 0
  for (const m of canonLine.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)) {
    src += escapeReg(canonLine.slice(last, m.index)) + '([0-9][0-9A-Za-z.+_-]*)'
    names.push(m[1])
    last = m.index + m[0].length
  }
  src += escapeReg(canonLine.slice(last)) + '$'
  return { regex: new RegExp(src), names }
}

/**
 * 逐行对齐 canonical 与目标正文，反推每个占位符在目标组合的取值。
 * 占位符之外的任何行内差异都判为无法解释（该槽位必须落 variants）。
 */
function deriveValues(canonical, seedText, targetText) {
  const cl = canonical.split('\n')
  const sl = seedText.split('\n')
  const tl = targetText.split('\n')
  if (cl.length !== sl.length || cl.length !== tl.length) return null
  const values = new Map()
  for (let i = 0; i < cl.length; i++) {
    if (!cl[i].includes('{{')) {
      if (tl[i] !== sl[i]) return null
      continue
    }
    const { regex, names } = lineMatcher(cl[i])
    const m = regex.exec(tl[i])
    if (!m) return null
    for (let k = 0; k < names.length; k++) {
      const val = m[k + 1]
      if (val === undefined) return null
      const prev = values.get(names[k])
      if (prev !== undefined && prev !== val) return null
      values.set(names[k], val)
    }
  }
  return values
}

/* ---------------- 主流程 ---------------- */
async function migrateOne(manifest, loader, targetMc, opts) {
  const seedMc = SEED_COMBO[loader]
  const seedCombo = `${loader}/${seedMc}`
  const targetCombo = `${loader}/${targetMc}`
  const seedRecPath = versionPath(loader, seedMc)
  if (!existsSync(seedRecPath)) throw new Error(`种子组合声明不存在：${seedRecPath}`)
  if (existsSync(versionPath(loader, targetMc)) && !opts.force) {
    return { skippedCombo: true, canonical: 0, variants: 0, manifestEntries: 0 }
  }

  const seedRec = readJson(seedRecPath)
  const varsFile = existsSync(varsPath(loader)) ? readJson(varsPath(loader)) : { vars: {} }
  const pin = findPin(manifest, loader, targetMc)
  const seedFp = findPin(manifest, loader, seedMc)
  const rules = buildReplacements(loader, seedMc, targetMc, pin, seedFp)

  const slots = [...seedRec.canonical, ...seedRec.variants].sort()
  const derived = new Map() // slot -> { targetText, values } 仅可走 canonical 的
  let variants = []

  for (const slot of slots) {
    const isSeedVariant = seedRec.variants.includes(slot)
    const canonAbs = canonPath(loader, slot)
    if (isSeedVariant || !existsSync(canonAbs)) {
      // 种子里本身就是真实差异：目标组合同样保留为 variant（不做占位符反推）
      const seedText = readFileSync(variantPath(loader, seedMc, slot), 'utf-8').replace(/\r\n/g, '\n')
      derived.set(slot, { targetText: applyRules(seedText, rules), values: null })
      variants.push(slot)
      continue
    }
    const canonical = readFileSync(canonAbs, 'utf-8').replace(/\r\n/g, '\n')
    const seedText = expand(canonical, varsFile.vars, null)
    const targetText = applyRules(seedText, rules)
    derived.set(slot, { targetText, values: deriveValues(canonical, seedText, targetText) })
    if (derived.get(slot).values === null) variants.push(slot)
  }

  // 合并各槽位反推出的取值（多数票；同一 seed 字面值经同一规则表替换，正常不会冲突）
  const votes = new Map() // name -> Map(value -> count)
  for (const [slot, d] of derived) {
    if (!d.values) continue
    for (const [name, val] of d.values) {
      const m = votes.get(name) ?? new Map()
      m.set(val, (m.get(val) ?? 0) + 1)
      votes.set(name, m)
    }
  }
  const newValues = {}
  for (const [name, m] of votes) {
    newValues[name] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  // 等价自检：用合并后的取值重新展开，不一致的槽位降级为 variant
  for (const [slot, d] of derived) {
    if (!d.values) continue
    const canonical = readFileSync(canonPath(loader, slot), 'utf-8').replace(/\r\n/g, '\n')
    if (expand(canonical, varsFile.vars, new Map(Object.entries(newValues))) !== d.targetText) {
      variants.push(slot)
      d.values = null
    }
  }

  const canonicalSlots = slots.filter((s) => !variants.includes(s))

  if (opts.dryRun) {
    return { skippedCombo: false, canonical: canonicalSlots.length, variants: variants.length, manifestEntries: 0 }
  }

  /* ---------- 1) vars：写入新组合的占位符取值 ---------- */
  const vars = varsFile.vars ?? {}
  for (const [name, val] of Object.entries(newValues)) {
    const v = vars[name]
    if (!v) continue
    if (val !== String(v.seed)) v.values = { ...(v.values ?? {}), [targetMc]: val }
    else if (v.values) delete v.values[targetMc]
  }
  writeJson(varsPath(loader), { loader, seed: seedMc, vars })

  /* ---------- 2) 无法用占位符解释的槽位落 variants ---------- */
  for (const slot of variants) {
    const d = derived.get(slot)
    let text = d.targetText
    if (seedRec.crlf.includes(slot)) text = text.replace(/\n/g, '\r\n')
    const abs = variantPath(loader, targetMc, slot)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text, 'utf-8')
  }

  /* ---------- 3) versions：声明该组合由哪些槽位组成 ---------- */
  const headers = {}
  for (const style of Object.keys(seedRec.headers ?? {})) {
    headers[style] = style === '-' ? '' : headerForStyle(style, seedCombo, targetCombo, pin)
  }
  writeJson(versionPath(loader, targetMc), {
    loader,
    mcVersion: targetMc,
    seed: seedMc,
    headers,
    canonical: canonicalSlots,
    variants: variants.slice().sort(),
    crlf: seedRec.crlf.filter((s) => canonicalSlots.includes(s)),
    noHeader: (seedRec.noHeader ?? []).filter((s) => canonicalSlots.includes(s))
  })

  /* ---------- 4) 更新 manifest.json templates 数组 ---------- */
  const seedEntries = manifest.templates.filter(
    (t) => t.loader === loader && t.version === seedMc
  )
  manifest.templates = manifest.templates.filter(
    (t) => !(t.loader === loader && t.version === targetMc)
  )
  const newTemplateEntries = []
  for (const se of seedEntries) {
    const clone = JSON.parse(JSON.stringify(se))
    clone.id = se.id.replace(`${loader}-${seedMc}-`, `${loader}-${targetMc}-`)
    clone.version = targetMc
    clone.file = se.file.replace(`templates/${loader}/${seedMc}/`, `templates/${loader}/${targetMc}/`)
    clone.appliesTo = { loaders: [loader], mcVersions: [targetMc] }
    clone.verified = null
    clone.verifiedAt = null
    clone.build = 'pending'
    clone.active = true
    clone.provenance = `translated-from-${loader}-${seedMc}`
    newTemplateEntries.push(clone)
  }
  manifest.templates.push(...newTemplateEntries)
  manifest.stats.templateCount = manifest.templates.length

  return {
    skippedCombo: false,
    canonical: canonicalSlots.length,
    variants: variants.length,
    manifestEntries: newTemplateEntries.length
  }
}

async function main() {
  const opts = parseArgs()
  const manifest = readJson(MANIFEST_PATH)
  const progress = readJson(PROGRESS_PATH)

  const tasks = []
  if (opts.all) {
    for (const c of progress.combos) {
      if (c.status === 'pending') tasks.push({ loader: c.loader, version: c.version })
    }
  } else if (opts.loader && opts.version) {
    tasks.push({ loader: opts.loader, version: opts.version })
  } else {
    console.error('用法：--loader fabric --version 1.21.1  或  --all')
    process.exit(2)
  }

  console.log(`待迁移：${tasks.length} 个组合`)
  for (const t of tasks) {
    process.stdout.write(`\n>>> ${t.loader}/${t.version} ... `)
    try {
      const r = await migrateOne(manifest, t.loader, t.version, opts)
      if (r.skippedCombo) {
        console.log('skip（目标组合声明已存在，用 --force 覆盖）')
        continue
      }
      console.log(`canonical=${r.canonical} variants=${r.variants} manifest+${r.manifestEntries}`)
      if (!opts.dryRun) {
        const c = progress.combos.find((x) => x.loader === t.loader && x.version === t.version)
        if (c) { c.status = 'done'; c.doneAt = new Date().toISOString() }
      }
    } catch (e) {
      console.log(`FAIL: ${e.message}`)
      const c = progress.combos.find((x) => x.loader === t.loader && x.version === t.version)
      if (c && !opts.dryRun) { c.status = 'failed'; c.error = e.message }
    }
  }

  if (!opts.dryRun) {
    writeJson(MANIFEST_PATH, manifest)
    progress.updatedAt = new Date().toISOString()
    writeJson(PROGRESS_PATH, progress)
    console.log('\nmanifest.json 与 .migration-progress.json 已更新。')
  } else {
    console.log('\n[dry-run] 未写盘。')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
