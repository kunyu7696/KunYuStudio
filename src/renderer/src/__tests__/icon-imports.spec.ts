import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import * as Icons from '@element-plus/icons-vue'

/**
 * 回归测试：防止"导入了不存在的 Element Plus 图标"导致整个异步组件链加载失败。
 *
 * 背景：曾有组件导入 @element-plus/icons-vue 中不存在的图标，
 * 触发 SyntaxError，使懒加载的工作区视图整体白屏。
 * 本测试扫描 src 下所有 .vue/.ts 文件，校验每个具名导入的图标确实存在。
 */

const ROOT = join(__dirname, '..', '..', '..')
const EXTS = new Set(['.vue', '.ts'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.vite', '__tests__', '__mocks__'])

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      walk(abs, files)
    } else if (EXTS.has(extname(name))) {
      files.push(abs)
    }
  }
  return files
}

/** 提取 from '@element-plus/icons-vue' 的具名导入列表 */
function extractIconImports(source: string): string[] {
  const names: string[] = []
  // 匹配 import { A, B as C } from '@element-plus/icons-vue'
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]@element-plus\/icons-vue['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((spec) => {
        // 处理 "Foo as Bar" 形式，取真实导出名 Foo
        const real = spec.split(/\s+as\s+/)[0].trim()
        names.push(real)
      })
  }
  return names
}

const availableIcons = new Set(Object.keys(Icons))

describe('Element Plus 图标导入回归', () => {
  const files = walk(ROOT)
  // 仅检查有图标导入的文件，减少噪音
  const filesWithIcons = files
    .map((f) => ({ f, src: readFileSync(f, 'utf8') }))
    .filter(({ src }) => src.includes("@element-plus/icons-vue"))

  it('至少检测到一个文件导入了图标（扫描有效性）', () => {
    expect(filesWithIcons.length).toBeGreaterThan(0)
  })

  for (const { f, src } of filesWithIcons) {
    const imports = extractIconImports(src)
    if (imports.length === 0) continue

    it(`${f.replace(ROOT + '/', '')} 中所有图标导入均存在`, () => {
      const missing = imports.filter((n) => !availableIcons.has(n))
      expect(missing, `缺失图标: ${missing.join(', ')}`).toEqual([])
    })
  }
})
