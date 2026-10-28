/**
 * B2 ideTools 单测：
 * - list_files：目录树遍历/跳过规则/glob/上限/逃逸护栏
 * - run_command：resolveSpawnPlan 拦截矩阵（纯函数全量覆盖）
 * - runProcess：真实进程执行（node  fixtures）、非零退出、超时 kill、启动失败
 * - 注册表集成：project 可见性门控
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { builtinIdeTools, listProjectFiles, resolveSpawnPlan, runProcess } from '../fcTools/ideTools'
import { clampRunCommandTimeout, TOOL_TIMEOUTS } from '../fcTools/toolPolicy'
import { createToolRegistry, type ToolRegistryDeps } from '../toolRegistry'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

function tool(name: string, deps: ToolRegistryDeps) {
  const t = builtinIdeTools(deps).find((x) => x.def.function.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

describe('listProjectFiles', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-ide-list-'))
    mkdirSync(join(root, 'src', 'main', 'java'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
    mkdirSync(join(root, 'build'), { recursive: true })
    writeFileSync(join(root, 'src', 'main', 'java', 'Mod.java'), 'class Mod {}')
    writeFileSync(join(root, 'src', 'main', 'java', 'Helper.java'), 'class Helper {}')
    writeFileSync(join(root, 'README.md'), '# readme')
    writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'x')
    writeFileSync(join(root, 'build', 'out.jar'), 'x')
  })

  it('递归列出文件（POSIX 路径），跳过依赖/构建目录', () => {
    const r = listProjectFiles(root)
    expect(r.ok).toBe(true)
    expect(r.entries).toContain('src/main/java/Mod.java')
    expect(r.entries).toContain('README.md')
    expect(r.entries.some((e) => e.includes('node_modules'))).toBe(false)
    expect(r.entries.some((e) => e.startsWith('build/'))).toBe(false)
  })

  it('输出确定性（名称排序）', () => {
    const r = listProjectFiles(root)
    const sorted = [...r.entries].sort()
    expect(r.entries).toEqual(sorted)
  })

  it('glob 过滤文件名', () => {
    const r = listProjectFiles(root, { glob: '*.java' })
    expect(r.entries.length).toBe(2)
    expect(r.entries.every((e) => e.endsWith('.java'))).toBe(true)
  })

  it('dir 限定子目录；逃逸项目根被拒', () => {
    const sub = listProjectFiles(root, { dir: 'src' })
    expect(sub.ok).toBe(true)
    expect(sub.entries.every((e) => e.startsWith('src/'))).toBe(true)
    const esc = listProjectFiles(root, { dir: '..' })
    expect(esc.ok).toBe(false)
    expect(esc.error).toContain('逃逸')
  })

  it('maxEntries 截断并标记', () => {
    const r = listProjectFiles(root, { maxEntries: 1 })
    expect(r.entries.length).toBe(1)
    expect(r.truncated).toBe(true)
  })

  it('不存在的目录/根软失败', () => {
    expect(listProjectFiles(join(root, 'nope')).ok).toBe(false)
    expect(listProjectFiles(root, { dir: 'nope' }).ok).toBe(false)
  })
})

describe('resolveSpawnPlan 拦截矩阵', () => {
  it('白名单外可执行名拒绝', () => {
    expect(resolveSpawnPlan('python', ['-V']).ok).toBe(false)
    expect(resolveSpawnPlan('curl', ['x']).ok).toBe(false)
    expect(resolveSpawnPlan('rm', ['-rf']).ok).toBe(false)
  })

  it('大小写/路径/.exe 归一后按白名单匹配', () => {
    expect(resolveSpawnPlan('GIT.EXE', ['status']).ok).toBe(true)
    expect(resolveSpawnPlan('C:\\tools\\Git.exe', ['status']).ok).toBe(true)
  })

  it('git 危险子命令拦截，常规子命令放行', () => {
    for (const sub of ['push', 'reset', 'clean', 'rebase', 'filter-branch']) {
      expect(resolveSpawnPlan('git', [sub]).ok, `git ${sub}`).toBe(false)
    }
    expect(resolveSpawnPlan('git', ['status', '--short']).ok).toBe(true)
    expect(resolveSpawnPlan('git', ['log', '--oneline']).ok).toBe(true)
    expect(resolveSpawnPlan('git', ['add', 'a.txt']).ok).toBe(true)
  })

  it('git config --global 拦截，本地 config 放行', () => {
    expect(resolveSpawnPlan('git', ['config', '--global', 'user.name', 'x']).ok).toBe(false)
    expect(resolveSpawnPlan('git', ['config', 'user.name', 'x']).ok).toBe(true)
  })

  it('npm 危险子命令拦截', () => {
    expect(resolveSpawnPlan('npm', ['publish']).ok).toBe(false)
    expect(resolveSpawnPlan('npm', ['unpublish']).ok).toBe(false)
    expect(resolveSpawnPlan('npm', ['link']).ok).toBe(false)
    expect(resolveSpawnPlan('npm', ['install']).ok).toBe(true)
    expect(resolveSpawnPlan('npm', ['run', 'build']).ok).toBe(true)
  })

  it('node 内联 eval 拦截，脚本文件放行', () => {
    expect(resolveSpawnPlan('node', ['-e', '1']).ok).toBe(false)
    expect(resolveSpawnPlan('node', ['--eval', '1']).ok).toBe(false)
    expect(resolveSpawnPlan('node', ['--eval=1']).ok).toBe(false)
    expect(resolveSpawnPlan('node', ['-p', '1']).ok).toBe(false)
    expect(resolveSpawnPlan('node', ['--print=1']).ok).toBe(false)
    expect(resolveSpawnPlan('node', ['script.js']).ok).toBe(true)
    expect(resolveSpawnPlan('node', ['--version']).ok).toBe(true)
  })

  it('参数逃逸护栏：.. 与绝对路径拒绝', () => {
    expect(resolveSpawnPlan('node', ['../evil.js']).ok).toBe(false)
    expect(resolveSpawnPlan('node', ['D:\\tmp\\evil.js']).ok).toBe(false)
    expect(resolveSpawnPlan('node', ['C:/tmp/evil.js']).ok).toBe(false)
    expect(resolveSpawnPlan('node', ['/etc/passwd']).ok).toBe(false)
    expect(resolveSpawnPlan('git', ['-C', '../other', 'status']).ok).toBe(false)
  })

  it('win32 gradlew 经 cmd 包装且拦截 cmd 元字符', () => {
    const plan = resolveSpawnPlan('gradlew', ['tasks'], 'win32')
    expect(plan.ok).toBe(true)
    expect(plan.file).toBe('cmd.exe')
    expect(plan.args?.slice(0, 4)).toEqual(['/d', '/s', '/c', 'gradlew.bat'])
    expect(resolveSpawnPlan('gradlew', ['tasks', '&', 'del'], 'win32').ok).toBe(false)
    expect(resolveSpawnPlan('gradlew', ['-Dprop=a|b'], 'win32').ok).toBe(false)
  })

  it('posix gradlew 走 ./gradlew 直起', () => {
    const plan = resolveSpawnPlan('gradlew', ['tasks'], 'linux')
    expect(plan.ok).toBe(true)
    expect(plan.file).toBe('./gradlew')
  })
})

describe('runProcess 真实进程', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-ide-run-'))
    writeFileSync(join(root, 'exit3.js'), 'process.exit(3)')
    writeFileSync(join(root, 'sleep.js'), 'setTimeout(() => {}, 30000)')
    writeFileSync(join(root, 'cwd.js'), 'console.log(process.cwd())')
  })

  it('成功命令退出码 0 并采集输出', async () => {
    const r = await runProcess('node', ['--version'], root, 10_000)
    expect(r.code).toBe(0)
    expect(r.output).toMatch(/v\d+/)
    expect(r.timedOut).toBe(false)
  })

  it('非零退出码原样返回', async () => {
    const r = await runProcess('node', ['exit3.js'], root, 10_000)
    expect(r.code).toBe(3)
  })

  it('cwd 锁定在项目根', async () => {
    const r = await runProcess('node', ['cwd.js'], root, 10_000)
    expect(r.code).toBe(0)
    // 子进程 process.cwd() 返回 realpath 后的路径（mac /var → /private/var），按 realpath 比对
    let expected = root
    try {
      expected = realpathSync(root)
    } catch {
      /* 目录刚建，理论上存在；失败退回词法路径 */
    }
    expect(r.output.trim().replace(/\\/g, '/')).toBe(expected.replace(/\\/g, '/'))
  })

  it('超时 kill 并标记 timedOut', async () => {
    const r = await runProcess('node', ['sleep.js'], root, 300)
    expect(r.timedOut).toBe(true)
  })

  it('不存在的可执行名返回 spawnError', async () => {
    const r = await runProcess('definitely-not-exists-xyz', [], root, 1_000)
    expect(r.spawnError).toBeTruthy()
  })
})

describe('run_command / list_files 工具出口', () => {
  let root: string
  let deps: ToolRegistryDeps

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-ide-tool-'))
    writeFileSync(join(root, 'hello.js'), 'console.log("kunyu-ok")')
    deps = { projectRoot: () => root }
  })

  it('run_command 成功执行并回传输出', async () => {
    const r = await tool('run_command', deps).execute({ command: 'node', args: ['hello.js'] }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('kunyu-ok')
    expect(r.text).toContain('$ node hello.js')
  })

  it('run_command 非零退出软失败且回传输出', async () => {
    writeFileSync(join(root, 'fail.js'), 'console.error("bad-news");process.exit(2)')
    const r = await tool('run_command', deps).execute({ command: 'node', args: ['fail.js'] }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('退出码 2')
    expect(r.error).toContain('bad-news')
  })

  it('run_command 拦截命令不发进程', async () => {
    const r = await tool('run_command', deps).execute({ command: 'git', args: ['push'] }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('危险子命令')
  })

  it('run_command 无项目拒绝执行', async () => {
    const r = await tool('run_command', { projectRoot: () => null }).execute(
      { command: 'node', args: ['--version'] },
      CTX
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('无打开的项目')
  })

  it('run_command 空 command 拒绝', async () => {
    const r = await tool('run_command', deps).execute({ command: ' ', args: [] }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('command 不能为空')
  })

  it('list_files 经工具出口列出项目文件', async () => {
    const r = await tool('list_files', deps).execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('hello.js')
  })
})

describe('clampRunCommandTimeout', () => {
  it('缺省取目录默认值，越界夹取', () => {
    expect(clampRunCommandTimeout()).toBe(TOOL_TIMEOUTS.runCommandDefault)
    expect(clampRunCommandTimeout(1)).toBe(TOOL_TIMEOUTS.runCommandMin)
    expect(clampRunCommandTimeout(999_999_999)).toBe(TOOL_TIMEOUTS.runCommandMax)
    expect(clampRunCommandTimeout(30_000)).toBe(30_000)
  })
})

describe('ideTools 注册表集成', () => {
  it('无项目时两个工具均不暴露', () => {
    const names = createToolRegistry({})
      .getToolDefinitions()
      .map((d) => d.function.name)
    expect(names).not.toContain('list_files')
    expect(names).not.toContain('run_command')
  })

  it('有项目时暴露且 description 渲染命名纪律', () => {
    const reg = createToolRegistry({ projectRoot: () => 'D:/p' })
    const defs = reg.getToolDefinitions()
    const list = defs.find((d) => d.function.name === 'list_files')
    const run = defs.find((d) => d.function.name === 'run_command')
    expect(list?.function.description).toMatch(/^【只读】/)
    expect(run?.function.description).toMatch(/^【外部副作用】/)
    expect(run?.function.description).toContain('不适用：')
  })
})
