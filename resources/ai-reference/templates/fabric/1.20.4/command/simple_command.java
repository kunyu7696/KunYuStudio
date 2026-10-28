/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.20.4）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.20.4 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.4 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.4 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.20.4/command/simple_command.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.command;
import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.command.argument.EntityArgumentType;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.command.CommandManager;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import static net.minecraft.server.command.CommandManager.literal;
import static net.minecraft.server.command.CommandManager.argument;
/**
 *  - Fabric 1.20.4
 *
 *
 * 1.  CommandRegistrationCallback
 * 2.  CommandDispatcher
 * 3. argument
 * 4.
 *
 * Fabric 1.20.4  CommandRegistrationCallback v2
 * v2 :
 *   (CommandDispatcher<ServerCommandSource> dispatcher,
 *    CommandRegistryAccess registryAccess,
 *    CommandManager.RegistrationEnvironment environment)
 *
 * environment :
 *   DEDICATED -
 *   INTEGRATED - /
 *
 * :
 * - 1.20.4  v2  v1
 * - CommandManager.literal()  argument()
 * -  int 1
 * - Feedback  Supplier<Text>lambda
 * -  sendFeedback  true
 */
public class ModCommands {
    /**
     *
     * ModInitializer onInitialize()
     */
    public static void register() {
        CommandRegistrationCallback.EVENT.register(
            (dispatcher, registryAccess, environment) -> {
                registerExampleCommand(dispatcher);
            }
        );
    }
    /**
     *  /example
     *
     * :
     * /example                         -
     * /example hello                   -
     * /example hello <player>          -
     * /example set <value>             -
     * /example give <player> <count>   -
     */
    private static void registerExampleCommand(CommandDispatcher<ServerCommandSource> dispatcher) {
        dispatcher.register(
            literal("example")
                // :

                .executes(context -> {
                    context.getSource().sendFeedback(
                        () -> Text.literal(": /example <hello|set|give>")
                            .formatted(Formatting.YELLOW),
                        false
                    );
                    return 1;
                })
                // /example hello -
                .then(literal("hello")
                    .executes(ModCommands::sayHelloToSelf)
                    // /example hello <player> -
                    .then(argument("target", EntityArgumentType.player())
                        .executes(ModCommands::sayHelloToTarget)
                    )
                )
                // /example set <value> -
                .then(literal("set")
                    .then(argument("value", IntegerArgumentType.integer(0, 100))
                        .executes(ModCommands::setValue)
                    )
                )
                // /example give <player> <count> -
                .then(literal("give")
                    .then(argument("target", EntityArgumentType.player())
                        .then(argument("count", IntegerArgumentType.integer(1, 64))
                            .executes(ModCommands::giveItem)
                        )
                    )
                )
        );
    }
    /**
     * /example hello -
     */
    private static int sayHelloToSelf(CommandContext<ServerCommandSource> context)
            throws CommandSyntaxException {
        ServerCommandSource source = context.getSource();
        PlayerEntity player = source.getPlayer();
        // sendFeedback : (Supplier<Text> feedback, boolean broadcastToOps)
        // broadcastToOps=true OP
        source.sendFeedback(
            () -> Text.literal("Hello, " + player.getName().getString() + "!")
                .formatted(Formatting.GREEN),
            false
        );
        return 1;  //
    }
    /**
     * /example hello <player> -
     */
    private static int sayHelloToTarget(CommandContext<ServerCommandSource> context)
            throws CommandSyntaxException {
        ServerCommandSource source = context.getSource();
        //  EntityArgumentType
        PlayerEntity target = EntityArgumentType.getPlayer(context, "target");
        target.sendMessage(
            Text.literal("Hello from " + source.getName() + "!")
                .formatted(Formatting.GOLD)
        );
        source.sendFeedback(
            () -> Text.literal(" " + target.getName().getString() + " ")
                .formatted(Formatting.GREEN),

            true  // OP
        );
        return 1;
    }
    /**
     * /example set <value> -
     *
     */
    private static int setValue(CommandContext<ServerCommandSource> context)
            throws CommandSyntaxException {
        //  IntegerArgumentType
        int value = IntegerArgumentType.getInteger(context, "value");
        ServerCommandSource source = context.getSource();
        source.sendFeedback(
            () -> Text.literal(": " + value)
                .formatted(Formatting.AQUA),
            false
        );
        return 1;
    }
    /**
     * /example give <player> <count> -
     *
     */
    private static int giveItem(CommandContext<ServerCommandSource> context)
            throws CommandSyntaxException {
        PlayerEntity target = EntityArgumentType.getPlayer(context, "target");
        int count = IntegerArgumentType.getInteger(context, "count");
        ServerCommandSource source = context.getSource();
        // :
        net.minecraft.item.ItemStack stack = new net.minecraft.item.ItemStack(
            net.minecraft.item.Items.DIAMOND, count
        );
        target.getInventory().insertStack(stack);
        source.sendFeedback(
            () -> Text.literal(" " + target.getName().getString()
                + "  " + count + " ")
                .formatted(Formatting.GREEN),
            true
        );
        return 1;
    }
}
