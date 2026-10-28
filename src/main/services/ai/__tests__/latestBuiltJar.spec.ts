/**
 * latestBuiltJar / pickPrimaryJar 主产物选取回归测试。
 *
 * 修掉的缺陷（真机反馈 P0-2）：原实现只按 mtime 取最新 jar，
 * 而 Gradle 的 sourcesJar 任务稳定晚于主 jar 约 200ms，
 * 导致「构建产物」被报成 yanshi-1.0.0-sources.jar（只有源码、游戏不加载）。
 * 此前相关 spec 都只往 build/libs 放单个 jar，构造不出主/附属并存的真实输出。
 */
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { latestBuiltJar, pickPrimaryJar } from '../../jarPicker'

describe('pickPrimaryJar', () => {
  it('排除 -sources/-javadoc/-dev，保留主 jar 与 -all 肥包', () => {
    const names = [
      'demo-1.0.0.jar',
      'demo-1.0.0-sources.jar',
      'demo-1.0.0-javadoc.jar',
      'demo-1.0.0-dev.jar',
      'demo-1.0.0-all.jar',
      'demo-1.0.0-slim.jar',
      'readme.txt'
    ]
    // -all（shadow 肥包）是可分发的，不得排除（P1-D）
    expect(pickPrimaryJar(names)).toEqual(['demo-1.0.0.jar', 'demo-1.0.0-all.jar', 'demo-1.0.0-slim.jar'])
  })

  it('非 jar 文件一律不选', () => {
    expect(pickPrimaryJar(['a.zip', 'b.txt', 'c.jarx'])).toEqual([])
  })

  it('全为附属产物时返回空（不拿 sources 充数）', () => {
    expect(pickPrimaryJar(['x-1.0.0-sources.jar', 'x-1.0.0-dev.jar'])).toEqual([])
  })

  it('大小写不敏感', () => {
    expect(pickPrimaryJar(['x-1.0.0-SOURCES.JAR', 'x-1.0.0.jar'])).toEqual(['x-1.0.0.jar'])
  })
})

describe('latestBuiltJar — 主 jar 与 sources jar 并存', () => {
  const dir = join(tmpdir(), `ky-latestjar-${Math.random().toString(36).slice(2)}`)
  const libs = join(dir, 'build', 'libs')

  beforeAll(() => {
    mkdirSync(libs, { recursive: true })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('sources jar mtime 更新时仍返回主 jar（真实 Gradle 输出顺序）', () => {
    const main = join(libs, 'demo-1.0.0.jar')
    const sources = join(libs, 'demo-1.0.0-sources.jar')
    writeFileSync(main, 'main')
    writeFileSync(sources, 'sources')
    // 主 jar 早 246ms（复刻真机实测时序），sources 更晚
    const t = Date.now() / 1000
    utimesSync(main, t - 0.246, t - 0.246)
    utimesSync(sources, t, t)
    expect(latestBuiltJar(dir)).toBe(main)
  })

  it('只有 sources jar 时返回 null（不拿附属产物冒充构建产物）', () => {
    const dir2 = join(dir, 'only-sources')
    const libs2 = join(dir2, 'build', 'libs')
    mkdirSync(libs2, { recursive: true })
    writeFileSync(join(libs2, 'demo-1.0.0-sources.jar'), 'sources')
    expect(latestBuiltJar(dir2)).toBeNull()
  })

  it('仅有 -all.jar（shadow 肥包）时直接选中，不得降级为 null（P1-D）', () => {
    const dir3 = join(dir, 'only-all')
    const libs3 = join(dir3, 'build', 'libs')
    mkdirSync(libs3, { recursive: true })
    const fat = join(libs3, 'demo-1.0.0-all.jar')
    writeFileSync(fat, 'fat')
    expect(latestBuiltJar(dir3)).toBe(fat)
  })

  it('fat jar mtime 晚于瘦 jar 时选 fat jar（P1-D 可分发优先级）', () => {
    const fat = join(libs, 'demo-1.0.0-all.jar')
    const slim = join(libs, 'demo-1.0.0.jar')
    writeFileSync(fat, 'fat')
    writeFileSync(slim, 'slim')
    const t = Date.now() / 1000
    utimesSync(slim, t - 0.3, t - 0.3)
    utimesSync(fat, t, t)
    expect(latestBuiltJar(dir)).toBe(fat)
  })

  it('build/libs 不存在时返回 null', () => {
    expect(latestBuiltJar(join(dir, 'nonexistent'))).toBeNull()
  })
})
