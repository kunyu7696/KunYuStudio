/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.4）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.4 loaderVersion=0.16.14
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.4 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.4 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// ModClient.java - Fabric 1.21.4 reference scaffold
// Reconstructed from KunYuEcosystem AI Reference v3.0 "project/README.md".
// Client-only entrypoint (renders, screens, client networking).
// Target mapping: Yarn 1.21.4+build.8 | Loader 0.16.14 | JDK 21
// ============================================================================
package com.example.mod;

import net.fabricmc.api.ClientModInitializer;

public class ModClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ModMain.LOGGER.info("Initializing {} (client)", ModMain.MOD_ID);
        // Client-only registrations: renderers, screens, key bindings.
    }
}
