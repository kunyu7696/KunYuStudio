/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.8）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.8 loaderVersion=21.8.54
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.8 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.8 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.8/project/ModMain.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod;

import com.example.examplemod.block.ModBlocks;
import com.example.examplemod.entity.ModEntities;
import com.example.examplemod.item.ModItems;
import com.mojang.logging.LogUtils;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLCommonSetupEvent;
import org.slf4j.Logger;

/**
 * NeoForge 主入口（1.21.8）。
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
