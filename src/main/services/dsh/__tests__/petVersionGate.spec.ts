/**
 * dsh-pet 版本门禁单测：验证档 0.3.x（>=0.3.0 <0.4.0）。
 */
import { describe, expect, it } from 'vitest'
import {
  checkPetVersion,
  compareSemVer,
  parseSemVer,
  VERIFIED_PET_MAX_EXCLUSIVE,
  MIN_PET_VERSION
} from '../petVersionGate'

describe('parseSemVer', () => {
  it('识别标准三段版本与 v 前缀/预发布后缀', () => {
    expect(parseSemVer('0.3.6')).toEqual({ major: 0, minor: 3, patch: 6 })
    expect(parseSemVer('v0.4.0-beta.1')).toEqual({ major: 0, minor: 4, patch: 0 })
  })
  it('非法输入返回 null', () => {
    expect(parseSemVer(null)).toBeNull()
    expect(parseSemVer('')).toBeNull()
    expect(parseSemVer('latest')).toBeNull()
    expect(parseSemVer('0.3')).toBeNull()
  })
})

describe('compareSemVer', () => {
  it('按 major→minor→patch 次序比较', () => {
    expect(compareSemVer({ major: 0, minor: 2, patch: 9 }, MIN_PET_VERSION)).toBe(-1)
    expect(compareSemVer({ major: 0, minor: 3, patch: 0 }, MIN_PET_VERSION)).toBe(0)
    expect(compareSemVer({ major: 0, minor: 3, patch: 99 }, MIN_PET_VERSION)).toBe(1)
    expect(compareSemVer(VERIFIED_PET_MAX_EXCLUSIVE, { major: 1, minor: 0, patch: 0 })).toBe(-1)
  })
})

describe('checkPetVersion', () => {
  it('0.3.x 全档 verified 且无消息', () => {
    for (const v of ['0.3.0', '0.3.6', '0.3.99']) {
      const r = checkPetVersion(v)
      expect(r.level).toBe('verified')
      expect(r.message).toBe('')
    }
  })

  it('低于 0.3.0 → unsupported，消息含版本号与阻断说明', () => {
    const r = checkPetVersion('0.2.9')
    expect(r.level).toBe('unsupported')
    expect(r.message).toContain('0.2.9')
    expect(r.message).toContain('已阻止启动')
  })

  it('0.4.0 及以上 → unverified 警告放行', () => {
    const r = checkPetVersion('0.4.0')
    expect(r.level).toBe('unverified')
    expect(r.message).toContain('0.4.0')
    const r1 = checkPetVersion('1.2.3')
    expect(r1.level).toBe('unverified')
    expect(r1.message).toContain('1.2.3')
  })

  it('版本缺失/无法识别 → unverified（不阻断既有安装路径）', () => {
    const r = checkPetVersion(null)
    expect(r.level).toBe('unverified')
    expect(r.message).toContain('未知版本')
  })
})
