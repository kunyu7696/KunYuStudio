/**
 * NeoForge 最小可编译模组模板（Mojang 官方映射 + ModDevGradle 2.x）。
 * 写法对齐 neoforged 官方 MDK：DeferredRegister / DeferredBlock / DeferredItem 注册，
 * @Mod 主类 + @EventBusSubscriber 客户端订阅。
 * 注意：26.3 组合在版本矩阵中标记为 beta 并禁用（NeoForge 官方未 GA），
 * 模板不会在该版本上被调用；jdk 联合保留 25 仅为与矩阵类型一致。
 */

import { compareMcVersion, nextMinorMc } from './loaderVersionMatrix'

export interface NeoForgeTemplateVars {
  modId: string
  modName: string
  version: string
  packageName: string
  mcVersion: string
  neoForgeVersion: string
  modDevGradleVersion: string
  gradleVersion: string
  /** 目标 Java 大版本（由版本矩阵注入：1.20.4=17，1.20.6+=21，26.x beta=25） */
  jdk: 17 | 21 | 25
}

export const NEOFORGE_DEFAULTS = {
  mcVersion: '1.21.1',
  neoForgeVersion: '21.1.250',
  modDevGradleVersion: '2.0.147',
  gradleVersion: '8.10.2'
}

export function neoForgeGradleProperties(v: NeoForgeTemplateVars, mirror: 'china' | 'official' = 'china'): string {
  // 国内环境下，NeoForm 直连 libraries.minecraft.net 常被 SSL 重置；
  // 通过 BMCLAPI 镜像的 version manifest，使库下载 URL 指向 bmclapi2.bangbang93.com/maven。
  const launcherManifest = mirror === 'china'
    ? `# NeoForm 启动器清单镜像（BMCLAPI）：规避国内直连 libraries.minecraft.net 的 SSL 重置
neoForge.neoFormRuntime.launcherManifestUrl=https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json
`
    : ''
  return `# NeoForge Properties
minecraft_version=${v.mcVersion}
neoforge_version=${v.neoForgeVersion}

# Mod Properties
mod_version=${v.version}
maven_group=${v.packageName}
archives_base_name=${v.modId}

# Gradle
org.gradle.jvmargs=-Xmx3G
org.gradle.daemon=false
${launcherManifest}`
}

export function neoForgeBuildGradle(v: NeoForgeTemplateVars, mirror: 'china' | 'official' = 'china'): string {
  // ModDevGradle 自动注入 maven.neoforged.net/releases 与 /mojang-meta；国内 cdn77 节点
  // 长超时反复重试时必须先 repositories.clear() 再显式重配（NeoForge Discord 官方建议）。
  const repos = mirror === 'china'
    ? `    // 阿里云公共镜像：加速常规 Maven 依赖（log4j 等），须在 BMCLAPI 之前以避免其不稳定的 CDN 重定向
    maven { url = 'https://maven.aliyun.com/repository/public' }
    // NeoForge 官方 CDN 镜像（maven.neoforged.net 的 forgecdn 入口，含 releases 与 mojang-meta）
    maven { url = 'https://neoforged.forgecdn.net/releases' }
    maven { url = 'https://neoforged.forgecdn.net/mojang-meta' }
    // BMCLAPI 镜像：镜像 files.minecraftforge.net/maven、libraries.minecraft.net
    maven { url = 'https://bmclapi2.bangbang93.com/maven' }
    // com.mojang 库只走官方源（BMCLAPI 部分 Mojang 库 403，content includeGroup 强制隔离）
    maven {
      url = 'https://libraries.minecraft.net/'
      content { includeGroup 'com.mojang' }
    }`
    : `    // 官方源（ModDevGradle 亦会自动注入；clear 后显式重配）
    maven { url = 'https://maven.neoforged.net/releases' }
    maven { url = 'https://maven.neoforged.net/mojang-meta' }
    maven { url = 'https://libraries.minecraft.net/' }
    mavenCentral()`
  // Java 工具链版本由版本矩阵注入（NeoForge 1.20.4=17，1.20.6+=21）
  const jdk = v.jdk
  return `plugins {
    id 'java'
    // plugins 块在 project 创建前求值，不支持 \${project.*} 插值，版本必须字面量
    id 'net.neoforged.moddev' version '${v.modDevGradleVersion}'
}

version = project.mod_version
group = project.maven_group

base {
    archivesName = project.archives_base_name
}

// Java 工具链：NeoForge 1.20.4=17，1.20.6+=21
java.toolchain.languageVersion = JavaLanguageVersion.of(${jdk})

// 清空 ModDevGradle 自动注入的仓库后显式重配（clear 必须在 repositories 块之前）
repositories.clear()

repositories {
${repos}
}

// NeoForge 传递依赖 net.minecraftforge:unsafe 声明 log4j-core:2.11.+ 与 log4j-api:2.11.+（动态版本），
// 解析必须走 maven-metadata，而 BMCLAPI 镜像的 metadata 重定向链接 HEAD 403 必失败
// （实测可复现：离线预检 Could not resolve log4j-api:2.11.+）。钉死具体版本跳过动态版本 metadata 查询。
// XV-03：log4j-api 与 log4j-core 必须一起 force，否则 api 仍走动态版本查询。
configurations.all {
    resolutionStrategy.force 'org.apache.logging.log4j:log4j-core:2.11.1', 'org.apache.logging.log4j:log4j-api:2.11.1'
}

neoForge {
    // 使用 enable{} DSL 并关闭反编译/重编译管线（MDG 2.0.124+ 支持）。
    // 跳过 NeoForm recompile 步骤，规避国内直连 libraries.minecraft.net 下载库时的 SSL 重置；
    // CI 环境（CI=true）下 MDG 2.0.136+ 默认启用此管线。
    enable {
        version = "\${project.neoforge_version}"
        disableRecompilation = true
    }

    runs {
        client {
            client()
            // S-05：kunyu-observer-agent（javaagent 形态，覆盖全加载器与 MC 全版本）。
            // 主进程在 runClient 前把 agent 路径与令牌写入 gradle.properties，未配置时跳过。
            // ModDevGradle RunModel 无 jvmArg，只有 jvmArgument
            if (project.findProperty('kunyu.observer.agent')) {
                jvmArgument "-javaagent:\${project.findProperty('kunyu.observer.agent')}=port=9876,token=\${project.findProperty('kunyu.observer.token') ?: ''}"
            }
        }
        server {
            server()
            programArgument '--nogui'
        }
        data {
            data()
            programArguments.addAll '--mod', "\${project.archives_base_name}", '--all',
                '--output', file('src/generated/resources/').toString(),
                '--existing', file('src/main/resources/').toString()
        }
    }

    mods {
        "\${project.archives_base_name}" {
            sourceSet(sourceSets.main)
        }
    }
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
}

neoFormRuntime {
    // 国内环境下覆盖 NeoForm 启动器清单 URL 为 BMCLAPI 镜像，
    // 使 Minecraft 库/客户端下载指向 bmclapi2.bangbang93.com，规避直连 libraries.minecraft.net 的 SSL 重置。
    ${mirror === 'china' ? `launcherManifestUrl = 'https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json'` : ''}
}
`
}

export function neoForgeSettingsGradle(mirror: 'china' | 'official' = 'china'): string {
  const neoforgeRepo = mirror === 'china'
    ? `        // 官方 CDN 镜像（含 net.neoforged.moddev 插件 marker）
        maven { url = 'https://neoforged.forgecdn.net/releases' }
        maven { url = 'https://maven.aliyun.com/repository/gradle-plugin' }`
    : `        maven { url = 'https://maven.neoforged.net/releases' }
        mavenCentral()`
  return `pluginManagement {
    repositories {
${neoforgeRepo}
        gradlePluginPortal()
    }
}

plugins {
    id 'org.gradle.toolchains.foojay-resolver-convention' version '0.8.0'
}

rootProject.name = 'neoforge-mod'
`
}

/** NeoForge 元数据文件名按版本分派（官方文档核对）：
 *  1.20.5+ 才是 META-INF/neoforge.mods.toml（license 必填、type="required" 新 schema）；
 *  1.20.3-1.20.4 沿用 Forge 式 META-INF/mods.toml，且 modLoader/loaderVersion 为 mandatory 字段。 */
export function neoForgeMetadataRelPath(mcVersion: string): string {
  return compareMcVersion(mcVersion, '1.20.5') >= 0
    ? 'META-INF/neoforge.mods.toml'
    : 'META-INF/mods.toml'
}

/** META-INF/neoforge.mods.toml | mods.toml（对齐官方 MDK 结构；版本区间全部由版本矩阵参数化） */
export function neoForgeModsToml(v: NeoForgeTemplateVars): string {
  // NeoForge 版本号前两段即 MC minor 编码（20.4→1.20.4、20.6→1.20.6、21.1→1.21.1）
  const parts = v.neoForgeVersion.split('.')
  const neoBase = `${parts[0]}.${parts[1] ?? '0'}`
  // minecraft 区间覆盖同一 minor：下界为选定版本，上界为下一 minor
  const mcUpper = nextMinorMc(v.mcVersion)
  // ≤1.20.4 旧 schema：modLoader/loaderVersion 必填 + 依赖用 mandatory=true
  if (compareMcVersion(v.mcVersion, '1.20.5') < 0) {
    return `modLoader="javafml"
loaderVersion="[2,)"
license="MIT"

[[mods]]
modId="${v.modId}"
version="\${file.jarVersion}"
displayName="${v.modName}"
authors="KunYu Studio"
description='''${v.modName}（由 KunYu Studio 生成）'''

[[dependencies.${v.modId}]]
modId="neoforge"
mandatory=true
versionRange="[${neoBase},)"
ordering="NONE"
side="BOTH"

[[dependencies.${v.modId}]]
modId="minecraft"
mandatory=true
versionRange="[${v.mcVersion},${mcUpper})"
ordering="NONE"
side="BOTH"
`
  }
  return `license="MIT"

[[mods]]
modId="${v.modId}"
version="\${file.jarVersion}"
displayName="${v.modName}"
authors="KunYu Studio"
description='''${v.modName}（由 KunYu Studio 生成）'''

[[dependencies.${v.modId}]]
modId="neoforge"
type="required"
versionRange="[${neoBase},)"
ordering="NONE"
side="BOTH"

[[dependencies.${v.modId}]]
modId="minecraft"
type="required"
versionRange="[${v.mcVersion},${mcUpper})"
ordering="NONE"
side="BOTH"
`
}

/** 主类：@Mod 构造器注入 IEventBus + DeferredRegister 注册（对齐官方 MDK） */
export function neoForgeMainClass(v: NeoForgeTemplateVars): string {
  const modClassName = modClassNameOf(v.modId)
  return `package ${v.packageName};

import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import ${v.packageName}.registry.ModBlocks;
import ${v.packageName}.registry.ModItems;
import org.slf4j.Logger;

@Mod(${modClassName}.MOD_ID)
public class ${modClassName} {
    public static final String MOD_ID = "${v.modId}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public ${modClassName}(IEventBus modEventBus) {
        // DeferredRegister 挂载到 mod 事件总线
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);

        modEventBus.addListener(this::commonSetup);
    }

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("KunYu Studio NeoForge mod initialized");
    }
}
`
}

export function neoForgeModBlocksClass(v: NeoForgeTemplateVars): string {
  const modClassName = modClassNameOf(v.modId)
  return `package ${v.packageName}.registry;

import ${v.packageName}.${modClassName};
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * AUTO-GENERATED by KunYu Studio — 由可视化编辑器在生成内容时改写。
 */
public class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(${modClassName}.MOD_ID);

    // 模板示例方块，可在可视化编辑器中删除
    public static final DeferredBlock<Block> EXAMPLE_BLOCK = BLOCKS.registerBlock("example_block",
        props -> new Block(props), BlockBehaviour.Properties.of().mapColor(MapColor.STONE)
            .strength(1.5f, 6.0f).sound(SoundType.STONE).requiresCorrectToolForDrops());
}
`
}

export function neoForgeModItemsClass(v: NeoForgeTemplateVars): string {
  const modClassName = modClassNameOf(v.modId)
  return `package ${v.packageName}.registry;

import ${v.packageName}.${modClassName};
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * AUTO-GENERATED by KunYu Studio — 由可视化编辑器在生成内容时改写。
 */
public class ModItems {
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(${modClassName}.MOD_ID);

    // registerSimpleBlockItem 返回 DeferredItem<BlockItem>（不是 DeferredHolder<Item, Item>）
    public static final DeferredItem<BlockItem> EXAMPLE_BLOCK_ITEM =
        ITEMS.registerSimpleBlockItem("example_block", ModBlocks.EXAMPLE_BLOCK);

    public static final DeferredItem<Item> EXAMPLE_ITEM =
        ITEMS.register("example_item", () -> new Item(new Item.Properties()));
}
`
}

/** 客户端订阅类（@EventBusSubscriber Dist.CLIENT） */
export function neoForgeClientClass(v: NeoForgeTemplateVars): string {
  const modClassName = modClassNameOf(v.modId)
  // XV-01：FML 版本断点。FML 2.x（NeoForge 1.20.4 及更早）只有嵌套类
  // net.neoforged.fml.common.Mod.EventBusSubscriber，没有顶层 EventBusSubscriber；
  // FML 3.x+（1.20.5+）才有顶层 EventBusSubscriber。按 mcVersion 分派。
  const useFml2Nested = compareMcVersion(v.mcVersion, '1.20.5') < 0
  if (useFml2Nested) {
    return `package ${v.packageName};

import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;

/**
 * AUTO-GENERATED by KunYu Studio — 由可视化编辑器在生成内容时改写。
 */
@Mod.EventBusSubscriber(modid = ${modClassName}.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public class ${modClassName}Client {

    @SubscribeEvent
    public static void onClientSetup(FMLClientSetupEvent event) {
        // 客户端初始化（渲染器注册由内容生成器在需要时织入）
    }
}
`
  }
  // FML loader 9.x（NeoForge 21.6+ / MC 1.21.6 起，pom 依赖实证：21.5.98→loader 7.0.13、
  // 21.6.20-beta→loader 9.0.2）移除 @EventBusSubscriber 的 bus 属性，事件按 IModBusEvent 类型自动路由
  const busAttr = compareMcVersion(v.mcVersion, '1.21.6') >= 0 ? '' : ', bus = EventBusSubscriber.Bus.MOD'
  return `package ${v.packageName};

import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;

/**
 * AUTO-GENERATED by KunYu Studio — 由可视化编辑器在生成内容时改写。
 */
@EventBusSubscriber(modid = ${modClassName}.MOD_ID${busAttr}, value = Dist.CLIENT)
public class ${modClassName}Client {

    @SubscribeEvent
    public static void onClientSetup(FMLClientSetupEvent event) {
        // 客户端初始化（渲染器注册由内容生成器在需要时织入）
    }
}
`
}

function modClassNameOf(modId: string): string {
  return `${modId.charAt(0).toUpperCase()}${modId.slice(1)}Mod`
}

/** 资源 JSON 与 Fabric 同构，复用 fabricTemplates 的生成函数 */
export {
  blockModelJson,
  blockStateJson,
  itemModelJson,
  langEnUs
} from './fabricTemplates'
