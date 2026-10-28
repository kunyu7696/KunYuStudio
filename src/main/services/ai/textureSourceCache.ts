/**
 * AI 大图源头缓存（贴图工坊「本地重跑预览」的前提）。
 *
 * 背景：候选返回给渲染层的只有 16×16 小图；用户改像素化参数要即时重出预览时，
 * 必须回到 AI 生成的大图重新像素化（否则重跑无意义）。为避免 IPC 传几 MB 的
 * data URL，主进程侧缓存大图、只给渲染层一个 token。
 *
 * 语义：token 过期（被 LRU 淘汰后）即无效，取回返回 null，需重新生成候选。
 * LRU 上限 12 张，超出淘汰最久未使用的。token 仅需唯一，无需加密学强度。
 */
const MAX_SOURCES = 12
const cache = new Map<string, string>()
let seq = 0

/** 存入一张 AI 大图 data URL，返回可再次取回的 token。 */
export function putTextureSource(dataUrl: string): string {
  const token = `tex-${++seq}-${Math.random().toString(36).slice(2, 8)}`
  cache.set(token, dataUrl)
  // Map 保持插入顺序，队首即最久未使用；命中会在 get 里重插到队尾（真 LRU）
  while (cache.size > MAX_SOURCES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return token
}

/** 取回 token 对应的大图；token 未知/已过期返回 null（并刷新其最近使用顺序）。 */
export function getTextureSource(token: string): string | null {
  const hit = cache.get(token)
  if (hit === undefined) return null
  cache.delete(token)
  cache.set(token, hit)
  return hit
}

/** 清空全部缓存（测试用）。 */
export function clearTextureSources(): void {
  cache.clear()
}
