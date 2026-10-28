/**
 * 零配置运行环境 3a：JDK 置备纯函数单测（不触网）。
 * 覆盖 Adoptium 资产解析、镜像链接重写、文件名抽取、平台参数与非法主版本拒绝。
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/kunyu-test' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))

import {
  fileNameOf,
  parseAdoptiumAsset,
  platformArch,
  platformOs,
  provisionJdk,
  rewriteToMirror,
  type JdkTarget
} from '../jdkProvisionService'

describe('parseAdoptiumAsset', () => {
  it('抽取首个含 link+checksum 的包', () => {
    const raw = [
      {
        binary: {
          package: {
            name: 'OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip',
            link: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip',
            checksum: 'ABC123',
            size: 190000000
          }
        },
        version: { semver: '17.0.13+11', major: 17 }
      }
    ]
    const picked = parseAdoptiumAsset(raw)
    expect(picked).not.toBeNull()
    expect(picked!.pkg.checksum).toBe('ABC123')
    expect(picked!.pkg.size).toBe(190000000)
    expect(picked!.version).toBe('17.0.13+11')
  })

  it('跳过缺 link/checksum 的项，非法输入返回 null', () => {
    expect(parseAdoptiumAsset(null)).toBeNull()
    expect(parseAdoptiumAsset({})).toBeNull()
    expect(parseAdoptiumAsset([{ binary: { package: { link: 'x' } } }])).toBeNull()
    expect(
      parseAdoptiumAsset([
        { binary: { package: { link: '', checksum: 'a' } } },
        { binary: { package: { link: 'https://x/y.zip', checksum: 'b' } } }
      ])!.pkg.checksum
    ).toBe('b')
  })
})

describe('fileNameOf', () => {
  it('取 URL 路径末段', () => {
    expect(fileNameOf('https://host/a/b/c.zip')).toBe('c.zip')
    expect(fileNameOf('not-a-url/x.tar.gz')).toBe('x.tar.gz')
  })
})

describe('rewriteToMirror', () => {
  const target: JdkTarget = { major: 17, os: 'windows', arch: 'x64' }
  const official =
    'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip'

  it('mirror 非空时重写为 TUNA 风格路径', () => {
    const url = rewriteToMirror(official, 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/', target)
    expect(url).toBe(
      'https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip'
    )
  })

  it('mirror 为空时保留官方链接', () => {
    expect(rewriteToMirror(official, '', target)).toBe(official)
    expect(rewriteToMirror(official, undefined, target)).toBe(official)
  })
})

describe('平台参数', () => {
  it('映射当前平台/架构到 Adoptium 参数', () => {
    expect(['windows', 'linux', 'mac']).toContain(platformOs())
    expect(['x64', 'aarch64']).toContain(platformArch())
    if (process.platform === 'win32') expect(platformOs()).toBe('windows')
    if (process.arch === 'arm64') expect(platformArch()).toBe('aarch64')
  })
})

describe('provisionJdk 入参校验', () => {
  it('非法主版本直接返回错误（不触网）', async () => {
    const r = await provisionJdk({ major: 3 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errorMessage).toContain('不支持的 JDK 主版本')
  })
})
