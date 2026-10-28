/**
 * packMigrationWorkflow 单测（P3-2）：整合包版本迁移状态机。
 * 真实 tmpdir：pack.toml / manifest.json / modrinth.index.json / .kunyu/modpack.json 夹具。
 * 覆盖：preview 三态风险、confirm 门禁、apply 备份+写盘、undo 整量恢复、
 * 目标版本矩阵校验、纯函数改写（pack.toml 文本级 / 双清单 JSON 级）。
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPackToml } from '../../modpack/packTomlIo'
import { writeSources } from '../../modpack/provenance'
import {
  applyPackMigration,
  confirmPackMigration,
  getPackMigration,
  previewPackMigration,
  undoPackMigration,
  updateCfManifestMc,
  updateMrIndexMc,
  updatePackTomlVersions
} from '../packMigrationWorkflow'

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-pmig-'))
}

/** 造一个整合包项目骨架：pack.toml + 双清单 */
function seedPack(root: string, mc = '1.20.1', loader: 'fabric' | 'forge' = 'fabric', loaderVersion = '0.15.11'): void {
  writeFileSync(join(root, 'pack.toml'), buildPackToml({ name: '测试包', mcVersion: mc, loader, loaderVersion }), 'utf-8')
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({ manifestType: 'minecraftModpack', manifestVersion: 1, name: '测试包', version: '1.0.0', minecraft: { version: mc, modLoaders: [{ id: `${loader}-${loaderVersion}`, primary: true }] }, files: [] }, null, 2),
    'utf-8'
  )
  writeFileSync(
    join(root, 'modrinth.index.json'),
    JSON.stringify({ formatVersion: 1, game: 'minecraft', name: '测试包', versionId: '1.0.0', dependencies: { minecraft: mc, 'fabric-loader': loaderVersion }, files: [] }, null, 2),
    'utf-8'
  )
}

describe('previewPackMigration', () => {
  it('正常 preview：变更清单 + 无 block', () => {
    const root = tmpProject()
    seedPack(root)
    const rec = previewPackMigration(root, '1.21.4')
    expect(rec.state).toBe('previewed')
    expect(rec.kind).toBe('modpack')
    expect(rec.loader).toBe('fabric')
    expect(rec.from.mcVersion).toBe('1.20.1')
    expect(rec.to.mcVersion).toBe('1.21.4')
    expect(rec.risks.find((r) => r.level === 'block')).toBeUndefined()
    // pack.toml + manifest.json + modrinth.index.json 三个变更
    const paths = rec.changes.map((c) => c.relPath).sort()
    expect(paths).toEqual(['manifest.json', 'modrinth.index.json', 'pack.toml'])
    // pack.toml 变更摘要含 minecraft 与 fabric-loader
    const packChange = rec.changes.find((c) => c.relPath === 'pack.toml')!
    expect(packChange.summary.join('\n')).toContain('minecraft: 1.20.1 → 1.21.4')
    expect(packChange.summary.join('\n')).toContain('fabric-loader')
    // 记录已落盘
    expect(getPackMigration(root, rec.id)?.id).toBe(rec.id)
  })

  it('目标版本不在矩阵 → block', () => {
    const root = tmpProject()
    seedPack(root)
    const rec = previewPackMigration(root, '9.9.9')
    expect(rec.risks.some((r) => r.level === 'block' && r.message.includes('9.9.9'))).toBe(true)
  })

  it('目标与当前相同 → block', () => {
    const root = tmpProject()
    seedPack(root)
    const rec = previewPackMigration(root, '1.20.1')
    expect(rec.risks.some((r) => r.level === 'block' && r.message.includes('无需迁移'))).toBe(true)
  })

  it('缺 pack.toml → block', () => {
    const root = tmpProject()
    const rec = previewPackMigration(root, '1.21.1')
    expect(rec.risks.some((r) => r.level === 'block' && r.message.includes('pack.toml'))).toBe(true)
  })

  it('pack.toml 损坏 → block', () => {
    const root = tmpProject()
    writeFileSync(join(root, 'pack.toml'), 'not = [valid toml', 'utf-8')
    const rec = previewPackMigration(root, '1.21.1')
    expect(rec.risks.some((r) => r.level === 'block' && r.message.includes('解析失败'))).toBe(true)
  })

  it('有平台来源模组时生成人工核对 warn；本地模组单独 warn', () => {
    const root = tmpProject()
    seedPack(root)
    writeSources(root, [
      { fileName: 'a.jar', platform: 'modrinth', modId: 'A', versionId: 'v1', slug: 'sodium', name: 'Sodium', versionNumber: '1.0', downloadUrl: 'https://x', size: 1, installedAt: '2026-01-01T00:00:00Z' },
      { fileName: 'b.jar', platform: 'local', modId: '', versionId: '', slug: '', name: '本地', versionNumber: '1.0', downloadUrl: null, size: 1, installedAt: '2026-01-01T00:00:00Z' }
    ])
    const rec = previewPackMigration(root, '1.21.1')
    expect(rec.risks.some((r) => r.level === 'warn' && r.message.includes('sodium') && r.message.includes('核对'))).toBe(true)
    expect(rec.risks.some((r) => r.level === 'warn' && r.message.includes('本地手工放入'))).toBe(true)
  })
})

describe('confirm / apply / undo 状态机', () => {
  it('previewed → confirmed → applied → undone 全链路', () => {
    const root = tmpProject()
    seedPack(root)
    const rec = previewPackMigration(root, '1.21.4')
    const confirmed = confirmPackMigration(root, rec.id)
    expect(confirmed.state).toBe('confirmed')
    const applied = applyPackMigration(root, rec.id)
    expect(applied.state).toBe('applied')
    // pack.toml 已改写
    const pack = readFileSync(join(root, 'pack.toml'), 'utf-8')
    expect(pack).toContain('minecraft = "1.21.4"')
    expect(pack).toContain('fabric-loader = "0.16.14"')
    // manifest 已改写
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as { minecraft: { version: string; modLoaders: Array<{ id: string }> } }
    expect(manifest.minecraft.version).toBe('1.21.4')
    expect(manifest.minecraft.modLoaders[0]!.id).toBe('fabric-0.16.14')
    // modrinth index 已改写
    const mr = JSON.parse(readFileSync(join(root, 'modrinth.index.json'), 'utf-8')) as { dependencies: Record<string, string> }
    expect(mr.dependencies['minecraft']).toBe('1.21.4')
    expect(mr.dependencies['fabric-loader']).toBe('0.16.14')
    // 备份存在
    expect(existsSync(join(applied.backupDir!, 'pack.toml'))).toBe(true)
    // undo 恢复
    const undone = undoPackMigration(root, rec.id)
    expect(undone.state).toBe('undone')
    expect(readFileSync(join(root, 'pack.toml'), 'utf-8')).toContain('minecraft = "1.20.1"')
    const manifestBack = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8')) as { minecraft: { version: string } }
    expect(manifestBack.minecraft.version).toBe('1.20.1')
  })

  it('含 block 风险时 confirm 拒绝', () => {
    const root = tmpProject()
    seedPack(root)
    const rec = previewPackMigration(root, '9.9.9')
    expect(() => confirmPackMigration(root, rec.id)).toThrow('阻断级风险')
  })

  it('非 previewed 状态不能 confirm；非 confirmed 不能 apply', () => {
    const root = tmpProject()
    seedPack(root)
    const rec = previewPackMigration(root, '1.21.1')
    expect(() => applyPackMigration(root, rec.id)).toThrow('只有 confirmed 状态可以执行')
    confirmPackMigration(root, rec.id)
    expect(() => confirmPackMigration(root, rec.id)).toThrow('只有 previewed 状态可以确认')
  })

  it('非 applied 状态不能 undo', () => {
    const root = tmpProject()
    seedPack(root)
    const rec = previewPackMigration(root, '1.21.1')
    expect(() => undoPackMigration(root, rec.id)).toThrow('只有 applied 状态可以回滚')
  })

  it('双清单缺失时跳过并给 info', () => {
    const root = tmpProject()
    writeFileSync(join(root, 'pack.toml'), buildPackToml({ name: '裸包', mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' }), 'utf-8')
    const rec = previewPackMigration(root, '1.21.1')
    expect(rec.changes.map((c) => c.relPath)).toEqual(['pack.toml'])
    expect(rec.risks.filter((r) => r.level === 'info' && r.message.includes('跳过')).length).toBe(2)
  })
})

describe('纯函数改写', () => {
  it('updatePackTomlVersions：原位替换 + 保留注释与段结构', () => {
    const text = [
      'name = "测试包"',
      'author = "kunyu"',
      '',
      '[versions]',
      '# 这是注释',
      'minecraft = "1.20.1"',
      'fabric-loader = "0.15.11"',
      ''
    ].join('\n')
    const { text: out, applied } = updatePackTomlVersions(text, { minecraft: '1.21.1', 'fabric-loader': '0.16.14' })
    expect(out).toContain('# 这是注释')
    expect(out).toContain('minecraft = "1.21.1"')
    expect(out).toContain('fabric-loader = "0.16.14"')
    expect(out).not.toContain('1.20.1')
    expect(applied).toContainEqual({ key: 'minecraft', oldValue: '1.20.1', newValue: '1.21.1' })
    expect(applied).toContainEqual({ key: 'fabric-loader', oldValue: '0.15.11', newValue: '0.16.14' })
  })

  it('updatePackTomlVersions：缺失键追加到 versions 段尾', () => {
    const text = 'name = "x"\n\n[versions]\nminecraft = "1.20.1"\n'
    const { text: out } = updatePackTomlVersions(text, { minecraft: '1.21.1', neoforge: '21.1.0' })
    expect(out).toContain('minecraft = "1.21.1"')
    expect(out).toContain('neoforge = "21.1.0"')
    // 追加位置在 versions 段内
    expect(out.indexOf('neoforge')).toBeGreaterThan(out.indexOf('[versions]'))
  })

  it('updateCfManifestMc：重写 minecraft.version 与 modLoaders，保留其他字段', () => {
    const src = JSON.stringify({ manifestType: 'minecraftModpack', name: 'x', minecraft: { version: '1.20.1', modLoaders: [{ id: 'fabric-0.15.11', primary: true }] }, files: [{ projectID: 1 }] })
    const out = updateCfManifestMc(src, '1.21.1', 'fabric', '0.16.14')!
    const doc = JSON.parse(out) as { name: string; minecraft: { version: string; modLoaders: Array<{ id: string }> }; files: unknown[] }
    expect(doc.name).toBe('x')
    expect(doc.minecraft.version).toBe('1.21.1')
    expect(doc.minecraft.modLoaders[0]!.id).toBe('fabric-0.16.14')
    expect(doc.files).toHaveLength(1)
  })

  it('updateCfManifestMc：坏 JSON 返回 null', () => {
    expect(updateCfManifestMc('not json', '1.21.1', 'fabric', '0.16.14')).toBeNull()
  })

  it('updateMrIndexMc：重写 dependencies，旧加载器键清除', () => {
    const src = JSON.stringify({ dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.15.11', forge: '47.2.0' } })
    const out = updateMrIndexMc(src, '1.21.1', 'fabric', '0.16.14')!
    const doc = JSON.parse(out) as { dependencies: Record<string, string> }
    expect(doc.dependencies['minecraft']).toBe('1.21.1')
    expect(doc.dependencies['fabric-loader']).toBe('0.16.14')
    expect(doc.dependencies['forge']).toBeUndefined()
  })

  it('updateMrIndexMc：坏 JSON 返回 null', () => {
    expect(updateMrIndexMc('{bad', '1.21.1', 'fabric', '0.16.14')).toBeNull()
  })
})
