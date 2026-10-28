// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/item/tool_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.Item; // 补齐缺失 import：下方使用了 Item.Properties
import net.minecraft.world.item.PickaxeItem;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.Tiers;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 工具物品（Forge 1.20.1）。
 * 要点：
 * - 镐：PickaxeItem(Tier, 攻击伤害增量, 攻速修正, Item.Properties)；1.20.1 仍是 Tier 体系。
 * - Tier 用原版 Tiers（WOOD/STONE/IRON/DIAMOND/NETHERITE/GOLD）或自定义 Tier 实现。
 * - 剑：new SwordItem(Tiers.IRON, 3, -2.4f, props)；斧/铲同理（AxeItem/ShovelItem）。
 * - 独立 DeferredRegister：记得在主类构造器追加 TOOLS.register(modEventBus)。
 */
public class ModTools {
    public static final DeferredRegister<Item> TOOLS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<PickaxeItem> EXAMPLE_PICKAXE = TOOLS.register("example_pickaxe",
            () -> new PickaxeItem(Tiers.IRON, 1, -2.8f, new Item.Properties()));

    public static final RegistryObject<SwordItem> EXAMPLE_SWORD = TOOLS.register("example_sword",
            () -> new SwordItem(Tiers.IRON, 3, -2.4f, new Item.Properties()));
}
