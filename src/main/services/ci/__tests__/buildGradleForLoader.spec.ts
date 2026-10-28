/**
 * 特性⑤ build.gradle 生成器单测。
 *
 * 覆盖：三加载器 build.gradle 生成、gradle.properties 生成、
 * ciBuildScriptRelPaths 路径列表、official 镜像使用。
 */
import { describe, expect, it } from 'vitest'

import {
  ciBuildScriptRelPaths,
  generateBuildScriptForLoader,
  type CiProjectMeta
} from '../buildGradleForLoader'

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

describe('generateBuildScriptForLoader', () => {
  it('fabric → 含 fabric loom + yarn', () => {
    const r = generateBuildScriptForLoader('fabric', makeMeta())
    expect(r.buildGradle).toContain('fabric-loom')
    expect(r.buildGradle).toContain('mappings')
    expect(r.gradleProperties).toContain('fabric_version')
    expect(r.gradleProperties).toContain('yarn_mappings')
    expect(r.gradleProperties).toContain('loader_version')
  })

  it('forge → 含 ForgeGradle + forge_version', () => {
    const r = generateBuildScriptForLoader('forge', makeMeta())
    // official 镜像下 plugin id 是小写 net.minecraftforge.gradle；china 镜像注释里才有 ForgeGradle
    expect(r.buildGradle).toContain('net.minecraftforge.gradle')
    expect(r.gradleProperties).toContain('forge_version')
    expect(r.gradleProperties).toContain('minecraft_version')
  })

  it('neoforge → 含 ModDevGradle + neoforge_version', () => {
    const r = generateBuildScriptForLoader('neoforge', makeMeta())
    expect(r.buildGradle).toContain('ModDevGradle') // NeoForge ModDevGradle 插件
    expect(r.gradleProperties).toContain('neoforge_version')
  })

  it('official 镜像：不含阿里云镜像', () => {
    const r = generateBuildScriptForLoader('fabric', makeMeta())
    expect(r.buildGradle).not.toContain('aliyun.com')
  })

  it('modId 透传到 build.gradle', () => {
    const r = generateBuildScriptForLoader('fabric', makeMeta({ modId: 'testmod123' }))
    expect(r.gradleProperties).toContain('testmod123')
  })

  it('mcVersion 透传', () => {
    const r = generateBuildScriptForLoader('fabric', makeMeta({ mcVersion: '1.21.1' }))
    expect(r.gradleProperties).toContain('1.21.1')
  })

  it('unknown loader 回退 fabric', () => {
    const r = generateBuildScriptForLoader('unknown' as never, makeMeta())
    expect(r.buildGradle).toContain('fabric-loom')
  })

  it('空 mcVersion 回退默认值', () => {
    const r = generateBuildScriptForLoader('fabric', makeMeta({ mcVersion: '' }))
    expect(r.gradleProperties).toContain('1.20.1')
  })
})

describe('ciBuildScriptRelPaths', () => {
  it('单加载器 → 1 组路径', () => {
    const paths = ciBuildScriptRelPaths(['fabric'])
    expect(paths).toHaveLength(1)
    expect(paths[0].buildGradleRel).toBe('.kunyu/ci/build-fabric.gradle')
    expect(paths[0].gradlePropsRel).toBe('.kunyu/ci/gradle-fabric.properties')
  })

  it('三加载器 → 3 组路径', () => {
    const paths = ciBuildScriptRelPaths(['fabric', 'forge', 'neoforge'])
    expect(paths).toHaveLength(3)
    expect(paths[0].loader).toBe('fabric')
    expect(paths[1].loader).toBe('forge')
    expect(paths[2].loader).toBe('neoforge')
  })

  it('空数组 → 空结果', () => {
    const paths = ciBuildScriptRelPaths([])
    expect(paths).toHaveLength(0)
  })
})
