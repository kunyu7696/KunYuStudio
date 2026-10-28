/**
 * P1-1：AI 静默覆盖用户语义资产——同 id 重写需保护。
 *
 * 修复前：saveContent 直接 writeFile 覆盖，用户手动修改的语义资产被 AI 静默覆盖，
 * 无法回退。
 *
 * 修复后：saveContent 检测到 target 已存在时，备份旧内容到 .bak，
 * 并在返回值中标记 overwritten=true，让 content_upsert 工具能显式告知用户。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { saveContent } from '../contentService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { createDefaultBlock, type BlockSchema } from '../../../shared/types/content'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ky-overwrite-'))
  registerProjectRoot(root)
  const resources = join(root, 'src', 'main', 'resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    join(resources, 'fabric.mod.json'),
    JSON.stringify({ schemaVersion: 1, id: 'testmod', version: '1.0.0' })
  )
  writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\n')
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('P1-1: saveContent 覆盖保护', () => {
  it('新建语义资产 → overwritten=false，无 .bak', () => {
    const block = createDefaultBlock('ruby_block') as BlockSchema
    block.displayName = { en_us: 'Ruby Block', zh_cn: '红宝石块' }
    const summary = saveContent(root, block)
    expect(summary.overwritten).toBe(false)
    const bakPath = join(root, '.kunyu', 'content', 'blocks', 'ruby_block.json.bak')
    expect(existsSync(bakPath)).toBe(false)
  })

  it('覆盖已有语义资产 → overwritten=true，.bak 包含旧内容', () => {
    const block = createDefaultBlock('sapphire_block') as BlockSchema
    block.displayName = { en_us: 'Sapphire Block', zh_cn: '蓝宝石块' }
    saveContent(root, block)

    // AI 修改属性后重新保存
    block.displayName = { en_us: 'Sapphire Block', zh_cn: '蓝宝石块（改）' }
    const summary = saveContent(root, block)
    expect(summary.overwritten).toBe(true)

    const bakPath = join(root, '.kunyu', 'content', 'blocks', 'sapphire_block.json.bak')
    expect(existsSync(bakPath)).toBe(true)
    const bak = JSON.parse(readFileSync(bakPath, 'utf8'))
    expect(bak.displayName.zh_cn).toBe('蓝宝石块')
  })
})
