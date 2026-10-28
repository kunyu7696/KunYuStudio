import { describe, it, expect, vi } from 'vitest'
import { createLauncherService, getInstanceSubDir, instanceGameRoot, parseUninstallRegistry, scoreInstanceCandidate, type LauncherDeps, type LauncherPaths } from '../launcherService'
import type { LauncherInfo, LauncherInstance } from '../../../shared/types/launcher'
import type { PathProbe } from '../launcherDetect'

function makeFakeDeps(opts: {
  probe?: Partial<PathProbe>
  existsPaths?: Set<string>
  files?: Map<string, string>
  json?: Map<string, unknown>
  spawnFn?: ReturnType<typeof vi.fn>
}): { deps: LauncherDeps; paths: LauncherPaths; jsonStore: Map<string, unknown>; spawnMock: ReturnType<typeof vi.fn> } {
  const jsonStore = opts.json ?? new Map<string, unknown>()
  const spawnMock = opts.spawnFn ?? vi.fn()
  const probe: PathProbe = {
    async exists(path) {
      return opts.existsPaths?.has(path) ?? false
    },
    async readDirNames() {
      return []
    },
    async readFileText(path) {
      return opts.files?.get(path) ?? ''
    },
    join: (...parts) => parts.join('\\'),
    home: () => 'C:\\Users\\test',
    appData: () => 'C:\\Users\\test\\AppData\\Roaming',
    localAppData: () => 'C:\\Users\\test\\AppData\\Local',
    programFiles: () => 'C:\\Program Files',
    ...opts.probe
  }
  const deps: LauncherDeps = {
    pathProbe: probe,
    async copyFile() {},
    async ensureDir() {},
    // 委托给 probe.exists，使 mock 一处即统一
    exists: async (path) => probe.exists(path),
    async readJson<T>(path: string): Promise<T | null> {
      return (jsonStore.get(path) as T) ?? null
    },
    async writeJson(path, data) {
      jsonStore.set(path, data)
    },
    spawn: spawnMock
  }
  const paths: LauncherPaths = {
    recordsFile: 'records.json',
    manualLaunchersFile: 'manual.json',
    activeInstanceFile: 'active.json',
    integrationsFile: 'integrations.json'
  }
  return { deps, paths, jsonStore, spawnMock }
}

describe('createLauncherService', () => {
  describe('detect', () => {
    it('返回自动检测 + 手动添加的启动器', async () => {
      // 官方启动器候选路径按平台分支（与 launcherDetect 规则一致）
      const officialExe =
        process.platform === 'darwin'
          ? '/Applications/Minecraft.app'
          : process.platform === 'linux'
            ? '/usr/bin/minecraft-launcher'
            : 'C:\\Program Files\\Minecraft Launcher\\MinecraftLauncher.exe'
      const { deps, paths, jsonStore } = makeFakeDeps({
        existsPaths: new Set([officialExe])
      })
      const manualLauncher: LauncherInfo = {
        id: 'manual:pcl2:C:\\PCL2\\PCL.exe',
        kind: 'pcl2',
        name: 'My PCL2',
        exePath: 'C:\\PCL2\\PCL.exe',
        dataDir: 'C:\\PCL2',
        autoDetected: false
      }
      jsonStore.set('manual.json', [manualLauncher])

      const svc = createLauncherService(deps, paths)
      const result = await svc.detect()
      expect(result.launchers).toHaveLength(2)
      expect(result.launchers.some((l) => l.kind === 'official')).toBe(true)
      expect(result.launchers.some((l) => l.id === manualLauncher.id)).toBe(true)
    })

    it('detect 清空实例缓存', async () => {
      const { deps, paths } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      // 缓存清空后 listInstances 会重新解析
      const instances = await svc.listInstances('official:any')
      expect(instances).toEqual([])
    })
  })

  describe('listInstances', () => {
    it('启动器不存在返回空', async () => {
      const { deps, paths } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      const instances = await svc.listInstances('nonexistent')
      expect(instances).toEqual([])
    })
  })

  describe('import', () => {
    it('正常导入：复制文件 + 写记录', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      const copySpy = vi.spyOn(deps, 'copyFile')
      const ensureSpy = vi.spyOn(deps, 'ensureDir')

      const svc = createLauncherService(deps, paths)
      // 注入 launcher 和 instance 到缓存
      const launcher: LauncherInfo = {
        id: 'official:1',
        kind: 'official',
        name: 'Minecraft Launcher',
        exePath: '',
        dataDir: 'C:\\mc\\.minecraft',
        autoDetected: true
      }
      // 用 detect 先缓存 launcher，然后 mock parseInstances
      await svc.detect()
      // 直接操作 service 内部缓存不可行，改为通过 add + listInstances
      // 这里用更简单的方法：手动设置 jsonStore 中的 manual launcher
      jsonStore.set('manual.json', [launcher])
      await svc.detect()
      // mock pathProbe 让 parseInstances 返回 instance
      deps.pathProbe.exists = async (path) => {
        if (path.includes('versions') || path.includes('1.20.1')) return true
        return false
      }
      deps.pathProbe.readDirNames = async () => ['1.20.1']
      // 这样 parseMinecraftVersions 会返回一个 instance

      const result = await svc.import({
        launcherId: launcher.id,
        instanceId: 'official:1.20.1',
        artifactPath: 'C:\\build\\mymod-1.0.0.jar'
      })
      // 由于 instance ID = official:1.20.1（makeId 返回 kind:name）
      expect(result.ok).toBe(true)
      expect(result.record).toBeDefined()
      expect(result.record?.fileName).toBe('mymod-1.0.0.jar')
      expect(result.record?.destPath).toContain('mods')
      expect(copySpy).toHaveBeenCalled()
      expect(ensureSpy).toHaveBeenCalled()

      const records = jsonStore.get('records.json') as Array<{ id: string }>
      expect(records).toHaveLength(1)
    })

    it('冲突检测：同名文件存在且未覆盖', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      const launcher: LauncherInfo = {
        id: 'official:1',
        kind: 'official',
        name: 'Minecraft Launcher',
        exePath: '',
        dataDir: 'C:\\mc\\.minecraft',
        autoDetected: true
      }
      jsonStore.set('manual.json', [launcher])

      const svc = createLauncherService(deps, paths)
      await svc.detect()

      // mock parseInstances 返回 instance
      deps.pathProbe.exists = async (path) => {
        if (path.includes('versions') || path.includes('1.20.1')) return true
        if (path.endsWith('mymod-1.0.0.jar')) return true // 冲突！
        return false
      }
      deps.pathProbe.readDirNames = async () => ['1.20.1']

      const result = await svc.import({
        launcherId: launcher.id,
        instanceId: 'official:1.20.1',
        artifactPath: 'C:\\build\\mymod-1.0.0.jar'
      })
      expect(result.ok).toBe(false)
      expect(result.conflict).toBeDefined()
      expect(result.conflict?.existingFileName).toBe('mymod-1.0.0.jar')
    })

    it('overwrite=true 时覆盖文件', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      const launcher: LauncherInfo = {
        id: 'official:1',
        kind: 'official',
        name: 'Minecraft Launcher',
        exePath: '',
        dataDir: 'C:\\mc\\.minecraft',
        autoDetected: true
      }
      jsonStore.set('manual.json', [launcher])

      const svc = createLauncherService(deps, paths)
      await svc.detect()

      deps.pathProbe.exists = async (path) => {
        if (path.includes('versions') || path.includes('1.20.1')) return true
        if (path.endsWith('mymod-1.0.0.jar')) return true // 同名文件存在
        return false
      }
      deps.pathProbe.readDirNames = async () => ['1.20.1']

      const copySpy = vi.spyOn(deps, 'copyFile')
      const result = await svc.import({
        launcherId: launcher.id,
        instanceId: 'official:1.20.1',
        artifactPath: 'C:\\build\\mymod-1.0.0.jar',
        overwrite: true
      })
      expect(result.ok).toBe(true)
      expect(result.record).toBeDefined()
      expect(copySpy).toHaveBeenCalled()
    })

    it('启动器不存在时返回 error', async () => {
      const { deps, paths } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      const result = await svc.import({
        launcherId: 'nonexistent',
        instanceId: 'inst:1',
        artifactPath: 'C:\\build\\mod.jar'
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('启动器')
    })

    it('实例不存在时返回 error', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      const launcher: LauncherInfo = {
        id: 'official:1',
        kind: 'official',
        name: 'Minecraft Launcher',
        exePath: '',
        dataDir: 'C:\\mc\\.minecraft',
        autoDetected: true
      }
      jsonStore.set('manual.json', [launcher])
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      // versions 目录不存在，parseInstances 返回空
      const result = await svc.import({
        launcherId: launcher.id,
        instanceId: 'nonexistent',
        artifactPath: 'C:\\build\\mod.jar'
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('实例')
    })
  })

  describe('setActive', () => {
    it('保存激活实例 ID', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      const ok = await svc.setActive('inst:1')
      expect(ok).toBe(true)
      const data = jsonStore.get('active.json') as { instanceId: string }
      expect(data.instanceId).toBe('inst:1')
    })
  })

  describe('launch', () => {
    it('从缓存找到实例并 spawn', async () => {
      const { deps, paths, jsonStore, spawnMock } = makeFakeDeps({})
      const launcher: LauncherInfo = {
        id: 'official:1',
        kind: 'official',
        name: 'Minecraft Launcher',
        exePath: 'C:\\launcher.exe',
        dataDir: 'C:\\mc\\.minecraft',
        autoDetected: true
      }
      jsonStore.set('manual.json', [launcher])
      const svc = createLauncherService(deps, paths)
      await svc.detect()

      // 让 parseInstances 返回 instance
      deps.pathProbe.exists = async (path) => {
        return path.includes('versions') || path.includes('1.20.1')
      }
      deps.pathProbe.readDirNames = async () => ['1.20.1']

      // 先 listInstances 填充缓存
      await svc.listInstances(launcher.id)
      const ok = await svc.launch('official:1.20.1')
      expect(ok).toBe(true)
      expect(spawnMock).toHaveBeenCalledWith('C:\\launcher.exe', [])
    })

    it('缓存未命中时遍历加载', async () => {
      const { deps, paths, jsonStore, spawnMock } = makeFakeDeps({})
      const launcher: LauncherInfo = {
        id: 'official:1',
        kind: 'official',
        name: 'Minecraft Launcher',
        exePath: 'C:\\launcher.exe',
        dataDir: 'C:\\mc\\.minecraft',
        autoDetected: true
      }
      jsonStore.set('manual.json', [launcher])
      const svc = createLauncherService(deps, paths)
      await svc.detect()

      deps.pathProbe.exists = async (path) => {
        return path.includes('versions') || path.includes('1.20.1')
      }
      deps.pathProbe.readDirNames = async () => ['1.20.1']

      // 不先 listInstances，直接 launch
      const ok = await svc.launch('official:1.20.1')
      expect(ok).toBe(true)
      expect(spawnMock).toHaveBeenCalledWith('C:\\launcher.exe', [])
    })

    it('实例不存在返回 false', async () => {
      const { deps, paths, jsonStore, spawnMock } = makeFakeDeps({})
      jsonStore.set('manual.json', [
        {
          id: 'official:1',
          kind: 'official',
          name: 'Minecraft Launcher',
          exePath: 'C:\\launcher.exe',
          dataDir: 'C:\\mc\\.minecraft',
          autoDetected: true
        } as LauncherInfo
      ])
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      const ok = await svc.launch('nonexistent')
      expect(ok).toBe(false)
      expect(spawnMock).not.toHaveBeenCalled()
    })

    it('jar 启动器按平台选 javaw（win）/ java（mac/linux）', async () => {
      const { deps, paths, jsonStore, spawnMock } = makeFakeDeps({})
      const exe = 'C:\\hmcl\\hmcl.jar'
      const launcher: LauncherInfo = {
        id: 'hmcl:1',
        kind: 'hmcl',
        name: 'HMCL',
        exePath: exe,
        dataDir: 'C:\\hmcl\\.minecraft',
        autoDetected: true
      }
      jsonStore.set('manual.json', [launcher])
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      deps.pathProbe.exists = async (path) => path.includes('versions') || path.includes('1.20.1')
      deps.pathProbe.readDirNames = async () => ['1.20.1']
      await svc.listInstances(launcher.id)

      const ok = await svc.launch('hmcl:1.20.1')
      expect(ok).toBe(true)
      expect(spawnMock).toHaveBeenCalledWith(
        process.platform === 'win32' ? 'javaw' : 'java',
        ['-jar', exe],
        expect.anything()
      )
    })

    // macOS 专属：.app 经 open 拉起（win/linux CI 上该分支不触发，跳过）
    const darwinIt = process.platform === 'darwin' ? it : it.skip
    darwinIt('macOS .app 启动器经 open 拉起', async () => {
      const { deps, paths, jsonStore, spawnMock } = makeFakeDeps({})
      const launcher: LauncherInfo = {
        id: 'official:1',
        kind: 'official',
        name: 'Minecraft Launcher',
        exePath: '/Applications/Minecraft.app',
        dataDir: '/Users/x/Library/Application Support/minecraft',
        autoDetected: true
      }
      jsonStore.set('manual.json', [launcher])
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      deps.pathProbe.exists = async (path) => path.includes('versions') || path.includes('1.20.1')
      deps.pathProbe.readDirNames = async () => ['1.20.1']
      await svc.listInstances(launcher.id)

      const ok = await svc.launch('official:1.20.1')
      expect(ok).toBe(true)
      expect(spawnMock).toHaveBeenCalledWith('open', ['/Applications/Minecraft.app'])
    })
  })

  describe('add', () => {
    it('添加手动启动器并持久化', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      await svc.detect()

      const result = await svc.add({
        kind: 'pcl2',
        name: 'My PCL2',
        exePath: 'C:\\PCL2\\PlainCraftLauncher.exe'
      })
      expect(result.id).toContain('manual:pcl2:')
      expect(result.autoDetected).toBe(false)
      expect(result.dataDir).toBe('C:\\PCL2')

      const manual = jsonStore.get('manual.json') as LauncherInfo[]
      expect(manual).toHaveLength(1)
      expect(manual[0].name).toBe('My PCL2')
    })

    it('add 后 detect 返回自动+手动', async () => {
      const { deps, paths } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      await svc.add({
        kind: 'pcl2',
        name: 'My PCL2',
        exePath: 'C:\\PCL2\\PCL.exe'
      })
      const result = await svc.detect()
      const manual = result.launchers.filter((l) => !l.autoDetected)
      expect(manual).toHaveLength(1)
    })

    it('add 传入 dataDir 时使用传入值', async () => {
      const { deps, paths } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      const result = await svc.add({
        kind: 'hmcl',
        name: 'HMCL Custom',
        exePath: 'C:\\hmcl.jar',
        dataDir: 'C:\\custom-mc'
      })
      expect(result.dataDir).toBe('C:\\custom-mc')
    })
  })

  describe('getInstanceSubDir / instanceGameRoot', () => {
    const prismInstance: LauncherInstance = {
      id: 'prism:1.20.1',
      launcherId: 'prism:1',
      name: '1.20.1',
      gamePath: 'D:\\Prism\\instances\\pack',
      mcVersion: '1.20.1'
    }
    const officialInstance: LauncherInstance = {
      id: 'official:1.20.1',
      launcherId: 'official:1',
      name: '1.20.1',
      gamePath: 'C:\\mc\\.minecraft',
      mcVersion: '1.20.1'
    }

    it('prism 实例的 mods 在 .minecraft 下', () => {
      expect(getInstanceSubDir(prismInstance, 'prism', 'mods', (...parts) => parts.join('\\'))).toBe(
        'D:\\Prism\\instances\\pack\\.minecraft\\mods'
      )
    })

    it('官方启动器的 gamePath 即游戏根', () => {
      expect(
        getInstanceSubDir(officialInstance, 'official', 'mods', (...parts) => parts.join('\\'))
      ).toBe('C:\\mc\\.minecraft\\mods')
      expect(instanceGameRoot(officialInstance, 'official', (...parts) => parts.join('\\'))).toBe(
        'C:\\mc\\.minecraft'
      )
    })

    it('logs 目录复用同一解析（启动测试用）', () => {
      expect(getInstanceSubDir(prismInstance, 'prism', 'logs', (...parts) => parts.join('\\'))).toBe(
        'D:\\Prism\\instances\\pack\\.minecraft\\logs'
      )
    })
  })

  describe('importBatch', () => {
    /** 复用既有 mock 约定：versions/1.20.1 存在即解析出实例 official:1.20.1 */
    async function setup(): Promise<{
      deps: LauncherDeps
      paths: LauncherPaths
      jsonStore: Map<string, unknown>
      svc: ReturnType<typeof createLauncherService>
    }> {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      jsonStore.set('manual.json', [
        {
          id: 'official:1',
          kind: 'official',
          name: 'Minecraft Launcher',
          exePath: 'C:\\launcher.exe',
          dataDir: 'C:\\mc\\.minecraft',
          autoDetected: true
        } as LauncherInfo
      ])
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      deps.pathProbe.exists = async (path) =>
        path.includes('versions') || path.includes('1.20.1')
      deps.pathProbe.readDirNames = async () => ['1.20.1']
      return { deps, paths, jsonStore, svc }
    }

    it('批量导入：一次建目录、一次写记录，文件名全部就位', async () => {
      const { deps, jsonStore, svc } = await setup()
      const ensureSpy = vi.spyOn(deps, 'ensureDir')
      const copySpy = vi.spyOn(deps, 'copyFile')

      const result = await svc.importBatch({
        launcherId: 'official:1',
        instanceId: 'official:1.20.1',
        artifactPaths: ['C:\\proj\\run\\mods\\a.jar', 'C:\\proj\\run\\mods\\b.jar']
      })

      expect(result.ok).toBe(true)
      expect(result.imported).toEqual(['a.jar', 'b.jar'])
      expect(result.conflicts).toEqual([])
      expect(result.failed).toEqual([])
      expect(result.modsDir).toContain('mods')
      // 一次 ensureDir + 每个文件一次 copyFile
      expect(ensureSpy).toHaveBeenCalledTimes(1)
      expect(copySpy).toHaveBeenCalledTimes(2)
      // 记录只写一次，长度等于实际复制数（避免逐个 import 的 O(N²) 全量写）
      const records = jsonStore.get('records.json') as Array<{ fileName: string }>
      expect(records).toHaveLength(2)
    })

    it('重复路径去重，不重复复制', async () => {
      const { deps, svc } = await setup()
      const copySpy = vi.spyOn(deps, 'copyFile')
      const result = await svc.importBatch({
        launcherId: 'official:1',
        instanceId: 'official:1.20.1',
        artifactPaths: ['C:\\proj\\run\\mods\\a.jar', 'C:\\proj\\run\\mods\\a.jar']
      })
      expect(result.imported).toEqual(['a.jar'])
      expect(copySpy).toHaveBeenCalledTimes(1)
    })

    it('目标已存在同名文件视为已就位（不计失败）', async () => {
      const { deps, svc } = await setup()
      deps.pathProbe.exists = async (path) => {
        if (path.includes('versions') || path.includes('1.20.1')) return true
        return path.endsWith('existing.jar')
      }
      const copySpy = vi.spyOn(deps, 'copyFile')

      const result = await svc.importBatch({
        launcherId: 'official:1',
        instanceId: 'official:1.20.1',
        artifactPaths: ['C:\\proj\\run\\mods\\existing.jar', 'C:\\proj\\run\\mods\\new.jar']
      })

      expect(result.ok).toBe(true)
      expect(result.conflicts).toEqual(['existing.jar'])
      expect(result.imported).toEqual(['new.jar'])
      expect(copySpy).toHaveBeenCalledTimes(1)
    })

    it('单个文件复制失败：计入 failed 并判定 ok=false，其余继续', async () => {
      const { deps, svc } = await setup()
      deps.copyFile = async (src) => {
        if (src.includes('bad.jar')) throw new Error('磁盘被占用')
      }

      const result = await svc.importBatch({
        launcherId: 'official:1',
        instanceId: 'official:1.20.1',
        artifactPaths: ['C:\\proj\\run\\mods\\bad.jar', 'C:\\proj\\run\\mods\\ok.jar']
      })

      expect(result.ok).toBe(false)
      expect(result.failed).toEqual([{ fileName: 'bad.jar', error: '磁盘被占用' }])
      expect(result.imported).toEqual(['ok.jar'])
    })

    it('实例不存在时返回 error 且不触碰目录', async () => {
      const { deps, svc } = await setup()
      const ensureSpy = vi.spyOn(deps, 'ensureDir')
      const result = await svc.importBatch({
        launcherId: 'official:1',
        instanceId: 'official:nope',
        artifactPaths: ['C:\\proj\\run\\mods\\a.jar']
      })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('实例')
      expect(ensureSpy).not.toHaveBeenCalled()
    })
  })

  describe('resolveInstance', () => {
    it('按实例 ID 解析出启动器与实例', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      jsonStore.set('manual.json', [
        {
          id: 'official:1',
          kind: 'official',
          name: 'Minecraft Launcher',
          exePath: 'C:\\launcher.exe',
          dataDir: 'C:\\mc\\.minecraft',
          autoDetected: true
        } as LauncherInfo
      ])
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      deps.pathProbe.exists = async (path) =>
        path.includes('versions') || path.includes('1.20.1')
      deps.pathProbe.readDirNames = async () => ['1.20.1']

      const resolved = await svc.resolveInstance('official:1.20.1')
      expect(resolved?.launcher.id).toBe('official:1')
      expect(resolved?.instance.gamePath).toContain('mc')
    })

    it('实例不存在返回 null', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      jsonStore.set('manual.json', [
        {
          id: 'official:1',
          kind: 'official',
          name: 'Minecraft Launcher',
          exePath: 'C:\\launcher.exe',
          dataDir: 'C:\\mc\\.minecraft',
          autoDetected: true
        } as LauncherInfo
      ])
      const svc = createLauncherService(deps, paths)
      await svc.detect()
      expect(await svc.resolveInstance('nope')).toBeNull()
    })
  })

  describe('parseUninstallRegistry', () => {
    it('解析启动器相关条目（名称/安装目录/图标）', () => {
      const text = [
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HMCL',
        '    DisplayName    REG_SZ    HMCL',
        '    InstallLocation    REG_SZ    D:\\Tools\\HMCL',
        '    DisplayIcon    REG_SZ    "D:\\Tools\\HMCL\\HMCL.exe",0',
        '',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Other',
        '    DisplayName    REG_SZ    Some Other App',
        '    InstallLocation    REG_SZ    C:\\Other'
      ].join('\r\n')
      const result = parseUninstallRegistry(text)
      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('HMCL')
      expect(result[0].installLocation).toBe('D:\\Tools\\HMCL')
      expect(result[0].iconPath).toBe('D:\\Tools\\HMCL\\HMCL.exe')
    })

    it('无匹配条目时返回空', () => {
      const text = [
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\X',
        '    DisplayName    REG_SZ    Notepad'
      ].join('\n')
      expect(parseUninstallRegistry(text)).toEqual([])
    })
  })

  describe('scoreInstanceCandidate', () => {
    const base: LauncherInstance = {
      id: 'official:1.20.1',
      launcherId: 'official:1',
      name: '1.20.1',
      gamePath: 'C:\\mc\\.minecraft',
      mcVersion: '1.20.1'
    }

    it('版本精确匹配 + 加载器命中得分最高', () => {
      const { score, reason } = scoreInstanceCandidate({ ...base, loader: 'fabric' }, {
        mcVersion: '1.20.1',
        loader: 'fabric'
      })
      expect(score).toBe(155)
      expect(reason).toContain('版本精确匹配')
      expect(reason).toContain('加载器匹配')
    })

    it('同族版本只给接近分', () => {
      const { score, reason } = scoreInstanceCandidate(base, { mcVersion: '1.20.4' })
      expect(score).toBe(40)
      expect(reason).toContain('版本接近')
    })

    it('版本不匹配得负分', () => {
      const { score } = scoreInstanceCandidate(base, { mcVersion: '1.21.1' })
      expect(score).toBeLessThan(0)
    })

    it('不指定版本/加载器时按可用实例给基础分', () => {
      const { score, reason } = scoreInstanceCandidate(base, {})
      expect(score).toBe(0)
      expect(reason).toContain('可用实例')
    })
  })

  describe('autoIntegrate', () => {
    /** 注入一个官方启动器 + versions 下 1.20.1/1.19.2 两个实例 */
    async function setup(): Promise<{
      deps: LauncherDeps
      paths: LauncherPaths
      jsonStore: Map<string, unknown>
      svc: ReturnType<typeof createLauncherService>
    }> {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      jsonStore.set('manual.json', [
        {
          id: 'official:1',
          kind: 'official',
          name: 'Minecraft Launcher',
          exePath: 'C:\\launcher.exe',
          dataDir: 'C:\\mc\\.minecraft',
          autoDetected: true
        } as LauncherInfo
      ])
      const svc = createLauncherService(deps, paths)
      deps.pathProbe.exists = async (path) =>
        path.includes('versions') || path.includes('1.20.1') || path.includes('1.19.2')
      deps.pathProbe.readDirNames = async () => ['1.20.1', '1.19.2']
      return { deps, paths, jsonStore, svc }
    }

    it('按目标版本选中实例并持久化激活状态', async () => {
      const { jsonStore, svc } = await setup()
      const result = await svc.autoIntegrate({ mcVersion: '1.20.1', projectId: 'proj-1' })

      expect(result.ok).toBe(true)
      expect(result.instance?.id).toBe('official:1.20.1')
      expect(result.activeInstanceId).toBe('official:1.20.1')
      expect(result.modsDir).toContain('mods')
      expect(result.reason).toContain('版本精确匹配')
      // 候选按得分降序
      expect(result.candidates.length).toBe(2)
      expect(result.candidates[0].score).toBeGreaterThanOrEqual(result.candidates[1].score)

      const active = jsonStore.get('active.json') as { instanceId: string; launcherId: string }
      expect(active.instanceId).toBe('official:1.20.1')
      expect(active.launcherId).toBe('official:1')

      const map = jsonStore.get('integrations.json') as Record<string, { instanceId: string }>
      expect(map['proj-1'].instanceId).toBe('official:1.20.1')
    })

    it('目标版本无匹配实例时不自动选中', async () => {
      const { svc } = await setup()
      const result = await svc.autoIntegrate({ mcVersion: '1.21.1' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('1.21.1')
      expect(result.candidates.length).toBe(2)
    })

    it('未检测到启动器时返回错误', async () => {
      const { deps, paths } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      const result = await svc.autoIntegrate({})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('启动器')
      expect(result.candidates).toEqual([])
    })

    it('启动器存在但无实例时返回错误', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      jsonStore.set('manual.json', [
        {
          id: 'official:1',
          kind: 'official',
          name: 'Minecraft Launcher',
          exePath: 'C:\\launcher.exe',
          dataDir: 'C:\\mc\\.minecraft',
          autoDetected: true
        } as LauncherInfo
      ])
      const svc = createLauncherService(deps, paths)
      const result = await svc.autoIntegrate({})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('实例')
    })
  })

  describe('getState', () => {
    it('恢复激活实例、启动器与导入记录', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      jsonStore.set('active.json', { instanceId: 'official:1.20.1', launcherId: 'official:1' })
      jsonStore.set('records.json', [
        { id: 'r1', launcherId: 'official:1', instanceId: 'official:1.20.1' }
      ])

      const svc = createLauncherService(deps, paths)
      const state = await svc.getState()
      expect(state.activeInstanceId).toBe('official:1.20.1')
      expect(state.activeLauncherId).toBe('official:1')
      expect(state.records).toHaveLength(1)
    })

    it('旧版只记录实例 ID 时从导入记录反推启动器', async () => {
      const { deps, paths, jsonStore } = makeFakeDeps({})
      jsonStore.set('active.json', { instanceId: 'official:1.20.1' })
      jsonStore.set('records.json', [
        { id: 'r1', launcherId: 'official:1', instanceId: 'official:1.20.1' }
      ])

      const svc = createLauncherService(deps, paths)
      const state = await svc.getState()
      expect(state.activeLauncherId).toBe('official:1')
    })

    it('无持久化文件时返回空状态', async () => {
      const { deps, paths } = makeFakeDeps({})
      const svc = createLauncherService(deps, paths)
      const state = await svc.getState()
      expect(state.activeInstanceId).toBeNull()
      expect(state.activeLauncherId).toBeNull()
      expect(state.records).toEqual([])
    })
  })
})
