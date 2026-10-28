import { describe, expect, it } from 'vitest'
import { buildChatContextBlock, renderStructure } from '../chatContext'
import type { FileNode } from '../../../../shared/types/fs'
import type { BuildProblem } from '../../../../shared/types/build'

/**
 * T7.2 问答上下文注入契约：
 * - 无项目/空快照 → 空串（调用方不注入）
 * - 工程信息/项目结构/当前文件或选区/构建问题/最近构建状态分节注入
 * - 结构忽略 build/.gradle 等产物目录；选区优先于整文件；错误优先于警告
 * - 超长内容截断但保留头尾
 */
function dir(path: string, name: string, children?: FileNode[]): FileNode {
  return { path, name, kind: 'directory', ext: '', size: 0, mtime: 0, children }
}
function file(path: string, name: string, ext = ''): FileNode {
  return { path, name, kind: 'file', ext, size: 1, mtime: 0 }
}

const root = dir('D:\\proj\\demo', 'demo', [
  dir('D:\\proj\\demo\\build', 'build', [file('D:\\proj\\demo\\build\\a.class', 'a.class', 'class')]),
  dir('D:\\proj\\demo\\src', 'src', [
    dir('D:\\proj\\demo\\src\\main', 'main', [
      file('D:\\proj\\demo\\src\\main\\Example.java', 'Example.java', 'java')
    ])
  ]),
  file('D:\\proj\\demo\\build.gradle', 'build.gradle', 'gradle')
])

const baseProject = {
  name: 'demo',
  type: 'mod' as const,
  loader: 'neoforge' as const,
  mcVersion: '1.21.1',
  modId: 'demo',
  path: 'D:\\proj\\demo'
}

describe('buildChatContextBlock', () => {
  it('空快照返回空串', () => {
    expect(buildChatContextBlock({})).toBe('')
  })

  it('注入工程信息与工具链（NeoForge → Java 21）', () => {
    const block = buildChatContextBlock({ project: baseProject })
    expect(block).toContain('工程信息')
    expect(block).toContain('neoforge · Minecraft 1.21.1')
    expect(block).toContain('Java 21')
    expect(block).toContain('modId：demo')
  })

  it('项目结构忽略 build 等产物目录且按目录优先排序', () => {
    const lines = renderStructure(root)
    const joined = lines.join('\n')
    expect(joined).toContain('src/')
    expect(joined).toContain('build.gradle')
    expect(joined).not.toContain('a.class')
    expect(joined).not.toContain('build/')
    const tree = buildChatContextBlock({ project: baseProject, structureRoot: root })
    expect(tree).toContain('项目结构')
  })

  it('存在选区时注入选区而非整个文件', () => {
    const block = buildChatContextBlock({
      project: baseProject,
      activeFile: { path: 'D:\\proj\\demo\\src\\main\\Example.java', language: 'java', content: 'FULL', dirty: false },
      selection: { path: 'D:\\proj\\demo\\src\\main\\Example.java', startLine: 3, endLine: 5, text: 'SELECTED' }
    })
    expect(block).toContain('选中代码')
    expect(block).toContain('第 3-5 行')
    expect(block).toContain('SELECTED')
    expect(block).not.toContain('当前打开文件')
  })

  it('构建问题相对路径化，错误优先于警告', () => {
    const problems: BuildProblem[] = [
      { severity: 'warning', file: 'D:\\proj\\demo\\src\\main\\W.java', line: 1, column: 1, message: 'w', raw: '' },
      { severity: 'error', file: 'D:\\proj\\demo\\src\\main\\E.java', line: 9, column: 2, message: 'boom', raw: '' }
    ]
    const block = buildChatContextBlock({ project: baseProject, problems })
    expect(block).toContain('src/main/E.java:9:2')
    expect(block).toContain('boom')
    expect(block).not.toContain('W.java')
  })

  it('超长文件内容被截断并提示省略字符数', () => {
    const content = 'x'.repeat(10000)
    const block = buildChatContextBlock({
      project: baseProject,
      activeFile: { path: 'D:\\proj\\demo\\Big.java', language: 'java', content, dirty: true }
    })
    expect(block).toContain('已省略中间')
    expect(block).toContain('未保存')
  })

  it('最近构建状态分节', () => {
    const block = buildChatContextBlock({
      project: baseProject,
      lastBuild: { ok: false, statusText: '构建失败' }
    })
    expect(block).toContain('失败：构建失败')
  })
})
