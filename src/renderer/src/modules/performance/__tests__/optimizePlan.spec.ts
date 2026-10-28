/**
 * 向导映射测试：建议 → 安全动作，manual 不自动，目标取 jar 文件名。
 */
import { describe, expect, it } from 'vitest'
import {
  actionFromAdvice,
  baseName,
  parseConfigDetail,
  runtimeRoots,
  selectableAdvices
} from '../optimizePlan'
import type {
  ModIdentity,
  ProfileAdvice
} from '../../../../../shared/schemas/performance/profile'

const identity: ModIdentity = {
  modId: 'mod-a',
  version: '1.0.0',
  loader: 'fabric',
  mcVersion: '1.20.1',
  fileHash: 'h',
  modName: '模组A',
  filePath: 'C:/game/mods/mod-a-1.0.0.jar'
}

function advice(
  id: string,
  action: ProfileAdvice['action'],
  actionDetail = ''
): ProfileAdvice {
  return {
    id,
    ruleId: id.split('-')[0],
    severity: 'high',
    source: 'static',
    message: 'm',
    evidence: 'e',
    action,
    actionDetail
  }
}

describe('baseName', () => {
  it('正反斜杠均可用', () => {
    expect(baseName('C:\\a\\b\\c.jar')).toBe('c.jar')
    expect(baseName('/a/b/c.jar')).toBe('c.jar')
  })
})

describe('actionFromAdvice', () => {
  it('R12 disable → 目标 jar 文件名', () => {
    const a = actionFromAdvice(identity, advice('R12-1', 'disable'))
    expect(a).toEqual({
      kind: 'disable',
      target: 'mod-a-1.0.0.jar',
      adviceId: 'R12-1'
    })
  })
  it('R11 remove', () => {
    const a = actionFromAdvice(identity, advice('R11-1', 'remove'))
    expect(a?.kind).toBe('remove')
  })
  it('manual 不自动', () => {
    expect(actionFromAdvice(identity, advice('R01-1', 'manual'))).toBeNull()
  })
  it('filePath 空 → disable 不自动', () => {
    const a = actionFromAdvice({ ...identity, filePath: '' }, advice('R12-1', 'disable'))
    expect(a).toBeNull()
  })
  it('config detail 合法才自动', () => {
    const ok = actionFromAdvice(
      identity,
      advice('R09-1', 'config', 'x.properties::foo=bar')
    )
    expect(ok).toMatchObject({ kind: 'config', target: 'x.properties', configKey: 'foo' })
    const bad = actionFromAdvice(identity, advice('R09-1', 'config', 'noformat'))
    expect(bad).toBeNull()
  })
})

describe('selectableAdvices', () => {
  it('过滤 manual，仅留可执行项', () => {
    const list = selectableAdvices(identity, [
      advice('R12-1', 'disable'),
      advice('R01-1', 'manual')
    ])
    expect(list.length).toBe(1)
    expect(list[0].advice.id).toBe('R12-1')
  })
})

describe('parseConfigDetail', () => {
  it('坏格式 null', () => {
    expect(parseConfigDetail('x')).toBeNull()
  })
})

describe('runtimeRoots', () => {
  it('run/mods 与 run/config', () => {
    const r = runtimeRoots('D:/proj/')
    expect(r.modsRoot).toBe('D:/proj/run/mods')
    expect(r.configRoot).toBe('D:/proj/run/config')
  })
})
