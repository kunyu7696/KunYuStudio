import { describe, expect, it } from 'vitest'
import {
  addProjectDependency,
  defaultConfiguration,
  normalizeRepository,
  parseNotation,
  readDependencyState,
  removeDependencyFromText,
  removeProjectDependency,
  removeRepositoryFromText,
  upsertDependencyInText,
  upsertRepositoryInText
} from '../mavenDependency'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SAMPLE = `plugins {
    id 'fabric-loom' version '1.6-SNAPSHOT'
}

repositories {
    maven { url 'https://maven.aliyun.com/repository/public' }
    mavenCentral()
}

dependencies {
    minecraft "com.mojang:minecraft:1.20.1"
    modImplementation "net.fabricmc:fabric-loader:0.15.11"
}
`

function dep(notation: string, configuration: 'modImplementation' | 'implementation' = 'modImplementation') {
  const parsed = parseNotation(notation)
  if (!parsed.ok) throw new Error(parsed.error)
  return { coordinate: parsed.value, notation, configuration }
}

describe('parseNotation', () => {
  it('接受标准三元组', () => {
    expect(parseNotation('com.example:lib:1.2.3')).toEqual({
      ok: true,
      value: { group: 'com.example', artifact: 'lib', version: '1.2.3' }
    })
  })

  it('拒绝段数不足、空值、以及带引号/换行的注入串', () => {
    expect(parseNotation('com.example:lib').ok).toBe(false)
    expect(parseNotation('a:b:c:d').ok).toBe(false)
    expect(parseNotation('  ').ok).toBe(false)
    expect(parseNotation('com.example:lib:1.0"').ok).toBe(false)
    expect(parseNotation('com.example:lib:1.0\nimplementation "x:y:1"').ok).toBe(false)
    expect(parseNotation('com.example:lib:${project.version}').ok).toBe(false)
  })
})

describe('normalizeRepository', () => {
  const parseRepo = (input: string) => {
    const res = normalizeRepository(input)
    if (!res) throw new Error(`期望解析结果，实际为 null：${input}`)
    return res
  }

  it('https 地址补齐结尾斜杠', () => {
    expect(parseRepo('https://maven.example.com/repo')).toEqual({
      ok: true,
      value: 'https://maven.example.com/repo/'
    })
  })

  it('拒绝 http、内嵌凭证、查询串', () => {
    expect(parseRepo('http://maven.example.com/').ok).toBe(false)
    expect(parseRepo('https://user:pw@maven.example.com/').ok).toBe(false)
    expect(parseRepo('https://maven.example.com/?a=1').ok).toBe(false)
    expect(parseRepo('not a url').ok).toBe(false)
  })

  it('空串返回 null（表示不声明仓库）', () => {
    expect(normalizeRepository('')).toBeNull()
    expect(normalizeRepository('   ')).toBeNull()
  })
})

describe('defaultConfiguration', () => {
  it('Fabric 用 modImplementation，Forge/NeoForge 用 implementation', () => {
    expect(defaultConfiguration('fabric')).toBe('modImplementation')
    expect(defaultConfiguration('forge')).toBe('implementation')
    expect(defaultConfiguration('neoforge')).toBe('implementation')
    expect(defaultConfiguration(null)).toBe('implementation')
  })
})

describe('upsertDependencyInText', () => {
  it('插到 dependencies 块尾（闭合括号之前），缩进跟随块', () => {
    const out = upsertDependencyInText(SAMPLE, dep('com.example:lib:1.0.0'))
    expect(out.changed).toBe(true)
    expect(out.text).toContain(
      '    modImplementation "com.example:lib:1.0.0" // kunyu:dep:com.example:lib\n}'
    )
  })

  it('重复添加同一坐标是幂等的', () => {
    const first = upsertDependencyInText(SAMPLE, dep('com.example:lib:1.0.0'))
    const second = upsertDependencyInText(first.text, dep('com.example:lib:1.0.0'))
    expect(second.changed).toBe(false)
    expect(second.text).toBe(first.text)
    expect(second.text.match(/kunyu:dep:com\.example:lib/g)).toHaveLength(1)
  })

  it('换版本时原地更新而不是新增一行', () => {
    const first = upsertDependencyInText(SAMPLE, dep('com.example:lib:1.0.0'))
    const second = upsertDependencyInText(first.text, dep('com.example:lib:2.0.0'))
    expect(second.changed).toBe(true)
    expect(second.text).toContain('com.example:lib:2.0.0')
    expect(second.text).not.toContain('com.example:lib:1.0.0')
    expect(second.text.match(/kunyu:dep:com\.example:lib/g)).toHaveLength(1)
  })

  it('前缀相同的坐标互不影响（bar 与 bar-core）', () => {
    const a = upsertDependencyInText(SAMPLE, dep('com.example:bar:1.0.0'))
    const b = upsertDependencyInText(a.text, dep('com.example:bar-core:1.0.0'))
    expect(b.text.match(/kunyu:dep:com\.example:bar$/gm)).toHaveLength(1)
    const removed = removeDependencyFromText(b.text, dep('com.example:bar:1.0.0').coordinate)
    expect(readDependencyState(removed.text).dependencies.map((d) => d.coordinate.artifact)).toEqual([
      'bar-core'
    ])
  })

  it('没有 dependencies 块时在文件末尾新建', () => {
    const text = "plugins {\n    id 'java'\n}\n"
    const out = upsertDependencyInText(text, dep('com.example:lib:1.0.0'))
    expect(out.text).toContain('dependencies {\n    modImplementation "com.example:lib:1.0.0"')
    expect(out.text).toContain('}\n')
  })

  it('块尾与内容同行时拆行，不破坏结构', () => {
    const text = 'repositories { mavenCentral() }\n\ndependencies { minecraft "com.mojang:minecraft:1.20.1" }\n'
    const out = upsertDependencyInText(text, dep('com.example:lib:1.0.0'))
    expect(out.text).toContain('dependencies { minecraft "com.mojang:minecraft:1.20.1"')
    expect(out.text).toContain('    modImplementation "com.example:lib:1.0.0"')
    expect(out.text.trimEnd().endsWith('}')).toBe(true)
  })

  it('保留 CRLF 换行风格', () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n')
    const out = upsertDependencyInText(crlf, dep('com.example:lib:1.0.0'))
    expect(out.text).toContain('\r\n')
    expect(out.text.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('不碰 buildscript 里缩进更深的同名块', () => {
    const text = `buildscript {
    repositories {
        mavenCentral()
    }
    dependencies {
        classpath 'x:y:1'
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation "a:b:1"
}
`
    const out = upsertDependencyInText(text, dep('com.example:lib:1.0.0', 'implementation'))
    const lines = out.text.split('\n')
    const projectDepStart = lines.findIndex((l) => l.startsWith('dependencies {'))
    expect(lines[projectDepStart + 2].trim()).toContain('com.example:lib:1.0.0')
    expect(out.text).not.toContain('classpath \'x:y:1\'\n        implementation')
  })
})

describe('仓库读写', () => {
  it('新增仓库插到 repositories 块尾且去重', () => {
    const first = upsertRepositoryInText(SAMPLE, 'https://maven.example.com/repo/')
    expect(first.changed).toBe(true)
    expect(first.text).toContain("maven { url = 'https://maven.example.com/repo/' } // kunyu:maven:https://maven.example.com/repo/")
    const second = upsertRepositoryInText(first.text, 'https://maven.example.com/repo/')
    expect(second.changed).toBe(false)
  })

  it('撤销仓库只删自己的标记行', () => {
    const added = upsertRepositoryInText(SAMPLE, 'https://maven.example.com/repo/')
    const removed = removeRepositoryFromText(added.text, 'https://maven.example.com/repo/')
    expect(removed.changed).toBe(true)
    expect(removed.text).toBe(SAMPLE)
  })
})

describe('readDependencyState', () => {
  it('只列出带标记的依赖，用户手写依赖不参与', () => {
    const added = upsertDependencyInText(SAMPLE, dep('com.example:lib:1.0.0'))
    const state = readDependencyState(added.text)
    expect(state.dependencies).toEqual([
      {
        coordinate: { group: 'com.example', artifact: 'lib', version: '1.0.0' },
        notation: 'com.example:lib:1.0.0',
        configuration: 'modImplementation'
      }
    ])
    expect(state.repositories).toEqual([])
  })

  it('用户手改版本后以磁盘行为准（标记只认坐标）', () => {
    const added = upsertDependencyInText(SAMPLE, dep('com.example:lib:1.0.0'))
    const edited = added.text.replace('com.example:lib:1.0.0', 'com.example:lib:9.9.9')
    expect(readDependencyState(edited).dependencies[0].notation).toBe('com.example:lib:9.9.9')
  })

  it('标记坐标与声明坐标不一致时跳过（防手工误改）', () => {
    const broken = SAMPLE.replace(
      '    modImplementation "net.fabricmc:fabric-loader:0.15.11"',
      '    modImplementation "com.example:other:1.0" // kunyu:dep:com.example:lib'
    )
    expect(readDependencyState(broken).dependencies).toEqual([])
  })
})

describe('文件级操作', () => {
  it('add / remove 往返后文件恢复原样', () => {
    const root = mkdtempSync(join(tmpdir(), 'ky-dep-'))
    writeFileSync(join(root, 'build.gradle'), SAMPLE, 'utf8')
    try {
      const added = addProjectDependency(
        root,
        { notation: 'com.example:lib:1.0.0', repository: 'https://maven.example.com/repo' },
        'fabric'
      )
      expect(added.ok).toBe(true)
      if (!added.ok) return
      expect(added.changed).toBe(true)
      expect(added.state.dependencies).toHaveLength(1)
      expect(added.state.repositories).toEqual(['https://maven.example.com/repo/'])

      const removedDep = removeProjectDependency(root, 'com.example:lib:1.0.0')
      expect(removedDep.ok).toBe(true)
      if (!removedDep.ok) return
      expect(removedDep.state.dependencies).toEqual([])
      // 依赖撤销后仓库仍在（仓库是独立声明，需单独撤销）
      expect(removedDep.state.repositories).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('缺少 build.gradle 时给出明确错误且不写盘', () => {
    const root = mkdtempSync(join(tmpdir(), 'ky-dep-'))
    try {
      const res = addProjectDependency(root, { notation: 'a:b:1' }, 'fabric')
      expect(res.ok).toBe(false)
      if (res.ok) return
      expect(res.error).toContain('build.gradle')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('注入失败（非法坐标）时文件保持不变', () => {
    const root = mkdtempSync(join(tmpdir(), 'ky-dep-'))
    const file = join(root, 'build.gradle')
    writeFileSync(file, SAMPLE, 'utf8')
    try {
      const res = addProjectDependency(root, { notation: 'com.example:lib:1.0" }' }, 'fabric')
      expect(res.ok).toBe(false)
      expect(readFileSync(file, 'utf8')).toBe(SAMPLE)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
