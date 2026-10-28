import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  AutoIntegrateResult,
  DetectResult,
  ImportResult,
  LauncherInfo,
  LauncherInstance,
  LauncherPersistedState
} from '../../../../shared/types/launcher'
import { useLauncherStore } from '../launcher'

/** window.api 打桩：store 只经 preload 白名单桥与主进程通信 */
interface ApiMock {
  on: ReturnType<typeof vi.fn>
  launcher: {
    detect: ReturnType<typeof vi.fn>
    listInstances: ReturnType<typeof vi.fn>
    import: ReturnType<typeof vi.fn>
    setActive: ReturnType<typeof vi.fn>
    launch: ReturnType<typeof vi.fn>
    add: ReturnType<typeof vi.fn>
    importBatch: ReturnType<typeof vi.fn>
    autoIntegrate: ReturnType<typeof vi.fn>
    getState: ReturnType<typeof vi.fn>
  }
}
let api: ApiMock

const pcl: LauncherInfo = {
  id: 'pcl2:C:\\PCL2.exe',
  kind: 'pcl2',
  name: 'PCL2',
  exePath: 'C:\\PCL2.exe',
  dataDir: 'C:\\mc',
  autoDetected: true
}
const official: LauncherInfo = {
  id: 'official:C:\\launcher.exe',
  kind: 'official',
  name: 'Minecraft Launcher',
  exePath: 'C:\\launcher.exe',
  dataDir: 'C:\\mc\\.minecraft',
  autoDetected: true
}

function instance(over: Partial<LauncherInstance> = {}): LauncherInstance {
  return {
    id: 'official:1.20.1',
    launcherId: official.id,
    name: '1.20.1',
    gamePath: 'C:\\mc\\.minecraft',
    mcVersion: '1.20.1',
    ...over
  }
}

function detectResult(launchers: LauncherInfo[], errors: string[] = []): DetectResult {
  return { launchers, errors }
}

function persistedState(over: Partial<LauncherPersistedState> = {}): LauncherPersistedState {
  return { activeInstanceId: null, activeLauncherId: null, records: [], ...over }
}

function autoResult(over: Partial<AutoIntegrateResult> = {}): AutoIntegrateResult {
  return { ok: true, candidates: [], ...over }
}

describe('launcher 启动器集成 store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    api = {
      on: vi.fn(),
      launcher: {
        detect: vi.fn().mockResolvedValue(detectResult([official])),
        listInstances: vi.fn().mockResolvedValue([instance()]),
        import: vi.fn().mockResolvedValue({ ok: true }),
        setActive: vi.fn().mockResolvedValue(true),
        launch: vi.fn().mockResolvedValue(true),
        add: vi.fn(),
        importBatch: vi.fn(),
        autoIntegrate: vi.fn().mockResolvedValue(autoResult()),
        getState: vi.fn().mockResolvedValue(persistedState())
      }
    }
    ;(window as unknown as { api: ApiMock }).api = api
  })

  describe('detect 扫描与状态恢复', () => {
    it('无持久化状态时默认选中第一个启动器并加载实例', async () => {
      api.launcher.detect.mockResolvedValue(detectResult([pcl, official]))
      const store = useLauncherStore()
      await store.detect()

      expect(store.launchers).toHaveLength(2)
      expect(store.selectedLauncherId).toBe(pcl.id)
      expect(api.launcher.listInstances).toHaveBeenCalledWith(pcl.id)
      expect(store.activeInstanceId).toBeNull()
    })

    it('恢复上次激活的启动器与实例，并回填导入记录', async () => {
      api.launcher.detect.mockResolvedValue(detectResult([pcl, official]))
      api.launcher.getState.mockResolvedValue(
        persistedState({
          activeLauncherId: official.id,
          activeInstanceId: 'official:1.20.1',
          records: [
            {
              id: 'r1',
              launcherId: official.id,
              instanceId: 'official:1.20.1',
              artifactPath: 'C:\\build\\mymod.jar',
              destPath: 'C:\\mc\\.minecraft\\mods\\mymod.jar',
              fileName: 'mymod.jar',
              importedAt: '2026-01-01T00:00:00.000Z'
            }
          ]
        })
      )
      const store = useLauncherStore()
      await store.detect()

      expect(store.selectedLauncherId).toBe(official.id)
      expect(store.activeInstanceId).toBe('official:1.20.1')
      expect(store.records).toHaveLength(1)
      expect(api.launcher.listInstances).toHaveBeenCalledWith(official.id)
    })

    it('持久化的启动器已不存在时回退到第一个启动器', async () => {
      api.launcher.detect.mockResolvedValue(detectResult([pcl]))
      api.launcher.getState.mockResolvedValue(
        persistedState({ activeLauncherId: 'uninstalled:x', activeInstanceId: 'inst:x' })
      )
      const store = useLauncherStore()
      await store.detect()

      expect(store.selectedLauncherId).toBe(pcl.id)
      expect(store.activeInstanceId).toBeNull()
    })

    it('getState 抛错时按首次使用处理，不阻断扫描结果', async () => {
      api.launcher.detect.mockResolvedValue(detectResult([pcl]))
      api.launcher.getState.mockRejectedValue(new Error('ENOENT'))
      const store = useLauncherStore()
      await store.detect()

      expect(store.launchers).toHaveLength(1)
      expect(store.selectedLauncherId).toBe(pcl.id)
      expect(store.error).toBeNull()
    })

    it('扫描错误写入 error 且不抛出', async () => {
      api.launcher.detect.mockResolvedValue(detectResult([], ['注册表读取失败']))
      const store = useLauncherStore()
      await store.detect()

      expect(store.error).toContain('注册表读取失败')
      expect(store.launchers).toEqual([])
    })

    it('detect 期间错误被捕获并复位 detecting', async () => {
      api.launcher.detect.mockRejectedValue(new Error('磁盘扫描超时'))
      const store = useLauncherStore()
      await store.detect()

      expect(store.error).toContain('磁盘扫描超时')
      expect(store.detecting).toBe(false)
    })
  })

  describe('autoIntegrate 自动集成', () => {
    it('成功后同步选中启动器、激活实例与候选理由', async () => {
      api.launcher.detect.mockResolvedValue(detectResult([pcl, official]))
      api.launcher.autoIntegrate.mockResolvedValue(
        autoResult({
          launcher: official,
          instance: instance(),
          activeInstanceId: 'official:1.20.1',
          modsDir: 'C:\\mc\\.minecraft\\mods',
          reason: '版本精确匹配 1.20.1，加载器匹配 fabric',
          candidates: [
            {
              launcherId: official.id,
              launcherName: official.name,
              instanceId: 'official:1.20.1',
              instanceName: '1.20.1',
              mcVersion: '1.20.1',
              loader: 'fabric',
              score: 155,
              reason: '版本精确匹配 1.20.1，加载器匹配 fabric'
            }
          ]
        })
      )
      const store = useLauncherStore()
      const result = await store.autoIntegrate({ mcVersion: '1.20.1', loader: 'fabric', projectId: 'p1' })

      expect(result?.ok).toBe(true)
      expect(api.launcher.autoIntegrate).toHaveBeenCalledWith({
        mcVersion: '1.20.1',
        loader: 'fabric',
        projectId: 'p1'
      })
      expect(store.selectedLauncherId).toBe(official.id)
      expect(store.activeInstanceId).toBe('official:1.20.1')
      expect(store.integrateReason).toContain('版本精确匹配')
      expect(store.candidates).toHaveLength(1)
      expect(store.integrating).toBe(false)
    })

    it('无匹配实例时保留候选并写入错误', async () => {
      api.launcher.autoIntegrate.mockResolvedValue(
        autoResult({
          ok: false,
          error: '没有与目标版本 1.21.1 匹配的实例',
          candidates: [
            {
              launcherId: official.id,
              launcherName: official.name,
              instanceId: 'official:1.20.1',
              instanceName: '1.20.1',
              mcVersion: '1.20.1',
              score: -60,
              reason: '版本不匹配 1.20.1（目标 1.21.1）'
            }
          ]
        })
      )
      const store = useLauncherStore()
      const result = await store.autoIntegrate({ mcVersion: '1.21.1' })

      expect(result?.ok).toBe(false)
      expect(store.error).toContain('1.21.1')
      expect(store.candidates).toHaveLength(1)
      expect(store.activeInstanceId).toBeNull()
    })

    it('主进程异常时返回 null 并复位 integrating', async () => {
      api.launcher.autoIntegrate.mockRejectedValue(new Error('reg.exe 不可用'))
      const store = useLauncherStore()
      const result = await store.autoIntegrate({})

      expect(result).toBeNull()
      expect(store.error).toContain('reg.exe 不可用')
      expect(store.integrating).toBe(false)
    })
  })

  describe('setActive 激活实例', () => {
    it('写入本地状态并持久化到主进程', async () => {
      const store = useLauncherStore()
      await store.setActive('official:1.20.1')

      expect(store.activeInstanceId).toBe('official:1.20.1')
      expect(api.launcher.setActive).toHaveBeenCalledWith('official:1.20.1')
    })

    it('主进程写入失败时记录 error', async () => {
      api.launcher.setActive.mockRejectedValue(new Error('写文件失败'))
      const store = useLauncherStore()
      await store.setActive('official:1.20.1')

      expect(store.error).toContain('写文件失败')
    })
  })

  describe('import 一键导入', () => {
    it('成功后追加导入记录', async () => {
      api.launcher.import.mockResolvedValue({
        ok: true,
        record: {
          id: 'r1',
          launcherId: official.id,
          instanceId: 'official:1.20.1',
          artifactPath: 'C:\\build\\mymod.jar',
          destPath: 'C:\\mc\\.minecraft\\mods\\mymod.jar',
          fileName: 'mymod.jar',
          importedAt: '2026-01-01T00:00:00.000Z'
        }
      } satisfies ImportResult)
      const store = useLauncherStore()
      store.selectedLauncherId = official.id
      const result = await store.import('C:\\build\\mymod.jar', 'official:1.20.1')

      expect(result?.ok).toBe(true)
      expect(store.records).toHaveLength(1)
      expect(store.records[0].fileName).toBe('mymod.jar')
      expect(store.importing).toBe(false)
    })

    it('未选启动器时直接提示且不调用主进程', async () => {
      const store = useLauncherStore()
      const result = await store.import('C:\\build\\mymod.jar', 'official:1.20.1')

      expect(result).toBeNull()
      expect(store.error).toContain('请先选择启动器')
      expect(api.launcher.import).not.toHaveBeenCalled()
    })

    it('冲突时写入 error 且不新增记录', async () => {
      api.launcher.import.mockResolvedValue({
        ok: false,
        conflict: { existingFileName: 'mymod.jar', existingPath: 'C:\\mc\\.minecraft\\mods\\mymod.jar' },
        error: '目标目录已存在同名文件：mymod.jar'
      } satisfies ImportResult)
      const store = useLauncherStore()
      store.selectedLauncherId = official.id
      const result = await store.import('C:\\build\\mymod.jar', 'official:1.20.1')

      expect(result?.conflict?.existingFileName).toBe('mymod.jar')
      expect(store.records).toEqual([])
      expect(store.error).toContain('同名文件')
    })
  })

  describe('selectLauncher 切换启动器', () => {
    it('切换后清空激活实例并重新加载实例列表', async () => {
      api.launcher.listInstances.mockResolvedValue([instance({ id: 'pcl:1.19.2', launcherId: pcl.id })])
      const store = useLauncherStore()
      store.selectedLauncherId = official.id
      store.activeInstanceId = 'official:1.20.1'

      await store.selectLauncher(pcl.id)

      expect(store.selectedLauncherId).toBe(pcl.id)
      expect(store.activeInstanceId).toBeNull()
      expect(api.launcher.listInstances).toHaveBeenCalledWith(pcl.id)
      expect(store.instances).toHaveLength(1)
    })

    it('重复选中同一启动器时不重复请求', async () => {
      const store = useLauncherStore()
      store.selectedLauncherId = pcl.id
      await store.selectLauncher(pcl.id)

      expect(api.launcher.listInstances).not.toHaveBeenCalled()
    })
  })
})
