/**
 * 刷新加载器版本矩阵（Fabric / Forge / NeoForged）。
 *
 * 设计原则：**能自动跟的字段必须成组跟，不能跟的字段绝不单独跟。**
 *
 * Fabric 的 loader / yarn / fabric-api / loom / gradle 在官方 MDK 里是同一批升级的
 * （FabricMC/fabric-example-mod 的 <MC 分支>/gradle.properties + gradle-wrapper.properties）。
 * 只要其中一个自动升、另一个不动，矩阵就会变成官方从未验证过的组合，
 * 因此这些字段一律从 MDK 整组取，取不到就整条跳过，不做单字段升级。
 *
 * MDK 数据源（raw.githubusercontent.com 完全公开、零鉴权；Gitee 镜像做兜底）：
 *   https://raw.githubusercontent.com/FabricMC/fabric-example-mod/<mc>/gradle.properties
 *   https://gitee.com/mirrors_fabricmc/fabric-example-mod/raw/<mc>/gradle.properties
 * gradle 版本从同分支 gradle/wrapper/gradle-wrapper.properties 的 distributionUrl 提取。
 *
 * 不自动推导的字段：jdk / hostJdk（MDK 不声明目标 Java，由 MC 线决定）、
 * forgeConstructorStyle、Forge 的 FG 区间与 NeoForge 的 MDG 版本（无统一元数据源）。
 *
 * 输出：
 * - src/main/templates/loaderVersionMatrix.ts：保留原注释与结构，仅在变化行上方插入
 *   // REFRESH: <旧值> → <新值> 标记，便于人工 review。
 * - src/main/templates/mdkSnapshot.json：本次同步到的 MDK 坐标快照（等价于 lockfile）。
 *   loaderVersionMatrix.spec.ts 用它做离线结构断言——矩阵与快照不一致就 fail，
 *   防止"loader 升了、loom 没升"这类半更新再次溜进仓库。
 *
 * exit code：0 = 无变化；1 = 有变化；2 = 上游拉取失败（不输出新文件）。
 *
 * 用法：
 *   node scripts/refresh-loader-matrix.mjs                       # dry-run，打印 diff
 *   node scripts/refresh-loader-matrix.mjs --write               # 写矩阵与快照
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const MATRIX_PATH = resolve(REPO_ROOT, 'src/main/templates/loaderVersionMatrix.ts')
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'src/main/templates/mdkSnapshot.json')

const WRITE = process.argv.includes('--write')
const CHECK = process.argv.includes('--check')

// ---------- fetch 工具 ----------

async function fetchJson(url, timeoutMs = 15000, retries = 2) {
  let last
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'KunYuStudio-matrix-refresh' } })
      if (r.status === 429 || r.status >= 500) {
        last = new Error(`HTTP ${r.status} ${url}`)
        continue
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
      return await r.json()
    } catch (e) {
      last = e
    } finally {
      clearTimeout(timer)
    }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)))
  }
  throw last
}

async function fetchText(url, timeoutMs = 15000, retries = 2) {
  let last
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'KunYuStudio-matrix-refresh' } })
      if (r.status === 429 || r.status >= 500) {
        last = new Error(`HTTP ${r.status} ${url}`)
        continue
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`)
      return await r.text()
    } catch (e) {
      last = e
    } finally {
      clearTimeout(timer)
    }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)))
  }
  throw last
}

// ---------- MC 版本归一 ----------

function mcMajor(mc) {
  const m = /^(\d+)\./.exec(mc)
  return m ? Number(m[1]) : 0
}

// ---------- Fabric：官方 MDK 坐标（loader / yarn / api / loom / gradle 同组） ----------

/** MDK 源，按顺序尝试：GitHub raw 优先，Gitee 镜像兜底（国内网络 raw 常被墙） */
const MDK_SOURCES = [
  (mc) => `https://raw.githubusercontent.com/FabricMC/fabric-example-mod/${mc}`,
  (mc) => `https://gitee.com/mirrors_fabricmc/fabric-example-mod/raw/${mc}`
]

/** 解析 .properties（忽略注释行；值里允许出现 = 与 +） */
function parseProps(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const i = line.indexOf('=')
    if (i <= 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

/**
 * 取某 MC 线官方 MDK 的整组坐标。取不到返回 null（调用方必须整条跳过，不允许半更新）。
 * @returns {Promise<null | {mcVersion:string,loaderVersion:string,yarnVersion:string,fabricVersion:string,loomVersion:string,gradleVersion:string,source:string}>}
 */
async function fetchMdk(mc) {
  for (const base of MDK_SOURCES) {
    const root = base(mc)
    let props
    try {
      props = parseProps(await fetchText(`${root}/gradle.properties`))
    } catch {
      continue // 该分支不存在或网络不通，试下一个源
    }
    if (!props.loader_version || !props.loom_version) continue
    // gradle 版本从同分支 wrapper 提取；拿不到就留空（留空表示不覆盖矩阵现有值）
    let gradleVersion = ''
    try {
      const wrapper = parseProps(await fetchText(`${root}/gradle/wrapper/gradle-wrapper.properties`))
      gradleVersion = /gradle-([\d.]+)-(?:bin|all)\.zip/.exec(wrapper.distributionUrl ?? '')?.[1] ?? ''
    } catch {
      /* wrapper 缺失不致命 */
    }
    return {
      mcVersion: mc,
      loaderVersion: props.loader_version,
      yarnVersion: props.yarn_mappings ?? '',
      fabricVersion: props.fabric_api_version ?? '',
      loomVersion: props.loom_version,
      gradleVersion,
      source: root
    }
  }
  return null
}

// ---------- 版本比较 ----------

function compareSemver(a, b) {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * loom 版本 → 宿主 JVM 最低版本（沿用矩阵里已真机验证过的观察值）：
 *   1.18.x 起 loom 强制 JVM 25（1.21.6+ 条目 hostJdk=25 的来源）
 *   1.10.x 起强制 JVM 21，1.6/1.4 时代 JVM 17 即可。
 * loom 大版本变动时请同步复核这张表。
 */
function hostJdkForLoom(loomVersion) {
  const m = /^(\d+)\.(\d+)/.exec(loomVersion)
  if (!m) return 17
  const major = Number(m[1])
  const minor = Number(m[2])
  if (major > 1) return 25
  if (minor >= 18) return 25
  if (minor >= 10) return 21
  return 17
}

// ---------- Forge ----------

async function forgeLatest(mc) {
  const promo = await fetchJson(
    'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
  )
  const promos = promo.promos ?? {}
  const rec = promos[`${mc}-recommended`]
  const lat = promos[`${mc}-latest`]
  if (!rec && !lat) return null
  return rec ?? lat
}

async function forgeGradleLatest(mc) {
  const xml = await fetchText(
    'https://maven.minecraftforge.net/net/minecraftforge/gradle/ForgeGradle/maven-metadata.xml'
  )
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  const major = mcMajor(mc)
  // 1.x MC：ForgeGradle major 映射：1.18/1.19→5, 1.20/1.21→6, 26+→7
  const fgMajor = major === 1 ? (/^1\.(18|19)\./.test(mc) ? 5 : /^1\.(20|21)\./.test(mc) ? 6 : 4) : 7
  const line = all.filter((v) => v.startsWith(`${fgMajor}.`))
  if (line.length === 0) return null
  // 取该 major 最新 patch（字符串 sort 足够，因为 patch 是数字）
  const latestPatch = line.sort().slice(-1)[0]
  // 区间：[major.0.0, (major+1).0)
  return { version: latestPatch, range: `[${fgMajor}.0.0,${fgMajor + 1}.0)` }
}

// ---------- NeoForged ----------

function sortNeoForgeVersions(a, b) {
  // NeoForge 版本号有 -beta 后缀，先剥掉再逐段数字比较
  function parts(v) {
    return v.split('-')[0].split('.').map((x) => Number.parseInt(x, 10) || 0)
  }
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  // 同数字段：正式版 > beta（稳定优先）
  if (a.includes('-beta') && !b.includes('-beta')) return -1
  if (!a.includes('-beta') && b.includes('-beta')) return 1
  return 0
}

async function neoForgeAllLatest(neoforgeMcList) {
  // BMCLAPI 镜像（maven.neoforged.net 官方仓库本机不通）
  // 只 fetch 一次，按各 MC 线的前缀匹配各自最新版本，避免并发触发 429
  let xml
  try {
    xml = await fetchText(
      'https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/maven-metadata.xml'
    )
  } catch (e) {
    console.error(`  [skip] NeoForge maven-metadata.xml 不可达: ${e.message}`)
    return {}
  }
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  const result = {}
  for (const mc of neoforgeMcList) {
    let prefix
    const maj = mcMajor(mc)
    if (maj === 1) {
      const m = /^1\.(\d+)\.(\d+)$/.exec(mc)
      if (!m) continue
      const minor = Number(m[1])
      const patch = Number(m[2])
      prefix = `${minor}.${patch}.`
    } else {
      prefix = `${maj}.`
    }
    const matches = all.filter((v) => v.startsWith(prefix))
    if (matches.length === 0) continue
    // 语义版本排序（字符串 sort 会把 21.1.99 排在 21.1.250 前面）
    const sorted = matches.sort(sortNeoForgeVersions)
    const latest = sorted.slice(-1)[0]
    const isBeta = latest.includes('-beta')
    result[mc] = { version: latest, stability: isBeta ? 'beta' : undefined }
  }
  return result
}

async function modDevGradleLatest() {
  // BMCLAPI 路径是 /maven2/... 而非 /maven/...（之前 404 就是路径错了）
  const urls = [
    'https://bmclapi2.bangbang93.com/maven2/net/neoforged/moddevgradle/maven-metadata.xml',
    'https://maven.neoforged.net/releases/net/neoforged/moddevgradle/maven-metadata.xml'
  ]
  for (const u of urls) {
    try {
      const xml = await fetchText(u)
      const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map((m) => m[1])
        .filter((v) => !v.includes('-beta') && !v.includes('-rc') && !v.includes('-alpha'))
      if (all.length === 0) continue
      return all.sort(compareSemver).slice(-1)[0]
    } catch {
      /* 下一个 */
    }
  }
  return null
}

// ---------- MDK 快照（离线结构断言的基准） ----------

/** 读已有快照；文件不存在或损坏时返回空对象（首轮由脚本生成） */
function readSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) return {}
  try {
    const raw = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    console.error('[refresh] mdkSnapshot.json 解析失败，按空快照处理')
    return {}
  }
}

/** 按 MC 版本排序后序列化，保证 diff 稳定 */
function serializeSnapshot(snapshot) {
  const sorted = {}
  for (const mc of Object.keys(snapshot).sort(compareSemver)) {
    const e = snapshot[mc]
    if (!e) continue
    sorted[mc] = {
      loaderVersion: e.loaderVersion,
      yarnVersion: e.yarnVersion,
      fabricVersion: e.fabricVersion,
      loomVersion: e.loomVersion,
      gradleVersion: e.gradleVersion
    }
  }
  return JSON.stringify(sorted, null, 2) + '\n'
}

// ---------- 解析现有矩阵 ----------

function parseMatrixObjects(ts) {
  // 抽 FABRIC_MATRIX / FORGE_MATRIX / NEOFORGE_MATRIX 三个对象块，key=MC 版本号
  const result = { fabric: {}, forge: {}, neoforge: {} }
  const map = {
    fabric: /const\s+FABRIC_MATRIX\s*:\s*Record<string,\s*FabricToolchain>\s*=\s*\{([\s\S]*?)\n\}/.exec(ts),
    forge: /const\s+FORGE_MATRIX\s*:\s*Record<string,\s*ForgeToolchain>\s*=\s*\{([\s\S]*?)\n\}/.exec(ts),
    neoforge: /const\s+NEOFORGE_MATRIX\s*:\s*Record<string,\s*NeoForgeToolchain>\s*=\s*\{([\s\S]*?)\n\}/.exec(ts)
  }
  for (const [name, m] of Object.entries(map)) {
    if (!m) continue
    const block = m[1]
    // 先剔除注释行：被注释掉的历史条目（如 1.16.5）不应进入本次刷新目标，
    // 否则会被算进「变更条数」，且 patch 时也没有对应可改的真实行。
    const live = block
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    // 每个条目形如 'mc.version': { ... },
    const entries = [...live.matchAll(/'([^']+)'\s*:\s*\{([\s\S]*?)\n\s*\}/g)]
    for (const e of entries) {
      const mc = e[1]
      const obj = {}
      // 抽每个 key: value（字符串值 + 数字 + stability）
      const kv = [...e[2].matchAll(/(\w+)\s*:\s*('[^']*'|\d+(?:\.\d+)?|true|false|'beta'|'stable'|'classic'|'injected'|'modbusgroup')/g)]
      for (const k of kv) {
        const key = k[1]
        let val = k[2]
        if (val.startsWith("'")) {
          val = val.slice(1, -1)
        } else if (/^\d/.test(val)) {
          val = Number(val)
        }
        obj[key] = val
      }
      result[name][mc] = obj
    }
  }
  return result
}

// ---------- 生成新矩阵 ----------

function rebuildMatrixBlock(name, origBlock, updates) {
  // updates: Map<mc, { field: newValue }>   — 每个 MC 版本需要更新的字段
  // 从原 block 里逐行处理：
  //   - 非目标 MC 条目：原样追加
  //   - 目标 MC 条目：检查行内是否命中要替换的 field，命中 → 替换 + 注释；未命中 → 原样追加
  // 所有字段都在同一行的（loader / yarn / fabric / gradle / jdk 等挤同一行），
  // 只对该行执行一次替换（第一个命中的 field 生效，后续合并到一起处理更复杂，暂不追求最优）。
  let out = ''
  const mcs = new Set(Object.keys(updates))
  const mcRe = new RegExp(`'([^']+)'\\s*:\\s*\\{`)
  const lines = origBlock.split('\n')
  let curMc = null
  /** 注释行不参与「条目起点」识别与字段替换：否则被注释掉的 1.16.5 条目会被误改 */
  const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const mcMatch = isComment(line) ? null : line.match(mcRe)
    if (mcMatch) {
      curMc = mcMatch[1]
      out += line + '\n'
      continue
    }
    if (!curMc || !mcs.has(curMc) || isComment(line)) {
      out += line + '\n'
      continue
    }
    const u = updates[curMc]
    // 找出这行里命中的所有需要替换的 field
    const hits = []
    for (const [field, newVal] of Object.entries(u)) {
      const fieldRe = new RegExp(`(\\b${field}\\s*:\\s*)('[^']*'|\\d+(?:\\.\\d+)?)`)
      const m = line.match(fieldRe)
      if (m) {
        const oldVal = m[2].startsWith("'") ? m[2].slice(1, -1) : m[2]
        hits.push({ field, oldVal, newVal, fieldRe })
      }
    }
    if (hits.length === 0) {
      out += line + '\n'
      continue
    }
    // 同一行可能有多个要刷新的 key（例如 loaderVersion 与 yarnVersion 在同一行），
    // 依次替换，每个替换前都写一条 REFRESH 注释。
    let lineContent = line
    for (const { field, oldVal, newVal, fieldRe } of hits) {
      if (typeof newVal === 'undefined') {
        // 上游去掉了该标记（如 NeoForge 26.3 由 -beta 转正）：
        // 从对象里删掉属性，而不是写成 `stability: undefined`（后者会污染生成的源码）
        out += `    // REFRESH: ${field} ${oldVal} → 移除（上游已取消该标记）\n`
        const lead = new RegExp(`\\b${field}\\s*:\\s*'[^']*'\\s*,\\s*`)
        const trail = new RegExp(`\\s*,\\s*\\b${field}\\s*:\\s*'[^']*'`)
        lineContent = lead.test(lineContent)
          ? lineContent.replace(lead, '')
          : lineContent.replace(trail, '')
        continue
      }
      if (String(oldVal) !== String(newVal).replace(/^'|'$/g, '')) {
        const newValStr = typeof newVal === 'string' ? `'${newVal}'` : String(newVal)
        out += `    // REFRESH: ${field} ${oldVal} → ${newVal}\n`
        lineContent = lineContent.replace(fieldRe, `$1${newValStr}`)
      }
    }
    out += lineContent + '\n'
  }
  // 每行都补了 '\n'，末尾会多出一个：去掉，避免在对象闭合前多出空行
  return out.replace(/\n$/, '')
}

// ---------- 主流程 ----------

async function main() {
  const src = readFileSync(MATRIX_PATH, 'utf8').replace(/\r\n/g, '\n')
  const parsed = parseMatrixObjects(src)

  // 收集上游元数据（并行）
  const matrixMcVersions = {
    fabric: Object.keys(parsed.fabric),
    forge: Object.keys(parsed.forge),
    neoforge: Object.keys(parsed.neoforge)
  }
  const allMcs = [...new Set([
    ...matrixMcVersions.fabric,
    ...matrixMcVersions.forge,
    ...matrixMcVersions.neoforge
  ])].sort()

  console.log(`[refresh] 追踪 ${allMcs.length} 个 MC 版本: ${allMcs.join(', ')}`)

  // --- Fabric ---
  // 整组跟随官方 MDK：loader / yarn / fabric-api / loom / gradle 必须一起动。
  // MDK 取不到就整条跳过——宁可过期，也不能造出"loader 升了、loom 没升"的组合。
  const fabricUpdates = {}
  const fabricHolds = []
  const mdkSnapshot = { ...readSnapshot() }
  for (const mc of matrixMcVersions.fabric) {
    const orig = parsed.fabric[mc]
    const mdk = await fetchMdk(mc)
    if (!mdk) {
      console.log(`  [skip] Fabric ${mc}: 未取到官方 MDK 坐标，整条跳过（不做单字段升级）`)
      continue
    }
    // JDK 门槛检查：loom 升到需要更高 JVM 时，若矩阵宿主 JDK 不够，
    // 这次升级必须连 jdk / hostJdk 一起改——属于产品级决策，脚本只报告不写。
    // 宁可这一行继续过期，也不能产出"loom 1.19 + JDK 17"这种必然跑不起来的组合。
    const needHostJdk = hostJdkForLoom(mdk.loomVersion)
    const curHostJdk = orig.hostJdk ?? orig.jdk
    if (needHostJdk > curHostJdk) {
      console.log(
        `  [hold] Fabric ${mc}: loom ${orig.loomVersion} → ${mdk.loomVersion} 需要宿主 JDK ${needHostJdk}，` +
          `当前 ${curHostJdk}；需人工确认 JDK 后整组升级`
      )
      fabricHolds.push({ mc, loomVersion: mdk.loomVersion, needHostJdk, curHostJdk })
      // 快照保持上一次的值（＝矩阵当前值）：hold 的条目不能被上游值污染，
      // 否则结构断言会一直红
      continue
    }

    // 快照记录上游值，只有实际采用的条目才写（hold 的条目保持旧快照）
    mdkSnapshot[mc] = mdk

    const newVals = {}
    // 空值表示 MDK 未声明该字段（如 26.x 无 yarn），保留矩阵现有值
    for (const field of ['loaderVersion', 'yarnVersion', 'fabricVersion', 'loomVersion', 'gradleVersion']) {
      const next = mdk[field]
      if (next && next !== orig[field]) newVals[field] = next
    }
    if (Object.keys(newVals).length > 0) {
      // 明确打印整组变更，让 review 时一眼看到 loader/loom/gradle 是否同步
      const parts = ['loaderVersion', 'yarnVersion', 'fabricVersion', 'loomVersion', 'gradleVersion']
        .map((f) => `${f}: ${orig[f]} → ${newVals[f] ?? orig[f]}`)
        .join(' | ')
      console.log(`  [mdk] ${mc}: ${parts}`)
      fabricUpdates[mc] = newVals
    }
  }
  if (fabricHolds.length > 0) {
    console.log('\n[refresh] 以下条目因宿主 JDK 不足被 hold（需人工决策）：')
    for (const h of fabricHolds) {
      console.log(`  - ${h.mc}: loom → ${h.loomVersion} 需 JDK ${h.needHostJdk}（当前 ${h.curHostJdk}）`)
    }
  }

  // --- Forge ---
  const forgeUpdates = {}
  for (const mc of matrixMcVersions.forge) {
    const orig = parsed.forge[mc]
    const newVals = {}
    try {
      const [forge, fg] = await Promise.all([
        forgeLatest(mc),
        forgeGradleLatest(mc)
      ])
      if (forge && forge !== orig.forgeVersion) newVals.forgeVersion = forge
      if (fg && fg.version) {
        // FG 版本号直接在字符串里带；区间写死按 major 推（[major.0.0, major+1.0)）
        const curMajor = /^\[(\d+)\./.exec(orig.forgeGradleVersion)?.[1]
        if (fg.version.startsWith((curMajor ?? '').slice(0, 1))) {
          // 同一 major 只更新 patch：比如 [6.0,6.2) 保持区间不变，不动（上游可能还在 6.0.x 各小版本）
          // 但如果原版本号写了具体 FG 版本（而非区间），那就更新
          const curFg = orig.forgeGradleVersion
          const exact = /^(\d+\.\d+\.\d+)$/.exec(curFg)
          if (exact && exact[1] !== fg.version) newVals.forgeGradleVersion = fg.version
        }
      }
      if (Object.keys(newVals).length > 0) forgeUpdates[mc] = newVals
    } catch (e) {
      console.error(`  [skip] Forge ${mc}: ${e.message}`)
    }
  }

  // --- NeoForged ---
  const neoforgeUpdates = {}
  const [allLatest, moddevgradle] = await Promise.all([
    neoForgeAllLatest(matrixMcVersions.neoforge),
    modDevGradleLatest()
  ])
  for (const mc of matrixMcVersions.neoforge) {
    const orig = parsed.neoforge[mc]
    const latest = allLatest[mc]
    const newVals = {}
    try {
      if (latest) {
        if (latest.version !== orig.neoForgeVersion) newVals.neoForgeVersion = latest.version
        // 只做「上游转正 → 解除 beta」，绝不自动加禁用：
        // 1.21.6/1.21.7/1.21.9 线官方只发 -beta 构建，但产品上仍允许创建
        // （loaderVersionMatrix.spec.ts 的 NEW_VERS 断言 isSupportedCombo=true），
        // 自动加 stability='beta' 会与 spec 冲突并让本脚本每天都报「有变更」。
        if (orig.stability === 'beta' && latest.stability !== 'beta') newVals.stability = undefined
      }
      // ModDevGradle：所有 NeoForge 线共用同一版本号（26.3 beta 行的 orig.modDevGradleVersion 是空串，跳过）
      if (moddevgradle && orig.modDevGradleVersion && orig.modDevGradleVersion !== '' && moddevgradle !== orig.modDevGradleVersion) {
        newVals.modDevGradleVersion = moddevgradle
      }
      if (Object.keys(newVals).length > 0) neoforgeUpdates[mc] = newVals
    } catch (e) {
      console.error(`  [skip] NeoForge ${mc}: ${e.message}`)
    }
  }

  // --- 汇总 diff ---
  const allUpdates = {
    fabric: fabricUpdates,
    forge: forgeUpdates,
    neoforge: neoforgeUpdates
  }
  const totalChanges = Object.values(allUpdates).reduce(
    (n, u) => n + Object.keys(u).length,
    0
  )

  // 快照也要落盘：首次生成或有新增/变动时算作变化
  const nextSnapshotText = serializeSnapshot(mdkSnapshot)
  const prevSnapshotText = existsSync(SNAPSHOT_PATH) ? readFileSync(SNAPSHOT_PATH, 'utf8') : ''
  const snapshotChanged = nextSnapshotText.trim() !== prevSnapshotText.trim()

  console.log(`\n[refresh] 总变更: ${totalChanges} 个矩阵条目，快照${snapshotChanged ? '有变化' : '无变化'}`)
  for (const [loader, u] of Object.entries(allUpdates)) {
    if (Object.keys(u).length > 0) {
      console.log(`  ${loader}:`)
      for (const [mc, fields] of Object.entries(u)) {
        for (const [f, v] of Object.entries(fields)) console.log(`    ${mc}.${f} → ${v}`)
      }
    }
  }

  if (totalChanges === 0 && !snapshotChanged) {
    console.log('[refresh] 上游版本未变，输出文件不动。')
    process.exit(0)
  }

  if (!WRITE) {
    console.log('\n[refresh] --write 未指定，dry-run 结束（exit 1 表示有变更）。')
    process.exit(1)
  }

  // --- 生成新矩阵 ---
  let out = src
  for (const [loader, updates] of Object.entries(allUpdates)) {
    if (Object.keys(updates).length === 0) continue
    const constName = loader.toUpperCase() + '_MATRIX'
    const re = new RegExp(`(const\\s+${constName}[\\s\\S]*?=\\s*\\{\\n)([\\s\\S]*?)(\\n\\})`)
    const m = out.match(re)
    if (!m) {
      console.error(`[refresh] 无法定位 ${constName} 块，跳过`)
      continue
    }
    const newBlock = rebuildMatrixBlock(loader, m[2], updates)
    out = out.replace(re, `$1${newBlock}$3`)
  }

  // 在文件头追加 refresh 时间戳注释
  const stamp = `// refresh-loader-matrix.mjs 刷新于 ${new Date().toISOString().slice(0, 10)}（${totalChanges} 条变更）\n`
  if (!out.includes('// refresh-loader-matrix.mjs 刷新于')) {
    out = stamp + out
  } else {
    out = out.replace(/\/\/ refresh-loader-matrix\.mjs 刷新于[^\n]*\n/, stamp)
  }

  writeFileSync(MATRIX_PATH, out, 'utf8')
  console.log(`[refresh] 已写 ${MATRIX_PATH}`)
  if (snapshotChanged) {
    writeFileSync(SNAPSHOT_PATH, nextSnapshotText, 'utf8')
    console.log(`[refresh] 已写 ${SNAPSHOT_PATH}`)
  }
  process.exit(1)
}

try {
  await main()
} catch (e) {
  console.error(`[refresh] 致命错误: ${e.message}`)
  process.exit(2)
}
