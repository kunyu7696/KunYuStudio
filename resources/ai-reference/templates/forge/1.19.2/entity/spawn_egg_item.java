/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.19.2）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.19.2 loaderVersion=43.4.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.19.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.19.2 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.19.2/entity/spawn_egg_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.world.item.Item;
import net.minecraftforge.common.ForgeSpawnEggItem;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 刷怪蛋（Forge 1.19.2）。
 * 要点：
 * - ForgeSpawnEggItem(Supplier<EntityType<? extends Mob>>, 底色, 斑点色, Item.Properties)。
 * - Supplier 延迟取值：注册阶段实体尚未就绪也不会 NPE。
 * - 创造栏见 item/simple_item.java 的 .tab(CreativeModeTab.TAB_MISC) 示例（1.19.3+ 改用 CreativeModeTabEvent）。
 * - 独立 DeferredRegister：记得在主类构造器追加 SPAWN_EGGS.register(modEventBus)。
 */
public class ModSpawnEggItems {
    public static final DeferredRegister<Item> SPAWN_EGGS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<ForgeSpawnEggItem> EXAMPLE_SPAWN_EGG =
            SPAWN_EGGS.register("example_spawn_egg",
                    () -> new ForgeSpawnEggItem(() -> ModEntities.EXAMPLE_ENTITY.get(),
                            0xFFFFFF,   // 底色
                            0x000000,   // 斑点色
                            new Item.Properties()));
}
