<!--
  KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.21.1）
  provenance: translated-from-forge-1.20.1
  目标 loader=forge mc=1.21.1 loaderVersion=52.0.57
  注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
        加载器 DSL 在 1.21.1 上可能与种子版本存在差异，构建失败时
        请优先查阅 1.21.1 官方文档/Forge docs。
  verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
-->

[//]: # (KunYuEcosystem AI Reference v3.2 | forge/1.21.1/project/README.md | mapping: Mojang official | provenance: adapted from official loader MDK/docs)

# Forge 1.21.1 项目脚手架

KunYuEcosystem AI 参考包——Forge 1.21.1（Mojang 官方映射 / ForgeGradle 6）项目模板说明。

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
| mods.toml | modId=examplemod，[[mods]] 与 [[dependencies.examplemod]]（forge [47,)、minecraft [1.21.1,1.21)） |
| ModMain.java | @Mod 主类；构造器中把各 DeferredRegister 登记到 mod 事件总线，并监听 FMLCommonSetupEvent |
| ModClient.java | @Mod.EventBusSubscriber(Dist.CLIENT)：EntityRenderersEvent.RegisterRenderers 注册渲染器 |
| ModServer.java | 服务端事件订阅示例：ServerStartingEvent / ServerStoppingEvent |

## 版本对照

| 组件 | 版本 |
| --- | --- |
| Minecraft | 1.21.1 |
| Forge | 52.0.57 |
| ForgeGradle | [6.0.24,6.2) |
| Java | 21 |
| Gradle | 8.10.2（官方 MDK 配套，建议用 wrapper 固定） |

## 快速开始

    cd project
    gradle wrapper --gradle-version 8.10.2
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
