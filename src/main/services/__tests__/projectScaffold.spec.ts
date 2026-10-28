﻿/**
 * 项目脚手架落盘路径测试（NeoForge 双重 META-INF/ 前缀回归）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unregisterProjectRoot } from '../fsService'
import { migrate } from '../db'
import { createProject, deriveModId, generateMinimalNeoForgeProject } from '../projectService'

let db: Database.Database
vi.mock('../db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../db')>()
  return { ...mod, getDb: () => db }
})

const dirs: string[] = []
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ky-scaffold-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs) {
    unregisterProjectRoot(d)
    rmSync(d, { recursive: true, force: true })
  }
  dirs.length = 0
})
beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
})

describe('NeoForge 脚手架元数据路径（禁止双重 META-INF 前缀）', () => {
  it('1.20.4：元数据落在 resources/META-INF/mods.toml', () => {
    const dir = freshDir()
    generateMinimalNeoForgeProject(dir, '1.20.4')
    expect(existsSync(join(dir, 'src', 'main', 'resources', 'META-INF', 'mods.toml'))).toBe(true)
    // 回归路径：META-INF/META-INF 不应存在
    expect(existsSync(join(dir, 'src', 'main', 'resources', 'META-INF', 'META-INF', 'mods.toml'))).toBe(false)
  })

  it('1.21.1：元数据落在 resources/META-INF/neoforge.mods.toml', () => {
    const dir = freshDir()
    generateMinimalNeoForgeProject(dir, '1.21.1')
    expect(existsSync(join(dir, 'src', 'main', 'resources', 'META-INF', 'neoforge.mods.toml'))).toBe(true)
    expect(existsSync(join(dir, 'src', 'main', 'resources', 'META-INF', 'META-INF', 'neoforge.mods.toml'))).toBe(false)
  })

  it('createProject 完整路径：NeoForge 1.21.1 新建成功且元数据路径正确', () => {
    const parent = freshDir()
    const projectPath = join(parent, 'my-neo-mod')
    const project = createProject({
      name: '我的 Neo 模组',
      path: projectPath,
      type: 'mod',
      loader: 'neoforge',
      mcVersion: '1.21.1',
      modId: 'myneo'
    })
    expect(project.loader).toBe('neoforge')
    expect(existsSync(join(projectPath, 'src', 'main', 'resources', 'META-INF', 'neoforge.mods.toml'))).toBe(true)
    expect(existsSync(join(projectPath, 'src', 'main', 'resources', 'META-INF', 'META-INF'))).toBe(false)
    unregisterProjectRoot(projectPath)
  })
})

describe('模组脚手架根级公共文件（对齐官方模板）', () => {
  const mcVersionByLoader = { fabric: '1.20.1', forge: '1.20.1', neoforge: '1.20.4' } as const
  it.each(['fabric', 'forge', 'neoforge'] as const)('%s 项目生成 .gitignore/.gitattributes/README.md', (loader) => {
    const parent = freshDir()
    const projectPath = join(parent, `${loader}-mod`)
    const project = createProject({
      name: `${loader} 模组`,
      path: projectPath,
      type: 'mod',
      loader,
      mcVersion: mcVersionByLoader[loader],
      modId: `${loader}demo`
    })
    expect(project.loader).toBe(loader)
    for (const f of ['.gitignore', '.gitattributes', 'README.md'] as const) {
      expect(existsSync(join(projectPath, f)), f).toBe(true)
    }
    unregisterProjectRoot(projectPath)
  })

  it('Fabric 使用官方 fabric-example-mod 内容（out/ + classes/ + run/）', () => {
    const parent = freshDir()
    const projectPath = join(parent, 'fabric-mod')
    createProject({ name: 'f', path: projectPath, type: 'mod', loader: 'fabric', mcVersion: '1.20.1', modId: 'fdemo' })
    const gi = readFileSync(join(projectPath, '.gitignore'), 'utf-8')
    expect(gi).toContain('out/')
    expect(gi).toContain('classes/')
    expect(gi).toContain('run/')
    expect(readFileSync(join(projectPath, '.gitattributes'), 'utf-8')).toContain('* text=auto eol=lf')
    unregisterProjectRoot(projectPath)
  })

  it('Forge 使用官方 MDK 内容（忽略 forge_README.txt + 生成 forge_README.txt + src/generated 属性）', () => {
    const parent = freshDir()
    const projectPath = join(parent, 'forge-mod')
    createProject({ name: 'f', path: projectPath, type: 'mod', loader: 'forge', mcVersion: '1.20.1', modId: 'fdemo' })
    expect(readFileSync(join(projectPath, '.gitignore'), 'utf-8')).toContain('forge_README.txt')
    expect(existsSync(join(projectPath, 'forge_README.txt'))).toBe(true)
    expect(readFileSync(join(projectPath, 'forge_README.txt'), 'utf-8')).toContain('Minecraft Forge installation methodology')
    expect(readFileSync(join(projectPath, '.gitattributes'), 'utf-8')).toContain('src/generated/**/*.json text eol=lf')
    unregisterProjectRoot(projectPath)
  })

  it('NeoForge 使用官方 MDK 内容（runs/run-data/repo 目录忽略）', () => {
    const parent = freshDir()
    const projectPath = join(parent, 'neoforge-mod')
    createProject({ name: 'n', path: projectPath, type: 'mod', loader: 'neoforge', mcVersion: '1.20.4', modId: 'ndemo' })
    const gi = readFileSync(join(projectPath, '.gitignore'), 'utf-8')
    expect(gi).toContain('run-data')
    expect(gi).toContain('repo')
    expect(readFileSync(join(projectPath, '.gitattributes'), 'utf-8')).toContain('src/generated/**/*.json text eol=lf')
    unregisterProjectRoot(projectPath)
  })
})

// 中文项目名不再生成含中文的非法 modId（前端向导死锁根因）
describe('deriveModId 中文回退', () => {
  it('纯中文名回落 mymod', () => {
    expect(deriveModId('我的第一个模组')).toBe('mymod')
  })
  it('中英混合名保留 ASCII 部分', () => {
    expect(deriveModId('Ruby 模组')).toBe('ruby')
  })
  it('纯英文名不变', () => {
    expect(deriveModId('Demo Mod')).toBe('demo_mod')
  })
})
