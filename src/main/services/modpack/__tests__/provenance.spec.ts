/**
 * 安装来源记录测试（真实 tmpdir）：
 * 纯函数的覆盖/移除语义，读写的容错（缺文件、损坏 JSON），记录器一次落盘。
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModSourceEntry } from '../../../../shared/types/modpack'
import {
  createProvenanceRecorder,
  readSources,
  removeEntryByName,
  sourcesFilePath,
  upsertEntry,
  writeSources
} from '../provenance'

function entry(fileName: string, size = 100): ModSourceEntry {
  return {
    fileName,
    platform: 'modrinth',
    modId: 'AANobbMI',
    versionId: 'v1',
    slug: 'sodium',
    name: 'Sodium',
    versionNumber: '0.5.0',
    downloadUrl: 'https://cdn.example/a.jar',
    size,
    installedAt: '2026-09-21T00:00:00.000Z'
  }
}

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-provenance-'))
}

describe('来源记录纯函数', () => {
  it('upsertEntry 按文件名覆盖而非追加', () => {
    const next = upsertEntry([entry('a.jar', 1)], entry('a.jar', 2))
    expect(next).toHaveLength(1)
    expect(next[0]?.size).toBe(2)
  })

  it('removeEntryByName 移除指定文件名', () => {
    const next = removeEntryByName([entry('a.jar'), entry('b.jar')], 'a.jar')
    expect(next.map((e) => e.fileName)).toEqual(['b.jar'])
  })
})

describe('来源记录读写容错', () => {
  it('记录文件缺失时返回空表', () => {
    expect(readSources(tmpProject()).size).toBe(0)
  })

  it('记录文件损坏时不抛错，按空表处理', () => {
    const root = tmpProject()
    mkdirSync(join(root, '.kunyu'), { recursive: true })
    writeFileSync(sourcesFilePath(root), '{ 这不是 JSON')
    expect(readSources(root).size).toBe(0)
  })

  it('writeSources 后可原样读回', () => {
    const root = tmpProject()
    writeSources(root, [entry('a.jar', 512), entry('b.jar', 256)])
    const map = readSources(root)
    expect(map.size).toBe(2)
    expect(map.get('b.jar')?.size).toBe(256)
    expect(readFileSync(sourcesFilePath(root), 'utf8')).toContain('"version": 1')
  })
})

describe('createProvenanceRecorder', () => {
  it('record 累积后一次 flush 落盘，且覆盖同名记录', () => {
    const root = tmpProject()
    writeSources(root, [entry('sodium.jar', 1)])
    const recorder = createProvenanceRecorder(root)
    recorder.record(entry('sodium.jar', 999))
    recorder.record(entry('jei.jar', 123))
    // 未 flush 前磁盘仍是旧值
    expect(readSources(root).get('sodium.jar')?.size).toBe(1)
    recorder.flush()
    const map = readSources(root)
    expect(map.get('sodium.jar')?.size).toBe(999)
    expect(map.get('jei.jar')?.size).toBe(123)
  })

  it('remove 后 flush 移除记录（覆盖安装时清掉旧坐标）', () => {
    const root = tmpProject()
    writeSources(root, [entry('sodium.jar'), entry('jei.jar')])
    const recorder = createProvenanceRecorder(root)
    recorder.remove('sodium.jar')
    recorder.flush()
    expect([...readSources(root).keys()]).toEqual(['jei.jar'])
  })
})