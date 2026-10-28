/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.8）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.8 loaderVersion=0.19.5
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.8 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.8 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// ModServer.java - Fabric 1.21.8 reference scaffold
// Reconstructed from KunYuEcosystem AI Reference v3.0 "project/README.md".
// Dedicated-server-only entrypoint.
// Target mapping: Yarn 1.21.8+build.1 | Loader 0.19.5 | JDK 21
// ============================================================================
package com.example.mod;

import net.fabricmc.api.DedicatedServerModInitializer;

public class ModServer implements DedicatedServerModInitializer {
    @Override
    public void onInitializeServer() {
        ModMain.LOGGER.info("Initializing {} (dedicated server)", ModMain.MOD_ID);
        // Server-only registrations: commands, server events.
    }
}
