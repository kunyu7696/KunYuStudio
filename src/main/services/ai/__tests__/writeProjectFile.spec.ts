/**
 * write_project_file FC 工具单测：
 * 分片源码/资源提交通道——路径安全、扩展名白名单、占位符拒绝、data 回传、同路径覆盖。
 * T1 起双模：注入 writeThrough 端口（生产 per-run 注入）时闸门全过立即写盘；
 * 未注入（本文件多数用例）保持旧行为——只校验并回传，不写盘（落盘由 generatePipeline 合并后统一执行）。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'
import { createWriteThrough } from '../orchestrator/writeThrough'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

let root: string
let registry: ToolRegistry

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-wpf-'))
  registry = createToolRegistry({ projectRoot: () => root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function run(args: Record<string, unknown>): Promise<ToolResult> {
  return registry.executeTool('write_project_file', args, CTX)
}

describe('write_project_file', () => {
  it('已注册为 chat 工具；无项目时不暴露', () => {
    const names = registry.getToolDefinitions().map((d) => d.function.name)
    expect(names).toContain('write_project_file')
    const noProject = createToolRegistry({})
    expect(noProject.getToolDefinitions().map((d) => d.function.name)).not.toContain('write_project_file')
  })

  it('合法 Java 文件通过：data 回传变更标记、动作默认 create、工具本身不写盘', async () => {
    const rel = 'src/main/java/com/x/Foo.java'
    const r = await run({ relPath: rel, content: 'package com.x;\npublic class Foo {}\n' })
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({
      __kyFileChange: true,
      path: rel,
      action: 'create'
    })
    expect((r.data as { content: string }).content).toContain('public class Foo')
    // 不立即落盘（统一落盘点在生成阶段结束）
    expect(existsSync(join(root, rel))).toBe(false)
  })

  it('反斜杠路径归一化为 POSIX；action=modify 保留', async () => {
    const r = await run({
      relPath: 'src\\main\\resources\\assets\\x\\lang\\zh_cn.json',
      content: '{}',
      action: 'modify'
    })
    expect(r.ok).toBe(true)
    expect(r.data).toMatchObject({
      path: 'src/main/resources/assets/x/lang/zh_cn.json',
      action: 'modify'
    })
  })

  it.each([
    ['盘符绝对路径', 'C:/evil/Foo.java'],
    ['UNC/前导斜杠', '//server/share/Foo.java'],
    ['父目录越界', 'src/../../evil/Foo.java'],
    ['当前目录段', './src/Foo.java'],
    ['空路径', '']
  ])('拒绝非法路径：%s', async (_label, relPath) => {
    const r = await run({ relPath, content: 'x' })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it.each(['png', 'jar', 'sh', 'ps1', 'cmd', 'zip', 'class', 'txt'])(
    '扩展名白名单拒绝 .%s（二进制/脚本/杂项）',
    async (ext) => {
      const r = await run({ relPath: `src/main/x.${ext}`, content: 'x' })
      expect(r.ok).toBe(false)
      expect(r.error).toContain('扩展名')
    }
  )

  it.each(['properties', 'toml', 'lang', 'vsh', 'fsh', 'glsl'])(
    '资源类扩展名放行 .%s',
    async (ext) => {
      const r = await run({ relPath: `src/main/resources/a.${ext}`, content: 'x = 1\n' })
      expect(r.ok).toBe(true)
    }
  )

  it.each(['json', 'mcmeta'])('合法 JSON 放行 .%s', async (ext) => {
    const r = await run({ relPath: `src/main/resources/a.${ext}`, content: '{"a": 1}' })
    expect(r.ok).toBe(true)
  })

  it.each(['json', 'mcmeta'])('JSON 解析失败拒绝 .%s（含行尾逗号）', async (ext) => {
    const r = await run({ relPath: `src/main/resources/a.${ext}`, content: '{"a": 1,}' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('JSON 解析失败')
  })

  it('Java 花括号不平衡拒绝（缺闭合括号当场打回）', async () => {
    const r = await run({
      relPath: 'src/main/java/com/x/Bad.java',
      content: 'package com.x;\npublic class Bad {\n    void a() {\n}\n' // 缺一个 }
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('花括号不平衡')
  })

  it('Java 字符串/注释里的大括号不误伤', async () => {
    const r = await run({
      relPath: 'src/main/java/com/x/Ok.java',
      content:
        'package com.x;\n// 注释含不平衡 { {\npublic class Ok {\n' +
        '    String s = "literal { unbalanced";\n    char c = \'{\';\n}\n'
    })
    expect(r.ok).toBe(true)
  })

  it.each([
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'gradle.properties',
    'gradle/wrapper/gradle-wrapper.properties',
    'gradlew',
    'gradlew.bat',
    '.gradle/5.6.4/fileHashes/fileHashes.lock'
  ])('Gradle 构建脚本/配置禁写：%s', async (relPath) => {
    const r = await run({ relPath, content: 'x' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('构建脚本')
  })

  it('空内容与 TODO/占位符内容拒绝', async () => {
    expect((await run({ relPath: 'a.java', content: '   ' })).ok).toBe(false)
    expect((await run({ relPath: 'a.java', content: '// TODO: implement later' })).ok).toBe(false)
    expect((await run({ relPath: 'a.json', content: '{ "k": "<your-name>" }' })).ok).toBe(false)
    expect((await run({ relPath: 'a.java', content: '// 占位符待补充' })).ok).toBe(false)
  })

  it('无打开项目时工具不可用（不暴露也不执行）', async () => {
    const empty = createToolRegistry({})
    const r = await empty.executeTool(
      'write_project_file',
      { relPath: 'a.java', content: 'class A {}' },
      CTX
    )
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不可用|项目/)
  })

  it.each([
    'src/main/resources/assets/demo/blockstates/ruby_block.json',
    'src/main/resources/assets/demo/models/block/ruby_block.json',
    'src/main/resources/assets/demo/lang/zh_cn.json',
    'src/main/resources/data/demo/tags/blocks/mineable/pickaxe.json'
  ])('模组项目拒绝直写自动生成资源：%s', async (relPath) => {
    const modRegistry = createToolRegistry({ projectRoot: () => root, projectType: () => 'mod' })
    const r = await modRegistry.executeTool('write_project_file', { relPath, content: '{}' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('content_upsert')
  })

  it('非模组项目（整合包/资源包等）仍放行自动生成资源路径', async () => {
    const packRegistry = createToolRegistry({ projectRoot: () => root, projectType: () => 'resourcepack' })
    const r = await packRegistry.executeTool(
      'write_project_file',
      { relPath: 'assets/demo/lang/zh_cn.json', content: '{}' },
      CTX
    )
    expect(r.ok).toBe(true)
  })

  it('未声明 projectType 时保持原行为（兼容旧调用方）', async () => {
    const r = await run({ relPath: 'src/main/resources/assets/demo/lang/zh_cn.json', content: '{}' })
    expect(r.ok).toBe(true)
  })
})

describe('write_project_file · T1 write-through 模式', () => {
  const makeWtRegistry = () => {
    const wt = createWriteThrough({
      projectRoot: root,
      writeFile: (abs, content) => {
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, content, 'utf8')
      }
    })
    const reg = createToolRegistry({ projectRoot: () => root, writeThrough: () => wt })
    return { wt, reg }
  }

  it('注入 writeThrough：闸门全过立即写盘，文案提示工作台可见', async () => {
    const { reg } = makeWtRegistry()
    const rel = 'src/main/java/com/x/Wt.java'
    const r = await reg.executeTool(
      'write_project_file',
      { relPath: rel, content: 'package com.x;\npublic class Wt {}\n' },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('已写入磁盘')
    // 即时落盘（不再等生成结束统一写盘）；内存记账 data 仍回传
    expect(readFileSync(join(root, rel), 'utf8')).toContain('public class Wt')
    expect(r.data).toMatchObject({ __kyFileChange: true, path: rel, action: 'create' })
  })

  it('注入 writeThrough：闸门拒绝时不写盘', async () => {
    const { reg } = makeWtRegistry()
    const rel = 'src/main/java/com/x/Bad.java'
    const r = await reg.executeTool(
      'write_project_file',
      { relPath: rel, content: 'public class Bad {\n' }, // 花括号不平衡
      CTX
    )
    expect(r.ok).toBe(false)
    expect(existsSync(join(root, rel))).toBe(false)
  })

  it('writeThrough.write 抛错（EPERM 等）→ ok:false 当场打回', async () => {
    const wt = createWriteThrough({
      projectRoot: root,
      writeFile: () => {
        throw new Error('EPERM: file locked')
      }
    })
    const reg = createToolRegistry({ projectRoot: () => root, writeThrough: () => wt })
    const r = await reg.executeTool(
      'write_project_file',
      { relPath: 'src/main/java/com/x/Lock.java', content: 'public class Lock {}\n' },
      CTX
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('EPERM')
  })

  it('writeThrough 返回 null：退回攒批模式不写盘', async () => {
    const reg = createToolRegistry({ projectRoot: () => root, writeThrough: () => null })
    const rel = 'src/main/java/com/x/Null.java'
    const r = await reg.executeTool(
      'write_project_file',
      { relPath: rel, content: 'public class Null {}\n' },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('统一写盘')
    expect(existsSync(join(root, rel))).toBe(false)
  })
})
