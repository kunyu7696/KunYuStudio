/**
 * DSH 兼容宿主测试：
 * - isSafeNpmName 注入用例
 * - dshParamsToSchema 声明转换
 * - cordis 插件契约：apply(ctx, config) / inject 缺服务 PENDING 挂起 /
 *   apply 返回值即 disposer（reload 逆序执行）/ ctx.provide 跨插件服务 /
 *   工具桥接进 ToolRegistry 且 execute 抛错被捕获
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userDataRoot = mkdtempSync(join(tmpdir(), 'ky-dsh-'))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataRoot
  }
}))

import { isSafeNpmName } from '../dshInstaller'
import {
  collectDshSystemPrompt,
  dshParamsToSchema,
  getDshPluginStatuses,
  loadAllDshPlugins,
  registerDshTools
} from '../dshHost'
import { createToolRegistry } from '../../ai/toolRegistry'
import { writeInstalledRecords } from '../dshCatalog'
import { approvePlugin, revokePlugin } from '../dshTrust'
import type { DshInstalledRecord } from '../../../../shared/types/dsh'

beforeEach(() => {
  rmSync(join(userDataRoot, 'dsh-plugins'), { recursive: true, force: true })
})

afterEach(() => {
  rmSync(join(userDataRoot, 'dsh-plugins'), { recursive: true, force: true })
})

/** 在伪 userData 里生成一个 ESM 插件包并完成信任授权（默认声明 tools/systemPrompt） */
function writeFakePlugin(
  npmName: string,
  indexJs: string,
  pkgExtra: Record<string, unknown> = {}
): void {
  writeRawPlugin(npmName, indexJs, pkgExtra)
  expect(approvePlugin(npmName)).toBe(true)
}

/** 只落盘、不授权（用于信任门控用例） */
function writeRawPlugin(
  npmName: string,
  indexJs: string,
  pkgExtra: Record<string, unknown> = {}
): void {
  const pkgDir = join(userDataRoot, 'dsh-plugins', 'node_modules', npmName)
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({
      name: npmName,
      version: '1.0.0',
      main: 'index.js',
      type: 'module',
      kunyu: { permissions: ['tools', 'systemPrompt'] },
      ...pkgExtra
    }),
    'utf-8'
  )
  writeFileSync(join(pkgDir, 'index.js'), indexJs, 'utf-8')
}

function recordOf(npmName: string): DshInstalledRecord {
  return { npm: npmName, version: '1.0.0', source: 'custom', installedAt: 0, shims: [] }
}

describe('isSafeNpmName', () => {
  it('接受合法包名（含 scoped）', () => {
    expect(isSafeNpmName('dsh-web-search-pro')).toBe(true)
    expect(isSafeNpmName('@keleus/deepseek-pet')).toBe(true)
  })
  it('拒绝注入与穿越形态', () => {
    expect(isSafeNpmName('-x')).toBe(false)
    expect(isSafeNpmName('a&b')).toBe(false)
    expect(isSafeNpmName('a;b')).toBe(false)
    expect(isSafeNpmName('../escape')).toBe(false)
    expect(isSafeNpmName('a b')).toBe(false)
    expect(isSafeNpmName('')).toBe(false)
    expect(isSafeNpmName('@scope')).toBe(false)
  })
})

describe('dshParamsToSchema', () => {
  it('DSH 参数声明转 JSON Schema', () => {
    expect(
      dshParamsToSchema({
        q: { type: 'string', required: true, description: 'query' },
        n: { type: 'number' },
        flag: { type: 'boolean' }
      })
    ).toEqual({
      type: 'object',
      properties: {
        q: { type: 'string', description: 'query' },
        n: { type: 'number' },
        flag: { type: 'boolean' }
      },
      required: ['q']
    })
  })
  it('已是 JSON Schema 时透传，异常输入回退空对象', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } }
    expect(dshParamsToSchema(schema)).toBe(schema)
    expect(dshParamsToSchema(null)).toEqual({ type: 'object', properties: {} })
    expect(dshParamsToSchema('x')).toEqual({ type: 'object', properties: {} })
  })
})

describe('DSH 兼容宿主加载与工具桥接', () => {
  it('加载 inject:["tools"] 插件：active + 工具进入 ToolRegistry 并可执行', async () => {
    writeFakePlugin(
      'fake-tool',
      [
        "export const name = 'fake-tool'",
        "export const inject = ['tools']",
        'export function apply(ctx) {',
        '  ctx.tools.register({',
        "    name: 'ping',",
        "    description: 'ping it',",
        "    parameters: { q: { type: 'string', required: true, description: 'q' } },",
        '    async execute(args) { return "pong:" + (args.q ?? "") },',
        '  })',
        '}'
      ].join('\n')
    )
    writeInstalledRecords([recordOf('fake-tool')])
    await loadAllDshPlugins()
    const statuses = getDshPluginStatuses()
    expect(statuses).toHaveLength(1)
    expect(statuses[0].state).toBe('active')
    expect(statuses[0].tools).toEqual(['dsh_fake-tool_ping'])

    const registry = createToolRegistry({})
    registerDshTools(registry)
    expect(registry.has('dsh_fake-tool_ping')).toBe(true)
    const defs = registry.getToolDefinitions()
    const def = defs.find((d) => d.function.name === 'dsh_fake-tool_ping')
    expect(def?.function.description).toContain('[DSH 插件 fake-tool]')
    expect(def?.function.parameters).toEqual({
      type: 'object',
      properties: { q: { type: 'string', description: 'q' } },
      required: ['q']
    })
    const result = await registry.executeTool('dsh_fake-tool_ping', { q: 'hi' }, { loader: 'fabric', mcVersion: '1.20.1' })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('pong:hi')
  })

  it('未导出 apply → inactive 并给出原因', async () => {
    writeFakePlugin('no-apply', 'export const name = "no-apply"')
    writeInstalledRecords([recordOf('no-apply')])
    await loadAllDshPlugins()
    const statuses = getDshPluginStatuses()
    expect(statuses[0].state).toBe('inactive')
    expect(statuses[0].reason).toContain('apply')
  })

  it('inject 声明的服务缺失 → PENDING 挂起（state inactive，不调用 apply）', async () => {
    writeFakePlugin(
      'needs-llm',
      [
        "export const inject = ['llm', 'tools']",
        // cordis 契约：缺服务静默挂起，apply 不执行——若被调用会注册工具并抛错留痕
        'export function apply() {',
        '  throw new Error("apply 不应被调用")',
        '}'
      ].join('\n')
    )
    writeInstalledRecords([recordOf('needs-llm')])
    await loadAllDshPlugins()
    const statuses = getDshPluginStatuses()
    expect(statuses[0].state).toBe('inactive')
    expect(statuses[0].missingServices).toEqual(['llm'])
    expect(statuses[0].reason).toContain('已挂起（PENDING）')
    expect(statuses[0].reason).toContain('llm')
    expect(statuses[0].tools).toEqual([])
  })

  it('dsh-pet 专用包被通用宿主整体跳过（不出现在状态表，不 PENDING、不重复 apply）', async () => {
    // 即使磁盘上的包 inject 一堆通用宿主没有的服务，也根本不会被加载
    writeFakePlugin(
      'dsh-pet',
      [
        "export const inject = ['webServer', 'agentDefaultModel', 'credentials', 'llm', 'commands']",
        'export function apply() { throw new Error("专用包不应被通用宿主 apply") }'
      ].join('\n')
    )
    writeInstalledRecords([recordOf('dsh-pet')])
    await loadAllDshPlugins()
    expect(getDshPluginStatuses().map((s) => s.npm)).not.toContain('dsh-pet')
  })

  it('web-search-pro 形态：inject tools+systemPrompt 激活，section 收集且 text 惰性求值，未声明能力不授予', async () => {
    // 模拟社区插件：ctx.tools.register 注册工具 + ctx.systemPrompt.section 注入提示段
    // （text thunk 引用 ctx.fiber.config —— 验证宿主 fiber 视图不会让求值炸掉）
    writeFakePlugin(
      'dsh-wsp',
      [
        "export const inject = ['tools', 'systemPrompt']",
        'export function apply(ctx) {',
        '  ctx.tools.register({ name: "web_index", description: "搜索索引", parameters: { q: { type: "string", required: true } }, execute: (a) => `hits:${a.q}` })',
        '  ctx.systemPrompt.section({ name: "tool:wsp", order: 112, text: () => `guide(db=${ctx.fiber.config.db ?? "default"})` })',
        '}'
      ].join('\n')
    )
    writeInstalledRecords([recordOf('dsh-wsp')])
    await loadAllDshPlugins()
    const status = getDshPluginStatuses()[0]
    expect(status.state).toBe('active')
    expect(status.missingServices).toEqual([])
    expect(status.tools).toEqual(['dsh_dsh-wsp_web_index'])
    // 段落求值走 fiber.config（宿主提供 {} 默认配置）
    expect(collectDshSystemPrompt()).toBe('guide(db=default)')
    // 工具桥接后可执行
    const registry = createToolRegistry()
    registerDshTools(registry)
    const result = await registry.executeTool('dsh_dsh-wsp_web_index', { q: 'mc' }, { loader: 'forge', mcVersion: '1.21.1' })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('hits:mc')
  })

  it('reload 后旧 systemPrompt 段清理（不重复堆积）', async () => {
    writeFakePlugin(
      'dsh-prompter',
      'export function apply(ctx) { ctx.systemPrompt.section({ name: "s", order: 1, text: () => "段落" }) }'
    )
    writeInstalledRecords([recordOf('dsh-prompter')])
    await loadAllDshPlugins()
    expect(collectDshSystemPrompt()).toBe('段落')
    await loadAllDshPlugins() // reload：disposeAll 清段后重建
    expect(collectDshSystemPrompt()).toBe('段落')
  })

  it('apply 抛错 → error（fiber FAILED，记录原始异常信息）', async () => {
    writeFakePlugin(
      'boom',
      [
        "export const name = 'boom'",
        'export function apply(ctx) {',
        '  ctx.tools.register({ name: "t", execute: () => "x" })',
        '  throw new Error("boom!")',
        '}'
      ].join('\n')
    )
    writeInstalledRecords([recordOf('boom')])
    await loadAllDshPlugins()
    const statuses = getDshPluginStatuses()
    expect(statuses[0].state).toBe('error')
    expect(statuses[0].reason).toContain('fiber FAILED')
    expect(statuses[0].reason).toContain('boom!')
  })

  it('apply 返回的清理器在 reload 时逆序执行', async () => {
    const order: string[] = []
    ;(globalThis as Record<string, unknown>).__kyDshOrder = order
    const mk = (tag: string) =>
      [
        `export function apply() { globalThis.__kyDshOrder.push('apply:${tag}'); return () => { globalThis.__kyDshOrder.push('dispose:${tag}') } }`
      ].join('\n')
    writeFakePlugin('life-a', mk('a'))
    writeFakePlugin('life-b', mk('b'))
    writeInstalledRecords([recordOf('life-a'), recordOf('life-b')])
    await loadAllDshPlugins()
    expect(order).toEqual(['apply:a', 'apply:b'])
    // reload：先逆序执行上一代清理器（b 先于 a），再重新 apply
    await loadAllDshPlugins()
    expect(order).toEqual(['apply:a', 'apply:b', 'dispose:b', 'dispose:a', 'apply:a', 'apply:b'])
    // 不 delete：后续测试 reload 会触发本代清理器，留空数组承接避免噪音
    ;(globalThis as Record<string, unknown>).__kyDshOrder = []
  })

  it('ctx.provide 发布的服务可被后续插件消费（inject 门控放行 + ctx 属性解析）', async () => {
    writeFakePlugin(
      'provider',
      [
        "export function apply(ctx) { ctx.provide('greeting', { hello: (n) => 'hi ' + n }) }"
      ].join('\n')
    )
    writeFakePlugin(
      'consumer',
      [
        "export const inject = ['greeting']",
        'export function apply(ctx) {',
        '  ctx.tools.register({',
        "    name: 'greet',",
        '    execute: () => ctx.greeting.hello("kunyu")',
        '  })',
        '}'
      ].join('\n')
    )
    writeInstalledRecords([recordOf('provider'), recordOf('consumer')])
    await loadAllDshPlugins()
    const statuses = getDshPluginStatuses()
    expect(statuses.find((s) => s.npm === 'provider')?.state).toBe('active')
    const consumer = statuses.find((s) => s.npm === 'consumer')
    expect(consumer?.state).toBe('active')
    expect(consumer?.tools).toEqual(['dsh_consumer_greet'])

    const registry = createToolRegistry({})
    registerDshTools(registry)
    const result = await registry.executeTool('dsh_consumer_greet', {}, { loader: 'fabric', mcVersion: '1.20.1' })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('hi kunyu')
  })

  it('P1-9：卸载 provider 后重载，其服务不得残留（consumer 回落 PENDING，不能幽灵满足 inject）', async () => {
    // 包名不得与其它用例重复：ESM 按入口 URL 缓存，重名会拿到旧模块
    writeFakePlugin(
      'ghost-provider',
      "export function apply(ctx) { ctx.provide('ghost', { evil: true }) }"
    )
    writeFakePlugin(
      'ghost-consumer',
      [
        "export const inject = ['ghost']",
        'export function apply(ctx) {',
        '  ctx.tools.register({ name: "use-ghost", execute: () => ctx.get("ghost") })',
        '}'
      ].join('\n')
    )
    writeInstalledRecords([recordOf('ghost-provider'), recordOf('ghost-consumer')])
    await loadAllDshPlugins()
    expect(getDshPluginStatuses().find((s) => s.npm === 'ghost-consumer')?.state).toBe('active')

    // 卸载 provider（只删包目录与记录，等价 removeDshPlugin 的落盘效果）后重载
    rmSync(join(userDataRoot, 'dsh-plugins', 'node_modules', 'ghost-provider'), { recursive: true, force: true })
    writeInstalledRecords([recordOf('ghost-consumer')])
    await loadAllDshPlugins()
    const statuses = getDshPluginStatuses()
    const consumer = statuses.find((s) => s.npm === 'ghost-consumer')
    // 旧实现 provided 全局 Map 不清空：ghost 服务残留 → consumer 仍 active（投毒）
    expect(consumer?.state).toBe('inactive')
    expect(consumer?.missingServices).toEqual(['ghost'])
  })

  it('工具 execute 抛错 → 捕获为失败结果，不崩进程', async () => {
    writeFakePlugin(
      'throwing-tool',
      [
        "export function apply(ctx) {",
        '  ctx.tools.register({ name: "bad", execute: () => { throw new Error("tool broke") } })',
        '}'
      ].join('\n')
    )
    writeInstalledRecords([recordOf('throwing-tool')])
    await loadAllDshPlugins()
    expect(getDshPluginStatuses()[0].state).toBe('active')

    const registry = createToolRegistry({})
    registerDshTools(registry)
    const result = await registry.executeTool('dsh_throwing-tool_bad', {}, { loader: 'fabric', mcVersion: '1.20.1' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('tool broke')
  })
})

describe('DSH 信任门控（主进程内运行的唯一前置闸）', () => {
  it('未授权插件不加载：inactive + trustState untrusted，apply 不执行', async () => {
    writeRawPlugin('untrusted', 'export function apply() { throw new Error("不应被调用") }')
    writeInstalledRecords([recordOf('untrusted')])
    await loadAllDshPlugins()
    const status = getDshPluginStatuses()[0]
    expect(status.state).toBe('inactive')
    expect(status.trustState).toBe('untrusted')
    expect(status.reason).toContain('未授权运行')
    expect(status.declaredPermissions).toEqual(['tools', 'systemPrompt'])
  })

  it('授权后包内容被替换 → 授权失效（changed），必须重新授权', async () => {
    writeRawPlugin('changed-pkg', 'export const name = "changed-pkg"')
    writeInstalledRecords([recordOf('changed-pkg')])
    expect(approvePlugin('changed-pkg')).toBe(true)
    // 同名升级/替换：入口内容变化 → 指纹不再匹配
    writeRawPlugin('changed-pkg', 'export const name = "changed-pkg-v2"')
    await loadAllDshPlugins()
    const status = getDshPluginStatuses()[0]
    expect(status.state).toBe('inactive')
    expect(status.trustState).toBe('changed')
    expect(status.reason).toContain('原授权自动失效')
  })

  it('未声明 systemPrompt 却取用该服务 → error，原因对外可见', async () => {
    writeRawPlugin(
      'only-tools',
      'export function apply(ctx) { ctx.systemPrompt.section({ name: "s", order: 1, text: () => "x" }) }',
      { kunyu: { permissions: ['tools'] } }
    )
    writeInstalledRecords([recordOf('only-tools')])
    expect(approvePlugin('only-tools')).toBe(true)
    await loadAllDshPlugins()
    const status = getDshPluginStatuses()[0]
    expect(status.state).toBe('error')
    expect(status.reason).toContain('systemPrompt')
    expect(collectDshSystemPrompt()).toBe('')
  })

  it('撤销授权后 reload 不再加载（工具随之从注册表消失）', async () => {
    writeFakePlugin(
      'revoked-tool',
      'export function apply(ctx) { ctx.tools.register({ name: "t", execute: () => "x" }) }'
    )
    writeInstalledRecords([recordOf('revoked-tool')])
    await loadAllDshPlugins()
    expect(getDshPluginStatuses()[0].state).toBe('active')
    const registry = createToolRegistry({})
    registerDshTools(registry)
    expect(registry.has('dsh_revoked-tool_t')).toBe(true)

    revokePlugin('revoked-tool')
    await loadAllDshPlugins()
    expect(getDshPluginStatuses()[0].state).toBe('inactive')
    const after = createToolRegistry({})
    registerDshTools(after)
    expect(after.has('dsh_revoked-tool_t')).toBe(false)
  })
})
