/**
 * AI Reference 模板树重构：canonical + 占位符 + 真实差异（variants）。
 *
 * 背景：templates/<loader>/<mc>/... 下有 1555 个模板文件，其中绝大多数是
 * migrate-reference-templates.mjs 从种子组合复制、只改了版本号（外加一段迁移
 * 警示注释头）。这导致 diff / review / 搜索被近重复文件淹没。
 *
 * 新布局：
 *   templates/canonical/<loader>/<contentType>/<file>   # 每 (loader, 槽位) 一份正文，用 {{mcVersion}} 等占位符
 *   templates/vars/<loader>.json                        # 占位符 -> 各种子组合的取值（缺省回退种子值）
 *   templates/versions/<loader>/<mc>.json               # 该组合由哪些槽位组成、哪些走 variants、注释头与换行
 *   templates/variants/<loader>/<mc>/<slot>             # 真实差异（整文件字节，不再拆写）
 *
 * 绝不改检索行为：manifest 保持原样（file 仍是 templates/<loader>/<mc>/<slot> 虚拟路径），
 * 运行时由 templateStore 按 canonical+versions 组合出与重构前逐字节相同的文本。
 *
 * 用法：
 *   node scripts/refactor-reference-templates.mjs            # 只计算并打印方案（不写盘）
 *   node scripts/refactor-reference-templates.mjs --apply    # 落盘：写新布局、删旧树与构建垃圾、写等价基线
 *   node scripts/refactor-reference-templates.mjs --verify   # 落盘后自检：从新布局组合，对比基线 sha1
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REF_DIR = join(ROOT, 'resources', 'ai-reference')
const TPL_DIR = join(REF_DIR, 'templates')
const MANIFEST = JSON.parse(readFileSync(join(REF_DIR, 'manifest.json'), 'utf-8'))
const BASELINE = join(
  ROOT, 'src', 'main', 'services', 'ai', '__tests__', 'fixtures', 'ai-reference-baseline.json'
)

const SEEDS = { fabric: '1.20.1', forge: '1.20.1', neoforge: '1.21.1' }
const LOADERS = ['fabric', 'forge', 'neoforge']
const MIGRATION_MARK = 'KunYuEcosystem AI Reference 模板迁移'
const TOKEN_RE = /[0-9][0-9A-Za-z.+_-]*/g
const JUNK_RE = /(^|\/)(\.gradle|build)(\/|$)/
const COMBO_RE = /^templates\/(fabric|forge|neoforge)\/([^/]+)\/(.+)$/
/** 已压缩布局的目录，重跑时跳过（否则会被当成根级共享文档去读） */
const NEW_LAYOUT_RE = /^templates\/(canonical|vars|versions|variants)\//

const MODE = process.argv.includes('--apply')
  ? 'apply'
  : process.argv.includes('--verify')
    ? 'verify'
    : 'plan'

/* ------------------------------------------------------------------ */
/* 扫描                                                                */
/* ------------------------------------------------------------------ */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else out.push(relative(REF_DIR, abs).split('\\').join('/'))
  }
  return out
}

const sha1 = (text) => createHash('sha1').update(text, 'utf-8').digest('hex')

/** 迁移警示注释头（migrate 脚本生成）；返回 { style, header, body } 或 null */
function splitMigrationHeader(text) {
  if (text.startsWith('/*')) {
    const m = text.match(/^\/\*\r?\n[\s\S]*?\r?\n \*\/\r?\n/)
    if (m && m[0].includes(MIGRATION_MARK)) {
      return { style: 'block', header: m[0], body: text.slice(m[0].length) }
    }
    return null
  }
  if (text.startsWith('<!--')) {
    const m = text.match(/^<!--\r?\n[\s\S]*?\r?\n-->\r?\n\r?\n/)
    if (m && m[0].includes(MIGRATION_MARK)) {
      return { style: 'html', header: m[0], body: text.slice(m[0].length) }
    }
    return null
  }
  if (text.startsWith('#')) {
    const m = text.match(/^(?:#[^\n]*\r?\n)+\r?\n/)
    if (m && m[0].includes(MIGRATION_MARK)) {
      return { style: 'hash', header: m[0], body: text.slice(m[0].length) }
    }
    return null
  }
  return null
}

function scanEntries() {
  const entries = []
  const rootFiles = []
  for (const rel of walk(TPL_DIR)) {
    const m = COMBO_RE.exec(rel)
    if (!m) {
      if (!NEW_LAYOUT_RE.test(rel)) rootFiles.push(rel)
      continue
    }
    if (JUNK_RE.test(rel)) continue
    const [, loader, mc, slot] = m
    const raw = readFileSync(join(REF_DIR, rel), 'utf-8')
    const eol = raw.includes('\r\n') ? 'crlf' : 'lf'
    const mixed = eol === 'crlf' && raw.replace(/\r\n/g, '').includes('\n')
    const split = splitMigrationHeader(raw)
    entries.push({
      rel,
      loader,
      mc,
      slot,
      combo: `${loader}/${mc}`,
      raw,
      eol,
      mixed,
      style: split?.style ?? null,
      // 统一按 LF 存注释头与正文，组合时再按目标组合的换行风格整体还原
      header: split ? split.header.replace(/\r\n/g, '\n') : '',
      body: split ? split.body.replace(/\r\n/g, '\n') : raw.replace(/\r\n/g, '\n')
    })
  }
  return { entries, rootFiles }
}

/* ------------------------------------------------------------------ */
/* 组合信息：注释头是否统一、换行是否统一                                */
/* ------------------------------------------------------------------ */

function buildComboInfo(entries) {
  const info = new Map()
  for (const e of entries) {
    let c = info.get(e.combo)
    if (!c) {
      c = { combo: e.combo, loader: e.loader, mc: e.mc, headers: {}, headerConflict: new Set(), seed: e.mc === SEEDS[e.loader] }
      info.set(e.combo, c)
    }
    const style = e.style ?? '-'
    const prev = c.headers[style]
    if (prev === undefined) c.headers[style] = e.header
    else if (prev !== e.header) c.headerConflict.add(style)
  }
  return info
}

/* ------------------------------------------------------------------ */
/* 词表学习：从「种子 vs 目标」的逐行差异里提取占位符替换对              */
/* ------------------------------------------------------------------ */

const toucher = (line) => line.replace(TOKEN_RE, '\u0000')
const tokensOf = (line) => line.match(TOKEN_RE) ?? []

function learnVarTable(entries) {
  const seedOf = new Map() // `loader|slot` -> entry
  for (const e of entries) {
    if (e.mc === SEEDS[e.loader]) seedOf.set(`${e.loader}|${e.slot}`, e)
  }
  const pairs = new Map() // combo -> Map(seedTok -> Map(targetTok -> count))
  for (const e of entries) {
    const seed = seedOf.get(`${e.loader}|${e.slot}`)
    if (!seed || seed.mc === e.mc) continue
    const a = seed.body.split('\n')
    const b = e.body.split('\n')
    if (a.length !== b.length) continue
    const map = pairs.get(e.combo) ?? new Map()
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i] || toucher(a[i]) !== toucher(b[i])) continue
      const ta = tokensOf(a[i])
      const tb = tokensOf(b[i])
      if (ta.length !== tb.length) continue
      for (let j = 0; j < ta.length; j++) {
        if (ta[j] === tb[j]) continue
        const byTarget = map.get(ta[j]) ?? new Map()
        byTarget.set(tb[j], (byTarget.get(tb[j]) ?? 0) + 1)
        map.set(ta[j], byTarget)
      }
    }
    pairs.set(e.combo, map)
  }

  /** varTable[loader] = Map(seedTok -> { values: Map(combo -> tok), conflict }) */
  const varTable = {}
  for (const loader of LOADERS) varTable[loader] = new Map()
  for (const [combo, map] of pairs) {
    const loader = combo.split('/')[0]
    const table = varTable[loader]
    for (const [seedTok, byTarget] of map) {
      if (byTarget.size !== 1) continue // 歧义：放弃该 token 的占位符化
      const value = [...byTarget.keys()][0]
      const cur = table.get(seedTok) ?? { values: new Map(), conflict: false }
      const prev = cur.values.get(combo)
      if (prev !== undefined && prev !== value) cur.conflict = true
      cur.values.set(combo, value)
      table.set(seedTok, cur)
    }
  }
  for (const loader of LOADERS) {
    for (const [tok, v] of varTable[loader]) {
      if (v.conflict) varTable[loader].delete(tok)
    }
  }
  return varTable
}

/** 给种子字面值起语义化占位符名；无法对应的用 detail 序号 */
function nameVars(loader, varTable) {
  const fp = MANIFEST.versionFingerprints.find(
    (f) => f.loader === loader && f.mcVersion === SEEDS[loader]
  )
  const pin = fp?.templatePin ?? {}
  const known = [
    ['mcVersion', String(SEEDS[loader])],
    ['loaderVersion', pin.loaderVersion == null ? null : String(pin.loaderVersion)],
    ['loomVersion', pin.loom == null ? null : String(pin.loom)],
    ['gradleVersion', pin.gradle == null ? null : String(pin.gradle)],
    ['yarnMappings', pin.yarnMappings == null ? null : String(pin.yarnMappings)],
    ['fabricApi', pin.fabricApi == null ? null : String(pin.fabricApi)],
    ['jdk', fp?.jdk == null ? null : String(fp.jdk)]
  ]
  const names = new Map()
  const used = new Set()
  let seq = 0
  for (const [seedTok, v] of varTable) {
    const hit = known.find(([name, val]) => val === seedTok && !used.has(name))
    if (hit) { names.set(seedTok, hit[0]); used.add(hit[0]) }
  }
  for (const [seedTok, v] of varTable) {
    if (names.has(seedTok)) continue
    // 只有真正存在「非种子取值」的 token 才值得占位符化
    const changed = [...v.values.entries()].some(([combo, val]) => val !== seedTok)
    if (!changed) continue
    do { seq++ } while (used.has(`detail${seq}`))
    names.set(seedTok, `detail${seq}`)
    used.add(`detail${seq}`)
  }
  return { names, known }
}

/** 每个 combo 的「字面值 -> 占位符名」反查表（用于把参考正文占位符化） */
function buildLiteralMaps(varTable, names, combos) {
  const perCombo = new Map()
  const named = [...varTable].filter(([seedTok]) => names.get(seedTok))
  for (const combo of combos) {
    const map = new Map()
    for (const [seedTok, v] of named) {
      const name = names.get(seedTok)
      const val = v.values.get(combo) ?? seedTok
      if (map.has(val) && map.get(val) !== name) map.set(val, 'CONFLICT')
      else map.set(val, name)
    }
    perCombo.set(combo, map)
  }
  return perCombo
}

/* ------------------------------------------------------------------ */
/* 组合：canonical 正文 -> 逐字节还原                                     */
/* ------------------------------------------------------------------ */

function placeholderize(body, literalMap) {
  return body.replace(TOKEN_RE, (tok) => {
    const name = literalMap?.get(tok)
    return name && name !== 'CONFLICT' ? `{{${name}}}` : tok
  })
}

function expand(canonicalBody, combo, vars) {
  return canonicalBody.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, name) => {
    const v = vars?.[name]
    if (!v) throw new Error(`未知占位符 ${name}`)
    const val = v.values?.[combo]
    return val !== undefined ? String(val) : String(v.seed)
  })
}

function composeText(header, canonicalBody, combo, vars, eol) {
  let out = header + expand(canonicalBody, combo, vars)
  if (eol === 'crlf') out = out.replace(/\n/g, '\r\n')
  return out
}

function main() {
  const { entries, rootFiles } = scanEntries()
  const info = buildComboInfo(entries)
  const varTable = learnVarTable(entries)
  const named = {}
  for (const loader of LOADERS) named[loader] = nameVars(loader, varTable[loader])
  const literalMaps = {}
  for (const loader of LOADERS) {
    const combosOfLoader = [...info.values()].filter((c) => c.loader === loader).map((c) => c.combo)
    literalMaps[loader] = buildLiteralMaps(varTable[loader], named[loader].names, combosOfLoader)
  }
  // 展开用的运行时词表：占位符名 -> { seed, values: {combo: 值} }
  const varsByLoader = {}
  for (const loader of LOADERS) {
    const vars = {}
    for (const [seedTok, v] of varTable[loader]) {
      const name = named[loader].names.get(seedTok)
      if (!name) continue
      const values = {}
      for (const [combo, val] of v.values) values[combo] = val
      vars[name] = { seed: seedTok, values }
    }
    varsByLoader[loader] = vars
  }

  // 分组：loader|slot -> entries
  const groups = new Map()
  for (const e of entries) {
    const key = `${e.loader}|${e.slot}`
    const g = groups.get(key) ?? []
    g.push(e)
    groups.set(key, g)
  }
  const counts = new Map()
  for (const e of entries) counts.set(e.combo, (counts.get(e.combo) ?? 0) + 1)

  /** 每组的最终方案 */
  const plan = []
  for (const [key, group] of groups) {
    const [loader, slot] = key.split('|')
    const candidates = [...group].sort((a, b) => {
      const as = a.mc === SEEDS[loader] ? 1 : 0
      const bs = b.mc === SEEDS[loader] ? 1 : 0
      if (as !== bs) return bs - as
      return (counts.get(b.combo) ?? 0) - (counts.get(a.combo) ?? 0)
    })
    let best = null
    for (const cand of candidates.slice(0, 4)) {
      const body = placeholderize(cand.body, literalMaps[loader].get(cand.combo))
      const results = []
      for (const e of group) {
        const c = info.get(e.combo)
        const styleKey = e.style ?? '-'
        if (e.mixed || c.headerConflict.has(styleKey) || c.headers[styleKey] !== e.header) {
          results.push(false)
          continue
        }
        let text
        try {
          text = composeText(c.headers[styleKey] ?? '', body, e.combo, varsByLoader[loader], e.eol)
        } catch { results.push(false); continue }
        results.push(text === e.raw)
      }
      const ok = results.filter(Boolean).length
      if (!best || ok > best.ok) best = { cand, body, results, ok }
      if (ok === group.length) break
    }
    plan.push({ loader, slot, group, canonicalBody: best.body, ok: best.ok, results: best.results })
  }

  const reused = plan.reduce((n, p) => n + p.ok, 0)
  const variantFiles = entries.length - reused
  const canonicalFiles = plan.length
  const combos = info.size

  const dbgIdx = process.argv.indexOf('--debug')
  if (dbgIdx >= 0) {
    const want = process.argv[dbgIdx + 1]
    for (const p of plan) {
      if (`${p.loader}/${p.slot}` !== want) continue
      p.group.forEach((e, i) => {
        const c = info.get(e.combo)
        const sk = e.style ?? '-'
        let reason = 'ok'
        if (e.mixed) reason = 'mixed-eol'
        else if (c.headerConflict.has(sk)) reason = 'header-conflict'
        else if (c.headers[sk] !== e.header) reason = `header-mismatch(${c.headers[sk]?.length} vs ${e.header.length})`
        else {
          try {
            const text = composeText(c.headers[sk] ?? '', p.canonicalBody, e.combo, varsByLoader[p.loader], e.eol)
            if (text !== e.raw) reason = `bytes(${text.length} vs ${e.raw.length})`
          } catch (err) { reason = 'expand:' + err.message }
        }
        console.log(p.results[i] ? 'OK  ' : 'FAIL', e.combo, reason)
      })
      const i = p.results.findIndex((r) => !r)
      if (i >= 0) {
        const e = p.group[i]
        const c = info.get(e.combo)
        let text
        try { text = composeText(c.headers[e.style ?? '-'] ?? '', p.canonicalBody, e.combo, varsByLoader[p.loader], e.eol) } catch (err) { console.log('expand error', err.message); continue }
        const a = text.replace(/\r\n/g, '\n').split('\n')
        const b = e.raw.replace(/\r\n/g, '\n').split('\n')
        let shown = 0
        for (let k = 0; k < Math.max(a.length, b.length) && shown < 8; k++) {
          if (a[k] !== b[k]) { console.log(`L${k} OUT: ${a[k]}`); console.log(`L${k} RAW: ${b[k]}`); shown++ }
        }
        console.log('bytes', text.length, e.raw.length)
      }
    }
  }

  console.log(`组合 ${combos} 个，模板文件 ${entries.length} 个，根级共享文档 ${rootFiles.length} 个`)
  console.log(`canonical 槽位 ${canonicalFiles} 个；可复用 ${reused} 个文件；真实差异 ${variantFiles} 个`)
  console.log(`重构后模板文件数 ≈ ${canonicalFiles + variantFiles} + versions ${combos} + vars ${LOADERS.length}`)
  const bad = plan.filter((p) => p.ok < p.group.length)
  const worst = bad.sort((a, b) => (b.group.length - b.ok) - (a.group.length - a.ok)).slice(0, 12)
  for (const p of worst) console.log(`  ${p.loader}/${p.slot}: ${p.group.length - p.ok}/${p.group.length} 需落 variants`)

  // 每个占位符的实际使用量（便于判断命名是否合理）
  const usedNames = new Map()
  for (const p of plan) for (const m of p.canonicalBody.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)) {
    usedNames.set(m[1], (usedNames.get(m[1]) ?? 0) + 1)
  }
  console.log('占位符使用：', [...usedNames.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '))

  if (MODE === 'plan') {
    console.log('\n[plan] 未写盘。加 --apply 落盘。')
    return
  }
  if (MODE === 'verify') return verify()
  apply({ plan, entries, rootFiles, info, varsByLoader, combos })
}

/* ------------------------------------------------------------------ */
/* 落盘                                                                */
/* ------------------------------------------------------------------ */

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf-8')
}

function apply({ plan, entries, rootFiles, info, varsByLoader, combos }) {
  const canonDir = join(TPL_DIR, 'canonical')
  const varsDir = join(TPL_DIR, 'vars')
  const versionsDir = join(TPL_DIR, 'versions')
  const variantsDir = join(TPL_DIR, 'variants')
  for (const d of [canonDir, varsDir, versionsDir, variantsDir]) rmSync(d, { recursive: true, force: true })

  // 1) canonical
  for (const p of plan) {
    const abs = join(canonDir, p.loader, p.slot)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, p.canonicalBody, 'utf-8')
  }

  // 2) vars（values 只记录与种子不同的取值，缺省回退 seed）
  for (const loader of LOADERS) {
    const vars = {}
    for (const [name, v] of Object.entries(varsByLoader[loader])) {
      const values = {}
      for (const [combo, val] of Object.entries(v.values)) {
        const mc = combo.split('/')[1]
        if (val !== v.seed) values[mc] = val
      }
      vars[name] = { seed: v.seed, values }
    }
    writeJson(join(varsDir, `${loader}.json`), { loader, seed: SEEDS[loader], vars })
  }

  // 3) versions + variants
  const byCombo = new Map()
  for (const p of plan) {
    p.group.forEach((e, i) => {
      const rec = byCombo.get(e.combo) ?? { canonical: [], variants: [], crlf: [], noHeader: [] }
      if (p.results[i]) {
        rec.canonical.push(p.slot)
        if (e.eol === 'crlf') rec.crlf.push(p.slot)
        // 无迁移注释头的稿子（手工维护/种子）不能按扩展名推断头风格
        if (e.style === null) rec.noHeader.push(p.slot)
      } else {
        rec.variants.push(p.slot)
        const abs = join(variantsDir, e.loader, e.mc, e.slot)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, e.raw, 'utf-8')
      }
      byCombo.set(e.combo, rec)
    })
  }
  for (const [combo, rec] of byCombo) {
    const [loader, mc] = combo.split('/')
    const c = info.get(combo)
    writeJson(join(versionsDir, loader, `${mc}.json`), {
      loader,
      mcVersion: mc,
      seed: SEEDS[loader],
      headers: c.headers,
      canonical: rec.canonical.sort(),
      variants: rec.variants.sort(),
      crlf: rec.crlf.sort(),
      noHeader: rec.noHeader.sort()
    })
  }

  // 4) 删旧树（保留根级共享文档）
  for (const loader of LOADERS) {
    const dir = join(TPL_DIR, loader)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }

  // 5) 等价基线 sha1（重构前的原始字节）
  const files = {}
  for (const e of entries) files[e.rel] = sha1(e.raw)
  for (const rel of rootFiles) files[rel] = sha1(readFileSync(join(REF_DIR, rel), 'utf-8'))
  writeJson(BASELINE, {
    note: '重构前 templates 树逐文件 sha1；用于证明 canonical+versions+variants 组合结果逐字节一致',
    referenceDir: 'resources/ai-reference',
    templateCount: Object.keys(files).length,
    files
  })

  console.log(`\n已落盘：canonical ${plan.length}，variants ${entries.length - plan.reduce((n, p) => n + p.ok, 0)}，versions ${combos}，vars ${LOADERS.length}`)
  console.log(`等价基线：${BASELINE}`)
}

/* ------------------------------------------------------------------ */
/* 自检：从新布局组合，逐文件对比基线                                    */
/* ------------------------------------------------------------------ */

function verify() {
  if (!existsSync(BASELINE)) {
    console.error(`基线不存在：${BASELINE}`)
    process.exit(2)
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'))
  const { entries, rootFiles } = scanEntriesFromNewLayout()
  const varsByLoader = {}
  for (const loader of LOADERS) {
    const p = join(TPL_DIR, 'vars', `${loader}.json`)
    varsByLoader[loader] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')).vars : {}
  }
  let ok = 0
  const bad = []
  for (const e of entries) {
    const text = composeTemplate(REF_DIR, { loader: e.loader, mc: e.mc, slot: e.slot })
    if (text === null) { bad.push(`${e.rel} 组合失败`); continue }
    if (sha1(text) === baseline.files[e.rel]) ok++
    else bad.push(e.rel)
  }
  for (const rel of rootFiles) {
    const text = readFileSync(join(REF_DIR, rel), 'utf-8')
    if (sha1(text) === baseline.files[rel]) ok++
    else bad.push(rel)
  }
  console.log(`等价校验：${ok} 通过 / ${bad.length} 不一致（基线共 ${Object.keys(baseline.files).length}）`)
  for (const b of bad.slice(0, 20)) console.log('  ✗', b)
  if (bad.length) process.exit(1)
}

/** verify 用：枚举 manifest 里引用的虚拟路径，而不是磁盘目录 */
function scanEntriesFromNewLayout() {
  const entries = []
  const seen = new Set()
  for (const t of MANIFEST.templates) {
    const m = COMBO_RE.exec(t.file)
    if (!m) continue
    if (seen.has(t.file)) continue
    seen.add(t.file)
    entries.push({ rel: t.file, loader: m[1], mc: m[2], slot: m[3] })
  }
  return { entries, rootFiles: ['templates/weapon-3d-recipes.md', 'templates/geckolib-animations.md'] }
}

function composeTemplate(referenceDir, { loader, mc, slot }) {
  const tplDir = join(referenceDir, 'templates')
  const versionPath = join(tplDir, 'versions', loader, `${mc}.json`)
  if (!existsSync(versionPath)) return null
  const rec = JSON.parse(readFileSync(versionPath, 'utf-8'))
  if (rec.variants.includes(slot)) {
    const abs = join(tplDir, 'variants', loader, mc, slot)
    return existsSync(abs) ? readFileSync(abs, 'utf-8') : null
  }
  if (!rec.canonical.includes(slot)) return null
  const canonAbs = join(tplDir, 'canonical', loader, slot)
  if (!existsSync(canonAbs)) return null
  const varsPath = join(tplDir, 'vars', `${loader}.json`)
  const vars = existsSync(varsPath) ? JSON.parse(readFileSync(varsPath, 'utf-8')).vars : {}
  const extStyle = slot.endsWith('.java') || slot.endsWith('.gradle')
    ? 'block'
    : slot.endsWith('.md') ? 'html' : (slot.endsWith('.properties') || slot.endsWith('.toml')) ? 'hash' : '-'
  const style = rec.noHeader?.includes(slot) ? '-' : extStyle
  const header = rec.headers?.[style] ?? ''
  let body = readFileSync(canonAbs, 'utf-8').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, name) => {
    const v = vars[name]
    if (!v) throw new Error(`未知占位符 ${name}`)
    const val = v.values?.[mc]
    return val !== undefined ? String(val) : String(v.seed)
  })
  // 换行必须在「注释头 + 正文」整体上转换（注释头按 LF 存储）
  const text = header + body
  return rec.crlf.includes(slot) ? text.replace(/\n/g, '\r\n') : text
}

main()
