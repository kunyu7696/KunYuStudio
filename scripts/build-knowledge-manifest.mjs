// 生成 resources/knowledge/manifest.json（语料版本指纹）。
// 用法：node scripts/build-knowledge-manifest.mjs [corpusVersion]
// 发布前更新语料后必须重跑，否则运行时会把包标记为 drifted。
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'resources', 'knowledge')
const corpora = ['fabric', 'mcwiki', 'kubejs']
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

const files = []
for (const corpus of corpora) {
  const dir = join(root, corpus)
  if (!existsSync(dir)) continue
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.md')) continue
    const buf = readFileSync(join(dir, name))
    // 归一化换行（CRLF→LF）后再哈希，保证 Windows 构建与 Linux CI 指纹一致
    const normalized = buf.toString('utf8').replace(/\r\n/g, '\n')
    files.push({ path: `${corpus}/${name}`, sha256: sha256(normalized), bytes: buf.length })
  }
}
files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

const fingerprint = sha256(files.map((f) => `${f.path}:${f.sha256}`).join('\n'))
const now = new Date()
const generatedAt = now.toISOString().slice(0, 10)
const corpusVersion = process.argv[2] || generatedAt.replace(/-/g, '.')

writeFileSync(
  join(root, 'manifest.json'),
  `${JSON.stringify({ schemaVersion: 1, corpusVersion, generatedAt, files, fingerprint }, null, 2)}\n`,
  'utf-8'
)
console.log(`manifest written: ${files.length} files, fingerprint ${fingerprint.slice(0, 12)}…`)
