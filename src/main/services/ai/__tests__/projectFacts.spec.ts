/**
 * 领域事实层单测——结构化槽读写、上限、去重、prompt 行渲染。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FACTS_LIMITS,
  factsToPromptLine,
  readFacts,
  writeFactSlot
} from '../fcTools/projectFacts'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-facts-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('项目事实槽', () => {
  it('空项目返回空事实，prompt 行为 null（不占上下文）', () => {
    expect(readFacts(root)).toEqual({})
    expect(readFacts(null)).toEqual({})
    expect(factsToPromptLine(readFacts(root))).toBeNull()
  })

  it('标量槽覆盖写入并可读回', () => {
    expect(writeFactSlot(root, 'loader', 'neoforge').ok).toBe(true)
    expect(writeFactSlot(root, 'mcVersion', '1.21.1').ok).toBe(true)
    expect(writeFactSlot(root, 'namespace', 'examplemod').ok).toBe(true)
    // 覆盖语义
    writeFactSlot(root, 'mcVersion', '1.21.4')
    const facts = readFacts(root)
    expect(facts.loader).toBe('neoforge')
    expect(facts.mcVersion).toBe('1.21.4')
    expect(facts.namespace).toBe('examplemod')
  })

  it('registeredIds / notes 追加去重，重复写入静默 ok', () => {
    writeFactSlot(root, 'registeredIds', 'examplemod:ruby')
    const dup = writeFactSlot(root, 'registeredIds', 'examplemod:ruby')
    expect(dup.ok).toBe(true)
    writeFactSlot(root, 'registeredIds', 'examplemod:sapphire')
    expect(readFacts(root).registeredIds).toEqual(['examplemod:ruby', 'examplemod:sapphire'])
  })

  it('标量超长截断，空值软失败', () => {
    const r = writeFactSlot(root, 'loader', '')
    expect(r.ok).toBe(false)
    writeFactSlot(root, 'namespace', 'x'.repeat(200))
    expect((readFacts(root).namespace ?? '').length).toBeLessThanOrEqual(FACTS_LIMITS.scalar)
  })

  it('registeredIds 达上限后拒绝', () => {
    for (let i = 0; i < FACTS_LIMITS.idsMax; i += 1) {
      writeFactSlot(root, 'registeredIds', `examplemod:item_${i}`)
    }
    const r = writeFactSlot(root, 'registeredIds', 'examplemod:overflow')
    expect(r.ok).toBe(false)
  })

  it('损坏的 JSON 文件读取返回空事实（不抛异常）', () => {
    const file = join(root, '.kunyu/project-facts.json')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{broken json', 'utf-8')
    expect(readFacts(root)).toEqual({})
  })

  it('factsToPromptLine 渲染完整事实为一行紧凑文本', () => {
    writeFactSlot(root, 'loader', 'neoforge')
    writeFactSlot(root, 'mcVersion', '1.21.1')
    writeFactSlot(root, 'namespace', 'examplemod')
    writeFactSlot(root, 'lastBuild', '构建失败：缺 item model 注册')
    writeFactSlot(root, 'registeredIds', 'examplemod:ruby')
    writeFactSlot(root, 'notes', '附魔走数据 JSON 不走 Java 类')
    const line = factsToPromptLine(readFacts(root))
    expect(line).toContain('neoforge 1.21.1')
    expect(line).toContain('examplemod')
    expect(line).toContain('构建失败')
    expect(line).not.toContain('\n')
  })
})
