/**
 * M11 启动器检测纯函数模块。
 * 不直接访问 fs/path/os，通过注入 PathProbe 接口实现可测性。
 * 路径规则参考各启动器官方文档与常见安装位置。
 */

import type {
  DetectResult,
  LauncherInfo,
  LauncherInstance,
  LauncherKind,
  LauncherLoader
} from '../../shared/types/launcher'

/**
 * 路径探测注入接口（纯函数可测）。
 * 主进程 launcherService 实现包装 fs/path/os；测试用 fake。
 */
export interface PathProbe {
  exists(path: string): Promise<boolean>
  readDirNames(path: string): Promise<string[]>
  readFileText(path: string): Promise<string>
  join(...parts: string[]): string
  home(): string
  appData(): string
  localAppData(): string
  programFiles(): string
  /**
   * 可选：本机磁盘根（如 C:\、D:\）。
   * 用于「全盘浅扫」——非 Windows 或无权限时可缺省，缺省即不扫磁盘根。
   */
  listDrives?(): Promise<string[]>
  /**
   * 可选：已安装程序清单（Windows 注册表卸载项）。
   * 只返回启动器相关条目即可，实现方负责关键词过滤；缺省即跳过注册表探测。
   */
  listInstalledPrograms?(): Promise<Array<{ name: string; installLocation: string; iconPath?: string }>>
}

/** 扫描规则：在固定候选路径之外，按文件名在常见根目录里搜索启动器 */
interface ScanRule {
  /** 可执行文件名匹配（大小写不敏感，仅文件名不含路径） */
  match: RegExp
  /** 可执行文件所在目录 → 启动器数据目录 */
  dataDir(dir: string, probe: PathProbe): string
  /** 注册表 DisplayName 匹配（缺省不查注册表） */
  registry?: RegExp
}

/** 探测规则：候选路径 + 实例解析 */
interface DetectorRule {
  kind: LauncherKind
  displayName: string
  /** 返回候选 [exePath, dataDir] 对（按优先级排序） */
  candidates(probe: PathProbe): Array<{ exePath: string; dataDir: string }>
  /** 可选：主机扫描规则（覆盖非标准安装位置） */
  scan?: ScanRule
  /** 从启动器信息解析实例列表 */
  instances(probe: PathProbe, info: LauncherInfo): Promise<LauncherInstance[]>
}

/** 生成稳定 ID（kind:标识） */
function makeId(kind: LauncherKind, suffix: string): string {
  return `${kind}:${suffix}`
}

/**
 * 解析 Java Properties / INI 格式的 key=value 行。
 * 导出以便单测覆盖。
 */
export function parseIniValue(text: string, key: string): string | undefined {
  const prefix = `${key}=`
  const line = text.split(/\r?\n/).find((l) => l.trim().startsWith(prefix))
  if (!line) return undefined
  return line.slice(line.indexOf('=') + 1).trim()
}

/** 从 .minecraft/versions/ 解析实例（官方/HMCL/PCL2 共用） */
async function parseMinecraftVersions(
  probe: PathProbe,
  info: LauncherInfo
): Promise<LauncherInstance[]> {
  const versionsDir = probe.join(info.dataDir, 'versions')
  if (!(await probe.exists(versionsDir))) return []
  const names = await probe.readDirNames(versionsDir)
  const instances: LauncherInstance[] = []
  for (const name of names) {
    const versionDir = probe.join(versionsDir, name)
    const jar = probe.join(versionDir, `${name}.jar`)
    const json = probe.join(versionDir, `${name}.json`)
    if (!(await probe.exists(jar)) && !(await probe.exists(json))) continue
    instances.push({
      id: makeId(info.kind, name),
      launcherId: info.id,
      name,
      gamePath: info.dataDir,
      mcVersion: name
    })
  }
  return instances
}

/** 从 Prism/MultiMC instances/ + instance.cfg 解析 */
async function parsePrismInstances(
  probe: PathProbe,
  info: LauncherInfo
): Promise<LauncherInstance[]> {
  const instancesDir = probe.join(info.dataDir, 'instances')
  if (!(await probe.exists(instancesDir))) return []
  const names = await probe.readDirNames(instancesDir)
  const instances: LauncherInstance[] = []
  for (const name of names) {
    const cfgPath = probe.join(instancesDir, name, 'instance.cfg')
    if (!(await probe.exists(cfgPath))) continue
    const cfg = await probe.readFileText(cfgPath)
    const mcVersion = parseIniValue(cfg, 'MinecraftVersion') ?? name
    const forgeVer = parseIniValue(cfg, 'ForgeVersion')
    const fabricVer = parseIniValue(cfg, 'FabricVersion')
    const quiltVer = parseIniValue(cfg, 'QuiltVersion')
    let loader: LauncherLoader | undefined
    let loaderVersion: string | undefined
    if (forgeVer) {
      loader = 'forge'
      loaderVersion = forgeVer
    } else if (fabricVer) {
      loader = 'fabric'
      loaderVersion = fabricVer
    } else if (quiltVer) {
      loader = 'quilt'
      loaderVersion = quiltVer
    }
    instances.push({
      id: makeId(info.kind, name),
      launcherId: info.id,
      name,
      gamePath: probe.join(instancesDir, name),
      mcVersion,
      loader,
      loaderVersion
    })
  }
  return instances
}

/** BakaXL 实例解析（目录结构与 Prism 相似，但 cfg 字段名略不同） */
async function parseBakaXLInstances(
  probe: PathProbe,
  info: LauncherInfo
): Promise<LauncherInstance[]> {
  const instancesDir = probe.join(info.dataDir, 'instances')
  if (!(await probe.exists(instancesDir))) return []
  const names = await probe.readDirNames(instancesDir)
  const instances: LauncherInstance[] = []
  for (const name of names) {
    const cfgPath = probe.join(instancesDir, name, 'instance.cfg')
    if (!(await probe.exists(cfgPath))) continue
    const cfg = await probe.readFileText(cfgPath)
    const mcVersion =
      parseIniValue(cfg, 'MinecraftVersion') ?? parseIniValue(cfg, 'MCVersion') ?? name
    instances.push({
      id: makeId(info.kind, name),
      launcherId: info.id,
      name,
      gamePath: probe.join(instancesDir, name),
      mcVersion
    })
  }
  return instances
}

const DETECTOR_RULES: DetectorRule[] = [
  // PCL2：绿色软件，常见路径探测
  {
    kind: 'pcl2',
    displayName: 'PCL2',
    candidates(probe) {
      const home = probe.home()
      return [
        {
          exePath: probe.join(home, 'Desktop', 'PlainCraftLauncher.exe'),
          dataDir: probe.join(home, 'Desktop')
        },
        {
          exePath: probe.join(home, 'Downloads', 'PlainCraftLauncher.exe'),
          dataDir: probe.join(home, 'Downloads')
        },
        { exePath: probe.join(home, 'PlainCraftLauncher.exe'), dataDir: home }
      ]
    },
    // PCL2 是绿色软件，实际安装位置随意：按文件名在常见根目录与磁盘里搜
    scan: {
      // PCL2 官方 exe 名为 Plain Craft Launcher 2.exe，社区常重命名为 PCL2.exe
      match: /^(plain ?craft ?launcher|pcl2?)([^\\/]*\.exe)$/i,
      dataDir: (dir) => dir,
      registry: /plain ?craft|pcl2/i
    },
    instances: parseMinecraftVersions
  },
  // HMCL：Java jar，数据目录默认 .minecraft
  {
    kind: 'hmcl',
    displayName: 'HMCL',
    candidates(probe) {
      const home = probe.home()
      return [
        { exePath: probe.join(home, 'hmcl.jar'), dataDir: probe.join(home, '.minecraft') },
        {
          exePath: probe.join(home, 'Downloads', 'hmcl.jar'),
          dataDir: probe.join(home, '.minecraft')
        }
      ]
    },
    // HMCL 同时提供带 JRE 的 exe 与纯 jar 发行版
    scan: {
      match: /^hmcl([^\\/]*\.(exe|jar))$/i,
      // HMCL 默认用同目录下的 .minecraft；若它自己就在 .minecraft 里则直接用该目录
      dataDir: (dir, probe) =>
        /(^|[\\/])\.minecraft$/i.test(dir) ? dir : probe.join(dir, '.minecraft'),
      registry: /^hmcl/i
    },
    instances: parseMinecraftVersions
  },
  // BakaXL：.NET 程序，实例目录 instances/
  {
    kind: 'bakaxl',
    displayName: 'BakaXL',
    candidates(probe) {
      const home = probe.home()
      return [
        { exePath: probe.join(home, 'BakaXL.exe'), dataDir: probe.join(home, '.BakaXL') },
        {
          exePath: probe.join(home, 'Downloads', 'BakaXL.exe'),
          dataDir: probe.join(home, '.BakaXL')
        }
      ]
    },
    scan: {
      match: /^bakaxl([^\\/]*\.exe)$/i,
      // BakaXL 配置/实例在其 exe 同目录的 .BakaXL 下
      dataDir: (dir, probe) => probe.join(dir, '.BakaXL'),
      registry: /bakaxl/i
    },
    instances: parseBakaXLInstances
  },
  // Prism Launcher：标准安装路径
  {
    kind: 'prism',
    displayName: 'Prism Launcher',
    candidates(probe) {
      // macOS：.app 为目录形态，exists 探测同样适用；
      // 数据目录在 ~/Library/Application Support/PrismLauncher
      if (process.platform === 'darwin') {
        const home = probe.home()
        return [
          {
            exePath: '/Applications/Prism Launcher.app',
            dataDir: probe.join(home, 'Library', 'Application Support', 'PrismLauncher')
          }
        ]
      }
      // Linux：发行版包 / Flatpak 两种常见形态；
      // Flatpak 数据目录隔离在 ~/.var/app/<id>/data 下
      if (process.platform === 'linux') {
        const home = probe.home()
        return [
          {
            exePath: '/usr/bin/prismlauncher',
            dataDir: probe.join(home, '.local', 'share', 'PrismLauncher')
          },
          {
            exePath: '/var/lib/flatpak/exports/bin/org.prismlauncher.PrismLauncher',
            dataDir: probe.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher')
          }
        ]
      }
      const localAppData = probe.localAppData()
      const appData = probe.appData()
      return [
        {
          exePath: probe.join(localAppData, 'PrismLauncher', 'prismlauncher.exe'),
          dataDir: probe.join(appData, 'PrismLauncher')
        },
        {
          exePath: probe.join(probe.programFiles(), 'Prism Launcher', 'prismlauncher.exe'),
          dataDir: probe.join(appData, 'PrismLauncher')
        }
      ]
    },
    scan: {
      match: /^(prismlauncher|prism launcher)([^\\/]*\.exe)$/i,
      // Prism 的实例数据固定在 %APPDATA%\PrismLauncher（便携模式除外）
      dataDir: (_dir, probe) => probe.join(probe.appData(), 'PrismLauncher'),
      registry: /prism ?launcher/i
    },
    instances: parsePrismInstances
  },
  // MultiMC：绿色解压，instances/ 在 exe 同目录
  {
    kind: 'multimc',
    displayName: 'MultiMC',
    candidates(probe) {
      const home = probe.home()
      return [
        {
          exePath: probe.join(home, 'MultiMC', 'MultiMC.exe'),
          dataDir: probe.join(home, 'MultiMC')
        },
        {
          exePath: probe.join(home, 'Downloads', 'MultiMC', 'MultiMC.exe'),
          dataDir: probe.join(home, 'Downloads', 'MultiMC')
        }
      ]
    },
    scan: {
      match: /^multimc([^\\/]*\.exe)$/i,
      // 绿色版：instances/ 在 exe 同目录
      dataDir: (dir) => dir,
      registry: /multimc/i
    },
    instances: parsePrismInstances
  },
  // 官方启动器
  {
    kind: 'official',
    displayName: 'Minecraft Launcher',
    candidates(probe) {
      // macOS：/Applications/Minecraft.app，数据在 ~/Library/Application Support/minecraft
      if (process.platform === 'darwin') {
        const home = probe.home()
        return [
          {
            exePath: '/Applications/Minecraft.app',
            dataDir: probe.join(home, 'Library', 'Application Support', 'minecraft')
          }
        ]
      }
      // Linux：官方 deb/rpm 装的 minecraft-launcher，数据在 ~/.minecraft
      if (process.platform === 'linux') {
        const home = probe.home()
        return [
          {
            exePath: '/usr/bin/minecraft-launcher',
            dataDir: probe.join(home, '.minecraft')
          }
        ]
      }
      return [
        {
          exePath: probe.join(probe.programFiles(), 'Minecraft Launcher', 'MinecraftLauncher.exe'),
          dataDir: probe.join(probe.appData(), '.minecraft')
        },
        {
          exePath: probe.join(probe.localAppData(), 'MinecraftLauncher', 'MinecraftLauncher.exe'),
          dataDir: probe.join(probe.appData(), '.minecraft')
        }
      ]
    },
    scan: {
      match: /^minecraft(launcher)?([^\\/]*\.exe)$/i,
      dataDir: (_dir, probe) => probe.join(probe.appData(), '.minecraft'),
      registry: /^minecraft launcher$/i
    },
    instances: parseMinecraftVersions
  }
]

// ─── 主机扫描（非标准安装位置） ───────────────────────────────────────────────

/** 单目录最多读取条目数（防止超长目录拖慢扫描） */
const MAX_DIR_ENTRIES = 300
/** 全机扫描最多收集的候选文件数 */
const MAX_SCANNED_FILES = 6000
/** 全机扫描最多访问的目录数（PCL2 等绿色版目录层级深，预算相应放宽） */
const MAX_DIRS = 900
/** 磁盘根下只下探这些名字的目录，避免扫 Windows/Users 等系统目录 */
const DRIVE_CHILD_WHITELIST =
  /^(games?|minecraft|mclauncher|mc-?launcher|launchers?|启动器|游戏|tools?|apps?|programs?|software)$/i

/**
 * 「疑似启动器目录」启发式：命中即对该子树放宽深度与白名单。
 * 绿色版启动器常自建目录（如 D:\pcl.mc\PCL\...），目录名不在通用白名单里。
 */
const CANDIDATE_DIR = /pcl|minecraft|mc-?launcher|launcher|启动器|启动|游戏|\bmc\b|hmcl|prism|bakaxl|multimc/i

/** 命中疑似启动器目录后的额外下探深度 */
const DEEP_DEPTH = 4

/** 「副本 / copy」类重名文件跳过，避免同一安装被重复计入 */
const COPY_NAME = /(^|[\s_\-（(])副本|copy/i

/** 视为「候选文件」的扩展名；其它带点的名字可能是目录（如 pcl.mc / .minecraft） */
const FILE_NAME = /\.(exe|jar|msi|lnk|bat|cmd)$/i

/** 目录读取缓存：一次检测内同一目录只读一次 */
function createDirMemo(probe: PathProbe): (dir: string) => Promise<string[]> {
  const cache = new Map<string, Promise<string[]>>()
  return (dir: string) => {
    const key = dir.toLowerCase()
    let pending = cache.get(key)
    if (!pending) {
      pending = probe.readDirNames(dir).catch(() => [] as string[])
      cache.set(key, pending)
    }
    return pending
  }
}

/** 取路径的父目录 */
function parentDir(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
  return idx > 0 ? filePath.slice(0, idx) : filePath
}

/** 取路径的目录名（用于同名启动器区分） */
function dirLabel(filePath: string): string {
  return parentDir(filePath).split(/[\\/]/).filter(Boolean).pop() ?? ''
}

/**
 * 扫描常见根目录收集「疑似启动器可执行文件」。
 * 覆盖：桌面/下载/文档/用户目录、Program Files、Program Files (x86)、
 * %LOCALAPPDATA%\Programs、Xbox 应用目录、各磁盘根。
 * 用户目录与磁盘根限制下探深度并按白名单过滤，避免全盘遍历。
 */
async function collectHostFiles(
  probe: PathProbe,
  memo: (dir: string) => Promise<string[]>
): Promise<Array<{ dir: string; name: string }>> {
  const home = probe.home()
  const roots: Array<{ path: string; depth: number; restrict: boolean }> = [
    { path: probe.join(home, 'Desktop'), depth: 2, restrict: false },
    { path: probe.join(home, 'Downloads'), depth: 2, restrict: false },
    { path: probe.join(home, 'Documents'), depth: 2, restrict: false },
    // Windows 已知文件夹可能被 OneDrive 重定向：真实桌面/文档在 OneDrive 下，
    // home\Desktop 可能是空目录（本机实测 PCL2 就放在 OneDrive\Desktop）
    { path: probe.join(home, 'OneDrive', 'Desktop'), depth: 2, restrict: false },
    { path: probe.join(home, 'OneDrive', '桌面'), depth: 2, restrict: false },
    { path: probe.join(home, 'OneDrive', 'Documents'), depth: 2, restrict: false },
    { path: probe.join(home, 'OneDrive', '文档'), depth: 2, restrict: false },
    { path: home, depth: 2, restrict: true },
    { path: probe.join(probe.localAppData(), 'Programs'), depth: 2, restrict: false },
    { path: probe.programFiles(), depth: 2, restrict: false },
    { path: `${probe.programFiles()} (x86)`, depth: 2, restrict: false },
    // Xbox / 微软商店版启动器默认装在这里
    { path: 'C:\\XboxGames', depth: 2, restrict: false }
  ]

  try {
    const drives = (await probe.listDrives?.()) ?? []
    for (const d of drives) roots.push({ path: d, depth: 2, restrict: true })
  } catch {
    // 枚举磁盘失败：只扫用户目录
  }

  const files: Array<{ dir: string; name: string }> = []
  const visited = new Set<string>()
  let dirsVisited = 0
  /** 拼接子路径：磁盘根以分隔符结尾时先去掉尾部，避免出现双分隔符 */
  const joinChild = (dir: string, name: string): string =>
    probe.join(dir.replace(/[\\/]+$/, '') || dir, name)

  const walk = async (dir: string, depth: number, restrict: boolean, deep = false): Promise<void> => {
    if (files.length >= MAX_SCANNED_FILES || dirsVisited >= MAX_DIRS) return
    const key = dir.toLowerCase()
    if (visited.has(key)) return
    visited.add(key)
    dirsVisited++
    const names = await memo(dir)
    let count = 0
    for (const name of names) {
      if (++count > MAX_DIR_ENTRIES) break
      if (!name || name.includes('\\') || name.includes('/')) continue
      if (name.includes('.') && FILE_NAME.test(name)) {
        if (!COPY_NAME.test(name)) files.push({ dir, name })
        continue
      }
      if (depth <= 1) continue
      // 命中「疑似启动器目录」后放宽白名单并加深下探（绿色版启动器自建目录）
      const isCandidate = CANDIDATE_DIR.test(name)
      if (restrict && !deep && !isCandidate && !DRIVE_CHILD_WHITELIST.test(name)) continue
      const nextDeep = deep || isCandidate
      const nextDepth = isCandidate ? Math.max(depth - 1, DEEP_DEPTH) : depth - 1
      await walk(joinChild(dir, name), nextDepth, true, nextDeep)
    }
  }

  for (const root of roots) {
    if (!(await probe.exists(root.path))) continue
    await walk(root.path, root.depth, root.restrict)
    if (files.length >= MAX_SCANNED_FILES || dirsVisited >= MAX_DIRS) break
  }
  return files
}

/**
 * 绿色版启动器的数据目录解析：
 * PCL2 / HMCL 等绿色版通常把 .minecraft 放在 exe 同级或祖先目录
 * （实测：exe 在 D:\pcl.mc\PCL\-shot 2.10.8\PCL\，数据在 D:\pcl.mc\.minecraft），
 * 扫描命中时向上最多找 3 层；找不到则沿用规则给出的目录。
 */
async function resolveScanDataDir(
  probe: PathProbe,
  fallback: string
): Promise<string> {
  const isDataDir = async (dir: string): Promise<boolean> =>
    (await probe.exists(probe.join(dir, 'versions'))) ||
    (await probe.exists(probe.join(dir, '.minecraft')))
  if (await isDataDir(fallback)) return fallback
  let dir = fallback
  for (let i = 0; i < 3; i++) {
    const up = parentDir(dir)
    if (!up || up === dir) break
    dir = up
    if (await probe.exists(probe.join(dir, '.minecraft'))) return probe.join(dir, '.minecraft')
    if (await probe.exists(probe.join(dir, 'versions'))) return dir
  }
  return fallback
}

/** 从注册表已安装程序清单里找该启动器的可执行文件 */
async function registryCandidates(probe: PathProbe, rule: DetectorRule): Promise<string[]> {
  const scanRule = rule.scan
  if (!scanRule?.registry || !probe.listInstalledPrograms) return []
  const paths: string[] = []
  try {
    const installed = await probe.listInstalledPrograms()
    for (const item of installed) {
      if (!scanRule.registry.test(item.name)) continue
      if (item.installLocation && (await probe.exists(item.installLocation))) {
        const names = await probe.readDirNames(item.installLocation)
        const hit = names.find((n) => scanRule.match.test(n))
        if (hit) paths.push(probe.join(item.installLocation, hit))
      }
      if (item.iconPath) {
        const iconName = item.iconPath.split(/[\\/]/).pop() ?? ''
        if (scanRule.match.test(iconName) && (await probe.exists(item.iconPath))) {
          paths.push(item.iconPath)
        }
      }
    }
  } catch {
    // 注册表不可用（非 Windows / 权限不足）时静默跳过
  }
  return paths
}

/** 同一类型的多个安装最多保留几个 */
const MAX_PER_KIND = 3

/**
 * 检测本机所有支持的启动器（纯函数，注入 PathProbe）。
 * 三级来源：固定候选路径 → 常见根目录扫描 → Windows 注册表安装信息。
 * 同一类型最多返回 MAX_PER_KIND 个安装，全部命中时名称附带目录名区分。
 */
export async function detectLaunchers(probe: PathProbe): Promise<DetectResult> {
  const launchers: LauncherInfo[] = []
  const errors: string[] = []
  const memo = createDirMemo(probe)
  let scanned: Array<{ dir: string; name: string }> = []
  try {
    scanned = await collectHostFiles(probe, memo)
  } catch (err) {
    errors.push(`主机扫描: ${err instanceof Error ? err.message : String(err)}`)
  }

  for (const rule of DETECTOR_RULES) {
    try {
      const found: Array<{ exePath: string; dataDir: string; fromScan: boolean }> = []
      const seen = new Set<string>()
      const push = (exePath: string, dataDir: string, fromScan = false): void => {
        if (!exePath) return
        const key = exePath.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        found.push({ exePath, dataDir, fromScan })
      }

      // ① 固定候选（优先级最高）
      for (const c of rule.candidates(probe)) {
        if (await probe.exists(c.exePath)) push(c.exePath, c.dataDir)
      }

      // ② 主机扫描命中
      if (rule.scan) {
        for (const f of scanned) {
          if (!rule.scan.match.test(f.name)) continue
          push(
            probe.join(f.dir.replace(/[\\/]+$/, '') || f.dir, f.name),
            rule.scan.dataDir(f.dir, probe),
            true
          )
        }
        // ③ 注册表安装信息
        for (const exe of await registryCandidates(probe, rule)) {
          push(exe, rule.scan.dataDir(parentDir(exe), probe), true)
        }
      }

      // 扫描/注册表命中的绿色版：数据目录可能不在 exe 同级，向上解析一次
      for (const c of found) {
        if (c.fromScan) c.dataDir = await resolveScanDataDir(probe, c.dataDir)
      }

      const picked = found.slice(0, MAX_PER_KIND)
      picked.forEach((c) => {
        launchers.push({
          id: makeId(rule.kind, c.exePath),
          kind: rule.kind,
          // 多个安装时附带目录名，避免列表里出现多个同名条目无法区分
          name:
            picked.length > 1
              ? `${rule.displayName}（${dirLabel(c.exePath)}）`
              : rule.displayName,
          exePath: c.exePath,
          dataDir: c.dataDir,
          autoDetected: true
        })
      })
    } catch (err) {
      errors.push(`${rule.displayName}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { launchers, errors }
}

/**
 * 解析指定启动器的实例列表（纯函数，注入 PathProbe）。
 */
export async function parseInstances(
  probe: PathProbe,
  info: LauncherInfo
): Promise<LauncherInstance[]> {
  const rule = DETECTOR_RULES.find((r) => r.kind === info.kind)
  if (!rule) return []
  return rule.instances(probe, info)
}
