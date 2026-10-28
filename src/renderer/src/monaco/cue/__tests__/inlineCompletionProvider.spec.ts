/**
 * M3：extractQueryFromPosition 单测
 */
import { describe, expect, it, vi } from 'vitest'
import type * as Monaco from 'monaco-editor'

// inlineCompletionProvider 顶部导入 ../setup 会加载整个 monaco（jsdom 缺剪贴板 API），
// 测试只用到 extractQueryFromPosition（不触碰 monaco 全局），mock 掉 setup 模块
vi.mock('../../setup', () => ({ monaco: {} }))

import { extractQueryFromPosition } from '../inlineCompletionProvider'

/** 构造最小可用的 ITextModel stub（仅覆盖 extractQueryFromPosition 用到的 API） */
function stubModel(lines: string[]): Monaco.editor.ITextModel {
  return {
    getLineContent: (ln: number) => lines[ln - 1] ?? '',
    getLanguageId: () => 'java',
    getOffsetAt: () => 0,
    getValue: () => lines.join('\n')
  } as unknown as Monaco.editor.ITextModel
}

function pos(lineNumber: number, column = 1): Monaco.Position {
  return { lineNumber, column } as Monaco.Position
}

describe('extractQueryFromPosition', () => {
  it('从光标行提取标识符', () => {
    const model = stubModel([
      'public class ModBlocks {',
      '    public static final RegistryObject<Block> RUBY_BLOCK = registerBlock("ruby_block", () -> new Block(Behaviour.Properties.of().strength(4.0f)));'
    ])
    const query = extractQueryFromPosition(model, pos(2, 100))
    // 按长度取前 2：RegistryObject(14) + registerBlock(13)
    const tokens = query.split(' ')
    expect(tokens.length).toBeLessThanOrEqual(2)
    expect(tokens).toContain('RegistryObject')
    expect(tokens).toContain('registerBlock')
  })

  it('光标行为空时回溯上一行', () => {
    const model = stubModel([
      'public class ModItems {',
      '',
      '    '
    ])
    const query = extractQueryFromPosition(model, pos(3))
    expect(query).toBe('ModItems')
  })

  it('光标行和上一行都是空时返回空', () => {
    const model = stubModel([
      'public class Foo {',
      '',
      '    '
    ])
    const query = extractQueryFromPosition(model, pos(3))
    expect(query).toBe('Foo')
  })

  it('过滤 Java 关键字和短标识符', () => {
    const model = stubModel([
      'if (x > 0) { return new int[] {1}; }',
      'String name = mySpecialVariable;'
    ])
    const query = extractQueryFromPosition(model, pos(2, 10))
    // 行1 全是 stopword/短标识符；行2 String 是 stopword，保留 mySpecialVariable + name（≥3 字符）
    const tokens = query.split(' ')
    expect(tokens).toContain('mySpecialVariable')
    expect(tokens).not.toContain('String')
    expect(tokens).not.toContain('return')
  })

  it('stopword 大小写敏感（Java 风格）', () => {
    const model = stubModel(['private static final Logger LOGGER = LogManager.getLogger();'])
    const query = extractQueryFromPosition(model, pos(1, 60))
    // private/static/final 是 stopword，Logger/LOGGER/LogManager/getLogger 保留
    expect(query).toContain('LogManager')
    // getLogger 也以 g 开头但含大写字母，不是 stopword
    expect(query.split(' ').length).toBeLessThanOrEqual(2)
  })

  it('纯标点行返回空', () => {
    const model = stubModel(['{}', '{', '}'])
    const query = extractQueryFromPosition(model, pos(1, 2))
    // 光标行是 {}，无有效标识符
    expect(query).toBe('')
  })

  it('取最长两个标识符（稀罕度代理）', () => {
    const model = stubModel([
      'BlockBehaviour.Properties props = BlockBehaviour.Properties.of().mapColor(MapColor.STONE);'
    ])
    const query = extractQueryFromPosition(model, pos(1, 30))
    const tokens = query.split(' ')
    expect(tokens.length).toBeLessThanOrEqual(2)
    // 最长的两个：BlockBehaviour 和 Properties
    expect(tokens).toContain('BlockBehaviour')
  })

  it('跳过空白行向上找非空行', () => {
    const model = stubModel([
      'public class ModEntities {',
      '',
      '',
      '    '
    ])
    const query = extractQueryFromPosition(model, pos(4))
    expect(query).toBe('ModEntities')
  })

  it('光标在文件开头且无前缀内容时返回空', () => {
    const model = stubModel([''])
    const query = extractQueryFromPosition(model, pos(1))
    expect(query).toBe('')
  })
})
