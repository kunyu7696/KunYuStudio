/**
 * kunyu-observer-agent 内置探针对外服务（游戏内 HTTP 观察端）。
 *
 * 形态说明：observer 已从 Fabric-only mod 改为 JVM javaagent，
 * 覆盖 Fabric / Forge / NeoForge 与 MC 全版本，不再是 mod。
 * jar 由启动链路（gradleService runClient / mcLaunchService 托管实例）以
 * -javaagent:<jar>=port=...,token=... 直接引用，无需复制进任何 mods 目录，
 * 「注入」语义随之消失：agent 可用即视为已就绪（injected=true）。
 *
 * 资源布局：
 * - dev：resources/observer-agent/dist/kunyu-observer-agent.jar（build-observer-agent.cjs 构建）
 * - 打包：process.resourcesPath/observer-agent/kunyu-observer-agent.jar（electron-builder extraResources）
 */
import { statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { findBuiltAgentJar } from './observerInstaller'

/** 与 resources/observer-agent/src/kunyu/observer/Agent.java 的 VERSION 对齐 */
export const OBSERVER_AGENT_VERSION = '2.1.0-agent'

export interface ObserverBuiltInInfo {
  /** 内置 agent 是否可用（dev 未构建 / 打包漏带时为 false） */
  available: boolean
  fileName: string | null
  version: string | null
  /** 内置 agent jar 绝对路径 */
  jarPath: string | null
  /** 字节数 */
  size: number | null
}

export interface ObserverInjectResult {
  ok: boolean
  /** agent jar 路径（javaagent 形态下无复制动作，仅回传解析结果） */
  sourcePath?: string
  targetPath?: string
  /** 历史字段（mods 时代遗留），javaagent 形态恒为 null */
  modsDir?: string | null
  /** 非阻断性提醒 */
  warning?: string
  error?: string
  reason?: string
}

/** 解析内置 agent jar 所在目录（dev / 打包一致的 dist 层级） */
export function observerAgentDir(resourcesPath: string, appPath: string, isPackaged: boolean): string {
  return isPackaged
    ? join(resourcesPath, 'observer-agent')
    : join(appPath, 'resources', 'observer-agent', 'dist')
}

/**
 * 供启动链路（gradleService / mcLaunchService）解析 agent jar 绝对路径。
 * 未构建/漏带时返回 null，调用方静默跳过挂载（observer 缺失不阻塞游戏启动）。
 */
export function resolveObserverAgentJar(
  resourcesPath: string,
  appPath: string,
  isPackaged: boolean
): string | null {
  return findBuiltAgentJar(observerAgentDir(resourcesPath, appPath, isPackaged))
}

export interface ObserverServiceDeps {
  resourcesPath: string
  appPath: string
  isPackaged: boolean
}

export function createObserverService(deps: ObserverServiceDeps): {
  builtInInfo: () => ObserverBuiltInInfo
  projectModsDir: (projectRoot: string) => string
  projectStatus: (projectRoot: string | null) => ObserverBuiltInInfo & { injected: boolean; modsDir: string | null }
  injectProject: (projectRoot: string | null) => ObserverInjectResult
  injectDir: (inputDir: string) => ObserverInjectResult
} {
  const jarDir = (): string => observerAgentDir(deps.resourcesPath, deps.appPath, deps.isPackaged)

  function builtInInfo(): ObserverBuiltInInfo {
    const jarPath = findBuiltAgentJar(jarDir())
    if (!jarPath) {
      return { available: false, fileName: null, version: null, jarPath: null, size: null }
    }
    return {
      available: true,
      fileName: basename(jarPath),
      version: OBSERVER_AGENT_VERSION,
      jarPath,
      size: statSync(jarPath).size
    }
  }

  /** 历史 API（mods 时代遗留）：javaagent 形态下没有项目 mods 目录概念，保留仅为兼容调用方 */
  function projectModsDir(projectRoot: string): string {
    return join(projectRoot, 'run', 'mods')
  }

  /**
   * javaagent 形态：agent 可用即就绪（启动游戏时由 JVM 参数自动挂载，无需注入）。
   * injected 恒等于 available，modsDir 恒为 null。
   */
  function projectStatus(
    _projectRoot: string | null
  ): ObserverBuiltInInfo & { injected: boolean; modsDir: string | null } {
    const info = builtInInfo()
    return { ...info, injected: info.available, modsDir: null }
  }

  /** javaagent 形态无注入动作；保留 IPC 形状，返回说明性 warning 供 UI 提示 */
  function injectProject(_projectRoot: string | null): ObserverInjectResult {
    const info = builtInInfo()
    if (!info.available) {
      return {
        ok: false,
        error:
          '未找到 kunyu-observer-agent 构建产物。请先执行 node scripts/build-observer-agent.cjs（纯 JDK 工具链，无需 Gradle）。'
      }
    }
    return {
      ok: true,
      sourcePath: info.jarPath ?? undefined,
      modsDir: null,
      warning: 'kunyu-observer 已改为 javaagent 形态：启动游戏（runClient / 托管实例）时自动挂载，覆盖 Fabric/Forge/NeoForge 全版本，无需手动注入。'
    }
  }

  /** 同 injectProject：javaagent 形态与具体 mods 目录无关 */
  function injectDir(_inputDir: string): ObserverInjectResult {
    return injectProject(null)
  }

  return { builtInInfo, projectModsDir, projectStatus, injectProject, injectDir }
}
