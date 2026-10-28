/**
 * 零配置运行环境 3b：MC 运行时纯函数单测（不触网、不触盘）。
 * 覆盖镜像重写、maven 路径推导、库规则求值、natives 选择与启动参数拼装。
 */
import { describe, expect, it } from 'vitest'
import type { McLibrary, McVersionDetail } from '../../../shared/types/mcRuntime'
import {
  assembleLaunchSpec,
  buildArgList,
  classpathSeparator,
  evaluateRules,
  libraryArtifactDownload,
  libraryPath,
  manifestUrl,
  mavenPathFromName,
  nativeClassifier,
  nativeDownload,
  parseLegacyGameArgs,
  platformMcArch,
  platformOsName,
  resolveMcMirrorBase,
  rewriteMcUrl,
  substituteArg,
  type McRuleContext
} from '../mcLaunchSpec'

const winCtx: McRuleContext = { os: 'windows', arch: 'x64', features: {} }

describe('镜像解析与重写', () => {
  it('resolveMcMirrorBase：自定义优先，其次按模式', () => {
    expect(resolveMcMirrorBase('china', 'https://my.mirror/')).toBe('https://my.mirror')
    expect(resolveMcMirrorBase('china', '')).toContain('bmclapi2.bangbang93.com')
    expect(resolveMcMirrorBase('official', '')).toBe('')
  })

  it('manifestUrl：按镜像拼接；空镜像回官方', () => {
    expect(manifestUrl('https://bmclapi2.bangbang93.com')).toBe(
      'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'
    )
    expect(manifestUrl('')).toBe('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
  })

  it('rewriteMcUrl：库/资产/元数据按 BMCLAPI 约定重写；其他主机不动；空镜像原样', () => {
    const base = 'https://bmclapi2.bangbang93.com'
    expect(rewriteMcUrl('https://libraries.minecraft.net/org/ow2/asm/asm/9.6/asm-9.6.jar', base)).toBe(
      'https://bmclapi2.bangbang93.com/maven/org/ow2/asm/asm/9.6/asm-9.6.jar'
    )
    expect(rewriteMcUrl('https://resources.download.minecraft.net/ab/abcd', base)).toBe(
      'https://bmclapi2.bangbang93.com/assets/ab/abcd'
    )
    expect(rewriteMcUrl('https://piston-meta.mojang.com/v1/packages/x/1.21.1.json', base)).toBe(
      'https://bmclapi2.bangbang93.com/v1/packages/x/1.21.1.json'
    )
    expect(rewriteMcUrl('https://cdn.example.com/a.jar', base)).toBe('https://cdn.example.com/a.jar')
    expect(rewriteMcUrl('https://libraries.minecraft.net/a.jar', '')).toBe(
      'https://libraries.minecraft.net/a.jar'
    )
  })

  it('平台映射', () => {
    expect(platformOsName('win32')).toBe('windows')
    expect(platformOsName('darwin')).toBe('osx')
    expect(platformOsName('linux')).toBe('linux')
    expect(platformMcArch('ia32')).toBe('x86')
    expect(platformMcArch('arm64')).toBe('arm64')
    expect(platformMcArch('x64')).toBe('x64')
  })
})

describe('maven 路径与库选择', () => {
  it('mavenPathFromName：普通与带 classifer；非法返回 null', () => {
    expect(mavenPathFromName('org.ow2.asm:asm:9.6')).toBe('org/ow2/asm/asm/9.6/asm-9.6.jar')
    expect(mavenPathFromName('a.b:c:1.0:natives-windows')).toBe('a/b/c/1.0/c-1.0-natives-windows.jar')
    expect(mavenPathFromName('bad')).toBeNull()
  })

  it('libraryPath：下载描述自带 path 优先', () => {
    const lib: McLibrary = { name: 'a.b:c:1.0' }
    expect(libraryPath({ url: 'x', path: 'custom/p.jar' }, lib)).toBe('custom/p.jar')
    expect(libraryPath({ url: 'x' }, lib)).toBe('a/b/c/1.0/c-1.0.jar')
  })

  it('evaluateRules：空=允许；命中的最后一条决定结果', () => {
    expect(evaluateRules(undefined, winCtx)).toBe(true)
    expect(evaluateRules([], winCtx)).toBe(true)
    expect(evaluateRules([{ action: 'allow', os: { name: 'windows' } }], winCtx)).toBe(true)
    expect(evaluateRules([{ action: 'allow', os: { name: 'osx' } }], winCtx)).toBe(false)
    expect(
      evaluateRules(
        [
          { action: 'allow', os: { name: 'windows' } },
          { action: 'disallow', os: { name: 'windows' } }
        ],
        winCtx
      )
    ).toBe(false)
  })

  it('libraryArtifactDownload：规则不适用的库返回 null', () => {
    const lib: McLibrary = {
      name: 'a.b:c:1.0',
      rules: [{ action: 'allow', os: { name: 'osx' } }],
      downloads: { artifact: { url: 'https://libraries.minecraft.net/a.jar', path: 'a.jar' } }
    }
    expect(libraryArtifactDownload(lib, winCtx)).toBeNull()
    const ok: McLibrary = {
      name: 'a.b:c:1.0',
      downloads: { artifact: { url: 'https://libraries.minecraft.net/a.jar', path: 'a.jar' } }
    }
    expect(libraryArtifactDownload(ok, winCtx)?.path).toBe('a.jar')
  })

  it('nativeClassifier/nativeDownload：${arch} 展开与规则求值', () => {
    const lib: McLibrary = {
      name: 'org.lwjgl:lwjgl:3.3.2',
      natives: { windows: 'natives-windows-${arch}', osx: 'natives-macos' },
      downloads: {
        classifiers: {
          'natives-windows-64': { url: 'https://libraries.minecraft.net/win64.jar', path: 'win64.jar' }
        }
      }
    }
    expect(nativeClassifier(lib, 'windows', 'x64')).toBe('natives-windows-64')
    expect(nativeClassifier(lib, 'osx', 'x64')).toBe('natives-macos')
    expect(nativeDownload(lib, winCtx)?.classifier).toBe('natives-windows-64')
    expect(nativeDownload(lib, winCtx)?.download.path).toBe('win64.jar')
    const excluded: McLibrary = { ...lib, rules: [{ action: 'disallow', os: { name: 'windows' } }] }
    expect(nativeDownload(excluded, winCtx)).toBeNull()
  })

  it('classpathSeparator / substituteArg / parseLegacyGameArgs', () => {
    expect(classpathSeparator('win32')).toBe(';')
    expect(classpathSeparator('linux')).toBe(':')
    expect(substituteArg('--x ${auth_player_name}', { auth_player_name: 'Steve' })).toBe('--x Steve')
    expect(substituteArg('--y ${unknown}', {})).toBe('--y ')
    expect(parseLegacyGameArgs('--username ${auth_player_name} --version ${version_name}')).toEqual([
      '--username',
      '${auth_player_name}',
      '--version',
      '${version_name}'
    ])
    expect(parseLegacyGameArgs(undefined)).toEqual([])
  })

  it('buildArgList：按规则过滤并展开数组 value', () => {
    const list = buildArgList(
      [
        '--plain',
        { rules: [{ action: 'allow', os: { name: 'windows' } }], value: '--win' },
        { rules: [{ action: 'allow', os: { name: 'osx' } }], value: '--mac' },
        { value: ['-a', '-b'] }
      ],
      winCtx,
      { auth_player_name: 'Steve' }
    )
    expect(list).toEqual(['--plain', '--win', '-a', '-b'])
  })
})

describe('assembleLaunchSpec', () => {
  const detail: McVersionDetail = {
    id: '1.21.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: '17',
    assetIndex: { id: '17', sha1: 'x', size: 1, totalSize: 2, url: 'https://x/17.json' },
    downloads: { client: { url: 'https://x/client.jar' } },
    libraries: [],
    arguments: {
      jvm: ['-cp', '${classpath}', '-Djava.library.path=${natives_directory}'],
      game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}']
    }
  }

  it('类路径顺序为「库在前、客户端 jar 在后」，参数占位符被替换', () => {
    const spec = assembleLaunchSpec({
      detail,
      gameDir: '/inst',
      clientJar: '/inst/versions/1.21.1/1.21.1.jar',
      librariesDir: '/inst/libraries',
      libraryRelPaths: ['org/ow2/asm/asm/9.6/asm-9.6.jar'],
      nativesDir: '/inst/natives/1.21.1',
      assetsDir: '/inst/assets',
      platform: 'win32',
      arch: 'x64',
      vars: { auth_player_name: 'Steve' }
    })
    expect(spec.mainClass).toBe('net.minecraft.client.main.Main')
    expect(spec.classpath).toEqual([
      '/inst/libraries/org/ow2/asm/asm/9.6/asm-9.6.jar',
      '/inst/versions/1.21.1/1.21.1.jar'
    ])
    const cp = spec.jvmArgs[spec.jvmArgs.indexOf('-cp') + 1]
    expect(cp).toBe(
      '/inst/libraries/org/ow2/asm/asm/9.6/asm-9.6.jar;/inst/versions/1.21.1/1.21.1.jar'
    )
    expect(spec.jvmArgs).toContain('-Djava.library.path=/inst/natives/1.21.1')
    expect(spec.gameArgs).toEqual([
      '--username',
      'Steve',
      '--version',
      '1.21.1',
      '--gameDir',
      '/inst'
    ])
  })

  it('旧结构（仅 minecraftArguments）走游戏参数回退；无 jvm 块给最小默认', () => {
    const legacy: McVersionDetail = {
      id: '1.7.10',
      mainClass: 'net.minecraft.client.Main',
      assets: 'legacy',
      assetIndex: { id: 'legacy', sha1: 'x', size: 1, totalSize: 2, url: 'https://x/l.json' },
      downloads: { client: { url: 'https://x/c.jar' } },
      libraries: [],
      minecraftArguments: '--username ${auth_player_name} --version ${version_name}'
    }
    const spec = assembleLaunchSpec({
      detail: legacy,
      gameDir: '/g',
      clientJar: '/g/c.jar',
      librariesDir: '/g/libs',
      libraryRelPaths: [],
      nativesDir: '/g/natives',
      assetsDir: '/g/assets',
      platform: 'linux',
      arch: 'x64',
      vars: { auth_player_name: 'Alex' }
    })
    expect(spec.jvmArgs[0]).toBe('-Djava.library.path=/g/natives')
    expect(spec.jvmArgs).toContain('-cp')
    expect(spec.gameArgs).toEqual(['--username', 'Alex', '--version', '1.7.10'])
  })
})
