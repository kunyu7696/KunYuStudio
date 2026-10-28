/**
 * Fabric 最小可编译模组模板（版本分派：1.16.5~1.21.11 走 Yarn 命名，
 * 26.x（major>1）起 Yarn 无构建、Loom 默认 Mojang 官方映射——isMojangEra 切换
 * registry/Identifier/BlockSettings 全套命名；legacy（<1.19.3）另有
 * isLegacyRegistry/registryImports/registriesConst 分支）。
 * 所有文本模板使用 {{变量}} 占位，由 generateFabricProject 替换。
 * 二进制资源（gradle-wrapper.jar、贴图）在生成时程序化处理。
 */
import { isMojangEra } from './loaderVersionMatrix'

export interface FabricTemplateVars {
  modId: string
  modName: string
  version: string
  packageName: string
  mcVersion: string
  loaderVersion: string
  fabricVersion: string
  /** 26.x 起为 ''：gradle.properties 不输出 yarn_mappings、build.gradle 不输出 mappings 行 */
  yarnVersion: string
  loomVersion: string
  /** Gradle wrapper 版本（由版本矩阵注入：1.21.4+ 需 8.12+，否则 loom 报 requires at least Gradle 8.12） */
  gradleVersion: string
  /** 目标 Java 大版本（由版本矩阵注入：1.16.5=8，1.18.2~1.20.4=17，1.20.6~1.21.x=21，26.x=25） */
  jdk: 8 | 17 | 21 | 25
  /** 项目含 blockbench_geo 实体时传入（如 4.4.9），注入 GeckoLib maven 仓库与依赖 */
  geckolibVersion?: string
}

/** 依赖镜像源区域（与 settings.network.mirror 一致） */
export type MirrorRegion = 'china' | 'official'

/**
 * FabricBlockSettings 版本断点（单一事实源，模板/内容生成器/FC 工具三处共用）。
 * 1.21.4 起 Mojang 把 Block.Settings.create() 开放为 public，Fabric 的
 * net.fabricmc.fabric.api.object.builder.v1.block.FabricBlockSettings 被移除，
 * 继续 import 会编译失败（程序包不存在）。1.21.4+ 改用 Block.Settings.create()。
 * 26.x（Mojang 映射）类名为 BlockBehaviour.Properties.of()，由 blockSettingsExpr 单独分派。
 */
export function isModernBlockSettings(mcVersion: string): boolean {
  if (isMojangEra(mcVersion)) return true
  const m = /^1\.(\d+)\.(\d+)/.exec(mcVersion ?? '')
  if (!m) return false
  const minor = Number(m[1])
  const patch = Number(m[2])
  if (minor > 21) return true
  if (minor === 21) return patch >= 4
  return false
}

/** BlockSettings 相关 import 行（1.21.4+ 不需要 FabricBlockSettings；legacy（<1.19.3）还需 Material；
 *  26.x Mojang 映射：net.minecraft.world.level.block.state.BlockBehaviour） */
export function blockSettingsImport(mcVersion: string): string {
  if (isMojangEra(mcVersion)) {
    return 'import net.minecraft.world.level.block.state.BlockBehaviour;\n'
  }
  if (isModernBlockSettings(mcVersion)) return ''
  return isLegacyRegistry(mcVersion)
    ? 'import net.fabricmc.fabric.api.object.builder.v1.block.FabricBlockSettings;\nimport net.minecraft.block.Material;\n'
    : 'import net.fabricmc.fabric.api.object.builder.v1.block.FabricBlockSettings;\n'
}

/** BlockSettings 构造表达式：
 *  - 26.x Mojang 映射：BlockBehaviour.Properties.of()
 *  - 1.21.4+ Yarn：Block.Settings.create()
 *  - legacy（<1.19.3）无 create() 工厂，走 of(Material) */
export function blockSettingsExpr(mcVersion: string): string {
  if (isMojangEra(mcVersion)) return 'BlockBehaviour.Properties.of()'
  if (isModernBlockSettings(mcVersion)) return 'Block.Settings.create()'
  return isLegacyRegistry(mcVersion)
    ? 'FabricBlockSettings.of(Material.STONE)'
    : 'FabricBlockSettings.create()'
}

/**
 * Yarn registry 包版本断点（单一事实源）。
 * 1.19.3 起 net.minecraft.util.registry 拆分迁移至 net.minecraft.registry；
 * 且 legacy（<1.19.3）无 Registries 类，注册表常量挂在 Registry.BLOCK 等静态字段上。
 */
export function isLegacyRegistry(mcVersion: string): boolean {
  const m = /^1\.(\d+)\.(\d+)/.exec(mcVersion ?? '')
  if (!m) return false
  const minor = Number(m[1])
  const patch = Number(m[2])
  if (minor > 19) return false
  if (minor === 19) return patch < 3
  return true
}

/** registry 相关 import 行：
 *  - 26.x Mojang 映射：net.minecraft.core.Registry + core.registries.BuiltInRegistries/Registries
 *    （注册方块/物品还需 ResourceKey，由 ModBlocks/ModItems 模板自行补 resources.ResourceKey）
 *  - legacy 只有 net.minecraft.util.registry.Registry 一个类 */
export function registryImports(mcVersion: string): string {
  if (isMojangEra(mcVersion)) {
    return (
      'import net.minecraft.core.Registry;\n' +
      'import net.minecraft.core.registries.BuiltInRegistries;\n' +
      'import net.minecraft.core.registries.Registries;\n'
    )
  }
  return isLegacyRegistry(mcVersion)
    ? 'import net.minecraft.util.registry.Registry;\n'
    : 'import net.minecraft.registry.Registries;\nimport net.minecraft.registry.Registry;\n'
}

/** 注册表常量表达式：
 *  - 26.x Mojang：BuiltInRegistries.BLOCK / ITEM
 *  - legacy 无 Registries 类，常量在 Registry.X 静态字段 */
export function registriesConst(
  mcVersion: string,
  registry: 'BLOCK' | 'ITEM' | 'ENTITY_TYPE' | 'ENCHANTMENT'
): string {
  if (isMojangEra(mcVersion)) return `BuiltInRegistries.${registry}`
  return isLegacyRegistry(mcVersion) ? `Registry.${registry}` : `Registries.${registry}`
}

/** 非不透明渲染链式调用：
 *  - 26.x Mojang 映射：noOcclusion()
 *  - Yarn 1.19.4 起 notSolid() 更名 nonOpaque() */
export function nonOpaqueCall(mcVersion: string): string {
  if (isMojangEra(mcVersion)) return '.noOcclusion()'
  const m = /^1\.(\d+)\.(\d+)/.exec(mcVersion ?? '')
  if (!m) return '.nonOpaque()'
  const minor = Number(m[1])
  const patch = Number(m[2])
  return minor > 19 || (minor === 19 && patch >= 4) ? '.nonOpaque()' : '.notSolid()'
}

/* ------------------------------------------------------------------ */
/* 26.x（Mojang 官方映射）与 Yarn 时代的类名/方法名差异（单一事实源）      */
/* 以下 helper 与 blockSettingsImport 并列，供 Fabric 模板与动态内容生成器 */
/* 共用，避免 Yarn 名称散落在多个生成器里。                                  */
/* ------------------------------------------------------------------ */

/** 方块主类 import：26.x Mojmap world.level.block.Block / Yarn block.Block */
export function blockClassImport(mcVersion: string): string {
  return isMojangEra(mcVersion)
    ? 'import net.minecraft.world.level.block.Block;\n'
    : 'import net.minecraft.block.Block;\n'
}

/** 方块物品类 import：26.x Mojmap world.item.BlockItem（Yarn: item.BlockItem） */
export function blockItemClassImport(mcVersion: string): string {
  return isMojangEra(mcVersion)
    ? 'import net.minecraft.world.item.BlockItem;\n'
    : 'import net.minecraft.item.BlockItem;\n'
}

/** 物品主类 import：26.x Mojmap world.item.Item / Yarn item.Item */
export function itemClassImport(mcVersion: string): string {
  return isMojangEra(mcVersion)
    ? 'import net.minecraft.world.item.Item;\n'
    : 'import net.minecraft.item.Item;\n'
}

/**
 * 26.x 属性对象必须挂 ResourceKey 所需的 import。
 * Yarn 时代无此要求（注册键由 Registry.register 直接接收），返回空串。
 */
export function resourceKeyImport(mcVersion: string): string {
  return isMojangEra(mcVersion) ? 'import net.minecraft.resources.ResourceKey;\n' : ''
}

/**
 * 属性对象的 setId 链式调用（注册键绑定）。
 * 26.x Fabric 实证：BlockBehaviour.Properties / Item.Properties 不挂 ResourceKey 会在注册期抛异常；
 * Yarn 时代无该步骤，返回空串（调用方过滤即可保持原输出）。
 */
export function setIdCallExpr(
  mcVersion: string,
  registry: 'BLOCK' | 'ITEM',
  modClassName: string,
  id: string
): string {
  if (!isMojangEra(mcVersion)) return ''
  return `.setId(ResourceKey.create(Registries.${registry}, ${modClassName}.id("${id}")))`
}

/** 方块音效组 import：26.x Mojmap world.level.block.SoundType（枚举）/ Yarn sound.BlockSoundGroup */
export function blockSoundImport(mcVersion: string): string {
  return isMojangEra(mcVersion)
    ? 'import net.minecraft.world.level.block.SoundType;\n'
    : 'import net.minecraft.sound.BlockSoundGroup;\n'
}

/** 方块音效组表达式：26.x SoundType.STONE / Yarn BlockSoundGroup.STONE */
export function blockSoundExpr(mcVersion: string, soundGroup: string): string {
  const prefix = isMojangEra(mcVersion) ? 'SoundType' : 'BlockSoundGroup'
  return `${prefix}.${soundGroup.toUpperCase()}`
}

/** 方块音效链：26.x `sound(SoundType.X)` / Yarn `sounds(BlockSoundGroup.X)`（方法名不同） */
export function blockSoundCall(mcVersion: string, soundGroup: string): string {
  const method = isMojangEra(mcVersion) ? 'sound' : 'sounds'
  return `.${method}(${blockSoundExpr(mcVersion, soundGroup)})`
}

/** 需要正确工具才掉落：26.x requiresCorrectToolForDrops() / Yarn requiresTool() */
export function requiresToolCall(mcVersion: string): string {
  return isMojangEra(mcVersion) ? '.requiresCorrectToolForDrops()' : '.requiresTool()'
}

/** 发光等级链：26.x lightLevel(...) / Yarn luminance(...) */
export function luminanceCall(mcVersion: string, level: number): string {
  return isMojangEra(mcVersion) ? `.lightLevel(state -> ${level})` : `.luminance(state -> ${level})`
}

/** Item 属性对象：26.x new Item.Properties() / Yarn new Item.Settings() */
export function itemPropertiesExpr(mcVersion: string): string {
  return isMojangEra(mcVersion) ? 'new Item.Properties()' : 'new Item.Settings()'
}

/** 堆叠数链：26.x stacksTo(...) / Yarn maxCount(...) */
export function stackCountCall(mcVersion: string, count: number): string {
  return `.${isMojangEra(mcVersion) ? 'stacksTo' : 'maxCount'}(${count})`
}

/** 稀有度 import：26.x world.item.Rarity / Yarn util.Rarity */
export function rarityImport(mcVersion: string): string {
  return isMojangEra(mcVersion) ? 'import net.minecraft.world.item.Rarity;\n' : 'import net.minecraft.util.Rarity;\n'
}

export const FABRIC_DEFAULTS = {
  mcVersion: '1.20.1',
  loaderVersion: '0.15.11',
  fabricVersion: '0.92.1+1.20.1',
  yarnVersion: '1.20.1+build.10',
  loomVersion: '1.6-SNAPSHOT',
  gradleVersion: '8.10.2'
}

export function gradleProperties(v: FabricTemplateVars): string {
  const gecko = v.geckolibVersion
    ? `\n# GeckoLib（骨骼动画实体依赖）\ngeckolib_version=${v.geckolibVersion}\n`
    : ''
  // 26.x 起 Yarn 无构建（Loom 1.18 默认 Mojang 官方映射）：不输出 yarn_mappings 行，
  // 与官方 fabric-example-mod 26.3 分支逐字节对齐（输出该行反而产生未使用属性，虽不致命但失真）
  const yarnLine = v.yarnVersion ? `yarn_mappings=${v.yarnVersion}\n` : ''
  return `# Fabric Properties
minecraft_version=${v.mcVersion}
${yarnLine}loader_version=${v.loaderVersion}

# Mod Properties
mod_version=${v.version}
maven_group=${v.packageName}
archives_base_name=${v.modId}

# Dependencies
fabric_version=${v.fabricVersion}
${gecko}`
}

export function buildGradle(v: FabricTemplateVars, mirror: MirrorRegion = 'china'): string {
  const repos = mirror === 'china'
    ? `    // 国内镜像优先，提升首次构建依赖下载成功率（官方源保留兜底）
    maven { url 'https://maven.aliyun.com/repository/public' }
    maven { url 'https://maven.fabricmc.net/' }
    mavenCentral()`
    : `    // 官方源
    maven { url 'https://maven.fabricmc.net/' }
    mavenCentral()`
  // GeckoLib 仅走官方 cloudsmith 仓库（国内镜像无收录；cloudsmith 国内可直连，失败时换 official 镜像重试）
  const geckoRepo = v.geckolibVersion
    ? `    // GeckoLib（骨骼动画实体）
    maven { url 'https://dl.cloudsmith.io/public/geckolib3/geckolib/maven/' }
`
    : ''
  const geckoDep = v.geckolibVersion
    ? `    // GeckoLib 骨骼动画引擎（blockbench_geo 实体需要）
    modImplementation "software.bernie.geckolib:geckolib-fabric-1.20.1:\${project.geckolib_version}"
`
    : ''
  // 1.21+ 起 fabric-gametest-api-v1 已合并进 fabric-api；仅 1.20.x 及以下单独声明。
  // 注意：Loom 1.6 已移除 modTestImplementation（M23 探针实测 "Could not find method"），
  // test sourceSet 默认复用 main 的重映射 MC 类路径，改用普通 testImplementation。
  const mcMajorMinor = v.mcVersion.split('.').slice(0, 2).join('.')
  const gametestDep = ['1.16', '1.18', '1.19', '1.20'].includes(mcMajorMinor)
    ? `    // GameTest 无头测试：fabric-gametest-api-v1 提供 @GameTest 注解 + TestContext（Yarn 映射）。
    testImplementation "net.fabricmc.fabric-api:fabric-gametest-api-v1:\${project.fabric_version}"
`
    : ''
  // Java 目标版本改由版本矩阵注入的 v.jdk 派生（三真值源收口：
  // 原硬编码 1.20.6+ 列表与矩阵漂移，新增 1.21.6+ 时漏改会导致 17 编译）
  const jdk = v.jdk
  const javaVersion = `VERSION_${jdk === 8 ? '1_8' : jdk}`
  // 26.x（Mojang 映射时代）：
  //  - 插件 id 带 net.fabricmc 前缀（官方 26.3 MDK：net.fabricmc.fabric-loom）
  //  - 无 mappings 行（26.x 无 Yarn 构建，Loom 1.18 默认 Mojang 官方映射）
  //  - loader/fabric-api 用 implementation（官方 26.3 MDK 写法，Loom 1.18 自动重映射）
  const mojang = isMojangEra(v.mcVersion)
  const loomPluginId = mojang ? 'net.fabricmc.fabric-loom' : 'fabric-loom'
  const mappingsLine = v.yarnVersion
    ? `    mappings "net.fabricmc:yarn:\${project.yarn_mappings}:v2"\n`
    : ''
  const loaderConfiguration = mojang ? 'implementation' : 'modImplementation'
  return `plugins {
    id '${loomPluginId}' version '${v.loomVersion}'
    id 'maven-publish'
}

version = project.mod_version
group = project.maven_group

base {
    archivesName = project.archives_base_name
}

// S-05：kunyu-observer-agent（javaagent 形态，覆盖 Fabric/Forge/NeoForge 与 MC 全版本，
// 不再是 mod）。主进程在 runClient 前把 agent 路径与一次性令牌写入 gradle.properties
// （kunyu.observer.agent / kunyu.observer.token）；未配置 agent 时跳过，向后兼容。
loom {
    runs {
        client {
            if (project.findProperty('kunyu.observer.agent')) {
                vmArg "-javaagent:\${project.findProperty('kunyu.observer.agent')}=port=9876,token=\${project.findProperty('kunyu.observer.token') ?: ''}"
            }
        }
    }
}

repositories {
${repos}
${geckoRepo}}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
${mappingsLine}    ${loaderConfiguration} "net.fabricmc:fabric-loader:\${project.loader_version}"
    ${loaderConfiguration} "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
${gametestDep}${geckoDep}}

processResources {
    inputs.property "version", project.version

    filesMatching("fabric.mod.json") {
        expand "version": project.version
    }
}

tasks.withType(JavaCompile).configureEach {
    it.options.release = ${jdk}
}

java {
    sourceCompatibility = JavaVersion.${javaVersion}
    targetCompatibility = JavaVersion.${javaVersion}
    withSourcesJar()
}

jar {
    from("LICENSE") {
        // Gradle 9（loom 1.18 线 / 1.21.6+）移除 archivesBaseName 属性，改走 base.archivesName
        rename { "\${it}_\${${parseInt(v.gradleVersion) >= 9 ? 'project.base.archivesName.get()' : 'project.archivesBaseName'}}" }
    }
}

publishing {
    publications {
        mavenJava(MavenPublication) {
            from components.java
        }
    }
}
`
}

export function settingsGradle(mirror: MirrorRegion = 'china'): string {
  const pluginRepos = mirror === 'china'
    ? `        maven {
            name = 'Fabric'
            url = 'https://maven.fabricmc.net/'
        }
        maven { url = 'https://maven.aliyun.com/repository/gradle-plugin' }
        mavenCentral()
        gradlePluginPortal()`
    : `        maven {
            name = 'Fabric'
            url = 'https://maven.fabricmc.net/'
        }
        mavenCentral()
        gradlePluginPortal()`
  return `pluginManagement {
    repositories {
${pluginRepos}
    }
}
`
}

export function gradleWrapperProperties(gradleVersion: string, mirror: MirrorRegion = 'china'): string {
  const url = mirror === 'china'
    ? `https\\://mirrors.cloud.tencent.com/gradle/gradle-${gradleVersion}-bin.zip`
    : `https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`
  return `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=${url}
networkTimeout=120000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`
}

export const gradlewSh = `#!/bin/sh

#
# Gradle start up script for POSIX generated by Gradle.
#

# Attempt to set APP_HOME

# Resolve links: $0 may be a link
app_path=\$0

# Need this for daisy-chained symlinks.
while
    APP_HOME=\${app_path%"\${app_path##*/}"}  # leaves a trailing /; empty if no leading path
    [ -h "\$app_path" ]
do
    ls=\$( ls -ld "\$app_path" )
    link=\${ls#*' -> '}
    case \$link in             #(
      /*)   app_path=\$link ;; #(
      *)    app_path=\$APP_HOME\$link ;;
    esac
done

# This is normally unused
# shellcheck disable=SC2034
APP_BASE_NAME=\${0##*/}
# Discard cd standard output in case \$CDPATH is set (https://github.com/gradle/gradle/issues/25036)
APP_HOME=\$( cd "\${APP_HOME:-./}" > /dev/null && pwd -P ) || exit

set -e

APP_NAME="Gradle"

DEFAULT_JVM_OPTS='"-Xmx64m" "-Xms64m"'

MAX_FD="maximum"

warn () {
    echo "\$*"
}

die () {
    echo
    echo "\$*"
    echo
    exit 1
}

cygwin=false
msys=false
darwin=false
nonstop=false
case "\`uname\`" in
  CYGWIN* )
    cygwin=true
    ;;
  Darwin* )
    darwin=true
    ;;
  MSYS* | MINGW* )
    msys=true
    ;;
  NONSTOP* )
    nonstop=true
    ;;
esac

CLASSPATH=\$APP_HOME/gradle/wrapper/gradle-wrapper.jar

JAVACMD="java"

if [ -n "\$JAVA_HOME" ] ; then
    if [ -x "\$JAVA_HOME/jre/sh/java" ] ; then
        JAVACMD="\$JAVA_HOME/jre/sh/java"
    else
        JAVACMD="\$JAVA_HOME/bin/java"
    fi
    if [ ! -x "\$JAVACMD" ] ; then
        die "ERROR: JAVA_HOME is set to an invalid directory: \$JAVA_HOME"
    fi
elif ! command -v java >/dev/null 2>&1 ; then
    die "ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH."
fi

exec "\$JAVACMD" \\
    -classpath "\$CLASSPATH" \\
    org.gradle.wrapper.GradleWrapperMain "\$@"
`

export const gradlewBat = `@rem
@rem Gradle startup script for Windows
@rem

@if "%DEBUG%"=="" @echo off

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
@rem This is normally unused
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%

set DEFAULT_JVM_OPTS="-Xmx64m" "-Xms64m"

set CLASSPATH=%APP_HOME%\\gradle\\wrapper\\gradle-wrapper.jar

if defined JAVA_HOME goto findJavaFromJavaHome

set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto execute

echo ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
goto fail

:findJavaFromJavaHome
set JAVA_HOME=%JAVA_HOME:"=%
set JAVA_EXE=%JAVA_HOME%/bin/java.exe

if exist "%JAVA_EXE%" goto execute

echo ERROR: JAVA_HOME is set to an invalid directory: %JAVA_HOME%
goto fail

:execute
"%JAVA_EXE%" %DEFAULT_JVM_OPTS% -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*

:end
@rem End local scope for the variables with windows NT shell
if %ERRORLEVEL% equ 0 goto mainEnd

:fail
exit /b 1

:mainEnd
`

export function fabricModJson(v: FabricTemplateVars): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      id: v.modId,
      version: '${version}',
      name: v.modName,
      description: `${v.modName} - 由 KunYu Studio 创建`,
      authors: ['KunYu Studio'],
      contact: {},
      license: 'MIT',
      environment: '*',
      entrypoints: {
        main: [`${v.packageName}.${v.modId.charAt(0).toUpperCase() + v.modId.slice(1)}Mod`]
      },
      // depends 全部由版本矩阵参数化：
      // - 1.16.5 工具链 loader 0.14.0 / Java 8（旧硬编码 >=0.15.0、>=17 会直接拒载）
      // - fabric-api 下界取矩阵选定版本（去掉裸 *，避免过旧 API 混入）
      depends: {
        fabricloader: `>=${v.loaderVersion}`,
        minecraft: `~${v.mcVersion}`,
        java: `>=${v.jdk}`,
        'fabric-api': `>=${v.fabricVersion.split('+')[0]}`
      }
    },
    null,
    2
  )
}

/** Identifier 构造分派：
 *  - 26.x Mojang 映射：net.minecraft.resources.Identifier.fromNamespaceAndPath（ResourceLocation 更名 Identifier）
 *  - 1.21+ Yarn：构造器私有化，改用静态工厂 Identifier.of（javap 实证 1.20.6 仍公开）
 *  - 旧版：new Identifier */
export function identifierFactoryCall(mcVersion: string): string {
  if (isMojangEra(mcVersion)) return 'Identifier.fromNamespaceAndPath'
  const [major = 0, minor = 0] = mcVersion.split('.').map((x) => Number.parseInt(x, 10) || 0)
  return major > 1 || minor >= 21 ? 'Identifier.of' : 'new Identifier'
}

export function mainClass(v: FabricTemplateVars): string {
  const className = `${v.modId.charAt(0).toUpperCase()}${v.modId.slice(1)}Mod`
  // MC 1.18 起类路径才有 slf4j；1.16.x 用 log4j 2.x（M23 探针实测）
  const legacyLog = v.mcVersion.startsWith('1.16')
  const logImport = legacyLog
    ? `import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;`
    : `import org.slf4j.Logger;
import org.slf4j.LoggerFactory;`
  const logFactory = legacyLog ? 'LogManager' : 'LoggerFactory'
  const newIdentifier = identifierFactoryCall(v.mcVersion)
  // 26.x Mojang 映射：Identifier 迁至 net.minecraft.resources（旧 Yarn 为 net.minecraft.util）
  const identifierImport = isMojangEra(v.mcVersion)
    ? 'import net.minecraft.resources.Identifier;'
    : 'import net.minecraft.util.Identifier;'
  return `package ${v.packageName};

import ${v.packageName}.registry.ModBlocks;
import ${v.packageName}.registry.ModItems;
import net.fabricmc.api.ModInitializer;
${identifierImport}
${logImport}

public class ${className} implements ModInitializer {
    public static final String MOD_ID = "${v.modId}";
    public static final Logger LOGGER = ${logFactory}.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ModBlocks.register();
        ModItems.register();
        LOGGER.info("${v.modName} initialized!");
    }

    public static Identifier id(String path) {
        return ${newIdentifier}(MOD_ID, path);
    }
}
`
}

export function modBlocksClass(v: FabricTemplateVars): string {
  const modClass = `${v.modId.charAt(0).toUpperCase()}${v.modId.slice(1)}Mod`
  const registry = registriesConst(v.mcVersion, 'BLOCK')
  // 26.x Mojang 映射：BlockBehaviour.Properties + 强制 setId(ResourceKey)（与 Fabric API 26.3
  // testmod 写法逐一对齐：Properties 不挂 ResourceKey 会在注册期抛异常）
  if (isMojangEra(v.mcVersion)) {
    return `package ${v.packageName}.registry;

import ${v.packageName}.${modClass};
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;

public class ModBlocks {
    public static final Block EXAMPLE_BLOCK = new Block(
        BlockBehaviour.Properties.of()
            .setId(ResourceKey.create(Registries.BLOCK, ${modClass}.id("example_block")))
            .strength(2.0f, 6.0f)
            .requiresCorrectToolForDrops()
    );

    public static void register() {
        Registry.register(BuiltInRegistries.BLOCK, ${modClass}.id("example_block"), EXAMPLE_BLOCK);
    }
}
`
  }
  return `package ${v.packageName}.registry;

import ${v.packageName}.${modClass};
${blockSettingsImport(v.mcVersion)}import net.minecraft.block.Block;
${registryImports(v.mcVersion)}
public class ModBlocks {
    public static final Block EXAMPLE_BLOCK = new Block(
        ${blockSettingsExpr(v.mcVersion)}
            .strength(2.0f, 6.0f)
            .requiresTool()
    );

    public static void register() {
        Registry.register(${registry}, ${modClass}.id("example_block"), EXAMPLE_BLOCK);
    }
}
`
}

export function modItemsClass(v: FabricTemplateVars): string {
  const modClass = `${v.modId.charAt(0).toUpperCase()}${v.modId.slice(1)}Mod`
  const registry = registriesConst(v.mcVersion, 'ITEM')
  // 26.x Mojang 映射：Item.Properties 同样强制 setId(ResourceKey)
  if (isMojangEra(v.mcVersion)) {
    return `package ${v.packageName}.registry;

import ${v.packageName}.${modClass};
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;

public class ModItems {
    public static final Item EXAMPLE_BLOCK_ITEM = new BlockItem(
        ModBlocks.EXAMPLE_BLOCK,
        new Item.Properties().setId(ResourceKey.create(Registries.ITEM, ${modClass}.id("example_block")))
    );

    public static void register() {
        Registry.register(BuiltInRegistries.ITEM, ${modClass}.id("example_block"), EXAMPLE_BLOCK_ITEM);
    }
}
`
  }
  return `package ${v.packageName}.registry;

import ${v.packageName}.${modClass};
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
${registryImports(v.mcVersion)}
public class ModItems {
    public static final Item EXAMPLE_BLOCK_ITEM = new BlockItem(
        ModBlocks.EXAMPLE_BLOCK, new Item.Settings()
    );

    public static void register() {
        Registry.register(${registry}, ${modClass}.id("example_block"), EXAMPLE_BLOCK_ITEM);
    }
}
`
}

export function blockStateJson(v: FabricTemplateVars): string {
  return JSON.stringify(
    {
      variants: {
        '': { model: `${v.modId}:block/example_block` }
      }
    },
    null,
    2
  )
}

export function blockModelJson(v: FabricTemplateVars): string {
  return JSON.stringify(
    {
      parent: 'block/cube_all',
      textures: {
        all: `${v.modId}:block/example_block`
      }
    },
    null,
    2
  )
}

export function itemModelJson(v: FabricTemplateVars): string {
  return JSON.stringify(
    {
      parent: `${v.modId}:block/example_block`
    },
    null,
    2
  )
}

export function langEnUs(v: FabricTemplateVars): string {
  return JSON.stringify(
    {
      [`block.${v.modId}.example_block`]: `${v.modName} Block`
    },
    null,
    2
  )
}

/**
 * 特性④ CI/CD 导出：GitHub Actions 工作流，跑 `./gradlew runGameTestServer` 无头测试。
 * 模组项目创建时同步落盘到 .github/workflows/gametest.yml。
 * 用 \n 换行（GitHub Actions 在 Linux runner 上跑，避免 CRLF）。
 */
export function githubActionsWorkflow(jdk: number = 17): string {
  return [
    'name: GameTest',
    '',
    'on:',
    '  push:',
    '    branches: [main, master]',
    '  pull_request:',
    '    branches: [main, master]',
    '',
    'jobs:',
    '  gametest:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '',
    `      - name: Setup JDK ${jdk}`,
    '        uses: actions/setup-java@v4',
    '        with:',
    '          distribution: temurin',
    `          java-version: "${jdk}"`,
    '',
    '      - name: Cache Gradle',
    '        uses: actions/cache@v4',
    '        with:',
    '          path: |',
    '            ~/.gradle/caches',
    '            ~/.gradle/wrapper',
    '          key: ${{ runner.os }}-gradle-${{ hashFiles(\'**/*.gradle*\', \'gradle.properties\') }}',
    '          restore-keys: ${{ runner.os }}-gradle-',
    '',
    '      - name: Run GameTest server',
    '        run: ./gradlew runGameTestServer --console=plain --stacktrace',
    ''
  ].join('\n')
}
