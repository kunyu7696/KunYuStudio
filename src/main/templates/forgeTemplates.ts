/**
 * Forge 最小可编译模组模板。
 *  - 1.18.2~1.21.1：Mojang 官方映射 + ForgeGradle 5/6，DeferredRegister 注册，
 *    @Mod 主类 + @Mod.EventBusSubscriber 客户端订阅。
 *  - 26.x（FG7 mavenizer 时代，Forge 66.x / Java 25）：插件 [7.0.17,8)，
 *    无 mappings channel/version（mavenizer 直接官方映射），
 *    implementation minecraft.dependency(...) + eventbus-validator 注解处理器，
 *    主类构造器注入 FMLJavaModLoadingContext（ModBusGroup）。
 */
import { isMojangEra, nextMinorMc, type ForgeConstructorStyle } from './loaderVersionMatrix'

export interface ForgeTemplateVars {
  modId: string
  modName: string
  version: string
  packageName: string
  mcVersion: string
  forgeVersion: string
  loomLikeVersion: string // ForgeGradle 版本范围
  gradleVersion: string
  /** 目标 Java 大版本（由版本矩阵注入，不再模板内按版本猜） */
  jdk: 8 | 17 | 21 | 25
  /** 1.20.1-: classic（无参构造器 + FMLJavaModLoadingContext.get()）；
   *  1.20.4+: injected（构造器注入 IEventBus）；
   *  26.x FG7: modbusgroup（构造器注入 FMLJavaModLoadingContext + ModBusGroup） */
  forgeConstructorStyle: ForgeConstructorStyle
}

/** 26.x 模组资源 pack.mcmeta 格式号（官方 forge-26.3 MDK：min/max_format 均为 121） */
export const FORGE_MOJANG_PACK_FORMAT = 121

export const FORGE_DEFAULTS = {
  mcVersion: '1.20.1',
  forgeVersion: '47.4.23',
  forgeGradleRange: '[6.0,6.2)',
  gradleVersion: '8.10.2',
  forgeConstructorStyle: 'classic' as const
}

export function forgeGradleProperties(v: ForgeTemplateVars): string {
  // 26.x FG7：官方 MDK 坐标写死在 build.gradle 的 minecraft.dependency(...) 中，
  // gradle.properties 无版本属性；这里保留 minecraft_version/forge_version 属性
  // 供模板参数化（FG7 同样解析 project 属性），并开启 merge-source-sets（MDK 26.3 默认）
  const fg7Props = isMojangEra(v.mcVersion)
    ? `# ForgeGradle 7：合并主/客户端源集（官方 forge-26.3 MDK 默认项）
net.minecraftforge.gradle.merge-source-sets=true
`
    : ''
  return `# Forge Properties
minecraft_version=${v.mcVersion}
forge_version=${v.forgeVersion}

# Mod Properties
mod_version=${v.version}
maven_group=${v.packageName}
archives_base_name=${v.modId}

# Gradle
org.gradle.jvmargs=-Xmx3G
org.gradle.daemon=false
${fg7Props}`
}

export function forgeBuildGradle(v: ForgeTemplateVars, mirror: 'china' | 'official' = 'china'): string {
  // 26.x：ForgeGradle 7 mavenizer 全新体系（官方 forge-26.3 MDK 逐段对齐）
  if (isMojangEra(v.mcVersion)) {
    const fg7ChinaRepos = mirror === 'china'
      ? `    // 阿里云/BMCLAPI：加速常规 Maven 库（mavenizer 已先行接管 Minecraft 管道）
    maven { url = 'https://maven.aliyun.com/repository/public' }
    maven { url = 'https://bmclapi2.bangbang93.com/maven' }
`
      : ''
    return `plugins {
    id 'java'
    // plugins 块在 project 创建前求值，不支持 \${project.*} 插值，版本必须字面量
    id 'net.minecraftforge.gradle' version '${v.loomLikeVersion}'
}

version = project.mod_version
group = project.maven_group

base {
    archivesName = project.archives_base_name
}

// Mojang 自 26.1 起向终端用户交付 Java 25（官方 MDK 注释）
java.toolchain.languageVersion = JavaLanguageVersion.of(${v.jdk})

// 包含 data run 生成的资源
sourceSets.main.resources { srcDir 'src/generated/resources' }

minecraft {
    // FG7 无 mappings channel/version：mavenizer 直接提供 Mojang 官方映射
    runs {
        configureEach {
            workingDir = project.file('run')
            // S-05：kunyu-observer-agent（javaagent 形态，覆盖全加载器与 MC 全版本）。
            // 主进程在 runClient 前把 agent 路径与令牌写入 gradle.properties，未配置时跳过。
            if (project.findProperty('kunyu.observer.agent')) {
                jvmArgument "-javaagent:\${project.findProperty('kunyu.observer.agent')}=port=9876,token=\${project.findProperty('kunyu.observer.token') ?: ''}"
            }
        }

        register('client')

        register('server') {
            args '--nogui'
        }

        register('data') {
            args '--mod', "\${project.archives_base_name}", '--all',
                '--output', file('src/generated/resources/'),
                '--existing', file('src/main/resources/')
        }
    }
}

repositories {
    // FG7 mavenizer：Minecraft/Mojang 依赖管道，官方 MDK 要求置于首位
    minecraft.mavenizer(it)
${fg7ChinaRepos}    maven fg.forgeMaven
    maven fg.minecraftLibsMaven
    mavenCentral()
}

dependencies {
    implementation minecraft.dependency("net.minecraftforge:forge:\${project.minecraft_version}-\${project.forge_version}")
    annotationProcessor 'net.minecraftforge:eventbus-validator:7.0.6'
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
}

jar {
    manifest {
        attributes([
            'Specification-Title': project.archives_base_name,
            'Specification-Vendor': 'KunYu Studio',
            'Implementation-Version': project.jar.archiveVersion
        ])
    }
}
`
  }
  const repos = mirror === 'china'
    ? `    // 阿里云公共镜像：加速常规 Maven 依赖，须在官方源之前
    maven { url = 'https://maven.aliyun.com/repository/public' }
    // BMCLAPI 镜像：镜像 files.minecraftforge.net/maven、libraries.minecraft.net
    maven { url = 'https://bmclapi2.bangbang93.com/maven' }
    // com.mojang 库只走官方源——BMCLAPI 对部分 Mojang 库返回 403，
    // 且 Gradle 仓库顺序下若 BMCLAPI 先命中坏包不会回退；content includeGroup 强制
    // com.mojang 仅从 libraries.minecraft.net 解析，其余库仍优先 BMCLAPI 加速。
    maven {
      url = 'https://libraries.minecraft.net/'
      content { includeGroup 'com.mojang' }
    }
    // 官方 Forge maven 必须保留（ForgeGradle 插件与 forge 依赖均在此）
    maven { url = 'https://maven.minecraftforge.net/' }
    mavenCentral()`
    : `    // 官方源
    maven { url = 'https://maven.minecraftforge.net/' }
    // com.mojang 库（patchy、brigadier 等）仅在 libraries.minecraft.net
    maven { url = 'https://libraries.minecraft.net/' }
    mavenCentral()`
  // Forge Java 工具链版本由版本矩阵注入（1.16.5=8，1.18.2~1.20.4=17，1.21.1=21）
  const jdk = v.jdk
  // base {} DSL 是 Gradle 7.1+ 引入的；Gradle 6.x（FG4 / 1.16.5）用 archivesBaseName 属性
  const isGradle6 = v.gradleVersion.startsWith('6.')
  const archivesBlock = isGradle6
    ? `archivesBaseName = project.archives_base_name`
    : `base {
    archivesName = project.archives_base_name
}`
  return `plugins {
    id 'java'
    // plugins 块在 project 创建前求值，不支持 \${project.*} 插值，版本必须字面量
    id 'net.minecraftforge.gradle' version '${v.loomLikeVersion}'
}

version = project.mod_version
group = project.maven_group

${archivesBlock}

// Java 工具链：1.16.5=8，1.18.2~1.20.4=17，1.21.1=21
java.toolchain.languageVersion = JavaLanguageVersion.of(${jdk})

minecraft {
    // Mojang 官方映射${isGradle6 ? '（FG4 强转 String，版本必须字面量）' : ''}
    mappings channel: 'official', version: ${isGradle6 ? `'${v.mcVersion}'` : `"\${project.minecraft_version}"`}

${isGradle6
  ? `    // FG4 runs DSL：无 configureEach，mod 名必须字面量标识符（GString 强转 String 会崩）
    runs {
        client {
            workingDirectory project.file('run')
            // S-05：kunyu-observer-agent（javaagent 形态，覆盖全加载器与 MC 全版本）
            if (project.findProperty('kunyu.observer.agent')) {
                jvmArg "-javaagent:\${project.findProperty('kunyu.observer.agent')}=port=9876,token=\${project.findProperty('kunyu.observer.token') ?: ''}"
            }
            mods {
                ${v.modId} {
                    source sourceSets.main
                }
            }
        }

        server {
            workingDirectory project.file('run')
            args '--nogui'
            mods {
                ${v.modId} {
                    source sourceSets.main
                }
            }
        }

        data {
            workingDirectory project.file('run')
            args '--mod', '${v.modId}', '--all',
                '--output', file('src/generated/resources/'),
                '--existing', file('src/main/resources/')
            mods {
                ${v.modId} {
                    source sourceSets.main
                }
            }
        }
    }`
  : `    runs {
        configureEach {
            workingDirectory = project.file('run')
        }

        client {
            // S-05：kunyu-observer-agent（javaagent 形态，覆盖全加载器与 MC 全版本）
            if (project.findProperty('kunyu.observer.agent')) {
                jvmArg "-javaagent:\${project.findProperty('kunyu.observer.agent')}=port=9876,token=\${project.findProperty('kunyu.observer.token') ?: ''}"
            }
            mods { "\${project.archives_base_name}" { source sourceSets.main } }
        }

        server {
            args '--nogui'
            mods { "\${project.archives_base_name}" { source sourceSets.main } }
        }

        data {
            args '--mod', "\${project.archives_base_name}", '--all',
                '--output', file('src/generated/resources/'),
                '--existing', file('src/main/resources/')
            mods { "\${project.archives_base_name}" { source sourceSets.main } }
        }
    }`}
}

repositories {
${repos}
}

dependencies {
${isGradle6
  ? `    // FG4 的 minecraft 依赖方法内部强转 String，GString 插值会崩（M23 探针实测），必须字面量
    minecraft 'net.minecraftforge:forge:${v.mcVersion}-${v.forgeVersion}'`
  : `    minecraft "net.minecraftforge:forge:\${project.minecraft_version}-\${project.forge_version}"`}
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
}

jar {
    manifest {
        attributes([
            'Specification-Title': project.archives_base_name,
            'Specification-Vendor': 'KunYu Studio',
            'Implementation-Version': project.jar.archiveVersion
        ])
    }
}
`
}

export function forgeSettingsGradle(mirror: 'china' | 'official' = 'china', gradleVersion = '8.10.2'): string {
  const extra = mirror === 'china'
    ? `        maven { url = 'https://maven.aliyun.com/repository/gradle-plugin' }\n`
    : ''
  // foojay-resolver 最低要求 Gradle 7.6（M23 探针实测 0.5.0 在 7.5.1 上拒绝应用）：
  // - Gradle < 7.6（FG4 时代 1.16.5）：不发 foojay，JDK 工具链由编译宿主本机满足
  // - Gradle 7.6~8.x：foojay 0.8.0（forge 1.18.2~1.20.4 探针通过）
  // - Gradle 9.x（FG7，forge 1.21.1）：foojay 1.0.0
  const g = gradleVersion.localeCompare('7.6', undefined, { numeric: true }) < 0
    ? null
    : gradleVersion.localeCompare('9.0', undefined, { numeric: true }) < 0 ? '0.8.0' : '1.0.0'
  const foojay = g === null
    ? ''
    : `\nplugins {\n    id 'org.gradle.toolchains.foojay-resolver-convention' version '${g}'\n}\n`
  return `pluginManagement {
    repositories {
        maven { url = 'https://maven.minecraftforge.net/' }
${extra}        mavenCentral()
        gradlePluginPortal()
    }
}
${foojay}
rootProject.name = 'forge-mod'
`
}

/** META-INF/mods.toml（Forge 模组元数据；版本区间全部由版本矩阵参数化） */
export function forgeModsToml(v: ForgeTemplateVars): string {
  // Forge 主版本号即矩阵选定 forgeVersion 的第一段：
  // 1.18.2=40.x / 1.19.2=43.x / 1.20.1=47.x / 1.20.4=49.x / 1.21.1=52.x
  const forgeMajor = v.forgeVersion.split('.')[0] ?? '47'
  // minecraft 区间覆盖同一 minor：下界为选定版本，上界为下一 minor（MDK 惯例）
  const mcUpper = nextMinorMc(v.mcVersion)
  return `modLoader="javafml"
loaderVersion="[${forgeMajor},)"
license="MIT"

[[mods]]
modId="${v.modId}"
version="\${file.jarVersion}"
displayName="${v.modName}"
authors="KunYu Studio"
description='''${v.modName}（由 KunYu Studio 生成）'''

[[dependencies.${v.modId}]]
modId="forge"
mandatory=true
versionRange="[${forgeMajor},)"
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

/** 主类：@Mod + DeferredRegister 注册。
 *  - classic（1.20.1-）：无参构造器 + FMLJavaModLoadingContext.get()
 *  - injected（1.20.4+）：构造器注入 IEventBus（Forge 49.x+ 官方写法）
 *  - modbusgroup（26.x FG7 / Forge 66.x）：构造器注入 FMLJavaModLoadingContext，
 *    DeferredRegister 与 setup 监听统一经 ModBusGroup（官方 forge-26.3 MDK 写法）
 */
export function forgeMainClass(v: ForgeTemplateVars): string {
  const modClassName = modClassNameOf(v.modId)
  const style = v.forgeConstructorStyle
  if (style === 'modbusgroup') {
    return `package ${v.packageName};

import com.mojang.logging.LogUtils;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import ${v.packageName}.registry.ModBlocks;
import ${v.packageName}.registry.ModItems;
import org.slf4j.Logger;

@Mod(${modClassName}.MOD_ID)
public class ${modClassName} {
    public static final String MOD_ID = "${v.modId}";
    public static final Logger LOGGER = LogUtils.getLogger();

    public ${modClassName}(FMLJavaModLoadingContext context) {
        // 26.x（Forge 66.x）：ModBusGroup 统一承载 mod 总线注册
        var modBusGroup = context.getModBusGroup();
        ModBlocks.BLOCKS.register(modBusGroup);
        ModItems.ITEMS.register(modBusGroup);

        FMLCommonSetupEvent.getBus(modBusGroup).addListener(this::commonSetup);
    }

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("KunYu Studio Forge mod initialized");
    }
}
`
  }
  const injected = style === 'injected'
  const ctor = injected
    ? `    public ${modClassName}(IEventBus modEventBus) {
        // DeferredRegister 挂载到 mod 事件总线（构造器注入，Forge 1.20.4+）
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);

        modEventBus.addListener(this::commonSetup);
        MinecraftForge.EVENT_BUS.register(this);
    }`
    : `    public ${modClassName}() {
        IEventBus modEventBus = FMLJavaModLoadingContext.get().getModEventBus();

        // DeferredRegister 挂载到 mod 事件总线
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);

        modEventBus.addListener(this::commonSetup);
        MinecraftForge.EVENT_BUS.register(this);
    }`
  const fmlImport = injected ? '' : 'import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;\n'
  return `package ${v.packageName};

import com.mojang.logging.LogUtils;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
${fmlImport}import ${v.packageName}.registry.ModBlocks;
import ${v.packageName}.registry.ModItems;
import org.slf4j.Logger;

@Mod(${modClassName}.MOD_ID)
public class ${modClassName} {
    public static final String MOD_ID = "${v.modId}";
    public static final Logger LOGGER = LogUtils.getLogger();

${ctor}

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("KunYu Studio Forge mod initialized");
    }
}
`
}

export function forgeModBlocksClass(v: ForgeTemplateVars): string {
  const modClassName = modClassNameOf(v.modId)
  // 26.x：Properties 必须挂 ResourceKey（DeferredRegister.key(name) 提供），
  // 否则注册期抛异常（官方 forge-26.3 MDK ExampleMod L43-48 写法）
  const setId = isMojangEra(v.mcVersion)
    ? `    public static final RegistryObject<Block> EXAMPLE_BLOCK = BLOCKS.register("example_block",
        () -> new Block(BlockBehaviour.Properties.of().setId(BLOCKS.key("example_block"))
            .mapColor(MapColor.STONE)
            .strength(1.5f, 6.0f).sound(net.minecraft.world.level.block.SoundType.STONE)
            .requiresCorrectToolForDrops()));`
    : `    public static final RegistryObject<Block> EXAMPLE_BLOCK = BLOCKS.register("example_block",
        () -> new Block(BlockBehaviour.Properties.of().mapColor(MapColor.STONE)
            .strength(1.5f, 6.0f).sound(net.minecraft.world.level.block.SoundType.STONE)
            .requiresCorrectToolForDrops()));`
  return `package ${v.packageName}.registry;

import ${v.packageName}.${modClassName};
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraft.world.level.material.MapColor;
import net.minecraft.world.level.block.Blocks;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * AUTO-GENERATED by KunYu Studio — 由可视化编辑器在生成内容时改写。
 */
public class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS =
        DeferredRegister.create(ForgeRegistries.BLOCKS, ${modClassName}.MOD_ID);

    // 模板示例方块，可在可视化编辑器中删除
${setId}
}
`
}

export function forgeModItemsClass(v: ForgeTemplateVars): string {
  const modClassName = modClassNameOf(v.modId)
  // 26.x：Item.Properties 同样必须 setId(ResourceKey)（官方 MDK L50-65 写法）
  const setId = isMojangEra(v.mcVersion)
  const blockItemProps = setId
    ? 'new Item.Properties().setId(ITEMS.key("example_block"))'
    : 'new Item.Properties()'
  const itemProps = setId
    ? 'new Item.Properties().setId(ITEMS.key("example_item"))'
    : 'new Item.Properties()'
  return `package ${v.packageName}.registry;

import ${v.packageName}.${modClassName};
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * AUTO-GENERATED by KunYu Studio — 由可视化编辑器在生成内容时改写。
 */
public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
        DeferredRegister.create(ForgeRegistries.ITEMS, ${modClassName}.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_BLOCK_ITEM = ITEMS.register("example_block",
        () -> new BlockItem(ModBlocks.EXAMPLE_BLOCK.get(), ${blockItemProps}));

    public static final RegistryObject<Item> EXAMPLE_ITEM = ITEMS.register("example_item",
        () -> new Item(${itemProps}));
}
`
}

/** 客户端订阅类（对齐 MDK 的 ClientModEvents 静态内部类写法，独立成文件便于织入） */
export function forgeClientClass(v: ForgeTemplateVars): string {
  const modClassName = modClassNameOf(v.modId)
  // 26.x：@SubscribeEvent 迁至 net.minecraftforge.eventbus.api.listener 包；
  // 客户端订阅默认 MOD 总线，官方 MDK 26.3 不再显式写 bus 参数
  const mojang = isMojangEra(v.mcVersion)
  const subscribeImport = mojang
    ? 'import net.minecraftforge.eventbus.api.listener.SubscribeEvent;'
    : 'import net.minecraftforge.eventbus.api.SubscribeEvent;'
  const subscriberAnnotation = mojang
    ? `@Mod.EventBusSubscriber(modid = ${modClassName}.MOD_ID, value = Dist.CLIENT)`
    : `@Mod.EventBusSubscriber(modid = ${modClassName}.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)`
  return `package ${v.packageName};

import net.minecraftforge.api.distmarker.Dist;
${subscribeImport}
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;

/**
 * AUTO-GENERATED by KunYu Studio — 由可视化编辑器在生成内容时改写。
 */
${subscriberAnnotation}
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

/** 26.x 资源包元数据：官方 forge-26.3 MDK 起 pack.mcmeta 改用 min_format/max_format
 *  （不再有 pack_format 数字字段） */
export function forgePackMcmeta(v: ForgeTemplateVars): string {
  return `${JSON.stringify(
    {
      pack: {
        description: `${v.modName} resources`,
        max_format: FORGE_MOJANG_PACK_FORMAT,
        min_format: FORGE_MOJANG_PACK_FORMAT
      }
    },
    null,
    2
  )}\n`
}

/** 资源 JSON 与 Fabric 同构，复用 fabricTemplates 的生成函数（blockstate/model/lang 等） */
export {
  blockModelJson,
  blockStateJson,
  itemModelJson,
  langEnUs
} from './fabricTemplates'
