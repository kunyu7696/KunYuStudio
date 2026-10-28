/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.6）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.6 loaderVersion=21.6.20
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.6 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.6 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.6/project/ModServer.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod;

import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/**
 * 服务端事件订阅示例（NeoForge 1.21.6）。
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
