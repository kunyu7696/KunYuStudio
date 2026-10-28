/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.11）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.11 loaderVersion=21.11.45
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.11 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.11 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.11/command/simple_command.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
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
 * 指令注册（NeoForge 1.21.11）。
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
