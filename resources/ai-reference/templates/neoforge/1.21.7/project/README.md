<!--
  KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.7）
  provenance: translated-from-neoforge-1.21.1
  目标 loader=neoforge mc=1.21.7 loaderVersion=21.7.25
  注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
        加载器 DSL 在 1.21.7 上可能与种子版本存在差异，构建失败时
        请优先查阅 1.21.7 官方文档/NeoForge docs。
  verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
-->

[//]: # (KunYuEcosystem AI Reference v3.2 | neoforge/1.21.7/project/README.md | mapping: Mojang official | provenance: adapted from official loader MDK/docs)

# NeoForge 1.21.7 项目脚手架

KunYuEcosystem AI 参考包——NeoForge 1.21.7（Mojang 官方映射 / ModDevGradle 2.x）项目模板说明。

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
| build.gradle | ModDevGradle 拉取 NeoForge 21.7.25、client/server/data 三个 run 配置、Java 21 工具链 |
| settings.gradle | pluginManagement 声明 NeoForged Maven 与 foojay 工具链解析器；rootProject.name 决定 jar 名 |
| gradle.properties | 构建内存 -Xmx3G、daemon=false、mod_version / minecraft_version / neoforge_version |
| neoforge.mods.toml | modId=examplemod；依赖用 type="required"（neoforge [21,)、minecraft [1.21.7]） |
| ModMain.java | @Mod 主类；构造器注入 IEventBus 并登记各 DeferredRegister，监听 FMLCommonSetupEvent |
| ModClient.java | @EventBusSubscriber(Dist.CLIENT)：EntityRenderersEvent.RegisterRenderers 注册渲染器 |
| ModServer.java | 服务端事件订阅示例：ServerStartingEvent / ServerStoppingEvent |

## 版本对照

| 组件 | 版本 |
| --- | --- |
| Minecraft | 1.21.7 |
| NeoForge | 21.7.25 |
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
