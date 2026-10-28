import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registerProjectRoot, unregisterProjectRoot } from './fsService'
import { stopWatching } from './fileWatcher'
import {
  FABRIC_DEFAULTS,
  blockModelJson,
  blockStateJson,
  buildGradle,
  fabricModJson,
  gradleProperties,
  gradleWrapperProperties,
  gradlewBat,
  gradlewSh,
  itemModelJson,
  langEnUs,
  mainClass,
  modBlocksClass,
  modItemsClass,
  settingsGradle,
  type FabricTemplateVars
} from '../templates/fabricTemplates'
import {
  FORGE_DEFAULTS,
  forgeBuildGradle,
  forgeClientClass,
  forgeGradleProperties,
  forgeMainClass,
  forgeModBlocksClass,
  forgeModItemsClass,
  forgeModsToml,
  forgePackMcmeta,
  forgeSettingsGradle,
  type ForgeTemplateVars
} from '../templates/forgeTemplates'
import {
  NEOFORGE_DEFAULTS,
  neoForgeBuildGradle,
  neoForgeClientClass,
  neoForgeGradleProperties,
  neoForgeMainClass,
  neoForgeMetadataRelPath,
  neoForgeModBlocksClass,
  neoForgeModItemsClass,
  neoForgeModsToml,
  neoForgeSettingsGradle,
  type NeoForgeTemplateVars
} from '../templates/neoForgeTemplates'
import { FORGE_README_TXT, gitattributesFor, gitignoreFor, readmeMd } from '../templates/commonTemplates'
import {
  fabricTargetJdk,
  getToolchain,
  isMojangEra,
  isSupportedCombo,
  type FabricToolchain,
  type ForgeConstructorStyle,
  type ForgeToolchain,
  type NeoForgeToolchain
} from '../templates/loaderVersionMatrix'
import { createSolidPng } from '../templates/pngGenerator'
import { GRADLE_WRAPPER_JAR_BASE64 } from '../templates/gradleWrapperJar'
import {
  deleteProjectRecord,
  getProjectById,
  getProjectByPath,
  insertProject,
  listProjects,
  updateProject
} from './projectDAL'
import { getSection } from './settingsService'
import { migrateObserverAgentVmArg, repairLegacyS05LoomBlock } from './gradleService'
import { initDataPack } from './datapackService'
import { initShaderPack } from './shaderpackService'
import { initResourcePack } from './resourcepackService'
import { buildIndexToml, ensurePackToml } from './modpack/packTomlIo'
import { mcVersionFromPackFormat as rpMcVersionFromPackFormat } from '../../shared/schemas/resourcepack.schema'
import { mcVersionFromPackFormat as dpMcVersionFromPackFormat } from '../../shared/schemas/datapack.schema'
import { nearestPackMcVersion, type PackType } from '../../shared/schemas/packVersions'
import { createDefaultCiConfig } from '../../shared/types/ci'
import { exportCiWorkflows, setCiConfig } from './ci/ciExportService'
import type {
  CreateProjectInput,
  ModLoader,
  PackMcVersion,
  Project,
  ProjectType
} from '../../shared/types/project'

const PACKAGE_BASE = 'com.kunyu'

export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

/** 从模组 ID 派生包名，例如 "my_mod" -> "com.kunyu.my_mod" */
export function derivePackageName(modId: string): string {
  return `${PACKAGE_BASE}.${modId.replace(/[^a-z0-9_]/g, '_')}`
}

/** 模组 ID 合法性校验：小写字母、数字、下划线，必须字母开头 */
export function validateModId(modId: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(modId)
}

/** 从名称生成合法的模组 ID */
export function deriveModId(name: string): string {
  let id = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  // 首字符必须是字母
  if (!/^[a-z]/.test(id)) {
    id = 'mod_' + id
  }
  // 全中文 fallback
  if (id === '' || id === 'mod_') {
    id = 'mymod'
  }
  return id.slice(0, 64)
}

export function createProject(input: CreateProjectInput): Project {
  const name = input.name.trim()
  if (!name) throw new ProjectError('项目名称不能为空')

  if (existsSync(input.path)) {
    throw new ProjectError(`项目路径已存在: ${input.path}`)
  }

  const modId = input.type === 'mod'
    ? (input.modId ?? deriveModId(name))
    : null

  if (input.type === 'mod' && modId && !validateModId(modId)) {
    throw new ProjectError(`模组 ID 不合法: ${modId}（仅小写字母、数字、下划线，字母开头）`)
  }

  // 整合包核心元数据：MC 版本 + 加载器 + 加载器版本（写入双平台清单）
  if (input.type === 'modpack') {
    if (!input.mcVersion) throw new ProjectError('请选择 Minecraft 版本')
    if (!input.loaderVersion) throw new ProjectError('请选择加载器版本')
    // P2：组合校验此前只在 mod 分支，整合包选到未登记组合会静默生成空壳
    const modpackLoader: ModLoader = input.loader ?? 'fabric'
    if (!isSupportedCombo(modpackLoader, input.mcVersion)) {
      throw new ProjectError(`不支持的加载器/版本组合：${modpackLoader} ${input.mcVersion}`)
    }
  }

  // 创建项目目录
  try {
    mkdirSync(input.path, { recursive: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES') {
      throw new ProjectError(
        `没有写入权限，无法创建目录：${input.path}\n` +
          '可能原因：① 目标目录被 Windows「受控文件夹访问」或杀毒软件保护（常见于 Downloads/桌面/文档）；② 应用正以受限沙箱运行。\n' +
          '建议：更换到普通目录（如 D:\\ 盘或用户目录下自建文件夹）后重试；或将本应用加入杀软/受控文件夹访问的白名单。'
      )
    }
    throw err
  }
  // 骨架生成期间各 service 的写盘操作受路径守卫约束，先登记新项目根
  registerProjectRoot(input.path)

  try {
    if (input.type === 'mod') {
      const loader: ModLoader = input.loader ?? 'fabric'
      // M23：按所选 MC 版本从统一版本矩阵取完整工具链，不再各加载器硬编码默认值
      const mcVersion = input.mcVersion ?? (loader === 'fabric' ? FABRIC_DEFAULTS.mcVersion : loader === 'forge' ? FORGE_DEFAULTS.mcVersion : NEOFORGE_DEFAULTS.mcVersion)
      if (!isSupportedCombo(loader, mcVersion)) {
        throw new ProjectError(`不支持的加载器/版本组合：${loader} ${mcVersion}`)
      }
      const toolchain = getToolchain(loader, mcVersion)
      const packageName = input.namespace ? `${PACKAGE_BASE}.${input.namespace}` : derivePackageName(modId!)
      if (loader === 'forge') {
        const tc = toolchain as ForgeToolchain
        generateForgeProject(input.path, {
          modId: modId!,
          modName: name,
          version: '1.0.0',
          packageName,
          mcVersion: tc.mcVersion,
          forgeVersion: tc.forgeVersion,
          loomLikeVersion: tc.forgeGradleVersion,
          gradleVersion: tc.gradleVersion,
          jdk: tc.jdk,
          forgeConstructorStyle: tc.forgeConstructorStyle
        })
      } else if (loader === 'neoforge') {
        const tc = toolchain as NeoForgeToolchain
        generateNeoForgeProject(input.path, {
          modId: modId!,
          modName: name,
          version: '1.0.0',
          packageName,
          mcVersion: tc.mcVersion,
          neoForgeVersion: tc.neoForgeVersion,
          modDevGradleVersion: tc.modDevGradleVersion,
          gradleVersion: tc.gradleVersion,
          jdk: tc.jdk
        })
      } else {
        const tc = toolchain as FabricToolchain
        generateFabricProject(input.path, {
          modId: modId!,
          modName: name,
          version: '1.0.0',
          packageName,
          mcVersion: tc.mcVersion,
          // 向导中选择的加载器版本优先；否则取矩阵中该 MC 版本对应的 loader
          loaderVersion: input.loaderVersion || tc.loaderVersion,
          fabricVersion: tc.fabricVersion,
          yarnVersion: tc.yarnVersion,
          loomVersion: tc.loomVersion,
          // wrapper 版本跟随矩阵（1.21.4+ 需 8.12+，固定 8.10.2 会致 loom requires at least Gradle 8.12）
          gradleVersion: tc.gradleVersion,
          jdk: fabricTargetJdk(tc)
        })
      }
    } else {
      // 非模组类型：调用对应编辑器 service 生成真实包骨架（standalone 布局）
      generateNonModProject(input.path, input.type, {
        name,
        mcVersion: input.mcVersion ?? '1.20.1',
        namespace: input.namespace ?? deriveModId(name),
        shaderLoader: input.shaderLoader ?? 'iris',
        loader: input.loader ?? 'fabric',
        loaderVersion: input.loaderVersion ?? '',
        description: input.description ?? ''
      })
    }
  } catch (err) {
    // 生成失败则清理已创建的目录，避免残留
    rmSync(input.path, { recursive: true, force: true })
    unregisterProjectRoot(input.path)
    throw new ProjectError(`项目骨架生成失败: ${(err as Error).message}`)
  }

  const isPackType =
    input.type === 'resourcepack' || input.type === 'datapack' || input.type === 'shaderpack'
  // 模组与整合包都依赖「MC 版本 + 加载器 + 加载器版本」
  const isLoaderType = input.type === 'mod' || input.type === 'modpack'

  return insertProject({
    ...input,
    loaderVersion: isLoaderType ? input.loaderVersion ?? null : undefined,
    modId: modId ?? undefined,
    namespace: input.type === 'mod' ? modId ?? undefined : isPackType ? input.namespace ?? deriveModId(name) : undefined,
    mcVersion:
      input.type === 'mod'
        ? input.mcVersion ??
          (input.loader === 'forge'
            ? FORGE_DEFAULTS.mcVersion
            : input.loader === 'neoforge'
              ? NEOFORGE_DEFAULTS.mcVersion
              : FABRIC_DEFAULTS.mcVersion)
        : input.type === 'modpack'
          ? input.mcVersion
          : isPackType
            ? input.mcVersion ?? '1.20.1'
            : '',
    loader: isLoaderType ? input.loader ?? 'fabric' : undefined
  })
}

/** 写三加载器共用的根级公共文件（.gitignore/.gitattributes/README.md） */
function writeCommonRootFiles(dir: string, loader: ModLoader, v: { modName: string; mcVersion: string }): void {
  writeFileSync(join(dir, '.gitignore'), gitignoreFor(loader))
  writeFileSync(join(dir, '.gitattributes'), gitattributesFor(loader))
  writeFileSync(join(dir, 'README.md'), readmeMd({ modName: v.modName, loader, mcVersion: v.mcVersion }))
  if (loader === 'forge') writeFileSync(join(dir, 'forge_README.txt'), FORGE_README_TXT)
}

function generateFabricProject(dir: string, v: FabricTemplateVars): void {
  if (!GRADLE_WRAPPER_JAR_BASE64) {
    throw new ProjectError('gradle-wrapper.jar 尚未初始化，请先运行 Gradle wrapper 生成脚本')
  }

  // Gradle 构建文件（镜像源来自设置，影响 wrapper 下载地址与仓库列表）
  const mirror = getSection('network').mirror
  writeFileSync(join(dir, 'build.gradle'), buildGradle(v, mirror))
  writeCommonRootFiles(dir, 'fabric', v)
  writeFileSync(join(dir, 'gradle.properties'), gradleProperties(v))
  writeFileSync(join(dir, 'settings.gradle'), settingsGradle(mirror))

  // Gradle Wrapper
  const wrapperDir = join(dir, 'gradle', 'wrapper')
  mkdirSync(wrapperDir, { recursive: true })
  writeFileSync(join(wrapperDir, 'gradle-wrapper.properties'), gradleWrapperProperties(v.gradleVersion, mirror))
  writeFileSync(join(wrapperDir, 'gradle-wrapper.jar'), Buffer.from(GRADLE_WRAPPER_JAR_BASE64, 'base64'))
  writeFileSync(join(dir, 'gradlew'), gradlewSh, { mode: 0o755 })
  writeFileSync(join(dir, 'gradlew.bat'), gradlewBat)

  // 源码
  const packagePath = v.packageName.replace(/\./g, '/')
  const javaDir = join(dir, 'src', 'main', 'java', packagePath)
  mkdirSync(javaDir, { recursive: true })
  const modClassName = `${v.modId.charAt(0).toUpperCase()}${v.modId.slice(1)}Mod`
  writeFileSync(join(javaDir, `${modClassName}.java`), mainClass(v))

  const registryDir = join(javaDir, 'registry')
  mkdirSync(registryDir)
  writeFileSync(join(registryDir, 'ModBlocks.java'), modBlocksClass(v))
  writeFileSync(join(registryDir, 'ModItems.java'), modItemsClass(v))

  // 资源
  const assetsDir = join(dir, 'src', 'main', 'resources', 'assets', v.modId)
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(dir, 'src', 'main', 'resources', 'fabric.mod.json'), fabricModJson(v))
  mkdirSync(join(assetsDir, 'blockstates'))
  writeFileSync(join(assetsDir, 'blockstates', 'example_block.json'), blockStateJson(v))
  mkdirSync(join(assetsDir, 'models', 'block'), { recursive: true })
  writeFileSync(join(assetsDir, 'models', 'block', 'example_block.json'), blockModelJson(v))
  mkdirSync(join(assetsDir, 'models', 'item'), { recursive: true })
  writeFileSync(join(assetsDir, 'models', 'item', 'example_block.json'), itemModelJson(v))
  mkdirSync(join(assetsDir, 'lang'))
  writeFileSync(join(assetsDir, 'lang', 'en_us.json'), langEnUs(v))

  // 贴图：生成一张青绿色 16x16 PNG（草方块风格）
  mkdirSync(join(assetsDir, 'textures', 'block'), { recursive: true })
  writeFileSync(join(assetsDir, 'textures', 'block', 'example_block.png'), createSolidPng(96, 176, 112))

  // LICENSE（MIT 占位）
  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) KunYu Studio\n')

  // 特性⑤ CI/CD 集成：生成默认配置 + 工作流（build + gametest，release 默认关闭）
  // 由 exportCiWorkflows 统一管理 .github/workflows/ 和 .kunyu/ci/ 下文件
  const ciConfig = createDefaultCiConfig('fabric')
  setCiConfig(dir, ciConfig)
  exportCiWorkflows(dir, ciConfig, {
    modId: v.modId,
    modName: v.modName,
    version: v.version,
    packageName: v.packageName,
    mcVersion: v.mcVersion
  })
}

/** 写 Gradle Wrapper（三加载器共用） */
function writeGradleWrapper(dir: string, gradleVersion: string, mirror: 'china' | 'official'): void {
  if (!GRADLE_WRAPPER_JAR_BASE64) {
    throw new ProjectError('gradle-wrapper.jar 尚未初始化，请先运行 Gradle wrapper 生成脚本')
  }
  const wrapperDir = join(dir, 'gradle', 'wrapper')
  mkdirSync(wrapperDir, { recursive: true })
  writeFileSync(join(wrapperDir, 'gradle-wrapper.properties'), gradleWrapperProperties(gradleVersion, mirror))
  writeFileSync(join(wrapperDir, 'gradle-wrapper.jar'), Buffer.from(GRADLE_WRAPPER_JAR_BASE64, 'base64'))
  writeFileSync(join(dir, 'gradlew'), gradlewSh, { mode: 0o755 })
  writeFileSync(join(dir, 'gradlew.bat'), gradlewBat)
}

/** 写示例资源（blockstate/model/lang/贴图，三加载器 JSON 同构） */
function writeExampleAssets(dir: string, v: { modId: string }): void {
  const assetsDir = join(dir, 'src', 'main', 'resources', 'assets', v.modId)
  mkdirSync(assetsDir, { recursive: true })
  mkdirSync(join(assetsDir, 'blockstates'))
  writeFileSync(join(assetsDir, 'blockstates', 'example_block.json'), blockStateJson(v as FabricTemplateVars))
  mkdirSync(join(assetsDir, 'models', 'block'), { recursive: true })
  writeFileSync(join(assetsDir, 'models', 'block', 'example_block.json'), blockModelJson(v as FabricTemplateVars))
  mkdirSync(join(assetsDir, 'models', 'item'), { recursive: true })
  writeFileSync(join(assetsDir, 'models', 'item', 'example_block.json'), itemModelJson(v as FabricTemplateVars))
  mkdirSync(join(assetsDir, 'lang'))
  writeFileSync(join(assetsDir, 'lang', 'en_us.json'), langEnUs(v as FabricTemplateVars))
  mkdirSync(join(assetsDir, 'textures', 'block'), { recursive: true })
  writeFileSync(join(assetsDir, 'textures', 'block', 'example_block.png'), createSolidPng(96, 176, 112))
}

function modClassNameOf(modId: string): string {
  return `${modId.charAt(0).toUpperCase()}${modId.slice(1)}Mod`
}

/**
 * 探针最小主类（Forge 1.20.1）：不引用任何 registry 类（最小工程不含 ModBlocks/ModItems），
 * 构造器写法对齐 Forge 47.x 官方 MDK（无参 + FMLJavaModLoadingContext.get()，
 * 构造器注入 FMLJavaModLoadingContext 是 49.x/1.20.4+ 特性，47.x 不支持；
 * 26.x/Forge 66.x 为 ModBusGroup 构造风格）。
 */
function forgeProbeMainClass(style: ForgeConstructorStyle = 'classic'): string {
  if (style === 'modbusgroup') {
    return `package com.kunyu.kyprobe;

import com.mojang.logging.LogUtils;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.slf4j.Logger;

@Mod(KyprobeMod.MOD_ID)
public class KyprobeMod {
    public static final String MOD_ID = "kyprobe";
    public static final Logger LOGGER = LogUtils.getLogger();

    public KyprobeMod(FMLJavaModLoadingContext context) {
        var modBusGroup = context.getModBusGroup();
        FMLCommonSetupEvent.getBus(modBusGroup).addListener(this::commonSetup);
    }

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("KunYu version probe initialized");
    }
}
`
  }
  const injected = style === 'injected'
  const ctor = injected
    ? `    public KyprobeMod(IEventBus modEventBus) {
        modEventBus.addListener(this::commonSetup);
        MinecraftForge.EVENT_BUS.register(this);
    }`
    : `    public KyprobeMod() {
        IEventBus modEventBus = FMLJavaModLoadingContext.get().getModEventBus();
        modEventBus.addListener(this::commonSetup);
        MinecraftForge.EVENT_BUS.register(this);
    }`
  const fmlImport = injected ? '' : 'import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;\n'
  return `package com.kunyu.kyprobe;

import com.mojang.logging.LogUtils;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
${fmlImport}import org.slf4j.Logger;

@Mod(KyprobeMod.MOD_ID)
public class KyprobeMod {
    public static final String MOD_ID = "kyprobe";
    public static final Logger LOGGER = LogUtils.getLogger();

${ctor}

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("KunYu version probe initialized");
    }
}
`
}

/** 探针最小主类（NeoForge 1.21.1）：不引用 registry 类，构造器注入 IEventBus（NeoForge 20.2+ 官方写法） */
function neoForgeProbeMainClass(): string {
  return `package com.kunyu.kyprobe;

import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import org.slf4j.Logger;

@Mod(KyprobeMod.MOD_ID)
public class KyprobeMod {
    public static final String MOD_ID = "kyprobe";
    public static final Logger LOGGER = LogUtils.getLogger();

    public KyprobeMod(IEventBus modEventBus) {
        modEventBus.addListener(this::commonSetup);
    }

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("KunYu version probe initialized");
    }
}
`
}

/** 生成「最小可编译」Forge 工程（版本漂移编译探针专用）。
 *  按 mcVersion 从版本矩阵取正确 Forge/ForgeGradle/Gradle/构造器风格。 */
export function generateMinimalForgeProject(dir: string, mcVersion = FORGE_DEFAULTS.mcVersion): ForgeTemplateVars {
  const tc = getToolchain('forge', mcVersion) as ForgeToolchain
  const v: ForgeTemplateVars = {
    modId: 'kyprobe',
    modName: 'KunYu Probe',
    version: '1.0.0',
    packageName: 'com.kunyu.kyprobe',
    mcVersion: tc.mcVersion,
    forgeVersion: tc.forgeVersion,
    loomLikeVersion: tc.forgeGradleVersion,
    gradleVersion: tc.gradleVersion,
    jdk: tc.jdk,
    forgeConstructorStyle: tc.forgeConstructorStyle
  }
  const mirror = getSection('network').mirror
  writeFileSync(join(dir, 'build.gradle'), forgeBuildGradle(v, mirror))
  writeCommonRootFiles(dir, 'forge', v)
  writeFileSync(join(dir, 'gradle.properties'), forgeGradleProperties(v))
  writeFileSync(join(dir, 'settings.gradle'), forgeSettingsGradle(mirror, v.gradleVersion))
  writeGradleWrapper(dir, v.gradleVersion, mirror)

  const javaDir = join(dir, 'src', 'main', 'java', 'com', 'kunyu', 'kyprobe')
  mkdirSync(javaDir, { recursive: true })
  writeFileSync(join(javaDir, 'KyprobeMod.java'), forgeProbeMainClass(v.forgeConstructorStyle))
  mkdirSync(join(dir, 'src', 'main', 'resources', 'META-INF'), { recursive: true })
  // 探针工程用固定版本号替换 ${file.jarVersion}，避免 TOML 插值依赖 jar manifest
  writeFileSync(
    join(dir, 'src', 'main', 'resources', 'META-INF', 'mods.toml'),
    forgeModsToml(v).replace('${file.jarVersion}', v.version)
  )
  // 26.x：资源包必须含 pack.mcmeta（min/max_format 121，官方 forge-26.3 MDK）
  if (isMojangEra(v.mcVersion)) {
    writeFileSync(join(dir, 'src', 'main', 'resources', 'pack.mcmeta'), forgePackMcmeta(v))
  }
  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) KunYu Studio\n')
  return v
}

/** 生成「最小可编译」NeoForge 工程（版本漂移编译探针专用）。
 *  按 mcVersion 从版本矩阵取正确 NeoForge/ModDevGradle/Gradle。 */
export function generateMinimalNeoForgeProject(dir: string, mcVersion = NEOFORGE_DEFAULTS.mcVersion): NeoForgeTemplateVars {
  const tc = getToolchain('neoforge', mcVersion) as NeoForgeToolchain
  const v: NeoForgeTemplateVars = {
    modId: 'kyprobe',
    modName: 'KunYu Probe',
    version: '1.0.0',
    packageName: 'com.kunyu.kyprobe',
    mcVersion: tc.mcVersion,
    neoForgeVersion: tc.neoForgeVersion,
    modDevGradleVersion: tc.modDevGradleVersion,
    gradleVersion: tc.gradleVersion,
    jdk: tc.jdk
  }
  const mirror = getSection('network').mirror
  writeFileSync(join(dir, 'build.gradle'), neoForgeBuildGradle(v, mirror))
  writeCommonRootFiles(dir, 'neoforge', v)
  writeFileSync(join(dir, 'gradle.properties'), neoForgeGradleProperties(v))
  writeFileSync(join(dir, 'settings.gradle'), neoForgeSettingsGradle(mirror))
  writeGradleWrapper(dir, v.gradleVersion, mirror)

  const javaDir = join(dir, 'src', 'main', 'java', 'com', 'kunyu', 'kyprobe')
  mkdirSync(javaDir, { recursive: true })
  writeFileSync(join(javaDir, 'KyprobeMod.java'), neoForgeProbeMainClass())
  mkdirSync(join(dir, 'src', 'main', 'resources', 'META-INF'), { recursive: true })
  writeFileSync(
    join(dir, 'src', 'main', 'resources', neoForgeMetadataRelPath(v.mcVersion)),
    neoForgeModsToml(v).replace('${file.jarVersion}', v.version)
  )
  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) KunYu Studio\n')
  return v
}

function generateForgeProject(dir: string, v: ForgeTemplateVars): void {
  const mirror = getSection('network').mirror
  writeFileSync(join(dir, 'build.gradle'), forgeBuildGradle(v, mirror))
  writeCommonRootFiles(dir, 'forge', v)
  writeFileSync(join(dir, 'gradle.properties'), forgeGradleProperties(v))
  writeFileSync(join(dir, 'settings.gradle'), forgeSettingsGradle(mirror, v.gradleVersion))
  writeGradleWrapper(dir, v.gradleVersion, mirror)

  // 源码
  const packagePath = v.packageName.replace(/\./g, '/')
  const javaDir = join(dir, 'src', 'main', 'java', packagePath)
  mkdirSync(javaDir, { recursive: true })
  writeFileSync(join(javaDir, `${modClassNameOf(v.modId)}.java`), forgeMainClass(v))
  writeFileSync(join(javaDir, `${modClassNameOf(v.modId)}Client.java`), forgeClientClass(v))

  const registryDir = join(javaDir, 'registry')
  mkdirSync(registryDir)
  writeFileSync(join(registryDir, 'ModBlocks.java'), forgeModBlocksClass(v))
  writeFileSync(join(registryDir, 'ModItems.java'), forgeModItemsClass(v))

  // 资源
  const resourcesDir = join(dir, 'src', 'main', 'resources')
  mkdirSync(join(resourcesDir, 'META-INF'), { recursive: true })
  writeFileSync(join(resourcesDir, 'META-INF', 'mods.toml'), forgeModsToml(v).replace('${file.jarVersion}', v.version))
  // 26.x：资源包必须含 pack.mcmeta（min/max_format 121，官方 forge-26.3 MDK）
  if (isMojangEra(v.mcVersion)) {
    writeFileSync(join(resourcesDir, 'pack.mcmeta'), forgePackMcmeta(v))
  }
  writeExampleAssets(dir, v)

  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) KunYu Studio\n')

  // 特性⑤ CI/CD 集成
  const ciConfig = createDefaultCiConfig('forge')
  setCiConfig(dir, ciConfig)
  exportCiWorkflows(dir, ciConfig, {
    modId: v.modId,
    modName: v.modName,
    version: v.version,
    packageName: v.packageName,
    mcVersion: v.mcVersion
  })
}

function generateNeoForgeProject(dir: string, v: NeoForgeTemplateVars): void {
  const mirror = getSection('network').mirror
  writeFileSync(join(dir, 'build.gradle'), neoForgeBuildGradle(v, mirror))
  writeCommonRootFiles(dir, 'neoforge', v)
  writeFileSync(join(dir, 'gradle.properties'), neoForgeGradleProperties(v))
  writeFileSync(join(dir, 'settings.gradle'), neoForgeSettingsGradle(mirror))
  writeGradleWrapper(dir, v.gradleVersion, mirror)

  // 源码
  const packagePath = v.packageName.replace(/\./g, '/')
  const javaDir = join(dir, 'src', 'main', 'java', packagePath)
  mkdirSync(javaDir, { recursive: true })
  writeFileSync(join(javaDir, `${modClassNameOf(v.modId)}.java`), neoForgeMainClass(v))
  writeFileSync(join(javaDir, `${modClassNameOf(v.modId)}Client.java`), neoForgeClientClass(v))

  const registryDir = join(javaDir, 'registry')
  mkdirSync(registryDir)
  writeFileSync(join(registryDir, 'ModBlocks.java'), neoForgeModBlocksClass(v))
  writeFileSync(join(registryDir, 'ModItems.java'), neoForgeModItemsClass(v))

  // 资源
  const resourcesDir = join(dir, 'src', 'main', 'resources')
  mkdirSync(join(resourcesDir, 'META-INF'), { recursive: true })
  // 元数据文件名按 mcVersion 分派：≤1.20.4 为 mods.toml（旧 schema），≥1.20.5 为 neoforge.mods.toml
  writeFileSync(
    join(resourcesDir, neoForgeMetadataRelPath(v.mcVersion)),
    neoForgeModsToml(v).replace('${file.jarVersion}', v.version)
  )
  writeExampleAssets(dir, v)

  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) KunYu Studio\n')

  // 特性⑤ CI/CD 集成
  const ciConfig = createDefaultCiConfig('neoforge')
  setCiConfig(dir, ciConfig)
  exportCiWorkflows(dir, ciConfig, {
    modId: v.modId,
    modName: v.modName,
    version: v.version,
    packageName: v.packageName,
    mcVersion: v.mcVersion
  })
}

/**
 * 生成「最小可编译」Fabric 工程（版本漂移编译探针专用）：
 * 仅 Gradle 构建文件 + wrapper + 单一主类 + fabric.mod.json，不含任何示例内容。
 * 按 mcVersion 从版本矩阵取正确 loader/yarn/fabric-api/loom/gradle。
 * 返回实际使用的模板变量（探针签名用）。
 */
export function generateMinimalFabricProject(dir: string, mcVersion = FABRIC_DEFAULTS.mcVersion): FabricTemplateVars {
  if (!GRADLE_WRAPPER_JAR_BASE64) {
    throw new ProjectError('gradle-wrapper.jar 尚未初始化，请先运行 Gradle wrapper 生成脚本')
  }
  const tc = getToolchain('fabric', mcVersion) as FabricToolchain
  const v: FabricTemplateVars = {
    modId: 'kyprobe',
    modName: 'KunYu Probe',
    version: '1.0.0',
    packageName: 'com.kunyu.kyprobe',
    mcVersion: tc.mcVersion,
    loaderVersion: tc.loaderVersion,
    fabricVersion: tc.fabricVersion,
    yarnVersion: tc.yarnVersion,
    loomVersion: tc.loomVersion,
    gradleVersion: tc.gradleVersion,
    jdk: fabricTargetJdk(tc)
  }

  const mirror = getSection('network').mirror
  writeFileSync(join(dir, 'build.gradle'), buildGradle(v, mirror))
  writeCommonRootFiles(dir, 'fabric', v)
  writeFileSync(join(dir, 'gradle.properties'), gradleProperties(v))
  writeFileSync(join(dir, 'settings.gradle'), settingsGradle(mirror))

  const wrapperDir = join(dir, 'gradle', 'wrapper')
  mkdirSync(wrapperDir, { recursive: true })
  writeFileSync(join(wrapperDir, 'gradle-wrapper.properties'), gradleWrapperProperties(v.gradleVersion, mirror))
  writeFileSync(join(wrapperDir, 'gradle-wrapper.jar'), Buffer.from(GRADLE_WRAPPER_JAR_BASE64, 'base64'))
  writeFileSync(join(dir, 'gradlew'), gradlewSh, { mode: 0o755 })
  writeFileSync(join(dir, 'gradlew.bat'), gradlewBat)

  const javaDir = join(dir, 'src', 'main', 'java', 'com', 'kunyu', 'kyprobe')
  mkdirSync(javaDir, { recursive: true })
  // MC 1.18 起类路径才有 slf4j；1.16.x 用 log4j 2.x（M23 探针实测 slf4j 在 1.16.5 编译失败）
  const legacyLog = tc.mcVersion.startsWith('1.16')
  writeFileSync(
    join(javaDir, 'KyprobeMod.java'),
    `package com.kunyu.kyprobe;

import net.fabricmc.api.ModInitializer;
${legacyLog
  ? `import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;`
  : `import org.slf4j.Logger;
import org.slf4j.LoggerFactory;`}

public class KyprobeMod implements ModInitializer {
    public static final String MOD_ID = "kyprobe";
    public static final Logger LOGGER = ${legacyLog ? 'LogManager' : 'LoggerFactory'}.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        LOGGER.info("KunYu build probe initialized");
    }
}
`
  )
  mkdirSync(join(dir, 'src', 'main', 'resources'), { recursive: true })
  writeFileSync(join(dir, 'src', 'main', 'resources', 'fabric.mod.json'), fabricModJson(v))

  writeFileSync(join(dir, 'LICENSE'), 'MIT License\n\nCopyright (c) KunYu Studio\n')
  return v
}

/**
 * 非模组项目骨架：调用对应编辑器 service 的 standalone init，
 * 直接生成标准包结构（pack.mcmeta / data / assets / shaders + .kunyu 元数据）。
 * 整合包（modpack）暂无专用编辑器，仅写占位文件。
 */
/**
 * 包类项目（资源包/数据包/光影包）MC 版本校验（P0-4）：
 * 按项目类型用对应包类真实格式表白名单（packVersions 单一真源），
 * 非法值向下取最近合法版本。此前用模组矩阵全集判合法但兜底 1.20.1，
 * 向导可选的 1.21.6+ 会原样透传到 init 才报错，且已建目录被整体清理。
 */
function packMcVersion(type: PackType, raw: string): PackMcVersion {
  return nearestPackMcVersion(type, raw) as PackMcVersion
}

function generateNonModProject(
  dir: string,
  type: ProjectType,
  opts: {
    name: string
    mcVersion: string
    namespace: string
    shaderLoader: 'iris' | 'optifine'
    loader: ModLoader
    loaderVersion: string
    description: string
  }
): void {
  if (type === 'resourcepack') {
    initResourcePack(
      dir,
      {
        name: opts.name,
        mcVersion: packMcVersion('resourcepack', opts.mcVersion),
        description: opts.description,
        namespace: opts.namespace
      },
      'standalone'
    )
    return
  }
  if (type === 'datapack') {
    initDataPack(
      dir,
      { namespace: opts.namespace, description: opts.description, mcVersion: packMcVersion('datapack', opts.mcVersion) },
      'standalone'
    )
    return
  }
  if (type === 'shaderpack') {
    initShaderPack(
      dir,
      {
        name: opts.name,
        loader: opts.shaderLoader,
        mcVersion: packMcVersion('shaderpack', opts.mcVersion),
        version: '1.0.0',
        description: opts.description
      },
      'standalone'
    )
    return
  }
  // 整合包：双平台清单骨架 + overrides/ 配置目录
  generateModpackSkeleton(dir, opts)
}

/**
 * 整合包骨架：
 * - CurseForge manifest.json（minecraft.version + modLoaders + files 空数组）
 * - Modrinth modrinth.index.json（dependencies + files 空数组）
 * - overrides/ 用于放配置文件（config/、options.txt 等）
 * 注意：按 Mojang EULA，绝不在整合包内携带 Minecraft 游戏本体 jar，
 * 游戏由启动器依据清单版本自行下载。
 */
function generateModpackSkeleton(
  dir: string,
  opts: { name: string; mcVersion: string; loader: ModLoader; loaderVersion: string; description: string }
): void {
  // CurseForge 加载器 id：fabric-<ver> / forge-<ver> / neoforge-<ver>
  const curseLoaderId = `${opts.loader}-${opts.loaderVersion}`
  const curseManifest = {
    minecraft: {
      version: opts.mcVersion,
      modLoaders: [{ id: curseLoaderId, primary: true }]
    },
    manifestType: 'minecraftModpack',
    manifestVersion: 1,
    name: opts.name,
    version: '1.0.0',
    author: '',
    files: [],
    overrides: 'overrides'
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(curseManifest, null, 2))

  // Modrinth 依赖键名：fabric-loader / forge / neoforge
  const loaderDepKey = opts.loader === 'fabric' ? 'fabric-loader' : opts.loader
  const modrinthIndex = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: opts.name,
    summary: opts.description,
    files: [],
    dependencies: {
      minecraft: opts.mcVersion,
      [loaderDepKey]: opts.loaderVersion
    }
  }
  writeFileSync(join(dir, 'modrinth.index.json'), JSON.stringify(modrinthIndex, null, 2))

  // overrides/：玩家配置覆盖目录（不含游戏本体）
  const overridesDir = join(dir, 'overrides')
  mkdirSync(overridesDir, { recursive: true })
  writeFileSync(
    join(overridesDir, '.gitkeep'),
    '将配置文件放入此目录（如 config/、options.txt），启动器安装时覆盖到游戏目录。\n'
  )

  // run/mods/：本地组装暂存目录——界面提示「把 jar 放入 run/mods」，
  // 之前项目骨架没有创建该目录，新手会去找一个不存在的路径（真机反馈 P2-8）。
  mkdirSync(join(dir, 'run', 'mods'), { recursive: true })

  // content-packs/：内容模块目录（每个子目录一个自包含内容包，含各自 pack.json 清单）
  const packsDir = join(dir, 'content-packs')
  mkdirSync(packsDir, { recursive: true })
  writeFileSync(
    join(packsDir, 'README.md'),
    [
      '# content-packs（内容模块目录）',
      '',
      '每个子目录是一个自包含内容包，可跨项目复制复用：',
      '',
      '- `pack.json`：模块清单（id 必须与目录名一致；enabled 控制是否参与组装）',
      '- `overrides/`：组装时合并进包的 overrides/',
      '- `mods/`：组装时随包到 overrides/mods/ 的 jar',
      '- pack.json 的 mods 数组可声明 CurseForge/Modrinth 平台引用，导出时合并进双清单',
      ''
    ].join('\n'),
    'utf-8'
  )

  // pack.toml 中间表示（Git 友好，可手编；导出时自动转换双清单）+ 空 index.toml 快照
  ensurePackToml(dir, {
    name: opts.name,
    mcVersion: opts.mcVersion,
    loader: opts.loader,
    loaderVersion: opts.loaderVersion
  })
  writeFileSync(join(dir, 'index.toml'), buildIndexToml([]), 'utf-8')

  const readme = [
    `# ${opts.name}（整合包）`,
    '',
    '- `manifest.json`：CurseForge 清单（MC 版本、加载器、模组下载坐标）',
    '- `modrinth.index.json`：Modrinth 清单',
    '- `pack.toml`：元数据中间表示（Git 友好，可手编；组装时自动转换为双清单）',
    '- `overrides/`：配置覆盖目录',
    '- `content-packs/`：内容模块目录（科技包/冒险包/任务包等，见其 README）',
    '',
    '合规说明：本整合包不包含 Minecraft 游戏本体。依据 Mojang EULA，',
    '游戏文件由启动器在安装时按清单声明的版本自行下载，禁止再分发客户端 jar。',
    ''
  ].join('\n')
  writeFileSync(join(dir, 'README.md'), readme)
}

export function getAllProjects(): Project[] {
  // 实时标注目录有效性：列表项置灰/「路径失效」角标的数据源
  return listProjects().map((p) => ({ ...p, pathExists: existsSync(p.path) }))
}

/**
 * 重新定位：项目目录被移动/改名后，把记录指向新路径。
 * 新路径必须是已存在的目录，且未被其他项目占用。
 */
export function relocateProject(id: string, newPath: string): Project {
  const project = getProjectById(id)
  if (!project) throw new ProjectError('项目记录不存在')
  if (!existsSync(newPath) || !statSync(newPath).isDirectory()) {
    throw new ProjectError(`新路径不存在或不是目录: ${newPath}`)
  }
  const occupied = getProjectByPath(newPath)
  if (occupied && occupied.id !== id) {
    throw new ProjectError(`该目录已绑定项目「${occupied.name}」`)
  }
  const updated = updateProject(id, { path: newPath })
  if (!updated) throw new ProjectError('项目记录不存在')
  return updated
}

export function openProject(id: string): Project | undefined {
  const project = getProjectById(id)
  if (!project) return undefined
  // 校验路径是否仍存在
  if (!existsSync(project.path)) {
    throw new ProjectError(`项目路径不存在: ${project.path}`)
  }
  // 存量修复：坏模板（6441c49）生成的 build.gradle 缺一个闭合括号，幂等且
  // 失败不阻塞打开（详见 gradleService.repairLegacyS05LoomBlock）
  if (project.type === 'mod') {
    try {
      repairLegacyS05LoomBlock(project.path)
    } catch {
      /* 修复失败不影响打开 */
    }
    // 存量迁移：observer 改 javaagent 形态后，旧 -Dkunyu.observer.token vmArg 行
    // 幂等替换为 -javaagent 条件块（详见 gradleService.migrateObserverAgentVmArg）
    try {
      migrateObserverAgentVmArg(project.path)
    } catch {
      /* 迁移失败不影响打开 */
    }
  }
  return updateProject(id, { lastOpenedAt: Date.now() })
}

export function deleteProject(id: string, deleteFiles: boolean): boolean {
  const project = getProjectById(id)
  if (!project) return false
  if (deleteFiles && existsSync(project.path)) {
    // Windows 上文件监听/杀软瞬时句柄极易 ENOTEMPTY——
    // 先停 watcher 释放句柄，rmSync 加 maxRetries（默认 maxRetries:0 一碰就失败）。
    stopWatching()
    try {
      rmSync(project.path, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 })
    } catch (err) {
      throw new ProjectError(
        `删除文件失败（可能被占用）：${project.path}。请关闭占用该目录的程序后重试，` +
          `或选择"仅删除记录"。原因：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  return deleteProjectRecord(id)
}

/**
 * 导入已有项目：扫描目录判断类型，写入数据库。
 * 模组项目：检测 build.gradle + fabric.mod.json
 * 其他类型：检测 pack.mcmeta
 */
export function importProject(path: string): Project {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new ProjectError(`路径不存在或不是目录: ${path}`)
  }

  // 防止重复导入
  const existing = getProjectByPath(path)
  if (existing) return existing

  const files = readdirSync(path)
  let type: ProjectType = 'mod'
  let loader = null as Project['loader']
  let mcVersion = ''
  let modId = null as string | null

  const hasBuildGradle = files.includes('build.gradle') || files.includes('build.gradle.kts')
  const resDir = join(path, 'src', 'main', 'resources')
  const hasFabricMod = files.includes('fabric.mod.json') || existsSync(join(resDir, 'fabric.mod.json'))
  const hasForgeMod = files.includes('mods.toml') || existsSync(join(resDir, 'META-INF', 'mods.toml'))
  const hasNeoForgeMod = files.includes('neoforge.mods.toml') ||
    existsSync(join(resDir, 'META-INF', 'neoforge.mods.toml'))

  if (hasBuildGradle && hasFabricMod) {
    type = 'mod'
    loader = 'fabric'
    // 尝试从 fabric.mod.json 读取 modId
    const modJsonPath = existsSync(join(path, 'fabric.mod.json'))
      ? join(path, 'fabric.mod.json')
      : join(path, 'src', 'main', 'resources', 'fabric.mod.json')
    try {
      const modJson = JSON.parse(readFileText(modJsonPath))
      modId = modJson.id ?? null
    } catch {
      modId = null
    }
  } else if (hasBuildGradle && hasNeoForgeMod) {
    // NeoForge：META-INF/neoforge.mods.toml（TOML 属性表 { modId = "x" }）
    type = 'mod'
    loader = 'neoforge'
    modId = readTomlModId(
      files.includes('neoforge.mods.toml')
        ? join(path, 'neoforge.mods.toml')
        : join(resDir, 'META-INF', 'neoforge.mods.toml')
    )
  } else if (hasBuildGradle && hasForgeMod) {
    // Forge：META-INF/mods.toml。
    // NeoForge 1.20.4 元数据同为 mods.toml（≤1.20.4 旧 schema）——按 build.gradle 插件区分
    const bgPath = existsSync(join(path, 'build.gradle'))
      ? join(path, 'build.gradle')
      : join(path, 'build.gradle.kts')
    const buildGradle = readFileText(bgPath)
    type = 'mod'
    if (/net\.neoforged\.moddev/.test(buildGradle)) {
      loader = 'neoforge'
    } else {
      loader = 'forge'
    }
    modId = readTomlModId(
      files.includes('mods.toml')
        ? join(path, 'mods.toml')
        : join(resDir, 'META-INF', 'mods.toml')
    )
  } else {
    // 独立包识别：shaders/ → 光影包；pack.mcmeta 按 assets/data 区分资源包/数据包
    const isDir = (name: string): boolean =>
      files.includes(name) &&
      existsSync(join(path, name)) &&
      statSync(join(path, name)).isDirectory()
    const hasShaders = isDir('shaders')
    const hasAssets = isDir('assets')
    const hasData = isDir('data')
    const hasMcmeta = files.includes('pack.mcmeta')
    if (hasShaders) {
      // 光影包无 pack.mcmeta，版本无法从文件反推，留空（打开后可在编辑器元数据中补）
      type = 'shaderpack'
    } else if (hasMcmeta && hasData && !hasAssets) {
      type = 'datapack'
    } else if (hasMcmeta) {
      // assets 存在或空壳 pack.mcmeta 均按资源包处理
      type = 'resourcepack'
    } else {
      throw new ProjectError(
        '无法识别的项目类型（未找到 build.gradle+mod 描述文件、shaders/ 或 pack.mcmeta）'
      )
    }
    if (hasMcmeta) {
      const packFormat = readPackFormat(join(path, 'pack.mcmeta'))
      if (packFormat !== undefined) {
        mcVersion =
          type === 'datapack'
            ? dpMcVersionFromPackFormat(packFormat)
            : rpMcVersionFromPackFormat(packFormat)
      }
    }
  }

  // 独立包的 namespace：data/（数据包）或 assets/（资源包）下首个合法目录
  let namespace: string | undefined
  if (type === 'datapack' && existsSync(join(path, 'data'))) {
    namespace = readFirstContentDir(join(path, 'data'))
  } else if (type === 'resourcepack' && existsSync(join(path, 'assets'))) {
    namespace = readFirstContentDir(join(path, 'assets'))
  }

  return insertProject({
    name: path.split(/[\\/]/).pop() || '未命名项目',
    type,
    path,
    loader: loader ?? undefined,
    mcVersion,
    modId: modId ?? undefined,
    namespace
  })
}

/** 读取目录下首个合法内容 ID 子目录（用于导入时推导 namespace） */
function readFirstContentDir(dir: string): string | undefined {
  try {
    return readdirSync(dir).find(
      (n) => statSync(join(dir, n)).isDirectory() && validateModId(n)
    )
  } catch {
    return undefined
  }
}

/** 读取 pack.mcmeta 的 pack_format；缺失或解析失败返回 undefined */
function readPackFormat(mcmetaPath: string): number | undefined {
  try {
    const parsed = JSON.parse(readFileText(mcmetaPath)) as {
      pack?: { pack_format?: number }
    }
    return typeof parsed.pack?.pack_format === 'number' ? parsed.pack.pack_format : undefined
  } catch {
    return undefined
  }
}

function readFileText(p: string): string {
  return readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')
}

/** 从 mods.toml / neoforge.mods.toml 提取首个 [[mods]] 表的 modId（轻量正则，避免引入 TOML 解析器） */
function readTomlModId(tomlPath: string): string | null {
  try {
    const text = readFileText(tomlPath)
    const modsSection = text.split(/^\s*\[\[mods\]\]\s*$/m)[1] ?? text
    const m = /^\s*modId\s*=\s*"([^"]+)"/m.exec(modsSection)
    return m ? m[1] : null
  } catch {
    return null
  }
}
