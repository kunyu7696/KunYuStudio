<!--
  KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.1）
  provenance: translated-from-fabric-1.20.1
  目标 loader=fabric mc=1.21.1 loaderVersion=0.15.11
  注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
        加载器 DSL 在 1.21.1 上可能与种子版本存在差异，构建失败时
        请优先查阅 1.21.1 官方文档/Fabric docs。
  verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
-->

[//]: # (KunYuEcosystem AI Reference v3.0 | fabric/1.21.1/project/README.md | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode))

# Fabric 1.21.1
 **Fabric 1.21.1 ** AI
 API  Minecraft 1.21.1 + Fabric
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
| `build.gradle` |  Loom Minecraft/Yarn/Loader/Fabric API Java 21  `mod_version`  `fabric.mod.json`  `${version}`  |
| `settings.gradle` |  `pluginManagement` Fabric Maven  `fabric-loom` `rootProject.name` jar  |
| `gradle.properties` |  `mod_version``maven_group``minecraft_version``yarn_mappings``loader_version``fabric_version`  |
| `fabric.mod.json` | id entrypointmain/client/serverfabricloader / fabric-api / minecraft / java |
| `ModMain.java` |  `ModInitializer` `onInitialize()`  |
| `ModClient.java` |  `ClientModInitializer` `onInitializeClient()`  |
| `ModServer.java` |  `DedicatedServerModInitializer` `onInitializeServer()`  |
| `LICENSE` |  |
##  1.21.1
|  |  |
| --- | --- |
| Minecraft | `1.21.1` |
| Yarn Mappings | `1.21.1+build.3` |
| Fabric Loader | `0.15.11` |
| Fabric API | `0.105.2+1.21.1` |
| LoomGradle  | `1.6-SNAPSHOT` |
| Java  | `21` |
|  Gradle  | `8.10.2`  |
##
>  Gradle Wrapper Gradle  wrapper
```bash
cd project

gradle wrapper --gradle-version 8.10.2      #  ./gradlew Gradle
./gradlew build                          #
./gradlew runClient                      #
./gradlew runServer                      #
```
**JDK 21**  Fabric Maven / Mojang
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
