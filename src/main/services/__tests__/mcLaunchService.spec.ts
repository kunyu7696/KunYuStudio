/**
 * 零配置运行环境 3b：托管实例启动接线单测。
 * 覆盖：启动参数拼装（classpath / natives 解包）、JDK 缺失分支、注入 spawn 成功启动、
 * 以及实例缺失/未置备的错误分支。不联网、不真正 spawn。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'kunyu-mc-launch-test') },
  safeStorage: { isEncryptionAvailable: () => false }
}))

import { buildManagedLaunchSpec, launchManagedInstance } from '../mcLaunchService'
import { platformMcArch, platformOsName } from '../mcLaunchSpec'

/** 构造一个只含单个 stored(0) 条目的最小合法 zip（natives jar 用） */
function makeStoredZip(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf8')
  const local = Buffer.alloc(30 + nameBuf.length)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(0, 14) // crc（解包不校验）
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  nameBuf.copy(local, 30)

  const central = Buffer.alloc(46 + nameBuf.length)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt32LE(0, 16)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE(0, 42) // localOffset（仅一个条目，恒为 0）
  nameBuf.copy(central, 46)

  const cdOffset = local.length + data.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(cdOffset, 16)
  return Buffer.concat([local, data, central, eocd])
}

const os = platformOsName()
const arch = platformMcArch()
/** natives 分类器中 ${arch} 的展开值：x64→64 / arm64→arm64 / x86→32 */
const archToken = arch === 'x64' ? '64' : arch === 'arm64' ? 'arm64' : '32'
const LOADER_CLASSIFIER = `natives-${os}-${archToken}`

function versionDetail(): Record<string, unknown> {
  return {
    id: '1.21.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: '17',
    assetIndex: { id: '17', sha1: 'x'.repeat(40), size: 999, totalSize: 1000, url: 'u' },
    downloads: { client: { url: 'c', sha1: 'a'.repeat(40), size: 1 } },
    libraries: [
      {
        name: 'org.ow2.asm:asm:9.6',
        downloads: {
          artifact: { url: 'a', path: 'org/ow2/asm/asm/9.6/asm-9.6.jar', sha1: 'b'.repeat(40), size: 2 }
        }
      },
      {
        name: 'org.lwjgl:lwjgl:3.3.3',
        downloads: {
          artifact: { url: 'l', path: 'org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar', size: 3 },
          classifiers: {
            [LOADER_CLASSIFIER]: {
              url: 'n',
              path: `org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-${LOADER_CLASSIFIER}.jar`,
              size: 4
            }
          }
        },
        natives: { [os]: `natives-${os}-\${arch}` }
      }
    ],
    arguments: {
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
      game: ['--username', '${auth_player_name}', '--assetsDir', '${assets_root}']
    },
    javaVersion: { majorVersion: 21, component: 'java-runtime-delta' }
  }
}

/** 造一个已置备的托管实例目录树 */
function makeInstance(root: string, id = '1.21.1'): string {
  const inst = join(root, id)
  mkdirSync(join(inst, 'versions', id), { recursive: true })
  mkdirSync(join(inst, 'libraries', 'org/ow2/asm/asm/9.6'), { recursive: true })
  mkdirSync(join(inst, 'libraries', `org/lwjgl/lwjgl/3.3.3`), { recursive: true })
  mkdirSync(join(inst, 'assets'), { recursive: true })
  writeFileSync(join(inst, 'instance.json'), JSON.stringify({ id, name: id, mcVersion: id, createdAt: 'x', lastUsedAt: null }))
  writeFileSync(join(inst, 'versions', id, `${id}.json`), JSON.stringify(versionDetail()))
  writeFileSync(join(inst, 'versions', id, `${id}.jar`), Buffer.from('client'))
  writeFileSync(join(inst, 'libraries', 'org/ow2/asm/asm/9.6/asm-9.6.jar'), Buffer.from('lib'))
  writeFileSync(
    join(inst, 'libraries', `org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-${LOADER_CLASSIFIER}.jar`),
    makeStoredZip('lwjgl.dll', Buffer.from('native'))
  )
  return inst
}

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mc-launch-'))
})

describe('buildManagedLaunchSpec', () => {
  it('拼装 classpath（库在前 + 客户端 jar 在后）并解包 natives', async () => {
    const inst = makeInstance(root)
    const built = await buildManagedLaunchSpec(root, '1.21.1')
    expect(built.mcVersion).toBe('1.21.1')
    expect(built.javaMajor).toBe(21)
    // classpath = 库相对路径（库根拼装）+ 客户端 jar
    expect(built.spec.classpath.some((p) => p.endsWith('asm-9.6.jar'))).toBe(true)
    expect(built.spec.classpath[built.spec.classpath.length - 1]).toBe(
      join(inst, 'versions', '1.21.1', '1.21.1.jar')
    )
    // JVM 参数含 -cp 与 natives 路径
    expect(built.spec.jvmArgs).toContain('-cp')
    expect(built.spec.jvmArgs.some((a) => a.startsWith('-Djava.library.path='))).toBe(true)
    // natives 已解包（含标记文件与解出的 dll）
    expect(built.nativesDir).toBe(join(inst, 'natives', '1.21.1'))
    expect(existsSync(join(built.nativesDir, 'lwjgl.dll'))).toBe(true)
    // 游戏参数已按占位符替换（用户名 + 资产目录）
    expect(built.spec.gameArgs).toContain('--username')
    expect(built.spec.gameArgs).toContain('--assetsDir')
    expect(built.spec.gameArgs).not.toContain('${auth_player_name}')
    // 幂等：二次调用（natives 已有标记）不报错
    await expect(buildManagedLaunchSpec(root, '1.21.1')).resolves.toBeTruthy()
  })

  it('实例缺失 / 未置备 → 抛人类可读错误', async () => {
    await expect(buildManagedLaunchSpec(root, 'nope')).rejects.toThrow(/实例不存在/)
    mkdirSync(join(root, 'bare', '1.20.1'), { recursive: true })
    writeFileSync(
      join(root, 'bare', 'instance.json'),
      JSON.stringify({ id: 'bare', name: 'b', mcVersion: '1.20.1', createdAt: 'x', lastUsedAt: null })
    )
    await expect(buildManagedLaunchSpec(root, 'bare')).rejects.toThrow(/尚未置备/)
  })
})

describe('launchManagedInstance', () => {
  it('注入 spawn + JDK 解析 → 成功启动并透传参数', async () => {
    makeInstance(root)
    const calls: { exe: string; args: string[]; cwd: string }[] = []
    const res = await launchManagedInstance(
      { instanceId: '1.21.1', instancesRoot: root },
      {
        resolveJava: async () => 'C:/jdk/bin/java.exe',
        spawnProcess: (exe, args, opts) => {
          calls.push({ exe, args, cwd: opts.cwd })
          return 4321
        }
      }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.pid).toBe(4321)
    expect(calls[0].exe).toBe('C:/jdk/bin/java.exe')
    expect(calls[0].cwd).toBe(join(root, '1.21.1'))
    expect(calls[0].args).toContain('net.minecraft.client.main.Main')
  })

  it('无可用 JDK → 返回引导文案', async () => {
    makeInstance(root)
    const res = await launchManagedInstance(
      { instanceId: '1.21.1', instancesRoot: root },
      { resolveJava: async () => null, spawnProcess: () => 1 }
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errorMessage).toContain('一键准备运行环境')
  })

  it('observer-agent 可用时以 -javaagent 挂载并轮换 token；缺失时不挂载', async () => {
    makeInstance(root)
    const calls: string[][] = []
    const withAgent = await launchManagedInstance(
      { instanceId: '1.21.1', instancesRoot: root },
      {
        resolveJava: async () => 'C:/jdk/bin/java.exe',
        resolveObserverAgent: () => 'D:/kunyu/resources/observer-agent/dist/kunyu-observer-agent.jar',
        spawnProcess: (_exe, args) => {
          calls.push(args)
          return 1
        }
      }
    )
    expect(withAgent.ok).toBe(true)
    const agentArg = calls[0].find((a) => a.startsWith('-javaagent:'))
    expect(agentArg).toBeTruthy()
    expect(agentArg).toContain('kunyu-observer-agent.jar')
    expect(agentArg).toMatch(/port=9876,token=[A-Za-z0-9_-]{20,}/)
    // -javaagent 必须位于 JVM 参数段最前（主类之前）
    expect(calls[0].indexOf(agentArg!)).toBeLessThan(
      calls[0].indexOf('net.minecraft.client.main.Main')
    )

    calls.length = 0
    const withoutAgent = await launchManagedInstance(
      { instanceId: '1.21.1', instancesRoot: root },
      {
        resolveJava: async () => 'C:/jdk/bin/java.exe',
        resolveObserverAgent: () => null,
        spawnProcess: (_exe, args) => {
          calls.push(args)
          return 1
        }
      }
    )
    expect(withoutAgent.ok).toBe(true)
    expect(calls[0].some((a) => a.startsWith('-javaagent:'))).toBe(false)
  })

  it('非法/空实例 id 与不存在实例 → 返回错误', async () => {
    const empty = await launchManagedInstance({ instanceId: '  ' }, {})
    expect(empty.ok).toBe(false)
    const bad = await launchManagedInstance({ instanceId: '../x', instancesRoot: root }, {})
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errorMessage).toContain('非法')
    const missing = await launchManagedInstance(
      { instanceId: 'ghost', instancesRoot: root },
      { resolveJava: async () => 'j', spawnProcess: () => 1 }
    )
    expect(missing.ok).toBe(false)
  })
})
