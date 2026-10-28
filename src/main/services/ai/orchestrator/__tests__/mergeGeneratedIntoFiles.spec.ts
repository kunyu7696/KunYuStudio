/**
 * P1-2 修复测试：generateProjectContent 生成的代码/资源文件
 * 必须合并进 files 数组，让 composeReply 能展示具体文件列表。
 *
 * 修复前：orchestrator 只把 assetFiles 路径存到局部变量，
 * composeReply 收到的 files 为空 → 文件变更卡片恒 files:[]。
 */
import { describe, expect, it } from 'vitest'
import type { AgentFileChange } from '../../../../../shared/types/agent'
import type { GeneratedFile } from '../../../../../shared/types/content'
import { mergeGeneratedIntoFiles } from '../generatePipeline'

function fc(path: string, accepted = true): AgentFileChange {
  return { path, action: 'create', content: '// fc', accepted, reason: accepted ? undefined : '路径逃逸' }
}

function gf(path: string, action: 'write' | 'delete' = 'write'): GeneratedFile {
  return { path, action }
}

describe('mergeGeneratedIntoFiles：generateProjectContent 产出合并进 files', () => {
  it('把生成文件作为 accepted modify 合并进 files', () => {
    const files: AgentFileChange[] = []
    const generated: GeneratedFile[] = [
      gf('src/main/java/ModItems.java'),
      gf('src/main/resources/assets/myne/items/ruby.json')
    ]
    const merged = mergeGeneratedIntoFiles(files, generated)
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({
      path: 'src/main/java/ModItems.java',
      action: 'modify',
      accepted: true
    })
    expect(merged[1].path).toBe('src/main/resources/assets/myne/items/ruby.json')
  })

  it('保留 FC 已写入的同路径文件（去重不覆盖）', () => {
    const files: AgentFileChange[] = [fc('src/main/java/ModItems.java', true)]
    const generated: GeneratedFile[] = [gf('src/main/java/ModItems.java')]
    const merged = mergeGeneratedIntoFiles(files, generated)
    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('// fc') // 原内容保留
    expect(merged[0].action).toBe('create') // 原 action 保留
  })

  it('跳过 delete 项（已落盘被删除的不进变更列表）', () => {
    const files: AgentFileChange[] = []
    const generated: GeneratedFile[] = [
      gf('src/main/resources/old.json', 'delete'),
      gf('src/main/resources/new.json', 'write')
    ]
    const merged = mergeGeneratedIntoFiles(files, generated)
    expect(merged).toHaveLength(1)
    expect(merged[0].path).toBe('src/main/resources/new.json')
  })

  it('FC 文件 + 生成文件混合 → 都在列表', () => {
    const files: AgentFileChange[] = [fc('src/main/java/ModItems.java')]
    const generated: GeneratedFile[] = [
      gf('src/main/resources/assets/myne/items/ruby.json'),
      gf('src/main/resources/assets/myne/lang/en_us.json')
    ]
    const merged = mergeGeneratedIntoFiles(files, generated)
    expect(merged).toHaveLength(3)
    expect(merged.map((f) => f.path)).toEqual([
      'src/main/java/ModItems.java',
      'src/main/resources/assets/myne/items/ruby.json',
      'src/main/resources/assets/myne/lang/en_us.json'
    ])
  })

  it('空 generated → 原样返回', () => {
    const files: AgentFileChange[] = [fc('a.java')]
    const merged = mergeGeneratedIntoFiles(files, [])
    expect(merged).toEqual(files)
  })
})
