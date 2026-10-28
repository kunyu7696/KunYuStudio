/**
 * validateFileChanges 安全闸门单测：
 * 最终 JSON files[] 写盘通道必须与 write_project_file 工具共用同一份
 * 扩展名白名单 + Gradle 构建文件黑名单，堵住
 * 「提示注入 → 落盘 build.gradle → 同轮自动 clean build 执行」的 RCE 链路。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateFileChanges } from '../orchestrator/planParse'
import type { ResolvedProject } from '../orchestrator/types'

let root: string
let project: ResolvedProject

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-vfc-'))
  project = {
    id: 'p1',
    name: 'demo',
    path: root,
    type: 'mod',
    mcVersion: '1.20.1',
    loader: 'fabric',
    loaderVersion: '0.15.11'
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function run(paths: string[]) {
  return validateFileChanges(
    paths.map((p) => ({ path: p, action: 'create', content: 'x = 1\n' })),
    project
  )
}

describe('validateFileChanges 写盘安全闸门', () => {
  it.each([
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'gradle.properties',
    'gradle/wrapper/gradle-wrapper.properties',
    'gradlew',
    'gradlew.bat',
    '.gradle/5.6.4/fileHashes/fileHashes.lock'
  ])('拒绝 Gradle 构建脚本/配置：%s', (p) => {
    const [c] = run([p])
    expect(c.accepted).toBe(false)
    expect(c.reason).toContain('构建脚本')
  })

  it.each(['src/main/x.png', 'src/main/x.sh', 'src/main/x.bat', 'src/main/x.jar'])(
    '拒绝白名单外扩展名：%s',
    (p) => {
      const [c] = run([p])
      expect(c.accepted).toBe(false)
      expect(c.reason).toContain('扩展名')
    }
  )

  it.each([
    'src/main/java/com/x/Foo.java',
    'src/main/resources/assets/x/lang/en_us.json',
    'src/main/resources/fabric.mod.json',
    'src/main/resources/pack.mcmeta'
  ])('放行合法源码/资源：%s', (p) => {
    const [c] = run([p])
    expect(c.accepted).toBe(true)
    expect(c.reason).toBeUndefined()
  })

  it('无项目时片段模式仍套用类型闸门（不落盘、不 accepted）', () => {
    const [bad] = validateFileChanges(
      [{ path: 'build.gradle', action: 'create', content: 'x' }],
      null
    )
    expect(bad.accepted).toBe(false)
    expect(bad.reason).toContain('构建脚本')
    const [good] = validateFileChanges(
      [{ path: 'a.java', action: 'create', content: 'class A {}' }],
      null
    )
    expect(good.accepted).toBe(false)
    expect(good.reason).toContain('无打开项目')
  })
})
