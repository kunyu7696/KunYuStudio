/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/project/ModMain.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod;

import com.example.examplemod.block.ModBlocks;
import com.example.examplemod.entity.ModEntities;
import com.example.examplemod.item.ModItems;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.apache.logging.log4j.LogManager; // 1.16.5 用 Log4j2（slf4j LoggerFactory 是 1.18+ 的 MDK 默认）
import org.apache.logging.log4j.Logger;

/**
 * Forge 主入口（1.16.5）。
 * 与 Fabric entrypoint 不同：Forge 通过扫描 @Mod 注解定位主类，构造器即初始化时机。
 */
@Mod("examplemod")
public class ModMain {
    public static final String MOD_ID = "examplemod";
    public static final Logger LOGGER = LogManager.getLogger(MOD_ID);

    public ModMain() {
        // mod 事件总线：注册 DeferredRegister 与生命周期监听
        IEventBus modEventBus = FMLJavaModLoadingContext.get().getModEventBus();

        // 登记注册表容器（方块/物品/实体等详见各 category 模板）
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);
        ModEntities.ENTITY_TYPES.register(modEventBus);
        // 若使用了 food_item/tool_item/armor_item/spawn_egg_item 等独立模板类，同样需要注册：
        // ModFoods.FOODS.register(modEventBus);

        modEventBus.addListener(this::commonSetup);
    }

    private void commonSetup(final FMLCommonSetupEvent event) {
        LOGGER.info("Common setup for {}", MOD_ID);
        // 通用端初始化：注册网络包、能力等。
        // 需要主线程执行的内容必须 enqueueWork，例如：
        // event.enqueueWork(ModWorldGen::registerConfiguredFeatures); // 世界生成，见 worldgen/ore_feature.java
        // 实体属性 GlobalEntityTypeAttributes.put 见 entity/entity_attribute.java
    }
}
