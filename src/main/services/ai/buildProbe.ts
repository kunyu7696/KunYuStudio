import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import {
  generateMinimalFabricProject,
  generateMinimalForgeProject,
  generateMinimalNeoForgeProject
} from '../projectService'
import { compareMcVersion, fabricTargetJdk, getToolchain, isBetaBlocked, supportedMcVersions, type FabricToolchain, type ForgeToolchain, type NeoForgeToolchain } from '../../templates/loaderVersionMatrix'
import type { FabricTemplateVars } from '../../templates/fabricTemplates'
import type { ForgeTemplateVars } from '../../templates/forgeTemplates'
import type { NeoForgeTemplateVars } from '../../templates/neoForgeTemplates'
import type { ModLoader } from '../../../shared/types/project'

/**
 * 真实编译回测：探针组合覆盖统一版本矩阵中全部 (loader, mcVersion)。
 * comboId 形如 'fabric-1.20.1' / 'forge-1.18.2' / 'neoforge-1.21.3'。
 */
export interface ActiveComboDef {
  loader: ModLoader
  mcVersion: string
}

/** 全部可探针矩阵组合（beta 组合如 NeoForge 26.3 排除：官方未 GA，不参与真实编译回测） */
export const ACTIVE_PROBE_COMBOS: Record<string, ActiveComboDef> = Object.fromEntries(
  (['fabric', 'forge', 'neoforge'] as ModLoader[]).flatMap((loader) =>
    supportedMcVersions(loader)
      .filter((mcVersion) => !isBetaBlocked(loader, mcVersion))
      .map((mcVersion) => [`${loader}-${mcVersion}`, { loader, mcVersion }])
  )
)

export function isActiveProbeCombo(comboId: string): boolean {
  return Object.prototype.hasOwnProperty.call(ACTIVE_PROBE_COMBOS, comboId)
}

/** 列举全部探针 comboId */
export function allProbeComboIds(): string[] {
  return Object.keys(ACTIVE_PROBE_COMBOS)
}

export type ProbeVars = FabricTemplateVars | ForgeTemplateVars | NeoForgeTemplateVars

export interface ProbeProjectInfo {
  dir: string
  /** 本次调用是否新建（false=复用既有探针工程） */
  created: boolean
  loader: ModLoader
  mcVersion: string
  /** 工程实际使用的版本变量（探针签名用） */
  vars: ProbeVars
}

/** 探针工程默认根目录：userData/ai/probes/{comboId} */
export function defaultProbeDir(comboId: string): string {
  return join(app.getPath('userData'), 'ai', 'probes', comboId)
}

interface ProbeLayout {
  mainClass: string
  descriptorRelPath: string
}

function probeLayout(loader: ModLoader, mcVersion = ''): ProbeLayout {
  const mainClass = join('src', 'main', 'java', 'com', 'kunyu', 'kyprobe', 'KyprobeMod.java')
  switch (loader) {
    case 'fabric':
      return { mainClass, descriptorRelPath: join('src', 'main', 'resources', 'fabric.mod.json') }
    case 'forge':
      return {
        mainClass,
        descriptorRelPath: join('src', 'main', 'resources', 'META-INF', 'mods.toml')
      }
    case 'neoforge':
      // 元数据按版本分派：≤1.20.4 为 Forge 式 mods.toml，≥1.20.5 才是 neoforge.mods.toml
      return {
        mainClass,
        descriptorRelPath: join(
          'src',
          'main',
          'resources',
          'META-INF',
          compareMcVersion(mcVersion, '1.20.5') >= 0 ? 'neoforge.mods.toml' : 'mods.toml'
        )
      }
  }
}

function isProbeProjectReady(dir: string, loader: ModLoader, mcVersion: string): boolean {
  const wrapper = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  const layout = probeLayout(loader, mcVersion)
  return (
    existsSync(join(dir, wrapper)) &&
    existsSync(join(dir, layout.mainClass)) &&
    existsSync(join(dir, layout.descriptorRelPath))
  )
}

/** 按 (loader, mcVersion) 从矩阵取探针签名变量 */
function currentVars(loader: ModLoader, mcVersion: string): ProbeVars {
  const tc = getToolchain(loader, mcVersion)
  const base = {
    modId: 'kyprobe',
    modName: 'KunYu Probe',
    version: '1.0.0',
    packageName: 'com.kunyu.kyprobe',
    mcVersion: tc.mcVersion
  }
  switch (loader) {
    case 'fabric': {
      const f = tc as FabricToolchain
      return {
        ...base,
        loaderVersion: f.loaderVersion,
        fabricVersion: f.fabricVersion,
        yarnVersion: f.yarnVersion,
        loomVersion: f.loomVersion,
        gradleVersion: f.gradleVersion,
        // Fabric 1.16.5 宿主 17 / 目标 8
        jdk: fabricTargetJdk(f)
      }
    }
    case 'forge': {
      const f = tc as ForgeToolchain
      return {
        ...base,
        forgeVersion: f.forgeVersion,
        loomLikeVersion: f.forgeGradleVersion,
        gradleVersion: f.gradleVersion,
        jdk: f.jdk,
        forgeConstructorStyle: f.forgeConstructorStyle
      }
    }
    case 'neoforge': {
      const f = tc as NeoForgeToolchain
      return {
        ...base,
        neoForgeVersion: f.neoForgeVersion,
        modDevGradleVersion: f.modDevGradleVersion,
        gradleVersion: f.gradleVersion,
        jdk: f.jdk
      }
    }
  }
}

/**
 * 确保探针工程存在：已存在则复用（保留 Gradle 缓存与增量状态），
 * 否则在指定目录生成对应加载器/MC 版本的「最小可编译」工程（无示例内容）。
 */
export function ensureProbeProject(comboId: string, dir: string = defaultProbeDir(comboId)): ProbeProjectInfo {
  const def = ACTIVE_PROBE_COMBOS[comboId]
  if (!def) throw new Error(`非 active 探针组合：${comboId}`)
  if (isProbeProjectReady(dir, def.loader, def.mcVersion)) {
    return { dir, created: false, loader: def.loader, mcVersion: def.mcVersion, vars: currentVars(def.loader, def.mcVersion) }
  }
  mkdirSync(dir, { recursive: true })
  let vars: ProbeVars
  switch (def.loader) {
    case 'fabric':
      vars = generateMinimalFabricProject(dir, def.mcVersion)
      break
    case 'forge':
      vars = generateMinimalForgeProject(dir, def.mcVersion)
      break
    case 'neoforge':
      vars = generateMinimalNeoForgeProject(dir, def.mcVersion)
      break
  }
  return { dir, created: true, loader: def.loader, mcVersion: def.mcVersion, vars }
}
