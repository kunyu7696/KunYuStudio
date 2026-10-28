/**
 * JDK 检测与兼容性匹配。
 * 优先级：项目配置 → 全局设置 → JAVA_HOME → 常见安装目录扫描 → PATH。
 * 版本要求按项目 (loader, mcVersion) 从版本矩阵推导；无上下文回退 1.20.1 时代默认（JDK 17，Gradle 8.10.2 宿主上限 23）。
 */
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { JdkDetectResult, JdkInfo, JdkRequirements } from '../../shared/types/build'
import { LEGACY_JDK_REQUIREMENTS, jdkSourceLabel, judgeJdkCompatibility } from '../../shared/types/build'
import { getSection } from './settingsService'
import { managedJdkRoot } from './jdkPaths'

const execFileAsync = promisify(execFile)

function javaBin(home: string): string {
  return join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
}

/** 解析 `java -version` 输出中的版本号为主版本号（1.8 → 8，17.0.1 → 17） */
export function parseJavaMajor(versionText: string): { version: string; major: number } | null {
  const match = versionText.match(/version "([^"]+)"/)
  if (!match) return null
  const version = match[1]
  const parts = version.split(/[._-]/)
  const first = Number.parseInt(parts[0] ?? '', 10)
  if (Number.isNaN(first)) return null
  // 旧版本号 1.8.0_xxx → 主版本 8
  const major = first === 1 ? Number.parseInt(parts[1] ?? '', 10) : first
  if (Number.isNaN(major)) return null
  return { version, major }
}

/** 探测指定 JAVA_HOME 风格目录，无效则返回 null */
export async function probeHome(
  home: string,
  source: JdkInfo['source']
): Promise<JdkInfo | null> {
  const javaPath = javaBin(home)
  if (!existsSync(javaPath)) return null
  try {
    const { stderr } = await execFileAsync(javaPath, ['-version'], { timeout: 8000 })
    const parsed = parseJavaMajor(stderr)
    if (!parsed) return null
    return { home, javaPath, version: parsed.version, major: parsed.major, source }
  } catch {
    return null
  }
}

/** 常见 JDK 安装目录（跨平台） */
function scanDirs(): string[] {
  if (process.platform === 'win32') {
    const homes = [
      process.env['ProgramFiles'] ?? 'C:\\Program Files',
      process.env['LOCALAPPDATA'] ?? ''
    ].filter(Boolean)
    const groups = [
      join(homes[0]!, 'Java'),
      join(homes[0]!, 'Eclipse Adoptium'),
      join(homes[0]!, 'Microsoft'),
      join(homes[0]!, 'Zulu'),
      join(homes[0]!, 'Amazon Corretto'),
      join(homes[0]!, 'BellSoft'),
      homes[1] ? join(homes[1], 'Programs', 'Eclipse Adoptium') : ''
    ].filter((p) => p && existsSync(p))
    const result: string[] = []
    for (const dir of groups) {
      try {
        result.push(...readdirSync(dir).map((name) => join(dir, name)))
      } catch {
        /* 忽略不可读目录 */
      }
    }
    return result
  }
  if (process.platform === 'darwin') {
    const base = '/Library/Java/JavaVirtualMachines'
    if (!existsSync(base)) return []
    try {
      return readdirSync(base).map((name) => join(base, name, 'Contents', 'Home'))
    } catch {
      return []
    }
  }
  const base = '/usr/lib/jvm'
  if (!existsSync(base)) return []
  try {
    return readdirSync(base).map((name) => join(base, name))
  } catch {
    return []
  }
}

/** 归一化路径用于去重（Windows 大小写不敏感） */
function dedupeKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/**
 * 检测可用 JDK 并选出与当前项目兼容的一个。
 * @param configuredPath 项目/设置中配置的 JDK 路径（home 或 java 可执行文件）
 * @param requirements 当前项目的 JDK 版本要求（按加载器/MC 版本推导；缺省为 1.20.1 时代默认）
 */
export async function detectJdk(
  configuredPath?: string | null,
  requirements: JdkRequirements = LEGACY_JDK_REQUIREMENTS
): Promise<JdkDetectResult> {
  const candidates: JdkInfo[] = []
  const seen = new Set<string>()

  const add = async (home: string, source: JdkInfo['source']): Promise<void> => {
    const info = await probeHome(home, source)
    if (!info) return
    const key = dedupeKey(info.home)
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(info)
  }

  const notes: string[] = []

  const normalizeHome = (p: string): string =>
    p.endsWith('java.exe') || p.endsWith('java') ? join(p, '..', '..') : p

  // 1) 项目配置（可能填的是 bin/java.exe，也可能是 home）
  if (configuredPath) {
    await add(normalizeHome(configuredPath), 'configured')
  }

  // 1.5) 全局设置 JDK：无效路径不致命，降级继续扫描
  const globalJdkHome = getSection('java').globalJdkHome
  if (globalJdkHome) {
    const before = candidates.length
    await add(normalizeHome(globalJdkHome), 'global')
    if (candidates.length === before) {
      notes.push(`全局设置中的 JDK 路径无效，已跳过：${globalJdkHome}`)
    }
  }

  // 2) JAVA_HOME
  if (process.env['JAVA_HOME']) await add(process.env['JAVA_HOME'], 'java-home')

  // 2.5) 应用内下载的托管 JDK（零配置运行环境 3a）：userData/jdks/<vendor>-<major>
  const mRoot = managedJdkRoot(getSection('java').managedJdkDir)
  if (existsSync(mRoot)) {
    try {
      for (const name of readdirSync(mRoot)) await add(join(mRoot, name), 'managed')
    } catch {
      /* 忽略不可读目录 */
    }
  }

  // 3) 常见安装目录
  for (const dir of scanDirs()) await add(dir, 'scanned')

  // 4) PATH 上的 java（Oracle javapath 垫片等），反查真实位置
  try {
    const { stderr } = await execFileAsync('java', ['-version'], { timeout: 8000 })
    const parsed = parseJavaMajor(stderr)
    if (parsed) {
      let javaRealPath = ''
      if (process.platform === 'win32') {
        javaRealPath = await execFileAsync('where', ['java'], { timeout: 5000 })
          .then((r) => r.stdout.trim().split(/\r?\n/)[0] ?? '')
          .catch(() => '')
      } else {
        javaRealPath = await execFileAsync('sh', ['-c', 'command -v java'])
          .then((r) => r.stdout.trim())
          .catch(() => '')
      }
      const home = javaRealPath ? join(javaRealPath, '..', '..') : ''
      const key = dedupeKey(home)
      if (home && !seen.has(key)) {
        seen.add(key)
        // Oracle javapath 等垫片目录下没有 bin/java.exe，javaPath 保留真实解析到的可执行文件
        const realHome = existsSync(javaBin(home)) ? home : ''
        candidates.push({
          home: realHome || javaRealPath,
          javaPath: javaRealPath,
          version: parsed.version,
          major: parsed.major,
          source: 'path'
        })
      }
    }
  } catch {
    /* PATH 无 java */
  }

  // 选择策略：项目配置 > 全局设置 > 精确 preferred > required..max 中最低的稳定版
  const isCompatible = (c: JdkInfo): boolean => {
    const judged = judgeJdkCompatibility(c.major, requirements)
    return judged === 'recommended' || judged === 'compatible'
  }
  const compatibleList = candidates.filter(isCompatible)
  const byPriority = (source: JdkInfo['source']): JdkInfo | undefined =>
    compatibleList.find((c) => c.source === source)
  let chosen: JdkInfo | null =
    byPriority('configured') ??
    byPriority('global') ??
    compatibleList.find((c) => c.major === requirements.preferredMajor) ??
    [...compatibleList].sort((a, b) => a.major - b.major)[0] ??
    null

  let message: string
  if (chosen) {
    const base =
      chosen.major === requirements.requiredMajor
        ? `已选用 JDK ${chosen.version}（${jdkSourceLabel(chosen.source)}，${chosen.home}）`
        : `已选用 JDK ${chosen.version}（推荐使用 JDK ${requirements.requiredMajor}；${jdkSourceLabel(chosen.source)}，${chosen.home}）`
    message = notes.length > 0 ? `${base}；${notes.join('；')}` : base
  } else if (candidates.length === 0) {
    message = `未检测到 JDK。当前工具链需要 JDK ${requirements.requiredMajor}，请安装后在设置中配置。`
  } else {
    const vers = candidates.map((c) => `JDK ${c.version}`).join('、')
    message = `检测到 ${vers}，均不满足要求。当前工具链需要 JDK ${requirements.requiredMajor}~${requirements.maxMajor}（推荐 ${requirements.preferredMajor}）。`
    if (notes.length > 0) message += ` ${notes.join('；')}`
  }

  return {
    jdk: chosen,
    requirements,
    requiredMajor: requirements.requiredMajor,
    compatible: chosen !== null,
    message,
    candidates,
    javaHomeEnv: process.env['JAVA_HOME'] ?? ''
  }
}
