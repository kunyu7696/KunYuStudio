/**
 * 参考包检索门禁（Phase 1 + 字段拆分）：
 * 无槽位级编译证据的模板默认不进入检索结果；只有显式 includeCandidates 才返回，
 * 且必须带 [未验证] 前缀、排在事实模板之后。组合层 build=pass / verified 签字
 * 是「工具链健康」的借来绿灯，不作事实依据；历史脏值（build="unverified"、
 * verified=false 布尔）一律按未验证处理。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  it('只有槽位级 compiled 证据算事实；skipped/pending/无记录都不是', () => {
    expect(isFactStatus({ state: 'compiled', at: '2026-01-01T00:00:00.000Z' })).toBe(true)
    expect(isFactStatus({ state: 'failed', at: '2026-01-01T00:00:00.000Z' })).toBe(false)
    expect(isFactStatus({ state: 'skipped', at: '2026-01-01T00:00:00.000Z' })).toBe(false)
    expect(isFactStatus({ state: 'pending', at: '2026-01-01T00:00:00.000Z' })).toBe(false)
    expect(isFactStatus(undefined)).toBe(false)
    expect(isFactStatus(null)).toBe(false)
  })
})

describe('ReferenceService.listTemplates 门禁', () => {
  it('组合级 build=pass 不再算事实：无槽位证据时默认检索池为空', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    // PASS_ID 在 manifest 里是 build=pass（借来的绿灯），但没有槽位级证据
    expect(svc.listTemplates('fabric', '1.20.1')).toEqual([])
  })

  it('recordSlotEvidences 回写 compiled 后，默认视图立刻把它当事实', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    svc.recordSlotEvidences({
      at: '2026-01-02T00:00:00.000Z',
      evidences: [{ id: PASS_ID, evidence: { state: 'compiled', at: '2026-01-02T00:00:00.000Z' } }]
    })
    expect(svc.listTemplates('fabric', '1.20.1').map((t) => t.id)).toEqual([PASS_ID])
  })

  it('组合级探针盖章（templates build=pass）不再放行任何模板', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    svc.recordProbeResult({
      comboId: 'fabric-1.20.1',
      health: 'green',
      verifiedAt: '2026-01-02T00:00:00.000Z',
      templates: [{ id: PENDING_ID, build: 'pass', verified: '1.20.1' }],
      coveredByGate: []
    })
    expect(svc.listTemplates('fabric', '1.20.1')).toEqual([])
  })

  it('failed/skipped 证据不放行；includeCandidates 才把无证据稿带出来', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    svc.recordSlotEvidences({
      at: '2026-01-02T00:00:00.000Z',
      evidences: [
        { id: PENDING_ID, evidence: { state: 'failed', at: '2026-01-02T00:00:00.000Z' } },
        { id: DIRTY_ID, evidence: { state: 'skipped', at: '2026-01-02T00:00:00.000Z' } }
      ]
    })
    expect(svc.listTemplates('fabric', '1.20.1')).toEqual([])
    const list = svc.listTemplates('fabric', '1.20.1', undefined, { includeCandidates: true })
    expect(list.map((t) => t.id)).toContain(PENDING_ID)
    expect(list.map((t) => t.id)).toContain(DIRTY_ID)
  })
})

describe('启动时基线合并（单一事实源）', () => {
  it('manifest 导出快照比 overlay 新：启动即采纳灯色与矩阵统计', () => {
    const manifestPath = join(dir, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    manifest.versionFingerprints[0] = {
      ...manifest.versionFingerprints[0],
      health: 'green',
      verifiedAt: '2026-11-09T07:22:35.604Z',
      matrixHealth: {
        templateCount: 5,
        verifiedCount: 5,
        passRate: 100,
        lastVerifiedAt: '2026-11-09T07:22:35.604Z'
      }
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8')
    writeFileSync(
      overlayPath,
      JSON.stringify({
        version: 1,
        templates: {},
        combos: {
          'fabric-1.20.1': {
            health: 'yellow',
            verifiedAt: '2026-11-08T00:00:00.000Z',
            matrixHealth: {
              templateCount: 3,
              verifiedCount: 1,
              passRate: 33,
              lastVerifiedAt: '2026-11-08T00:00:00.000Z'
            }
          }
        }
      }),
      'utf-8'
    )

    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    // 无需手动 reloadBaseline：服务创建时已把更新的导出基线并入 overlay
    expect(svc.getComboHealth('fabric-1.20.1')).toBe('green')
    const cell = svc.listMatrixCells().find((c) => c.id === 'fabric-1.20.1')
    expect(cell?.matrixHealth?.passRate).toBe(100)
    expect(cell?.verifiedAt).toBe('2026-11-09T07:22:35.604Z')
  })
})

describe('ContextBuilder.getTemplateContents 候选标注', () => {
  const compilePass = (svc: ReturnType<typeof createReferenceService>): void =>
    svc.recordSlotEvidences({
      at: '2026-01-02T00:00:00.000Z',
      evidences: [{ id: PASS_ID, evidence: { state: 'compiled', at: '2026-01-02T00:00:00.000Z' } }]
    })

  it('无槽位证据时默认不注入任何稿（含 manifest build=pass 的历史绿灯）', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    const cb = createContextBuilder(svc)
    expect(cb.getTemplateContents('fabric', '1.20.1', ['block'], '方块')).toEqual([])
  })

  it('compiled 证据回写后默认注入事实稿', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    compilePass(svc)
    const cb = createContextBuilder(svc)
    const got = cb.getTemplateContents('fabric', '1.20.1', ['block'], '方块')
    expect(got.map((t) => t.id)).toEqual([PASS_ID])
    expect(got[0]?.candidate).toBe(false)
  })

  it('includeCandidates 时候选稿带 [未验证] 前缀且排在事实模板之后', () => {
    const svc = createReferenceService({ referenceDir: dir, overlayPath })
    compilePass(svc)
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
