/**
 * fabric.mod.json 与 Mixin 配置解析测试。
 */
import { describe, expect, it } from 'vitest'
import {
  extractModMetadata,
  parseFabricModJson,
  parseMixinConfig
} from '../performance/modMetadata'
import { openZipBuffer } from '../performance/jarReader'

const FABRIC_JSON = JSON.stringify({
  schemaVersion: 1,
  id: 'mymod',
  version: '1.2.3',
  name: 'My Mod',
  depends: {
    fabricloader: '>=0.15',
    minecraft: '1.20.1',
    java: '>=17',
    'fabric-api': '*',
    otherlib: '>=2.0'
  },
  recommends: { anothermod: '*' },
  suggests: { optmod: '*', anothermod: '*' },
  mixins: [
    'mymod.mixins.json',
    { config: 'mymod.client.mixins.json', environment: 'client' }
  ]
})

const MIXINS_JSON = JSON.stringify({
  package: 'com.example.mixin',
  compatibilityLevel: 'JAVA_17',
  mixins: [
    'FooMixin',
    { target: 'net.minecraft.Foo', mixins: ['BarMixin'] }
  ]
})

const CLIENT_MIXINS_JSON = JSON.stringify({
  package: 'com.example.mixin.client',
  client: ['ClientFoo']
})

describe('parseFabricModJson', () => {
  it('解析基础字段', () => {
    const info = parseFabricModJson(FABRIC_JSON)
    expect(info.modId).toBe('mymod')
    expect(info.modName).toBe('My Mod')
    expect(info.version).toBe('1.2.3')
  })

  it('硬依赖排除系统键，软依赖 recommends+suggests 去重', () => {
    const info = parseFabricModJson(FABRIC_JSON)
    expect(info.hardDeps).toEqual(['fabric-api', 'otherlib'])
    expect(info.softDeps).toEqual(['anothermod', 'optmod'])
  })

  it('mixin 引用支持字符串与对象两种形式', () => {
    const info = parseFabricModJson(FABRIC_JSON)
    expect(info.mixinConfigs).toEqual([
      { path: 'mymod.mixins.json', environment: '*' },
      { path: 'mymod.client.mixins.json', environment: 'client' }
    ])
  })

  it('缺 id 抛错', () => {
    expect(() => parseFabricModJson('{"version":"1"}')).toThrow(/id/)
  })
})

describe('parseMixinConfig', () => {
  it('字符串条目与对象条目（含 target）', () => {
    const cfg = parseMixinConfig('mymod.mixins.json', MIXINS_JSON, 'main')
    expect(cfg.entries).toEqual([
      { mixinClass: 'com.example.mixin.FooMixin', target: null },
      { mixinClass: 'com.example.mixin.BarMixin', target: 'net.minecraft.Foo' }
    ])
  })

  it('client 环境读取 client 数组', () => {
    const cfg = parseMixinConfig('c.json', CLIENT_MIXINS_JSON, 'client')
    expect(cfg.entries).toEqual([
      { mixinClass: 'com.example.mixin.client.ClientFoo', target: null }
    ])
  })

  it('缺 package 抛错', () => {
    expect(() => parseMixinConfig('x.json', '{}', 'main')).toThrow(/package/)
  })
})

describe('extractModMetadata（内存 jar）', () => {
  /** 构造 store-only 内存 jar */
  function buildJar(files: Array<{ name: string; data: string }>): Buffer {
    const localParts: Buffer[] = []
    const centralParts: Buffer[] = []
    const metas: Array<{ size: number; offset: number }> = []
    let offset = 0
    for (const f of files) {
      const data = Buffer.from(f.data, 'utf8')
      const nameBuf = Buffer.from(f.name, 'utf8')
      metas.push({ size: data.length, offset })
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(nameBuf.length, 26)
      localParts.push(local, nameBuf, data)
      offset += 30 + nameBuf.length + data.length
    }
    let centralSize = 0
    files.forEach((f, i) => {
      const nameBuf = Buffer.from(f.name, 'utf8')
      const m = metas[i]!
      const central = Buffer.alloc(46)
      central.writeUInt32LE(0x02014b50, 0)
      central.writeUInt16LE(nameBuf.length, 28)
      central.writeUInt32LE(m.size, 20)
      central.writeUInt32LE(m.size, 24)
      central.writeUInt32LE(m.offset, 42)
      centralParts.push(central, nameBuf)
      centralSize += 46 + nameBuf.length
    })
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(files.length, 8)
    eocd.writeUInt16LE(files.length, 10)
    eocd.writeUInt32LE(centralSize, 12)
    eocd.writeUInt32LE(offset, 16)
    return Buffer.concat([...localParts, ...centralParts, eocd])
  }

  const jar = buildJar([
    { name: 'fabric.mod.json', data: FABRIC_JSON },
    { name: 'mymod.mixins.json', data: MIXINS_JSON },
    { name: 'mymod.client.mixins.json', data: CLIENT_MIXINS_JSON },
    { name: 'com/example/Foo.class', data: 'fake' },
    { name: 'com/example/Bar.class', data: 'fake' }
  ])

  it('端到端提取元数据、Mixin 与 class 计数', () => {
    const summary = extractModMetadata(openZipBuffer(jar))
    expect(summary.fabric.modId).toBe('mymod')
    expect(summary.classCount).toBe(2)
    expect(summary.mixins).toHaveLength(2)
    expect(summary.mixins[0]?.entries[1]?.target).toBe('net.minecraft.Foo')
    expect(summary.mixins[1]?.environment).toBe('client')
  })

  it('非 Fabric jar 抛错', () => {
    const plain = buildJar([{ name: 'readme.txt', data: 'hi' }])
    expect(() => extractModMetadata(openZipBuffer(plain))).toThrow(/fabric.mod.json/)
  })
})
