/**
 * 实体域 grounding 校验（P0：Fabric 1.20.1 自由代码路线）。
 *
 * 用真 manifest 跑 loadManifestFromDir 全量结构校验（stats 计数/模板文件存在/
 * 组合指纹交叉核对，任一不符直接抛错），再抽样断言：
 * 1. apiIndex 实体域 51 条（API_ENT_001..051）全部 yarn/fabric/1.20.1
 * 2. 关键条目：API_ENT_009（Goal.canStart）/API_ENT_024（Inventory.removeStack）/API_ENT_041（SpawnEggItem 构造）
 * 3. entity_error 12 条（ERR_ENT_001..012）pattern 均可被 new RegExp 编译
 * 4. freeform 模板 5 件登记齐全、active、provenance=hand-curated
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '' } }))

import { devReferenceDir, loadManifestFromDir } from '../referencePackageService'

// 模块级加载：manifest 损坏/计数不符时整个 spec 文件直接失败（硬闸门，不带病工作）
const manifest = loadManifestFromDir(devReferenceDir())

describe('ai-reference 实体域 grounding（fabric/1.20.1 freeform）', () => {
  it('真 manifest 通过全量结构校验（stats 与实物一致）', () => {
    // loadManifestFromDir 内部已抛错式交叉校验，这里显式复核关键计数
    expect(manifest.stats.templateCount).toBe(manifest.templates.length)
    expect(manifest.stats.errorPatternCount).toBe(manifest.errorPatterns.length)
    expect(manifest.stats.apiIndexCount).toBe(manifest.apiIndex.length)
  })

  it('apiIndex 实体域 51 条全部 yarn/fabric/1.20.1', () => {
    const ent = manifest.apiIndex.filter((e) => e.id.startsWith('API_ENT_'))
    expect(ent).toHaveLength(51)
    for (const e of ent) {
      expect(e.mapping, e.id).toBe('yarn')
      expect(e.loaders, e.id).toContain('fabric')
      expect(e.mcVersions, e.id).toContain('1.20.1')
      expect(e.signature.trim().length, e.id).toBeGreaterThan(0)
    }
  })

  it.each([
    ['API_ENT_009', 'net.minecraft.entity.ai.goal.Goal', 'canStart'],
    ['API_ENT_024', 'net.minecraft.inventory.Inventory', 'removeStack'],
    ['API_ENT_041', 'net.minecraft.item.SpawnEggItem', '<init>']
  ])('抽样 %s 存在且 classPath/member 正确', (id, classPath, member) => {
    const e = manifest.apiIndex.find((x) => x.id === id)
    expect(e, id).toBeDefined()
    expect(e!.classPath).toBe(classPath)
    expect(e!.member).toBe(member)
    expect(e!.mapping).toBe('yarn')
    expect(e!.mcVersions).toContain('1.20.1')
    expect(e!.loaders).toContain('fabric')
  })

  it('ERR_ENT_001..012 全部存在：category=entity_error 且 pattern 可编译', () => {
    for (let i = 1; i <= 12; i++) {
      const id = `ERR_ENT_${String(i).padStart(3, '0')}`
      const p = manifest.errorPatterns.find((x) => x.id === id)
      expect(p, id).toBeDefined()
      expect(p!.category, id).toBe('entity_error')
      expect(() => new RegExp(p!.pattern), id).not.toThrow()
      expect(p!.mcVersions, id).toContain('1.20.1')
      expect(p!.loaders, id).toContain('fabric')
      expect(p!.solution.trim().length, id).toBeGreaterThan(0)
    }
  })

  it('freeform 模板 5 件登记齐全：active 且 provenance=hand-curated', () => {
    const ids = [
      'fabric-1.20.1-entity-freeform-custom_goal_container_interaction.java',
      'fabric-1.20.1-entity-freeform-custom_goal_stateful_behavior.java',
      'fabric-1.20.1-entity-freeform-biped_model_extra_cube.java',
      'fabric-1.20.1-entity-freeform-entity_renderer_client_reg.java',
      'fabric-1.20.1-entity-freeform-spawn_egg_natural_spawn.java'
    ]
    for (const id of ids) {
      const t = manifest.templates.find((x) => x.id === id)
      expect(t, id).toBeDefined()
      expect(t!.active, id).toBe(true)
      expect(t!.loader, id).toBe('fabric')
      expect(t!.version, id).toBe('1.20.1')
      expect(t!.type, id).toBe('entity')
      expect(t!.provenance, id).toBe('hand-curated')
    }
    // stats.provenance 计数同步（loadManifestFromDir 不校验此项，显式复核）：
    // 7 = 上述 5 件 freeform + forge/neoforge 各 1 件 geckolib-animations.md
    expect(manifest.stats.provenance['hand-curated']).toBe(7)
  })
})
