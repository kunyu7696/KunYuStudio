// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/command/simple_command.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.command;

import com.example.examplemod.ModMain;
import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

/**
 * 指令注册（NeoForge 1.21.1）。
 * 要点：
 * - 监听游戏总线的 RegisterCommandsEvent，用 Brigadier literal/argument 搭建指令树。
 * - requires 控制权限（2 = OP），executes 返回值即指令结果码。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID) // 默认 game 总线
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
                                            () -> Component.literal("example value = " + value), false);
                                    return Command.SINGLE_SUCCESS;
                                }))
        );
    }
}
