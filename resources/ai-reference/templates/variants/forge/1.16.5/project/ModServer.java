/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/project/ModServer.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod;

import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.server.FMLServerStartingEvent; // 1.16.5 服务器生命周期事件：FMLServer*Event（ServerStartingEvent 是 1.19+ 产物）
import net.minecraftforge.fml.event.server.FMLServerStoppingEvent;

/**
 * 服务端事件订阅示例（1.16.5）。
 * 与 Fabric 的 DedicatedServerModInitializer 不同，Forge 没有独立 server 入口：
 * 服务端逻辑一律通过事件监听实现。本类未标注 Dist，客户端与专用服务器都会加载，
 * 需要区分环境时可用 FMLEnvironment.dist 或 event.getServer().isDedicatedServer()。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID) // 默认挂在 MinecraftForge.EVENT_BUS（game 总线）
public class ModServer {

    @SubscribeEvent
    public static void onServerStarting(FMLServerStartingEvent event) {
        ModMain.LOGGER.info("Server starting: dedicated={}", event.getServer().isDedicatedServer());
        // 服务端初始化：注册跨端数据、启动定时任务等
    }

    @SubscribeEvent
    public static void onServerStopping(FMLServerStoppingEvent event) {
        ModMain.LOGGER.info("Server stopping");
    }
}
