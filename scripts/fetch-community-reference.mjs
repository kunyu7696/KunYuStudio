#!/usr/bin/env node
/**
 * fetch-community-reference.mjs
 *
 * 「AI 反幻觉参考包」补充数据（M7 计划）：从 Minecraft 公共社区与官方来源
 * 拉取参考资料（仅元数据与开源代码文本），落到 resources/ai-reference/community/。
 *
 * - Node >= 18（global fetch），无第三方依赖
 * - 来源仅限 raw.githubusercontent.com / api.github.com / api.modrinth.com
 * - 单文件失败重试 1 次；仍失败记入 provenance.json 的 failed 数组并继续
 * - 幂等：已存在且内容非 404 页面的文件跳过
 *
 * 只收集，不改动项目源码。index.json / provenance.json 每次运行都会重新生成。
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'resources', 'ai-reference', 'community');

const USER_AGENT = 'KunYuEcosystem-reference-fetch/1.0';
const RETRY_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const describeError = (e) => (e && e.message ? e.message : String(e));

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** 判断文本是否疑似 404/错误页（部分代理会把 404 以 200 + 文本正文返回） */
function looksLike404(text) {
  if (typeof text !== 'string') return true;
  const t = text.trim();
  if (!t) return true;
  if (t.length < 200 && /^40\d[:\s]/.test(t)) return true; // "404: Not Found" 等
  if (/404: Not Found|400: Invalid request|403: Forbidden/i.test(t.slice(0, 120))) return true;
  return false;
}

/**
 * 抓取文本。默认 attempts=2（失败重试 1 次）。
 * 404 属确定性失败，不重试，直接抛出（交给 fallback / failed 处理）。
 */
async function fetchText(url, { headers = {}, attempts = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, redirect: 'follow' });
      if (res.ok) return await res.text();
      const err = new Error(`HTTP ${res.status} ${res.statusText || ''} — ${url}`);
      err.status = res.status;
      if (res.status === 404 || attempt >= attempts) throw err;
      lastErr = err;
    } catch (e) {
      if (e.status === 404) throw e;
      lastErr = e;
      if (attempt >= attempts) throw lastErr;
    }
    await sleep(RETRY_DELAY_MS);
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}

// ---------------------------------------------------------------------------
// 抓取计划：官方仓库选摘
// ---------------------------------------------------------------------------

const REPOS = [
  {
    id: 'fabric-example-mod',
    repo: 'FabricMC/fabric-example-mod',
    branch: 'master',
    license: 'CC0-1.0',
    dir: 'examples/fabric-example-mod',
    files: [
      { remote: 'build.gradle', local: 'build.gradle' },
      { remote: 'gradle.properties', local: 'gradle.properties' },
      { remote: 'settings.gradle', local: 'settings.gradle' },
      { remote: 'src/main/resources/fabric.mod.json', local: 'src/main/resources/fabric.mod.json' },
      {
        remote: 'src/main/java/com/example/templates/ExampleMod.java',
        local: 'src/main/java/com/example/templates/ExampleMod.java',
        // 该文件若移动过位置：全仓库搜索同名文件
        searchDir: '',
      },
    ],
  },
  {
    id: 'forge-mdk',
    repo: 'MinecraftForge/MinecraftForge',
    branch: '1.20.x',
    license: 'LGPL-2.1',
    licenseNote: '参考用，勿直接分发；MDK 示例文件允许作为参考',
    dir: 'examples/forge-mdk',
    prefix: 'mdk/',
    files: [
      { remote: 'mdk/build.gradle', local: 'build.gradle' },
      { remote: 'mdk/gradle.properties', local: 'gradle.properties' },
      { remote: 'mdk/settings.gradle', local: 'settings.gradle' },
      { remote: 'mdk/src/main/resources/META-INF/mods.toml', local: 'src/main/resources/META-INF/mods.toml' },
      { remote: 'mdk/src/main/java/com/example/examplemod/ExampleMod.java', local: 'src/main/java/com/example/examplemod/ExampleMod.java' },
      { remote: 'mdk/src/main/java/com/example/examplemod/Config.java', local: 'src/main/java/com/example/examplemod/Config.java' },
    ],
  },
  {
    id: 'neoforge-mdg',
    repo: 'neoforged/ModDevGradle',
    branch: 'main',
    license: 'LGPL-2.1',
    dir: 'examples/neoforge-mdg',
    prefix: 'testproject/',
    files: [
      { remote: 'testproject/build.gradle', local: 'build.gradle' },
      { remote: 'testproject/gradle.properties', local: 'gradle.properties' },
      {
        remote: 'testproject/src/main/resources/META-INF/neoforge.mods.toml',
        local: 'src/main/resources/META-INF/neoforge.mods.toml',
        altNames: ['mods.toml'],
      },
    ],
  },
];

const MODRINTH_LOADERS = ['fabric', 'forge', 'neoforge'];

// ---------------------------------------------------------------------------
// git trees API fallback（仅在直接抓取 404 时使用）
// 注：分支可能被改名（如 fabric-example-mod 的默认分支现为 26.2，master 已非
// 有效 ref），因此回退链的最后一步是解析仓库当前 default_branch 再查树。
// ---------------------------------------------------------------------------

async function resolveDefaultBranch(repo, cache, provenance) {
  if (cache[`__db:${repo.repo}`]) return cache[`__db:${repo.repo}`];
  const url = `https://api.github.com/repos/${repo.repo}`;
  const text = await fetchText(url, { headers: { Accept: 'application/vnd.github+json' } });
  const data = JSON.parse(text);
  const db = data && data.default_branch ? data.default_branch : null;
  cache[`__db:${repo.repo}`] = db;
  provenance.apiRequests.push({
    url,
    purpose: `resolve default_branch: ${repo.repo} (configured=${repo.branch})`,
    result: db,
    fetchedAt: new Date().toISOString(),
  });
  return db;
}

async function loadRepoTreePaths(repo, branch, cache, provenance) {
  const key = `${repo.repo}@${branch}`;
  if (cache[key]) return cache[key];
  const url = `https://api.github.com/repos/${repo.repo}/git/trees/${branch}?recursive=1`;
  const text = await fetchText(url, { headers: { Accept: 'application/vnd.github+json' } });
  const data = JSON.parse(text);
  const paths = (data.tree || []).filter((t) => t.type === 'blob').map((t) => t.path);
  cache[key] = paths;
  provenance.apiRequests.push({
    url,
    purpose: `git trees fallback lookup: ${repo.repo}@${branch}`,
    truncated: Boolean(data.truncated),
    fetchedAt: new Date().toISOString(),
  });
  return paths;
}

/** 在仓库树中按目录前缀 + 文件名（含备选名）定位实际路径 */
async function findViaTree(repo, branch, fileSpec, cache, provenance) {
  const paths = await loadRepoTreePaths(repo, branch, cache, provenance);
  const lastSlash = fileSpec.remote.lastIndexOf('/');
  const dirPrefix = lastSlash >= 0 ? fileSpec.remote.slice(0, lastSlash + 1) : '';
  const base = lastSlash >= 0 ? fileSpec.remote.slice(lastSlash + 1) : fileSpec.remote;
  const searchDir = fileSpec.searchDir !== undefined ? fileSpec.searchDir : dirPrefix;
  for (const name of [base, ...(fileSpec.altNames || [])]) {
    const matches = paths.filter(
      (p) => (!searchDir || p.startsWith(searchDir)) && (p === searchDir + name || p.endsWith('/' + name)),
    );
    if (matches.length > 0) return matches[0];
  }
  return null;
}

/**
 * 抓取单个仓库文件，回退链：
 * 1) 配置分支 raw 直连 → 2) 配置分支 git trees 定位 → 3) 仓库 default_branch 定位。
 * 返回 { text, sourceUrl, viaBranch?, viaTreePath? }，全部失败则抛错。
 */
async function obtainFile(repo, f, cache, provenance) {
  const rawUrl = (branch, p) => `https://raw.githubusercontent.com/${repo.repo}/${branch}/${p}`;
  try {
    return { text: await fetchText(rawUrl(repo.branch, f.remote)), sourceUrl: rawUrl(repo.branch, f.remote) };
  } catch (directErr) {
    let lastErr = describeError(directErr);

    // 回退 2：配置分支 git trees
    let found = null;
    try {
      found = await findViaTree(repo, repo.branch, f, cache, provenance);
    } catch (e) {
      lastErr = `${lastErr}; trees(${repo.branch}): ${describeError(e)}`;
    }
    if (found) {
      const url = rawUrl(repo.branch, found);
      return { text: await fetchText(url), sourceUrl: url, viaTreePath: found };
    }

    // 回退 3：仓库实际 default_branch（分支改名场景）
    const db = await resolveDefaultBranch(repo, cache, provenance);
    if (db && db !== repo.branch) {
      let found2 = null;
      try {
        found2 = await findViaTree(repo, db, f, cache, provenance);
      } catch (e) {
        lastErr = `${lastErr}; trees(${db}): ${describeError(e)}`;
      }
      if (found2) {
        const url = rawUrl(db, found2);
        return { text: await fetchText(url), sourceUrl: url, viaTreePath: found2, viaBranch: db };
      }
    }
    throw new Error(lastErr);
  }
}

// ---------------------------------------------------------------------------
// Modrinth 公共社区索引（元数据 only，不下载 mod 文件本体）
// ---------------------------------------------------------------------------

async function fetchModrinthLoader(loader) {
  const params = new URLSearchParams({
    limit: '15',
    index: 'downloads',
    loaders: JSON.stringify([loader]),
    facets: JSON.stringify([['project_type:mod']]),
  });
  const url = `https://api.modrinth.com/v2/search?${params.toString()}`;
  const text = await fetchText(url);
  const data = JSON.parse(text);
  const items = (data.hits || []).map((h) => ({
    slug: h.slug,
    title: h.title,
    downloads: h.downloads,
    follows: h.follows,
    license: h.license && h.license.id ? h.license.id : null,
    categories: Array.isArray(h.categories) ? h.categories : [],
    clientSide: h.client_side ?? null,
    serverSide: h.server_side ?? null,
    dateModified: h.date_modified ?? null,
    url: `https://modrinth.com/mod/${h.slug}`,
  }));
  return { url, items };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const now = new Date().toISOString();
  const provenance = { generatedAt: now, files: [], failed: [], apiRequests: [] };
  const officialRepos = [];
  const treeCache = {};
  let okCount = 0;
  let cachedCount = 0;
  let failCount = 0;

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`输出目录: ${OUT_DIR}`);

  // ---- 1. 官方仓库源码选摘 ----
  for (const repo of REPOS) {
    console.log(`\n== ${repo.repo} @ ${repo.branch} ==`);
    const repoEntry = {
      repo: repo.repo,
      branch: repo.branch,
      license: repo.license,
      ...(repo.licenseNote ? { licenseNote: repo.licenseNote } : {}),
      url: `https://github.com/${repo.repo}`,
      localDir: repo.dir,
      files: [],
    };

    for (const f of repo.files) {
      let relPath = `${repo.dir}/${f.local}`;
      let localAbs = path.join(OUT_DIR, repo.dir, f.local);
      const provEntry = {
        path: relPath,
        url: `https://raw.githubusercontent.com/${repo.repo}/${repo.branch}/${f.remote}`,
        license: repo.license,
        ...(repo.licenseNote ? { licenseNote: repo.licenseNote } : {}),
        fetchedAt: now,
      };

      // 幂等：已存在且内容非 404 页面 → 跳过
      if (await exists(localAbs)) {
        const cur = await readFile(localAbs, 'utf8').catch(() => '');
        if (!looksLike404(cur)) {
          provEntry.cached = true;
          provenance.files.push(provEntry);
          repoEntry.files.push({ path: relPath, source: provEntry.url, status: 'cached' });
          cachedCount++;
          console.log(`  [skip] ${relPath}（已存在）`);
          continue;
        }
      }

      let result = null;
      let errMsg = null;
      try {
        result = await obtainFile(repo, f, treeCache, provenance);
      } catch (e) {
        errMsg = describeError(e);
      }

      if (result && result.text != null && !looksLike404(result.text)) {
        // 经 trees 定位到实际路径时，本地按真实源码路径存放（去掉仓库子目录前缀）
        if (result.viaTreePath) {
          const prefix = repo.prefix || '';
          const realLocal = result.viaTreePath.startsWith(prefix)
            ? result.viaTreePath.slice(prefix.length)
            : result.viaTreePath;
          relPath = `${repo.dir}/${realLocal}`;
          localAbs = path.join(OUT_DIR, repo.dir, realLocal);
          provEntry.path = relPath;
          provEntry.viaTreePath = result.viaTreePath;
        }
        if (result.viaBranch) {
          provEntry.viaBranch = result.viaBranch;
          if (!repoEntry.defaultBranch) repoEntry.defaultBranch = result.viaBranch;
        }
        // 来源 URL 以实际抓取成功的 URL 为准（回退定位时与初始尝试 URL 不同）
        provEntry.url = result.sourceUrl;
        await mkdir(path.dirname(localAbs), { recursive: true });
        await writeFile(localAbs, result.text, 'utf8');
        provenance.files.push(provEntry);
        repoEntry.files.push({ path: relPath, source: result.sourceUrl, status: 'ok' });
        okCount++;
        console.log(`  [ok] ${relPath}${result.viaBranch ? `（经分支 ${result.viaBranch}）` : ''}`);
      } else {
        provenance.failed.push({
          path: relPath,
          url: provEntry.url,
          error: errMsg ?? (result ? '响应内容疑似 404 页面' : 'unknown'),
          fetchedAt: now,
        });
        repoEntry.files.push({ path: relPath, source: provEntry.url, status: 'failed', error: errMsg ?? 'unknown' });
        failCount++;
        console.log(`  [FAIL] ${relPath} — ${errMsg ?? 'unknown'}`);
      }
    }
    officialRepos.push(repoEntry);
  }

  // ---- 2. Modrinth 社区索引（元数据） ----
  console.log('\n== Modrinth search (metadata only) ==');
  const modrinth = {};
  for (const loader of MODRINTH_LOADERS) {
    try {
      const { url, items } = await fetchModrinthLoader(loader);
      modrinth[loader] = items;
      provenance.apiRequests.push({
        url,
        purpose: `modrinth search: loaders=["${loader}"]`,
        count: items.length,
        fetchedAt: now,
      });
      console.log(`  [ok] ${loader}: ${items.length} 条`);
    } catch (e) {
      modrinth[loader] = [];
      provenance.failed.push({
        path: `index.json#modrinth.${loader}`,
        url: `https://api.modrinth.com/v2/search?limit=15&index=downloads&loaders=["${loader}"]&facets=[["project_type:mod"]]`,
        error: describeError(e),
        fetchedAt: now,
      });
      failCount++;
      console.log(`  [FAIL] ${loader} — ${describeError(e)}`);
    }
  }

  // ---- 3. 写 index.json / provenance.json ----
  const index = {
    generatedAt: now,
    sources: { officialRepos, modrinth },
    usage: '仅作为 AI 提示词参考与代码风格对照，不得直接拷贝分发受版权保护内容',
  };
  await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  await writeFile(path.join(OUT_DIR, 'provenance.json'), JSON.stringify(provenance, null, 2), 'utf8');

  console.log(`\n完成: 下载 ${okCount}，跳过(缓存) ${cachedCount}，失败 ${failCount}，provenance.files=${provenance.files.length}`);
  if (provenance.failed.length > 0) {
    console.log('失败清单:');
    for (const f of provenance.failed) console.log(`  - ${f.path}: ${f.error}`);
  }
  process.exitCode = 0;
}

main().catch((e) => {
  console.error(`脚本异常终止: ${describeError(e)}`);
  process.exit(1);
});
