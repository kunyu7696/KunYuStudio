/**
 * 上游版本源抓取（upstreamSources）单测。
 *
 * 覆盖 getOk 的瞬时故障重试语义：maven 元数据偶发超时/连接重置时短退避重试，
 * 持续故障（DNS 污染等）重试耗尽后如实上报 failures，不吞错。
 * 注意：forge/neoforge maven 请求无条件发出（不依赖版本数组），mock 需按 URL 区分。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_ENDPOINTS, createUpstreamSources, type FetchText } from '../upstreamSources'

describe('upstreamSources 瞬时故障重试', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('首次超时 → 短退避重试后成功，snapshot 正常返回且无 failures', async () => {
    let mojangCalls = 0
    const fetchText: FetchText = async (url) => {
      if (url === DEFAULT_ENDPOINTS.mojangManifest) {
        mojangCalls++
        if (mojangCalls === 1) throw new Error('The operation was aborted due to timeout')
        return { status: 200, text: '{"latest":{"release":"1.21.11"}}' }
      }
      // 其余源正常返回（forge/neoforge maven 无条件请求）
      if (url === DEFAULT_ENDPOINTS.forgeMaven) {
        return { status: 200, text: '<version>1.21.1-47.4.23</version>' }
      }
      return { status: 200, text: '<version>21.1.250</version>' }
    }
    const { fetchSnapshot } = createUpstreamSources({ fetchText })
    const p = fetchSnapshot({ fabricMcVersions: [], forgeMcVersions: ['1.21.1'], neoforgeMcVersions: [] })
    await vi.runAllTimersAsync()
    const { snapshot, failures } = await p
    expect(mojangCalls).toBe(2)
    expect(snapshot.latestMcRelease).toBe('1.21.11')
    expect(snapshot.forge[0]?.latestLoader).toBe('47.4.23')
    expect(failures).toHaveLength(0)
  })

  it('neoforge 主源持续不可达 → BMCLAPI 镜像兜底成功（DNS 污染场景）', async () => {
    let primaryCalls = 0
    let mirrorCalls = 0
    const fetchText: FetchText = async (url) => {
      if (url === DEFAULT_ENDPOINTS.neoforgeMaven) {
        primaryCalls++
        throw new Error('Connect Timeout Error (attempted address: maven.neoforged.net:443, timeout: 10000ms)')
      }
      if (url === DEFAULT_ENDPOINTS.neoforgeMavenMirror) {
        mirrorCalls++
        return { status: 200, text: '<version>21.1.250</version><version>21.3.97</version>' }
      }
      if (url === DEFAULT_ENDPOINTS.mojangManifest) {
        return { status: 200, text: '{"latest":{"release":"1.21.11"}}' }
      }
      return { status: 200, text: '<version>21.1.250</version>' }
    }
    const { fetchSnapshot } = createUpstreamSources({ fetchText })
    const p = fetchSnapshot({ fabricMcVersions: [], forgeMcVersions: [], neoforgeMcVersions: ['1.21.3'] })
    await vi.runAllTimersAsync()
    const { snapshot, failures } = await p
    expect(primaryCalls).toBe(2) // 主源重试 2 次后放弃
    expect(mirrorCalls).toBe(1) // 镜像一次成功
    expect(snapshot.neoforge[0]?.mcVersion).toBe('1.21.3')
    expect(snapshot.neoforge[0]?.latestLoader).toBe('21.3.97')
    expect(failures).toHaveLength(0)
  })

  it('双源均失败 → 重试耗尽后如实进入 failures（不吞错，其余源不受影响）', async () => {
    let neoforgeCalls = 0
    const fetchText: FetchText = async (url) => {
      if (url === DEFAULT_ENDPOINTS.neoforgeMaven || url === DEFAULT_ENDPOINTS.neoforgeMavenMirror) {
        neoforgeCalls++
        throw new Error('getaddrinfo ENOTFOUND maven.neoforged.net')
      }
      if (url === DEFAULT_ENDPOINTS.mojangManifest) {
        return { status: 200, text: '{"latest":{"release":"1.21.11"}}' }
      }
      return { status: 200, text: '<version>21.1.250</version>' }
    }
    const { fetchSnapshot } = createUpstreamSources({ fetchText })
    const p = fetchSnapshot({ fabricMcVersions: [], forgeMcVersions: [], neoforgeMcVersions: ['1.21.1'] })
    await vi.runAllTimersAsync()
    const { snapshot, failures } = await p
    expect(neoforgeCalls).toBe(4) // 主源 2 次 + 镜像 2 次
    expect(snapshot.neoforge).toHaveLength(0)
    expect(snapshot.latestMcRelease).toBe('1.21.11')
    expect(failures).toHaveLength(1)
    expect(failures[0].source).toBe('neoforge')
    expect(failures[0].message).toContain('ENOTFOUND')
  })

  it('非 2xx 状态码同样触发重试', async () => {
    let forgeCalls = 0
    const fetchText: FetchText = async (url) => {
      if (url === DEFAULT_ENDPOINTS.forgeMaven) {
        forgeCalls++
        if (forgeCalls === 1) return { status: 502, text: 'bad gateway' }
        return { status: 200, text: '<version>1.21.1-47.4.23</version>' }
      }
      if (url === DEFAULT_ENDPOINTS.mojangManifest) {
        return { status: 200, text: '{"latest":{"release":"1.21.11"}}' }
      }
      return { status: 200, text: '<version>21.1.250</version>' }
    }
    const { fetchSnapshot } = createUpstreamSources({ fetchText })
    const p = fetchSnapshot({ fabricMcVersions: [], forgeMcVersions: ['1.21.1'], neoforgeMcVersions: [] })
    await vi.runAllTimersAsync()
    const { snapshot, failures } = await p
    expect(forgeCalls).toBe(2)
    expect(snapshot.forge[0]?.latestLoader).toBe('47.4.23')
    expect(failures).toHaveLength(0)
  })
})
