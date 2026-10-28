import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LOADER_DEFAULT_MC } from '../../templates/loaderVersionMatrix'
import type { ModLoader } from '../../../shared/types/project'
import { assertWithinRoot, statEntry } from '../fsService'

const PACKAGE_BASE = 'com.kunyu'

export interface ModContext {
  /** 项目加载器（决定 Yarn/Fabric 与 Mojang/Forge|NeoForge 代码生成分支） */
  loader: ModLoader
  /** MC 版本（gradle.properties 的 minecraft_version，影响个别 API 命名） */
  mcVersion: string
  modId: string
  modClassName: string
  packageName: string
  /** gradle.properties 的 maven_group 原值（缺失时为空串） */
  mavenGroup: string
  /** true = 实际入口包 ≠ maven_group（混合项目的静默失效信号） */
  packageDiverged: boolean
  pkgPath: string
  javaDir: string
  registryDir: string
  resourcesDir: string
  assetsDir: string
  dataDir: string
}

/** 读取 UTF-8 JSON，容忍 BOM（部分 Windows 编辑器/外部项目会带 BOM） */
export function readJson(path: string): unknown {
  const raw = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')
  return JSON.parse(raw)
}

/** 从 mods.toml / neoforge.mods.toml 提取首个 [[mods]] 表的 modId（轻量正则） */
function readTomlModId(tomlPath: string): string {
  const text = readFileSync(tomlPath, 'utf-8').replace(/^\uFEFF/, '')
  const modsSection = text.split(/^\s*\[\[mods\]\]\s*$/m)[1] ?? text
  const m = /^\s*modId\s*=\s*"([^"]+)"/m.exec(modsSection)
  if (!m) throw new Error('mods.toml 中缺少 modId')
  return m[1]
}

/** 读取 gradle.properties 的 minecraft_version（缺失时返回空串） */
function readMcVersion(root: string): string {
  const propsPath = join(root, 'gradle.properties')
  if (!existsSync(propsPath)) return ''
  const m = /^minecraft_version\s*=\s*(.+)$/m.exec(readFileSync(propsPath, 'utf-8'))
  return m ? m[1].trim() : ''
}

/**
 * 读取加载器描述文件 + gradle.properties，解析模组上下文。
 * 支持 Fabric（fabric.mod.json）、Forge（META-INF/mods.toml）、
 * NeoForge（META-INF/neoforge.mods.toml；1.20.4 及更早同为 mods.toml，按 build.gradle 插件区分）。
 */
export function resolveModContext(root: string): ModContext {
  assertWithinRoot(root)
  const resourcesDir = join(root, 'src', 'main', 'resources')
  const fabricModPath = join(resourcesDir, 'fabric.mod.json')
  const neoForgeToml = join(resourcesDir, 'META-INF', 'neoforge.mods.toml')
  const forgeToml = join(resourcesDir, 'META-INF', 'mods.toml')

  let loader: ModLoader
  let modId = ''
  if (existsSync(fabricModPath)) {
    loader = 'fabric'
    try {
      const modJson = readJson(fabricModPath) as { id?: unknown }
      if (typeof modJson.id === 'string') modId = modJson.id
    } catch {
      throw new Error('fabric.mod.json 解析失败')
    }
  } else if (existsSync(neoForgeToml)) {
    loader = 'neoforge'
    modId = readTomlModId(neoForgeToml)
  } else if (existsSync(forgeToml)) {
    // NeoForge 1.20.4 的元数据同为 META-INF/mods.toml（≤1.20.4 旧 schema），
    // 按 build.gradle 插件区分 forge / neoforge，否则 1.20.4 NeoForge 项目会被误判
    const buildGradlePath = join(root, 'build.gradle')
    const buildGradle = existsSync(buildGradlePath)
      ? readFileSync(buildGradlePath, 'utf-8')
      : ''
    if (/net\.neoforged\.moddev/.test(buildGradle)) {
      loader = 'neoforge'
    } else {
      loader = 'forge'
    }
    modId = readTomlModId(forgeToml)
  } else {
    throw new Error(
      '未找到模组描述文件（src/main/resources/fabric.mod.json、META-INF/mods.toml 或 META-INF/neoforge.mods.toml），请确认这是一个模组项目'
    )
  }
  if (!modId) throw new Error('模组描述文件中缺少 mod id')

  // 包名解析：历史/导入项目里 maven_group 与源码树的实际入口包
  // 会分歧——旧逻辑优先 maven_group 会把注册类生成到无人引用的第二个包里，
  // 而 fabric.mod.json 的 entrypoint 仍指旧包 → 构建全绿但游戏里没有内容。
  // 新优先级：① Fabric 读 entrypoints.main 主类 FQN（包名+入口类名都取真值）；
  // ② 扫描源码树 *Mod.java 所在包（Forge/NeoForge @Mod 入口）；
  // ③ 源码树为空（新项目首次生成）才用 maven_group。
  let mavenGroup = ''
  const gradlePropsPath = join(root, 'gradle.properties')
  if (existsSync(gradlePropsPath)) {
    const props = readFileSync(gradlePropsPath, 'utf-8')
    const m = /^maven_group\s*=\s*(.+)$/m.exec(props)
    if (m) mavenGroup = m[1].trim()
  }
  const javaBase = join(root, 'src', 'main', 'java')
  const scanned = scanPackage(javaBase)

  let entryClass: string | null = null
  let packageName = ''
  if (loader === 'fabric') {
    try {
      const mj = readJson(fabricModPath) as { entrypoints?: { main?: unknown } }
      const mains = mj.entrypoints?.main
      const first = Array.isArray(mains) ? mains[0] : undefined
      const fqn =
        typeof first === 'string'
          ? first
          : first && typeof first === 'object'
            ? String((first as { value?: unknown }).value ?? '')
            : ''
      if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(fqn)) {
        packageName = fqn.slice(0, fqn.lastIndexOf('.'))
        entryClass = fqn.slice(fqn.lastIndexOf('.') + 1)
      }
    } catch {
      // entrypoint 解析失败回退扫描
    }
  }
  if (!packageName) packageName = scanned || mavenGroup || `${PACKAGE_BASE}.${modId}`
  const modClassName = entryClass ?? `${modId.charAt(0).toUpperCase()}${modId.slice(1)}Mod`
  const packageDiverged = Boolean(mavenGroup) && packageName !== mavenGroup

  const pkgPath = packageName.replace(/\./g, '/')
  const javaDir = join(root, 'src', 'main', 'java', pkgPath)

  return {
    loader,
    // 版本分派兜底：gradle.properties 未写 minecraft_version（旧项目）时按加载器矩阵默认版本，
    // 避免 compareMcVersions 对空串的不确定比较（fabric/forge→1.20.1、neoforge→1.21.1）
    mcVersion: readMcVersion(root) || LOADER_DEFAULT_MC[loader],
    modId,
    modClassName,
    packageName,
    mavenGroup,
    packageDiverged,
    pkgPath,
    javaDir,
    registryDir: join(javaDir, 'registry'),
    resourcesDir,
    assetsDir: join(resourcesDir, 'assets', modId),
    dataDir: join(resourcesDir, 'data')
  }
}

/**
 * 读取 ModBlocks.java 源码（反向同步用）。
 * 文件不存在时返回 null（尚未生成过 Java）。
 */
export function readModBlocksJava(root: string): string | null {
  const ctx = resolveModContext(root)
  const path = join(ctx.registryDir, 'ModBlocks.java')
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

/** 扫描 java 源码目录寻找最深包路径（含 *Mod.java 的目录） */
function scanPackage(javaBase: string): string | null {
  if (!existsSync(javaBase)) return null
  const walk = (dir: string, parts: string[]): string | null => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return null
    }
    if (entries.some((f) => f.endsWith('Mod.java'))) return parts.join('.')
    for (const entry of entries) {
      const child = join(dir, entry)
      try {
        if (statEntry(child)?.kind === 'directory') {
          const hit = walk(child, [...parts, entry])
          if (hit) return hit
        }
      } catch {
        /* 路径越界或不存在时忽略 */
      }
    }
    return null
  }
  return walk(javaBase, [])
}
