/**
 * AI Reference 模板批量迁移脚本（Node 18+，无外部依赖）。
 *
 * 用法：
 *   node scripts/migrate-reference-templates.mjs --loader fabric --version 1.21.1
 *   node scripts/migrate-reference-templates.mjs --all       # 按 .migration-progress.json 全部 pending 项
 *
 * 流程：
 *   1. 从种子组合目录复制到目标组合目录（已存在则跳过文件级，加 --force 强制覆盖）
 *   2. 按 versionFingerprints[loader/mcVersion].templatePin 替换版本号字符串
 *   3. 在每个文件顶部追加「翻译自种子组合 + 目标版本」警示注释头（.java/.gradle/.toml/.json/.md/.properties）
 *   4. 更新 manifest.json：
 *      - templates 数组追加目标组合条目（verified=null, build=pending, active=true, provenance="translated-from-<seed>"）
 *      - stats.templateCount 同步
 *   5. 更新 .migration-progress.json 状态为 done
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(__filename), '..')
const REF_DIR = join(ROOT, 'resources', 'ai-reference')
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
function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, files)
    else files.push(abs)
  }
  return files
}

function readJson(p) { return JSON.parse(readFileSync(p, 'utf-8')) }
function writeJson(p, v) { writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf-8') }

/** 取目标组合在 versionFingerprints 里的 templatePin（含 loaderVersion/loom/gradle 等） */
function findPin(manifest, loader, mcVersion) {
  const fp = manifest.versionFingerprints.find(
    (f) => f.loader === loader && f.mcVersion === mcVersion
  )
  if (!fp) throw new Error(`versionFingerprints 缺少 ${loader}/${mcVersion}`)
  return fp
}

/** 每类文本文件的「警示注释头」前缀（按文件类型选注释符号） */
function headerFor(filename, seedCombo, targetCombo, pin) {
  const lines = [
    `KunYuEcosystem AI Reference 模板迁移（${seedCombo} -> ${targetCombo}）`,
    `provenance: translated-from-${seedCombo.split('/')[0]}-${seedCombo.split('/')[1]}`,
    `目标 loader=${targetCombo.split('/')[0]} mc=${targetCombo.split('/')[1]} loaderVersion=${pin.loaderVersion}`,
    `注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、`,
    `      加载器 DSL 在 ${targetCombo.split('/')[1]} 上可能与种子版本存在差异，构建失败时`,
    `      请优先查阅 ${targetCombo.split('/')[1]} 官方文档/${targetCombo.split('/')[0] === 'fabric' ? 'Fabric docs' : targetCombo.split('/')[0] === 'forge' ? 'Forge docs' : 'NeoForge docs'}。`,
    `verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。`
  ]
  if (/\.(java|gradle|groovy|kt|kts|xml|toml|properties|json|md|mcmeta|json5)$/i.test(filename) === false) {
    return null // 不识别的扩展名不加头
  }
  if (/\.(json|mcmeta)$/i.test(filename)) {
    // JSON 不允许注释，但项目里的模板 JSON 实际都是「带注释的 JSONC」风格模板；保守起见不注入，改用 manifest keywords 标注
    return null
  }
  if (/\.(md|markdown)$/i.test(filename)) {
    return `<!--\n${lines.map((l) => `  ${l}`).join('\n')}\n-->\n\n`
  }
  if (/\.(properties|toml)$/i.test(filename)) {
    return lines.map((l) => `# ${l}`).join('\n') + '\n\n'
  }
  // .java / .gradle / .groovy / .kt 用块注释
  return `/*\n${lines.map((l) => ` * ${l}`).join('\n')}\n */\n`
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

/* ---------------- 主流程 ---------------- */
async function migrateOne(manifest, loader, targetMc, opts) {
  const seedMc = SEED_COMBO[loader]
  const seedCombo = `${loader}/${seedMc}`
  const targetCombo = `${loader}/${targetMc}`
  const seedDir = join(REF_DIR, 'templates', loader, seedMc)
  const targetDir = join(REF_DIR, 'templates', loader, targetMc)
  if (!existsSync(seedDir)) throw new Error(`种子目录不存在：${seedDir}`)

  const pin = findPin(manifest, loader, targetMc)
  const seedFp = findPin(manifest, loader, seedMc)
  const rules = buildReplacements(loader, seedMc, targetMc, pin, seedFp)

  const files = walk(seedDir)
  let copied = 0, skipped = 0, wrote = 0
  const newTemplateEntries = []

  for (const srcAbs of files) {
    const rel = relative(seedDir, srcAbs)
    const dstAbs = join(targetDir, rel)
    if (existsSync(dstAbs) && !opts.force) { skipped++; continue }
    if (opts.dryRun) { copied++; continue }
    mkdirSync(dirname(dstAbs), { recursive: true })
    const raw = readFileSync(srcAbs, 'utf-8')
    const replaced = applyRules(raw, rules)
    const header = headerFor(rel, seedCombo, targetCombo, pin)
    const finalText = header ? header + replaced : replaced
    writeFileSync(dstAbs, finalText, 'utf-8')
    copied++; wrote++
  }

  /* ---------- 更新 manifest.json templates 数组 ---------- */
  const seedEntries = manifest.templates.filter(
    (t) => t.loader === loader && t.version === seedMc
  )
  if (!opts.dryRun) {
    // 移除目标组合旧条目（如果存在）
    manifest.templates = manifest.templates.filter(
      (t) => !(t.loader === loader && t.version === targetMc)
    )
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
  }

  return { copied, skipped, wrote, manifestEntries: newTemplateEntries.length }
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
      console.log(`copied=${r.copied} skipped=${r.skipped} wrote=${r.wrote} manifest+${r.manifestEntries}`)
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
