<!--
  KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/26.3）
  provenance: translated-from-fabric-1.20.1
  目标 loader=fabric mc=26.3 loaderVersion=0.19.5
  注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
        加载器 DSL 在 26.3 上可能与种子版本存在差异，构建失败时
        请优先查阅 26.3 官方文档/Fabric docs。
  verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
-->

[//]: # (KunYuEcosystem AI Reference v3.0 | fabric/26.3/project/README.md | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode))

# Fabric 26.3
 **Fabric 26.3 ** AI
 API  Minecraft 26.3 + Fabric
##
```
project/
├── build.gradle                                  # Gradle Groovy DSL
├── settings.gradle                               # Gradle  +
├── gradle.properties                             #
├── LICENSE                                       #  MITbuild.gradle  jar
├── README.md                                     #
└── src/main/
    ├── resources/
    │   └── fabric.mod.json                       #
    └── java/com/example/mod/
        ├── ModMain.java                          # main
        ├── ModClient.java                        # client
        └── ModServer.java                        # server
```
##
|  |  |
| --- | --- |
| `build.gradle` |  Loom Minecraft/Mojang 映射/Loader/Fabric API Java 25  `mod_version`  `fabric.mod.json`  `${version}`  |
| `settings.gradle` |  `pluginManagement` Fabric Maven  `fabric-loom` `rootProject.name` jar  |
| `gradle.properties` |  `mod_version``maven_group``minecraft_version``loader_version``fabric_version`（26.x 无 yarn_mappings）  |
| `fabric.mod.json` | id entrypointmain/client/serverfabricloader / fabric-api / minecraft / java |
| `ModMain.java` |  `ModInitializer` `onInitialize()`  |
| `ModClient.java` |  `ClientModInitializer` `onInitializeClient()`  |
| `ModServer.java` |  `DedicatedServerModInitializer` `onInitializeServer()`  |
| `LICENSE` |  |
##  26.3
|  |  |
| --- | --- |
| Minecraft | `26.3` |
| Mappings | Mojang 官方映射（26.x 起 Yarn 无构建，Loom 1.18 默认） |
| Fabric Loader | `0.19.5` |
| Fabric API | `0.162.0+26.3` |
| LoomGradle  | `1.18-SNAPSHOT` |
| Java  | `25` |
|  Gradle  | `9.7.1`  |
##
>  Gradle Wrapper Gradle  wrapper
```bash
cd project

gradle wrapper --gradle-version 9.7.1      #  ./gradlew Gradle
./gradlew build                          #
./gradlew runClient                      #
./gradlew runServer                      #
```
**JDK 25**  Fabric Maven / Mojang
##
`examplemod` / `Example Mod` / `com.example.mod`
1. **mod_id /  id**
   - `settings.gradle` → `rootProject.name = 'examplemod'`
   - `src/main/resources/fabric.mod.json` → `"id": "examplemod"`
   - `src/main/java/com/example/mod/ModMain.java` → `MOD_ID = "examplemod"`
2. ** / package**
   -  `src/main/java/com/example/mod/`  `com/yourname/yourmod/`
   -  Java  `package com.example.mod;`
   - `gradle.properties` → `maven_group = com.example.mod`
   - `fabric.mod.json`  entrypoint
3. ****
   - `fabric.mod.json` → `"name"``"authors"``"description"``"contact"`
4. ****
   - `gradle.properties` → `mod_version` `fabric.mod.json`  `"version": "${version}"`
5. ****
   - `fabric.mod.json` → `"license"` `LICENSE`
6. ****
   -  `src/main/resources/assets/<mod_id>/icon.png`  128×128  512×512
   -  `fabric.mod.json`  `"icon": "assets/<mod_id>/icon.png"`
##  settings.gradle  `fabricgeorge`
 “ fabric-loom  fabricgeorge”
- `fabric-loom`  Fabric  Gradle  Fabric Maven
- `fabricgeorge`  Fabric  Gradle /
   **100% **settings.gradle Fabric Maven / Maven Central / Gradle Plugin Portal `fabricgeorge` ——/ `fabricgeorge`  URL
##  Mixin
 Mixin`fabric.mod.json`  `mixins`
 Mixin
1.  `fabric.mod.json`  `"mixins": ["<mod_id>.mixins.json"]`
2.  `<mod_id>.mixins.json`
3.  Mixin Loom  refmap
