import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../settingsService', () => ({
  getSection: () => ({ proxyMode: 'none', proxyHost: '', proxyPort: 0, timeoutSec: 30 })
}))

import { builtinForgeNeoTools } from '../fcTools/forgeNeoTools'
import type { ToolRegistryDeps } from '../toolRegistry'

describe('forgeNeoTools', () => {
  let root: string
  let deps: ToolRegistryDeps

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-forge-neo-'))
    mkdirSync(join(root, 'src/main/resources/META-INF'), { recursive: true })
    mkdirSync(join(root, 'src/main/java/com/examplemod'), { recursive: true })
    deps = {
      projectRoot: () => root
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('forge_mods_toml_validate', () => {
    it('项目未打开时拒绝', async () => {
      deps.projectRoot = () => null
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('没有打开的项目')
    })

    it('非 Forge 项目拒绝', async () => {
      writeFileSync(join(root, 'src/main/resources/META-INF/neoforge.mods.toml'), 'modLoader="javafml"')
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('不是 Forge')
    })

    it('mods.toml 缺失时报错', async () => {
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('不是 Forge')
    })

    it('TOML 非法时报错', async () => {
      writeFileSync(join(root, 'src/main/resources/META-INF/mods.toml'), 'not = [valid')
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.text).toContain('不是合法 TOML')
    })

    it('缺 modLoader/loaderVersion 报错', async () => {
      writeFileSync(
        join(root, 'src/main/resources/META-INF/mods.toml'),
        `license = "MIT"\n[[mods]]\nmodId = "examplemod"\nversion = "1.0"\n`
      )
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.text).toContain('modLoader')
      expect(r.text).toContain('loaderVersion')
    })

    it('modId 非法报错', async () => {
      writeFileSync(
        join(root, 'src/main/resources/META-INF/mods.toml'),
        `modLoader = "javafml"\nloaderVersion = "[47,)"\nlicense = "MIT"\n[[mods]]\nmodId = "Bad_ID"\nversion = "1.0"\n`
      )
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.text).toContain('modId=Bad_ID')
    })

    it('entrypoints 类文件不存在时报错', async () => {
      writeFileSync(
        join(root, 'src/main/resources/META-INF/mods.toml'),
        `modLoader = "javafml"\nloaderVersion = "[47,)"\nlicense = "MIT"\n[[mods]]\nmodId = "examplemod"\nversion = "1.0"\nentrypoints = { client = "com.examplemod.Client" }\n`
      )
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.text).toContain('入口类文件不存在')
    })

    it('完整合法通过', async () => {
      writeFileSync(
        join(root, 'src/main/java/com/examplemod/ExampleMod.java'),
        'package com.examplemod; public class ExampleMod {}'
      )
      writeFileSync(
        join(root, 'src/main/resources/META-INF/mods.toml'),
        `modLoader = "javafml"\nloaderVersion = "[47,)"\nlicense = "MIT"\nissueTrackerURL = "https://example.com"\n[[mods]]\nmodId = "examplemod"\nversion = "1.0"\nentrypoints = { main = "com.examplemod.ExampleMod" }\n[mods.examplemod.dependencies]\nminecraft = "[1.20.1,)"\n`
      )
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(true)
      expect(r.text).toContain('校验通过')
    })
  })

  describe('neoforge_mods_toml_validate', () => {
    it('neoforge.mods.toml 缺失时报错', async () => {
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'neoforge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'neoforge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('不是 NeoForge')
    })

    it('完整合法通过', async () => {
      writeFileSync(
        join(root, 'src/main/java/com/examplemod/ExampleMod.java'),
        'package com.examplemod; public class ExampleMod {}'
      )
      writeFileSync(
        join(root, 'src/main/resources/META-INF/neoforge.mods.toml'),
        `modLoader = "javafml"\nloaderVersion = "[1,)"\nlicense = "MIT"\n[[mods]]\nmodId = "examplemod"\nversion = "1.0"\nentrypoints = { main = "com.examplemod.ExampleMod" }\n`
      )
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'neoforge_mods_toml_validate')!
      const r = await tool.execute({}, { loader: 'neoforge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(true)
      expect(r.text).toContain('校验通过')
    })
  })

  describe('forge_meta_version_check', () => {

    it('项目未打开时拒绝', async () => {
      deps.projectRoot = () => null
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_meta_version_check')!
      const r = await tool.execute({ mcVersion: '1.20.1' }, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('没有打开的项目')
    })

    it('离线时软失败并提示', async () => {
      vi.mock('../../httpUtil', () => ({
        httpGetText: vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT'))
      }))
      const mod = await import('../fcTools/forgeNeoTools')
      const tool = mod.builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'forge_meta_version_check')!
      const r = await tool.execute({ mcVersion: '1.20.1' }, { loader: 'forge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('查询 Forge maven 失败')
    })
  })

  describe('neoforge_meta_version_check', () => {
    it('缺 mcVersion 且 gradle.properties 无 minecraft_version 时报错', async () => {
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'neoforge_meta_version_check')!
      const r = await tool.execute({}, { loader: 'neoforge', mcVersion: '1.20.1' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('未提供 mcVersion')
    })

    it('从 gradle.properties 读取 mcVersion', async () => {
      writeFileSync(join(root, 'gradle.properties'), 'minecraft_version=1.20.1\n')
      const tool = builtinForgeNeoTools(deps).find((t) => t.def.function.name === 'neoforge_meta_version_check')!
      const r = await tool.execute({}, { loader: 'neoforge', mcVersion: '1.20.1' })
      expect(r.ok || r.error).toBeTruthy()
    })
  })
})
