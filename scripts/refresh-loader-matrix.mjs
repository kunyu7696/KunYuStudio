/**
 * 刷新加载器版本矩阵（Fabric / Forge / NeoForged）。
 *
 * 设计：
 * - 自动从上游元数据拉取"可变版本号"（loader / yarn / fabric-api / forge / neoforge / FG / MDG）；
 *   但 loomVersion / gradleVersion / jdk / hostJdk / forgeConstructorStyle 这些字段没有公共元数据源
 *   （要抓 MDK 仓库分支的 gradle.properties，CI 环境需要单独鉴权/镜像），暂保留矩阵内原值不动；
 *   后续 GitHub raw 通路在 CI 上通了再补全这部分自动推导。
 * - 输出新的 src/main/templates/loaderVersionMatrix.ts：保留原注释与结构，仅在发生变化的条目上覆盖版本号，
 *   并在每个变化行上方插入 // REFRESH: <旧值> → <新值> 标记，便于人工 review。
 * - exit code：0 = 无变化；1 = 有变化；2 = 上游拉取失败（不输出新文件）。
 *
 * 数据源：
 * - Fabric loader / yarn / launcherMeta:   meta.fabricmc.net/v2/versions/*
 * - Fabric API 各线最新构建:              maven.fabricmc.net  maven-metadata.xml
 * - Forge promotions:                     files.minecraftforge.net  promotions_slim.json
 * - ForgeGradle 各 major 最新 patch:      maven.minecraftforge.net  ForgeGradle maven-metadata.xml
 * - NeoForged 各线最新构建:               BMCLAPI maven.neoforged.net  maven-metadata.xml（官方 maven 本机不通）
 * - ModDevGradle 版本（NeoForged 共用）:  BMCLAPI  maven-metadata.xml
 *
 * 用法：
 *   node scripts/refresh-loader-matrix.mjs                       # 输出到 stdout（dry-run 看 diff）
 *   node scripts/refresh-loader-matrix.mjs --write               # 直接写 src/main/templates/loaderVersionMatrix.ts
 *   node scripts/refresh-loader-matrix.mjs --write --check        # CI 门禁：有变化就 exit 1，用于 nightly 自动 PR
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const MATRIX_PATH = resolve(REPO_ROOT, 'src/main/templates/loaderVersionMatrix.ts')

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

// ---------- Fabric ----------

async function fabricLatestLoader(mc) {
  // meta.fabricmc.net/v2/versions/loader/<mc> 已按 stable 优先排序；取首个 stable
  const list = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`)
  const stable = list.find((x) => x.loader?.stable) ?? list[0]
  return {
    loaderVersion: stable.loader.version,
    minJava: stable.launcherMeta?.min_java_version ?? 17
  }
}

async function fabricLatestYarn(mc) {
  // yarn / intermediary 是同一个 channel，MC 26.x 可能返回空数组（官方已停止 Yarn 构建，Loom 改走 Mojang 官方映射）
  try {
    const list = await fetchJson(`https://meta.fabricmc.net/v2/versions/yarn/${encodeURIComponent(mc)}`)
    if (!Array.isArray(list) || list.length === 0) return ''
    // 最新 build（按 build 数字倒序）
    return list.sort((a, b) => (b.build ?? 0) - (a.build ?? 0))[0].version
  } catch {
    return ''
  }
}

async function fabricLatestApi(mc) {
  const xml = await fetchText(
    'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml'
  )
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1])
  // 过滤出该 MC 线（版本号末尾 '+<mc>'）
  const suffix = `+${mc}`
  const matches = all.filter((v) => v.endsWith(suffix))
  if (matches.length === 0) return null
  // 版本号里有 build 号：0.165.2+26.3 vs 0.165.0+26.3，字符串 sort 即可
  return matches.sort().slice(-1)[0]
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

function compareSemver(a, b) {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
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
    // 每个条目形如 'mc.version': { ... },
    const entries = [...block.matchAll(/'([^']+)'\s*:\s*\{([\s\S]*?)\n\s*\}/g)]
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const mcMatch = line.match(mcRe)
    if (mcMatch) {
      curMc = mcMatch[1]
      out += line + '\n'
      continue
    }
    if (!curMc || !mcs.has(curMc)) {
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
      if (String(oldVal) !== String(newVal).replace(/^'|'$/g, '')) {
        const newValStr = typeof newVal === 'string' ? `'${newVal}'` : String(newVal)
        out += `    // REFRESH: ${field} ${oldVal} → ${newVal}\n`
        lineContent = lineContent.replace(fieldRe, `$1${newValStr}`)
      }
    }
    out += lineContent + '\n'
  }
  return out
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
  const fabricUpdates = {}
  for (const mc of matrixMcVersions.fabric) {
    const orig = parsed.fabric[mc]
    const newVals = {}
    try {
      const [loader, yarn, api] = await Promise.all([
        fabricLatestLoader(mc),
        fabricLatestYarn(mc),
        fabricLatestApi(mc)
      ])
      if (loader && loader.loaderVersion !== orig.loaderVersion) {
        // 大跨度保护：Fabric loader 版本号是 0.X.Y 格式，次大版本号差 ≥3 时只输出 diff 不自动覆盖
        // （loom 版本号未纳入自动元数据，大跨度升级需要人工验证 loom 兼容性）
        const oldMinor = Number(orig.loaderVersion.split('.')[1] || 0)
        const newMinor = Number(loader.loaderVersion.split('.')[1] || 0)
        if (Math.abs(newMinor - oldMinor) >= 3) {
          console.log(`  [warn] Fabric ${mc} loader 大跨度 ${orig.loaderVersion}→${loader.loaderVersion}，跳过自动覆盖`)
        } else {
          newVals.loaderVersion = loader.loaderVersion
        }
      }
      if (yarn !== null && yarn !== orig.yarnVersion) newVals.yarnVersion = yarn
      if (api !== null && api !== orig.fabricVersion) newVals.fabricVersion = api
      if (Object.keys(newVals).length > 0) fabricUpdates[mc] = newVals
    } catch (e) {
      console.error(`  [skip] Fabric ${mc}: ${e.message}`)
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
        if (latest.stability !== orig.stability) newVals.stability = latest.stability
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

  console.log(`\n[refresh] 总变更: ${totalChanges} 个 (loader 版本号刷新条目)`)
  for (const [loader, u] of Object.entries(allUpdates)) {
    if (Object.keys(u).length > 0) {
      console.log(`  ${loader}:`)
      for (const [mc, fields] of Object.entries(u)) {
        for (const [f, v] of Object.entries(fields)) console.log(`    ${mc}.${f} → ${v}`)
      }
    }
  }

  if (totalChanges === 0) {
    console.log('[refresh] 上游版本未变，输出文件不动。')
    process.exit(CHECK ? 0 : 0)
    return
  }

  if (!WRITE) {
    console.log('\n[refresh] --write 未指定，dry-run 结束（exit 1 表示有变更）。')
    process.exit(1)
    return
  }

  // --- 生成新文件 ---
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
  process.exit(1)
}

try {
  await main()
} catch (e) {
  console.error(`[refresh] 致命错误: ${e.message}`)
  process.exit(2)
}
