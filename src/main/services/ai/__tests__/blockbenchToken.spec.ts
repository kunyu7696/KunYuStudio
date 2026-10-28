import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  enrichBlockbenchEnv,
  isBlockbenchGateway,
  readBlockbenchMcpToken
} from '../blockbenchToken'

const TOKEN = 'f03904e2b9e81bb401334daf2181434c9f74d55a228d2d6e'

function makeStorage(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'bb-leveldb-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'latin1')
  }
  return dir
}

describe('isBlockbenchGateway', () => {
  it('matches package name in args', () => {
    expect(isBlockbenchGateway('npx', ['-y', '@anningui/blockbench-mcp@latest'])).toBe(true)
  })
  it('matches bare package without version', () => {
    expect(isBlockbenchGateway('npx', ['-y', '@anningui/blockbench-mcp'])).toBe(true)
  })
  it('does not match unrelated servers', () => {
    expect(isBlockbenchGateway('npx', ['-y', 'mc-texture-cli@latest'])).toBe(false)
    expect(isBlockbenchGateway('node', ['/opt/mcp/server.js'])).toBe(false)
  })
})

describe('readBlockbenchMcpToken', () => {
  it('extracts token from WAL (.log) containing settings blob', () => {
    const dir = makeStorage({
      '000004.log':
        'prefix garbage\x00_file://settings%{"bbmcp_port":{"value":39742},"bbmcp_secret":{"value":"' +
        TOKEN +
        '"},"other":1}'
    })
    expect(readBlockbenchMcpToken(dir)).toBe(TOKEN)
  })

  it('extracts token from SST (.ldb) when WAL absent', () => {
    const dir = makeStorage({
      '000003.ldb': '...bbmcp_secret":{"value":"' + TOKEN + '"}...'
    })
    expect(readBlockbenchMcpToken(dir)).toBe(TOKEN)
  })

  it('returns null when storage dir missing', () => {
    expect(readBlockbenchMcpToken(join(tmpdir(), 'definitely-not-here-' + Date.now()))).toBeNull()
  })

  it('returns null when no secret key present', () => {
    const dir = makeStorage({ '000004.log': 'settings without secret: {}' })
    expect(readBlockbenchMcpToken(dir)).toBeNull()
  })

  it('ignores non-hex lookalikes shorter than 32 chars', () => {
    const dir = makeStorage({ '000004.log': 'bbmcp_secret value deadbeef short' })
    expect(readBlockbenchMcpToken(dir)).toBeNull()
  })

  /**
   * 真实 LevelDB 回归：value 前的长度前缀字节恰为 'F'(0x46) 时，
   * 带 /i 的旧正则会把 F 吞进 token（49 位）导致注入后 401。
   * 实测样本：000006.ldb 中 `ðF<token>\n` 布局。
   */
  it('token 前的 LevelDB 前缀字节 F 不得被吞入 token', () => {
    const dir = makeStorage({
      '000006.ldb': '#"}]/\x00bbmcp_secretÃD]\nðF' + TOKEN + '\nN brush_color_paletteL{"p'
    })
    expect(readBlockbenchMcpToken(dir)).toBe(TOKEN)
  })
})

describe('enrichBlockbenchEnv', () => {
  it('injects discovered token for gateway without explicit token', () => {
    const dir = makeStorage({ '000004.log': 'x bbmcp_secret":"' + TOKEN + '"' })
    const { env, tokenInjected } = enrichBlockbenchEnv(
      'npx',
      ['-y', '@anningui/blockbench-mcp'],
      { FOO: 'bar' },
      dir
    )
    expect(tokenInjected).toBe(true)
    expect(env['BBMCP_TOKEN']).toBe(TOKEN)
    expect(env['FOO']).toBe('bar')
  })

  it('never overrides an explicit BBMCP_TOKEN', () => {
    const dir = makeStorage({ '000004.log': 'bbmcp_secret":"' + TOKEN + '"' })
    const { env, tokenInjected } = enrichBlockbenchEnv(
      'npx',
      ['-y', '@anningui/blockbench-mcp@latest'],
      { BBMCP_TOKEN: 'user-provided' },
      dir
    )
    expect(tokenInjected).toBe(false)
    expect(env['BBMCP_TOKEN']).toBe('user-provided')
  })

  it('passes through env untouched for non-gateway servers', () => {
    const dir = makeStorage({ '000004.log': 'bbmcp_secret":"' + TOKEN + '"' })
    const { env, tokenInjected } = enrichBlockbenchEnv(
      'npx',
      ['-y', 'mc-texture-cli@latest', '--root', '__PROJECT_ROOT__'],
      { K: 'V' },
      dir
    )
    expect(tokenInjected).toBe(false)
    expect(env).toEqual({ K: 'V' })
  })

  it('leaves env untouched when token cannot be discovered', () => {
    const dir = makeStorage({ '000004.log': 'nothing useful' })
    const { env, tokenInjected } = enrichBlockbenchEnv(
      'npx',
      ['-y', '@anningui/blockbench-mcp'],
      {},
      dir
    )
    expect(tokenInjected).toBe(false)
    expect(env['BBMCP_TOKEN']).toBeUndefined()
  })
})
