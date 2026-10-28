/**
 * 特性⑤ 工作流生成器单测。
 *
 * 覆盖：build.yml 矩阵/artifact/cp 步骤、release.yml 手动确认/environment/条件发布、
 * gametest.yml 复用、previewWorkflows 开关控制。
 */
import { describe, expect, it } from 'vitest'

import {
  generateBuildWorkflow,
  generateGametestWorkflow,
  generateReleaseWorkflow,
  previewWorkflows
} from '../ciWorkflowGenerator'
import { createDefaultCiConfig, type CiConfig } from '../../../../shared/types/ci'
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

describe('generateBuildWorkflow', () => {
  it('单加载器矩阵', () => {
    const config = createDefaultCiConfig('fabric')
    const yml = generateBuildWorkflow(config, makeMeta())
    expect(yml).toContain('name: Build')
    expect(yml).toContain("- loader: 'fabric'")
    expect(yml).not.toContain("'forge'")
  })

  it('三加载器矩阵', () => {
    const config: CiConfig = {
      ...createDefaultCiConfig('fabric'),
      matrix: { loaders: ['fabric', 'forge', 'neoforge'] }
    }
    const yml = generateBuildWorkflow(config, makeMeta())
    expect(yml).toContain("- loader: 'fabric'")
    expect(yml).toContain("- loader: 'forge'")
    expect(yml).toContain("- loader: 'neoforge'")
    expect(yml).toContain('fail-fast: false')
  })

  it('JDK 随矩阵走：1.20.1 → fabric/forge=17、neoforge=21', () => {
    const config: CiConfig = {
      ...createDefaultCiConfig('fabric'),
      matrix: { loaders: ['fabric', 'forge', 'neoforge'] }
    }
    const yml = generateBuildWorkflow(config, makeMeta())
    // include 行后紧跟 jdk
    expect(yml).toContain("- loader: 'fabric'\n            jdk: 17")
    expect(yml).toContain("- loader: 'forge'\n            jdk: 17")
    expect(yml).toContain("- loader: 'neoforge'\n            jdk: 21")
    expect(yml).toContain('java-version: "${{ matrix.jdk }}"')
    expect(yml).not.toContain('Setup JDK 17\n')
  })

  it('JDK 随矩阵走：1.21.1 → 全部 21', () => {
    const config: CiConfig = {
      ...createDefaultCiConfig('fabric'),
      matrix: { loaders: ['fabric', 'forge', 'neoforge'] }
    }
    const yml = generateBuildWorkflow(config, makeMeta({ mcVersion: '1.21.1' }))
    expect(yml).toContain("- loader: 'fabric'\n            jdk: 21")
    expect(yml).toContain("- loader: 'neoforge'\n            jdk: 21")
  })

  it('含 cp build.gradle 步骤', () => {
    const config = createDefaultCiConfig('fabric')
    const yml = generateBuildWorkflow(config, makeMeta())
    expect(yml).toContain('cp .kunyu/ci/build-${{ matrix.loader }}.gradle build.gradle')
    expect(yml).toContain('cp .kunyu/ci/gradle-${{ matrix.loader }}.properties gradle.properties')
  })

  it('含 build + upload-artifact 步骤', () => {
    const config = createDefaultCiConfig('fabric')
    const yml = generateBuildWorkflow(config, makeMeta())
    expect(yml).toContain('./gradlew build')
    expect(yml).toContain('actions/upload-artifact@v4')
    expect(yml).toContain('build/libs/*.jar')
  })

  it('push + pull_request trigger', () => {
    const yml = generateBuildWorkflow(createDefaultCiConfig('fabric'), makeMeta())
    expect(yml).toContain('push:')
    expect(yml).toContain('pull_request:')
  })
})

describe('generateReleaseWorkflow', () => {
  it('含 workflow_dispatch inputs（手动确认发布）', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    config.publish.githubRelease = true
    const yml = generateReleaseWorkflow(config)
    expect(yml).toContain('workflow_dispatch:')
    expect(yml).toContain('publish_github')
    expect(yml).toContain('publish_modrinth')
    expect(yml).toContain('publish_curseforge')
  })

  it('含 environment: release（需手动审批）', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    const yml = generateReleaseWorkflow(config)
    expect(yml).toContain('environment: release')
  })

  it('tag push 触发 v*', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    const yml = generateReleaseWorkflow(config)
    expect(yml).toContain("tags:")
    expect(yml).toContain("- 'v*'")
  })

  it('githubRelease 开启 → 含 GitHub Release 步骤', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    config.publish.githubRelease = true
    const yml = generateReleaseWorkflow(config)
    expect(yml).toContain('softprops/action-gh-release')
    expect(yml).toContain('${{ inputs.publish_github }}')
  })

  it('githubRelease 关闭 → 不含 GitHub Release 步骤', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    config.publish.githubRelease = false
    const yml = generateReleaseWorkflow(config)
    expect(yml).not.toContain('softprops/action-gh-release')
  })

  it('modrinth 开启 → 含 mc-publish + Modrinth token', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    config.publish.modrinth = true
    const yml = generateReleaseWorkflow(config)
    expect(yml).toContain('Kir-Antipov/mc-publish')
    expect(yml).toContain('${{ inputs.publish_modrinth }}')
    expect(yml).toContain('MODRINTH_TOKEN')
  })

  it('curseforge 开启 → 含 mc-publish + CurseForge token', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    config.publish.curseforge = true
    const yml = generateReleaseWorkflow(config)
    expect(yml).toContain('Kir-Antipov/mc-publish')
    expect(yml).toContain('${{ inputs.publish_curseforge }}')
    expect(yml).toContain('CURSEFORGE_TOKEN')
  })

  it('自定义 Secret 名注入', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    config.publish.modrinth = true
    config.secrets.modrinth = 'MY_CUSTOM_MODRINTH_TOKEN'
    const yml = generateReleaseWorkflow(config)
    expect(yml).toContain('MY_CUSTOM_MODRINTH_TOKEN')
  })
})

describe('generateGametestWorkflow', () => {
  it('复用特性④ githubActionsWorkflow', () => {
    const yml = generateGametestWorkflow()
    expect(yml).toContain('name: GameTest')
    expect(yml).toContain('runGameTestServer')
    expect(yml).toContain('setup-java@v4')
  })

  it('JDK 随矩阵走：1.20.1=17、1.21.1=21', () => {
    const yml20 = generateGametestWorkflow(makeMeta({ mcVersion: '1.20.1' }))
    expect(yml20).toContain('Setup JDK 17')
    expect(yml20).toContain('java-version: "17"')
    const yml21 = generateGametestWorkflow(makeMeta({ mcVersion: '1.21.1' }))
    expect(yml21).toContain('Setup JDK 21')
    expect(yml21).toContain('java-version: "21"')
  })
})

describe('previewWorkflows', () => {
  it('全部开启 → 返回 3 个 key', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.release = true
    config.publish.githubRelease = true
    const preview = previewWorkflows(config, makeMeta())
    expect(preview.build).toBeDefined()
    expect(preview.release).toBeDefined()
    expect(preview.gametest).toBeDefined()
  })

  it('release 关闭 → 不含 release key', () => {
    const config = createDefaultCiConfig('fabric')
    const preview = previewWorkflows(config, makeMeta())
    expect(preview.build).toBeDefined()
    expect(preview.gametest).toBeDefined()
    expect(preview.release).toBeUndefined()
  })

  it('全部关闭 → 空对象', () => {
    const config = createDefaultCiConfig('fabric')
    config.workflows.build = false
    config.workflows.release = false
    config.workflows.gametest = false
    const preview = previewWorkflows(config, makeMeta())
    expect(preview.build).toBeUndefined()
    expect(preview.release).toBeUndefined()
    expect(preview.gametest).toBeUndefined()
  })
})
