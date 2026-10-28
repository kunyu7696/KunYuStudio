/**
 * migrationWorkflow 单测（P2-3）：
 * 纯函数改写（gradle.properties / wrapper）、preview 变更与风险清单、
 * 状态机转移约束（previewed→confirmed→applied→undone）、强制备份与回滚。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyMigration,
  confirmMigration,
  getMigration,
  listMigrations,
  previewMigration,
  undoMigration,
  updateGradleProperties,
  updateWrapperProperties
} from '../migrationWorkflow'
import { getToolchain, type FabricToolchain } from '../../../templates/loaderVersionMatrix'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'

let root: string

const FABRIC_PROPS_1201 = `# Fabric Properties
minecraft_version=1.20.1
yarn_mappings=1.20.1+build.10
loader_version=0.15.11

# Mod Properties
mod_version=1.0.0
maven_group=com.example
archives_base_name=testmod

# Dependencies
fabric_version=0.92.2+1.20.1
`

function makeProject(mcProps = FABRIC_PROPS_1201): void {
  mkdirSync(join(root, 'src/main/resources'), { recursive: true })
  writeFileSync(
    join(root, 'src/main/resources/fabric.mod.json'),
    JSON.stringify({ id: 'testmod', entrypoints: { main: ['com.example.TestMod'] } }),
    'utf-8'
  )
  writeFileSync(join(root, 'gradle.properties'), mcProps, 'utf-8')
  mkdirSync(join(root, 'gradle/wrapper'), { recursive: true })
  writeFileSync(
    join(root, 'gradle/wrapper/gradle-wrapper.properties'),
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip\n',
    'utf-8'
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-mig-'))
  registerProjectRoot(root)
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('updateGradleProperties（纯函数）', () => {
  it('原位替换保留注释与顺序；null 删除；缺失键追加到末尾标记段', () => {
    const { text, applied } = updateGradleProperties(
      FABRIC_PROPS_1201,
      { minecraft_version: '1.21.1', yarn_mappings: null, geckolib_version: '5.0.0' },
      'Migration test'
    )
    expect(text).toContain('# Fabric Properties')
    expect(text).toContain('minecraft_version=1.21.1')
    expect(text).not.toContain('yarn_mappings')
    expect(text).toContain('# Migration test')
    expect(text).toContain('geckolib_version=5.0.0')
    // 顺序：minecraft_version 仍在 loader_version 之前
    expect(text.indexOf('minecraft_version')).toBeLessThan(text.indexOf('loader_version'))
    expect(applied).toEqual([
      { key: 'minecraft_version', oldValue: '1.20.1', newValue: '1.21.1' },
      { key: 'yarn_mappings', oldValue: '1.20.1+build.10', newValue: null },
      { key: 'geckolib_version', oldValue: null, newValue: '5.0.0' }
    ])
  })
})

describe('updateWrapperProperties（纯函数）', () => {
  it('替换 distributionUrl 版本段', () => {
    const out = updateWrapperProperties(
      'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10.2-bin.zip\n',
      '8.14.3'
    )
    expect(out).toContain('gradle-8.14.3-bin.zip')
  })
  it('找不到版本段返回 null', () => {
    expect(updateWrapperProperties('distributionUrl=https\\://example.com/custom.zip', '8.14.3')).toBeNull()
  })
})

describe('previewMigration', () => {
  it('1.20.1 → 1.21.1：变更清单含版本键摘要，JDK 跳变给 warn，记录落盘', () => {
    makeProject()
    const tc = getToolchain('fabric', '1.21.1') as FabricToolchain
    expect(tc.mcVersion).toBe('1.21.1') // 矩阵必须真有该组合
    const rec = previewMigration(root, '1.21.1')
    expect(rec.state).toBe('previewed')
    expect(rec.loader).toBe('fabric')
    expect(rec.from.mcVersion).toBe('1.20.1')
    const propsChange = rec.changes.find((c) => c.relPath === 'gradle.properties')!
    expect(propsChange.summary.join('\n')).toContain('minecraft_version: 1.20.1 → 1.21.1')
    // loader_version 恰好同为 0.15.11（不变不出清单），改断 yarn/fabric 版本键
    expect(propsChange.summary.join('\n')).toContain(`yarn_mappings: 1.20.1+build.10 → ${tc.yarnVersion}`)
    expect(propsChange.summary.join('\n')).toContain(`fabric_version: 0.92.2+1.20.1 → ${tc.fabricVersion}`)
    // wrapper 版本不同则列入变更
    if (tc.gradleVersion !== '8.10.2') {
      expect(rec.changes.some((c) => c.relPath === 'gradle/wrapper/gradle-wrapper.properties')).toBe(true)
    }
    // JDK 17→21 应有提示
    expect(rec.risks.some((r) => r.level === 'warn' && r.message.includes('JDK'))).toBe(true)
    // 落盘可读且一致
    expect(getMigration(root, rec.id)?.state).toBe('previewed')
  })

  it('未知版本（9.9.9）→ block 风险，不产出变更', () => {
    makeProject()
    const rec = previewMigration(root, '9.9.9')
    expect(rec.risks.some((r) => r.level === 'block' && r.message.includes('9.9.9'))).toBe(true)
    expect(rec.changes).toHaveLength(0)
  })

  it('目标与当前相同 → block', () => {
    makeProject()
    const rec = previewMigration(root, '1.20.1')
    expect(rec.risks.some((r) => r.level === 'block' && r.message.includes('无需迁移'))).toBe(true)
  })

  it('跨映射体系（1.20.1 → 26.3）：yarn_mappings 删除 + 映射漂移 warn', () => {
    makeProject()
    const tc = getToolchain('fabric', '26.3') as FabricToolchain
    expect(tc.mcVersion).toBe('26.3')
    const rec = previewMigration(root, '26.3')
    const propsChange = rec.changes.find((c) => c.relPath === 'gradle.properties')!
    expect(propsChange.summary.join('\n')).toContain('yarn_mappings')
    expect(propsChange.summary.join('\n')).toContain('删除')
    expect(rec.risks.some((r) => r.level === 'warn' && r.message.includes('映射体系'))).toBe(true)
  })

  it('非模组项目（无描述文件）→ 抛错', () => {
    writeFileSync(join(root, 'gradle.properties'), FABRIC_PROPS_1201, 'utf-8')
    expect(() => previewMigration(root, '1.21.1')).toThrow(/模组描述文件/)
  })
})

describe('状态机转移约束', () => {
  it('含 block 风险拒绝 confirm', () => {
    makeProject()
    const rec = previewMigration(root, '9.9.9')
    expect(() => confirmMigration(root, rec.id)).toThrow(/阻断级风险/)
  })

  it('previewed → confirmed → applied → undone 正常流转，非法转移抛错', () => {
    makeProject()
    const rec = previewMigration(root, '1.21.1')
    // 未 confirm 不能 apply / undo
    expect(() => applyMigration(root, rec.id)).toThrow(/confirmed/)
    expect(() => undoMigration(root, rec.id)).toThrow(/applied/)

    confirmMigration(root, rec.id)
    expect(getMigration(root, rec.id)?.state).toBe('confirmed')
    // 重复 confirm 抛错
    expect(() => confirmMigration(root, rec.id)).toThrow(/previewed/)

    const applied = applyMigration(root, rec.id)
    expect(applied.state).toBe('applied')
    // 迁移后 gradle.properties 已更新
    const after = readFileSync(join(root, 'gradle.properties'), 'utf-8')
    expect(after).toContain('minecraft_version=1.21.1')
    expect(after).not.toContain('minecraft_version=1.20.1')
    // 强制备份存在且为旧内容
    const backup = readFileSync(join(root, '.kunyu/migrations', rec.id, 'backup/gradle.properties'), 'utf-8')
    expect(backup).toContain('minecraft_version=1.20.1')

    const undone = undoMigration(root, rec.id)
    expect(undone.state).toBe('undone')
    // 回滚后文件还原
    expect(readFileSync(join(root, 'gradle.properties'), 'utf-8')).toBe(FABRIC_PROPS_1201)
    // undone 后不能再 undo / apply
    expect(() => undoMigration(root, rec.id)).toThrow(/applied/)
    expect(() => applyMigration(root, rec.id)).toThrow(/confirmed/)
  })

  it('跨映射迁移 apply：yarn_mappings 行被删除', () => {
    makeProject()
    const rec = previewMigration(root, '26.3')
    confirmMigration(root, rec.id)
    applyMigration(root, rec.id)
    const after = readFileSync(join(root, 'gradle.properties'), 'utf-8')
    expect(after).toContain('minecraft_version=26.3')
    expect(after).not.toContain('yarn_mappings')
    // undo 还原含 yarn_mappings 的旧文件
    undoMigration(root, rec.id)
    expect(readFileSync(join(root, 'gradle.properties'), 'utf-8')).toContain('yarn_mappings=1.20.1+build.10')
  })

  it('wrapper 变更随迁移改写并可回滚', () => {
    makeProject()
    const tc = getToolchain('fabric', '1.21.1') as FabricToolchain
    const rec = previewMigration(root, '1.21.1')
    if (!rec.changes.some((c) => c.relPath.includes('gradle-wrapper'))) return // 同版本 Gradle 时跳过
    confirmMigration(root, rec.id)
    applyMigration(root, rec.id)
    const wrapperAfter = readFileSync(join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'utf-8')
    expect(wrapperAfter).toContain(`gradle-${tc.gradleVersion}-bin.zip`)
    undoMigration(root, rec.id)
    expect(readFileSync(join(root, 'gradle/wrapper/gradle-wrapper.properties'), 'utf-8')).toContain('gradle-8.10.2-bin.zip')
  })
})

describe('listMigrations', () => {
  it('多条记录按创建时间倒序；坏文件跳过', () => {
    makeProject()
    const a = previewMigration(root, '1.21.1')
    const b = previewMigration(root, '26.3')
    // 人为制造时间差（createdAt 字段参与排序）
    a.createdAt = '2026-01-01T00:00:00.000Z'
    writeFileSync(join(root, '.kunyu/migrations', `${a.id}.json`), JSON.stringify(a, null, 2), 'utf-8')
    writeFileSync(join(root, '.kunyu/migrations', 'broken.json'), '{oops', 'utf-8')
    const list = listMigrations(root)
    expect(list.map((r) => r.id)).toEqual([b.id, a.id])
  })

  it('空项目返回空数组', () => {
    expect(listMigrations(root)).toEqual([])
    expect(existsSync(join(root, '.kunyu/migrations'))).toBe(false)
  })
})
