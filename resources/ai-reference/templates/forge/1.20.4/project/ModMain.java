/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.20.4）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.20.4 loaderVersion=49.0.53
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.4 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.4 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.4/project/ModMain.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod;

import com.example.examplemod.block.ModBlocks;
import com.example.examplemod.entity.ModEntities;
import com.example.examplemod.item.ModItems;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Forge 主入口（1.20.4）。
 * 与 Fabric entrypoint 不同：Forge 通过扫描 @Mod 注解定位主类，构造器即初始化时机。
 */
@Mod("examplemod")
public class ModMain {
    public static final String MOD_ID = "examplemod";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public ModMain() {
        // mod 事件总线：注册 DeferredRegister 与生命周期监听
        IEventBus modEventBus = FMLJavaModLoadingContext.get().getModEventBus();

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
        // 通用端初始化：注册网络包、能力、配方后处理等
    }
}
