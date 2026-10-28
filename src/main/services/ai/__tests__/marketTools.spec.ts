import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cfKey: 'test-key',
  searchMods: vi.fn(),
  getModDetail: vi.fn(),
  installMod: vi.fn()
}))

vi.mock('../../settingsService', () => ({
  getSection: (section: string) =>
    section === 'marketplace'
      ? { curseforgeApiKey: h.cfKey }
      : { proxyMode: 'none', proxyHost: '', proxyPort: 0, timeoutSec: 30 }
}))

vi.mock('../../marketService', () => ({
  searchMods: h.searchMods,
  getModDetail: h.getModDetail,
  installMod: h.installMod
}))

import { builtinMarketTools } from '../fcTools/marketTools'
import { writeSources } from '../../modpack/provenance'
import { createToolRegistry, type ToolRegistryDeps } from '../toolRegistry'
import type { ModSourceEntry } from '../../../../shared/types/modpack'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

function makeDetail() {
  return {
    id: '123',
    platform: 'modrinth',
    slug: 'sodium',
    name: 'Sodium',
    summary: '渲染优化',
    authors: ['jellysquid3'],
    iconUrl: null,
    downloads: 1000000,
    updatedAt: '2026-01-01',
    loaders: ['fabric'],
    gameVersions: ['1.20.1'],
    categories: ['optimization'],
    url: 'https://modrinth.com/mod/sodium',
    description: '...',
    files: [
      {
        id: 'v1',
        name: 'Sodium 0.5.0',
        versionNumber: '0.5.0',
        fileName: 'sodium-fabric-0.5.0.jar',
        downloadUrl: 'https://cdn.example/sodium.jar',
        size: 1024,
        releasedAt: '2026-01-01',
        loaders: ['fabric'],
        gameVersions: ['1.20.1'],
        dependencies: []
      }
    ]
  }
}

describe('marketTools', () => {
  let root: string
  let deps: ToolRegistryDeps

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-market-'))
    h.cfKey = 'test-key'
    h.searchMods.mockReset()
    h.getModDetail.mockReset()
    h.installMod.mockReset()
    deps = { projectRoot: () => root, projectType: () => 'modpack' }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function tool(name: string) {
    const t = builtinMarketTools(deps).find((x) => x.def.function.name === name)
    if (!t) throw new Error(`tool not found: ${name}`)
    return t
  }

  describe('门控', () => {
    it('写盘类工具声明为整合包可见性（modpack 规则）', () => {
      const tools = builtinMarketTools(deps)
      const install = tools.find((t) => t.def.function.name === 'market_install_mod')!
      const list = tools.find((t) => t.def.function.name === 'market_list_installed')!
      // P4：可见性语义集中在 toolPolicy.resolveVisibility，片段只声明规则名
      expect(install.visibility).toBe('modpack')
      expect(list.visibility).toBe('modpack')
    })

    it('非整合包项目经注册表后不暴露 install/list', () => {
      deps.projectType = () => 'mod'
      const names = createToolRegistry(deps)
        .getToolDefinitions()
        .map((d) => d.function.name)
      expect(names).not.toContain('market_install_mod')
      expect(names).not.toContain('market_list_installed')
      expect(names).toContain('market_search_mods')
      expect(names).toContain('market_mod_detail')
    })

    it('整合包项目经注册表后暴露 install/list', () => {
      const names = createToolRegistry(deps)
        .getToolDefinitions()
        .map((d) => d.function.name)
      expect(names).toContain('market_install_mod')
      expect(names).toContain('market_list_installed')
    })
  })

  describe('market_search_mods', () => {
    it('CurseForge 无 key 也能搜（透传空 key，由 marketService 走 MCIM 镜像）', async () => {
      h.cfKey = ''
      h.searchMods.mockResolvedValue({ items: [makeDetail()], total: 1, hasMore: false })
      const r = await tool('market_search_mods').execute({ platform: 'curseforge', query: 'sodium' }, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('Sodium')
      expect(h.searchMods).toHaveBeenCalledWith(expect.objectContaining({ platform: 'curseforge' }), '')
    })

    it('缺省 platform 默认 Modrinth', async () => {
      h.searchMods.mockResolvedValue({ items: [], total: 0, hasMore: false })
      const r = await tool('market_search_mods').execute({ query: 'sodium' }, CTX)
      expect(r.ok).toBe(true)
      expect(h.searchMods).toHaveBeenCalledWith(expect.objectContaining({ platform: 'modrinth' }), 'test-key')
    })

    it('搜索成功渲染列表并透传中文桥接提示', async () => {
      h.searchMods.mockResolvedValue({
        items: [makeDetail()],
        total: 1,
        hasMore: false,
        translatedTerms: [{ zh: '钠', en: 'Sodium', kind: 'alias' }]
      })
      const r = await tool('market_search_mods').execute({ platform: 'modrinth', query: '钠' }, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('Sodium')
      expect(r.text).toContain('钠→Sodium')
      expect(h.searchMods).toHaveBeenCalledWith(expect.objectContaining({ platform: 'modrinth', query: '钠' }), 'test-key')
    })

    it('网络异常软失败', async () => {
      h.searchMods.mockRejectedValue(new Error('HTTP 429'))
      const r = await tool('market_search_mods').execute({ platform: 'modrinth', query: 'x' }, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('HTTP 429')
    })
  })

  describe('market_mod_detail', () => {
    it('返回版本文件与兼容性', async () => {
      h.getModDetail.mockResolvedValue(makeDetail())
      const r = await tool('market_mod_detail').execute({ platform: 'modrinth', modId: '123' }, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('versionId=v1')
      expect(r.text).toContain('MC=1.20.1')
      expect(r.text).toContain('loader=fabric')
    })
  })

  describe('market_install_mod', () => {
    it('安装成功：回显文件兼容性并写来源记录', async () => {
      h.getModDetail.mockResolvedValue(makeDetail())
      h.installMod.mockResolvedValue({
        ok: true,
        installed: join(root, 'run/mods/sodium-fabric-0.5.0.jar'),
        fileName: 'sodium-fabric-0.5.0.jar',
        dependenciesInstalled: []
      })
      const r = await tool('market_install_mod').execute({ platform: 'modrinth', modId: '123' }, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('sodium-fabric-0.5.0.jar')
      expect(r.text).toContain('MC=1.20.1')
      expect(r.text).toContain('来源记录已写入')
      // provenance 由工具内创建并传入 installMod
      expect(h.installMod).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'modrinth', modId: '123', versionId: 'v1', projectPath: root, overwrite: false }),
        'test-key',
        undefined,
        expect.objectContaining({ record: expect.any(Function), flush: expect.any(Function) })
      )
    })

    it('冲突时返回提示并要求用户确认 overwrite', async () => {
      h.getModDetail.mockResolvedValue(makeDetail())
      h.installMod.mockResolvedValue({ ok: false, conflict: { existingFile: 'sodium-old.jar' }, error: '已存在同模组文件：sodium-old.jar' })
      const r = await tool('market_install_mod').execute({ platform: 'modrinth', modId: '123' }, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('overwrite=true')
    })

    it('无可安装文件时报错', async () => {
      h.getModDetail.mockResolvedValue({ ...makeDetail(), files: [] })
      const r = await tool('market_install_mod').execute({ platform: 'modrinth', modId: '123' }, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('没有可安装的版本文件')
    })
  })

  describe('market_list_installed', () => {
    it('空目录提示', async () => {
      const r = await tool('market_list_installed').execute({}, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('尚未安装')
    })

    it('聚合 jar 与来源记录', async () => {
      mkdirSync(join(root, 'run/mods'), { recursive: true })
      writeFileSync(join(root, 'run/mods/sodium.jar'), 'fake')
      writeFileSync(join(root, 'run/mods/manual.jar'), 'fake')
      const entry: ModSourceEntry = {
        fileName: 'sodium.jar',
        platform: 'modrinth',
        modId: '123',
        versionId: 'v1',
        slug: 'sodium',
        name: 'Sodium',
        versionNumber: '0.5.0',
        downloadUrl: 'https://cdn.example/sodium.jar',
        size: 4,
        installedAt: '2026-09-26T00:00:00Z'
      }
      writeSources(root, [entry])
      const r = await tool('market_list_installed').execute({}, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('sodium.jar ← modrinth/sodium@0.5.0')
      expect(r.text).toContain('manual.jar（无来源记录')
    })
  })
})
