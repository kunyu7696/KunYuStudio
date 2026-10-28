/**
 * 特性⑤ CI 导出服务单测。
 *
 * 覆盖：getCiConfig/setCiConfig 读写、exportCiWorkflows 落盘、
 * regenerateWorkflows 从 config 重新生成、previewWorkflows 不写盘。
 *
 * 注意：ciExportService 依赖 fsService.assertWithinRoot（项目根注册），
 * 测试中先 registerProjectRoot 再操作。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  exportCiWorkflows,
  getCiConfig,
  previewWorkflows,
  regenerateWorkflows,
  setCiConfig
} from '../ciExportService'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import { createDefaultCiConfig } from '../../../../shared/types/ci'
import type { CiProjectMeta } from '../buildGradleForLoader'

function makeMeta(overrides: Partial<CiProjectMeta> = {}): CiProjectMeta {
  return {
    modId: 'mymod',
    modName: 'My Mod',
    version: '1.0.0',
    packageName: 'com.kunyu.mymod',
    mcVersion: '1.20.1',
    ...overrides
  }
}

describe('getCiConfig / setCiConfig', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-ci-cfg-'))
    registerProjectRoot(root)
  })
  afterAll(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('缺失 config → null', () => {
    expect(getCiConfig(root)).toBeNull()
  })

  it('写 → 读 回环', () => {
    const config = createDefaultCiConfig('fabric')
    setCiConfig(root, config)
    const loaded = getCiConfig(root)
    expect(loaded).not.toBeNull()
    expect(loaded!.workflows.build).toBe(true)
    expect(loaded!.workflows.release).toBe(false)
    expect(loaded!.matrix.loaders).toEqual(['fabric'])
  })

  it('带 BOM 的 config 文件能正确 parse', () => {
    const configPath = join(root, '.kunyu', 'ci-config.json')
    const { writeFileSync } = require('node:fs')
    // 写一个带 BOM 的 JSON
    const json = JSON.stringify(createDefaultCiConfig('forge'))
    writeFileSync(configPath, '\uFEFF' + json, 'utf8')
    const loaded = getCiConfig(root)
    expect(loaded).not.toBeNull()
    expect(loaded!.matrix.loaders).toEqual(['forge'])
  })

  it('坏 JSON → null', () => {
    const configPath = join(root, '.kunyu', 'ci-config.json')
    const { writeFileSync } = require('node:fs')
    writeFileSync(configPath, 'not json {{{', 'utf8')
    expect(getCiConfig(root)).toBeNull()
  })
})

describe('exportCiWorkflows', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-ci-export-'))
    registerProjectRoot(root)
  })
  afterAll(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('默认 config（build+gametest）→ 写 2 个 yml + 1 组 build.gradle', () => {
    const config = createDefaultCiConfig('fabric')
    const meta = makeMeta()
    const result = exportCiWorkflows(root, config, meta)
    expect(result.ok).toBe(true)
    expect(result.workflows).toContain('.github/workflows/build.yml')
    expect(result.workflows).toContain('.github/workflows/gametest.yml')
    expect(result.workflows).not.toContain('.github/workflows/release.yml')
    expect(result.buildScripts).toContain('.kunyu/ci/build-fabric.gradle')
    expect(result.buildScripts).toContain('.kunyu/ci/gradle-fabric.properties')

    // 文件确实存在
    expect(existsSync(join(root, '.github/workflows/build.yml'))).toBe(true)
    expect(existsSync(join(root, '.github/workflows/gametest.yml'))).toBe(true)
    expect(existsSync(join(root, '.kunyu/ci/build-fabric.gradle'))).toBe(true)
  })

  it('三加载器矩阵 → 写 3 组 build.gradle', () => {
    const config = createDefaultCiConfig('fabric')
    config.matrix.loaders = ['fabric', 'forge', 'neoforge']
    const result = exportCiWorkflows(root, config, makeMeta())
    expect(result.ok).toBe(true)
    expect(result.buildScripts).toContain('.kunyu/ci/build-fabric.gradle')
    expect(result.buildScripts).toContain('.kunyu/ci/build-forge.gradle')
    expect(result.buildScripts).toContain('.kunyu/ci/build-neoforge.gradle')
    expect(existsSync(join(root, '.kunyu/ci/build-forge.gradle'))).toBe(true)
    expect(existsSync(join(root, '.kunyu/ci/build-neoforge.gradle'))).toBe(true)
  })

  it('release 开启 → 写 release.yml', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    config.publish.githubRelease = true
    const result = exportCiWorkflows(root, config, makeMeta())
    expect(result.workflows).toContain('.github/workflows/release.yml')
    const yml = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
    expect(yml).toContain('environment: release')
    expect(yml).toContain('workflow_dispatch')
  })

  it('build 关闭 → 不写 build.yml', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.build = false
    const result = exportCiWorkflows(root, config, makeMeta())
    expect(result.workflows).not.toContain('.github/workflows/build.yml')
    expect(result.buildScripts).toHaveLength(0)
  })
})

describe('regenerateWorkflows', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-ci-regen-'))
    registerProjectRoot(root)
  })
  afterAll(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('无 config → 返回 error', () => {
    const result = regenerateWorkflows(root, makeMeta())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('配置文件缺失')
  })

  it('有 config → 重新生成', () => {
    const config = createDefaultCiConfig('fabric')
    setCiConfig(root, config)
    const result = regenerateWorkflows(root, makeMeta())
    expect(result.ok).toBe(true)
    expect(result.workflows.length).toBeGreaterThan(0)
  })
})

describe('previewWorkflows (不写盘)', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-ci-prev-'))
    registerProjectRoot(root)
  })
  afterAll(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('返回 YAML 字符串但不写文件', () => {
    const config = createDefaultCiConfig('fabric')
    const preview = previewWorkflows(root, config, makeMeta())
    expect(preview.build).toBeDefined()
    expect(preview.gametest).toBeDefined()
    // 不写盘
    expect(existsSync(join(root, '.github/workflows/build.yml'))).toBe(false)
  })
})
