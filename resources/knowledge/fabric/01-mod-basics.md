# Fabric 模组基础结构（1.20.1 / Yarn）

## 工程骨架

- `build.gradle`：fabric-loom 插件；依赖 `minecraft`、`mappings "net.fabricmc:yarn:<版本>:v2"`、`fabric-loader`、`fabric-api`
- `gradle.properties`：minecraft_version / yarn_mappings / loader_version / fabric_version / mod_version / maven_group / archives_base_name
- `src/main/resources/fabric.mod.json`：模组清单；`entrypoints` 分 `main`（服务端+客户端通用初始化）、`client`（仅客户端）、`server`（仅专用服务端）
- 入口类实现 `ModInitializer`（main）、`ClientModInitializer`（client）

## fabric.mod.json 最小结构

```json
{
  "schemaVersion": 1,
  "id": "mymod",
  "version": "1.0.0",
  "name": "My Mod",
  "entrypoints": {
    "main": ["com.example.mymod.MyMod"],
    "client": ["com.example.mymod.MyModClient"]
  },
  "depends": { "fabricloader": ">=0.15.0", "minecraft": "~1.20.1", "java": ">=17" },
  "mixins": ["mymod.mixins.json"]
}
```

- fabricloader 约束写 `>=0.15.0`，不要写过窄的版本导致 HARD_DEP 拒载
- 客户端专用代码（渲染器、屏幕、按键）必须放 client 源集或 client 入口，避免专用服务端 ClassNotFound

## 初始化时机

- `onInitialize()`：注册内容（方块/物品/实体/命令/网络包），注册表在此阶段仍可变
- 常见内容注册类：`ModBlocks`、`ModItems`、`ModEntities`、`RegistryEvents`（Fabric API 提供帮助事件）

## 命名空间与 Identifier

- 所有注册内容都有 `Identifier`：`new Identifier("mymod", "ruby_ore")`（等价 `mymod:ruby_ore`）
- 路径字符：小写字母、数字、下划线、斜杠；禁止大写与空格
- 资产路径按命名空间组织：`assets/mymod/textures/...`、`data/mymod/recipes/...`

## 源码集与环境

- `@Environment(EnvType.CLIENT)`：标注客户端专用类/方法
- `splitEnvironmentSourceSets()`：loom 配置，开启后客户端代码放 `src/client/java`，需要同时配 processResources 与 processClientResources 的 `${version}` 展开

## 构建与运行

- `./gradlew build`：编译 + jar 产物 `build/libs/`
- `./gradlew runClient`：启动客户端；`runServer`：专用服务端
- 国内网络：repositories 加阿里云 maven 镜像，fabric maven 兜底
