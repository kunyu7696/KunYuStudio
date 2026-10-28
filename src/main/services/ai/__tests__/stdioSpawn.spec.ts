/**
 * resolveStdioSpawn 单测：Windows 裸命令（npx 等 .cmd 垫片）必须经 cmd /c 拉起，
 * 否则 spawn(shell:false) 报 ENOENT → MCP -32000 Connection closed。
 * 仅 Windows 下执行断言；其他平台跳过（函数直通原样返回）。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureNoPopNodeLaunch, resolveNpxEntryRewrite, resolvePreemptiveNodeLaunch, resolveStdioSpawn, win32NpxHijackHint } from '../mcpClient'

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>()
  return { ...orig, spawnSync: vi.fn(orig.spawnSync) }
})

const onWindows = process.platform === 'win32'

describe.runIf(onWindows)('resolveStdioSpawn (win32)', () => {
  it('npx 裸命令包装为 cmd /c npx', () => {
    const r = resolveStdioSpawn('npx', ['-y', '-p', 'mc-texture-cli@latest', 'mctex-mcp'])
    expect(r.command).toBe('cmd')
    expect(r.args).toEqual(['/c', 'npx', '-y', '-p', 'mc-texture-cli@latest', 'mctex-mcp'])
  })

  it('含空格的参数（如带空格的项目根路径）自动加双引号', () => {
    const r = resolveStdioSpawn('npx', ['mctex-mcp', '--root', 'D:\\My Projects\\demo'])
    expect(r.args).toEqual(['/c', 'npx', 'mctex-mcp', '--root', '"D:\\My Projects\\demo"'])
  })

  it('绝对路径 .exe 不包装（Electron 内置 Node 等）', () => {
    const exe = 'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe'
    const r = resolveStdioSpawn(exe, ['-version'])
    expect(r.command).toBe(exe)
    expect(r.args).toEqual(['-version'])
  })

  it('带路径分隔符的非 exe 命令不包装', () => {
    const r = resolveStdioSpawn('D:\\tools\\server.cmd', ['serve'])
    expect(r.command).toBe('D:\\tools\\server.cmd')
    expect(r.args).toEqual(['serve'])
  })
})

describe.runIf(!onWindows)('resolveStdioSpawn (非 win32)', () => {
  it('原样返回不包装', () => {
    const r = resolveStdioSpawn('npx', ['-y', 'pkg'])
    expect(r.command).toBe('npx')
    expect(r.args).toEqual(['-y', 'pkg'])
  })
})

/**
 * npx 垫片劫持主动修复回归：包 spec 带 @latest/@x.y.z 时必须剥掉版本再查缓存
 * （缓存目录按裸包名存放）。实测 minecraft-mojang-mcp@latest 未剥版本导致
 * 修复静默失效，用户点连接反复弹 VS Code 加载 dist/index.js。
 */
describe.runIf(onWindows)('resolveNpxEntryRewrite (win32)', () => {
  let fakeLocalAppData = ''
  let savedLocalAppData: string | undefined

  const seedCachedPkg = (pkg: string, binRel: string, entryContent = '// bin entry'): string => {
    const pkgDir = join(fakeLocalAppData, 'npm-cache', '_npx', 'deadbeefcafe', 'node_modules', pkg)
    mkdirSync(join(pkgDir, 'dist'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ bin: { [pkg.split('/').pop() ?? pkg]: binRel } }))
    const entry = join(pkgDir, binRel)
    writeFileSync(entry, entryContent)
    return entry
  }

  afterEach(() => {
    if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = savedLocalAppData
    if (fakeLocalAppData) rmSync(fakeLocalAppData, { recursive: true, force: true })
    fakeLocalAppData = ''
  })

  const useFakeCache = (): void => {
    savedLocalAppData = process.env.LOCALAPPDATA
    fakeLocalAppData = mkdtempSync(join(tmpdir(), 'kunyu-npx-cache-'))
    process.env.LOCALAPPDATA = fakeLocalAppData
  }

  it('npx -y pkg@latest：剥掉 @latest 后命中缓存 bin 入口', () => {
    useFakeCache()
    const entry = seedCachedPkg('minecraft-mojang-mcp', 'dist/index.js')
    const r = resolveNpxEntryRewrite('npx', ['-y', 'minecraft-mojang-mcp@latest'])
    expect(r).not.toBeNull()
    expect(r!.command).toBe(process.execPath)
    expect(r!.args[0]).toBe(entry)
  })

  it('scoped 包 @scope/pkg@1.2.3 同样剥版本', () => {
    useFakeCache()
    const entry = seedCachedPkg('@scope/demo-mcp', 'dist/index.js')
    const r = resolveNpxEntryRewrite('npx', ['-y', '@scope/demo-mcp@1.2.3'])
    expect(r).not.toBeNull()
    expect(r!.args[0]).toBe(entry)
  })

  it('-p 形式的包参数原样透传（--root 不丢失）', () => {
    useFakeCache()
    const entry = seedCachedPkg('mc-texture-cli', 'dist/cli.js')
    const r = resolveNpxEntryRewrite('npx', ['-y', '-p', 'mc-texture-cli@latest', 'mc-texture-cli', '--root', 'D:\\demo'])
    expect(r).not.toBeNull()
    expect(r!.args).toEqual([entry, '--root', 'D:\\demo'])
  })

  it('缓存缺失时返回 null', () => {
    useFakeCache()
    expect(resolveNpxEntryRewrite('npx', ['-y', 'not-installed-pkg@latest'])).toBeNull()
  })

  it('非 npx 命令返回 null', () => {
    expect(resolveNpxEntryRewrite('node', ['server.js'])).toBeNull()
  })
})

describe.runIf(onWindows)('win32NpxHijackHint (win32)', () => {
  it('Connection closed（垫片劫持秒退）同样给出提示', () => {
    const hint = win32NpxHijackHint('npx', ['-y', 'minecraft-mojang-mcp@latest'], 'MCP error -32000: Connection closed')
    expect(hint).toContain('shebang')
  })

  it('非 npx 命令不给提示', () => {
    expect(win32NpxHijackHint('node', ['a.js'], 'Connection closed')).toBe('')
  })
})

/**
 * 预防性直启回归：缺 shebang 的包首发即走 node+绝对路径（避免弹编辑器）；
 * 带 shebang 的健康包不干预（保留 npx 语义与 @latest 更新）。
 */
describe.runIf(onWindows)('resolvePreemptiveNodeLaunch (win32)', () => {
  let fakeLocalAppData = ''
  let savedLocalAppData: string | undefined

  afterEach(() => {
    if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = savedLocalAppData
    if (fakeLocalAppData) rmSync(fakeLocalAppData, { recursive: true, force: true })
    fakeLocalAppData = ''
  })

  const useFakeCache = (): void => {
    savedLocalAppData = process.env.LOCALAPPDATA
    fakeLocalAppData = mkdtempSync(join(tmpdir(), 'kunyu-npx-cache-'))
    process.env.LOCALAPPDATA = fakeLocalAppData
  }

  const seed = (pkg: string, entryContent: string): string => {
    const pkgDir = join(fakeLocalAppData, 'npm-cache', '_npx', 'deadbeefcafe', 'node_modules', pkg)
    mkdirSync(join(pkgDir, 'dist'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ bin: { [pkg]: 'dist/index.js' } }))
    const entry = join(pkgDir, 'dist', 'index.js')
    writeFileSync(entry, entryContent)
    return entry
  }

  it('入口缺 shebang：首发即重写为 node+绝对路径', () => {
    useFakeCache()
    const entry = seed('minecraft-mojang-mcp', 'import { createServer } from "./server.js"')
    const r = resolvePreemptiveNodeLaunch('npx', ['-y', 'minecraft-mojang-mcp@latest'])
    expect(r).not.toBeNull()
    expect(r!.command).toBe(process.execPath)
    expect(r!.args[0]).toBe(entry)
  })

  it('入口带 shebang：返回 null 不干预 npx 原链路', () => {
    useFakeCache()
    seed('healthy-mcp', '#!/usr/bin/env node\nconsole.log(1)')
    expect(resolvePreemptiveNodeLaunch('npx', ['-y', 'healthy-mcp@latest'])).toBeNull()
  })

  it('缓存未就绪：返回 null 交由 npx 拉包', () => {
    useFakeCache()
    expect(resolvePreemptiveNodeLaunch('npx', ['-y', 'not-installed@latest'])).toBeNull()
  })
})

/**
 * 零弹窗预取回归：缓存未就绪时先用 npm exec -- <noop> 静默拉包（只下载不执行 bin），
 * 再走预防性直启——新包首次连接也不弹编辑器。已就绪时不得触发预取。
 */
describe.runIf(onWindows)('ensureNoPopNodeLaunch (win32)', () => {
  let fakeLocalAppData = ''
  let savedLocalAppData: string | undefined

  afterEach(() => {
    vi.mocked(spawnSync).mockClear()
    if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = savedLocalAppData
    if (fakeLocalAppData) rmSync(fakeLocalAppData, { recursive: true, force: true })
    fakeLocalAppData = ''
  })

  const useFakeCache = (): void => {
    savedLocalAppData = process.env.LOCALAPPDATA
    fakeLocalAppData = mkdtempSync(join(tmpdir(), 'kunyu-npx-cache-'))
    process.env.LOCALAPPDATA = fakeLocalAppData
  }

  const seed = (pkg: string, entryContent: string): string => {
    const pkgDir = join(fakeLocalAppData, 'npm-cache', '_npx', 'deadbeefcafe', 'node_modules', pkg)
    mkdirSync(join(pkgDir, 'dist'), { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ bin: { [pkg]: 'dist/index.js' } }))
    const entry = join(pkgDir, 'dist', 'index.js')
    writeFileSync(entry, entryContent)
    return entry
  }

  it('缓存已就绪：直接返回重写，不触发预取拉包', async () => {
    useFakeCache()
    const entry = seed('mojang-x', 'import x from "./server.js"')
    const r = await ensureNoPopNodeLaunch('npx', ['-y', 'mojang-x@latest'])
    expect(r).not.toBeNull()
    expect(r!.args[0]).toBe(entry)
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled()
  })

  it('缓存未就绪：先静默预取再直启（首次连接也不弹窗）', async () => {
    useFakeCache()
    vi.mocked(spawnSync).mockImplementationOnce((() => {
      seed('newpkg', 'import x from "./server.js"') // 模拟 npm 下载落盘
      return { status: 0, stdout: '', stderr: '', output: [], pid: 0, signal: null }
    }) as never)
    const r = await ensureNoPopNodeLaunch('npx', ['-y', 'newpkg@latest'])
    expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(1)
    // 预取命令必须是 noop（cmd /c exit 0），不得执行包 bin
    const preflightArgs = vi.mocked(spawnSync).mock.calls[0][1] as string[]
    expect(preflightArgs.slice(-3)).toEqual(['/c', 'exit', '0'])
    expect(r).not.toBeNull()
    expect(r!.args[0]).toContain('newpkg')
  })

  it('预取后包带 shebang：返回 null 保留 npx 原链路', async () => {
    useFakeCache()
    vi.mocked(spawnSync).mockImplementationOnce((() => {
      seed('healthy-x', '#!/usr/bin/env node\nconsole.log(1)')
      return { status: 0, stdout: '', stderr: '', output: [], pid: 0, signal: null }
    }) as never)
    expect(await ensureNoPopNodeLaunch('npx', ['-y', 'healthy-x@latest'])).toBeNull()
  })

  it('非 npx 命令：不预取直接 null', async () => {
    expect(await ensureNoPopNodeLaunch('node', ['a.js'])).toBeNull()
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled()
  })
})
