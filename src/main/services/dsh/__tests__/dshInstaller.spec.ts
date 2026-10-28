/**
 * DSH 插件安装器测试：
 * - 内置 npm-cli 在 dev node_modules 内可解析（打包时位于 app.asar.unpacked）
 * - 工具链探测在 node 环境可用（系统 node + npm，或精简 node + 内置 npm）
 * - registry 覆盖纯函数：可达不覆盖 / 不可达回退镜像 / 镜像本身不可达不重试
 * - npm 包名安全正则在 dshHost.spec 已覆盖
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userDataRoot = mkdtempSync(join(tmpdir(), 'ky-dsh-installer-'))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataRoot
  }
}))

import { bundledNpmCli, buildNpmEnv, chooseRegistryOverride, detectDshEnv, mergeNodeModules } from '../dshInstaller'

const MIRROR = 'https://registry.npmmirror.com'
const OFFICIAL = 'https://registry.npmjs.org'

describe('内置 npm 工具链', () => {
  it('bundledNpmCli 解析到实体 npm-cli.js（npm 是生产依赖，bundled 自包含）', () => {
    const cli = bundledNpmCli()
    expect(cli).toBeTruthy()
    expect(existsSync(cli as string)).toBe(true)
    expect(cli).toMatch(/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/)
  })

  it('detectDshEnv 在 node 测试环境报告可用（系统 node 或内置 npm 回退）', async () => {
    const env = await detectDshEnv()
    expect(env.npmOk).toBe(true)
    expect(env.nodeOk).toBe(true)
    expect(env.nodeVersion).toMatch(/^v?\d+\.\d+/)
    expect(env.message).toBeUndefined()
  }, 15_000)
})

describe('chooseRegistryOverride', () => {
  it('当前源可达 → 不覆盖（尊重官方源与用户自定义源）', () => {
    expect(chooseRegistryOverride(OFFICIAL, true)).toBeNull()
    expect(chooseRegistryOverride('https://npm.corp.example', true)).toBeNull()
  })

  it('官方源不可达 → 回退 npmmirror', () => {
    expect(chooseRegistryOverride(OFFICIAL, false)).toBe(MIRROR)
  })

  it('已配置的就是镜像且不可达 → 返回 null（不做无效的同址重试）', () => {
    expect(chooseRegistryOverride(MIRROR, false)).toBeNull()
  })
})

describe('buildNpmEnv（P1-11：npm 子进程环境白名单）', () => {
  it('白名单内系统变量透传，凭据类变量不泄漏', () => {
    const env = buildNpmEnv()
    // 系统级变量按需透传（本测试机至少有 PATH/SystemRoot 或 POSIX PATH）
    expect(Object.keys(env).some((k) => k.toLowerCase() === 'path')).toBe(true)
    // 白名单外一概不带：模拟主进程持有的敏感 env 不得进入 npm 子进程
    expect(Object.keys(env).map((k) => k.toUpperCase())).not.toContain('KUNYU_SECRET_TOKEN')
    for (const key of Object.keys(env)) {
      expect([
        'PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
        'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
        'PROGRAMFILES', 'NUMBER_OF_PROCESSORS', 'OS'
      ]).toContain(key.toUpperCase())
    }
  })

  it('extra 附加项放行（ELECTRON_RUN_AS_NODE），但不得夹带 PATH', () => {
    const env = buildNpmEnv({ ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\evil', KUNYU_SECRET_TOKEN: 'leak' })
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.KUNYU_SECRET_TOKEN).toBeUndefined()
    // PATH 只允许来自白名单（命中实际键名，Windows 下可能是 Path），不取 extra 里的值
    const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path')!
    expect(env[pathKey]).not.toBe('C:\\evil')
    // Path 类键只出现一份（Windows 环境块大小写不敏感，重复键导致 CreateProcess 失败）
    const pathLike = Object.keys(env).filter((k) => k.toLowerCase() === 'path')
    expect(pathLike.length).toBe(1)
  })
})

describe('mergeNodeModules（暂存树 → 共享树合并拷贝）', () => {
  const writePkg = (root: string, name: string, body: string): void => {
    mkdirSync(join(root, name), { recursive: true })
    writeFileSync(join(root, name, 'index.js'), body, 'utf-8')
  }

  it('只增不覆盖：共享树已有包保持原样，新包拷入', () => {
    const src = mkdtempSync(join(tmpdir(), 'ky-merge-src-'))
    const dest = mkdtempSync(join(tmpdir(), 'ky-merge-dst-'))
    writePkg(join(src, 'node_modules'), 'new-pkg', '// new')
    writePkg(join(dest, 'node_modules'), 'dsh-pet', '// 旧版本（正在运行，不可动）')
    writePkg(join(src, 'node_modules'), 'dsh-pet', '// 暂存里的版本（必须被忽略）')
    mergeNodeModules(join(src, 'node_modules'), join(dest, 'node_modules'), ['new-pkg'])
    expect(readFileSync(join(dest, 'node_modules', 'dsh-pet', 'index.js'), 'utf-8')).toBe('// 旧版本（正在运行，不可动）')
    expect(readFileSync(join(dest, 'node_modules', 'new-pkg', 'index.js'), 'utf-8')).toBe('// new')
    rmSync(src, { recursive: true, force: true })
    rmSync(dest, { recursive: true, force: true })
  })

  it('forcePkgs 强制覆盖目标包（重装/升级）；.bin 与隐藏目录跳过；scope 包逐个处理', () => {
    const src = mkdtempSync(join(tmpdir(), 'ky-merge-src-'))
    const dest = mkdtempSync(join(tmpdir(), 'ky-merge-dst-'))
    mkdirSync(join(src, 'node_modules', '.bin'), { recursive: true })
    writeFileSync(join(src, 'node_modules', '.bin', 'tool.cmd'), 'should be skipped', 'utf-8')
    writePkg(join(src, 'node_modules'), 'web-search-pro', '// v2')
    writePkg(join(src, 'node_modules', '@deepseek-ai'), 'cordis', '// cordis 新依赖')
    writePkg(join(dest, 'node_modules'), 'web-search-pro', '// v1')
    writePkg(join(dest, 'node_modules', '@deepseek-ai'), 'cosmokit', '// 既有 shim')
    mergeNodeModules(join(src, 'node_modules'), join(dest, 'node_modules'), ['web-search-pro'])
    expect(readFileSync(join(dest, 'node_modules', 'web-search-pro', 'index.js'), 'utf-8')).toBe('// v2')
    expect(existsSync(join(dest, 'node_modules', '.bin'))).toBe(false)
    expect(readFileSync(join(dest, 'node_modules', '@deepseek-ai', 'cordis', 'index.js'), 'utf-8')).toBe('// cordis 新依赖')
    expect(readFileSync(join(dest, 'node_modules', '@deepseek-ai', 'cosmokit', 'index.js'), 'utf-8')).toBe('// 既有 shim')
    rmSync(src, { recursive: true, force: true })
    rmSync(dest, { recursive: true, force: true })
  })
})
