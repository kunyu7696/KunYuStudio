/**
 * 参考包检索门禁（Phase 1）：
 * build=pending 的迁移稿默认不进入检索结果；只有显式 includeCandidates 才返回，
 * 且必须带 [未验证] 前缀、排在事实模板之后。历史脏值（build="unverified"、
 * verified=false 布尔）一律按未验证处理。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { createContextBuilder } from '../contextBuilder'
import { createReferenceService, isFactStatus } from '../referencePackageService'

let dir: string
let overlayPath: string

const PASS_ID = 'fabric-1.20.1-block-simple_block.java'
const PENDING_ID = 'fabric-1.20.1-block-copy_block.java'
const DIRTY_ID = 'fabric-1.20.1-block-legacy_block.java'

function makeTemplate(
  id: string,
  filename: string,
  over: Record<string, unknown>
): Record<string, unknown> {
  return {
    id,
    loader: 'fabric',
    version: '1.20.1',
    type: 'block',
    file: `templates/fabric/1.20.1/block/${filename}`,
    filename,
    contentTypes: ['block'],
    keywords: ['方块', 'block'],
    appliesTo: { loaders: ['fabric'], mcVersions: ['1.20.1'] },
    verified: null,
    verifiedAt: null,
    build: 'pending',
    active: true,
    provenance: 'translated-from-fabric-1.20.1',
    ...over
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ky-ref-gate-'))
  overlayPath = join(dir, 'overlay.json')
  const blockDir = join(dir, 'templates', 'fabric', '1.20.1', 'block')
  mkdirSync(blockDir, { recursive: true })
  writeFileSync(join(blockDir, 'simple_block.java'), 'public class SimpleBlock {}\n', 'utf-8')
  writeFileSync(join(blockDir, 'copy_block.java'), 'public class CopyBlock {}\n', 'utf-8')
  writeFileSync(join(blockDir, 'legacy_block.java'), 'public class LegacyBlock {}\n', 'utf-8')

  const manifest = {
    manifestVersion: 'test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    description: 'fixture',
    scopeControl: {
      m7ActiveVersions: [{ loader: 'fabric', version: '1.20.1' }],
      registeredButInactive: [],
      rule: ''
    },
    mappingTypes: {
      fabric: { type: 'yarn', identifierClass: 'Identifier', registryClass: 'Registries', description: '' },
      forge: { type: 'mojang_official', identifierClass: 'ResourceLocation', registryClass: 'ForgeRegistries', description: '' },
      neoforge: { type: 'mojang_official', identifierClass: 'ResourceLocation', registryClass: 'ForgeRegistries', description: '' }
    },
    versionFingerprints: [
      {
        id: 'fabric-1.20.1',
        loader: 'fabric',
        mcVersion: '1.20.1',
        loaderVersion: '0.15.7',
        mapping: 'yarn',
        jdk: 17,
        health: 'unknown',
        verifiedAt: null,
        driftRisk: 'low',
        note: ''
      }
    ],
    templates: [
      makeTemplate(PASS_ID, 'simple_block.java', { build: 'pass', provenance: 'mdk-adapted' }),
      makeTemplate(PENDING_ID, 'copy_block.java', {}),
      // 历史脏值：build 不在枚举内 + verified 为布尔 false
      makeTemplate(DIRTY_ID, 'legacy_block.java', {
        build: 'unverified',
        verified: false,
        provenance: 'rewritten-for-1.20.1-unverified-build'
      })
    ],
    errorPatterns: [],
    apiIndex: [],
    stats: {
      templateCount: 3,
      activeTemplateCount: 3,
      inactiveComboCount: 0,
      inactiveRegisteredTemplateCount: 0,
      errorPatternCount: 0,
      apiIndexCount: 0,
      contentTypes: 12,
      provenance: { 'mdk-adapted': 1, 'translated-from-fabric-1.20.1': 1 },
      vendorClaims: {
        document: '',
        claimedTemplateFiles: 0,
        claimedActiveTemplates: 0,
        claimedInactiveTemplates: 0,
        claimedErrorPatterns: 0,
        claimedApiIndex: 0,
        note: ''
      }
    }
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('isFactStatus', () => {
  it('只有 pass / 已签字 / 非空版本串算事实', () => {
    expect(isFactStatus('pass', null)).toBe(true)
    expect(isFactStatus('pending', '1.20.1')).toBe(true)
    expect(isFactStatus('pending', null)).toBe(false)
    expect(isFactStatus('unverified', false)).toBe(false)
    expect(isFactStatus('pending', '')).toBe(false)
  })
})

describe('ReferenceService.listTemplates 门禁', () => {
  it('默认只返回事实模板，pending 迁移稿不进入检索池', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    const list = svc.listTemplates('fabric', '1.20.1')
    expect(list.map((t) => t.id)).toEqual([PASS_ID])
  })

  it('includeCandidates 才把 pending 稿带出来（脏值仍按未验证处理）', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    const list = svc.listTemplates('fabric', '1.20.1', undefined, { includeCandidates: true })
    expect(list.map((t) => t.id)).toContain(PENDING_ID)
    // build="unverified" / verified=false：不是事实，但作为候选可见
    expect(list.map((t) => t.id)).toContain(DIRTY_ID)
  })

  it('overlay 回写 pass 后，默认视图立刻把它当事实', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    svc.recordProbeResult({
      comboId: 'fabric-1.20.1',
      health: 'green',
      verifiedAt: '2026-01-02T00:00:00.000Z',
      templates: [{ id: PENDING_ID, build: 'pass', verified: '1.20.1' }]
    })
    const list = svc.listTemplates('fabric', '1.20.1')
    expect(list.map((t) => t.id)).toContain(PENDING_ID)
  })
})

describe('ContextBuilder.getTemplateContents 候选标注', () => {
  it('默认不注入 pending 稿', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    const cb = createContextBuilder(svc)
    const got = cb.getTemplateContents('fabric', '1.20.1', ['block'], '方块')
    expect(got.map((t) => t.id)).toEqual([PASS_ID])
    expect(got[0]?.candidate).toBe(false)
  })

  it('includeCandidates 时候选稿带 [未验证] 前缀且排在事实模板之后', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    const cb = createContextBuilder(svc)
    const got = cb.getTemplateContents('fabric', '1.20.1', ['block'], '方块', {
      includeCandidates: true
    })
    expect(got).toHaveLength(3)
    expect(got[0]?.id).toBe(PASS_ID)
    expect(got[0]?.candidate).toBe(false)
    const candidates = got.slice(1)
    expect(candidates.every((t) => t.candidate)).toBe(true)
    expect(candidates.every((t) => t.content.startsWith('[未验证'))).toBe(true)
    expect(candidates[0]?.content).toContain('复制自 fabric 1.20.1')
  })
})
