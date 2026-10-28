import { describe, it, expect } from 'vitest'
import {
  detectLaunchers,
  parseInstances,
  parseIniValue,
  type PathProbe
} from '../launcherDetect'
import type { LauncherInfo } from '../../../shared/types/launcher'

/** 构建 fake PathProbe，路径分隔符统一为 \\ */
function makeFakeProbe(opts: {
  existsPaths?: Set<string>
  dirs?: Map<string, string[]>
  files?: Map<string, string>
  home?: string
  appData?: string
  localAppData?: string
  programFiles?: string
}): PathProbe {
  const home = opts.home ?? 'C:\\Users\\test'
  const appData = opts.appData ?? `${home}\\AppData\\Roaming`
  const localAppData = opts.localAppData ?? `${home}\\AppData\\Local`
  const programFiles = opts.programFiles ?? 'C:\\Program Files'
  return {
    async exists(path) {
      return opts.existsPaths?.has(path) ?? false
    },
    async readDirNames(path) {
      return opts.dirs?.get(path) ?? []
    },
    async readFileText(path) {
      return opts.files?.get(path) ?? ''
    },
    join(...parts) {
      return parts.join('\\')
    },
    home() {
      return home
    },
    appData() {
      return appData
    },
    localAppData() {
      return localAppData
    },
    programFiles() {
      return programFiles
    }
  }
}

describe('parseIniValue', () => {
  it('解析正常 key=value', () => {
    expect(parseIniValue('MinecraftVersion=1.20.1\n', 'MinecraftVersion')).toBe('1.20.1')
  })
  it('找不到 key 返回 undefined', () => {
    expect(parseIniValue('Foo=bar\n', 'MinecraftVersion')).toBeUndefined()
  })
  it('处理多行文本', () => {
    const text = 'InstanceName=test\nMinecraftVersion=1.20.1\nForgeVersion=47.0.1\n'
    expect(parseIniValue(text, 'MinecraftVersion')).toBe('1.20.1')
    expect(parseIniValue(text, 'ForgeVersion')).toBe('47.0.1')
  })
  it('处理空值', () => {
    expect(parseIniValue('MinecraftVersion=\n', 'MinecraftVersion')).toBe('')
  })
  it('处理前导空格', () => {
    expect(parseIniValue('  MinecraftVersion=1.20.1\n', 'MinecraftVersion')).toBe('1.20.1')
  })
  it('处理 CRLF 换行', () => {
    expect(parseIniValue('MinecraftVersion=1.20.1\r\n', 'MinecraftVersion')).toBe('1.20.1')
  })
})

describe('detectLaunchers', () => {
  it('无任何启动器时返回空列表', async () => {
    const probe = makeFakeProbe({})
    const result = await detectLaunchers(probe)
    expect(result.launchers).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('检测到官方启动器', async () => {
    // 候选路径按平台分支（darwin=/Applications/*.app，linux=/usr/bin，win32=Program Files）
    const exe =
      process.platform === 'darwin'
        ? '/Applications/Minecraft.app'
        : process.platform === 'linux'
          ? '/usr/bin/minecraft-launcher'
          : 'C:\\Program Files\\Minecraft Launcher\\MinecraftLauncher.exe'
    const probe = makeFakeProbe({
      existsPaths: new Set([exe])
    })
    const result = await detectLaunchers(probe)
    expect(result.launchers).toHaveLength(1)
    expect(result.launchers[0].kind).toBe('official')
    expect(result.launchers[0].name).toBe('Minecraft Launcher')
    expect(result.launchers[0].autoDetected).toBe(true)
  })

  // macOS 专属：数据目录约定 ~/Library/Application Support/minecraft
  it.runIf(process.platform === 'darwin')('mac 官方启动器数据目录在 Application Support', async () => {
    const probe = makeFakeProbe({
      existsPaths: new Set(['/Applications/Minecraft.app'])
    })
    const result = await detectLaunchers(probe)
    expect(result.launchers[0].dataDir).toContain('Application Support')
  })

  it('检测到多个启动器', async () => {
    const home = 'C:\\Users\\test'
    const probe = makeFakeProbe({
      home,
      existsPaths: new Set([
        `${home}\\Desktop\\PlainCraftLauncher.exe`,
        `${home}\\hmcl.jar`
      ])
    })
    const result = await detectLaunchers(probe)
    expect(result.launchers).toHaveLength(2)
    const kinds = result.launchers.map((l) => l.kind)
    expect(kinds).toContain('pcl2')
    expect(kinds).toContain('hmcl')
  })

  it('同类启动器多命中时全部返回并带目录名区分', async () => {
    const home = 'C:\\Users\\test'
    const probe = makeFakeProbe({
      home,
      existsPaths: new Set([
        `${home}\\Desktop\\PlainCraftLauncher.exe`,
        `${home}\\Downloads\\PlainCraftLauncher.exe`
      ])
    })
    const result = await detectLaunchers(probe)
    expect(result.launchers).toHaveLength(2)
    expect(result.launchers.map((l) => l.exePath)).toEqual([
      `${home}\\Desktop\\PlainCraftLauncher.exe`,
      `${home}\\Downloads\\PlainCraftLauncher.exe`
    ])
    expect(result.launchers[0].name).toContain('Desktop')
    expect(result.launchers[1].name).toContain('Downloads')
  })

  it('固定候选优先：单命中时名称不带目录名', async () => {
    const home = 'C:\\Users\\test'
    const probe = makeFakeProbe({
      home,
      existsPaths: new Set([`${home}\\Desktop\\PlainCraftLauncher.exe`])
    })
    const result = await detectLaunchers(probe)
    expect(result.launchers).toHaveLength(1)
    expect(result.launchers[0].name).toBe('PCL2')
  })

  it('磁盘白名单目录里扫描到非标准安装的 PCL2', async () => {
    const probe = makeFakeProbe({
      home: 'C:\\Users\\test',
      existsPaths: new Set(['D:\\']),
      dirs: new Map([
        ['D:\\', ['Games']],
        ['D:\\Games', ['PCL2.exe', 'Other']]
      ])
    })
    const extended = {
      ...probe,
      async listDrives() {
        return ['D:\\']
      }
    }
    const result = await detectLaunchers(extended)
    expect(result.launchers).toHaveLength(1)
    expect(result.launchers[0].kind).toBe('pcl2')
    expect(result.launchers[0].exePath).toBe('D:\\Games\\PCL2.exe')
  })

  it('磁盘根下非白名单目录不下探', async () => {
    const probe = makeFakeProbe({
      home: 'C:\\Users\\test',
      existsPaths: new Set(['D:\\']),
      dirs: new Map([['D:\\', ['Windows', 'PCL2.exe']]])
    })
    const extended = {
      ...probe,
      async listDrives() {
        return ['D:\\']
      }
    }
    const result = await detectLaunchers(extended)
    // 磁盘根直接位于根下的文件仍会收集（白名单只限制目录下探）
    expect(result.launchers.map((l) => l.exePath)).toEqual(['D:\\PCL2.exe'])
  })

  it('注册表安装信息命中 HMCL', async () => {
    const probe = makeFakeProbe({
      existsPaths: new Set(['D:\\Tools\\HMCL'])
    })
    const extended = {
      ...probe,
      async listInstalledPrograms() {
        return [{ name: 'HMCL Launcher', installLocation: 'D:\\Tools\\HMCL' }]
      },
      async readDirNames(path: string) {
        if (path === 'D:\\Tools\\HMCL') return ['HMCL.exe']
        return []
      }
    }
    const result = await detectLaunchers(extended)
    const hmcl = result.launchers.find((l) => l.kind === 'hmcl')
    expect(hmcl?.exePath).toBe('D:\\Tools\\HMCL\\HMCL.exe')
    expect(hmcl?.dataDir).toBe('D:\\Tools\\HMCL\\.minecraft')
  })

  it('OneDrive 重定向桌面里的 PCL2 能被扫描到', async () => {
    const home = 'C:\\Users\\test'
    const desktop = `${home}\\OneDrive\\Desktop`
    const probe = makeFakeProbe({
      home,
      existsPaths: new Set([desktop]),
      dirs: new Map([[desktop, ['Plain Craft Launcher 2.exe']]])
    })
    const result = await detectLaunchers(probe)
    expect(result.launchers).toHaveLength(1)
    expect(result.launchers[0].kind).toBe('pcl2')
    expect(result.launchers[0].exePath).toBe(`${desktop}\\Plain Craft Launcher 2.exe`)
  })

  it('深层绿色版目录里的 PCL2 能被扫描到（数据目录向上解析到 .minecraft）', async () => {
    const base = 'D:\\pcl.mc'
    const shot = `${base}\\PCL\\-shot 2.10.8`
    const inner = `${shot}\\PCL`
    const probe = makeFakeProbe({
      home: 'C:\\Users\\test',
      existsPaths: new Set(['D:\\', base, `${base}\\.minecraft`]),
      dirs: new Map([
        ['D:\\', ['pcl.mc']],
        [base, ['PCL', '.minecraft']],
        [`${base}\\PCL`, ['-shot 2.10.8']],
        [shot, ['PCL']],
        [inner, ['Plain Craft Launcher 2.exe']]
      ])
    })
    const extended = {
      ...probe,
      async listDrives() {
        return ['D:\\']
      }
    }
    const result = await detectLaunchers(extended)
    expect(result.launchers).toHaveLength(1)
    expect(result.launchers[0].kind).toBe('pcl2')
    expect(result.launchers[0].exePath).toBe(`${inner}\\Plain Craft Launcher 2.exe`)
    expect(result.launchers[0].dataDir).toBe(`${base}\\.minecraft`)
  })

  it('副本文件不重复计入', async () => {
    const home = 'C:\\Users\\test'
    const desktop = `${home}\\Desktop`
    const probe = makeFakeProbe({
      home,
      existsPaths: new Set([desktop]),
      dirs: new Map([
        [
          desktop,
          [
            'Plain Craft Launcher 2.exe',
            'Plain Craft Launcher 2 - 副本.exe',
            'Plain Craft Launcher 2 (copy).exe'
          ]
        ]
      ])
    })
    const result = await detectLaunchers(probe)
    expect(result.launchers).toHaveLength(1)
    expect(result.launchers[0].exePath).toBe(`${desktop}\\Plain Craft Launcher 2.exe`)
  })

  it('扫描命中的数据目录自带 versions 时沿用该目录', async () => {
    const probe = makeFakeProbe({
      home: 'C:\\Users\\test',
      existsPaths: new Set(['D:\\', 'D:\\Games', 'D:\\Games\\versions']),
      dirs: new Map([
        ['D:\\', ['Games']],
        ['D:\\Games', ['PCL2.exe']]
      ])
    })
    const extended = {
      ...probe,
      async listDrives() {
        return ['D:\\']
      }
    }
    const result = await detectLaunchers(extended)
    expect(result.launchers).toHaveLength(1)
    expect(result.launchers[0].dataDir).toBe('D:\\Games')
  })

  it('probe.exists 抛错时收集到 errors', async () => {
    const base = makeFakeProbe({})
    const probe: PathProbe = {
      ...base,
      async exists() {
        throw new Error('disk error')
      }
    }
    const result = await detectLaunchers(probe)
    expect(result.launchers).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((e) => e.includes('disk error'))).toBe(true)
  })
})

describe('parseInstances', () => {
  it('解析 .minecraft/versions 下的实例（官方/HMCL/PCL2）', async () => {
    const home = 'C:\\Users\\test'
    const appData = `${home}\\AppData\\Roaming`
    const dataDir = `${appData}\\.minecraft`
    const versionsDir = `${dataDir}\\versions`
    const probe = makeFakeProbe({
      home,
      appData,
      existsPaths: new Set([
        versionsDir,
        `${versionsDir}\\1.20.1`,
        `${versionsDir}\\1.20.1\\1.20.1.jar`,
        `${versionsDir}\\1.19.2`,
        `${versionsDir}\\1.19.2\\1.19.2.json`
      ]),
      dirs: new Map([[versionsDir, ['1.20.1', '1.19.2']]])
    })
    const info: LauncherInfo = {
      id: 'official:test',
      kind: 'official',
      name: 'Minecraft Launcher',
      exePath: '',
      dataDir,
      autoDetected: true
    }
    const result = await parseInstances(probe, info)
    expect(result).toHaveLength(2)
    expect(result.map((i) => i.mcVersion)).toEqual(['1.20.1', '1.19.2'])
    expect(result[0].gamePath).toBe(dataDir)
    expect(result[0].launcherId).toBe(info.id)
  })

  it('versions 目录不存在时返回空', async () => {
    const probe = makeFakeProbe({})
    const info: LauncherInfo = {
      id: 'official:test',
      kind: 'official',
      name: 'Minecraft Launcher',
      exePath: '',
      dataDir: 'C:\\nonexistent',
      autoDetected: true
    }
    const result = await parseInstances(probe, info)
    expect(result).toEqual([])
  })

  it('版本目录无 jar/json 时跳过', async () => {
    const home = 'C:\\Users\\test'
    const appData = `${home}\\AppData\\Roaming`
    const dataDir = `${appData}\\.minecraft`
    const versionsDir = `${dataDir}\\versions`
    const probe = makeFakeProbe({
      home,
      appData,
      existsPaths: new Set([versionsDir, `${versionsDir}\\empty`]),
      dirs: new Map([[versionsDir, ['empty']]])
    })
    const info: LauncherInfo = {
      id: 'official:test',
      kind: 'official',
      name: 'Minecraft Launcher',
      exePath: '',
      dataDir,
      autoDetected: true
    }
    const result = await parseInstances(probe, info)
    expect(result).toEqual([])
  })

  it('解析 Prism/MultiMC 实例并提取 loader', async () => {
    const home = 'C:\\Users\\test'
    const appData = `${home}\\AppData\\Roaming`
    const dataDir = `${appData}\\PrismLauncher`
    const instancesDir = `${dataDir}\\instances`
    const fabricDir = `${instancesDir}\\fabric-test`
    const forgeDir = `${instancesDir}\\forge-test`
    const probe = makeFakeProbe({
      home,
      appData,
      existsPaths: new Set([
        instancesDir,
        `${fabricDir}\\instance.cfg`,
        `${forgeDir}\\instance.cfg`
      ]),
      dirs: new Map([[instancesDir, ['fabric-test', 'forge-test']]]),
      files: new Map([
        [
          `${fabricDir}\\instance.cfg`,
          'InstanceName=fabric-test\nMinecraftVersion=1.20.1\nFabricVersion=0.15.7\n'
        ],
        [
          `${forgeDir}\\instance.cfg`,
          'InstanceName=forge-test\nMinecraftVersion=1.20.1\nForgeVersion=47.0.1\n'
        ]
      ])
    })
    const info: LauncherInfo = {
      id: 'prism:test',
      kind: 'prism',
      name: 'Prism Launcher',
      exePath: '',
      dataDir,
      autoDetected: true
    }
    const result = await parseInstances(probe, info)
    expect(result).toHaveLength(2)
    const fabric = result.find((i) => i.name === 'fabric-test')
    const forge = result.find((i) => i.name === 'forge-test')
    expect(fabric?.loader).toBe('fabric')
    expect(fabric?.loaderVersion).toBe('0.15.7')
    expect(fabric?.mcVersion).toBe('1.20.1')
    expect(fabric?.gamePath).toBe(fabricDir)
    expect(forge?.loader).toBe('forge')
    expect(forge?.loaderVersion).toBe('47.0.1')
  })

  it('Prism 实例无 cfg 文件时跳过', async () => {
    const home = 'C:\\Users\\test'
    const appData = `${home}\\AppData\\Roaming`
    const dataDir = `${appData}\\PrismLauncher`
    const instancesDir = `${dataDir}\\instances`
    const probe = makeFakeProbe({
      home,
      appData,
      existsPaths: new Set([instancesDir]),
      dirs: new Map([[instancesDir, ['no-cfg']]])
    })
    const info: LauncherInfo = {
      id: 'prism:test',
      kind: 'prism',
      name: 'Prism Launcher',
      exePath: '',
      dataDir,
      autoDetected: true
    }
    const result = await parseInstances(probe, info)
    expect(result).toEqual([])
  })

  it('BakaXL 实例解析', async () => {
    const home = 'C:\\Users\\test'
    const dataDir = `${home}\\.BakaXL`
    const instancesDir = `${dataDir}\\instances`
    const instanceDir = `${instancesDir}\\my-world`
    const probe = makeFakeProbe({
      home,
      existsPaths: new Set([instancesDir, `${instanceDir}\\instance.cfg`]),
      dirs: new Map([[instancesDir, ['my-world']]]),
      files: new Map([[`${instanceDir}\\instance.cfg`, 'MinecraftVersion=1.20.1\n']])
    })
    const info: LauncherInfo = {
      id: 'bakaxl:test',
      kind: 'bakaxl',
      name: 'BakaXL',
      exePath: '',
      dataDir,
      autoDetected: true
    }
    const result = await parseInstances(probe, info)
    expect(result).toHaveLength(1)
    expect(result[0].mcVersion).toBe('1.20.1')
    expect(result[0].gamePath).toBe(instanceDir)
  })

  it('HMCL 实例解析（复用 .minecraft/versions）', async () => {
    const home = 'C:\\Users\\test'
    const dataDir = `${home}\\.minecraft`
    const versionsDir = `${dataDir}\\versions`
    const probe = makeFakeProbe({
      home,
      appData: `${home}\\AppData\\Roaming`,
      existsPaths: new Set([
        versionsDir,
        `${versionsDir}\\1.20.1`,
        `${versionsDir}\\1.20.1\\1.20.1.json`
      ]),
      dirs: new Map([[versionsDir, ['1.20.1']]])
    })
    const info: LauncherInfo = {
      id: 'hmcl:test',
      kind: 'hmcl',
      name: 'HMCL',
      exePath: '',
      dataDir,
      autoDetected: true
    }
    const result = await parseInstances(probe, info)
    expect(result).toHaveLength(1)
    expect(result[0].mcVersion).toBe('1.20.1')
  })
})
