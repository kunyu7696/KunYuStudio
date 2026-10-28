/**
 * 零配置运行环境 3b：托管实例的真实启动接线。
 *
 * 依据 instance.json + 版本 JSON 拼装启动参数（assembleLaunchSpec），
 * 解包 natives 到 natives/<mcVersion>，解析本机 JDK 后 spawn java 启动游戏。
 *
 * 边界：安装包不捆绑 MC 本体/资产（Mojang EULA 禁止再分发），运行时全部来自
 * 首启向导联网下载到 userData/mcinstances 的产物。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, promises as fsp, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McInstance, McLaunchInput, McLaunchResult, McVersionDetail } from '../../shared/types/mcRuntime'
import type { JdkRequirements } from '../../shared/types/build'
import {
  assembleLaunchSpec,
  libraryArtifactDownload,
  libraryPath,
  nativeDownload,
  platformMcArch,
  platformOsName,
  type McLaunchSpec,
  type McRuleContext
} from './mcLaunchSpec'
import {
  managedMcInstancesRoot,
  mcAssetsDir,
  mcInstanceDir,
  mcInstanceMetaFile,
  mcLibrariesDir,
  mcNativesDir,
  mcVersionDir
} from './mcPaths'
import { extractZipToDir } from './archiveExtract'
import { detectJdk } from './jdkService'
import { getSection } from './settingsService'
import { generateObserverToken, setObserverToken } from './observer/observerToken'

/** natives 解包完成标记（避免同一实例重复解包全部 native jar） */
const NATIVES_MARKER = '.kunyu-natives-extracted'

/** 拼装结果：启动参数 + 定位信息（供启动与 UI 展示） */
export interface McBuiltSpec {
  spec: McLaunchSpec
  mcVersion: string
  /** 游戏目录（${game_directory}，即实例根） */
  gameDir: string
  /** 版本 JSON 声明的 Java 主版本（无声明回退 8） */
  javaMajor: number
  /** natives 解包目录 */
  nativesDir: string
}

/** 启动接线依赖（可注入，便于离线单测） */
export interface McLaunchDeps {
  /** spawn java（返回 pid）；缺省用 node:child_process */
  spawnProcess?(exe: string, args: string[], opts: { cwd: string }): number | null
  /** 解析可用 JDK（返回 java 可执行文件路径）；缺省用 detectJdk */
  resolveJava?(requirements: JdkRequirements): Promise<string | null>
  /**
   * 解析 kunyu-observer-agent jar 绝对路径（javaagent 形态，覆盖全加载器全版本）；
   * 返回 null 表示不挂载观察端（agent 未构建时不阻塞启动）。缺省不挂载。
   */
  resolveObserverAgent?(): string | null
}

/** 读实例元数据；缺失/损坏返回 null */
async function readMeta(root: string, id: string): Promise<McInstance | null> {
  try {
    const parsed = JSON.parse(await fsp.readFile(mcInstanceMetaFile(root, id), 'utf-8')) as McInstance
    return parsed && typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 拼装托管实例的启动参数。
 * 读取版本 JSON → 枚举依赖库（普通制品进 classpath，natives 解包到 natives 目录）→
 * 交给 assembleLaunchSpec 生成 JVM/游戏参数。任一步缺失抛人类可读中文错误。
 */
export async function buildManagedLaunchSpec(
  root: string,
  instanceId: string,
  opts?: { width?: number; height?: number; memoryMb?: number }
): Promise<McBuiltSpec> {
  const meta = await readMeta(root, instanceId)
  if (!meta) throw new Error(`实例不存在或元数据缺失：${instanceId}`)
  const mcVersion = meta.mcVersion
  const versionDir = mcVersionDir(root, instanceId, mcVersion)
  const versionJson = join(versionDir, `${mcVersion}.json`)
  if (!existsSync(versionJson)) {
    throw new Error(`实例尚未置备（缺少版本 JSON），请先在运行环境向导中准备 ${mcVersion}`)
  }
  let detail: McVersionDetail
  try {
    detail = JSON.parse(readFileSync(versionJson, 'utf-8')) as McVersionDetail
  } catch (err) {
    throw new Error(`版本 JSON 解析失败：${(err as Error).message}`)
  }
  const clientJar = join(versionDir, `${mcVersion}.jar`)
  if (!existsSync(clientJar)) throw new Error(`实例缺少客户端 jar，请重新置备 ${mcVersion}`)

  const librariesDir = mcLibrariesDir(root, instanceId)
  const nativesDir = mcNativesDir(root, instanceId, mcVersion)
  const assetsDir = mcAssetsDir(root, instanceId)
  mkdirSync(nativesDir, { recursive: true })

  const ctx: McRuleContext = { os: platformOsName(), arch: platformMcArch(), features: {} }
  const libraryRelPaths: string[] = []
  const nativeJars: string[] = []
  for (const lib of detail.libraries ?? []) {
    const art = libraryArtifactDownload(lib, ctx)
    if (art) {
      const rel = libraryPath(art, lib)
      if (rel) libraryRelPaths.push(rel)
    }
    const nat = nativeDownload(lib, ctx)
    if (nat) {
      const rel = libraryPath(nat.download, lib)
      if (rel) nativeJars.push(join(librariesDir, rel))
    }
  }

  // natives 解包（幂等）：全部 native jar 依次解开到 natives 目录，完成后落标记
  if (!existsSync(join(nativesDir, NATIVES_MARKER))) {
    for (const jar of nativeJars) {
      if (!existsSync(jar)) continue
      extractZipToDir(readFileSync(jar), nativesDir)
    }
    // readdirSync 仅为确认目录可读后再写标记；失败不阻断（下次启动重试）
    try {
      readdirSync(nativesDir)
      writeFileSync(join(nativesDir, NATIVES_MARKER), new Date().toISOString(), 'utf-8')
    } catch {
      /* 忽略标记写入失败 */
    }
  }

  const memoryMb = opts?.memoryMb ?? getSection('java').gradleMemoryMb
  const vars: Record<string, string> = {}
  if (opts?.width) vars['resolution_width'] = String(opts.width)
  if (opts?.height) vars['resolution_height'] = String(opts.height)

  const spec = assembleLaunchSpec({
    detail,
    gameDir: mcInstanceDir(root, instanceId),
    clientJar,
    librariesDir,
    libraryRelPaths,
    nativesDir,
    assetsDir,
    extraJvmArgs: memoryMb > 0 ? [`-Xmx${memoryMb}M`] : undefined,
    vars
  })

  return {
    spec,
    mcVersion,
    gameDir: mcInstanceDir(root, instanceId),
    javaMajor: detail.javaVersion?.majorVersion ?? 8,
    nativesDir
  }
}

const defaultDeps: Required<McLaunchDeps> = {
  spawnProcess(exe, args, opts) {
    const child = spawn(exe, args, { cwd: opts.cwd, detached: true, stdio: 'ignore', windowsHide: false })
    child.unref()
    return child.pid ?? null
  },
  async resolveJava(requirements) {
    const { jdk } = await detectJdk(null, requirements)
    return jdk?.javaPath ?? null
  },
  resolveObserverAgent() {
    return null
  }
}

/**
 * 启动托管实例。
 * 失败统一返回人类可读中文（IPC handler 直接转发），不抛异常。
 */
export async function launchManagedInstance(
  input: McLaunchInput,
  deps?: McLaunchDeps
): Promise<McLaunchResult> {
  const id = (input.instanceId ?? '').trim()
  if (!id) return { ok: false, errorMessage: '缺少实例 id' }
  if (/[\\/]|\.\./.test(id)) return { ok: false, errorMessage: '实例 id 非法' }
  const root = managedMcInstancesRoot(input.instancesRoot)
  const d = { ...defaultDeps, ...deps }

  let built: McBuiltSpec
  try {
    built = await buildManagedLaunchSpec(root, id, {
      width: input.width,
      height: input.height,
      memoryMb: input.memoryMb
    })
  } catch (err) {
    return { ok: false, errorMessage: (err as Error).message }
  }

  // JDK：按版本 JSON 声明的 Java 主版本挑选，兼容区间取 [javaMajor, ∞)
  const requirements: JdkRequirements = {
    requiredMajor: built.javaMajor,
    preferredMajor: built.javaMajor,
    maxMajor: 999
  }
  let javaPath: string | null
  try {
    javaPath = await d.resolveJava(requirements)
  } catch (err) {
    return { ok: false, errorMessage: `解析 JDK 失败：${(err as Error).message}` }
  }
  if (!javaPath) {
    return {
      ok: false,
      errorMessage: `未找到可运行的 JDK ${built.javaMajor}，请先在运行环境向导中「一键准备运行环境」`
    }
  }

  try {
    // kunyu-observer-agent：可用则以 -javaagent 挂载（端口 9876 起自顺延，token 随机轮换）
    const jvmArgs = [...built.spec.jvmArgs]
    const agentJar = d.resolveObserverAgent()
    if (agentJar) {
      const token = generateObserverToken()
      setObserverToken(built.gameDir, token)
      jvmArgs.unshift(`-javaagent:${agentJar}=port=9876,token=${token}`)
    }
    const pid = d.spawnProcess(javaPath, [...jvmArgs, built.spec.mainClass, ...built.spec.gameArgs], {
      cwd: built.gameDir
    })
    return { ok: true, pid, mcVersion: built.mcVersion, mainClass: built.spec.mainClass }
  } catch (err) {
    return { ok: false, errorMessage: `启动游戏失败：${(err as Error).message}` }
  }
}
