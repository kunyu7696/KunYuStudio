/**
 * TR-16.1：安全动作执行器——仅勾选动作产生变化、越界 / 危险路径被拒、回执与实际一致。
 */
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeActions,
  previewActions,
  resolveInside,
  type PlannedAction
} from '../actionExecutor'

let dir: string
let mods: string
let config: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ky-actions-'))
  mods = join(dir, 'mods')
  config = join(dir, 'config')
  mkdirSync(mods, { recursive: true })
  writeFileSync(join(mods, 'a.jar'), 'A', { flag: 'w' })
  writeFileSync(join(mods, 'b.jar'), 'B', { flag: 'w' })
})

afterEach(() => {
  const { rmSync } = require('node:fs') as typeof import('node:fs')
  rmSync(dir, { recursive: true, force: true })
})

describe('resolveInside', () => {
  it('合法相对路径', () => {
    const r = resolveInside(mods, 'a.jar')
    expect(r.ok).toBe(true)
  })
  it('.. 越界被拒', () => {
    const r = resolveInside(mods, '../evil.jar')
    expect(r.ok).toBe(false)
  })
  it('绝对路径被拒', () => {
    const r = resolveInside(mods, join(dir, 'evil.jar'))
    expect(r.ok).toBe(false)
  })
  it('空路径被拒', () => {
    expect(resolveInside(mods, '').ok).toBe(false)
  })
})

describe('disable', () => {
  it('jar → jar.disabled', () => {
    const receipts = executeActions(mods, config, [
      { kind: 'disable', target: 'a.jar', adviceId: 'adv-1' }
    ])
    expect(receipts[0].status).toBe('done')
    expect(existsSync(join(mods, 'a.jar'))).toBe(false)
    expect(existsSync(join(mods, 'a.jar.disabled'))).toBe(true)
  })
  it('重复禁用 skipped', () => {
    executeActions(mods, config, [{ kind: 'disable', target: 'a.jar' }])
    const again = executeActions(mods, config, [{ kind: 'disable', target: 'a.jar' }])
    expect(again[0].status).toBe('skipped')
  })
})

describe('remove', () => {
  it('确认后删除，再次 skipped', () => {
    const first = executeActions(mods, config, [{ kind: 'remove', target: 'b.jar' }])
    expect(first[0].status).toBe('done')
    expect(existsSync(join(mods, 'b.jar'))).toBe(false)
    const second = executeActions(mods, config, [{ kind: 'remove', target: 'b.jar' }])
    expect(second[0].status).toBe('skipped')
  })
})

describe('config', () => {
  it('properties 追加后改值', () => {
    const file = join(config, 'x.properties')
    executeActions(mods, config, [
      { kind: 'config', target: 'x.properties', configKey: 'foo', configValue: '1' }
    ])
    expect(readFileSync(file, 'utf8')).toContain('foo=1')
    executeActions(mods, config, [
      { kind: 'config', target: 'x.properties', configKey: 'foo', configValue: '2' }
    ])
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('foo=2')
    expect(text.match(/foo=/g)?.length).toBe(1)
  })

  it('json merge 且类型转换', () => {
    const file = join(config, 'sub', 'y.json')
    executeActions(mods, config, [
      { kind: 'config', target: 'sub/y.json', configKey: 'enabled', configValue: 'true' }
    ])
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { enabled: unknown }
    expect(parsed.enabled).toBe(true)
  })

  it('写 jar 被拒（不改第三方 jar）', () => {
    const receipts = executeActions(mods, config, [
      { kind: 'config', target: 'a.jar', configKey: 'x', configValue: 'y' }
    ])
    expect(receipts[0].status).toBe('rejected')
    expect(readFileSync(join(mods, 'a.jar'), 'utf8')).toBe('A')
  })

  it('配置路径越界被拒', () => {
    const receipts = executeActions(mods, config, [
      { kind: 'config', target: '../escape.properties', configKey: 'x', configValue: 'y' }
    ])
    expect(receipts[0].status).toBe('rejected')
  })
})

describe('executeActions 选择性与回执', () => {
  it('只禁用 a，b 原样不变', () => {
    const receipts = executeActions(mods, config, [
      { kind: 'disable', target: 'a.jar', adviceId: 'adv-a' }
    ])
    expect(receipts.length).toBe(1)
    expect(receipts[0].adviceId).toBe('adv-a')
    expect(existsSync(join(mods, 'b.jar'))).toBe(true)
  })

  it('混合动作：一项 done 一项 rejected，互不影响', () => {
    const actions: PlannedAction[] = [
      { kind: 'disable', target: 'a.jar' },
      { kind: 'disable', target: '../bad.jar' }
    ]
    const receipts = executeActions(mods, config, actions)
    expect(receipts[0].status).toBe('done')
    expect(receipts[1].status).toBe('rejected')
  })
})

describe('previewActions', () => {
  it('无 IO 描述影响', () => {
    const lines = previewActions([{ kind: 'remove', target: 'a.jar' }])
    expect(lines[0].effect).toContain('删除')
  })
})
