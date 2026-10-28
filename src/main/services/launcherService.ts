/**
 * M11 启动器集成服务（注入式编排）。
 * detect → listInstances → import → setActive → launch 全链路。
 * 依赖注入 fs/进程，便于单测。
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, promises as fsp, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { detectLaunchers, parseInstances, type PathProbe } from './launcherDetect'
import type {
  AddLauncherInput,
  AutoIntegrateCandidate,
  AutoIntegrateInput,
  AutoIntegrateResult,
  DetectResult,
  ImportBatchInput,
  ImportBatchResult,
  ImportInput,
  ImportRecord,
  ImportResult,
  LauncherInfo,
  LauncherInstance,
  LauncherKind,
  LauncherPersistedState
} from '../../shared/types/launcher'

/** launcherService 的依赖注入接口（主进程包装 fs/spawn；测试用 fake） */
export interface LauncherDeps {
  pathProbe: PathProbe
  copyFile(src: string, dest: string): Promise<void>
  ensureDir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  readJson<T>(path: string): Promise<T | null>
  writeJson<T>(path: string, data: T): Promise<void>
  spawn(exe: string, args: string[], options?: { cwd?: string }): void
}

/** 持久化文件路径 */
export interface LauncherPaths {
  /** 导入记录 JSON */
  recordsFile: string
  /** 手动添加的启动器 JSON */
  manualLaunchersFile: string
  /** 激活实例 ID JSON */
  activeInstanceFile: string
  /** 项目 → 实例 的自动集成映射 JSON */
  integrationsFile: string
}

/** 启动器服务接口 */
export interface LauncherService {
  detect(): Promise<DetectResult>
  listInstances(launcherId: string): Promise<LauncherInstance[]>
  import(input: ImportInput): Promise<ImportResult>
  /** 批量导入（一次建目录、一次读写记录），供整合包启动测试装入整包模组 */
  importBatch(input: ImportBatchInput): Promise<ImportBatchResult>
  setActive(instanceId: string): Promise<boolean>
  launch(instanceId: string): Promise<boolean>
  add(input: AddLauncherInput): Promise<LauncherInfo>
  /** 自动扫描本机启动器并挑选最合适的实例，选中后持久化为激活实例 */
  autoIntegrate(input: AutoIntegrateInput): Promise<AutoIntegrateResult>
  /** 读取持久化状态（激活实例 / 激活启动器 / 导入记录），供渲染层重启后恢复 */
  getState(): Promise<LauncherPersistedState>
  /** 解析实例的游戏根与子目录（启动测试的日志/崩溃目录定位） */
  resolveInstance(
    instanceId: string
  ): Promise<{ launcher: LauncherInfo; instance: LauncherInstance } | null>
}

/** 从路径中提取文件名（兼容 \\ 和 /） */
function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || 'mod.jar'
}

/**
 * 实例的游戏根目录（`.minecraft` 所在目录）。
 * Prism/MultiMC/BakaXL 的 gamePath 是 `instances/<name>`，游戏根在其下 `.minecraft`；
 * 官方/HMCL/PCL2 的 gamePath 本身就是游戏根。
 */
export function instanceGameRoot(
  instance: LauncherInstance,
  kind: LauncherKind,
  joinFn: (...parts: string[]) => string = join
): string {
  if (kind === 'prism' || kind === 'multimc' || kind === 'bakaxl') {
    return joinFn(instance.gamePath, '.minecraft')
  }
  return instance.gamePath
}

/**
 * 实例游戏根下的子目录（mods / logs / crash-reports / config ...）。
 * 启动测试需要同时定位 mods、logs 与 crash-reports，故泛化为通用子目录解析。
 */
export function getInstanceSubDir(
  instance: LauncherInstance,
  kind: LauncherKind,
  sub: string,
  joinFn: (...parts: string[]) => string = join
): string {
  return joinFn(instanceGameRoot(instance, kind, joinFn), sub)
}

/** 根据启动器类型推断实例的 mods 目录 */
function getModsDir(
  instance: LauncherInstance,
  kind: LauncherKind,
  joinFn: (...parts: string[]) => string
): string {
  return getInstanceSubDir(instance, kind, 'mods', joinFn)
}

/** 生成记录 ID */
function makeRecordId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 版本族（major.minor），用于「版本接近」打分 */
function versionFamily(version: string): string {
  const parts = version.split('.')
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version
}

/**
 * 给实例按目标版本/加载器打分（纯函数，导出便于单测）。
 * 版本：精确 +100 / 同族 +40 / 不匹配 -60；
 * 加载器：命中 +50 / 未知 0 / 不匹配 -20；实例带加载器信息再 +5。
 */
export function scoreInstanceCandidate(
  instance: LauncherInstance,
  input: AutoIntegrateInput
): { score: number; reason: string } {
  const reasons: string[] = []
  let score = 0
  if (input.mcVersion) {
    if (instance.mcVersion === input.mcVersion) {
      score += 100
      reasons.push(`版本精确匹配 ${instance.mcVersion}`)
    } else if (versionFamily(instance.mcVersion) === versionFamily(input.mcVersion)) {
      score += 40
      reasons.push(`版本接近 ${instance.mcVersion}（目标 ${input.mcVersion}）`)
    } else {
      score -= 60
      reasons.push(`版本不匹配 ${instance.mcVersion}（目标 ${input.mcVersion}）`)
    }
  }
  if (input.loader) {
    if (instance.loader === input.loader) {
      score += 50
      reasons.push(`加载器匹配 ${instance.loader}`)
    } else if (!instance.loader) {
      reasons.push('加载器未知（可能是原版）')
    } else {
      score -= 20
      reasons.push(`加载器不匹配 ${instance.loader}（目标 ${input.loader}）`)
    }
  }
  if (instance.loader) score += 5
  if (!reasons.length) reasons.push('本机可用实例')
  return { score, reason: reasons.join('，') }
}

/**
 * 创建启动器服务实例（注入式）。
 * @param deps 文件系统/进程依赖
 * @param paths 持久化文件路径
 */
export function createLauncherService(
  deps: LauncherDeps,
  paths: LauncherPaths
): LauncherService {
  let launchersCache: LauncherInfo[] = []
  const instancesCache = new Map<string, LauncherInstance[]>()

  async function loadRecords(): Promise<ImportRecord[]> {
    return ((await deps.readJson<ImportRecord[]>(paths.recordsFile)) ?? [])
  }

  async function saveRecords(records: ImportRecord[]): Promise<void> {
    await deps.writeJson(paths.recordsFile, records)
  }

  async function loadManualLaunchers(): Promise<LauncherInfo[]> {
    return ((await deps.readJson<LauncherInfo[]>(paths.manualLaunchersFile)) ?? [])
  }

  async function saveManualLaunchers(launchers: LauncherInfo[]): Promise<void> {
    await deps.writeJson(paths.manualLaunchersFile, launchers)
  }

  /** 确保实例缓存就绪（未加载时从磁盘解析） */
  async function ensureInstances(
    launcherId: string
  ): Promise<{ launcher: LauncherInfo | undefined; instances: LauncherInstance[] }> {
    const launcher = launchersCache.find((l) => l.id === launcherId)
    if (!launcher) return { launcher: undefined, instances: [] }
    let instances = instancesCache.get(launcherId)
    if (!instances) {
      instances = await parseInstances(deps.pathProbe, launcher)
      instancesCache.set(launcherId, instances)
    }
    return { launcher, instances }
  }

  /** 重新扫描本机启动器（自动检测 + 手动添加）并清空实例缓存 */
  async function refreshLaunchers(): Promise<{ launchers: LauncherInfo[]; errors: string[] }> {
    const { launchers: auto, errors } = await detectLaunchers(deps.pathProbe)
    const manual = await loadManualLaunchers()
    launchersCache = [...auto, ...manual]
    instancesCache.clear()
    return { launchers: launchersCache, errors }
  }

  /** 在所有已缓存/已解析实例中查找指定实例 */
  async function findInstance(
    instanceId: string
  ): Promise<{ launcher: LauncherInfo; instance: LauncherInstance } | null> {
    for (const [launcherId, instances] of instancesCache) {
      const instance = instances.find((i) => i.id === instanceId)
      if (instance) {
        const launcher = launchersCache.find((l) => l.id === launcherId)
        if (launcher) return { launcher, instance }
      }
    }
    for (const launcher of launchersCache) {
      if (!instancesCache.has(launcher.id)) {
        instancesCache.set(launcher.id, await parseInstances(deps.pathProbe, launcher))
      }
      const instance = instancesCache.get(launcher.id)?.find((i) => i.id === instanceId)
      if (instance) return { launcher, instance }
    }
    return null
  }

  return {
    async detect(): Promise<DetectResult> {
      const { launchers, errors } = await refreshLaunchers()
      return { launchers, errors }
    },

    async listInstances(launcherId: string): Promise<LauncherInstance[]> {
      const { instances } = await ensureInstances(launcherId)
      return instances
    },

    async import(input: ImportInput): Promise<ImportResult> {
      const { launcher, instances } = await ensureInstances(input.launcherId)
      if (!launcher) return { ok: false, error: '启动器不存在' }
      const instance = instances.find((i) => i.id === input.instanceId)
      if (!instance) return { ok: false, error: '实例不存在' }

      const fileName = basename(input.artifactPath)
      const modsDir = getModsDir(instance, launcher.kind, deps.pathProbe.join)
      const destPath = deps.pathProbe.join(modsDir, fileName)

      // 冲突检测（按文件名完全匹配）
      if (!input.overwrite && (await deps.exists(destPath))) {
        return {
          ok: false,
          conflict: { existingFileName: fileName, existingPath: destPath },
          error: `目标目录已存在同名文件：${fileName}`
        }
      }

      await deps.ensureDir(modsDir)
      await deps.copyFile(input.artifactPath, destPath)

      const records = await loadRecords()
      const record: ImportRecord = {
        id: makeRecordId(),
        launcherId: input.launcherId,
        instanceId: input.instanceId,
        artifactPath: input.artifactPath,
        destPath,
        fileName,
        importedAt: new Date().toISOString()
      }
      records.push(record)
      await saveRecords(records)

      return { ok: true, record }
    },

    async importBatch(input: ImportBatchInput): Promise<ImportBatchResult> {
      const { launcher, instances } = await ensureInstances(input.launcherId)
      if (!launcher) {
        return { ok: false, imported: [], conflicts: [], failed: [], error: '启动器不存在' }
      }
      const instance = instances.find((i) => i.id === input.instanceId)
      if (!instance) {
        return { ok: false, imported: [], conflicts: [], failed: [], error: '实例不存在' }
      }

      const modsDir = getModsDir(instance, launcher.kind, deps.pathProbe.join)
      // 一次建目录 + 一次读写记录：避免逐个 import 造成的 O(N²) 记录全量写
      await deps.ensureDir(modsDir)
      const records = await loadRecords()

      const imported: string[] = []
      const conflicts: string[] = []
      const failed: Array<{ fileName: string; error: string }> = []

      for (const artifactPath of [...new Set(input.artifactPaths)]) {
        const fileName = basename(artifactPath)
        const destPath = deps.pathProbe.join(modsDir, fileName)
        if (!input.overwrite && (await deps.exists(destPath))) {
          // 已存在同名文件视为已就位，不重复复制也不记为失败
          conflicts.push(fileName)
          continue
        }
        try {
          await deps.copyFile(artifactPath, destPath)
        } catch (err) {
          failed.push({ fileName, error: err instanceof Error ? err.message : String(err) })
          continue
        }
        imported.push(fileName)
        const record: ImportRecord = {
          id: makeRecordId(),
          launcherId: input.launcherId,
          instanceId: input.instanceId,
          artifactPath,
          destPath,
          fileName,
          importedAt: new Date().toISOString()
        }
        records.push(record)
      }

      if (imported.length > 0) await saveRecords(records)

      return {
        ok: failed.length === 0,
        imported,
        conflicts,
        failed,
        modsDir
      }
    },

    async resolveInstance(
      instanceId: string
    ): Promise<{ launcher: LauncherInfo; instance: LauncherInstance } | null> {
      return findInstance(instanceId)
    },

    async autoIntegrate(input: AutoIntegrateInput): Promise<AutoIntegrateResult> {
      const { launchers, errors } = await refreshLaunchers()
      if (!launchers.length) {
        return {
          ok: false,
          candidates: [],
          error: errors.length ? `未检测到启动器：${errors[0]}` : '未检测到已安装的启动器'
        }
      }

      // 解析每个启动器的实例并打分（解析结果同时写入缓存，供后续 import/launch 复用）
      const candidates: AutoIntegrateCandidate[] = []
      for (const launcher of launchers) {
        const instances = await parseInstances(deps.pathProbe, launcher)
        instancesCache.set(launcher.id, instances)
        for (const instance of instances) {
          const { score, reason } = scoreInstanceCandidate(instance, input)
          candidates.push({
            launcherId: launcher.id,
            launcherName: launcher.name,
            instanceId: instance.id,
            instanceName: instance.name,
            mcVersion: instance.mcVersion,
            loader: instance.loader,
            score,
            reason
          })
        }
      }
      candidates.sort((a, b) => b.score - a.score)

      if (!candidates.length) {
        return { ok: false, candidates, error: '已检测到启动器，但没有可用的 Minecraft 实例' }
      }
      const best = candidates[0]
      // 指定了目标版本却只有不匹配实例时不自动选中，交由用户手动选择
      if (input.mcVersion && best.score <= 0) {
        return {
          ok: false,
          candidates,
          error: `没有与目标版本 ${input.mcVersion} 匹配的实例`
        }
      }

      const picked = await findInstance(best.instanceId)
      if (!picked) return { ok: false, candidates, error: '实例解析失败' }

      await deps.writeJson(paths.activeInstanceFile, {
        instanceId: best.instanceId,
        launcherId: best.launcherId
      })
      if (input.projectId) {
        const map =
          (await deps.readJson<Record<string, { launcherId: string; instanceId: string; updatedAt: string }>>(
            paths.integrationsFile
          )) ?? {}
        map[input.projectId] = {
          launcherId: best.launcherId,
          instanceId: best.instanceId,
          updatedAt: new Date().toISOString()
        }
        await deps.writeJson(paths.integrationsFile, map)
      }

      return {
        ok: true,
        launcher: picked.launcher,
        instance: picked.instance,
        modsDir: getModsDir(picked.instance, picked.launcher.kind, deps.pathProbe.join),
        activeInstanceId: best.instanceId,
        reason: best.reason,
        candidates
      }
    },

    async getState(): Promise<LauncherPersistedState> {
      const active = await deps.readJson<{ instanceId?: string; launcherId?: string }>(
        paths.activeInstanceFile
      )
      const records = await loadRecords()
      const activeInstanceId = active?.instanceId ?? null
      let activeLauncherId = active?.launcherId ?? null
      if (activeInstanceId && !activeLauncherId) {
        // 旧版只记了实例 ID：从导入记录或实例解析反推启动器
        activeLauncherId = records.find((r) => r.instanceId === activeInstanceId)?.launcherId ?? null
        if (!activeLauncherId) {
          const found = await findInstance(activeInstanceId)
          activeLauncherId = found?.launcher.id ?? null
        }
      }
      return { activeInstanceId, activeLauncherId, records }
    },

    async setActive(instanceId: string): Promise<boolean> {
      const found = await findInstance(instanceId)
      await deps.writeJson(paths.activeInstanceFile, {
        instanceId,
        launcherId: found?.launcher.id
      })
      return true
    },

    async launch(instanceId: string): Promise<boolean> {
      const found = await findInstance(instanceId)
      if (!found) return false
      const exe = found.launcher.exePath
      // jar 型启动器（如 HMCL 纯 jar 发行版）需要经 java 启动（javaw 仅 Windows 有）
      if (/\.jar$/i.test(exe)) {
        deps.spawn(process.platform === 'win32' ? 'javaw' : 'java', ['-jar', exe], { cwd: dirname(exe) })
      } else if (process.platform === 'darwin' && /\.app$/i.test(exe)) {
        // macOS .app 是目录形态，不能直接 exec，经 open 拉起
        deps.spawn('open', [exe])
      } else {
        deps.spawn(exe, [])
      }
      return true
    },

    async add(input: AddLauncherInput): Promise<LauncherInfo> {
      // dataDir 缺省取 exe 所在目录：去掉末段文件名（同时兼容 \ 与 / 分隔符），
      // 不能固定用 '\\' 拼接——mac 的 /Applications/xx.app 会被拼成反斜杠路径
      const dataDir = input.dataDir ?? input.exePath.replace(/[\\/][^\\/]*$/, '')
      const launcher: LauncherInfo = {
        id: `manual:${input.kind}:${input.exePath}`,
        kind: input.kind,
        name: input.name,
        exePath: input.exePath,
        dataDir,
        autoDetected: false
      }
      const manual = await loadManualLaunchers()
      manual.push(launcher)
      await saveManualLaunchers(manual)
      launchersCache.push(launcher)
      return launcher
    }
  }
}

// ─── 主进程默认实现 ───

/** 创建系统级 PathProbe（包装 fs/path/os） */
export function createSystemPathProbe(): PathProbe {
  const home = homedir()
  const appData = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
  const localAppData = process.env['LOCALAPPDATA'] ?? join(home, 'AppData', 'Local')
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  return {
    async exists(path) {
      return existsSync(path)
    },
    async readDirNames(path) {
      try {
        return await fsp.readdir(path)
      } catch {
        return []
      }
    },
    async readFileText(path) {
      return fsp.readFile(path, 'utf-8')
    },
    join: (...parts) => join(...parts),
    home: () => home,
    appData: () => appData,
    localAppData: () => localAppData,
    programFiles: () => programFiles,
    /** 枚举 C: 起的磁盘根（仅 Windows；不存在的盘符直接跳过） */
    async listDrives() {
      if (process.platform !== 'win32') return []
      const drives: string[] = []
      for (const letter of 'CDEFGH') {
        const root = `${letter}:\\`
        if (existsSync(root)) drives.push(root)
      }
      return drives
    },
    /** 读取注册表卸载项里的启动器相关程序（仅 Windows；失败返回空） */
    async listInstalledPrograms() {
      return listInstalledProgramsFromRegistry()
    }
  }
}

/** 注册表卸载项根（64 位、32 位、当前用户） */
const REGISTRY_UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
]

/** 只看启动器相关条目，避免把整张卸载表读进内存 */
const LAUNCHER_NAME_FILTER = /minecraft|hmcl|plain ?craft|pcl|prism ?launcher|multimc|bakaxl/i

/**
 * 解析 reg query 输出。格式：
 *   HKEY_LOCAL_MACHINE\...\Uninstall\{GUID}
 *       DisplayName    REG_SZ    Minecraft Launcher
 *       InstallLocation    REG_SZ    C:\Program Files\...
 */
export function parseUninstallRegistry(
  text: string
): Array<{ name: string; installLocation: string; iconPath?: string }> {
  const out: Array<{ name: string; installLocation: string; iconPath?: string }> = []
  let name = ''
  let installLocation = ''
  let iconPath = ''
  const flush = (): void => {
    if (name && LAUNCHER_NAME_FILTER.test(name)) {
      out.push({ name, installLocation, iconPath: iconPath || undefined })
    }
    name = ''
    installLocation = ''
    iconPath = ''
  }
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    // 新的一段以注册表路径开头
    if (/^HKEY_/i.test(raw.trim())) {
      flush()
      continue
    }
    const m = raw.match(/^\s+(DisplayName|InstallLocation|DisplayIcon)\s+REG_[A-Z_]+\s+(.*)$/i)
    if (!m) continue
    const value = m[2].trim()
    if (m[1].toLowerCase() === 'displayname') name = value
    else if (m[1].toLowerCase() === 'installlocation') installLocation = value.replace(/^"|"$/g, '')
    else {
      // DisplayIcon 常带 ",0" 图标索引与引号：先去索引再去引号
      iconPath = value
        .replace(/,\s*-?\d+$/, '')
        .trim()
        .replace(/^"|"$/g, '')
        .trim()
    }
  }
  flush()
  return out
}

/** 逐个查询卸载项根，失败静默（非 Windows / 权限不足） */
function listInstalledProgramsFromRegistry(): Array<{
  name: string
  installLocation: string
  iconPath?: string
}> {
  if (process.platform !== 'win32') return []
  const results: Array<{ name: string; installLocation: string; iconPath?: string }> = []
  const seen = new Set<string>()
  for (const key of REGISTRY_UNINSTALL_KEYS) {
    try {
      const text = execFileSync('reg', ['query', key, '/s'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 6000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      })
      for (const item of parseUninstallRegistry(text)) {
        const dedupe = `${item.name}|${item.installLocation}|${item.iconPath ?? ''}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        results.push(item)
      }
    } catch {
      // 该根不存在或 reg.exe 不可用：跳过
    }
  }
  return results
}

/** 创建系统级 LauncherDeps（包装 fs/child_process） */
export function createSystemDeps(): LauncherDeps {
  return {
    pathProbe: createSystemPathProbe(),
    async copyFile(src, dest) {
      await fsp.copyFile(src, dest)
    },
    async ensureDir(path) {
      await fsp.mkdir(path, { recursive: true })
    },
    async exists(path) {
      return existsSync(path)
    },
    async readJson<T>(path: string): Promise<T | null> {
      try {
        const text = await fsp.readFile(path, 'utf-8')
        return JSON.parse(text) as T
      } catch {
        return null
      }
    },
    async writeJson(path, data) {
      const dir = dirname(path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      await fsp.writeFile(path, JSON.stringify(data, null, 2), 'utf-8')
    },
    spawn(exe, args, options) {
      const child = spawn(exe, args, {
        detached: true,
        stdio: 'ignore',
        cwd: options?.cwd,
        windowsHide: false
      })
      child.unref()
    }
  }
}
