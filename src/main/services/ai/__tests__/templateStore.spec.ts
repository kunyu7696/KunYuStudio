/**
 * 模板压缩布局（canonical + 占位符 + variants）的字节等价守护。
 *
 * 判据：templateStore 从新布局组合出的文本，必须与重构前基线
 * （fixtures/ai-reference-baseline.json 里的逐文件 sha1）完全一致。
 * 一旦有人手改 canonical / vars / versions / variants 而没同步，
 * 这个用例会立刻失败——manifest 与检索行为不能因压缩而漂移。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { devReferenceDir } from '../referencePackageService'
import { contentStamp, createTemplateStore } from '../templateStore'

const dir = devReferenceDir()
const baseline = JSON.parse(
  readFileSync(
    join(process.cwd(), 'src', 'main', 'services', 'ai', '__tests__', 'fixtures', 'ai-reference-baseline.json'),
    'utf-8'
  )
) as { files: Record<string, string> }

// 基线与比对都做 EOL 归一（CRLF→LF）：仓库未锁 ai-reference 的 eol，
// 本地 autocrlf 检出为 CRLF、CI 检出为 LF，直接逐字节哈希会在 CI 全量误报
const sha1 = (text: string): string =>
  createHash('sha1').update(text.replace(/\r\n/g, '\n'), 'utf-8').digest('hex')
/** 根级共享文档（不在 loader 组合目录下）仍需直读磁盘 */
const isRootDoc = (rel: string): boolean => !/^templates\/(fabric|forge|neoforge)\//.test(rel)
const store = createTemplateStore(dir)

describe('ai-reference 压缩布局字节等价', () => {
  const rels = Object.keys(baseline.files)

  it('全部模板组合结果与重构前逐字节一致', () => {
    const bad: string[] = []
    for (const rel of rels) {
      const text = isRootDoc(rel) ? readFileSync(join(dir, rel), 'utf-8') : store.read(rel)
      if (text === null || sha1(text) !== baseline.files[rel]) bad.push(rel)
    }
    expect(bad).toEqual([])
  })

  it('list() 覆盖 manifest 全部模板且带内容指纹', () => {
    const listed = store.list()
    expect(listed.length).toBe(1555)
    for (const f of listed) {
      expect(f.content.length, f.rel).toBeGreaterThan(0)
      expect(f.mtimeMs).toBe(contentStamp(f.content))
    }
  })
})
