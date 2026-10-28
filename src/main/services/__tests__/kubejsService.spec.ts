/**
 * kubejsService 单测：三目录扫描/读写删、缺失目录标记、id 与根守卫、模板库落盘。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-kj-test-'))
  return {
    app: {
      getPath: () => dir,
      isPackaged: false,
      getVersion: () => '0.0.0-test'
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (b: Buffer) => b,
      decryptString: (b: Buffer) => b
    }
  }
})

import {
  applyTemplate,
  deleteScript,
  listScripts,
  listTemplates,
  readScript,
  writeScript
} from '../kubejsService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'kunyu-kj-proj-'))
  registerProjectRoot(projectRoot)
})

afterEach(() => {
  unregisterProjectRoot(projectRoot)
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('writeScript ↔ readScript 往返', () => {
  it('三个目录写入后可读回，且目录自动创建', () => {
    for (const dir of ['startup', 'server', 'client'] as const) {
      writeScript(projectRoot, dir, 'demo', `// ${dir}\n`)
      expect(readScript(projectRoot, dir, 'demo')).toBe(`// ${dir}\n`)
    }
    expect(existsSync(join(projectRoot, 'kubejs', 'startup_scripts'))).toBe(true)
    expect(existsSync(join(projectRoot, 'kubejs', 'server_scripts'))).toBe(true)
    expect(existsSync(join(projectRoot, 'kubejs', 'client_scripts'))).toBe(true)
  })

  it('读取剥离 BOM', () => {
    writeScript(projectRoot, 'server', 'bom', '// x\n')
    const path = join(projectRoot, 'kubejs', 'server_scripts', 'bom.js')
    writeFileSync(path, String.fromCharCode(0xfeff) + '// x\n')
    expect(readScript(projectRoot, 'server', 'bom')).toBe('// x\n')
  })

  it('读不存在脚本抛错', () => {
    expect(() => readScript(projectRoot, 'server', 'nope')).toThrow(/不存在/)
  })
})

describe('listScripts', () => {
  it('空项目：三目录均标记 missing，脚本为空', () => {
    const res = listScripts(projectRoot)
    expect(res.scripts).toEqual([])
    expect(res.missingDirs).toEqual(['startup', 'server', 'client'])
    expect(res.warnings).toEqual([])
  })

  it('列出脚本元信息并按目录序再按文件名排序；忽略非 .js 文件', () => {
    writeScript(projectRoot, 'server', 'b', '// b\n')
    writeScript(projectRoot, 'server', 'a', '// a\n')
    writeScript(projectRoot, 'startup', 'c', '// c\n')
    writeFileSync(join(projectRoot, 'kubejs', 'server_scripts', 'note.txt'), '不是脚本')
    const res = listScripts(projectRoot)
    expect(res.missingDirs).toEqual(['client'])
    expect(res.scripts.map((s) => s.relPath)).toEqual([
      'kubejs/startup_scripts/c.js',
      'kubejs/server_scripts/a.js',
      'kubejs/server_scripts/b.js'
    ])
    expect(res.scripts[0].sizeBytes).toBeGreaterThan(0)
    expect(res.scripts[0].modifiedAt).toBeGreaterThan(0)
  })
})

describe('守卫与删除', () => {
  it('id 校验：非法目录与文件名拒绝', () => {
    expect(() => writeScript(projectRoot, 'evil' as never, 'a', '')).toThrow(/目录不合法/)
    expect(() => readScript(projectRoot, 'server', '../x')).toThrow(/不合法/)
    expect(() => deleteScript(projectRoot, 'server', 'BAD NAME')).toThrow(/不合法/)
  })

  it('根守卫：未注册的项目根拒绝访问', () => {
    const outsider = mkdtempSync(join(tmpdir(), 'kunyu-kj-outside-'))
    try {
      expect(() => listScripts(outsider)).toThrow()
      expect(() => applyTemplate(outsider, 'server-recipes')).toThrow()
    } finally {
      rmSync(outsider, { recursive: true, force: true })
    }
  })

  it('deleteScript 删除文件；不存在时静默', () => {
    writeScript(projectRoot, 'client', 'ui', '// ui\n')
    deleteScript(projectRoot, 'client', 'ui')
    expect(existsSync(join(projectRoot, 'kubejs', 'client_scripts', 'ui.js'))).toBe(false)
    deleteScript(projectRoot, 'client', 'ui')
  })
})

describe('模板库', () => {
  it('模板覆盖三目录且 id 唯一', () => {
    const templates = listTemplates()
    expect(templates.length).toBeGreaterThanOrEqual(3)
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length)
    expect(new Set(templates.map((t) => t.dir))).toEqual(new Set(['startup', 'server', 'client']))
  })

  it('applyTemplate 落盘并可被列表收编；重复应用拒绝', () => {
    const file = applyTemplate(projectRoot, 'server-recipes')
    expect(file.relPath).toBe('kubejs/server_scripts/my_recipes.js')
    expect(readScript(projectRoot, 'server', 'my_recipes')).toContain("onEvent('recipes'")
    const res = listScripts(projectRoot)
    expect(res.missingDirs).toEqual(['startup', 'client'])
    expect(res.scripts.map((s) => s.relPath)).toContain('kubejs/server_scripts/my_recipes.js')
    expect(() => applyTemplate(projectRoot, 'server-recipes')).toThrow(/已存在/)
  })

  it('未知模板 id 抛错', () => {
    expect(() => applyTemplate(projectRoot, 'nope')).toThrow(/模板不存在/)
  })
})
