#!/usr/bin/env node
// ============================================================================
// scripts/gen-loader-templates.mjs
// ----------------------------------------------------------------------------
// 为 KunYuEcosystem AI 参考包生成 Forge 1.20.1 与 NeoForge 1.21.1 两个激活组合
// 的全品类模板文件（与 fabric/1.20.1 的模板条目一一对应），并输出 manifest 片段：
//   resources/ai-reference/manifest.templates.fragment.json
// 条目数不硬编码：以 manifest 中 fabric/1.20.1 的实际条目数为唯一期望来源，
// fabric 扩容而未同步时脚本立刻报缺文件，而不是静默过时。
//
// 用法：node scripts/gen-loader-templates.mjs
// 依赖：仅 Node 内置模块（ESM，无第三方依赖）。不会修改 manifest.json。
// ============================================================================
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const REF_DIR = join(REPO_ROOT, 'resources', 'ai-reference');
const TPL_ROOT = join(REF_DIR, 'templates');
const FRAGMENT_PATH = join(REF_DIR, 'manifest.templates.fragment.json');

const manifest = JSON.parse(readFileSync(join(REF_DIR, 'manifest.json'), 'utf8'));

// ----------------------------------------------------------------------------
// 头部注释工具
// ----------------------------------------------------------------------------
const slashHdr = (ldr, ver, cat, name) =>
    `// ============================================================================\n` +
    `// KunYuEcosystem AI Reference v3.2 | ${ldr}/${ver}/${cat}/${name} | mapping: Mojang official | provenance: adapted from official loader MDK/docs\n` +
    `// ============================================================================\n`;

const hashHdr = (ldr, ver, cat, name) =>
    `# ============================================================================\n` +
    `# KunYuEcosystem AI Reference v3.2 | ${ldr}/${ver}/${cat}/${name} | mapping: Mojang official | provenance: adapted from official loader MDK/docs\n` +
    `# ============================================================================\n`;

const mdHdr = (ldr, ver, cat, name) =>
    `[//]: # (KunYuEcosystem AI Reference v3.2 | ${ldr}/${ver}/${cat}/${name} | mapping: Mojang official | provenance: adapted from official loader MDK/docs)\n\n`;

// 每个 loader 一组：files 存相对路径 -> 内容；J/H/M 分别用 //、#、[//]: # 头
function makeSet(loader, version) {
    const files = {};
    const J = (cat, name, body) => { files[`${cat}/${name}`] = slashHdr(loader, version, cat, name) + body; };
    const H = (cat, name, body) => { files[`${cat}/${name}`] = hashHdr(loader, version, cat, name) + body; };
    const M = (cat, name, body) => { files[`${cat}/${name}`] = mdHdr(loader, version, cat, name) + body; };
    const L = (cat, name, body) => { files[`${cat}/${name}`] = body; }; // LICENSE 等无头文件
    return { loader, version, files, J, H, M, L };
}

const forge = makeSet('forge', '1.20.1');
const { J: FJ, H: FH, M: FM, L: FL } = forge;
const neo = makeSet('neoforge', '1.21.1');
const { J: NJ, H: NH, M: NM, L: NL } = neo;

// ============================================================================
// FORGE 1.20.1（net.minecraftforge.*，DeferredRegister + RegistryObject）
// ============================================================================
FJ('project', 'build.gradle', `// ============================================================================
// build.gradle —— Forge 1.20.1（ForgeGradle 6，Groovy DSL）
// ============================================================================
// 用法要点：
// - ForgeGradle 6 负责拉取 Minecraft/Forge、应用 Mojang 官方映射、生成 runClient/runServer/runData 任务。
// - 版本号抽到 gradle.properties；需要 JDK 17，推荐 Gradle 8.8+（用 gradle wrapper 固定）。
// - 生产环境 jar 仍使用 SRG 名：FG6 会在 jar 之后自动执行 reobfJar 重混淆。
// ============================================================================
plugins {
    // ForgeGradle 6 主插件；区间写法自动匹配 6.0.x ~ 6.1.x
    id 'net.minecraftforge.gradle' version '[6.0,6.2)'
    // 如需发布到 Maven 仓库再启用
    id 'maven-publish'
}
version = project.mod_version
group = project.maven_group

base {
    // 决定 jar 最终名：examplemod-1.0.0.jar
    archivesName = project.archives_base_name
}

repositories {
    mavenCentral()
    // 依赖其它第三方库时在此追加 maven { url = '...' }
}

minecraft {
    // Mojang 官方映射：Forge 1.20.1 开发期唯一映射渠道（channel: official）
    mappings channel: 'official', version: project.minecraft_version
    // 如需访问受保护成员，取消注释并创建对应文件：
    // accessTransformer = file('src/main/resources/META-INF/accesstransformer.cfg')

    runs {
        client {
            workingDirectory project.file('run')
            property 'forge.logging.markers', 'REGISTRIES'
            property 'forge.logging.console.level', 'debug'
            mods { examplemod { source sourceSets.main } }
        }
        server {
            workingDirectory project.file('run')
            property 'forge.logging.markers', 'REGISTRIES'
            property 'forge.logging.console.level', 'debug'
            mods { examplemod { source sourceSets.main } }
        }
        data {
            workingDirectory project.file('run')
            property 'forge.logging.markers', 'REGISTRIES'
            property 'forge.logging.console.level', 'debug'
            // runData：把 JSON（配方/标签/模型等）生成到 src/generated/resources
            args '--mod', 'examplemod', '--all',
                 '--output', file('src/generated/resources/'),
                 '--existing', file('src/main/resources/')
            mods { examplemod { source sourceSets.main } }
        }
    }
}

// 数据生成输出目录并入资源处理
sourceSets.main.resources { srcDir 'src/generated/resources' }

dependencies {
    minecraft "net.minecraftforge:forge:\${project.minecraft_version}-\${project.forge_version}"
}

// Minecraft 1.20.1 需要 Java 17；统一 UTF-8 编译编码
java {
    toolchain { languageVersion = JavaLanguageVersion.of(17) }
    withSourcesJar()
}
tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
    options.release = 17
}

jar {
    finalizedBy 'reobfJar'
    manifest {
        attributes([
            'Specification-Title'   : 'examplemod',
            'Specification-Vendor'  : 'Example Author',
            'Specification-Version' : '1',
            'Implementation-Title'  : project.name,
            'Implementation-Version': project.version,
            'Implementation-Vendor' : 'Example Author'
        ])
    }
}
`);

FH('project', 'settings.gradle', `// ============================================================================
// settings.gradle —— Gradle 插件仓库与项目名
// ============================================================================
// 用法要点：
// - ForgeGradle 6 插件发布在 Forge Maven，必须放在 pluginManagement 首位。
// ============================================================================
pluginManagement {
    repositories {
        // Forge Maven：提供 net.minecraftforge.gradle 插件
        maven { url = 'https://maven.minecraftforge.net/' }
        gradlePluginPortal()
        mavenCentral()
    }
}
plugins {
    // 本机没有匹配 JDK 时自动下载工具链
    id 'org.gradle.toolchains.foojay-resolver-convention' version '0.8.0'
}
// jar 名；与 mods.toml 的 modId 保持一致便于排查
rootProject.name = 'examplemod'
`);

FH('project', 'gradle.properties', `# 用法要点：
# - ForgeGradle 6 构建内存需求较高：-Xmx3G；CI 环境禁用 daemon 更稳定。
# ============================================================================
org.gradle.jvmargs=-Xmx3G
org.gradle.daemon=false
org.gradle.parallel=true

# Mod 元数据（供 build.gradle 读取）
mod_version=1.0.0
maven_group=com.example.examplemod
archives_base_name=examplemod

# 版本对照（与 build.gradle 保持一致）
minecraft_version=1.20.1
forge_version=47.4.23
`);

FH('project', 'mods.toml', `# 用法要点：
# - 实际位置：src/main/resources/META-INF/mods.toml。
# - modLoader=javafml 表示 Java 代码模组；loaderVersion 匹配 Forge 主版本 47。
# - [[mods]] 段声明 modId/version/displayName/description；
#   [[dependencies.<modId>]] 声明对 forge 与 minecraft 的版本约束。
# - 使用 Mixin 时追加 [[mixins]] config="examplemod.mixins.json"。
# ============================================================================
modLoader="javafml"
loaderVersion="[47,)"
license="MIT"
#issueTrackerURL="https://github.com/example/examplemod/issues"

[[mods]]
modId="examplemod"
version="1.0.0"
displayName="Example Mod"
description='''
KunYuEcosystem AI reference scaffold for Forge 1.20.1.
'''
authors="Example Author"
#logoFile="assets/examplemod/logo.png"

[[dependencies.examplemod]]
    modId="forge"
    mandatory=true
    versionRange="[47,)"
    ordering="NONE"
    side="BOTH"

[[dependencies.examplemod]]
    modId="minecraft"
    mandatory=true
    versionRange="[1.20.1,1.21)"
    ordering="NONE"
    side="BOTH"

# 如使用 Mixin，取消注释并把 examplemod.mixins.json 放入 src/main/resources：
# [[mixins]]
# config="examplemod.mixins.json"
`);

FJ('project', 'ModMain.java', `package com.example.examplemod;

import com.example.examplemod.block.ModBlocks;
import com.example.examplemod.entity.ModEntities;
import com.example.examplemod.item.ModItems;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Forge 主入口（1.20.1）。
 * 与 Fabric entrypoint 不同：Forge 通过扫描 @Mod 注解定位主类，构造器即初始化时机。
 */
@Mod("examplemod")
public class ModMain {
    public static final String MOD_ID = "examplemod";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public ModMain() {
        // mod 事件总线：注册 DeferredRegister 与生命周期监听
        IEventBus modEventBus = FMLJavaModLoadingContext.get().getModEventBus();

        // 登记注册表容器（方块/物品/实体等详见各 category 模板）
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);
        ModEntities.ENTITY_TYPES.register(modEventBus);
        // 若使用了 food_item/tool_item/armor_item/spawn_egg_item 等独立模板类，同样需要注册：
        // ModFoods.ITEMS.register(modEventBus);

        modEventBus.addListener(this::commonSetup);
    }

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("Common setup for {}", MOD_ID);
        // 通用端初始化：注册网络包、能力、配方后处理等
    }
}
`);

FJ('project', 'ModClient.java', `package com.example.examplemod;

import com.example.examplemod.client.render.ExampleEntityRenderer;
import com.example.examplemod.entity.ModEntities;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.EntityRenderersEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * 客户端专属注册示例（1.20.1）。
 * Forge 没有 client entrypoint：用 @Mod.EventBusSubscriber(value = Dist.CLIENT) 把本类
 * 挂到 MOD 总线，仅客户端环境加载；渲染器/屏幕/按键绑定都在这里注册。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public class ModClient {

    @SubscribeEvent
    public static void onRegisterRenderers(EntityRenderersEvent.RegisterRenderers event) {
        // 实体渲染器（详见 entity/entity_renderer.java）
        event.registerEntityRenderer(ModEntities.EXAMPLE_ENTITY.get(), ExampleEntityRenderer::new);
        // 屏幕注册见 gui/screen_with_menu.java（FMLClientSetupEvent 中 MenuScreens.register）
    }
}
`);

FJ('project', 'ModServer.java', `package com.example.examplemod;

import net.minecraftforge.event.server.ServerStartingEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * 服务端事件订阅示例（1.20.1）。
 * 与 Fabric 的 DedicatedServerModInitializer 不同，Forge 没有独立 server 入口：
 * 服务端逻辑一律通过事件监听实现。本类未标注 Dist，客户端与专用服务器都会加载，
 * 需要区分环境时可用 FMLEnvironment.dist 或 event.getServer().isDedicatedServer()。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID) // 默认挂在 MinecraftForge.EVENT_BUS（game 总线）
public class ModServer {

    @SubscribeEvent
    public static void onServerStarting(ServerStartingEvent event) {
        ModMain.LOGGER.info("Server starting: dedicated={}", event.getServer().isDedicatedServer());
        // 服务端初始化：注册跨端数据、启动定时任务等
    }

    @SubscribeEvent
    public static void onServerStopping(ServerStoppingEvent event) {
        ModMain.LOGGER.info("Server stopping");
    }
}
`);

FM('project', 'README.md', `# Forge 1.20.1 项目脚手架

KunYuEcosystem AI 参考包——Forge 1.20.1（Mojang 官方映射 / ForgeGradle 6）项目模板说明。

## 目录结构

    project/
    ├── build.gradle          # ForgeGradle 6 构建脚本（Groovy DSL）
    ├── settings.gradle       # 插件仓库（Forge Maven）+ 项目名
    ├── gradle.properties     # 版本与构建参数
    ├── mods.toml             # 说明版 META-INF/mods.toml（发布时放到 src/main/resources/META-INF/）
    ├── LICENSE               # MIT 许可证
    ├── README.md             # 本文件
    └── src/main/
        ├── resources/META-INF/mods.toml
        └── java/com/example/examplemod/
            ├── ModMain.java      # @Mod 主入口（通用端）
            ├── ModClient.java    # 客户端事件订阅（Dist.CLIENT）
            └── ModServer.java    # 服务端事件订阅示例（Forge 无独立 server 入口）

## 文件说明

| 文件 | 作用 |
| --- | --- |
| build.gradle | ForgeGradle 6 拉取 Minecraft/Forge、official 映射、client/server/data 三个 run 配置、UTF-8 编译与 jar 最终名 |
| settings.gradle | pluginManagement 声明 Forge Maven 与 foojay 工具链解析器；rootProject.name 决定 jar 名 |
| gradle.properties | 构建内存 -Xmx3G、daemon=false、mod_version / minecraft_version / forge_version |
| mods.toml | modId=examplemod，[[mods]] 与 [[dependencies.examplemod]]（forge [47,)、minecraft [1.20.1,1.21)） |
| ModMain.java | @Mod 主类；构造器中把各 DeferredRegister 登记到 mod 事件总线，并监听 FMLCommonSetupEvent |
| ModClient.java | @Mod.EventBusSubscriber(Dist.CLIENT)：EntityRenderersEvent.RegisterRenderers 注册渲染器 |
| ModServer.java | 服务端事件订阅示例：ServerStartingEvent / ServerStoppingEvent |

## 版本对照

| 组件 | 版本 |
| --- | --- |
| Minecraft | 1.20.1 |
| Forge | 47.4.23 |
| ForgeGradle | [6.0,6.2) |
| Java | 17 |
| Gradle | 8.8+（建议用 wrapper 固定） |

## 快速开始

    cd project
    gradle wrapper --gradle-version 8.8
    ./gradlew runClient      # 启动客户端
    ./gradlew runServer      # 启动专用服务器
    ./gradlew build          # 构建 examplemod-1.0.0.jar（生产 jar 由 reobfJar 重混淆）

## 与 Fabric 的入口差异

- 入口：@Mod("examplemod") 主类构造器 + FMLJavaModLoadingContext.get().getModEventBus()。
- 客户端：@Mod.EventBusSubscriber(value = Dist.CLIENT) 或 FMLClientSetupEvent，无独立 entrypoint。
- 服务端：无独立入口，监听 ServerStartingEvent 等事件。
- 模组描述文件：META-INF/mods.toml（TOML 格式，非 fabric.mod.json）。

## 改名清单

1. settings.gradle → rootProject.name；gradle.properties → archives_base_name。
2. mods.toml → modId、displayName、description、versionRange。
3. 所有模板文件中的包名 com.example.examplemod → 你的包名；MOD_ID → 你的 modId。
4. gradle.properties → maven_group / mod_version。
5. build.gradle → Forge 版本号（forge_version）。
`);

FL('project', 'LICENSE', `MIT License

Copyright (c) 2026 KunYuEcosystem example mod template contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);

FJ('advancement', 'advancement.json', `{
    // ============================================================
    // 进度/成就 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/advancements/example_advancement.json
    // 原版数据包格式，与加载器无关；Forge 也可用 runData 的 AdvancementProvider 生成。
    // 注意：1.20.1 的 inventory_changed 条件里物品谓词字段是 "items"。
    // ============================================================
    // 父进度决定树形展示位置；根进度可用 display.background 设背景
    "parent": "examplemod:example/root",
    "display": {
        "icon": {
            "item": "examplemod:example_item"
        },
        // 标题/描述建议走翻译键（assets/examplemod/lang/en_us.json）
        "title": {
            "translate": "advancements.examplemod.example.title"
        },
        "description": {
            "translate": "advancements.examplemod.example.description"
        },
        // frame: task（普通）/ goal（目标）/ challenge（挑战）
        "frame": "task",
        "show_toast": true,
        "announce_to_chat": true,
        "hidden": false
        // 根进度可加："background": "minecraft:textures/block/stone.png"
    },
    // criteria：达成条件集合；requirements 描述它们之间的 AND/OR 关系
    "criteria": {
        "get_example_item": {
            "trigger": "minecraft:inventory_changed",
            "conditions": {
                "items": [
                    {
                        "items": [
                            "examplemod:example_item"
                        ]
                    }
                ]
            }
        },
        "another_condition": {
            "trigger": "minecraft:location",
            "conditions": {
                "player": {
                    "location": {
                        "dimension": "minecraft:overworld"
                    }
                }
            }
        }
    },
    // 本例：两个条件需同时满足（AND）；OR 则写成 [[a, b]]
    "requirements": [
        ["get_example_item"],
        ["another_condition"]
    ],
    "rewards": {
        "experience": 10,
        "loot": [
            "examplemod:example_loot_table"
        ],
        "function": "examplemod:grant_example_reward"
    }
}
`);

FJ('block', 'simple_block.java', `package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 方块注册（Forge 1.20.1）。
 * 惯用写法：DeferredRegister + RegistryObject，在主类构造器中 BLOCKS.register(modEventBus)。
 */
public class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS =
            DeferredRegister.create(ForgeRegistries.BLOCKS, ModMain.MOD_ID);

    public static final RegistryObject<Block> EXAMPLE_BLOCK = BLOCKS.register("example_block",
            () -> new Block(BlockBehaviour.Properties.of()
                    .strength(1.5f, 6.0f)                 // 硬度 1.5，爆炸抗性 6.0
                    .sound(SoundType.STONE)
                    .requiresCorrectToolForDrops()));     // 需要正确工具才掉落

    // 方块通常需要配套 BlockItem 才能进物品栏/背包（见 item/simple_item.java）：
    // public static final RegistryObject<Item> EXAMPLE_BLOCK_ITEM =
    //         ModItems.ITEMS.register("example_block",
    //                 () -> new BlockItem(EXAMPLE_BLOCK.get(), new Item.Properties()));
}
`);

FJ('block', 'block_entity.java', `package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 方块实体注册（Forge 1.20.1）。
 * 要点：
 * - DeferredRegister<BlockEntityType<?>> 挂到 ForgeRegistries.BLOCK_ENTITY_TYPES。
 * - BlockEntityType.Builder.of(构造引用, 关联方块).build(null)：1.20.1 中 Type 参数传 null。
 * - 数据读写用 saveAdditional/load（1.20.x 命名），务必先调用 super。
 */
public class ModBlockEntities {
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(ForgeRegistries.BLOCK_ENTITY_TYPES, ModMain.MOD_ID);

    public static final RegistryObject<BlockEntityType<ExampleBlockEntity>> EXAMPLE_BLOCK_ENTITY =
            BLOCK_ENTITIES.register("example_block_entity",
                    () -> BlockEntityType.Builder.of(ExampleBlockEntity::new, ModBlocks.EXAMPLE_BLOCK.get())
                            .build(null));

    /** 示例方块实体：计数器持久化。 */
    public static class ExampleBlockEntity extends BlockEntity {
        private int counter = 0;

        public ExampleBlockEntity(BlockPos pos, BlockState state) {
            super(ModBlockEntities.EXAMPLE_BLOCK_ENTITY.get(), pos, state);
        }

        public void increment() {
            this.counter++;
            setChanged(); // 标记脏数据，触发保存
        }

        @Override
        protected void saveAdditional(CompoundTag tag) {
            super.saveAdditional(tag);
            tag.putInt("counter", this.counter);
        }

        @Override
        public void load(CompoundTag tag) {
            super.load(tag);
            this.counter = tag.getInt("counter");
        }
    }
}
`);

FJ('block', 'blockstate.json', `{
  // ================================================================
  // 方块状态 JSON（Forge 1.20.1）
  // ================================================================
  // 位置：src/main/resources/assets/examplemod/blockstates/example_block.json
  // 作用：把 BlockState 组合映射到模型；加载器无关，两种 mod 通用。
  // ================================================================
  "variants": {
    // "" 表示该方块的默认状态（未声明任何属性时）
    // "model" 指向 assets/examplemod/models/block/example_block.json
    "": {
      "model": "examplemod:block/example_block"
    }
    // 有朝向属性时可写：
    // "facing=north": { "model": "examplemod:block/example_block" },
    // "facing=east":  { "model": "examplemod:block/example_block", "y": 90 },
    // "facing=south": { "model": "examplemod:block/example_block", "y": 180 },
    // "facing=west":  { "model": "examplemod:block/example_block", "y": 270 }
  }
}
`);

FJ('block', 'model.json', `{
  // ================================================================
  // 方块模型 JSON（Forge 1.20.1）
  // ================================================================
  // 位置：src/main/resources/assets/examplemod/models/block/example_block.json
  // 由 blockstate.json 的 "model" 引用；加载器无关。
  // ================================================================
  // parent 决定基础形状；cube_all 只需一个 "all" 贴图
  "parent": "block/cube_all",
  // 贴图名 "examplemod:block/example_block" 对应
  // assets/examplemod/textures/block/example_block.png
  "textures": {
    "all": "examplemod:block/example_block"
  }
  // 六面不同贴图时改用 parent "block/cube"：
  // "textures": {
  //   "up": "examplemod:block/example_block_top",
  //   "down": "examplemod:block/example_block_bottom",
  //   "north": "examplemod:block/example_block_side",
  //   "south": "examplemod:block/example_block_side",
  //   "east": "examplemod:block/example_block_side",
  //   "west": "examplemod:block/example_block_side"
  // }
}
`);

FJ('block', 'loot_table.json', `{
  // ================================================================
  // 方块掉落物 JSON（Forge 1.20.1）
  // ================================================================
  // 位置：src/main/resources/data/examplemod/loot_tables/blocks/example_block.json
  // 结构：alternatives（时序选择）→ 有精准采集时掉自身，否则正常掉落。
  // ================================================================
  "type": "minecraft:block",
  "pools": [
    {
      "rolls": 1,
      "bonus_rolls": 0,
      "entries": [
        {
          // alternatives：取第一个满足条件的子项
          "type": "minecraft:alternatives",
          "children": [
            {
              "type": "minecraft:item",
              "name": "examplemod:example_block",
              // 精准采集时掉自身
              "conditions": [
                {
                  "condition": "minecraft:match_tool",
                  "predicate": {
                    "enchantments": [
                      { "enchantment": "minecraft:silk_touch", "levels": { "min": 1 } }
                    ]
                  }
                }
              ]
            },
            {
              // 无精准采集时也掉自身；想掉其它物品改 "name" 即可
              "type": "minecraft:item",
              "name": "examplemod:example_block"
            }
          ]
        }
      ],
      // 掉落数量函数；可改为 { "min": 1, "max": 3 }
      "functions": [
        { "function": "minecraft:set_count", "count": 1 }
      ]
    }
  ]
}
`);

FJ('item', 'simple_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Rarity;
import net.minecraftforge.event.BuildCreativeModeTabContentsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 普通物品注册（Forge 1.20.1）。
 * 要点：
 * - DeferredRegister.create(ForgeRegistries.ITEMS, MODID) + RegistryObject。
 * - 1.20.1 物品默认不进任何创造栏：用 BuildCreativeModeTabContentsEvent（MOD 总线）添加。
 */
public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_ITEM = ITEMS.register("example_item",
            () -> new Item(new Item.Properties()
                    .stacksTo(64)
                    .rarity(Rarity.COMMON)));

    // 创造栏添加（MOD 总线，可放在本类或 ModClient）：
    // @Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)
    // public static class CreativeTabHandler {
    //     @SubscribeEvent
    //     public static void onBuildCreativeTabs(BuildCreativeModeTabContentsEvent event) {
    //         if (event.getTabKey() == CreativeModeTabs.INGREDIENTS) {
    //             event.accept(EXAMPLE_ITEM);
    //         }
    //     }
    // }
}
`);

FJ('item', 'food_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.Item;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 食物物品（Forge 1.20.1）。
 * 要点：
 * - Item.Properties().food(FoodProperties)；Builder 支持 nutrition/saturationMod/alwaysEat/effect。
 * - effect 传 Supplier 是 Forge 扩展，可避免过早初始化药水注册表。
 * - 独立 DeferredRegister：记得在主类构造器追加 FOODS.register(modEventBus)。
 */
public class ModFoods {
    public static final DeferredRegister<Item> FOODS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_FOOD = FOODS.register("example_food",
            () -> new Item(new Item.Properties()
                    .food(new FoodProperties.Builder()
                            .nutrition(4)          // 饥饿值 +4
                            .saturationMod(0.6f)   // 饱和度系数 0.6
                            .effect(() -> new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 200, 0), 1.0f)
                            .alwaysEat()           // 不饿也能吃
                            .build())));
}
`);

FJ('item', 'tool_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.Item; // 补齐缺失 import：下方使用了 Item.Properties
import net.minecraft.world.item.PickaxeItem;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.Tiers;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 工具物品（Forge 1.20.1）。
 * 要点：
 * - 镐：PickaxeItem(Tier, 攻击伤害增量, 攻速修正, Item.Properties)；1.20.1 仍是 Tier 体系。
 * - Tier 用原版 Tiers（WOOD/STONE/IRON/DIAMOND/NETHERITE/GOLD）或自定义 Tier 实现。
 * - 剑：new SwordItem(Tiers.IRON, 3, -2.4f, props)；斧/铲同理（AxeItem/ShovelItem）。
 * - 独立 DeferredRegister：记得在主类构造器追加 TOOLS.register(modEventBus)。
 */
public class ModTools {
    public static final DeferredRegister<Item> TOOLS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<PickaxeItem> EXAMPLE_PICKAXE = TOOLS.register("example_pickaxe",
            () -> new PickaxeItem(Tiers.IRON, 1, -2.8f, new Item.Properties()));

    public static final RegistryObject<SwordItem> EXAMPLE_SWORD = TOOLS.register("example_sword",
            () -> new SwordItem(Tiers.IRON, 3, -2.4f, new Item.Properties()));
}
`);

FJ('item', 'armor_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterials;
import net.minecraft.world.item.Item; // 补齐缺失 import：下方使用了 Item.Properties
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 盔甲物品（Forge 1.20.1）。
 * 要点：
 * - 1.20.1 构造：ArmorItem(ArmorMaterial, ArmorItem.Type, Item.Properties)。
 *   Type 取 HELMET/CHESTPLATE/LEGGINGS/BOOTS；材质用原版 ArmorMaterials 或自定义 ArmorMaterial。
 * - 盔甲层贴图：assets/examplemod/textures/models/armor/example_layer_1.png（裤甲 _layer_2）。
 * - 1.21.2+ 材质/类型改到 net.minecraft.world.item.armor 包，本模板按 1.20.1 写法。
 * - 独立 DeferredRegister：记得在主类构造器追加 ARMORS.register(modEventBus)。
 */
public class ModArmors {
    public static final DeferredRegister<Item> ARMORS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<ArmorItem> EXAMPLE_CHESTPLATE = ARMORS.register("example_chestplate",
            () -> new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.CHESTPLATE, new Item.Properties()));
}
`);

FJ('item', 'model.json', `{
  "//": [
    "物品模型 JSON —— Forge 1.20.1（加载器无关）",
    "位置：assets/<modid>/models/item/<item_name>.json",
    "示例：example_item 对应 assets/examplemod/models/item/example_item.json",
    "贴图：assets/examplemod/textures/item/example_item.png",
    "parent 常用值：item/generated（普通平面物品）/ item/handheld（工具武器）",
    "layer0 指向贴图，不含 .png；可叠加 layer1/layer2 做多层贴图"
  ],
  "parent": "item/generated",
  "textures": {
    "layer0": "examplemod:item/example_item"
  }
}
`);

FJ('entity', 'simple_entity.java', `package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.level.Level;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.RegistryObject;

/**
 * 实体注册（Forge 1.20.1）。
 * 要点：
 * - 原版注册表用 Registries.ENTITY_TYPE 键：DeferredRegister.create(Registries.ENTITY_TYPE, MODID)。
 * - EntityType.Builder.of(工厂, MobCategory).sized(宽, 高).build("名字")；
 *   build 的字符串用于数据修复器，与注册名一致即可。
 * - 属性必须经 EntityAttributeCreationEvent 注册（见 entity_attribute.java），否则生成实体即崩溃。
 */
public class ModEntities {
    public static final DeferredRegister<EntityType<?>> ENTITY_TYPES =
            DeferredRegister.create(Registries.ENTITY_TYPE, ModMain.MOD_ID);

    public static final RegistryObject<EntityType<ExampleEntity>> EXAMPLE_ENTITY =
            ENTITY_TYPES.register("example_entity",
                    () -> EntityType.Builder.of(ExampleEntity::new, MobCategory.CREATURE)
                            .sized(0.6f, 1.8f)   // 碰撞箱：宽 0.6，高 1.8
                            .build("example_entity"));

    /** 示例生物：陆生被动型。 */
    public static class ExampleEntity extends PathfinderMob {
        public ExampleEntity(EntityType<? extends PathfinderMob> type, Level level) {
            super(type, level);
        }

        /** 属性构建器，供 EntityAttributeCreationEvent 使用。 */
        public static AttributeSupplier.Builder createAttributes() {
            return PathfinderMob.createMobAttributes()
                    .add(Attributes.MAX_HEALTH, 20.0)
                    .add(Attributes.MOVEMENT_SPEED, 0.25)
                    .add(Attributes.ATTACK_DAMAGE, 3.0)
                    .add(Attributes.FOLLOW_RANGE, 16.0);
        }

        @Override
        protected void registerGoals() {
            // 添加 AI Goal：WaterAvoidingRandomStrollGoal、LookAtPlayerGoal、PanicGoal 等
        }
    }
}
`);

FJ('entity', 'entity_attribute.java', `package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraftforge.event.entity.EntityAttributeCreationEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * 实体属性注册（Forge 1.20.1）。
 * Forge 没有 FabricDefaultAttributeRegistry：监听 MOD 总线的 EntityAttributeCreationEvent，
 * 在 event.put(EntityType, AttributeSupplier) 中登记属性；漏掉会在实体生成时抛 NPE。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)
public class ModEntityAttributes {

    @SubscribeEvent
    public static void onEntityAttributeCreation(EntityAttributeCreationEvent event) {
        event.put(ModEntities.EXAMPLE_ENTITY.get(),
                ModEntities.ExampleEntity.createAttributes().build());
        // 多个实体继续 event.put(...) 即可
    }
}
`);

FJ('entity', 'spawn_egg_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.world.item.Item;
import net.minecraftforge.common.ForgeSpawnEggItem;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 刷怪蛋（Forge 1.20.1）。
 * 要点：
 * - ForgeSpawnEggItem(Supplier<EntityType<? extends Mob>>, 底色, 斑点色, Item.Properties)。
 * - Supplier 延迟取值：注册阶段实体尚未就绪也不会 NPE。
 * - 创造栏见 item/simple_item.java 的 BuildCreativeModeTabContentsEvent 示例。
 * - 独立 DeferredRegister：记得在主类构造器追加 SPAWN_EGGS.register(modEventBus)。
 */
public class ModSpawnEggItems {
    public static final DeferredRegister<Item> SPAWN_EGGS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<ForgeSpawnEggItem> EXAMPLE_SPAWN_EGG =
            SPAWN_EGGS.register("example_spawn_egg",
                    () -> new ForgeSpawnEggItem(() -> ModEntities.EXAMPLE_ENTITY.get(),
                            0xFFFFFF,   // 底色
                            0x000000,   // 斑点色
                            new Item.Properties()));
}
`);

FJ('entity', 'entity_renderer.java', `package com.example.examplemod.client.render;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.ResourceLocation;

/**
 * 实体渲染器（Forge 1.20.1，Mojmap）。
 * 要点：
 * - 继承 MobRenderer<实体, 模型>，构造器调 super(context, model, shadowRadius)。
 * - 贴图：assets/examplemod/textures/entity/example_entity.png，getTextureLocation 返回 ResourceLocation。
 * - 注册在 MOD 总线的 EntityRenderersEvent.RegisterRenderers 中完成（见 project/ModClient.java）。
 * - 无自定义模型时可复用原版模型层：ModelLayers.PLAYER / COW / CHICKEN 等。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, HumanoidModel<ModEntities.ExampleEntity>> {
    private static final ResourceLocation TEXTURE =
            new ResourceLocation(ModMain.MOD_ID, "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererProvider.Context context) {
        super(context, new HumanoidModel<>(context.bakeLayer(ModelLayers.PLAYER)), 0.5f);
    }

    @Override
    public ResourceLocation getTextureLocation(ModEntities.ExampleEntity entity) {
        return TEXTURE;
    }
}
`);

FJ('command', 'simple_command.java', `package com.example.examplemod.command;

import com.example.examplemod.ModMain;
import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * 指令注册（Forge 1.20.1）。
 * 要点：
 * - 监听游戏总线的 RegisterCommandsEvent，用 Brigadier literal/argument 搭建指令树。
 * - requires 控制权限（2 = OP），executes 返回值即指令结果码。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID) // 默认 game 总线
public class ModCommands {

    @SubscribeEvent
    public static void onRegisterCommands(RegisterCommandsEvent event) {
        event.getDispatcher().register(
                Commands.literal("example")                       // /example <value>
                        .requires(source -> source.hasPermission(2))
                        .then(Commands.argument("value", IntegerArgumentType.integer(0))
                                .executes(ctx -> {
                                    int value = IntegerArgumentType.getInteger(ctx, "value");
                                    ctx.getSource().sendSuccess(
                                            () -> Component.literal("example value = " + value), false);
                                    return Command.SINGLE_SUCCESS;
                                }))
        );
    }
}
`);

FJ('enchantment', 'custom_enchantment.java', `package com.example.examplemod.enchantment;

import com.example.examplemod.ModMain;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentCategory;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 自定义附魔（Forge 1.20.1）。
 * 要点：
 * - 1.20.1 附魔仍是 Java 类：继承 Enchantment，构造 (Rarity, EnchantmentCategory, EquipmentSlot...)。
 * - getMinCost/getMaxCost 决定附魔台消耗；getMaxLevel 最大等级；checkCompatibility 控制可否叠加。
 * - 名称翻译键：enchantment.examplemod.example_enchantment（assets/examplemod/lang/en_us.json）。
 * - 注意：1.21+ 已改为数据驱动 JSON（见 neoforge 模板 enchantment/custom_enchantment.json）。
 */
public class ModEnchantments {
    public static final DeferredRegister<Enchantment> ENCHANTMENTS =
            DeferredRegister.create(ForgeRegistries.ENCHANTMENTS, ModMain.MOD_ID);

    public static final RegistryObject<Enchantment> EXAMPLE_ENCHANTMENT =
            ENCHANTMENTS.register("example_enchantment", ExampleEnchantment::new);

    public static class ExampleEnchantment extends Enchantment {
        public ExampleEnchantment() {
            super(Enchantment.Rarity.RARE, EnchantmentCategory.WEAPON, EquipmentSlot.MAINHAND);
        }

        @Override
        public int getMinCost(int level) {
            return 10 + (level - 1) * 15;   // 1 级 10，2 级 25，3 级 40
        }

        @Override
        public int getMaxCost(int level) {
            return getMinCost(level) + 50;
        }

        @Override
        public int getMaxLevel() {
            return 3;
        }

        @Override
        public boolean checkCompatibility(Enchantment other) {
            // 例：与锋利互斥 —— return other != Enchantments.SHARPNESS && super.checkCompatibility(other);
            return super.checkCompatibility(other);
        }

        @Override
        public boolean canEnchant(ItemStack stack) {
            return super.canEnchant(stack);
        }
    }
}
`);

FJ('gui', 'simple_screen.java', `package com.example.examplemod.gui;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * 普通屏幕（Forge 1.20.1，Mojmap）。
 * 要点：
 * - 继承 net.minecraft.client.gui.screens.Screen；控件在 init() 中创建（窗口缩放时会重新调用）。
 * - 1.20.1 render 签名：render(GuiGraphics, int, int, float)；先 renderBackground 再 super.render。
 * - 打开方式：Minecraft.getInstance().setScreen(new ExampleScreen())；仅客户端可用。
 */
public class ExampleScreen extends Screen {
    private EditBox inputBox;

    public ExampleScreen() {
        super(Component.literal("Example Screen"));
    }

    @Override
    protected void init() {
        // 文本输入框
        this.inputBox = new EditBox(this.font, this.width / 2 - 100, this.height / 2 - 40, 200, 20,
                Component.literal("input"));
        this.inputBox.setMaxLength(50);
        this.addRenderableWidget(this.inputBox);

        // 按钮：Button.builder(文本, 回调).bounds(x, y, 宽, 高).build()
        this.addRenderableWidget(Button.builder(Component.literal("OK"), button -> {
                    System.out.println("input = " + this.inputBox.getValue());
                    this.onClose(); // 关闭屏幕（等价 Fabric 的 close()）
                })
                .bounds(this.width / 2 - 100, this.height / 2, 200, 20)
                .build());
    }

    @Override
    public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(guiGraphics);
        super.render(guiGraphics, mouseX, mouseY, partialTick);
        guiGraphics.drawCenteredString(this.font, this.title, this.width / 2, 20, 0xFFFFFF);
    }

    @Override
    public boolean isPauseScreen() {
        return false; // 单人游戏中打开此界面不暂停
    }
}
`);

FJ('gui', 'screen_with_menu.java', `package com.example.examplemod.gui;

import com.example.examplemod.ModMain;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.Container;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.common.extensions.IForgeMenuType;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 容器界面（Forge 1.20.1）。
 * 要点：
 * - 菜单：MenuType 用 IForgeMenuType.create(工厂) 创建，工厂签名 (int id, Inventory inv, FriendlyByteBuf buf)。
 * - 屏幕：AbstractContainerScreen<Menu>，实现 renderBg 绘制背景贴图。
 * - 客户端注册屏幕：FMLClientSetupEvent（MOD 总线）中
 *   MenuScreens.register(ModMenus.EXAMPLE_MENU.get(), ModMenus.ExampleMenuScreen::new);
 * - 屏幕类仅客户端可用，实际项目建议放到 client 包并只在客户端环境加载。
 */
public class ModMenus {
    public static final DeferredRegister<MenuType<?>> MENUS =
            DeferredRegister.create(ForgeRegistries.MENU_TYPES, ModMain.MOD_ID);

    public static final RegistryObject<MenuType<ExampleMenu>> EXAMPLE_MENU =
            MENUS.register("example_menu", () -> IForgeMenuType.create(ExampleMenu::new));

    /** 菜单（服务端/客户端共用）。 */
    public static class ExampleMenu extends AbstractContainerMenu {
        private static final int CONTAINER_SIZE = 9;

        /** 网络打开：服务端 openMenu 时由 IForgeMenuType 工厂进入。 */
        public ExampleMenu(int containerId, Inventory playerInventory, FriendlyByteBuf buf) {
            this(containerId, playerInventory, new SimpleContainer(CONTAINER_SIZE));
        }

        /** 直接打开：BlockEntity 等持有真实容器时使用。 */
        public ExampleMenu(int containerId, Inventory playerInventory, Container container) {
            super(ModMenus.EXAMPLE_MENU.get(), containerId);
            checkContainerSize(container, CONTAINER_SIZE);
            container.startOpen(playerInventory.player);
            // 容器槽位：3x3
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 3; col++) {
                    this.addSlot(new Slot(container, col + row * 3, 8 + col * 18, 18 + row * 18));
                }
            }
            // 玩家背包 3x9 + 快捷栏
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(playerInventory, col + row * 9 + 9, 8 + col * 18, 84 + row * 18));
                }
            }
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(playerInventory, col, 8 + col * 18, 142));
            }
        }

        @Override
        public ItemStack quickMoveStack(Player player, int index) {
            // 按需实现 shift 点击转移逻辑
            return ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(Player player) {
            // 实际项目应校验距离：player.distanceToSqr(worldPosition.getX()+0.5, ...) <= 64
            return true;
        }
    }

    /** 屏幕（仅客户端）。 */
    public static class ExampleMenuScreen extends AbstractContainerScreen<ExampleMenu> {
        private static final ResourceLocation TEXTURE =
                new ResourceLocation(ModMain.MOD_ID, "textures/gui/example_menu.png");

        public ExampleMenuScreen(ExampleMenu menu, Inventory playerInventory, Component title) {
            super(menu, playerInventory, title);
            this.imageWidth = 176;   // 背景宽
            this.imageHeight = 166;  // 背景高
        }

        @Override
        protected void renderBg(GuiGraphics guiGraphics, float partialTick, int mouseX, int mouseY) {
            guiGraphics.blit(TEXTURE, this.leftPos, this.topPos, 0, 0, this.imageWidth, this.imageHeight);
        }

        @Override
        public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
            this.renderBackground(guiGraphics);
            super.render(guiGraphics, mouseX, mouseY, partialTick);
            this.renderTooltip(guiGraphics, mouseX, mouseY);
        }
    }
}
`);

FJ('mixin', 'inject_mixin.java', `package com.example.examplemod.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * @Inject Mixin 示例（Forge 1.20.1）。
 * Forge 同样使用 SpongePowered Mixin；method 直接写 Mojang 官方映射方法名（无 SRG 前缀）。
 * @At 常用注入点：HEAD / RETURN / TAIL / INVOKE；有返回值的方法用 CallbackInfoReturnable。
 * 注册：把 mixin_config.json（examplemod.mixins.json）在 mods.toml 中声明。
 */
@Mixin(Minecraft.class)
public class ExampleInjectMixin {

    @Inject(method = "tick", at = @At("HEAD"), cancellable = true)
    private void onTickStart(CallbackInfo ci) {
        // 每 tick 开始前调用；ci.cancel() 可跳过原逻辑（建议仅在 HEAD 使用）
    }

    @Inject(method = "tick", at = @At("TAIL"))
    private void onTickEnd(CallbackInfo ci) {
        // 每 tick 结束后调用
    }

    @Inject(method = "getFps", at = @At("RETURN"), cancellable = true)
    private void onGetFps(CallbackInfoReturnable<Integer> cir) {
        // cir.setReturnValue(...) 可替换返回值；cir.getReturnValue() 读原值
    }
}
`);

FJ('mixin', 'modify_arg_mixin.java', `package com.example.examplemod.mixin;

import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/**
 * @ModifyArg Mixin 示例（Forge 1.20.1）。
 * 用途：拦截方法体内某一次调用的单个参数并替换。
 * target 需写 JVM 描述符（Mojang 官方映射类名）：
 *   Lnet/minecraft/client/gui/GuiGraphics;drawCenteredString(Lnet/minecraft/client/gui/Font;Lnet/minecraft/network/chat/Component;III)V
 * 参数序号从 0 起：font=0, text=1, x=2, y=3, color=4。
 */
@Mixin(TitleScreen.class)
public class ExampleModifyArgMixin {

    @ModifyArg(
            method = "render",
            at = @At(
                    value = "INVOKE",
                    target = "Lnet/minecraft/client/gui/GuiGraphics;drawCenteredString(Lnet/minecraft/client/gui/Font;Lnet/minecraft/network/chat/Component;III)V"
            ),
            index = 4   // 颜色参数
    )
    private int modifyTitleColor(int originalColor) {
        return 0xFF5555; // 改成红色
    }
}
`);

FJ('mixin', 'mixin_config.json', `{
    // ============================================================
    // Mixin 配置 - Forge 1.20.1
    // ============================================================
    // 实际位置：src/main/resources/examplemod.mixins.json
    // 注册方式：mods.toml 中添加
    //   [[mixins]]
    //   config="examplemod.mixins.json"
    // refmap 由 Mixin 注解处理器在构建期生成（ForgeGradle 已自动配置）。
    // ============================================================
    "required": true,
    "package": "com.example.examplemod.mixin",
    "compatibilityLevel": "JAVA_17",
    "refmap": "examplemod.refmap.json",
    // 通用端 Mixin（不含 Client/Server 前缀类）
    "mixins": [
        "ExampleInjectMixin",
        "ExampleModifyArgMixin"
    ],
    // 仅客户端 Mixin
    "client": [
    ],
    "injectors": {
        // defaultRequire=1：注入点不匹配时报错而非静默跳过
        "defaultRequire": 1
    }
}
`);

FJ('recipe', 'shaped_recipe.json', `{
    // ============================================================
    // 有序合成 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/recipes/shaped_recipe.json
    // crafting_shaped：pattern 定形状，key 定符号对应的材料。
    // ============================================================
    "type": "minecraft:crafting_shaped",
    // 3 行 3 列；空格表示该格留空
    "pattern": [
        "###",
        "#X#",
        "###"
    ],
    // key：pattern 中出现的符号（除空格外）都要在此定义
    "key": {
        "#": { "item": "minecraft:diamond" },
        "X": { "item": "minecraft:nether_star" }
    },
    // result：产物与数量（1.20.1 用 "item" 字段）
    "result": {
        "item": "examplemod:example_item",
        "count": 1
    }
}
`);

FJ('recipe', 'shapeless_recipe.json', `{
    // ============================================================
    // 无序合成 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/recipes/shapeless_recipe.json
    // crafting_shapeless：只看材料集合，不看摆放位置。
    // ============================================================
    "type": "minecraft:crafting_shapeless",
    // ingredients：材料列表；每项用 "item" 或 "tag"
    "ingredients": [
        { "item": "minecraft:diamond" },
        { "item": "minecraft:emerald" },
        { "tag": "minecraft:logs" }
    ],
    "result": {
        "item": "examplemod:example_item",
        "count": 1
    }
}
`);

FJ('recipe', 'smelting_recipe.json', `{
    // ============================================================
    // 熔炼 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/recipes/smelting_recipe.json
    // 同族类型：blasting（高炉）/ smoking（烟熏）/ campfire_cooking（营火）。
    // ============================================================
    "type": "minecraft:smelting",
    // ingredient：可用 "item" 或 "tag"
    "ingredient": {
        "item": "minecraft:raw_iron"
    },
    // result：1.20.1 熔炼产物是纯字符串 ID
    "result": "examplemod:example_ingot",
    // experience：熔炼一次所得经验
    "experience": 0.7,
    // cookingtime：单位 tick（200 = 10 秒）
    "cookingtime": 200
}
`);

FJ('recipe', 'smithing_recipe.json', `{
    // ============================================================
    // 锻造台 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/recipes/smithing_recipe.json
    // 1.20+ 拆分为 smithing_transform（升级/转换）与 smithing_trim（盔甲纹饰）。
    // 注意不要再使用 1.19 的 "minecraft:smithing" 类型。
    // ============================================================
    "type": "minecraft:smithing_transform",
    // template：锻造模板（1.20 新增槽位）
    "template": {
        "item": "minecraft:netherite_upgrade_smithing_template"
    },
    // base：被升级的基础物品
    "base": {
        "item": "minecraft:diamond_sword"
    },
    // addition：升级材料
    "addition": {
        "item": "minecraft:netherite_ingot"
    },
    // result：纯字符串 ID
    "result": "minecraft:netherite_sword"
}
`);

FJ('recipe', 'stonecutting_recipe.json', `{
    // ============================================================
    // 切石 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/recipes/stonecutting_recipe.json
    // 1 输入 1 输出，无消耗无经验。
    // ============================================================
    "type": "minecraft:stonecutting",
    "ingredient": {
        "item": "minecraft:stone"
    },
    // result：纯字符串 ID；count 为产出数量
    "result": "examplemod:example_block",
    "count": 1
}
`);

FJ('tag', 'block_tag.json', `{
    // ============================================================
    // 方块标签 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/tags/blocks/example_block_tag.json
    // 常用原版标签：minecraft:mineable/pickaxe、minecraft:needs_iron_tool 等。
    // 想把内容并入原版标签，就把文件建到 data/minecraft/tags/blocks/<tag>.json。
    // ============================================================
    "replace": false,
    "values": [
        "minecraft:diamond_block",
        "minecraft:emerald_block",
        "examplemod:example_block"
    ]
}
`);

FJ('tag', 'item_tag.json', `{
    // ============================================================
    // 物品标签 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/tags/items/example_item_tag.json
    // 配方可直接引用标签："tag": "examplemod:example_item_tag"。
    // ============================================================
    "replace": false,
    "values": [
        "minecraft:diamond",
        "minecraft:emerald",
        "examplemod:example_item"
    ]
}
`);

FJ('tag', 'entity_tag.json', `{
    // ============================================================
    // 实体标签 - Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/tags/entities/example_entity_tag.json
    // 常用原版标签：minecraft:skeletons、minecraft:beehive_inhabitors 等。
    // ============================================================
    "replace": false,
    "values": [
        "minecraft:cow",
        "examplemod:example_entity"
    ]
}
`);

FJ('worldgen', 'biome_modifier.json', `{
    // ============================================================
    // 群系修改（刷怪生成）- Forge 1.20.1
    // ============================================================
    // 位置：data/examplemod/forge/biome_modifier/add_example_spawns.json
    // 注意路径：Forge 专属 serializer 放在 data/<modid>/forge/biome_modifier/ 下。
    // 可用类型：
    // - forge:add_spawns     追加生物生成（本文件）
    // - forge:remove_spawns  移除生物生成（spawners 填要移除的实体）
    // - forge:add_features   注入矿物/植被等（见 ore_feature.java 尾部注释）
    // ============================================================
    "type": "forge:add_spawns",
    // 生效群系：可用单个 ID、列表或标签（#minecraft:is_overworld 等）
    "biomes": "#minecraft:is_overworld",
    // 也可以写成 spawners 数组一次加多个
    "spawners": {
        "type": "examplemod:example_entity",
        "weight": 100,      // 权重（对比原版羊 12、僵尸 95）
        "minCount": 4,      // 每次生成数量下限
        "maxCount": 8       // 上限
    }
}
`);

FJ('worldgen', 'ore_feature.java', `package com.example.examplemod.worldgen;

import com.example.examplemod.ModMain;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.VerticalAnchor;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.levelgen.feature.Feature;
import net.minecraft.world.level.levelgen.feature.OreFeatures;
import net.minecraft.world.level.levelgen.feature.configurations.OreConfiguration; // 版本差异：OreFeatureConfig 于 1.18 改名 OreConfiguration
import net.minecraft.world.level.levelgen.placement.BiomeFilter;
import net.minecraft.world.level.levelgen.placement.CountPlacement;
import net.minecraft.world.level.levelgen.placement.HeightRangePlacement;
import net.minecraft.world.level.levelgen.placement.InSquarePlacement;
import net.minecraft.world.level.levelgen.placement.PlacedFeature;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.RegistryObject;

import java.util.List;

/**
 * 矿物生成（Forge 1.20.1）。
 * 要点：
 * - 代码方式：DeferredRegister 分别登记 ConfiguredFeature 与 PlacedFeature
 *   （Registries.CONFIGURED_FEATURE / PLACED_FEATURE）。
 * - 仅注册两个 Feature 还不够，必须再用 biome modifier JSON 注入群系：
 *     data/examplemod/forge/biome_modifier/add_ore_example.json
 *     {"type":"forge:add_features","biomes":"#minecraft:is_overworld","features":"examplemod:ore_example","step":"underground_ores"}
 * - 更推荐 runData 数据生成直接产出 JSON；本模板展示代码路径便于理解。
 */
public class ModWorldGen {
    public static final DeferredRegister<ConfiguredFeature<?, ?>> CONFIGURED_FEATURES =
            DeferredRegister.create(Registries.CONFIGURED_FEATURE, ModMain.MOD_ID);
    public static final DeferredRegister<PlacedFeature> PLACED_FEATURES =
            DeferredRegister.create(Registries.PLACED_FEATURE, ModMain.MOD_ID);

    /** 矿脉形状与矿物：size 9，替换石系方块，替换为铁块（示例）。 */
    public static final RegistryObject<ConfiguredFeature<?, ?>> ORE_EXAMPLE_CF =
            CONFIGURED_FEATURES.register("ore_example",
                    () -> new ConfiguredFeature<>(Feature.ORE, new OreConfiguration(
                            OreFeatures.STONE_ORE_REPLACEABLES, // 版本差异：Target 常量 1.18+ 移到 OreFeatures 类
                            Blocks.IRON_BLOCK.defaultBlockState(),
                            9)));

    /** 放置规则：每区块 20 次尝试，Y -64~64 均匀分布。 */
    public static final RegistryObject<PlacedFeature> ORE_EXAMPLE_PF =
            PLACED_FEATURES.register("ore_example",
                    () -> new PlacedFeature(Holder.direct(ORE_EXAMPLE_CF.get()), List.of(
                            CountPlacement.of(20),                       // 每区块尝试次数
                            InSquarePlacement.spread(),                  // 水平随机扩散
                            HeightRangePlacement.uniform(
                                    VerticalAnchor.bottom(),             // 世界底部
                                    VerticalAnchor.absolute(64)),        // Y=64
                            BiomeFilter.biome())));                      // 尾部必须带生物群系过滤
}
`);

// ============================================================================
// NEOFORGE 1.21.1（net.neoforged.*，DeferredRegister + DeferredHolder，Java 21）
// ============================================================================
NJ('project', 'build.gradle', `// ============================================================================
// build.gradle —— NeoForge 1.21.1（ModDevGradle 2.x，Groovy DSL）
// ============================================================================
// 用法要点：
// - ModDevGradle（MDG）自动拉取 NeoForge 并配置 Mojang 官方映射与 runClient/runServer/runData。
// - NeoForge 运行时使用 Mojang 官方映射，无需 reobf 步骤。
// - 需要 JDK 21；推荐 Gradle 8.8+（用 gradle wrapper 固定）。
// ============================================================================
plugins {
    id 'java-library'
    // ModDevGradle 2.x 主插件
    id 'net.neoforged.moddev' version '2.0.107'
}
version = project.mod_version
group = project.maven_group

base {
    // 决定 jar 最终名：examplemod-1.0.0.jar
    archivesName = project.archives_base_name
}

repositories {
    // MDG 已自动添加 NeoForged Maven；此处补充依赖第三方库的仓库
    mavenCentral()
}

neoForge {
    // NeoForge 版本（21.1.x 对应 Minecraft 1.21.1）
    version = project.neoforge_version

    runs {
        client { client() }
        server { server() }
        data {
            data()
            // runData：把 JSON（配方/标签/模型等）生成到 src/generated/resources
            programArguments.addAll '--mod', 'examplemod', '--all',
                    '--output', file('src/generated/resources/').getAbsolutePath(),
                    '--existing', file('src/main/resources/').getAbsolutePath()
        }
    }

    mods {
        examplemod { sourceSet sourceSets.main }
    }
}

// 数据生成输出目录并入资源处理
sourceSets.main.resources { srcDir 'src/generated/resources' }

// Minecraft 1.21.1 需要 Java 21；统一 UTF-8 编译编码
java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}
tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
    options.release = 21
}
`);

NH('project', 'settings.gradle', `// ============================================================================
// settings.gradle —— Gradle 插件仓库与项目名
// ============================================================================
// 用法要点：
// - ModDevGradle 插件发布在 NeoForged Maven，必须放在 pluginManagement 首位。
// ============================================================================
pluginManagement {
    repositories {
        // NeoForged Maven：提供 net.neoforged.moddev 插件
        maven { url = 'https://maven.neoforged.net/releases' }
        gradlePluginPortal()
        mavenCentral()
    }
}
plugins {
    // 本机没有匹配 JDK 时自动下载工具链
    id 'org.gradle.toolchains.foojay-resolver-convention' version '0.8.0'
}
// jar 名；与 neoforge.mods.toml 的 modId 保持一致便于排查
rootProject.name = 'examplemod'
`);

NH('project', 'gradle.properties', `# 用法要点：
# - ModDevGradle 2.x 构建建议 -Xmx3G；CI 环境禁用 daemon 更稳定。
# ============================================================================
org.gradle.jvmargs=-Xmx3G
org.gradle.daemon=false
org.gradle.parallel=true

# Mod 元数据（供 build.gradle 读取）
mod_version=1.0.0
maven_group=com.example.examplemod
archives_base_name=examplemod

# 版本对照（与 build.gradle 保持一致）
minecraft_version=1.21.1
neoforge_version=21.1.250
`);

NH('project', 'neoforge.mods.toml', `# 用法要点：
# - 实际位置：src/main/resources/META-INF/neoforge.mods.toml（文件名必须带 neoforge 前缀）。
# - modLoader=javafml；1.21.1 的 FML loaderVersion 为 [4,)。
# - 1.20.5+ 依赖声明用 type="required"/"optional"（替代旧的 mandatory=true）。
# - 使用 Mixin 时追加 [[mixins]] config="examplemod.mixins.json"。
# ============================================================================
modLoader="javafml"
loaderVersion="[4,)"
license="MIT"
#issueTrackerURL="https://github.com/example/examplemod/issues"

[[mods]]
modId="examplemod"
version="1.0.0"
displayName="Example Mod"
description='''
KunYuEcosystem AI reference scaffold for NeoForge 1.21.1.
'''
authors="Example Author"
#logoFile="assets/examplemod/logo.png"

[[dependencies.examplemod]]
    modId="neoforge"
    type="required"
    versionRange="[21,)"
    ordering="NONE"
    side="BOTH"

[[dependencies.examplemod]]
    modId="minecraft"
    type="required"
    versionRange="[1.21.1]"
    ordering="NONE"
    side="BOTH"

# 如使用 Mixin，取消注释并把 examplemod.mixins.json 放入 src/main/resources：
# [[mixins]]
# config="examplemod.mixins.json"
`);

NJ('project', 'ModMain.java', `package com.example.examplemod;

import com.example.examplemod.block.ModBlocks;
import com.example.examplemod.entity.ModEntities;
import com.example.examplemod.item.ModItems;
import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import org.slf4j.Logger;

/**
 * NeoForge 主入口（1.21.1）。
 * 与 Fabric entrypoint 不同：NeoForge 扫描 @Mod 注解定位主类，
 * 并且支持构造器注入 IEventBus / ModContainer，无需再调 FMLJavaModLoadingContext。
 */
@Mod(ModMain.MOD_ID)
public class ModMain {
    public static final String MOD_ID = "examplemod";
    public static final Logger LOGGER = LogUtils.getLogger();

    public ModMain(IEventBus modEventBus) {
        // 登记注册表容器（方块/物品/实体等详见各 category 模板）
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);
        ModEntities.ENTITY_TYPES.register(modEventBus);
        // 若使用了 food_item/tool_item/armor_item/spawn_egg_item 等独立模板类，同样需要注册：
        // ModFoods.ITEMS.register(modEventBus);

        modEventBus.addListener(this::commonSetup);
    }

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("Common setup for {}", MOD_ID);
        // 通用端初始化：注册网络负载、配方后处理等
    }
}
`);

NJ('project', 'ModClient.java', `package com.example.examplemod;

import com.example.examplemod.client.render.ExampleEntityRenderer;
import com.example.examplemod.entity.ModEntities;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

/**
 * 客户端专属注册示例（NeoForge 1.21.1）。
 * NeoForge 没有 client entrypoint：用 @EventBusSubscriber(value = Dist.CLIENT) 把本类
 * 挂到 MOD 总线，仅客户端环境加载；渲染器/屏幕/按键绑定都在这里注册。
 * 注意注解类是 net.neoforged.fml.common.EventBusSubscriber（不同于 Forge 的嵌套注解）。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public class ModClient {

    @SubscribeEvent
    public static void onRegisterRenderers(EntityRenderersEvent.RegisterRenderers event) {
        // 实体渲染器（详见 entity/entity_renderer.java）
        event.registerEntityRenderer(ModEntities.EXAMPLE_ENTITY.get(), ExampleEntityRenderer::new);
        // 屏幕注册见 gui/screen_with_menu.java（FMLClientSetupEvent 中 MenuScreens.register）
    }
}
`);

NJ('project', 'ModServer.java', `package com.example.examplemod;

import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/**
 * 服务端事件订阅示例（NeoForge 1.21.1）。
 * 与 Fabric 的 DedicatedServerModInitializer 不同，NeoForge 没有独立 server 入口：
 * 服务端逻辑一律通过事件监听实现。本类未标注 Dist，客户端与专用服务器都会加载，
 * 需要区分环境时可用 FMLLoader.getDist() 或 event.getServer().isDedicatedServer()。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID) // 默认挂在游戏事件总线
public class ModServer {

    @SubscribeEvent
    public static void onServerStarting(ServerStartingEvent event) {
        ModMain.LOGGER.info("Server starting: dedicated={}", event.getServer().isDedicatedServer());
        // 服务端初始化：注册跨端数据、启动定时任务等
    }

    @SubscribeEvent
    public static void onServerStopping(ServerStoppingEvent event) {
        ModMain.LOGGER.info("Server stopping");
    }
}
`);

NM('project', 'README.md', `# NeoForge 1.21.1 项目脚手架

KunYuEcosystem AI 参考包——NeoForge 1.21.1（Mojang 官方映射 / ModDevGradle 2.x）项目模板说明。

## 目录结构

    project/
    ├── build.gradle            # ModDevGradle 2.x 构建脚本（Groovy DSL）
    ├── settings.gradle         # 插件仓库（NeoForged Maven）+ 项目名
    ├── gradle.properties       # 版本与构建参数
    ├── neoforge.mods.toml      # 说明版 META-INF/neoforge.mods.toml
    ├── LICENSE                 # MIT 许可证
    ├── README.md               # 本文件
    └── src/main/
        ├── resources/META-INF/neoforge.mods.toml
        └── java/com/example/examplemod/
            ├── ModMain.java      # @Mod 主入口（构造器注入 IEventBus）
            ├── ModClient.java    # 客户端事件订阅（Dist.CLIENT）
            └── ModServer.java    # 服务端事件订阅示例（NeoForge 无独立 server 入口）

## 文件说明

| 文件 | 作用 |
| --- | --- |
| build.gradle | ModDevGradle 拉取 NeoForge 21.1.250、client/server/data 三个 run 配置、Java 21 工具链 |
| settings.gradle | pluginManagement 声明 NeoForged Maven 与 foojay 工具链解析器；rootProject.name 决定 jar 名 |
| gradle.properties | 构建内存 -Xmx3G、daemon=false、mod_version / minecraft_version / neoforge_version |
| neoforge.mods.toml | modId=examplemod；依赖用 type="required"（neoforge [21,)、minecraft [1.21.1]） |
| ModMain.java | @Mod 主类；构造器注入 IEventBus 并登记各 DeferredRegister，监听 FMLCommonSetupEvent |
| ModClient.java | @EventBusSubscriber(Dist.CLIENT)：EntityRenderersEvent.RegisterRenderers 注册渲染器 |
| ModServer.java | 服务端事件订阅示例：ServerStartingEvent / ServerStoppingEvent |

## 版本对照

| 组件 | 版本 |
| --- | --- |
| Minecraft | 1.21.1 |
| NeoForge | 21.1.250 |
| ModDevGradle | 2.0.107 |
| Java | 21 |
| Gradle | 8.8+（建议用 wrapper 固定） |

## 快速开始

    cd project
    gradle wrapper --gradle-version 8.8
    ./gradlew runClient      # 启动客户端
    ./gradlew runServer      # 启动专用服务器
    ./gradlew build          # 构建 examplemod-1.0.0.jar（运行时即官方映射，无需 reobf）

## 与 Fabric / Forge 的差异

- 入口：@Mod 构造器注入 IEventBus（也可注入 ModContainer）。
- 注解类：net.neoforged.fml.common.EventBusSubscriber（非嵌套注解），总线用 EventBusSubscriber.Bus.MOD。
- 模组描述文件：META-INF/neoforge.mods.toml；依赖声明用 type="required"。
- 附魔为数据驱动 JSON（data/<modid>/enchantment/），不再是 Java Enchantment 子类。

## 改名清单

1. settings.gradle → rootProject.name；gradle.properties → archives_base_name。
2. neoforge.mods.toml → modId、displayName、description、versionRange。
3. 所有模板文件中的包名 com.example.examplemod → 你的包名；MOD_ID → 你的 modId。
4. gradle.properties → maven_group / mod_version。
5. build.gradle → neoforge_version。
`);

NL('project', 'LICENSE', `MIT License

Copyright (c) 2026 KunYuEcosystem example mod template contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);

NJ('advancement', 'advancement.json', `{
    // ============================================================
    // 进度/成就 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/advancement/example_advancement.json
    // 注意：1.21 起目录名改为单数 advancement（1.20.x 是 advancements）。
    // 原版数据包格式，与加载器无关；NeoForge 也可用 runData 的 AdvancementProvider 生成。
    // ============================================================
    // 父进度决定树形展示位置；根进度可用 display.background 设背景
    "parent": "examplemod:example/root",
    "display": {
        "icon": {
            "item": "examplemod:example_item"
        },
        // 标题/描述建议走翻译键（assets/examplemod/lang/en_us.json）
        "title": {
            "translate": "advancements.examplemod.example.title"
        },
        "description": {
            "translate": "advancements.examplemod.example.description"
        },
        // frame: task（普通）/ goal（目标）/ challenge（挑战）
        "frame": "task",
        "show_toast": true,
        "announce_to_chat": true,
        "hidden": false
        // 根进度可加："background": "minecraft:textures/block/stone.png"
    },
    // criteria：达成条件集合；requirements 描述它们之间的 AND/OR 关系
    "criteria": {
        "get_example_item": {
            "trigger": "minecraft:inventory_changed",
            "conditions": {
                "items": [
                    {
                        "items": [
                            "examplemod:example_item"
                        ]
                    }
                ]
            }
        },
        "another_condition": {
            "trigger": "minecraft:location",
            "conditions": {
                "player": {
                    "location": {
                        "dimension": "minecraft:overworld"
                    }
                }
            }
        }
    },
    // 本例：两个条件需同时满足（AND）；OR 则写成 [[a, b]]
    "requirements": [
        ["get_example_item"],
        ["another_condition"]
    ],
    "rewards": {
        "experience": 10,
        "loot": [
            "examplemod:example_loot_table"
        ],
        "function": "examplemod:grant_example_reward"
    }
}
`);

NJ('block', 'simple_block.java', `package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.SoundType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 方块注册（NeoForge 1.21.1）。
 * 惯用写法：DeferredRegister.Blocks 简写 + DeferredHolder，
 * 在主类构造器中 BLOCKS.register(modEventBus)。
 */
public class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(ModMain.MOD_ID);

    public static final DeferredHolder<Block, Block> EXAMPLE_BLOCK = BLOCKS.register("example_block",
            () -> new Block(BlockBehaviour.Properties.of()
                    .strength(1.5f, 6.0f)                 // 硬度 1.5，爆炸抗性 6.0
                    .sound(SoundType.STONE)
                    .requiresCorrectToolForDrops()));     // 需要正确工具才掉落

    // 配套 BlockItem：为清晰起见用显式 register（见 item/simple_item.java）：
    // public static final DeferredHolder<Item, BlockItem> EXAMPLE_BLOCK_ITEM =
    //         ModItems.ITEMS.register("example_block",
    //                 () -> new BlockItem(EXAMPLE_BLOCK.get(), new Item.Properties()));
    // 也可用简写一次注册：BLOCKS.registerSimpleBlockItem(EXAMPLE_BLOCK, new Item.Properties());
}
`);

NJ('block', 'block_entity.java', `package com.example.examplemod.block;

import com.example.examplemod.ModMain;
import net.minecraft.core.BlockPos;
import net.minecraft.core.HolderLookup;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 方块实体注册（NeoForge 1.21.1）。
 * 要点：
 * - 原版注册表用 Registries 键：DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, MODID)。
 * - BlockEntityType.Builder.of(构造引用, 关联方块).build(null)：1.21.1 中 Type 参数仍传 null。
 * - 数据读写：1.20.5+ 起签名为 saveAdditional/loadAdditional(CompoundTag, HolderLookup.Provider)，
 *   务必先调用 super（1.20.4 及更早是单参 saveAdditional/load）。
 */
public class ModBlockEntities {
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES =
            DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, ModMain.MOD_ID);

    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<ExampleBlockEntity>> EXAMPLE_BLOCK_ENTITY =
            BLOCK_ENTITIES.register("example_block_entity",
                    () -> BlockEntityType.Builder.of(ExampleBlockEntity::new, ModBlocks.EXAMPLE_BLOCK.get())
                            .build(null));

    /** 示例方块实体：计数器持久化。 */
    public static class ExampleBlockEntity extends BlockEntity {
        private int counter = 0;

        public ExampleBlockEntity(BlockPos pos, BlockState state) {
            super(ModBlockEntities.EXAMPLE_BLOCK_ENTITY.get(), pos, state);
        }

        public void increment() {
            this.counter++;
            setChanged(); // 标记脏数据，触发保存
        }

        @Override
        protected void saveAdditional(CompoundTag tag, HolderLookup.Provider registries) {
            super.saveAdditional(tag, registries);
            tag.putInt("counter", this.counter);
        }

        @Override
        protected void loadAdditional(CompoundTag tag, HolderLookup.Provider registries) {
            super.loadAdditional(tag, registries);
            this.counter = tag.getInt("counter");
        }
    }
}
`);

NJ('block', 'blockstate.json', `{
  // ================================================================
  // 方块状态 JSON（NeoForge 1.21.1）
  // ================================================================
  // 位置：src/main/resources/assets/examplemod/blockstates/example_block.json
  // 作用：把 BlockState 组合映射到模型；加载器无关，两种 mod 通用。
  // ================================================================
  "variants": {
    // "" 表示该方块的默认状态（未声明任何属性时）
    // "model" 指向 assets/examplemod/models/block/example_block.json
    "": {
      "model": "examplemod:block/example_block"
    }
    // 有朝向属性时可写：
    // "facing=north": { "model": "examplemod:block/example_block" },
    // "facing=east":  { "model": "examplemod:block/example_block", "y": 90 },
    // "facing=south": { "model": "examplemod:block/example_block", "y": 180 },
    // "facing=west":  { "model": "examplemod:block/example_block", "y": 270 }
  }
}
`);

NJ('block', 'model.json', `{
  // ================================================================
  // 方块模型 JSON（NeoForge 1.21.1）
  // ================================================================
  // 位置：src/main/resources/assets/examplemod/models/block/example_block.json
  // 由 blockstate.json 的 "model" 引用；加载器无关。
  // ================================================================
  // parent 决定基础形状；cube_all 只需一个 "all" 贴图
  "parent": "block/cube_all",
  // 贴图名 "examplemod:block/example_block" 对应
  // assets/examplemod/textures/block/example_block.png
  "textures": {
    "all": "examplemod:block/example_block"
  }
  // 六面不同贴图时改用 parent "block/cube"：
  // "textures": {
  //   "up": "examplemod:block/example_block_top",
  //   "down": "examplemod:block/example_block_bottom",
  //   "north": "examplemod:block/example_block_side",
  //   "south": "examplemod:block/example_block_side",
  //   "east": "examplemod:block/example_block_side",
  //   "west": "examplemod:block/example_block_side"
  // }
}
`);

NJ('block', 'loot_table.json', `{
  // ================================================================
  // 方块掉落物 JSON（NeoForge 1.21.1）
  // ================================================================
  // 位置：src/main/resources/data/examplemod/loot_table/blocks/example_block.json
  // 注意：1.21 起目录名改为单数 loot_table（1.20.x 是 loot_tables）。
  // 结构：alternatives（时序选择）→ 有精准采集时掉自身，否则正常掉落。
  // ================================================================
  "type": "minecraft:block",
  "pools": [
    {
      "rolls": 1,
      "bonus_rolls": 0,
      "entries": [
        {
          // alternatives：取第一个满足条件的子项
          "type": "minecraft:alternatives",
          "children": [
            {
              "type": "minecraft:item",
              "name": "examplemod:example_block",
              // 精准采集时掉自身
              "conditions": [
                {
                  "condition": "minecraft:match_tool",
                  "predicate": {
                    "enchantments": [
                      { "enchantment": "minecraft:silk_touch", "levels": { "min": 1 } }
                    ]
                  }
                }
              ]
            },
            {
              // 无精准采集时也掉自身；想掉其它物品改 "name" 即可
              "type": "minecraft:item",
              "name": "examplemod:example_block"
            }
          ]
        }
      ],
      // 掉落数量函数；可改为 { "min": 1, "max": 3 }
      "functions": [
        { "function": "minecraft:set_count", "count": 1 }
      ]
    }
  ]
}
`);

NJ('item', 'simple_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Rarity;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 普通物品注册（NeoForge 1.21.1）。
 * 要点：
 * - DeferredRegister.Items 简写：DeferredRegister.createItems(MODID)。
 * - 物品默认不进任何创造栏：用 BuildCreativeModeTabContentsEvent（MOD 总线）添加。
 */
public class ModItems {
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(ModMain.MOD_ID);

    public static final DeferredHolder<Item, Item> EXAMPLE_ITEM = ITEMS.register("example_item",
            () -> new Item(new Item.Properties()
                    .stacksTo(64)
                    .rarity(Rarity.COMMON)));

    // 创造栏添加（MOD 总线，可放在本类或 ModClient）：
    // @EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
    // public static class CreativeTabHandler {
    //     @SubscribeEvent
    //     public static void onBuildCreativeTabs(BuildCreativeModeTabContentsEvent event) {
    //         if (event.getTabKey() == CreativeModeTabs.INGREDIENTS) {
    //             event.accept(EXAMPLE_ITEM);
    //         }
    //     }
    // }
}
`);

NJ('item', 'food_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 食物物品（NeoForge 1.21.1）。
 * 要点：
 * - Item.Properties().food(FoodProperties)；1.20.5+ 饱和度方法名为 saturationModifier，
 *   "不饿也能吃"方法名为 alwaysEdible（1.20.4 及更早为 alwaysEat）。
 * - effect 传 Supplier 是 NeoForge 扩展，可避免过早初始化药水注册表。
 * - 独立 DeferredRegister：记得在主类构造器追加 FOODS.register(modEventBus)。
 */
public class ModFoods {
    public static final DeferredRegister<Item> FOODS =
            DeferredRegister.create(Registries.ITEM, ModMain.MOD_ID);

    public static final DeferredHolder<Item, Item> EXAMPLE_FOOD = FOODS.register("example_food",
            () -> new Item(new Item.Properties()
                    .food(new FoodProperties.Builder()
                            .nutrition(4)                // 饥饿值 +4
                            .saturationModifier(0.6f)    // 饱和度系数 0.6
                            .effect(() -> new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 200, 0), 1.0f)
                            .alwaysEdible()              // 不饿也能吃（1.20.5+ 方法名；1.20.4 为 alwaysEat）
                            .build())));
}
`);

NJ('item', 'tool_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.item.PickaxeItem;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.Tiers;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 工具物品（NeoForge 1.21.1）。
 * 要点：
 * - 1.21.1 仍是 Tier 体系：PickaxeItem(Tier, 攻击伤害增量, 攻速修正, Item.Properties)。
 *   （1.21.2+ 才改为 ToolMaterial 数据组件。）
 * - Tier 用原版 Tiers（WOOD/STONE/IRON/DIAMOND/NETHERITE/GOLD）或自定义 Tier 实现。
 * - 剑：new SwordItem(Tiers.IRON, 3, -2.4f, props)；斧/铲同理（AxeItem/ShovelItem）。
 * - 独立 DeferredRegister：记得在主类构造器追加 TOOLS.register(modEventBus)。
 */
public class ModTools {
    public static final DeferredRegister<Item> TOOLS =
            DeferredRegister.create(Registries.ITEM, ModMain.MOD_ID);

    public static final DeferredHolder<Item, PickaxeItem> EXAMPLE_PICKAXE = TOOLS.register("example_pickaxe",
            () -> new PickaxeItem(Tiers.IRON, 1, -2.8f, new Item.Properties()));

    public static final DeferredHolder<Item, SwordItem> EXAMPLE_SWORD = TOOLS.register("example_sword",
            () -> new SwordItem(Tiers.IRON, 3, -2.4f, new Item.Properties()));
}
`);

NJ('item', 'armor_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterials;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 盔甲物品（NeoForge 1.21.1）。
 * 要点：
 * - 1.21.1 构造：ArmorItem(ArmorMaterial, ArmorItem.Type, Item.Properties)。
 *   Type 取 HELMET/CHESTPLATE/LEGGINGS/BOOTS；材质用原版 ArmorMaterials 或自定义 ArmorMaterial。
 * - 1.21.1 材质枚举仍在 net.minecraft.world.item.ArmorMaterials（1.21.2+ 才移到 item.armor 包）。
 * - 盔甲层贴图：assets/examplemod/textures/models/armor/example_layer_1.png（裤甲 _layer_2）。
 * - 独立 DeferredRegister：记得在主类构造器追加 ARMORS.register(modEventBus)。
 */
public class ModArmors {
    public static final DeferredRegister<Item> ARMORS =
            DeferredRegister.create(Registries.ITEM, ModMain.MOD_ID);

    public static final DeferredHolder<Item, ArmorItem> EXAMPLE_CHESTPLATE = ARMORS.register("example_chestplate",
            () -> new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.CHESTPLATE, new Item.Properties()));
}
`);

NJ('item', 'model.json', `{
  "//": [
    "物品模型 JSON —— NeoForge 1.21.1（加载器无关）",
    "位置：assets/<modid>/models/item/<item_name>.json",
    "示例：example_item 对应 assets/examplemod/models/item/example_item.json",
    "贴图：assets/examplemod/textures/item/example_item.png",
    "parent 常用值：item/generated（普通平面物品）/ item/handheld（工具武器）",
    "layer0 指向贴图，不含 .png；可叠加 layer1/layer2 做多层贴图"
  ],
  "parent": "item/generated",
  "textures": {
    "layer0": "examplemod:item/example_item"
  }
}
`);

NJ('entity', 'simple_entity.java', `package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.level.Level;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 实体注册（NeoForge 1.21.1）。
 * 要点：
 * - 原版注册表用 Registries 键：DeferredRegister.create(Registries.ENTITY_TYPE, MODID)。
 * - EntityType.Builder.of(工厂, MobCategory).sized(宽, 高).build("名字")；
 *   build 的字符串用于数据修复器，与注册名一致即可。
 * - 属性必须经 EntityAttributeCreationEvent 注册（见 entity_attribute.java），否则生成实体即崩溃。
 */
public class ModEntities {
    public static final DeferredRegister<EntityType<?>> ENTITY_TYPES =
            DeferredRegister.create(Registries.ENTITY_TYPE, ModMain.MOD_ID);

    public static final DeferredHolder<EntityType<?>, EntityType<ExampleEntity>> EXAMPLE_ENTITY =
            ENTITY_TYPES.register("example_entity",
                    () -> EntityType.Builder.of(ExampleEntity::new, MobCategory.CREATURE)
                            .sized(0.6f, 1.8f)   // 碰撞箱：宽 0.6，高 1.8
                            .build("example_entity"));

    /** 示例生物：陆生被动型。 */
    public static class ExampleEntity extends PathfinderMob {
        public ExampleEntity(EntityType<? extends PathfinderMob> type, Level level) {
            super(type, level);
        }

        /** 属性构建器，供 EntityAttributeCreationEvent 使用。 */
        public static AttributeSupplier.Builder createAttributes() {
            return PathfinderMob.createMobAttributes()
                    .add(Attributes.MAX_HEALTH, 20.0)
                    .add(Attributes.MOVEMENT_SPEED, 0.25)
                    .add(Attributes.ATTACK_DAMAGE, 3.0)
                    .add(Attributes.FOLLOW_RANGE, 16.0);
        }

        @Override
        protected void registerGoals() {
            // 添加 AI Goal：WaterAvoidingRandomStrollGoal、LookAtPlayerGoal、PanicGoal 等
        }
    }
}
`);

NJ('entity', 'entity_attribute.java', `package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent;

/**
 * 实体属性注册（NeoForge 1.21.1）。
 * 事件类：net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent（MOD 总线）。
 * 在 event.put(EntityType, AttributeSupplier) 中登记属性；漏掉会在实体生成时抛 NPE。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
public class ModEntityAttributes {

    @SubscribeEvent
    public static void onEntityAttributeCreation(EntityAttributeCreationEvent event) {
        event.put(ModEntities.EXAMPLE_ENTITY.get(),
                ModEntities.ExampleEntity.createAttributes().build());
        // 多个实体继续 event.put(...) 即可
    }
}
`);

NJ('entity', 'spawn_egg_item.java', `package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.common.DeferredSpawnEggItem;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 刷怪蛋（NeoForge 1.21.1）。
 * 要点：
 * - DeferredSpawnEggItem(Supplier<EntityType<? extends Mob>>, 底色, 斑点色, Item.Properties)。
 * - Supplier 延迟取值：() -> ModEntities.EXAMPLE_ENTITY.get()；
 *   也可直接把 DeferredHolder 传进去（它本身就是 Supplier）。
 * - 创造栏见 item/simple_item.java 的 BuildCreativeModeTabContentsEvent 示例。
 * - 独立 DeferredRegister：记得在主类构造器追加 SPAWN_EGGS.register(modEventBus)。
 */
public class ModSpawnEggItems {
    public static final DeferredRegister<Item> SPAWN_EGGS =
            DeferredRegister.create(Registries.ITEM, ModMain.MOD_ID);

    public static final DeferredHolder<Item, DeferredSpawnEggItem> EXAMPLE_SPAWN_EGG =
            SPAWN_EGGS.register("example_spawn_egg",
                    () -> new DeferredSpawnEggItem(() -> ModEntities.EXAMPLE_ENTITY.get(),
                            0xFFFFFF,   // 底色
                            0x000000,   // 斑点色
                            new Item.Properties()));
}
`);

NJ('entity', 'entity_renderer.java', `package com.example.examplemod.client.render;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.ResourceLocation;

/**
 * 实体渲染器（NeoForge 1.21.1，Mojmap）。
 * 要点：
 * - 继承 MobRenderer<实体, 模型>，构造器调 super(context, model, shadowRadius)。
 * - 1.21 起 ResourceLocation 构造器私有：用 ResourceLocation.fromNamespaceAndPath(namespace, path)。
 * - 贴图：assets/examplemod/textures/entity/example_entity.png。
 * - 注册在 MOD 总线的 EntityRenderersEvent.RegisterRenderers 中完成（见 project/ModClient.java）。
 * - 无自定义模型时可复用原版模型层：ModelLayers.PLAYER / COW / CHICKEN 等。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, HumanoidModel<ModEntities.ExampleEntity>> {
    private static final ResourceLocation TEXTURE =
            ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererProvider.Context context) {
        super(context, new HumanoidModel<>(context.bakeLayer(ModelLayers.PLAYER)), 0.5f);
    }

    @Override
    public ResourceLocation getTextureLocation(ModEntities.ExampleEntity entity) {
        return TEXTURE;
    }
}
`);

NJ('command', 'simple_command.java', `package com.example.examplemod.command;

import com.example.examplemod.ModMain;
import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/**
 * 指令注册（NeoForge 1.21.1）。
 * 要点：
 * - 监听游戏总线的 RegisterCommandsEvent，用 Brigadier literal/argument 搭建指令树。
 * - requires 控制权限（2 = OP），executes 返回值即指令结果码。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID) // 默认 game 总线
public class ModCommands {

    @SubscribeEvent
    public static void onRegisterCommands(RegisterCommandsEvent event) {
        event.getDispatcher().register(
                Commands.literal("example")                       // /example <value>
                        .requires(source -> source.hasPermission(2))
                        .then(Commands.argument("value", IntegerArgumentType.integer(0))
                                .executes(ctx -> {
                                    int value = IntegerArgumentType.getInteger(ctx, "value");
                                    ctx.getSource().sendSuccess(
                                            () -> Component.literal("example value = " + value), false);
                                    return Command.SINGLE_SUCCESS;
                                }))
        );
    }
}
`);

NJ('enchantment', 'custom_enchantment.json', `{
    // ============================================================
    // 自定义附魔（数据驱动）- NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/enchantment/example_enchantment.json
    // 重要：1.21 起附魔改为数据驱动，不再是 Java Enchantment 子类；
    // 放入该目录即自动注册，无需任何代码。描述与名称走翻译键：
    //   enchantment.examplemod.example_enchantment（assets/examplemod/lang/en_us.json）
    // ============================================================
    // 附魔名称（可用 translate 或 literal）
    "description": {
        "translate": "enchantment.examplemod.example_enchantment"
    },
    // 可附魔物品：物品 ID、列表或标签（#minecraft:enchantable/* 系列标签）
    "supported_items": "#minecraft:enchantable/weapon",
    // 附魔台抽取权重（原版锋利 10）
    "weight": 10,
    // 最大等级
    "max_level": 3,
    // 附魔台最小消耗曲线：10 + (等级-1) * 15
    "min_cost": {
        "base": 10,
        "per_level_above_first": 15
    },
    // 附魔台最大消耗曲线
    "max_cost": {
        "base": 40,
        "per_level_above_first": 10
    },
    // 铁砧合并消耗
    "anvil_cost": 2,
    // 生效槽位
    "slots": [
        "mainhand"
    ],
    // 效果：伤害加成 = 1.0 + 0.5 * (等级-1)
    "effects": {
        "minecraft:damage": [
            {
                "effect": {
                    "type": "minecraft:add",
                    "value": {
                        "type": "minecraft:linear",
                        "base": 1.0,
                        "per_level_above_first": 0.5
                    }
                }
            }
        ]
    }
}
`);

NJ('gui', 'simple_screen.java', `package com.example.examplemod.gui;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * 普通屏幕（NeoForge 1.21.1，Mojmap）。
 * 要点：
 * - 继承 net.minecraft.client.gui.screens.Screen；控件在 init() 中创建（窗口缩放时会重新调用）。
 * - 1.21.1 render 签名：render(GuiGraphics, int, int, float)；先 renderBackground 再 super.render。
 * - 打开方式：Minecraft.getInstance().setScreen(new ExampleScreen())；仅客户端可用。
 */
public class ExampleScreen extends Screen {
    private EditBox inputBox;

    public ExampleScreen() {
        super(Component.literal("Example Screen"));
    }

    @Override
    protected void init() {
        // 文本输入框
        this.inputBox = new EditBox(this.font, this.width / 2 - 100, this.height / 2 - 40, 200, 20,
                Component.literal("input"));
        this.inputBox.setMaxLength(50);
        this.addRenderableWidget(this.inputBox);

        // 按钮：Button.builder(文本, 回调).bounds(x, y, 宽, 高).build()
        this.addRenderableWidget(Button.builder(Component.literal("OK"), button -> {
                    System.out.println("input = " + this.inputBox.getValue());
                    this.onClose();
                })
                .bounds(this.width / 2 - 100, this.height / 2, 200, 20)
                .build());
    }

    @Override
    public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(guiGraphics);
        super.render(guiGraphics, mouseX, mouseY, partialTick);
        guiGraphics.drawCenteredString(this.font, this.title, this.width / 2, 20, 0xFFFFFF);
    }

    @Override
    public boolean isPauseScreen() {
        return false; // 单人游戏中打开此界面不暂停
    }
}
`);

NJ('gui', 'screen_with_menu.java', `package com.example.examplemod.gui;

import com.example.examplemod.ModMain;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.Container;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.common.extensions.IMenuTypeExtension;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 容器界面（NeoForge 1.21.1）。
 * 要点：
 * - 菜单：MenuType 用 IMenuTypeExtension.create(工厂) 创建，工厂签名 (int id, Inventory inv, FriendlyByteBuf buf)。
 * - 屏幕：AbstractContainerScreen<Menu>，实现 renderBg 绘制背景贴图。
 * - 客户端注册屏幕：FMLClientSetupEvent（MOD 总线）中
 *   MenuScreens.register(ModMenus.EXAMPLE_MENU.get(), ModMenus.ExampleMenuScreen::new);
 * - 屏幕类仅客户端可用，实际项目建议放到 client 包并只在客户端环境加载。
 */
public class ModMenus {
    public static final DeferredRegister<MenuType<?>> MENUS =
            DeferredRegister.create(Registries.MENU, ModMain.MOD_ID);

    public static final DeferredHolder<MenuType<?>, MenuType<ExampleMenu>> EXAMPLE_MENU =
            MENUS.register("example_menu", () -> IMenuTypeExtension.create(ExampleMenu::new));

    /** 菜单（服务端/客户端共用）。 */
    public static class ExampleMenu extends AbstractContainerMenu {
        private static final int CONTAINER_SIZE = 9;

        /** 网络打开：服务端 openMenu 时由 IMenuTypeExtension 工厂进入。 */
        public ExampleMenu(int containerId, Inventory playerInventory, FriendlyByteBuf buf) {
            this(containerId, playerInventory, new SimpleContainer(CONTAINER_SIZE));
        }

        /** 直接打开：BlockEntity 等持有真实容器时使用。 */
        public ExampleMenu(int containerId, Inventory playerInventory, Container container) {
            super(ModMenus.EXAMPLE_MENU.get(), containerId);
            checkContainerSize(container, CONTAINER_SIZE);
            container.startOpen(playerInventory.player);
            // 容器槽位：3x3
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 3; col++) {
                    this.addSlot(new Slot(container, col + row * 3, 8 + col * 18, 18 + row * 18));
                }
            }
            // 玩家背包 3x9 + 快捷栏
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(playerInventory, col + row * 9 + 9, 8 + col * 18, 84 + row * 18));
                }
            }
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(playerInventory, col, 8 + col * 18, 142));
            }
        }

        @Override
        public ItemStack quickMoveStack(Player player, int index) {
            // 按需实现 shift 点击转移逻辑
            return ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(Player player) {
            // 实际项目应校验距离：player.distanceToSqr(...) <= 64
            return true;
        }
    }

    /** 屏幕（仅客户端）。 */
    public static class ExampleMenuScreen extends AbstractContainerScreen<ExampleMenu> {
        private static final ResourceLocation TEXTURE =
                ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "textures/gui/example_menu.png");

        public ExampleMenuScreen(ExampleMenu menu, Inventory playerInventory, Component title) {
            super(menu, playerInventory, title);
            this.imageWidth = 176;   // 背景宽
            this.imageHeight = 166;  // 背景高
        }

        @Override
        protected void renderBg(GuiGraphics guiGraphics, float partialTick, int mouseX, int mouseY) {
            guiGraphics.blit(TEXTURE, this.leftPos, this.topPos, 0, 0, this.imageWidth, this.imageHeight);
        }

        @Override
        public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
            this.renderBackground(guiGraphics);
            super.render(guiGraphics, mouseX, mouseY, partialTick);
            this.renderTooltip(guiGraphics, mouseX, mouseY);
        }
    }
}
`);

NJ('mixin', 'inject_mixin.java', `package com.example.examplemod.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * @Inject Mixin 示例（NeoForge 1.21.1）。
 * NeoForge 同样使用 SpongePowered Mixin；method 直接写 Mojang 官方映射方法名。
 * @At 常用注入点：HEAD / RETURN / TAIL / INVOKE；有返回值的方法用 CallbackInfoReturnable。
 * 注册：把 mixin_config.json（examplemod.mixins.json）在 neoforge.mods.toml 中声明。
 */
@Mixin(Minecraft.class)
public class ExampleInjectMixin {

    @Inject(method = "tick", at = @At("HEAD"), cancellable = true)
    private void onTickStart(CallbackInfo ci) {
        // 每 tick 开始前调用；ci.cancel() 可跳过原逻辑（建议仅在 HEAD 使用）
    }

    @Inject(method = "tick", at = @At("TAIL"))
    private void onTickEnd(CallbackInfo ci) {
        // 每 tick 结束后调用
    }

    @Inject(method = "getFps", at = @At("RETURN"), cancellable = true)
    private void onGetFps(CallbackInfoReturnable<Integer> cir) {
        // cir.setReturnValue(...) 可替换返回值；cir.getReturnValue() 读原值
    }
}
`);

NJ('mixin', 'modify_arg_mixin.java', `package com.example.examplemod.mixin;

import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/**
 * @ModifyArg Mixin 示例（NeoForge 1.21.1）。
 * 用途：拦截方法体内某一次调用的单个参数并替换。
 * target 需写 JVM 描述符（Mojang 官方映射类名）：
 *   Lnet/minecraft/client/gui/GuiGraphics;drawCenteredString(Lnet/minecraft/client/gui/Font;Lnet/minecraft/network/chat/Component;III)V
 * 参数序号从 0 起：font=0, text=1, x=2, y=3, color=4。
 */
@Mixin(TitleScreen.class)
public class ExampleModifyArgMixin {

    @ModifyArg(
            method = "render",
            at = @At(
                    value = "INVOKE",
                    target = "Lnet/minecraft/client/gui/GuiGraphics;drawCenteredString(Lnet/minecraft/client/gui/Font;Lnet/minecraft/network/chat/Component;III)V"
            ),
            index = 4   // 颜色参数
    )
    private int modifyTitleColor(int originalColor) {
        return 0xFF5555; // 改成红色
    }
}
`);

NJ('mixin', 'mixin_config.json', `{
    // ============================================================
    // Mixin 配置 - NeoForge 1.21.1
    // ============================================================
    // 实际位置：src/main/resources/examplemod.mixins.json
    // 注册方式：neoforge.mods.toml 中添加
    //   [[mixins]]
    //   config="examplemod.mixins.json"
    // refmap 由 Mixin 注解处理器在构建期生成（ModDevGradle 已自动配置）。
    // ============================================================
    "required": true,
    "package": "com.example.examplemod.mixin",
    "compatibilityLevel": "JAVA_17",
    "refmap": "examplemod.refmap.json",
    // 通用端 Mixin（不含 Client/Server 前缀类）
    "mixins": [
        "ExampleInjectMixin",
        "ExampleModifyArgMixin"
    ],
    // 仅客户端 Mixin
    "client": [
    ],
    "injectors": {
        // defaultRequire=1：注入点不匹配时报错而非静默跳过
        "defaultRequire": 1
    }
}
`);

NJ('recipe', 'shaped_recipe.json', `{
    // ============================================================
    // 有序合成 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/recipe/shaped_recipe.json
    // 注意：1.21 起目录名改为单数 recipe（1.20.x 是 recipes）。
    // crafting_shaped：pattern 定形状，key 定符号对应的材料。
    // ============================================================
    "type": "minecraft:crafting_shaped",
    // 3 行 3 列；空格表示该格留空
    "pattern": [
        "###",
        "#X#",
        "###"
    ],
    // key：pattern 中出现的符号（除空格外）都要在此定义
    "key": {
        "#": { "item": "minecraft:diamond" },
        "X": { "item": "minecraft:nether_star" }
    },
    // result：1.20.5+ 产物用 "id" 字段（不再是 "item"）
    "result": {
        "id": "examplemod:example_item",
        "count": 1
    }
}
`);

NJ('recipe', 'shapeless_recipe.json', `{
    // ============================================================
    // 无序合成 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/recipe/shapeless_recipe.json
    // crafting_shapeless：只看材料集合，不看摆放位置。
    // ============================================================
    "type": "minecraft:crafting_shapeless",
    // ingredients：材料列表；每项用 "item" 或 "tag"
    "ingredients": [
        { "item": "minecraft:diamond" },
        { "item": "minecraft:emerald" },
        { "tag": "minecraft:logs" }
    ],
    // 1.20.5+ 产物用 "id" 字段
    "result": {
        "id": "examplemod:example_item",
        "count": 1
    }
}
`);

NJ('recipe', 'smelting_recipe.json', `{
    // ============================================================
    // 熔炼 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/recipe/smelting_recipe.json
    // 同族类型：blasting（高炉）/ smoking（烟熏）/ campfire_cooking（营火）。
    // ============================================================
    "type": "minecraft:smelting",
    // ingredient：可用 "item" 或 "tag"
    "ingredient": {
        "item": "minecraft:raw_iron"
    },
    // result：熔炼产物是纯字符串 ID
    "result": "examplemod:example_ingot",
    // experience：熔炼一次所得经验
    "experience": 0.7,
    // cookingtime：单位 tick（200 = 10 秒）
    "cookingtime": 200
}
`);

NJ('recipe', 'smithing_recipe.json', `{
    // ============================================================
    // 锻造台 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/recipe/smithing_recipe.json
    // 1.20+ 拆分为 smithing_transform（升级/转换）与 smithing_trim（盔甲纹饰）。
    // ============================================================
    "type": "minecraft:smithing_transform",
    // template：锻造模板
    "template": {
        "item": "minecraft:netherite_upgrade_smithing_template"
    },
    // base：被升级的基础物品
    "base": {
        "item": "minecraft:diamond_sword"
    },
    // addition：升级材料
    "addition": {
        "item": "minecraft:netherite_ingot"
    },
    // result：纯字符串 ID
    "result": "minecraft:netherite_sword"
}
`);

NJ('recipe', 'stonecutting_recipe.json', `{
    // ============================================================
    // 切石 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/recipe/stonecutting_recipe.json
    // 1 输入 1 输出，无消耗无经验。
    // ============================================================
    "type": "minecraft:stonecutting",
    "ingredient": {
        "item": "minecraft:stone"
    },
    // result：纯字符串 ID；count 为产出数量
    "result": "examplemod:example_block",
    "count": 1
}
`);

NJ('tag', 'block_tag.json', `{
    // ============================================================
    // 方块标签 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/tags/block/example_block_tag.json
    // 注意：1.21 起标签目录改为单数（tags/block、tags/item、tags/entity）。
    // 常用原版标签：minecraft:mineable/pickaxe、minecraft:needs_iron_tool 等。
    // 想把内容并入原版标签，就把文件建到 data/minecraft/tags/block/<tag>.json。
    // ============================================================
    "replace": false,
    "values": [
        "minecraft:diamond_block",
        "minecraft:emerald_block",
        "examplemod:example_block"
    ]
}
`);

NJ('tag', 'item_tag.json', `{
    // ============================================================
    // 物品标签 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/tags/item/example_item_tag.json
    // 配方可直接引用标签："tag": "examplemod:example_item_tag"。
    // ============================================================
    "replace": false,
    "values": [
        "minecraft:diamond",
        "minecraft:emerald",
        "examplemod:example_item"
    ]
}
`);

NJ('tag', 'entity_tag.json', `{
    // ============================================================
    // 实体标签 - NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/tags/entity/example_entity_tag.json
    // 常用原版标签：minecraft:skeletons 等。
    // ============================================================
    "replace": false,
    "values": [
        "minecraft:cow",
        "examplemod:example_entity"
    ]
}
`);

NJ('worldgen', 'biome_modifier.json', `{
    // ============================================================
    // 群系修改（刷怪生成）- NeoForge 1.21.1
    // ============================================================
    // 位置：data/examplemod/neoforge/biome_modifier/add_example_spawns.json
    // 注意路径：NeoForge 专属 serializer 放在 data/<modid>/neoforge/biome_modifier/ 下。
    // 可用类型：
    // - neoforge:add_spawns     追加生物生成（本文件）
    // - neoforge:remove_spawns  移除生物生成（spawners 填要移除的实体）
    // - neoforge:add_features   注入矿物/植被等（见 ore_feature.java 尾部注释）
    // ============================================================
    "type": "neoforge:add_spawns",
    // 生效群系：可用单个 ID、列表或标签（#minecraft:is_overworld 等）
    "biomes": "#minecraft:is_overworld",
    // 也可以写成 spawners 数组一次加多个
    "spawners": {
        "type": "examplemod:example_entity",
        "weight": 100,      // 权重（对比原版羊 12、僵尸 95）
        "minCount": 4,      // 每次生成数量下限
        "maxCount": 8       // 上限
    }
}
`);

NJ('worldgen', 'ore_feature.java', `package com.example.examplemod.worldgen;

import com.example.examplemod.ModMain;
import net.minecraft.core.Holder;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.VerticalAnchor;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.levelgen.feature.Feature;
import net.minecraft.world.level.levelgen.feature.OreFeatures;
import net.minecraft.world.level.levelgen.feature.configurations.OreConfiguration;
import net.minecraft.world.level.levelgen.placement.BiomeFilter;
import net.minecraft.world.level.levelgen.placement.CountPlacement;
import net.minecraft.world.level.levelgen.placement.HeightRangePlacement;
import net.minecraft.world.level.levelgen.placement.InSquarePlacement;
import net.minecraft.world.level.levelgen.placement.PlacedFeature;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

import java.util.List;

/**
 * 矿物生成（NeoForge 1.21.1）。
 * 要点：
 * - 代码方式：DeferredRegister 分别登记 ConfiguredFeature 与 PlacedFeature
 *   （Registries.CONFIGURED_FEATURE / PLACED_FEATURE）。
 * - 仅注册两个 Feature 还不够，必须再用 biome modifier JSON 注入群系：
 *     data/examplemod/neoforge/biome_modifier/add_ore_example.json
 *     {"type":"neoforge:add_features","biomes":"#minecraft:is_overworld","features":"examplemod:ore_example","step":"underground_ores"}
 * - 更推荐 runData 数据生成直接产出 JSON；本模板展示代码路径便于理解。
 */
public class ModWorldGen {
    public static final DeferredRegister<ConfiguredFeature<?, ?>> CONFIGURED_FEATURES =
            DeferredRegister.create(Registries.CONFIGURED_FEATURE, ModMain.MOD_ID);
    public static final DeferredRegister<PlacedFeature> PLACED_FEATURES =
            DeferredRegister.create(Registries.PLACED_FEATURE, ModMain.MOD_ID);

    /** 矿脉形状与矿物：size 9，替换石系方块，替换为铁块（示例）。 */
    public static final DeferredHolder<ConfiguredFeature<?, ?>, ConfiguredFeature<?, ?>> ORE_EXAMPLE_CF =
            CONFIGURED_FEATURES.register("ore_example",
                    () -> new ConfiguredFeature<>(Feature.ORE, new OreConfiguration(
                            // Mojmap 类名为 OreConfiguration（OreFeatureConfig 是 Yarn 名）；
                            // 规则测试常量 STONE_ORE_REPLACEABLES 在 OreFeatures 类上
                            OreFeatures.STONE_ORE_REPLACEABLES,
                            Blocks.IRON_BLOCK.defaultBlockState(),
                            9)));

    /** 放置规则：每区块 20 次尝试，Y -64~64 均匀分布。 */
    public static final DeferredHolder<PlacedFeature, PlacedFeature> ORE_EXAMPLE_PF =
            PLACED_FEATURES.register("ore_example",
                    () -> new PlacedFeature(Holder.direct(ORE_EXAMPLE_CF.get()), List.of(
                            CountPlacement.of(20),                       // 每区块尝试次数
                            InSquarePlacement.spread(),                  // 水平随机扩散
                            HeightRangePlacement.uniform(
                                    VerticalAnchor.bottom(),             // 世界底部
                                    VerticalAnchor.absolute(64)),        // Y=64
                            BiomeFilter.biome())));                      // 尾部必须带生物群系过滤
}
`);

// ============================================================================
// 实体自由代码范式：forge/1.20.1 与 fabric/1.20.1/entity/freeform 一一对应
// ============================================================================
FJ('entity', 'custom_goal_container_interaction.java', `package com.example.examplemod.entity.ai;

import java.util.EnumSet;

import net.minecraft.core.BlockPos;
import net.minecraft.world.Container;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 自定义 Goal 范式：容器交互（定位容器 → 走近 → 打开 → 取物）。
 * Forge 1.20.1 / Mojmap。
 *
 * 要点：
 * 1. Forge 侧 Goal 生命周期方法名与 Yarn 不同：canUse → start → tick
 *    → canContinueToUse → stop，语义与 Fabric 的 canStart/shouldContinue 一致。
 * 2. setFlags(EnumSet.of(Goal.Flag.MOVE, Goal.Flag.LOOK)) 声明本 Goal
 *    占用移动与视线，避免与其他 Goal 冲突。
 * 3. 容器必须经 ChestBlock.getContainer(...) 处理双箱合并，
 *    再回落 BlockEntity instanceof Container，禁止直接强转 BlockEntity。
 * 4. BlockPos.betweenClosed 返回可变复用对象，存储前必须 immutable()。
 */
public class ContainerInteractionGoal extends Goal {

    private final PathfinderMob entity;
    private final double speed;
    private final int searchRange;
    private final int maxTake;
    private int cooldown;
    private BlockPos targetPos;

    public ContainerInteractionGoal(PathfinderMob entity, double speed, int searchRange, int maxTake) {
        this.entity = entity;
        this.speed = speed;
        this.searchRange = searchRange;
        this.maxTake = maxTake;
        this.setFlags(EnumSet.of(Goal.Flag.MOVE, Goal.Flag.LOOK));
    }

    @Override
    public boolean canUse() {
        if (this.cooldown > 0) {
            this.cooldown--;
            return false;
        }
        this.targetPos = this.findContainer();
        return this.targetPos != null;
    }

    @Override
    public void start() {
        this.entity.getNavigation().moveTo(
                this.targetPos.getX() + 0.5,
                this.targetPos.getY(),
                this.targetPos.getZ() + 0.5,
                this.speed);
    }

    @Override
    public boolean canContinueToUse() {
        return this.targetPos != null && !this.entity.getNavigation().isDone();
    }

    @Override
    public void tick() {
        if (this.targetPos == null) return;
        this.entity.getLookControl().setLookAt(
                this.targetPos.getX() + 0.5,
                this.targetPos.getY() + 0.5,
                this.targetPos.getZ() + 0.5);
        if (this.entity.blockPosition().closerThan(this.targetPos, 2.0)) {
            this.takeFromContainer(this.targetPos);
            this.cooldown = 200; // 10 秒冷却，防止每刻重复取物
            this.stop();
        }
    }

    @Override
    public void stop() {
        this.targetPos = null;
        this.entity.getNavigation().stop();
    }

    /** 以实体为中心立方体扫描容器方块；命中即返回不可变坐标 */
    private BlockPos findContainer() {
        BlockPos origin = this.entity.blockPosition();
        Level level = this.entity.level();
        for (BlockPos pos : BlockPos.betweenClosed(
                origin.offset(-this.searchRange, -2, -this.searchRange),
                origin.offset(this.searchRange, 2, this.searchRange))) {
            if (this.containerAt(level, pos) != null) {
                return pos.immutable(); // betweenClosed 复用可变对象，必须固化
            }
        }
        return null;
    }

    /** 双箱经 ChestBlock.getContainer 合并取整；单容器回落 BlockEntity instanceof */
    private Container containerAt(Level level, BlockPos pos) {
        BlockState state = level.getBlockState(pos);
        if (state.getBlock() instanceof ChestBlock chest) {
            return ChestBlock.getContainer(chest, state, level, pos, true);
        }
        BlockEntity blockEntity = level.getBlockEntity(pos);
        return blockEntity instanceof Container container ? container : null;
    }

    /** 从第一个非空槽位取最多 maxTake 个物品并装备到主手（可改为存入自定义背包） */
    private void takeFromContainer(BlockPos pos) {
        Container container = this.containerAt(this.entity.level(), pos);
        if (container == null) return;
        for (int slot = 0; slot < container.getContainerSize(); slot++) {
            ItemStack stack = container.getItem(slot);
            if (stack.isEmpty()) continue;
            ItemStack taken = container.removeItem(slot, Math.min(stack.getCount(), this.maxTake));
            this.entity.setItemSlot(EquipmentSlot.MAINHAND, taken);
            container.setChanged(); // 不写回会导致存档不同步
            return;
        }
    }
}
`);

FJ('entity', 'custom_goal_stateful_behavior.java', `package com.example.examplemod.entity.ai;

import java.util.EnumSet;

import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/**
 * 自定义 Goal 范式：带状态/携带物的多阶段行为（得手 → 脱离 → 完成）。
 * Forge 1.20.1 / Mojmap。
 *
 * 要点：
 * 1. 状态机集中在 tick() 内推进，canUse 只做「是否进入第一阶段」的判定；
 *    canContinueToUse 依据当前阶段决定 Goal 是否存活。
 * 2. 阶段转移必须写清终止条件（到达/超时/被击中），否则 Goal 永远占控。
 * 3. 携带物（如主手物品）是实体状态而非 Goal 局部变量——其他 Goal/渲染器
 *    可直接读取实体装备槽，天然跨系统可见。
 * 4. stop() 必须幂等收尾：清导航、复位阶段，防止实体卡死在半途中。
 */
public class StatefulFleeGoal extends Goal {

    /** 阶段定义：得手后逃跑（FLEE）→ 拉开距离后游荡收尾（SETTLE）→ 结束（DONE） */
    private enum Stage { FLEE, SETTLE, DONE }

    private final PathfinderMob entity;
    private final double fleeSpeed;
    private final double safeDistance;
    private Stage stage = Stage.DONE;
    private int settleTicks;

    public StatefulFleeGoal(PathfinderMob entity, double fleeSpeed, double safeDistance) {
        this.entity = entity;
        this.fleeSpeed = fleeSpeed;
        this.safeDistance = safeDistance;
        this.setFlags(EnumSet.of(Goal.Flag.MOVE));
    }

    /** 进入条件：主手携带着物品（上一阶段行为留下的实体状态） */
    @Override
    public boolean canUse() {
        return !this.entity.getMainHandItem().isEmpty();
    }

    @Override
    public void start() {
        this.stage = Stage.FLEE;
        this.settleTicks = 0;
    }

    @Override
    public boolean canContinueToUse() {
        return this.stage != Stage.DONE && this.entity.isAlive();
    }

    @Override
    public void tick() {
        switch (this.stage) {
            case FLEE -> {
                Player player = this.entity.level().getNearestPlayer(this.entity, this.safeDistance);
                if (player == null) {
                    this.stage = Stage.SETTLE;
                    return;
                }
                // 远离玩家：取自身位置与玩家位置的反向延长点
                Vec3 away = this.entity.position().subtract(player.position())
                        .normalize().scale(this.safeDistance);
                Vec3 target = this.entity.position().add(away);
                this.entity.getNavigation().moveTo(target.x, target.y, target.z, this.fleeSpeed);
            }
            case SETTLE -> {
                // 拉开距离后原地观察片刻，随后结束（可改为传送离场/discard 等）
                if (++this.settleTicks >= 60) {
                    this.stage = Stage.DONE;
                }
            }
            default -> { /* DONE 不做事 */ }
        }
    }

    @Override
    public void stop() {
        this.stage = Stage.DONE;
        this.entity.getNavigation().stop();
    }
}
`);

FJ('entity', 'biped_model_extra_cube.java', `package com.example.examplemod.client.model;

import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeDeformation;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.world.entity.LivingEntity;

/**
 * 人形（Humanoid）模型 + 追加自定义部件范式（示例：背部赃物袋）。
 * Forge 1.20.1 / Mojmap。
 *
 * 要点：
 * 1. HumanoidModel.createMesh(CubeDeformation, float) 返回 MeshDefinition，
 *    已含 head/hat/body/左右臂/左右腿，再向指定部件 addOrReplaceChild 追加 cube——
 *    白得人形走路/挥臂动画（setupAnim 已由父类实现）。
 * 2. 追加部件的 texOffs 必须落在贴图画布内（本例 64×64 人形皮肤布局，
 *    texOffs(40,16) 起一块 6×6×4 的盒子），自建皮肤时按实际画布调整。
 * 3. 追加部件挂到 body 下会随躯干联动；挂到 head/arm 同理，按语义选择父部件。
 * 4. 渲染层经 EntityRenderersEvent.RegisterLayerDefinitions 注册本类的
 *    createBodyLayer，纹理尺寸必须与 LayerDefinition.create(mesh, 64, 64) 一致。
 */
public class ExampleBipedModel<T extends LivingEntity> extends HumanoidModel<T> {

    public ExampleBipedModel(ModelPart root) {
        super(root);
    }

    public static LayerDefinition createBodyLayer() {
        // 标准人形骨架（无膨胀、零偏移）
        MeshDefinition mesh = HumanoidModel.createMesh(CubeDeformation.NONE, 0.0f);
        // 向躯干追加一个 6×6×4 的背部口袋（texOffs 40,16，64×64 画布内）
        PartDefinition body = mesh.getRoot().getChild("body");
        body.addOrReplaceChild("loot_sack",
                CubeListBuilder.create()
                        .texOffs(40, 16)
                        .addBox(-3.0f, 6.0f, 2.5f, 6.0f, 6.0f, 4.0f),
                PartPose.ZERO);
        return LayerDefinition.create(mesh, 64, 64);
    }
}
`);

FJ('entity', 'entity_renderer_client_reg.java', `package com.example.examplemod.client.render;

import com.example.examplemod.ModMain;
import com.example.examplemod.client.model.ExampleBipedModel;
import com.example.examplemod.entity.ModEntities;

import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.ResourceLocation;

/**
 * 实体渲染器 + 客户端注册范式。
 * Forge 1.20.1 / Mojmap。
 *
 * 要点：
 * 1. 渲染器只负责「模型 + 贴图 + 影子半径」，泛型为 <实体, 模型>。
 * 2. 模型层 ModelLayerLocation 与渲染器必须成对注册：漏注册模型层，
 *    bakeLayer 会在运行期抛「Missing model layer」。
 * 3. 全部渲染注册只能走 MOD 总线 + Dist.CLIENT 的 EntityRenderersEvent，
 *    写进通用初始化代码会让 dedicated server 加载客户端类而崩溃。
 * 4. 贴图路径约定 assets/<modid>/textures/entity/<entity_id>.png。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, ExampleBipedModel<ModEntities.ExampleEntity>> {

    private static final ResourceLocation TEXTURE =
            new ResourceLocation(ModMain.MOD_ID, "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererProvider.Context context) {
        super(context, new ExampleBipedModel<>(context.bakeLayer(ModClient.EXAMPLE_LAYER)), 0.5f);
    }

    @Override
    public ResourceLocation getTextureLocation(ModEntities.ExampleEntity entity) {
        return TEXTURE;
    }
}

/* ============================================================================
 * 客户端注册（src/main/java/com/example/examplemod/client/ModClient.java）
 * —— 与 project/ModClient.java 的骨架合并，MOD 总线 + Dist.CLIENT
 * ============================================================================
 *
 * package com.example.examplemod.client;
 *
 * import com.example.examplemod.ModMain;
 * import com.example.examplemod.client.model.ExampleBipedModel;
 * import com.example.examplemod.client.render.ExampleEntityRenderer;
 * import com.example.examplemod.entity.ModEntities;
 * import net.minecraft.client.model.geom.ModelLayerLocation;
 * import net.minecraft.resources.ResourceLocation;
 * import net.minecraftforge.api.distmarker.Dist;
 * import net.minecraftforge.client.event.EntityRenderersEvent;
 * import net.minecraftforge.eventbus.api.SubscribeEvent;
 * import net.minecraftforge.fml.common.Mod;
 *
 * @Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
 * public final class ModClient {
 *
 *     public static final ModelLayerLocation EXAMPLE_LAYER =
 *             new ModelLayerLocation(new ResourceLocation(ModMain.MOD_ID, "example_entity"), "main");
 *
 *     private ModClient() {}
 *
 *     @SubscribeEvent
 *     public static void registerLayerDefinitions(EntityRenderersEvent.RegisterLayerDefinitions event) {
 *         event.registerLayerDefinition(EXAMPLE_LAYER, ExampleBipedModel::createBodyLayer);
 *     }
 *
 *     @SubscribeEvent
 *     public static void registerRenderers(EntityRenderersEvent.RegisterRenderers event) {
 *         event.registerEntityRenderer(ModEntities.EXAMPLE_ENTITY.get(), ExampleEntityRenderer::new);
 *     }
 * }
 */
`);

FJ('entity', 'spawn_egg_natural_spawn.java', `package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.world.entity.SpawnPlacements;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.levelgen.Heightmap;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 刷怪蛋 + 自然生成注册范式。
 * Forge 1.20.1 / Mojmap。
 *
 * 要点：
 * 1. 1.20.1 用原版 SpawnEggItem(EntityType, 主色, 副色, Item.Properties)；
 *    Supplier 延迟取值避免注册顺序死锁。
 * 2. 自然生成两步缺一不可：
 *    ① SpawnPlacements.register 声明生成位置/高度图/谓词（FMLCommonSetupEvent 内），
 *    ② 数据包 biome modifier（data/<modid>/forge/biome_modifier/*.json）把实体加进群系生成表。
 *    只做 ① 会出现「注册正常但永远不刷」。
 * 3. MobCategory 必须语义正确：MONSTER 走 hostile 上限与光照规则，
 *    CREATURE 走被动生物规则；选错同样表现为「永远不刷」。
 * 4. 群系生成表必须用 JSON 声明，禁止在代码里直接改 Biome。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)
public final class ModSpawns {

    public static final DeferredRegister<Item> SPAWN_EGGS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_SPAWN_EGG = SPAWN_EGGS.register("example_spawn_egg",
            () -> new net.minecraft.world.item.SpawnEggItem(() -> ModEntities.EXAMPLE_ENTITY.get(),
                    0x2B2B3A, 0xE8C468, new Item.Properties()));

    private ModSpawns() {}

    @SubscribeEvent
    public static void onCommonSetup(FMLCommonSetupEvent event) {
        // ① 生成限制：地面、无树叶遮挡、脚下实心
        event.enqueueWork(() -> SpawnPlacements.register(
                ModEntities.EXAMPLE_ENTITY.get(),
                SpawnPlacements.Type.ON_GROUND,
                Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
                (type, level, reason, pos, random) -> level.getBlockState(pos.below()).isSolid()));
    }
}

/* ============================================================================
 * ② 群系生成表（src/main/resources/data/<modid>/forge/biome_modifier/add_example_spawn.json）
 * ============================================================================
 *
 * {
 *   "type": "forge:add_spawns",
 *   "biomes": ["minecraft:plains", "minecraft:forest"],
 *   "spawners": [
 *     { "type": "examplemod:example_entity", "weight": 20, "minCount": 1, "maxCount": 1 }
 *   ]
 * }
 */
`);

// ============================================================================
// 实体自由代码范式：neoforge/1.21.1 与 fabric/1.20.1/entity/freeform 一一对应
// ============================================================================
NJ('entity', 'custom_goal_container_interaction.java', `package com.example.examplemod.entity.ai;

import java.util.EnumSet;

import net.minecraft.core.BlockPos;
import net.minecraft.world.Container;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.ChestBlock;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

/**
 * 自定义 Goal 范式：容器交互（定位容器 → 走近 → 打开 → 取物）。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. Goal 生命周期为 canUse → start → tick → canContinueToUse → stop。
 * 2. setFlags(EnumSet.of(Goal.Flag.MOVE, Goal.Flag.LOOK)) 声明占用移动与视线。
 * 3. 容器必须经 ChestBlock.getContainer(...) 处理双箱合并，
 *    再回落 BlockEntity instanceof Container，禁止直接强转 BlockEntity。
 * 4. BlockPos.betweenClosed 返回可变复用对象，存储前必须 immutable()。
 */
public class ContainerInteractionGoal extends Goal {

    private final PathfinderMob entity;
    private final double speed;
    private final int searchRange;
    private final int maxTake;
    private int cooldown;
    private BlockPos targetPos;

    public ContainerInteractionGoal(PathfinderMob entity, double speed, int searchRange, int maxTake) {
        this.entity = entity;
        this.speed = speed;
        this.searchRange = searchRange;
        this.maxTake = maxTake;
        this.setFlags(EnumSet.of(Goal.Flag.MOVE, Goal.Flag.LOOK));
    }

    @Override
    public boolean canUse() {
        if (this.cooldown > 0) {
            this.cooldown--;
            return false;
        }
        this.targetPos = this.findContainer();
        return this.targetPos != null;
    }

    @Override
    public void start() {
        this.entity.getNavigation().moveTo(
                this.targetPos.getX() + 0.5,
                this.targetPos.getY(),
                this.targetPos.getZ() + 0.5,
                this.speed);
    }

    @Override
    public boolean canContinueToUse() {
        return this.targetPos != null && !this.entity.getNavigation().isDone();
    }

    @Override
    public void tick() {
        if (this.targetPos == null) return;
        this.entity.getLookControl().setLookAt(
                this.targetPos.getX() + 0.5,
                this.targetPos.getY() + 0.5,
                this.targetPos.getZ() + 0.5);
        if (this.entity.blockPosition().closerThan(this.targetPos, 2.0)) {
            this.takeFromContainer(this.targetPos);
            this.cooldown = 200; // 10 秒冷却，防止每刻重复取物
            this.stop();
        }
    }

    @Override
    public void stop() {
        this.targetPos = null;
        this.entity.getNavigation().stop();
    }

    /** 以实体为中心立方体扫描容器方块；命中即返回不可变坐标 */
    private BlockPos findContainer() {
        BlockPos origin = this.entity.blockPosition();
        Level level = this.entity.level();
        for (BlockPos pos : BlockPos.betweenClosed(
                origin.offset(-this.searchRange, -2, -this.searchRange),
                origin.offset(this.searchRange, 2, this.searchRange))) {
            if (this.containerAt(level, pos) != null) {
                return pos.immutable();
            }
        }
        return null;
    }

    /** 双箱经 ChestBlock.getContainer 合并取整；单容器回落 BlockEntity instanceof */
    private Container containerAt(Level level, BlockPos pos) {
        BlockState state = level.getBlockState(pos);
        if (state.getBlock() instanceof ChestBlock chest) {
            return ChestBlock.getContainer(chest, state, level, pos, true);
        }
        BlockEntity blockEntity = level.getBlockEntity(pos);
        return blockEntity instanceof Container container ? container : null;
    }

    /** 从第一个非空槽位取最多 maxTake 个物品并装备到主手 */
    private void takeFromContainer(BlockPos pos) {
        Container container = this.containerAt(this.entity.level(), pos);
        if (container == null) return;
        for (int slot = 0; slot < container.getContainerSize(); slot++) {
            ItemStack stack = container.getItem(slot);
            if (stack.isEmpty()) continue;
            ItemStack taken = container.removeItem(slot, Math.min(stack.getCount(), this.maxTake));
            this.entity.setItemSlot(EquipmentSlot.MAINHAND, taken);
            container.setChanged();
            return;
        }
    }
}
`);

NJ('entity', 'custom_goal_stateful_behavior.java', `package com.example.examplemod.entity.ai;

import java.util.EnumSet;

import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

/**
 * 自定义 Goal 范式：带状态/携带物的多阶段行为（得手 → 脱离 → 完成）。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. 状态机集中在 tick() 内推进，canUse 只做「是否进入第一阶段」的判定。
 * 2. 阶段转移必须写清终止条件（到达/超时/被击中），否则 Goal 永远占控。
 * 3. 携带物是实体状态（主手装备槽）而非 Goal 局部变量，跨系统天然可见。
 * 4. stop() 必须幂等收尾：清导航、复位阶段。
 */
public class StatefulFleeGoal extends Goal {

    private enum Stage { FLEE, SETTLE, DONE }

    private final PathfinderMob entity;
    private final double fleeSpeed;
    private final double safeDistance;
    private Stage stage = Stage.DONE;
    private int settleTicks;

    public StatefulFleeGoal(PathfinderMob entity, double fleeSpeed, double safeDistance) {
        this.entity = entity;
        this.fleeSpeed = fleeSpeed;
        this.safeDistance = safeDistance;
        this.setFlags(EnumSet.of(Goal.Flag.MOVE));
    }

    @Override
    public boolean canUse() {
        return !this.entity.getMainHandItem().isEmpty();
    }

    @Override
    public void start() {
        this.stage = Stage.FLEE;
        this.settleTicks = 0;
    }

    @Override
    public boolean canContinueToUse() {
        return this.stage != Stage.DONE && this.entity.isAlive();
    }

    @Override
    public void tick() {
        switch (this.stage) {
            case FLEE -> {
                Player player = this.entity.level().getNearestPlayer(this.entity, this.safeDistance);
                if (player == null) {
                    this.stage = Stage.SETTLE;
                    return;
                }
                Vec3 away = this.entity.position().subtract(player.position())
                        .normalize().scale(this.safeDistance);
                Vec3 target = this.entity.position().add(away);
                this.entity.getNavigation().moveTo(target.x, target.y, target.z, this.fleeSpeed);
            }
            case SETTLE -> {
                if (++this.settleTicks >= 60) {
                    this.stage = Stage.DONE;
                }
            }
            default -> { /* DONE 不做事 */ }
        }
    }

    @Override
    public void stop() {
        this.stage = Stage.DONE;
        this.entity.getNavigation().stop();
    }
}
`);

NJ('entity', 'biped_model_extra_cube.java', `package com.example.examplemod.client.model;

import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeDeformation;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.world.entity.LivingEntity;

/**
 * 人形（Humanoid）模型 + 追加自定义部件范式（示例：背部赃物袋）。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. HumanoidModel.createMesh(CubeDeformation, float) 返回 MeshDefinition，
 *    已含 head/hat/body/左右臂/左右腿，再向指定部件 addOrReplaceChild 追加 cube。
 * 2. 追加部件的 texOffs 必须落在贴图画布内（本例 64×64，texOffs(40,16) 起 6×6×4 盒子）。
 * 3. 追加部件挂到 body 下随躯干联动；按语义选择父部件（head/arm 同理）。
 * 4. 渲染层经 EntityRenderersEvent.RegisterLayerDefinitions 注册 createBodyLayer，
 *    纹理尺寸必须与 LayerDefinition.create(mesh, 64, 64) 一致。
 * 5. 1.21 起 ResourceLocation 构造器私有，注册命名空间时用 fromNamespaceAndPath。
 */
public class ExampleBipedModel<T extends LivingEntity> extends HumanoidModel<T> {

    public ExampleBipedModel(ModelPart root) {
        super(root);
    }

    public static LayerDefinition createBodyLayer() {
        MeshDefinition mesh = HumanoidModel.createMesh(CubeDeformation.NONE, 0.0f);
        PartDefinition body = mesh.getRoot().getChild("body");
        body.addOrReplaceChild("loot_sack",
                CubeListBuilder.create()
                        .texOffs(40, 16)
                        .addBox(-3.0f, 6.0f, 2.5f, 6.0f, 6.0f, 4.0f),
                PartPose.ZERO);
        return LayerDefinition.create(mesh, 64, 64);
    }
}
`);

NJ('entity', 'entity_renderer_client_reg.java', `package com.example.examplemod.client.render;

import com.example.examplemod.ModMain;
import com.example.examplemod.client.model.ExampleBipedModel;
import com.example.examplemod.entity.ModEntities;

import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.ResourceLocation;

/**
 * 实体渲染器 + 客户端注册范式。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. 渲染器只负责「模型 + 贴图 + 影子半径」，泛型为 <实体, 模型>。
 * 2. 模型层 ModelLayerLocation 与渲染器必须成对注册，漏注册模型层运行期直接崩溃。
 * 3. 渲染注册只走 MOD 总线的 EntityRenderersEvent，禁止写进通用初始化代码。
 * 4. 1.21 起 ResourceLocation 用 fromNamespaceAndPath。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, ExampleBipedModel<ModEntities.ExampleEntity>> {

    private static final ResourceLocation TEXTURE =
            ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererProvider.Context context) {
        super(context, new ExampleBipedModel<>(context.bakeLayer(ModClient.EXAMPLE_LAYER)), 0.5f);
    }

    @Override
    public ResourceLocation getTextureLocation(ModEntities.ExampleEntity entity) {
        return TEXTURE;
    }
}

/* ============================================================================
 * 客户端注册（src/main/java/com/example/examplemod/client/ModClient.java）
 * —— 与 project/ModClient.java 的骨架合并，MOD 总线事件
 * ============================================================================
 *
 * package com.example.examplemod.client;
 *
 * import com.example.examplemod.ModMain;
 * import com.example.examplemod.client.model.ExampleBipedModel;
 * import com.example.examplemod.client.render.ExampleEntityRenderer;
 * import com.example.examplemod.entity.ModEntities;
 * import net.minecraft.client.model.geom.ModelLayerLocation;
 * import net.minecraft.resources.ResourceLocation;
 * import net.neoforged.bus.api.SubscribeEvent;
 * import net.neoforged.fml.common.EventBusSubscriber;
 * import net.neoforged.neoforge.client.event.EntityRenderersEvent;
 *
 * @EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
 * public final class ModClient {
 *
 *     public static final ModelLayerLocation EXAMPLE_LAYER = new ModelLayerLocation(
 *             ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "example_entity"), "main");
 *
 *     private ModClient() {}
 *
 *     @SubscribeEvent
 *     public static void registerLayerDefinitions(EntityRenderersEvent.RegisterLayerDefinitions event) {
 *         event.registerLayerDefinition(EXAMPLE_LAYER, ExampleBipedModel::createBodyLayer);
 *     }
 *
 *     @SubscribeEvent
 *     public static void registerRenderers(EntityRenderersEvent.RegisterRenderers event) {
 *         event.registerEntityRenderer(ModEntities.EXAMPLE_ENTITY.get(), ExampleEntityRenderer::new);
 *     }
 * }
 */
`);

NJ('entity', 'spawn_egg_natural_spawn.java', `package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.world.entity.SpawnPlacements;
import net.minecraft.world.level.levelgen.Heightmap;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.SpawnPlacementRegisterEvent;

/**
 * 刷怪蛋 + 自然生成注册范式。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. 刷怪蛋沿用 DeferredSpawnEggItem（延迟取 EntityType，见 entity/spawn_egg_item.java）。
 * 2. 自然生成两步缺一不可：
 *    ① SpawnPlacementRegisterEvent 声明生成位置/高度图/谓词，
 *    ② 数据包 biome modifier（data/<modid>/neoforge/biome_modifier/*.json）把实体加进群系生成表。
 * 3. MobCategory 必须语义正确，选错表现为「一切正常但永远不刷」。
 * 4. 群系生成表必须用 JSON 声明，禁止在代码里直接改 Biome。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
public final class ModSpawns {

    private ModSpawns() {}

    @SubscribeEvent
    public static void registerSpawnPlacements(SpawnPlacementRegisterEvent event) {
        // ① 生成限制：地面、无树叶遮挡、脚下实心
        event.register(
                ModEntities.EXAMPLE_ENTITY.get(),
                SpawnPlacements.Type.ON_GROUND,
                Heightmap.Types.MOTION_BLOCKING_NO_LEAVES,
                (type, level, reason, pos, random) -> level.getBlockState(pos.below()).isSolid(),
                SpawnPlacementRegisterEvent.Operation.REPLACE);
    }
}

/* ============================================================================
 * ② 群系生成表（src/main/resources/data/<modid>/neoforge/biome_modifier/add_example_spawn.json）
 * ============================================================================
 *
 * {
 *   "type": "neoforge:add_spawns",
 *   "biomes": ["minecraft:plains", "minecraft:forest"],
 *   "spawners": [
 *     { "type": "examplemod:example_entity", "weight": 20, "minCount": 1, "maxCount": 1 }
 *   ]
 * }
 */
`);

// ----------------------------------------------------------------------------
// 写盘
// ----------------------------------------------------------------------------
let written = 0;
for (const set of [forge, neo]) {
    for (const [rel, content] of Object.entries(set.files)) {
        const abs = join(TPL_ROOT, set.loader, set.version, ...rel.split('/'));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, 'utf8');
        written++;
    }
}

// ----------------------------------------------------------------------------
// 生成 manifest 片段
// ----------------------------------------------------------------------------
const fabricEntries = manifest.templates.filter(
    (t) => t.loader === 'fabric' && t.version === '1.20.1'
);
// 期望值不再硬编码：以 fabric/1.20.1 实际条目数为准，避免 manifest 扩容后本脚本静默过时
const EXPECTED_PER_LOADER = fabricEntries.length;
if (EXPECTED_PER_LOADER === 0) {
    console.error('[ERROR] fabric/1.20.1 模板条目为空，无法生成对应加载器模板');
    process.exit(1);
}
const fabricByKey = new Map(fabricEntries.map((t) => [`${t.type}/${t.filename}`, t]));

// fabric 条目中「Forge/NeoForge 侧不随本脚本生成」的部分：
// processing_block 系列涉及 Forge/NeoForge 的 ITickableBlockEntity 与能力（Capability）迁移，
// 逐行差异过大，改为两个加载器目录里手工维护；本脚本只校验存在性并生成对应 fragment 条目。
const MANUAL_KEYS = new Set([
    'block/processing_block.java',
    'block/processing_blockstate.json',
    'block/processing_model_on.json',
]);

// 跨加载器共享文档：内容与加载器无关，只存在一份，fragment 直接指向共享路径
const SHARED_FILES = new Set(['entity/geckolib-animations.md']);
const SHARED_PATH = 'templates/geckolib-animations.md';

// fabric -> 新 loader 的文件名映射（其余同 category 同文件名）
const RENAMES = {
    forge: { 'project/fabric.mod.json': 'project/mods.toml' },
    neoforge: {
        'project/fabric.mod.json': 'project/neoforge.mods.toml',
        'enchantment/custom_enchantment.java': 'enchantment/custom_enchantment.json',
    },
};
// Java 文件追加的 loader 惯用关键词
const EXTRA_KEYWORDS = {
    forge: ['DeferredRegister', 'RegistryObject', 'ForgeRegistries'],
    neoforge: ['DeferredRegister', 'DeferredHolder', 'EventBusSubscriber', 'neoforge.mods.toml'],
};

// 以 manifest 已有同 id 条目为基线：保留人工验收结论（verified/verifiedAt/build/active），
// 只刷新结构字段与关键词。全新条目才落到未验收状态，避免重跑脚本抹掉验证记录。
const existingById = new Map(manifest.templates.map((t) => [t.id, t]));
function withExistingBaseline(entry) {
    const base = existingById.get(entry.id);
    if (!base) {
        return { ...entry, verified: null, verifiedAt: null, build: 'pending', active: true };
    }
    return {
        ...entry,
        verified: base.verified ?? null,
        verifiedAt: base.verifiedAt ?? null,
        build: base.build ?? 'pending',
        active: base.active ?? true,
        provenance: base.provenance ?? entry.provenance,
    };
}

function buildFragment(set) {
    const renames = RENAMES[set.loader];
    const out = [];
    for (const t of fabricEntries) {
        const srcKey = `${t.type}/${t.filename}`;
        const dstKey = renames[srcKey] ?? srcKey;

        // 共享文档：不复制到各加载器目录，条目直接指向共享文件
        if (SHARED_FILES.has(srcKey)) {
            out.push(withExistingBaseline({
                id: `${set.loader}-${set.version}-${t.type}-${t.filename}`,
                loader: set.loader,
                version: set.version,
                type: t.type,
                file: SHARED_PATH,
                filename: t.filename,
                contentTypes: t.contentTypes,
                keywords: t.keywords,
                appliesTo: { loaders: [set.loader], mcVersions: [set.version] },
                provenance: 'hand-curated',
            }));
            continue;
        }

        if (!(dstKey in set.files)) {
            if (!MANUAL_KEYS.has(srcKey)) {
                throw new Error(`[${set.loader}] 缺少模板文件：${dstKey}`);
            }
            // 手工维护条目：只要求磁盘上真实存在，内容不由本脚本负责
            out.push(withExistingBaseline({
                id: `${set.loader}-${set.version}-${t.type}-${t.filename}`,
                loader: set.loader,
                version: set.version,
                type: t.type,
                file: `templates/${set.loader}/${set.version}/${dstKey}`,
                filename: t.filename,
                contentTypes: t.contentTypes,
                keywords: t.keywords,
                appliesTo: { loaders: [set.loader], mcVersions: [set.version] },
                provenance: 'mdk-adapted',
            }));
            continue;
        }
        const m = dstKey.match(/^(.+)\/([^/]+)$/);
        const dstCategory = m[1];
        const dstFilename = m[2];
        // 关键词只补该文件真实出现过的 loader 惯用词，避免给未使用的能力打标签
        const extra = dstFilename.endsWith('.java')
            ? EXTRA_KEYWORDS[set.loader].filter((k) => set.files[dstKey].includes(k))
            : [];
        const keywords = [...t.keywords, ...extra.filter((k) => !t.keywords.includes(k))];
        out.push(withExistingBaseline({
            id: `${set.loader}-${set.version}-${dstCategory}-${dstFilename}`,
            loader: set.loader,
            version: set.version,
            type: dstCategory,
            file: `templates/${set.loader}/${set.version}/${dstKey}`,
            filename: dstFilename,
            contentTypes: t.contentTypes,
            keywords,
            appliesTo: { loaders: [set.loader], mcVersions: [set.version] },
            provenance: 'mdk-adapted',
        }));
    }
    return out;
}

const fragment = [...buildFragment(forge), ...buildFragment(neo)];

// ----------------------------------------------------------------------------
// 自检：file 路径真实存在；JSON 内容可宽松解析（去掉 // 注释与尾逗号后 JSON.parse）
// ----------------------------------------------------------------------------
function lenientJsonParse(text) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inStr) {
            out += c;
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; out += c; continue; }
        if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i++;
            continue;
        }
        out += c;
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// 目录覆盖校验：模板目录下的每个文件都必须有对应的 fragment 条目，
// 防止手工新增（或删除条目时遗留）文件长期不被 AI 检索到。
const errors = [];
const errors2 = [];
let missing = 0;
let jsonChecked = 0;
const referenced = new Map();
for (const entry of fragment) {
    for (const set of [forge, neo]) {
        const prefix = `templates/${set.loader}/${set.version}/`;
        if (!entry.file.startsWith(prefix)) continue;
        if (!referenced.has(set.loader)) referenced.set(set.loader, new Set());
        referenced.get(set.loader).add(entry.file.slice(prefix.length));
    }
}
for (const set of [forge, neo]) {
    const dir = join(REF_DIR, 'templates', set.loader, set.version);
    if (!existsSync(dir)) continue;
    const refs = referenced.get(set.loader) ?? new Set();
    const walk = (current, rel) => {
        for (const e of readdirSync(current, { withFileTypes: true })) {
            const abs = join(current, e.name);
            const key = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                // 构建缓存不属于参考包内容
                if (e.name === '.gradle' || e.name === 'build' || e.name === '.git') continue;
                walk(abs, key);
            } else if (!refs.has(key)) {
                errors.push(`未被 fragment 引用：templates/${set.loader}/${set.version}/${key}`);
            }
        }
    };
    walk(dir, '');
}

for (const entry of fragment) {
    const abs = join(REF_DIR, ...entry.file.split('/'));
    if (!existsSync(abs)) {
        errors2.push(`缺失文件：${entry.file}`);
        missing++;
        continue;
    }
    if (entry.filename.endsWith('.json')) {
        try {
            lenientJsonParse(readFileSync(abs, 'utf8'));
            jsonChecked++;
        } catch (e) {
            errors2.push(`JSON 解析失败：${entry.file} -> ${e.message}`);
        }
    }
}

writeFileSync(FRAGMENT_PATH, JSON.stringify(fragment, null, 2) + '\n', 'utf8');

// ----------------------------------------------------------------------------
// 统计输出
// ----------------------------------------------------------------------------
const forgeCount = Object.keys(forge.files).length;
const neoCount = Object.keys(neo.files).length;
console.log('[gen-loader-templates] 完成');
console.log(`  forge/1.20.1    生成文件数：${forgeCount}（另含手工维护 ${MANUAL_KEYS.size} 个）`);
console.log(`  neoforge/1.21.1 生成文件数：${neoCount}（另含手工维护 ${MANUAL_KEYS.size} 个）`);
console.log(`  写盘总数：${written}`);
console.log(`  fragment 条数：${fragment.length} -> ${FRAGMENT_PATH.replace(REPO_ROOT + '\\', '')}`);
console.log(`  fragment file 路径校验：${fragment.length - missing}/${fragment.length} 存在`);
console.log(`  JSON 宽松解析自检：${jsonChecked} 个文件通过`);

const allErrors = [...errors, ...errors2];
if (allErrors.length) {
    console.error('[ERROR] 自检失败：');
    for (const e of allErrors) console.error('  - ' + e);
    process.exit(1);
}
for (const set of [forge, neo]) {
    const n = fragment.filter((e) => e.loader === set.loader).length;
    if (n !== EXPECTED_PER_LOADER) {
        console.error(
            `[ERROR] ${set.loader} fragment 条目数 ${n}，与 fabric/1.20.1 的 ${EXPECTED_PER_LOADER} 不一致`
        );
        process.exit(1);
    }
}
