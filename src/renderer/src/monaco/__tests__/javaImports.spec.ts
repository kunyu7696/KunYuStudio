import { describe, expect, it } from 'vitest'
import {
  buildImportEdit,
  collectUnresolvedTypeNames,
  isCoveredByWildcard,
  stripJavaCommentsAndStrings,
  unresolvedSignature
} from '../javaImports'

describe('stripJavaCommentsAndStrings', () => {
  it('抹掉行注释与块注释但保留长度和换行', () => {
    const src = '// hello\nint a; /* x\ny */ int b;'
    const out = stripJavaCommentsAndStrings(src)
    expect(out).toHaveLength(src.length)
    expect(out.startsWith(' ')).toBe(true)
    const srcLines = src.split('\n')
    const outLines = out.split('\n')
    expect(outLines).toHaveLength(srcLines.length)
    outLines.forEach((line, i) => expect(line).toHaveLength(srcLines[i].length))
    // 注释文本消失，注释外代码保留
    expect(out.includes('hello')).toBe(false)
    expect(outLines[1].startsWith('int a;')).toBe(true)
    expect(outLines[2].endsWith('int b;')).toBe(true)
    expect(outLines[2].includes('y')).toBe(false)
    // 换行位置不变 → 行号对齐
    expect(out.indexOf('\n')).toBe(src.indexOf('\n'))
  })

  it('抹掉字符串/字符字面量内容，保留引号位与转义', () => {
    const src = 'String s = "Identifier"; char c = \'A\';'
    const out = stripJavaCommentsAndStrings(src)
    expect(out).toHaveLength(src.length)
    expect(out.includes('Identifier')).toBe(false)
    // 标识符正则不应从字符串里捞出东西
    const info = collectUnresolvedTypeNames(out)
    expect(info.unresolved.find((u) => u.name === 'Identifier')).toBeUndefined()
  })

  it('支持文本块（Java 17）且保留内部换行', () => {
    const src = 'const x = """\nIdentifier Bar\n""";'
    const out = stripJavaCommentsAndStrings(src)
    expect(out).toHaveLength(src.length)
    expect(out.includes('Bar')).toBe(false)
    expect(out.split('\n')).toHaveLength(3)
  })
})

describe('collectUnresolvedTypeNames', () => {
  it('捕获缺失类型与注解，并给出首次出现位置', () => {
    const src = `
package com.demo;

import com.demo.Other;

@Nullable
class Demo {
  Identifier id;
  void run(Other o) {}
}
`
    const info = collectUnresolvedTypeNames(stripJavaCommentsAndStrings(src))
    expect(info.packageName).toBe('com.demo')
    const names = info.unresolved.map((u) => u.name)
    expect(names).toContain('Identifier')
    expect(names).toContain('Nullable')
    expect(names).not.toContain('Other')
    expect(names).not.toContain('Demo')
    const id = info.unresolved.find((u) => u.name === 'Identifier')!
    expect(id.lineNumber).toBe(8)
    expect(src.split('\n')[id.lineNumber - 1].slice(id.column - 1).startsWith('Identifier')).toBe(true)
  })

  it('五重排除：java.lang/本文件类/已import/单字母泛型/全大写常量', () => {
    const src = `
package com.demo;
import java.util.List;
class Demo<T> {
  static final String MOD_ID = "x";
  T value;
  List<Map> maps;
  Integer n;
  Logger logger;
}
`
    const info = collectUnresolvedTypeNames(stripJavaCommentsAndStrings(src))
    const names = info.unresolved.map((u) => u.name)
    expect(names).toEqual(['Map', 'Logger'])
  })

  it('不把限定名后缀当未解析类型（foo.Bar / Map.Entry）', () => {
    const src = `
class Demo {
  void a() { util.Helper.run(); Map.Entry<String,String> e = null; }
}
`
    const info = collectUnresolvedTypeNames(stripJavaCommentsAndStrings(src))
    const names = info.unresolved.map((u) => u.name)
    expect(names).toContain('Map')
    expect(names).not.toContain('Entry')
    expect(names).not.toContain('Helper')
  })

  it('收集通配 import 包前缀，候选可由 isCoveredByWildcard 过滤', () => {
    const src = 'package com.demo;\nimport java.util.*;\nclass Demo { List<Foo> a; }'
    const info = collectUnresolvedTypeNames(stripJavaCommentsAndStrings(src))
    expect(info.wildcardPackages).toEqual(['java.util.'])
    expect(isCoveredByWildcard('java.util.List', info.wildcardPackages)).toBe(true)
    expect(isCoveredByWildcard('net.minecraft.Foo', info.wildcardPackages)).toBe(false)
    // List 本身仍会被收集（渲染层在拿到索引候选后才做通配过滤）
    expect(info.unresolved.map((u) => u.name)).toContain('List')
  })

  it('同名只保留首次出现位置；签名稳定', () => {
    const src = 'class D { Foo a; Foo b; Bar c; }'
    const info = collectUnresolvedTypeNames(stripJavaCommentsAndStrings(src))
    expect(info.unresolved.map((u) => u.name)).toEqual(['Foo', 'Bar'])
    expect(unresolvedSignature(info.unresolved.map((u) => u.name))).toBe('Bar,Foo')
  })
})

describe('buildImportEdit', () => {
  const apply = (src: string, fqcn: string): string => {
    const edit = buildImportEdit(src, fqcn)!
    const lines = src.split(/\r?\n/)
    const line = lines[edit.range.startLineNumber - 1]
    const before = line.slice(0, edit.range.startColumn - 1)
    const after = line.slice(edit.range.endColumn - 1)
    lines[edit.range.startLineNumber - 1] = before + edit.text + after
    return lines.join('\n')
  }

  it('有 import 区：按字典序插入中间', () => {
    const src = 'package com.demo;\n\nimport com.a.A;\nimport com.c.C;\n\nclass D {}\n'
    const out = apply(src, 'com.b.B')
    expect(out).toBe(
      'package com.demo;\n\nimport com.a.A;\nimport com.b.B;\nimport com.c.C;\n\nclass D {}\n'
    )
  })

  it('有 import 区：排在所有 import 之后时追加到末行', () => {
    const src = 'package com.demo;\n\nimport com.a.A;\n\nclass D {}\n'
    const out = apply(src, 'com.z.Z')
    expect(out).toBe('package com.demo;\n\nimport com.a.A;\nimport com.z.Z;\n\nclass D {}\n')
  })

  it('已存在相同 fqcn 返回 null', () => {
    const src = 'import com.a.A;\nclass D {}'
    expect(buildImportEdit(src, 'com.a.A')).toBeNull()
  })

  it('无 import 区但有 package：package 后空一行插入', () => {
    const src = 'package com.demo;\n\nclass D {}\n'
    const out = apply(src, 'net.minecraft.util.Identifier')
    expect(out).toBe(
      'package com.demo;\n\nimport net.minecraft.util.Identifier;\n\nclass D {}\n'
    )
  })

  it('连 package 都没有：插文件首', () => {
    const src = 'class D {}\n'
    const out = apply(src, 'com.a.A')
    expect(out).toBe('import com.a.A;\n\nclass D {}\n')
  })

  it('非法 fqcn 返回 null', () => {
    expect(buildImportEdit('class D {}', 'NoPackageName')).toBeNull()
    expect(buildImportEdit('class D {}', 'a.b..c')).toBeNull()
  })
})
