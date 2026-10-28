import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 社区 webview 安全策略契约：attach 白名单与访客权限默认拒绝 */
const { setUserAgent, setPermissionRequestHandler, setPermissionCheckHandler, fromPartition } = vi.hoisted(() => {
  const setUA = vi.fn()
  const setReq = vi.fn()
  const setCheck = vi.fn()
  return {
    setUserAgent: setUA,
    setPermissionRequestHandler: setReq,
    setPermissionCheckHandler: setCheck,
    fromPartition: vi.fn(() => ({
      setUserAgent: setUA,
      setPermissionRequestHandler: setReq,
      setPermissionCheckHandler: setCheck
    }))
  }
})

vi.mock('electron', () => ({ session: { fromPartition } }))

import {
  COMMUNITY_ALLOWED_HOSTS,
  COMMUNITY_PARTITION,
  isAllowedCommunityUrl,
  setupCommunitySession
} from '../communitySession'

describe('isAllowedCommunityUrl · attach 白名单', () => {
  it('平台主页与子域放行', () => {
    expect(isAllowedCommunityUrl('https://www.mcmod.cn/')).toBe(true)
    expect(isAllowedCommunityUrl('https://search.mcmod.cn/s?key=x')).toBe(true)
    expect(isAllowedCommunityUrl('https://modrinth.com/mods')).toBe(true)
    expect(isAllowedCommunityUrl('https://www.curseforge.com/minecraft')).toBe(true)
  })

  it('非白名单主机拒绝（含相似后缀陷阱）', () => {
    expect(isAllowedCommunityUrl('https://evil.com/')).toBe(false)
    expect(isAllowedCommunityUrl('https://mcmod.cn.evil.com/')).toBe(false)
    expect(isAllowedCommunityUrl('https://notgithub.com/')).toBe(false)
  })

  it('非 https 与非法地址拒绝', () => {
    expect(isAllowedCommunityUrl('http://www.mcmod.cn/')).toBe(false)
    expect(isAllowedCommunityUrl('file:///C:/secret.txt')).toBe(false)
    expect(isAllowedCommunityUrl('not a url')).toBe(false)
    expect(isAllowedCommunityUrl('')).toBe(false)
  })

  it('白名单覆盖 CommunityView 全部平台页签', () => {
    const hosts = COMMUNITY_ALLOWED_HOSTS as readonly string[]
    expect(hosts).toContain('mcmod.cn')
    expect(hosts).toContain('github.com')
    expect(hosts.length).toBe(10)
  })
})

describe('setupCommunitySession · 访客权限默认拒绝', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('分区锁定为 persist:community 并安装 UA 与权限处理器', () => {
    setupCommunitySession()
    expect(fromPartition).toHaveBeenCalledWith(COMMUNITY_PARTITION)
    expect(setUserAgent).toHaveBeenCalledTimes(1)
    expect(setPermissionRequestHandler).toHaveBeenCalledTimes(1)
    expect(setPermissionCheckHandler).toHaveBeenCalledTimes(1)
  })

  it('仅放行 write 型剪贴板，其余权限一律拒绝', () => {
    setupCommunitySession()
    const request = setPermissionRequestHandler.mock.calls[0]![0] as (
      wc: unknown,
      permission: string,
      cb: (granted: boolean) => void
    ) => void
    const check = setPermissionCheckHandler.mock.calls[0]![0] as (
      wc: unknown,
      permission: string
    ) => boolean

    const granted = (permission: string): boolean => {
      let result = false
      request(null, permission, (v: boolean) => {
        result = v
      })
      return result
    }

    expect(granted('clipboard-sanitized-write')).toBe(true)
    expect(granted('media')).toBe(false)
    expect(granted('geolocation')).toBe(false)
    expect(granted('notifications')).toBe(false)
    expect(granted('clipboard-read')).toBe(false)
    expect(check(null, 'media')).toBe(false)
  })
})
