/**
 * edit_project_file FC 工具单测（工作流 A：既有文件增量编辑）：
 * 读盘精确匹配 → 原地替换 → 其余部分不动；未命中/多处命中回传给模型自纠；
 * 编辑后仍过同一套闸门（路径/扩展名/自动生成资源禁写/花括号配平/JSON 解析），
 * 产物经 __kyFileChange 回填 generatePipeline 的 toolWrittenFiles。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'
import { createWriteThrough } from '../orchestrator/writeThrough'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

let root: string
let registry: ToolRegistry

/** 预置一个盘上文件并返回其项目相对路径 */
function seed(rel: string, content: string): string {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return rel
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-epf-'))
  registry = createToolRegistry({ projectRoot: () => root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function run(args: Record<string, unknown>): Promise<ToolResult> {
  return registry.executeTool('edit_project_file', args, CTX)
}

describe('edit_project_file', () => {
  it('已注册为 chat 工具；无项目时不暴露', () => {
    const names = registry.getToolDefinitions().map((d) => d.function.name)
    expect(names).toContain('edit_project_file')
    const noProject = createToolRegistry({})
    expect(noProject.getToolDefinitions().map((d) => d.function.name)).not.toContain(
      'edit_project_file'
    )
  })

  it('精确匹配原地替换：文件其余部分一字不动；data 回传编辑后全文（action=modify）', async () => {
    const rel = seed(
      'src/main/java/com/x/A.java',
      'package com.x;\npublic class A {\n    int a = 1;\n}\n'
    )
    const r = await run({
      relPath: rel,
      search: '    int a = 1;',
      replace: '    int a = 42;\n    int b = 7;'
    })
    expect(r.ok).toBe(true)
    const data = r.data as { __kyFileChange: boolean; path: string; action: string; content: string }
    expect(data).toMatchObject({ __kyFileChange: true, path: rel, action: 'modify' })
    expect(data.content).toBe(
      'package com.x;\npublic class A {\n    int a = 42;\n    int b = 7;\n}\n'
    )
    // 未注入 writeThrough：只登记不落盘（统一落盘在生成阶段结束）
    expect(readFileSync(join(root, rel), 'utf8')).toContain('int a = 1;')
  })

  it('未命中：ok=false 并回传最近邻行号（模型据此修正 search）', async () => {
    const rel = seed(
      'src/main/java/com/x/B.java',
      'package com.x;\npublic class B {\n    int value = 3;\n}\n'
    )
    const r = await run({
      relPath: rel,
      search: '    int value = 99;',
      replace: '    int value = 4;'
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('中命中')
    expect(r.error).toContain('第 3 行')
  })

  it('精确匹配多处：拒绝并要求补充上下文', async () => {
    const rel = seed(
      'src/main/resources/a.properties',
      'key = v\nother = v\nkey = v\n'
    )
    const r = await run({ relPath: rel, search: 'key = v', replace: 'key = w' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('命中 2 处')
  })

  it('行尾空白宽松兜底：跨行 search 少带行尾空格仍能唯一命中', async () => {
    const rel = seed(
      'src/main/java/com/x/C.java',
      'package com.x;\npublic class C {\n    int a = 1;   \n    int b = 2;\n}\n'
    )
    const r = await run({
      relPath: rel,
      search: '    int a = 1;\n    int b = 2;',
      replace: '    int a = 11;\n    int b = 2;'
    })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('宽松匹配')
    const content = (r.data as { content: string }).content
    expect(content).toContain('    int a = 11;\n')
  })

  it('CRLF 文件：匹配与回写保持文件原有 CRLF 行尾', async () => {
    const rel = seed(
      'src/main/java/com/x/D.java',
      'package com.x;\r\npublic class D {\r\n    int a = 1;\r\n}\r\n'
    )
    const r = await run({ relPath: rel, search: '    int a = 1;\n', replace: '    int a = 2;\n' })
    expect(r.ok).toBe(true)
    const content = (r.data as { content: string }).content
    expect(content).toContain('    int a = 2;\r\n')
    expect(/(?<!\r)\n/.test(content)).toBe(false)
  })

  it('CRLF 格式的 search 在 LF 文件上同样命中', async () => {
    const rel = seed('src/main/java/com/x/E.java', 'package com.x;\npublic class E {\n    int a = 1;\n}\n')
    const r = await run({ relPath: rel, search: '    int a = 1;\r\n', replace: '    int a = 3;' })
    expect(r.ok).toBe(true)
  })

  it('编辑后 Java 花括号不平衡：当场拒绝且不落盘', async () => {
    const wt = createWriteThrough({
      projectRoot: root,
      writeFile: (abs, content) => writeFileSync(abs, content, 'utf8')
    })
    const reg = createToolRegistry({ projectRoot: () => root, writeThrough: () => wt })
    const rel = seed(
      'src/main/java/com/x/F.java',
      'package com.x;\npublic class F {\n    void f() {\n    }\n}\n'
    )
    const r = await reg.executeTool(
      'edit_project_file',
      { relPath: rel, search: '    void f() {\n    }', replace: '    void f() {\n    }\n    }' },
      CTX
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('花括号不平衡')
    expect(readFileSync(join(root, rel), 'utf8')).toContain('    void f() {\n')
  })

  it('编辑后 JSON 解析失败：拒绝', async () => {
    const rel = seed('src/main/resources/assets/x/lang/zh_cn.json', '{\n  "a": 1\n}\n')
    const r = await run({ relPath: rel, search: '"a": 1', replace: '"a": 1,' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('JSON 解析失败')
  })

  it('文件不存在：拒绝并提示改用 write_project_file', async () => {
    const r = await run({
      relPath: 'src/main/java/com/x/Missing.java',
      search: 'x',
      replace: 'y'
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('文件不存在')
    expect(r.error).toContain('write_project_file')
  })

  it('search 为空 / search==replace 拒绝', async () => {
    seed('src/main/java/com/x/G.java', 'package com.x;\npublic class G {}\n')
    expect((await run({ relPath: 'src/main/java/com/x/G.java', search: '', replace: 'x' })).ok).toBe(
      false
    )
    const same = await run({ relPath: 'src/main/java/com/x/G.java', search: 'G', replace: 'G' })
    expect(same.ok).toBe(false)
    expect(same.error).toContain('不产生变化')
  })

  it('replace 含 TODO/占位符拒绝（既有文件中的 TODO 不影响本片段编辑）', async () => {
    seed('src/main/java/com/x/H.java', 'package com.x;\n// TODO: old\npublic class H {\n}\n')
    const bad = await run({
      relPath: 'src/main/java/com/x/H.java',
      search: 'public class H {',
      replace: 'public class H { // TODO: impl'
    })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('TODO')
    const ok = await run({
      relPath: 'src/main/java/com/x/H.java',
      search: 'public class H {',
      replace: 'public class H {\n    int a = 1;'
    })
    expect(ok.ok).toBe(true)
  })

  it.each([
    ['盘符绝对路径', 'C:/evil/Foo.java'],
    ['UNC/前导斜杠', '//server/share/Foo.java'],
    ['父目录越界', 'src/../../evil/Foo.java'],
    ['空路径', '']
  ])('拒绝非法路径：%s', async (_label, relPath) => {
    const r = await run({ relPath, search: 'x', replace: 'y' })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it.each(['png', 'jar', 'sh', 'zip'])('扩展名白名单拒绝 .%s', async (ext) => {
    const r = await run({ relPath: `src/main/x.${ext}`, search: 'x', replace: 'y' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('扩展名')
  })

  it('Gradle 构建脚本禁写', async () => {
    seed('build.gradle', 'plugins {}\n')
    const r = await run({ relPath: 'build.gradle', search: 'plugins {}', replace: 'plugins { id "x" }' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('构建脚本')
  })

  it('模组项目禁改自动生成资源（blockstates/models/lang/tags）', async () => {
    const rel = 'src/main/resources/assets/demo/lang/zh_cn.json'
    seed(rel, '{\n  "a": "b"\n}\n')
    const modRegistry = createToolRegistry({ projectRoot: () => root, projectType: () => 'mod' })
    const r = await modRegistry.executeTool(
      'edit_project_file',
      { relPath: rel, search: '"a": "b"', replace: '"a": "c"' },
      CTX
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('content_upsert')
  })
})

describe('edit_project_file · T1 write-through 模式', () => {
  it('注入 writeThrough：闸门全过立即写盘，文案提示工作台可见', async () => {
    const rel = seed(
      'src/main/java/com/x/Wt.java',
      'package com.x;\npublic class Wt {\n    int a = 1;\n}\n'
    )
    const wt = createWriteThrough({
      projectRoot: root,
      writeFile: (abs, content) => writeFileSync(abs, content, 'utf8')
    })
    const reg = createToolRegistry({ projectRoot: () => root, writeThrough: () => wt })
    const r = await reg.executeTool(
      'edit_project_file',
      { relPath: rel, search: '    int a = 1;', replace: '    int a = 5;' },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('已编辑并写入磁盘')
    expect(readFileSync(join(root, rel), 'utf8')).toContain('    int a = 5;')
    // 快照保留编辑前原文（T2 对比/回滚用）
    expect(wt.snapshotOf(rel)).toContain('    int a = 1;')
  })

  it('writeThrough.write 抛错 → ok:false 当场打回且文件未被改动', async () => {
    const rel = seed(
      'src/main/java/com/x/Lock.java',
      'package com.x;\npublic class Lock {\n    int a = 1;\n}\n'
    )
    const wt = createWriteThrough({
      projectRoot: root,
      writeFile: () => {
        throw new Error('EPERM: file locked')
      }
    })
    const reg = createToolRegistry({ projectRoot: () => root, writeThrough: () => wt })
    const r = await reg.executeTool(
      'edit_project_file',
      { relPath: rel, search: '    int a = 1;', replace: '    int a = 6;' },
      CTX
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('EPERM')
    expect(readFileSync(join(root, rel), 'utf8')).toContain('    int a = 1;')
  })

  it('无打开项目时工具不执行', async () => {
    const empty = createToolRegistry({})
    const r = await empty.executeTool(
      'edit_project_file',
      { relPath: 'a.java', search: 'x', replace: 'y' },
      CTX
    )
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/不可用|项目/)
  })
})

describe('edit_project_file · P1 四遍递减严格度与多片段编辑', () => {
  it('两侧空白宽松（第 2 档）：行首缩进与原文不一致仍唯一命中', async () => {
    const rel = seed(
      'src/main/java/com/x/Trim.java',
      'package com.x;\npublic class Trim {\n  int a = 1;\n}\n'
    )
    // 文件是 2 空格缩进，search 给 4 空格：精确档与行尾空白档均不中，两侧空白档命中
    const r = await run({ relPath: rel, search: '    int a = 1;', replace: '    int a = 2;' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('宽松匹配')
    expect((r.data as { content: string }).content).toContain('    int a = 2;')
  })

  it('Unicode 标点归一（第 3 档）：模型用长破折号仍命中 ASCII 原文', async () => {
    const rel = seed('src/main/resources/note.properties', 'label -- value\n')
    const r = await run({ relPath: rel, search: 'label —— value', replace: 'label -=- value' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('宽松匹配')
    expect((r.data as { content: string }).content).toBe('label -=- value\n')
  })

  it('edits 多片段：一次提交多处改动，自底向上应用互不影响', async () => {
    const rel = seed(
      'src/main/java/com/x/Multi.java',
      'package com.x;\npublic class Multi {\n    int a = 1;\n    int b = 2;\n}\n'
    )
    const r = await run({
      relPath: rel,
      edits: [
        { search: '    int a = 1;', replace: '    int a = 10;' },
        { search: '    int b = 2;', replace: '    int b = 20;' }
      ]
    })
    expect(r.ok).toBe(true)
    expect((r.data as { content: string }).content).toBe(
      'package com.x;\npublic class Multi {\n    int a = 10;\n    int b = 20;\n}\n'
    )
    expect(r.text).toContain('2 处替换')
  })

  it('edits 中任一未命中：整批拒绝且不写盘（原子性）', async () => {
    const rel = seed(
      'src/main/java/com/x/Atomic.java',
      'package com.x;\npublic class Atomic {\n    int a = 1;\n}\n'
    )
    const wt = createWriteThrough({
      projectRoot: root,
      writeFile: (abs, content) => writeFileSync(abs, content, 'utf8')
    })
    const reg = createToolRegistry({ projectRoot: () => root, writeThrough: () => wt })
    const r = await reg.executeTool(
      'edit_project_file',
      {
        relPath: rel,
        edits: [
          { search: '    int a = 1;', replace: '    int a = 9;' },
          { search: '    int zz = 0;', replace: '    int zz = 1;' }
        ]
      },
      CTX
    )
    expect(r.ok).toBe(false)
    expect(r.error).toContain('edits[1]')
    expect(readFileSync(join(root, rel), 'utf8')).toContain('    int a = 1;')
    expect(wt.snapshotOf(rel)).toBeUndefined()
  })

  it('edits 区间重叠：拒绝', async () => {
    const rel = seed(
      'src/main/java/com/x/Overlap.java',
      'package com.x;\npublic class Overlap {\n    int abcdef = 1;\n}\n'
    )
    const r = await run({
      relPath: rel,
      edits: [
        { search: '    int abcd', replace: '    int AB' },
        { search: 'abcdef = 1;', replace: 'abcdef = 2;' }
      ]
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('重叠')
  })

  it('edits 入参非法：空数组/非字符串 search 均拒绝', async () => {
    seed('src/main/java/com/x/Bad.java', 'package com.x;\npublic class Bad {}\n')
    const empty = await run({ relPath: 'src/main/java/com/x/Bad.java', edits: [] })
    expect(empty.ok).toBe(false)
    expect(empty.error).toBeTruthy()
    const bad = await run({
      relPath: 'src/main/java/com/x/Bad.java',
      edits: [{ search: '', replace: 'x' }]
    })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('edits[0]')
  })
})
