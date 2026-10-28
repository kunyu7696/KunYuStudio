/**
 * 端到端静态分析服务测试：
 * - 注入假 javap：稳定验证 jar→画像 的完整装配（不依赖真实 javap）
 * - 真实 javac/jar：条件可用时验证真实字节码管线
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../settingsService', () => ({
  getSection: () => ({ globalJdkHome: null })
}))
import { analyzeJar } from '../performance/staticAnalyzer'
import type { JavapBridge, ParsedClass } from '../performance/javapBridge'
import type { Instruction } from '../performance/javapBridge'

const FABRIC = JSON.stringify({
  id: 'testmod',
  version: '0.1.0',
  depends: { fabricloader: '>=0.15', minecraft: '1.20.1', 'fabric-api': '*' }
})

/** store-only jar 构造（同 modMetadata 夹具） */
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

function fakeJavap(parsed: ParsedClass[]): JavapBridge {
  return { analyze: () => parsed }
}

function writeTempJar(buffer: Buffer): string {
  const dir = join(tmpdir(), `perf-analyzer-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'testmod.jar')
  writeFileSync(file, buffer)
  return file
}

function parsedCleanClass(name: string): ParsedClass {
  return {
    name,
    superClass: null,
    interfaces: [],
    isInterface: false,
    methods: [],
    fields: [],
    classAnnotations: []
  }
}

describe('analyzeJar（注入假 javap）', () => {
  const jar = buildJar([
    { name: 'fabric.mod.json', data: FABRIC },
    { name: 'com/test/Foo.class', data: 'fake' }
  ])
  const jarPath = writeTempJar(jar)

  it('identity 与静态结构正确，无规则命中时满分', () => {
    const profile = analyzeJar({
      jarPath,
      loader: 'fabric',
      mcVersion: '1.20.1',
      javap: fakeJavap([parsedCleanClass('com.test.Foo')])
    })
    expect(profile.identity).toMatchObject({
      modId: 'testmod',
      version: '0.1.0',
      loader: 'fabric',
      mcVersion: '1.20.1',
      modName: 'testmod'
    })
    expect(profile.identity.fileHash).toMatch(/^[a-f0-9]{64}$/)
    expect(profile.staticFeatures.classCount).toBe(1)
    expect(profile.staticFeatures.dependencies.hardDeps).toEqual(['fabric-api'])
    expect(profile.score.scores.overall).toBe(100)
    expect(profile.score.severity).toBe('good')
    expect(profile.advice).toEqual([])
    expect(profile.dynamicMetrics).toBeNull()
  })

  it('有 R01 命中时评分与建议落位', () => {
    const sleepInstr: Instruction = {
      opcode: 'invokestatic',
      rawArg: '#7',
      ref: 'Method java/lang/Thread.sleep:(J)V'
    }
    const problemClass: ParsedClass = {
      ...parsedCleanClass('com.test.M'),
      methods: [
        {
          name: 'doIt',
          descriptor: '()V',
          isStatic: false,
          isSynchronized: false,
          isNative: false,
          instructions: [sleepInstr],
          annotations: [
            { type: 'org.spongepowered.asm.mixin.injection.Inject', params: '' }
          ]
        }
      ]
    }
    const profile = analyzeJar({
      jarPath,
      loader: 'fabric',
      mcVersion: '1.20.1',
      javap: fakeJavap([problemClass])
    })
    expect(profile.score.scores.overall).toBe(65)
    expect(profile.score.severity).toBe('warn')
    expect(profile.advice).toHaveLength(1)
    expect(profile.advice[0]).toMatchObject({
      ruleId: 'R01',
      severity: 'critical',
      action: 'manual'
    })
    expect(profile.staticFeatures.bytecode.mainThreadBlockingCalls).toBe(1)
  })

  it('onProgress 不被调用（假 javap 自行决定）', () => {
    const progress: number[] = []
    analyzeJar({
      jarPath,
      loader: 'fabric',
      mcVersion: '1.20.1',
      javap: fakeJavap([]),
      onProgress: (p) => progress.push(p.batch)
    })
    expect(progress).toEqual([])
  })
})

describe('真实字节码管线（javac + jar，条件执行）', () => {
  const javaHome = 'C:\\Program Files\\Java\\jdk-17'

  it('编译真实 class 并端到端分析', () => {
    const javac = join(javaHome, 'bin', 'javac.exe')
    const jarTool = join(javaHome, 'bin', 'jar.exe')
    if (!existsSync(javac) || !existsSync(jarTool)) return

    const dir = join(tmpdir(), `perf-real-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, 'Real.java'), 'public class Real { public int add(int a, int b) { return a + b; } }')
      writeFileSync(
        join(dir, 'fabric.mod.json'),
        JSON.stringify({ id: 'realmod', version: '1.0.0' })
      )
      execFileSync(javac, ['Real.java'], { cwd: dir })
      execFileSync(jarTool, ['cf', 'realmod.jar', 'fabric.mod.json', 'Real.class'], { cwd: dir })

      const profile = analyzeJar({
        jarPath: join(dir, 'realmod.jar'),
        loader: 'fabric',
        mcVersion: '1.20.1'
      })
      expect(profile.identity.modId).toBe('realmod')
      expect(profile.staticFeatures.classCount).toBe(1)
      const real = profile.staticFeatures
      expect(real.classCount).toBe(1)
      expect(profile.score.scores.overall).toBe(100)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
