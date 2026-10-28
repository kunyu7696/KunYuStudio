import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelListCache, MODEL_LIST_TTL_MS } from '../modelListCache'

const dirs: string[] = []

function cachePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-model-cache-'))
  dirs.push(dir)
  return join(dir, 'ai', 'model-list-cache.json')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('modelListCache', () => {
  it('写入后可读取，且保留顺序', () => {
    const path = cachePath()
    const cache = createModelListCache({ path, now: () => 1000 })
    cache.write('p1', ['b', 'a'])
    expect(cache.read('p1')).toEqual({ models: ['b', 'a'], fetchedAt: 1000 })
  })

  it('超过 TTL 视为过期', () => {
    const path = cachePath()
    const cache = createModelListCache({ path, now: () => 1000 })
    cache.write('p1', ['m'])
    const later = createModelListCache({ path, now: () => 1000 + MODEL_LIST_TTL_MS + 1 })
    expect(later.read('p1')).toBeNull()
  })

  it('不同 provider 互不影响，且跨实例持久化', () => {
    const path = cachePath()
    createModelListCache({ path, now: () => 1 }).write('a', ['x'])
    createModelListCache({ path, now: () => 2 }).write('b', ['y'])
    const reopened = createModelListCache({ path, now: () => 3 })
    expect(reopened.read('a')?.models).toEqual(['x'])
    expect(reopened.read('b')?.models).toEqual(['y'])
  })

  it('缓存文件损坏时按空处理，不抛错', () => {
    const path = cachePath()
    const broken = createModelListCache({ path, now: () => 1 })
    expect(broken.read('p1')).toBeNull()
    // 写入时覆盖损坏内容
    broken.write('p1', ['ok'])
    expect(broken.read('p1')?.models).toEqual(['ok'])
  })
})
