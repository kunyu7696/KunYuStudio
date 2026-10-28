/**
 * 反编译工作区服务单测（不触网、不 spawn java）。
 * 覆盖：候选 URL 镜像排序、maven-metadata 版本解析、工作区命名、
 * jar 魔数校验、安全根守卫与工作区内读写/搜索/删除。
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' as string }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userData },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))

import {
  DECOMPILE_SEARCH_MAX,
  assertWithinDecompileRoot,
  buildVineflowerUrls,
  decompileRoot,
  deleteWorkspace,
  isJarBytes,
  listWorkspaces,
  parseMavenMetadataVersion,
  readDirIn,
  readFileIn,
  searchIn,
  workspaceNameFor
} from '../decompileService'

function makeUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-decompile-'))
  state.userData = dir
  return dir
}

afterEach(() => {
  if (state.userData) rmSync(state.userData, { recursive: true, force: true })
  state.userData = ''
})

describe('buildVineflowerUrls', () => {
  it('china 镜像优先阿里云，official 优先 Maven Central', () => {
    const china = buildVineflowerUrls('1.11.1', 'china')
    expect(china[0]).toContain('maven.aliyun.com')
    expect(china[1]).toContain('repo1.maven.org')
    const official = buildVineflowerUrls('1.11.1', 'official')
    expect(official[0]).toContain('repo1.maven.org')
    for (const url of [...china, ...official]) {
      expect(url).toContain('/org/vineflower/vineflower/vineflower-1.11.1.jar')
    }
  })
})

describe('parseMavenMetadataVersion', () => {
  it('优先 release 标签，回退 latest，解析失败为 null', () => {
    const xml = `<?xml version="1.0"?><metadata><versioning>
      <latest>1.11.2-SNAPSHOT</latest><release>1.11.1</release>
      <versions><version>1.11.0</version><version>1.11.1</version></versions>
    </versioning></metadata>`
    expect(parseMavenMetadataVersion(xml)).toBe('1.11.1')
    expect(parseMavenMetadataVersion('<latest>1.10.0</latest>')).toBe('1.10.0')
    expect(parseMavenMetadataVersion('<html>404</html>')).toBeNull()
  })
})

describe('workspaceNameFor', () => {
  it('jar 基名净化 + 短哈希；同名不同源哈希不同', () => {
    const a = workspaceNameFor(join('mods', 'jei-1.20.1.jar'))
    expect(a).toMatch(/^jei-1\.20\.1-[0-9a-f]{8}$/)
    const b = workspaceNameFor(join('libs', 'jei-1.20.1.jar'))
    expect(a).not.toBe(b)
    // 非法字符净化
    expect(workspaceNameFor(join('x', 'my mod (1).jar'))).toMatch(/^my_mod_1-[0-9a-f]{8}$/)
  })
})

describe('isJarBytes', () => {
  it('仅接受 ZIP 本地文件头与空归档 EOCD 魔数', () => {
    expect(isJarBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
    expect(isJarBytes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true)
  })

  it('拒绝只有 PK 前缀的伪 jar（旧实现仅验两字节会误判为合法）', () => {
    expect(isJarBytes(Buffer.from([0x50, 0x4b]))).toBe(false)
    expect(isJarBytes(Buffer.from([0x50, 0x4b, 0x03]))).toBe(false)
    expect(isJarBytes(Buffer.from('PK!!'))).toBe(false)
    expect(isJarBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x78]))).toBe(true)
  })

  it('拒绝非 ZIP 内容', () => {
    expect(isJarBytes(Buffer.from('<htm'))).toBe(false)
    expect(isJarBytes(Buffer.from([0x50]))).toBe(false)
    expect(isJarBytes(Buffer.alloc(0))).toBe(false)
  })
})

describe('工作区安全根与读写', () => {
  it('decompileRoot 内可访问，树外拒绝', () => {
    const ud = makeUserData()
    assertWithinDecompileRoot(join(decompileRoot(), 'ws-a', 'x.java'))
    expect(() => assertWithinDecompileRoot(join(ud, 'other', 'x.java'))).toThrow(/越界/)
    expect(() => assertWithinDecompileRoot(join(decompileRoot(), '..', 'escape'))).toThrow(/越界/)
  })

  it('符号链接根（macOS /var → /private/var 形态）：尚不存在的目标仍判为根内', () => {
    // macOS 的 os.tmpdir() 本身是符号链接，userData 词法路径经 realpath 后会变前缀，
    // 目标与根若只有一侧真实化就会误判越界（CI #68 起 macos-latest 持续红的根因）。
    const realBase = mkdtempSync(join(tmpdir(), 'kunyu-real-'))
    const linkBase = join(tmpdir(), `kunyu-link-${process.pid}-${Date.now()}`)
    try {
      symlinkSync(realBase, linkBase, 'dir')
    } catch {
      // 无符号链接权限的平台（Windows 非开发者模式）跳过
      rmSync(realBase, { recursive: true, force: true })
      return
    }
    try {
      state.userData = linkBase
      assertWithinDecompileRoot(join(decompileRoot(), 'ws-new', 'x.java'))
      expect(() => assertWithinDecompileRoot(join(linkBase, 'other', 'x.java'))).toThrow(/越界/)
    } finally {
      state.userData = ''
      rmSync(linkBase, { force: true })
      rmSync(realBase, { recursive: true, force: true })
    }
  })

  it('readDirIn / readFileIn / searchIn / deleteWorkspace 闭环', async () => {
    makeUserData()
    const ws = join(decompileRoot(), 'demo-12345678')
    mkdirSync(join(ws, 'com', 'example'), { recursive: true })
    writeFileSync(join(ws, 'com', 'example', 'Foo.java'), 'class Foo {}')
    writeFileSync(join(ws, 'com', 'example', 'Bar.java'), 'class Bar {}')
    writeFileSync(join(ws, 'com', 'example', 'notes.txt'), 'not java')

    const top = readDirIn(ws, '')
    expect(top.map((n) => n.name)).toEqual(['com'])
    const pkg = readDirIn(ws, join('com', 'example'))
    expect(pkg.map((n) => n.name)).toEqual(['Bar.java', 'Foo.java', 'notes.txt'])

    const file = await readFileIn(ws, join('com', 'example', 'Foo.java'))
    expect(file.content).toBe('class Foo {}')
    expect(file.truncated).toBe(false)

    expect(searchIn(ws, 'foo').map((n) => n.name)).toEqual(['Foo.java'])
    // 非 .java 不进搜索结果
    expect(searchIn(ws, 'notes')).toEqual([])
    expect(searchIn(ws, '')).toEqual([])

    // 越界拒绝
    await expect(readFileIn(ws, join('..', '..', 'x.java'))).rejects.toThrow()
    expect(() => readDirIn(decompileRoot(), '')).toThrow(/非法工作区根/)

    expect(deleteWorkspace(ws)).toBe(true)
    expect(listWorkspaces()).toEqual([])
    expect(deleteWorkspace(ws)).toBe(false)
  })

  it('listWorkspaces 按 mtime 倒序且仅列目录', () => {
    makeUserData()
    const root = decompileRoot()
    mkdirSync(join(root, 'a-aaaaaaaa'), { recursive: true })
    mkdirSync(join(root, 'b-bbbbbbbb'), { recursive: true })
    writeFileSync(join(root, 'stray.txt'), 'x')
    const list = listWorkspaces()
    expect(list.map((w) => w.name).sort()).toEqual(['a-aaaaaaaa', 'b-bbbbbbbb'])
  })
})

describe('搜索上限常量', () => {
  it('DECOMPILE_SEARCH_MAX 为 200', () => {
    expect(DECOMPILE_SEARCH_MAX).toBe(200)
  })
})
