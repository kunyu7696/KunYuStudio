/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/command/simple_command.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.command;

import com.example.examplemod.ModMain;
import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.minecraft.command.Commands; // 1.16.5 命令构建入口：net.minecraft.command.Commands
import net.minecraft.util.text.StringTextComponent; // 1.16.5 文本：StringTextComponent（Component.literal 是 1.17+ 写法）
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * 指令注册（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 监听游戏总线的 RegisterCommandsEvent（1.16.5 已存在），用 Brigadier literal/argument 搭建指令树。
 * - requires 控制权限（2 = OP），executes 返回值即指令结果码。
 * - sendSuccess 直接传 ITextComponent（1.19+ 才改为传 Supplier）。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID) // 默认 game 总线
public class ModCommands {

    @SubscribeEvent
    public static void onRegisterCommands(RegisterCommandsEvent event) {
        event.getDispatcher().register(
                Commands.literal("example")                       // /example <value>
                        .requires(source -> source.hasPermission(2))
                        .then(Commands.argument("value", IntegerArgumentType.integer(0))
                                .executes(ctx -> {
                                    int value = IntegerArgumentType.getInteger(ctx, "value");
                                    ctx.getSource().sendSuccess(
                                            new StringTextComponent("example value = " + value), false);
                                    return Command.SINGLE_SUCCESS;
                                }))
        );
    }
}
