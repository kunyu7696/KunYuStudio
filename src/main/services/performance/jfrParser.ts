/**
 * JFR `jfr print` 文本解析与模组归因（TR-13.1）。
 *
 * 输入 `jfr print <recording.jfr>` 的人类可读输出：
 * - jdk.ExecutionSample：取 stackTrace 栈顶（self）帧累计方法热点；
 * - jdk.ObjectAllocation*：取 objectClass 累计分配类型。
 * 再按「包前缀 → 模组」索引归因，未知包名归入「其他 / 原版」。
 */

/** 未归因桶 */
export const OTHER_MOD = { modId: '__other__', modName: '其他 / 原版' } as const

export interface RawHotspot {
  className: string
  method: string
  package: string
  samples: number
}

export interface RawAllocation {
  className: string
  package: string
  count: number
}

export interface JfrParseResult {
  totalSamples: number
  hotspots: RawHotspot[]
  allocations: RawAllocation[]
}

/** 从一帧 `com.example.Foo.bar(Foo.java:10)` 提取 className/method */
function parseFrame(line: string): { className: string; method: string } | null {
  const m = line.trim().match(/^([\w.$<>]+)\.(\w+)\s*\(/)
  if (!m) return null
  return { className: m[1], method: m[2] }
}

/** className → 包名（最后一个 '.' 之前；无点归 default） */
function packageOf(className: string): string {
  const i = className.lastIndexOf('.')
  return i < 0 ? '(default)' : className.slice(0, i)
}

/** 解析 jfr print 文本 */
export function parseJfrPrint(text: string): JfrParseResult {
  const hotspots = new Map<string, RawHotspot>()
  const allocations = new Map<string, RawAllocation>()
  let totalSamples = 0

  let eventType: string | null = null
  let inStackTrace = false
  let stackTaken = false

  const bumpHotspot = (className: string, method: string): void => {
    const key = `${className}#${method}`
    const found = hotspots.get(key)
    if (found) {
      found.samples += 1
    } else {
      hotspots.set(key, { className, method, package: packageOf(className), samples: 1 })
    }
  }

  const bumpAllocation = (className: string): void => {
    const found = allocations.get(className)
    if (found) {
      found.count += 1
    } else {
      allocations.set(className, { className, package: packageOf(className), count: 1 })
    }
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()

    const head = line.match(/^(jdk\.[\w.]+)\s*\{/)
    if (head) {
      eventType = head[1]
      inStackTrace = false
      stackTaken = false
      continue
    }
    if (line === '}' || line === '}}') {
      eventType = null
      inStackTrace = false
      continue
    }
    if (!eventType) continue

    if (eventType === 'jdk.ExecutionSample') {
      if (line.startsWith('stackTrace = [')) {
        inStackTrace = true
        continue
      }
      if (inStackTrace) {
        if (line.startsWith(']')) {
          inStackTrace = false
        } else if (!stackTaken) {
          const frame = parseFrame(line)
          if (frame) {
            totalSamples += 1
            bumpHotspot(frame.className, frame.method)
            stackTaken = true
          }
        }
      }
    } else if (
      eventType === 'jdk.ObjectAllocationSample' ||
      eventType === 'jdk.ObjectAllocationInNewTLAB' ||
      eventType === 'jdk.ObjectAllocationOutsideTLAB'
    ) {
      const m = line.match(/^objectClass\s*=\s*([\w.$]+)/)
      if (m) bumpAllocation(m[1])
    }
  }

  const sortBySamples = (a: { samples?: number; count?: number }, b: { samples?: number; count?: number }): number =>
    (b.samples ?? b.count ?? 0) - (a.samples ?? a.count ?? 0)

  return {
    totalSamples,
    hotspots: [...hotspots.values()].sort(sortBySamples),
    allocations: [...allocations.values()].sort(sortBySamples)
  }
}

// ---------------------------------------------------------------------------
// 模组归因
// ---------------------------------------------------------------------------
export interface PackageIndexEntry {
  modId: string
  modName: string
  /** 该模组的包前缀（可多个），如 com.example.foo */
  prefixes: string[]
}

export interface AttributedHotspot {
  modId: string
  modName: string
  samples: number
  /** 采样自占比 0–100 */
  selfPercent: number
}

/** 判定 pkg 是否在 prefix 命名空间下（边界安全，避免 com.ex 误匹配 com.example2） */
function matchesPrefix(pkg: string, prefix: string): boolean {
  return pkg === prefix || pkg.startsWith(prefix + '.')
}

/** 找最具体（最长）的匹配前缀对应模组；无匹配返回 null（Spark 归因复用） */
export function resolveMod(
  pkg: string,
  index: PackageIndexEntry[]
): PackageIndexEntry | null {
  let best: { entry: PackageIndexEntry; prefix: string } | null = null
  for (const entry of index) {
    for (const prefix of entry.prefixes) {
      if (matchesPrefix(pkg, prefix)) {
        if (!best || prefix.length > best.prefix.length) best = { entry, prefix }
      }
    }
  }
  return best?.entry ?? null
}

/** 把方法热点按模组聚合归因，未知包名归入「其他 / 原版」 */
export function attributeHotspots(
  result: JfrParseResult,
  index: PackageIndexEntry[]
): AttributedHotspot[] {
  const agg = new Map<string, AttributedHotspot>()

  for (const h of result.hotspots) {
    const mod = resolveMod(h.package, index)
    const modId = mod?.modId ?? OTHER_MOD.modId
    const modName = mod?.modName ?? OTHER_MOD.modName
    const found = agg.get(modId)
    if (found) {
      found.samples += h.samples
    } else {
      agg.set(modId, { modId, modName, samples: h.samples, selfPercent: 0 })
    }
  }

  const total = result.totalSamples > 0 ? result.totalSamples : 1
  return [...agg.values()]
    .map((e) => ({ ...e, selfPercent: Math.round((e.samples / total) * 1000) / 10 }))
    .sort((a, b) => b.samples - a.samples)
}
