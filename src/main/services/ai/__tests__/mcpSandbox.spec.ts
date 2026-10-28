/**
 * MCP 第三方插件沙箱单测：
 * - resolveMcpCwd：有项目用项目根；无项目落到独立 mcp-sandbox 目录（自动创建）
 * - buildSandboxEnv：系统白名单保留、ELECTRON 前缀等无关变量不透传、插件变量叠加、KUNYU 标记注入
 */
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSandboxEnv, resolveMcpCwd } from '../mcpSandbox'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-mcpsb-'))
})

describe('resolveMcpCwd', () => {
  it('有打开项目时直接返回项目根', () => {
    const cwd = resolveMcpCwd(root, join(root, 'userData'))
    expect(cwd).toBe(root)
  })

  it('项目根不存在时回退沙箱目录', () => {
    const userData = join(root, 'ud')
    const cwd = resolveMcpCwd(join(root, 'missing-project'), userData)
    expect(cwd).toBe(join(userData, 'mcp-sandbox'))
    expect(existsSync(cwd)).toBe(true)
  })

  it('未打开项目（null）时回退沙箱目录并自动创建', () => {
    const userData = join(root, 'ud2')
    const cwd = resolveMcpCwd(null, userData)
    expect(cwd).toBe(join(userData, 'mcp-sandbox'))
    expect(existsSync(cwd)).toBe(true)
  })
})

describe('buildSandboxEnv', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
  })

  it('保留运行时必需变量（PATH），不透传 Electron/无关变量', () => {
    process.env.PATH = '/fake/path'
    process.env.ELECTRON_RUN_AS_NODE = '1'
    process.env.SECRET_TOKEN_IN_SHELL = 'leak-me'
    const env = buildSandboxEnv({}, root)
    expect(env.PATH).toBe('/fake/path')
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.SECRET_TOKEN_IN_SHELL).toBeUndefined()
  })

  it('用户显式配置的插件环境变量叠加生效（含密钥）', () => {
    process.env.PATH = '/fake/path'
    const env = buildSandboxEnv({ GITHUB_TOKEN: 'tok-123', CUSTOM_OPT: 'x' }, root)
    expect(env.GITHUB_TOKEN).toBe('tok-123')
    expect(env.CUSTOM_OPT).toBe('x')
  })

  it('注入沙箱标记与项目根', () => {
    process.env.PATH = '/fake/path'
    const env = buildSandboxEnv({}, root)
    expect(env.KUNYU_PROJECT_ROOT).toBe(root)
    expect(env.KUNYU_MCP_SANDBOX).toBe('1')
  })

  it('空字符串插件变量不注入', () => {
    process.env.PATH = '/fake/path'
    const env = buildSandboxEnv({ EMPTY: '' }, root)
    expect('EMPTY' in env).toBe(false)
  })

  it('保留 npm 镜像/代理配置（npx 拉包依赖）', () => {
    process.env.PATH = '/fake/path'
    process.env.npm_config_registry = 'https://mirrors.example.com/npm'
    process.env.HTTPS_PROXY = 'http://proxy.example.com:8080'
    const env = buildSandboxEnv({}, root)
    expect(env.npm_config_registry).toBe('https://mirrors.example.com/npm')
    expect(env.HTTPS_PROXY).toBe('http://proxy.example.com:8080')
  })
})
