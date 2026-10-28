/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.3）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.3 loaderVersion=21.3.0-beta
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.3 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.3 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.3/entity/spawn_egg_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.common.DeferredSpawnEggItem;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 刷怪蛋（NeoForge 1.21.3）。
 * 要点：
 * - DeferredSpawnEggItem(Supplier<EntityType<? extends Mob>>, 底色, 斑点色, Item.Properties)。
 * - Supplier 延迟取值：() -> ModEntities.EXAMPLE_ENTITY.get()；
 *   也可直接把 DeferredHolder 传进去（它本身就是 Supplier）。
 * - 1.21.2+（含 1.21.3）Item.Properties 强制 setId：必须用 DeferredRegister.Items + registerItem
 *   （自动注入 id），普通 register + new Item.Properties() 会抛 "Item id not set"。
 * - 创造栏见 item/simple_item.java 的 BuildCreativeModeTabContentsEvent 示例。
 * - 独立 DeferredRegister：记得在主类构造器追加 SPAWN_EGGS.register(modEventBus)。
 */
public class ModSpawnEggItems {
    public static final DeferredRegister.Items SPAWN_EGGS =
            DeferredRegister.createItems(ModMain.MOD_ID);

    public static final DeferredHolder<Item, DeferredSpawnEggItem> EXAMPLE_SPAWN_EGG =
            SPAWN_EGGS.registerItem("example_spawn_egg",
                    props -> new DeferredSpawnEggItem(() -> ModEntities.EXAMPLE_ENTITY.get(),
                            0xFFFFFF,   // 底色
                            0x000000,   // 斑点色
                            props));
}
