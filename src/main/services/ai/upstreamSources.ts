/**
 * 上游版本源抓取（M7 Task 4）。
 *
 * 四类官方源：
 * - Fabric meta JSON   /v2/versions/loader/{mc}               （逐 MC 版本）
 * - Mojang manifest    version_manifest_v2.json              （全局最新 MC）
 * - Forge maven XML    files.minecraftforge.net               （按 `${mc}-` 前缀过滤）
 * - NeoForge maven XML maven.neoforged.net                    （按 20.4/20.6/21.1/21.3 线过滤）
 *
 * 端点表与 fetchText 均可注入（TR-4.1 fake HTTP）；生产默认走 httpUtil
 * （代理/超时复用网络设置）。解析器为纯函数并导出单测。
 */
import { httpGetText } from '../httpUtil'
import { compareVersions, neoforgeLineFor } from './versionMatrix'

export const DEFAULT_ENDPOINTS = {
  fabricLoader: (mc: string): string =>
    `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`,
  mojangManifest: 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json',
  forgeMaven: 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
  // BMCLAPI 镜像（实测国内可达）：主源被 DNS 污染/不可达时兜底（实测 1.2s 返回有效元数据）
  forgeMavenMirror: 'https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/maven-metadata.xml',
  neoforgeMaven: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
  // BMCLAPI 同样镜像 neoforge maven（路径无 /releases 前缀）
  neoforgeMavenMirror:
    'https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/maven-metadata.xml'
}

export type EndpointSet = typeof DEFAULT_ENDPOINTS

export type FetchText = (url: string) => Promise<{ status: number; text: string }>

const productionFetch: FetchText = async (url) => httpGetText(url)

/* ------------------------------ 纯解析器 ------------------------------ */

/** Fabric meta：数组按发布时间倒序，取首个 loader.version；返回全部版本由比较器选最大 */
export function parseFabricLoaderVersions(jsonText: string): string[] {
  const data = JSON.parse(jsonText) as unknown
  if (!Array.isArray(data)) return []
  const out: string[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue
    const loader = (item as Record<string, unknown>)['loader']
    if (typeof loader !== 'object' || loader === null) continue
    const v = (loader as Record<string, unknown>)['version']
    if (typeof v === 'string' && v) out.push(v)
  }
  return out
}

/** Mojang 版本清单：最新正式版 id */
export function parseMojangLatestRelease(jsonText: string): string | null {
  const data = JSON.parse(jsonText) as unknown
  if (typeof data !== 'object' || data === null) return null
  const latest = (data as Record<string, unknown>)['latest']
  if (typeof latest !== 'object' || latest === null) return null
  const release = (latest as Record<string, unknown>)['release']
  return typeof release === 'string' && release ? release : null
}

/** 提取 maven-metadata.xml 的全部 <version> */
export function parseMavenVersions(xmlText: string): string[] {
  const out: string[] = []
  const re = /<version>\s*([^<]+?)\s*<\/version>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xmlText)) !== null) out.push(m[1].trim())
  return out
}

/** Forge 版本形如 `1.20.1-47.4.23`：按 MC 前缀过滤取加载器版本最大者 */
export function pickForgeVersion(all: string[], mcVersion: string): string | null {
  const prefix = `${mcVersion}-`
  let best: string | null = null
  for (const v of all) {
    if (!v.startsWith(prefix)) continue
    const loaderPart = v.slice(prefix.length)
    // 仅接受纯数字点分（跳过 -universal/-changelog 等历史后缀）
    if (!/^\d+(\.\d+)*$/.test(loaderPart)) continue
    if (best === null || compareVersions(loaderPart, best) > 0) best = loaderPart
  }
  return best
}

/** NeoForge 版本形如 `21.1.250` / `21.3.0-beta`：按 MC 对应版本线过滤取最大 */
export function pickNeoForgeVersion(all: string[], mcVersion: string): string | null {
  const line = neoforgeLineFor(mcVersion)
  if (!line) return null
  const linePrefix = `${line}.`
  let best: string | null = null
  for (const v of all) {
    if (!v.startsWith(linePrefix)) continue
    // 允许 21.3.0-beta 这类预发布；比较器已处理后缀
    if (!/^\d+(\.\d+)*(-[0-9A-Za-z.-]+)?$/.test(v)) continue
    if (best === null || compareVersions(v, best) > 0) best = v
  }
  return best
}

/** 数值点分版本数组取最大（比较器不做预发布特殊处理时使用） */
export function maxVersion(versions: string[]): string | null {
  let best: string | null = null
  for (const v of versions) {
    if (best === null || compareVersions(v, best) > 0) best = v
  }
  return best
}

/* ------------------------------ 抓取门面 ------------------------------ */

export interface FabricLatest {
  mcVersion: string
  latestLoader: string | null
}
export interface ForgeLatest {
  mcVersion: string
  latestLoader: string | null
}
export interface UpstreamSnapshot {
  fabric: FabricLatest[]
  forge: ForgeLatest[]
  neoforge: ForgeLatest[]
  latestMcRelease: string | null
}

export interface SourceFailure {
  source: 'fabric' | 'forge' | 'neoforge' | 'mojang'
  message: string
}

export interface UpstreamSources {
  fetchSnapshot(input: {
    fabricMcVersions: string[]
    forgeMcVersions: string[]
    neoforgeMcVersions: string[]
    onUrl?: (source: string, url: string) => void
  }): Promise<{ snapshot: UpstreamSnapshot; failures: SourceFailure[] }>
}

/**
 * 带瞬时故障重试的抓取：maven 元数据偶发超时/连接重置（国内网络抖动，neoforge maven
 * 尤为常见）不应立即判失败进入 yellow，短退避重试后再如实上报。
 */
async function getOkVia(fetchText: FetchText, url: string, attempts = 2): Promise<string> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchText(url)
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status}`)
      }
      return res.text
    } catch (err) {
      lastErr = err
      if (attempt < attempts) await new Promise((r) => setTimeout(r, attempt * 1000))
    }
  }
  throw lastErr
}

/**
 * 端点级兜底：逐 URL 尝试（每个内部重试 2 次）。主源 DNS 污染（TCP 10s 连接超时）
 * 属持续故障，重试同源无意义，BMCLAPI 镜像实测可达，多个 URL 串行兜底。
 */
async function getOkViaFallback(fetchText: FetchText, urls: string[]): Promise<string> {
  let lastErr: unknown
  for (const url of urls) {
    try {
      return await getOkVia(fetchText, url)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

/** 导出给 fcTools 等复用：maven 元数据抓取（瞬时重试 + 镜像兜底），返回原始文本 */
export async function fetchTextResilient(urls: string[]): Promise<string> {
  return getOkViaFallback(productionFetch, urls)
}

export function createUpstreamSources(deps?: {
  endpoints?: Partial<EndpointSet>
  fetchText?: FetchText
}): UpstreamSources {
  const endpoints: EndpointSet = { ...DEFAULT_ENDPOINTS, ...(deps?.endpoints ?? {}) }
  const fetchText = deps?.fetchText ?? productionFetch

  return {
    async fetchSnapshot({ fabricMcVersions, forgeMcVersions, neoforgeMcVersions, onUrl }) {
      const failures: SourceFailure[] = []
      const snapshot: UpstreamSnapshot = {
        fabric: [],
        forge: [],
        neoforge: [],
        latestMcRelease: null
      }

      // Fabric：逐 MC 版本请求 meta
      await Promise.all(
        fabricMcVersions.map(async (mc) => {
          const url = endpoints.fabricLoader(mc)
          onUrl?.('fabric', url)
          try {
            const text = await getOkVia(fetchText, url)
            const all = parseFabricLoaderVersions(text)
            snapshot.fabric.push({ mcVersion: mc, latestLoader: maxVersion(all) })
          } catch (e) {
            failures.push({ source: 'fabric', message: `${mc}: ${(e as Error).message}` })
          }
        })
      )

      // Mojang：全局最新正式版
      try {
        onUrl?.('mojang', endpoints.mojangManifest)
        const text = await getOkVia(fetchText, endpoints.mojangManifest)
        snapshot.latestMcRelease = parseMojangLatestRelease(text)
      } catch (e) {
        failures.push({ source: 'mojang', message: (e as Error).message })
      }

      // Forge：一个 maven-metadata 服务全部 MC 过滤（主源不可达 → BMCLAPI 镜像兜底）
      let forgeVersions: string[] | null = null
      try {
        onUrl?.('forge', endpoints.forgeMaven)
        forgeVersions = parseMavenVersions(
          await getOkViaFallback(fetchText, [endpoints.forgeMaven, endpoints.forgeMavenMirror])
        )
      } catch (e) {
        failures.push({ source: 'forge', message: (e as Error).message })
      }
      if (forgeVersions) {
        for (const mc of forgeMcVersions) {
          snapshot.forge.push({ mcVersion: mc, latestLoader: pickForgeVersion(forgeVersions, mc) })
        }
      }

      // NeoForge：一个 maven-metadata 按版本线过滤（主源 DNS 污染常见 → BMCLAPI 镜像兜底）
      let neoforgeVersions: string[] | null = null
      try {
        onUrl?.('neoforge', endpoints.neoforgeMaven)
        neoforgeVersions = parseMavenVersions(
          await getOkViaFallback(fetchText, [endpoints.neoforgeMaven, endpoints.neoforgeMavenMirror])
        )
      } catch (e) {
        failures.push({ source: 'neoforge', message: (e as Error).message })
      }
      if (neoforgeVersions) {
        for (const mc of neoforgeMcVersions) {
          snapshot.neoforge.push({
            mcVersion: mc,
            latestLoader: pickNeoForgeVersion(neoforgeVersions, mc)
          })
        }
      }

      return { snapshot, failures }
    }
  }
}
