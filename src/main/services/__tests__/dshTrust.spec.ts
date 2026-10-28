/**
 * DSH 插件信任门控单测：授权绑定包内容指纹、包变更后失效、未声明能力不授予。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { userData } = vi.hoisted(() => ({ userData: { dir: '' } }))

vi.mock('electron', () => ({
  app: { getPath: () => userData.dir }
}))

import {
  approvePlugin,
  declaredPermissionsOf,
  entryPathOf,
  isPluginTrusted,
  pluginFingerprint,
  revokePlugin,
  trustStateOf
} from '../dsh/dshTrust'

function writePlugin(npm: string, pkg: Record<string, unknown>, code = 'module.exports = {}'): void {
  const dir = join(userData.dir, 'dsh-plugins', 'node_modules', ...npm.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg), 'utf-8')
  writeFileSync(join(dir, 'index.js'), code, 'utf-8')
}

describe('dshTrust · 信任门控', () => {
  beforeEach(() => {
    userData.dir = mkdtempSync(join(tmpdir(), 'kunyu-dsh-trust-'))
  })

  afterEach(() => {
    rmSync(userData.dir, { recursive: true, force: true })
  })

  it('未授权插件不会被视为可信', () => {
    writePlugin('dsh-tool-a', { name: 'dsh-tool-a', version: '1.0.0', main: 'index.js' })
    const snapshot = trustStateOf('dsh-tool-a')
    expect(snapshot.state).toBe('untrusted')
    expect(snapshot.granted).toEqual([])
    expect(isPluginTrusted('dsh-tool-a')).toBe(false)
  })

  it('授权后可信，且只授予声明过的白名单能力', () => {
    writePlugin('dsh-tool-a', {
      name: 'dsh-tool-a',
      version: '1.0.0',
      main: 'index.js',
      kunyu: { permissions: ['tools', 'systemPrompt', 'shell'] }
    })
    expect(declaredPermissionsOf('dsh-tool-a')).toEqual(['tools', 'systemPrompt'])
    expect(approvePlugin('dsh-tool-a')).toBe(true)
    const snapshot = trustStateOf('dsh-tool-a')
    expect(snapshot.state).toBe('trusted')
    expect(snapshot.granted).toEqual(['tools', 'systemPrompt'])
    expect(isPluginTrusted('dsh-tool-a')).toBe(true)
  })

  it('包内容变更（入口代码被替换）后授权自动失效', () => {
    writePlugin('dsh-tool-a', { name: 'dsh-tool-a', version: '1.0.0', main: 'index.js' })
    const before = pluginFingerprint('dsh-tool-a')
    expect(approvePlugin('dsh-tool-a')).toBe(true)
    writePlugin('dsh-tool-a', { name: 'dsh-tool-a', version: '1.0.0', main: 'index.js' }, 'module.exports = { evil: true }')
    const after = pluginFingerprint('dsh-tool-a')
    expect(after).not.toBe(before)
    expect(trustStateOf('dsh-tool-a').state).toBe('changed')
    expect(isPluginTrusted('dsh-tool-a')).toBe(false)
  })

  it('撤销授权后回到未授权；重复撤销不报错', () => {
    writePlugin('dsh-tool-a', { name: 'dsh-tool-a', version: '1.0.0', main: 'index.js' })
    expect(approvePlugin('dsh-tool-a')).toBe(true)
    revokePlugin('dsh-tool-a')
    expect(trustStateOf('dsh-tool-a').state).toBe('untrusted')
    revokePlugin('dsh-tool-a')
    expect(trustStateOf('dsh-tool-a').state).toBe('untrusted')
  })

  it('入口缺失时无法确定指纹，拒绝授权', () => {
    writePlugin('dsh-tool-a', { name: 'dsh-tool-a', version: '1.0.0', main: 'missing.js' })
    expect(entryPathOf('dsh-tool-a')).toBeNull()
    expect(pluginFingerprint('dsh-tool-a')).toBeNull()
    expect(approvePlugin('dsh-tool-a')).toBe(false)
    expect(trustStateOf('dsh-tool-a').state).toBe('untrusted')
  })
})
