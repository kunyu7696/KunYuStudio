/**
 * Spark 报告解析与模组归因（TR-14.1）。
 *
 * 支持两类固化/可导入的报告：
 * - heap summary JSON：`{entries:[{name,bytes,count}]}` → 内存归因；
 * - CPU 采样文本树：缩进 + `55% com.example.Foo.tick()` → CPU 归因。
 * 自动嗅探格式；包→模组归因复用 jfrParser 的 resolveMod。
 */
import {
  OTHER_MOD,
  resolveMod,
  type PackageIndexEntry
} from './jfrParser'

export type SparkNodeKind = 'cpu' | 'memory' | 'tick'

export interface SparkNode {
  /** 解析出的类全限定名；无法识别为 null */
  className: string | null
  package: string
  /** CPU=百分比(0-100)；memory=字节 */
  weight: number
  kind: SparkNodeKind
  raw: string
}

export interface SparkReport {
  source: 'heap-json' | 'cpu-tree' | 'unknown'
  averageTickMs: number | null
  nodes: SparkNode[]
}

function packageOf(className: string): string {
  const i = className.lastIndexOf('.')
  return i < 0 ? '(default)' : className.slice(0, i)
}

/** 从文本描述提取 FQN 类名（如 com.example.Foo.tick() → com.example.Foo） */
function classNameFrom(desc: string): string | null {
  const m = desc.match(/([\w.]+)\.\w+\s*\(/)
  return m ? m[1] : null
}

/** 解析 heap summary JSON */
function parseHeapJson(text: string): SparkReport {
  const nodes: SparkNode[] = []
  let averageTickMs: number | null = null
  try {
    const obj = JSON.parse(text) as Record<string, unknown>
    const entries = Array.isArray(obj['entries'])
      ? (obj['entries'] as Array<Record<string, unknown>>)
      : []
    for (const e of entries) {
      const name = typeof e['name'] === 'string' ? e['name'] : ''
      const bytes = typeof e['bytes'] === 'number' ? e['bytes'] : Number(e['bytes'] ?? 0)
      if (!name) continue
      nodes.push({
        className: name,
        package: packageOf(name),
        weight: Number.isFinite(bytes) ? bytes : 0,
        kind: 'memory',
        raw: `${name} ${bytes}`
      })
    }
    const tick = obj['averageTickMs']
    if (typeof tick === 'number') averageTickMs = tick
  } catch {
    return { source: 'unknown', averageTickMs: null, nodes: [] }
  }
  return { source: 'heap-json', averageTickMs, nodes }
}

/** 解析 CPU 采样文本树 */
function parseCpuTree(text: string): SparkReport {
  const nodes: SparkNode[] = []
  let averageTickMs: number | null = null

  const tickMatch = text.match(/tick[^\d]{0,20}(\d+(?:\.\d+)?)\s*ms/i)
  if (tickMatch) averageTickMs = Number(tickMatch[1])

  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/(\d+(?:\.\d+)?)\s*%\s+(.+)$/)
    if (!m) continue
    const percent = Number(m[1])
    const desc = m[2].trim()
    const className = classNameFrom(desc)
    nodes.push({
      className,
      package: className ? packageOf(className) : '(unknown)',
      weight: percent,
      kind: 'cpu',
      raw: desc
    })
  }
  return { source: 'cpu-tree', averageTickMs, nodes }
}

/** 解析 Spark 报告，自动嗅探 JSON / 文本 */
export function parseSparkReport(text: string): SparkReport {
  const t = text.trim()
  if (t.startsWith('{') || t.startsWith('[')) return parseHeapJson(t)
  if (t.length === 0) return { source: 'unknown', averageTickMs: null, nodes: [] }
  return parseCpuTree(t)
}

// ---------------------------------------------------------------------------
// 归因
// ---------------------------------------------------------------------------
export interface AttributedSpark {
  modId: string
  modName: string
  /** CPU 采样百分比累加 */
  cpuPercent: number
  /** 内存字节累加 */
  memoryBytes: number
}

/** 把 Spark 节点按模组聚合（CPU 与内存），未知入「其他 / 原版」 */
export function attributeSpark(
  report: SparkReport,
  index: PackageIndexEntry[]
): AttributedSpark[] {
  const agg = new Map<string, AttributedSpark>()

  const ensure = (modId: string, modName: string): AttributedSpark => {
    let found = agg.get(modId)
    if (!found) {
      found = { modId, modName, cpuPercent: 0, memoryBytes: 0 }
      agg.set(modId, found)
    }
    return found
  }

  for (const node of report.nodes) {
    if (!node.className) continue
    const mod = resolveMod(node.package, index)
    const target = ensure(mod?.modId ?? OTHER_MOD.modId, mod?.modName ?? OTHER_MOD.modName)
    if (node.kind === 'memory') target.memoryBytes += node.weight
    else if (node.kind === 'cpu') target.cpuPercent += node.weight
  }

  return [...agg.values()].sort(
    (a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes
  )
}
