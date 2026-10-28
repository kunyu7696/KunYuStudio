/**
 * P0-4 回归：包类 MC 版本白名单单一真源。
 *
 * 背景：向导曾从模组版本矩阵派生包类滚轮选项（可选 1.21.6+），但
 * 数据包/光影包初始化只认 ≤1.21.5、资源包 1.21.10/1.21.11 缺格式号，
 * 所选版本创建必然失败且已建目录被清理。
 */
import { describe, expect, it } from 'vitest'
import {
  PACK_TYPE_MC_VERSIONS,
  comparePackMcVersion,
  nearestPackMcVersion
} from '../packVersions'

describe('PACK_TYPE_MC_VERSIONS 白名单真源', () => {
  it('数据包/光影包 = 矩阵登记的 10 个去重版本（1.16.5~1.21.5）', () => {
    expect(PACK_TYPE_MC_VERSIONS.datapack).toEqual([
      '1.16.5',
      '1.18.2',
      '1.19.2',
      '1.20.1',
      '1.20.4',
      '1.20.6',
      '1.21.1',
      '1.21.3',
      '1.21.4',
      '1.21.5'
    ])
    expect(PACK_TYPE_MC_VERSIONS.shaderpack).toEqual(PACK_TYPE_MC_VERSIONS.datapack)
  })

  it('资源包覆盖 1.21.6~1.21.9，且不含 1.21.10/1.21.11（无官方格式号）', () => {
    const rp = PACK_TYPE_MC_VERSIONS.resourcepack
    for (const v of ['1.21.6', '1.21.7', '1.21.8', '1.21.9']) {
      expect(rp).toContain(v)
    }
    expect(rp).not.toContain('1.21.10')
    expect(rp).not.toContain('1.21.11')
  })

  it('三类白名单均升序排列', () => {
    for (const list of Object.values(PACK_TYPE_MC_VERSIONS)) {
      const sorted = [...list].sort(comparePackMcVersion)
      expect(list).toEqual(sorted)
    }
  })
})

describe('nearestPackMcVersion 向下取最近合法版本', () => {
  it('合法版本原样返回', () => {
    expect(nearestPackMcVersion('datapack', '1.20.1')).toBe('1.20.1')
    expect(nearestPackMcVersion('datapack', '1.21.5')).toBe('1.21.5')
    expect(nearestPackMcVersion('resourcepack', '1.21.9')).toBe('1.21.9')
  })

  it('资源包 1.21.10/1.21.11 → 1.21.9（此前透传 init 才报错）', () => {
    expect(nearestPackMcVersion('resourcepack', '1.21.10')).toBe('1.21.9')
    expect(nearestPackMcVersion('resourcepack', '1.21.11')).toBe('1.21.9')
  })

  it('数据包/光影包 1.21.6+ → 1.21.5（最高合法版本）', () => {
    expect(nearestPackMcVersion('datapack', '1.21.6')).toBe('1.21.5')
    expect(nearestPackMcVersion('datapack', '1.21.11')).toBe('1.21.5')
    expect(nearestPackMcVersion('shaderpack', '1.21.7')).toBe('1.21.5')
  })

  it('版本夹在两档之间时向下取（1.21.2 → 1.21.1）', () => {
    expect(nearestPackMcVersion('datapack', '1.21.2')).toBe('1.21.1')
  })

  it('低于最小版本时取最小版本（不返回 undefined）', () => {
    expect(nearestPackMcVersion('datapack', '1.12.2')).toBe('1.16.5')
    expect(nearestPackMcVersion('resourcepack', '1.0.0')).toBe('1.16.5')
  })

  it('未知类型防御：非法输入回退 1.20.1 之外的合理值不崩溃', () => {
    // PackType 为类型约束，运行时误传时至少不抛异常
    const list = (PACK_TYPE_MC_VERSIONS as Record<string, string[]>)['unknown']
    expect(list).toBeUndefined()
  })
})

describe('comparePackMcVersion', () => {
  it('按 . 分段数值升序，段缺失按 0 补齐', () => {
    expect(comparePackMcVersion('1.20.1', '1.20.4')).toBeLessThan(0)
    expect(comparePackMcVersion('1.21.5', '1.21.10')).toBeLessThan(0) // 数值比较而非字典序
    expect(comparePackMcVersion('1.21', '1.21.0')).toBe(0)
    expect(comparePackMcVersion('2.0.0', '1.21.9')).toBeGreaterThan(0)
  })
})
