package com.kunyu.observer.http;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.kunyu.observer.KunyuObserverClient;
import com.kunyu.observer.capture.ScreenshotCapture;
import com.kunyu.observer.guard.InputGuard;
import com.kunyu.observer.state.ChatRing;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.Element;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ClickableWidget;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.entity.Entity;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.MathHelper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 观察 HTTP 服务。仅绑定 127.0.0.1，端点：
 *
 * <pre>
 * GET  /v1/health      存活与版本探测（protocol=2 表示支持 snapshot/command/select-slot/scroll）
 * GET  /v1/screenshot  当前帧 PNG（?format=raw 返回二进制，默认 data URL JSON）
 * GET  /v1/player      玩家位置 / 姿态 / 生命 / 模式（/v1/state 为别名）
 * GET  /v1/snapshot    v2 聚合：玩家 + 周围实体 + 最近聊天 + 屏幕摘要 + 世界时间 + 护栏
 * GET  /v1/chat        最近聊天（?limit=50）
 * GET  /v1/nearby      周围实体（?radius=24&limit=32&type=minecraft:cow 可按类型过滤）
 * GET  /v1/inventory   背包槽位
 * GET  /v1/screen      当前 Screen 与可交互 widget 树
 * GET  /v1/guard       输入注入护栏状态
 * GET  /v1/world       世界环境（时间/维度/天气）；带 x/y/z 查询参数时返回该位置方块
 * POST /v1/look        {"yaw":..,"pitch":..} 设置视角
 * POST /v1/select-slot {"slot":0..8} 切换主手快捷栏
 * POST /v1/chat        {"message":"..."} 发聊天
 * POST /v1/command     {"command":"gamemode creative"} 执行命令（v2 专用，斜杠可带可不带）
 * POST /v1/world       {"action":"set_block","x":..,"y":..,"z":..,"block":"minecraft:stone"}
 *                       v3：经服务端 setblock 命令放置方块（需要创造/指令权限）
 * POST /v1/input       {"type":"key|char|mouse|mouse-move|scroll", ...} 受 InputGuard 限流；
 *                       标题界面亦可用（GUI 导航）；mouse-move 传缩放坐标 {x,y}
 * </pre>
 */
public final class ObserverHttpServer {
    private static HttpServer server;

    /**
     * S-05 / F4-03：访问令牌。由主进程生成并经 {@code -Dkunyu.observer.token=...} 注入。
     * 为空时不校验（向后兼容：旧启动方式未传 token）；非空时所有 POST 端点必须携带
     * 匹配的 {@code X-Observer-Token} 请求头，防止本机其他进程（浏览器 CSRF 等）调用。
     */
    private static final String AUTH_TOKEN = System.getProperty("kunyu.observer.token", "");

    private ObserverHttpServer() {
    }

    /** 启动服务（重复调用安全）。 */
    public static synchronized void start(int port) throws IOException {
        if (server != null) {
            return;
        }
        HttpServer s = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        s.createContext("/v1/health", ObserverHttpServer::handleHealth);
        s.createContext("/v1/screenshot", ObserverHttpServer::handleScreenshot);
        s.createContext("/v1/player", ObserverHttpServer::handlePlayer);
        // v2：/v1/state 作为 /v1/player 的稳定别名（harness 语义更直白）
        s.createContext("/v1/state", ObserverHttpServer::handlePlayer);
        s.createContext("/v1/snapshot", ObserverHttpServer::handleSnapshot);
        s.createContext("/v1/chat", exchange -> {
            // GET 读取最近聊天；POST 发送聊天（命令请走 v2 的 /v1/command）
            if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                handleChatPost(exchange);
            } else {
                handleChat(exchange);
            }
        });
        s.createContext("/v1/nearby", ObserverHttpServer::handleNearby);
        s.createContext("/v1/inventory", ObserverHttpServer::handleInventory);
        s.createContext("/v1/screen", ObserverHttpServer::handleScreen);
        s.createContext("/v1/guard", exchange -> writeJson(exchange, 200, gsonFrom(InputGuard.stats())));
        s.createContext("/v1/world", exchange -> {
            // GET 读取环境/方块；POST 放置方块（v3）
            if ("POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                handleWorldPost(exchange);
            } else {
                handleWorldGet(exchange);
            }
        });
        s.createContext("/v1/look", ObserverHttpServer::handleLook);
        s.createContext("/v1/select-slot", ObserverHttpServer::handleSelectSlot);
        s.createContext("/v1/command", ObserverHttpServer::handleCommand);
        s.createContext("/v1/input", ObserverHttpServer::handleInput);
        s.setExecutor(Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "kunyu-observer-http");
            t.setDaemon(true);
            return t;
        }));
        s.start();
        server = s;
    }

    // ------------------------------------------------------------------
    // 端点实现
    // ------------------------------------------------------------------

    private static void handleHealth(HttpExchange exchange) throws IOException {
        JsonObject json = new JsonObject();
        json.addProperty("ok", true);
        json.addProperty("mod", KunyuObserverClient.MOD_ID);
        json.addProperty("version", KunyuObserverClient.MOD_VERSION);
        json.addProperty("minecraft", "1.20.1");
        json.addProperty("protocol", 3);
        var caps = new com.google.gson.JsonArray();
        // 能力声明：harness 据此挑选可用动作，避免对旧版 mod 发新端点
        // v3 在 v2 基础上增加 world-block（GET/POST /v1/world）
        for (String cap : new String[]{"snapshot", "command", "select-slot", "scroll", "input", "screenshot", "world-block"}) {
            caps.add(cap);
        }
        json.add("capabilities", caps);
        json.addProperty("inGame", MinecraftClient.getInstance().player != null);
        json.addProperty("now", System.currentTimeMillis());
        writeJson(exchange, 200, json.toString());
    }

    private static void handleScreenshot(HttpExchange exchange) throws IOException {
        requireGet(exchange);
        try {
            byte[] png = ScreenshotCapture.capturePng();
            if ("raw".equals(queryParams(exchange).get("format"))) {
                exchange.getResponseHeaders().add("Content-Type", "image/png");
                exchange.sendResponseHeaders(200, png.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(png);
                }
            } else {
                JsonObject json = new JsonObject();
                json.addProperty("mime", "image/png");
                json.addProperty("dataUrl",
                        "data:image/png;base64," + java.util.Base64.getEncoder().encodeToString(png));
                json.addProperty("bytes", png.length);
                writeJson(exchange, 200, json.toString());
            }
        } catch (Exception e) {
            writeError(exchange, 500, "截图失败：" + e.getMessage());
        }
    }

    private static void handlePlayer(HttpExchange exchange) throws IOException {
        requireGet(exchange);
        ClientPlayerEntity p = MinecraftClient.getInstance().player;
        if (p == null) {
            writeError(exchange, 503, "玩家尚未进入世界");
            return;
        }
        try {
            String body = onClient(() -> buildPlayerJson(MinecraftClient.getInstance(), p).toString());
            writeJson(exchange, 200, body);
        } catch (Exception e) {
            writeError(exchange, 500, e.getMessage());
        }
    }

    /** 组装玩家状态 JSON（必须在客户端线程调用）。v2 snapshot 复用。 */
    private static JsonObject buildPlayerJson(MinecraftClient mc, ClientPlayerEntity p) {
        JsonObject json = new JsonObject();
        json.addProperty("name", p.getName().getString());
        json.addProperty("uuid", p.getUuidAsString());
        json.addProperty("x", p.getX());
        json.addProperty("y", p.getY());
        json.addProperty("z", p.getZ());
        json.addProperty("yaw", p.getYaw());
        json.addProperty("pitch", p.getPitch());
        json.addProperty("health", p.getHealth());
        json.addProperty("food", p.getHungerManager().getFoodLevel());
        json.addProperty("onGround", p.isOnGround());
        json.addProperty("selectedSlot", p.getInventory().selectedSlot);
        var interaction = mc.interactionManager;
        json.addProperty("gameMode",
                interaction != null && interaction.getCurrentGameMode() != null
                        ? interaction.getCurrentGameMode().getName()
                        : "unknown");
        return json;
    }

    private static void handleChat(HttpExchange exchange) throws IOException {
        requireGet(exchange);
        int limit = parseInt(queryParams(exchange).get("limit"), 50);
        JsonObject json = new JsonObject();
        var arr = new com.google.gson.JsonArray();
        for (String msg : ChatRing.recent(limit)) {
            arr.add(msg);
        }
        json.add("messages", arr);
        writeJson(exchange, 200, json.toString());
    }

    private static void handleNearby(HttpExchange exchange) throws IOException {
        requireGet(exchange);
        MinecraftClient mc = MinecraftClient.getInstance();
        ClientPlayerEntity p = mc.player;
        ClientWorld world = mc.world;
        if (p == null || world == null) {
            writeError(exchange, 503, "尚未进入世界");
            return;
        }
        Map<String, String> q = queryParams(exchange);
        double radius = parseDouble(q.get("radius"), 24.0);
        int limit = parseInt(q.get("limit"), 32);
        // v2：按实体 ID 精确过滤，如 type=minecraft:cow；命名空间缺省时补 minecraft
        String typeFilter = q.get("type");
        try {
            String body = onClient(() ->
                    buildNearbyJson(world, p, radius, limit, normalizeTypeId(typeFilter)).toString());
            writeJson(exchange, 200, body);
        } catch (Exception e) {
            writeError(exchange, 500, e.getMessage());
        }
    }

    /** 归一化实体类型过滤值：cow → minecraft:cow；空/blank → null（不过滤）。 */
    private static String normalizeTypeId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String t = raw.trim();
        return t.indexOf(':') < 0 ? "minecraft:" + t : t;
    }

    /** 组装周围实体 JSON（必须在客户端线程调用）。v2 snapshot 复用。 */
    private static JsonObject buildNearbyJson(ClientWorld world, ClientPlayerEntity p,
                                              double radius, int limit, String typeFilter) {
        var out = new com.google.gson.JsonArray();
        int count = 0;
        for (Entity entity : world.getEntities()) {
            if (entity == p) {
                continue;
            }
            Identifier typeId = Registries.ENTITY_TYPE.getId(entity.getType());
            if (typeFilter != null && !typeFilter.equals(typeId.toString())) {
                continue;
            }
            double dist = entity.distanceTo(p);
            if (dist > radius) {
                continue;
            }
            JsonObject e = new JsonObject();
            e.addProperty("type", typeId.toString());
            e.addProperty("name", entity.getName().getString());
            e.addProperty("uuid", entity.getUuidAsString());
            e.addProperty("x", entity.getX());
            e.addProperty("y", entity.getY());
            e.addProperty("z", entity.getZ());
            e.addProperty("distance", Math.round(dist * 100.0) / 100.0);
            out.add(e);
            if (++count >= limit) {
                break;
            }
        }
        JsonObject json = new JsonObject();
        json.addProperty("radius", radius);
        if (typeFilter != null) {
            json.addProperty("type", typeFilter);
        }
        json.add("entities", out);
        return json;
    }

    /**
     * v2 聚合快照：一次 HTTP 往返拿到 harness 判定所需的主要状态。
     * 查询参数：radius（默认 24）、entityLimit（默认 16）、chatLimit（默认 20）、
     * type（实体过滤）、widgets=1（屏幕信息附带 widget 树，默认只给摘要）。
     * 故意不含截图（体积大），需要画面时另请 /v1/screenshot。
     */
    private static void handleSnapshot(HttpExchange exchange) throws IOException {
        requireGet(exchange);
        MinecraftClient mc = MinecraftClient.getInstance();
        ClientPlayerEntity p = mc.player;
        ClientWorld world = mc.world;
        if (p == null || world == null) {
            writeError(exchange, 503, "尚未进入世界");
            return;
        }
        Map<String, String> q = queryParams(exchange);
        double radius = parseDouble(q.get("radius"), 24.0);
        int entityLimit = parseInt(q.get("entityLimit"), 16);
        int chatLimit = parseInt(q.get("chatLimit"), 20);
        String typeFilter = normalizeTypeId(q.get("type"));
        boolean withWidgets = "1".equals(q.get("widgets"));
        try {
            String body = onClient(() -> {
                JsonObject root = new JsonObject();
                root.addProperty("now", System.currentTimeMillis());
                root.add("player", buildPlayerJson(mc, p));

                JsonObject worldJson = new JsonObject();
                worldJson.addProperty("time", world.getTime());
                worldJson.addProperty("timeOfDay", world.getTimeOfDay());
                var dimKey = world.getRegistryKey() != null ? world.getRegistryKey().getValue() : null;
                worldJson.addProperty("dimension", dimKey != null ? dimKey.toString() : "unknown");
                worldJson.addProperty("raining", world.isRaining());
                root.add("world", worldJson);

                root.add("nearby", buildNearbyJson(world, p, radius, entityLimit, typeFilter));

                var chatArr = new com.google.gson.JsonArray();
                for (String msg : ChatRing.recent(chatLimit)) {
                    chatArr.add(msg);
                }
                JsonObject chatJson = new JsonObject();
                chatJson.add("messages", chatArr);
                root.add("chat", chatJson);

                JsonObject screenJson = buildScreenJson(mc, withWidgets);
                root.add("screen", screenJson);
                root.add("guard", gsonTree(InputGuard.stats()));
                return root.toString();
            });
            writeJson(exchange, 200, body);
        } catch (Exception e) {
            writeError(exchange, 500, e.getMessage());
        }
    }

    /** 屏幕摘要 JSON（必须在客户端线程调用）；withWidgets=true 时附带可交互控件树。 */
    private static JsonObject buildScreenJson(MinecraftClient mc, boolean withWidgets) {
        Screen screen = mc.currentScreen;
        JsonObject json = new JsonObject();
        if (screen == null) {
            json.addProperty("open", false);
            return json;
        }
        json.addProperty("open", true);
        json.addProperty("class", screen.getClass().getSimpleName());
        json.addProperty("title", screen.getTitle().getString());
        if (withWidgets) {
            var widgets = new com.google.gson.JsonArray();
            for (Element child : screen.children()) {
                if (!(child instanceof ClickableWidget widget)) {
                    continue;
                }
                JsonObject w = new JsonObject();
                w.addProperty("class", widget.getClass().getSimpleName());
                w.addProperty("text", widget.getMessage().getString());
                w.addProperty("x", widget.getX());
                w.addProperty("y", widget.getY());
                w.addProperty("width", widget.getWidth());
                w.addProperty("height", widget.getHeight());
                w.addProperty("enabled", widget.active);
                w.addProperty("visible", widget.visible);
                widgets.add(w);
            }
            json.add("widgets", widgets);
        }
        return json;
    }

    private static void handleInventory(HttpExchange exchange) throws IOException {
        requireGet(exchange);
        ClientPlayerEntity p = MinecraftClient.getInstance().player;
        if (p == null) {
            writeError(exchange, 503, "玩家尚未进入世界");
            return;
        }
        try {
            String body = onClient(() -> {
                var slots = new com.google.gson.JsonArray();
                var inv = p.getInventory();
                for (int i = 0; i < inv.size(); i++) {
                    ItemStack stack = inv.getStack(i);
                    if (stack.isEmpty()) {
                        continue;
                    }
                    JsonObject slot = new JsonObject();
                    slot.addProperty("slot", i);
                    slot.addProperty("id", Registries.ITEM.getId(stack.getItem()).toString());
                    slot.addProperty("name", stack.getName().getString());
                    slot.addProperty("count", stack.getCount());
                    slot.addProperty("damage", stack.getDamage());
                    slots.add(slot);
                }
                JsonObject json = new JsonObject();
                json.addProperty("selectedSlot", inv.selectedSlot);
                json.add("slots", slots);
                return json.toString();
            });
            writeJson(exchange, 200, body);
        } catch (Exception e) {
            writeError(exchange, 500, e.getMessage());
        }
    }

    private static void handleScreen(HttpExchange exchange) throws IOException {
        requireGet(exchange);
        MinecraftClient mc = MinecraftClient.getInstance();
        try {
            // 独立端点始终带 widget 树；snapshot 默认只要摘要
            String body = onClient(() -> buildScreenJson(mc, true).toString());
            writeJson(exchange, 200, body);
        } catch (Exception e) {
            writeError(exchange, 500, e.getMessage());
        }
    }

    /**
     * v3：GET /v1/world。
     * 无坐标参数 → 世界环境（时间/维度/天气）；带齐 x/y/z → 该位置方块状态。
     * 方块数据直接读客户端世界（本地判定，不消耗指令权限）。
     */
    private static void handleWorldGet(HttpExchange exchange) throws IOException {
        requireGet(exchange);
        MinecraftClient mc = MinecraftClient.getInstance();
        ClientWorld world = mc.world;
        if (world == null) {
            writeError(exchange, 503, "尚未进入世界");
            return;
        }
        Map<String, String> q = queryParams(exchange);
        try {
            String body = onClient(() -> {
                if (q.get("x") != null && q.get("y") != null && q.get("z") != null) {
                    int x = Integer.parseInt(q.get("x"));
                    int y = Integer.parseInt(q.get("y"));
                    int z = Integer.parseInt(q.get("z"));
                    if (y < world.getBottomY() || y >= world.getTopY()) {
                        throw new IllegalArgumentException(
                                "y 超出世界高度范围（" + world.getBottomY() + ".." + (world.getTopY() - 1) + "）");
                    }
                    BlockPos pos = new BlockPos(x, y, z);
                    var state = world.getBlockState(pos);
                    JsonObject block = new JsonObject();
                    block.addProperty("x", x);
                    block.addProperty("y", y);
                    block.addProperty("z", z);
                    block.addProperty("block", Registries.BLOCK.getId(state.getBlock()).toString());
                    block.addProperty("air", state.isAir());
                    return block.toString();
                }
                JsonObject env = new JsonObject();
                env.addProperty("time", world.getTime());
                env.addProperty("timeOfDay", world.getTimeOfDay());
                var dimKey = world.getRegistryKey() != null ? world.getRegistryKey().getValue() : null;
                env.addProperty("dimension", dimKey != null ? dimKey.toString() : "unknown");
                env.addProperty("raining", world.isRaining());
                env.addProperty("thundering", world.isThundering());
                env.addProperty("bottomY", world.getBottomY());
                env.addProperty("topY", world.getTopY());
                return env.toString();
            });
            writeJson(exchange, 200, body);
        } catch (NumberFormatException e) {
            writeError(exchange, 400, "x/y/z 必须是整数");
        } catch (Exception e) {
            writeError(exchange, 500, e.getMessage());
        }
    }

    /** 合法方块标识符：minecraft:stone / 命名空间 modid:path（1.20.1 允许 / . _ -）。 */
    private static final java.util.regex.Pattern BLOCK_ID =
            java.util.regex.Pattern.compile("[a-z0-9_.-]+:[a-z0-9_/.-]+");

    /**
     * v3：POST /v1/world {"action":"set_block","x":..,"y":..,"z":..,"block":"minecraft:stone","mode":"replace"}。
     * 客户端直接改世界会被服务端纠正，因此统一走 setblock 指令（创造模式或有权限时生效），
     * 返回体回显实际下发的指令，便于 harness 从聊天/日志核对结果。
     */
    private static void handleWorldPost(HttpExchange exchange) throws IOException {
        requirePostWrite(exchange);
        ClientPlayerEntity p = MinecraftClient.getInstance().player;
        if (p == null) {
            writeError(exchange, 503, "玩家尚未进入世界");
            return;
        }
        JsonObject body = readJsonBody(exchange);
        String action = body.has("action") ? body.get("action").getAsString() : "set_block";
        if (!"set_block".equals(action)) {
            writeError(exchange, 400, "仅支持 action=set_block");
            return;
        }
        if (!body.has("x") || !body.has("y") || !body.has("z")) {
            writeError(exchange, 400, "需要整数坐标 x / y / z");
            return;
        }
        if (!body.has("block")) {
            writeError(exchange, 400, "需要 block 字段（如 minecraft:stone）");
            return;
        }
        final int x;
        final int y;
        final int z;
        try {
            x = body.get("x").getAsInt();
            y = body.get("y").getAsInt();
            z = body.get("z").getAsInt();
        } catch (NumberFormatException | java.lang.UnsupportedOperationException e) {
            writeError(exchange, 400, "x / y / z 必须是整数");
            return;
        }
        String blockId = body.get("block").getAsString().trim();
        if (!BLOCK_ID.matcher(blockId).matches()) {
            writeError(exchange, 400, "block 不是合法标识符：" + blockId);
            return;
        }
        String mode = body.has("mode") ? body.get("mode").getAsString() : "replace";
        if (!mode.equals("replace") && !mode.equals("destroy") && !mode.equals("keep")) {
            writeError(exchange, 400, "mode 仅支持 replace / destroy / keep");
            return;
        }
        String normalized = blockId.indexOf(':') < 0 ? "minecraft:" + blockId : blockId;
        String command = "setblock " + x + " " + y + " " + z + " " + normalized + " " + mode;
        try {
            onClient(() -> {
                ClientPlayNetworkHandler handler = p.networkHandler;
                if (handler == null) {
                    throw new IllegalStateException("网络连接不存在");
                }
                handler.sendChatCommand(command);
                return null;
            });
        } catch (Exception e) {
            writeError(exchange, 500, "setblock 指令下发失败：" + e.getMessage());
            return;
        }
        JsonObject ok = new JsonObject();
        ok.addProperty("ok", true);
        ok.addProperty("command", command);
        writeJson(exchange, 200, ok.toString());
    }

    private static void handleLook(HttpExchange exchange) throws IOException {
        requirePostWrite(exchange);
        ClientPlayerEntity p = MinecraftClient.getInstance().player;
        if (p == null) {
            writeError(exchange, 503, "玩家尚未进入世界");
            return;
        }
        JsonObject body = readJsonBody(exchange);
        if (!body.has("yaw") || !body.has("pitch")) {
            writeError(exchange, 400, "缺少 yaw / pitch 字段");
            return;
        }
        float yaw = (float) body.get("yaw").getAsDouble();
        float pitch = MathHelper.clamp((float) body.get("pitch").getAsDouble(), -90.0f, 90.0f);
        try {
            onClient(() -> {
                p.setYaw(yaw);
                p.setPitch(pitch);
                return null;
            });
        } catch (Exception e) {
            writeError(exchange, 500, "视角设置失败：" + e.getMessage());
            return;
        }
        JsonObject ok = new JsonObject();
        ok.addProperty("ok", true);
        writeJson(exchange, 200, ok.toString());
    }

    private static void handleChatPost(HttpExchange exchange) throws IOException {
        // 保留方法名与路由一致：POST /v1/chat
        requirePostWrite(exchange);
        ClientPlayerEntity p = MinecraftClient.getInstance().player;
        if (p == null) {
            writeError(exchange, 503, "玩家尚未进入世界");
            return;
        }
        JsonObject body = readJsonBody(exchange);
        String command = body.has("command") ? body.get("command").getAsString() : null;
        String message = body.has("message") ? body.get("message").getAsString() : null;
        if ((command == null || command.isBlank()) && (message == null || message.isBlank())) {
            writeError(exchange, 400, "需要 command 或 message 字段");
            return;
        }
        try {
            onClient(() -> {
                ClientPlayNetworkHandler handler = p.networkHandler;
                if (handler == null) {
                    throw new IllegalStateException("网络连接不存在");
                }
                if (command != null && !command.isBlank()) {
                    // 服务端方法不要前导斜杠
                    handler.sendChatCommand(command.startsWith("/") ? command.substring(1) : command);
                } else {
                    handler.sendChatMessage(message);
                }
                return null;
            });
            JsonObject ok = new JsonObject();
            ok.addProperty("ok", true);
            writeJson(exchange, 200, ok.toString());
        } catch (Exception e) {
            writeError(exchange, 500, e.getMessage());
        }
    }

    /**
     * v2 专用命令端点：POST /v1/command {"command":"gamemode creative"}。
     * 与 POST /v1/chat 分开，harness 读写语义更清晰；前导斜杠可带可不带。
     */
    private static void handleCommand(HttpExchange exchange) throws IOException {
        requirePostWrite(exchange);
        ClientPlayerEntity p = MinecraftClient.getInstance().player;
        if (p == null) {
            writeError(exchange, 503, "玩家尚未进入世界");
            return;
        }
        JsonObject body = readJsonBody(exchange);
        String command = body.has("command") ? body.get("command").getAsString() : null;
        if (command == null || command.isBlank()) {
            writeError(exchange, 400, "需要 command 字段");
            return;
        }
        String normalized = command.startsWith("/") ? command.substring(1) : command;
        try {
            onClient(() -> {
                ClientPlayNetworkHandler handler = p.networkHandler;
                if (handler == null) {
                    throw new IllegalStateException("网络连接不存在");
                }
                handler.sendChatCommand(normalized);
                return null;
            });
            JsonObject ok = new JsonObject();
            ok.addProperty("ok", true);
            writeJson(exchange, 200, ok.toString());
        } catch (Exception e) {
            writeError(exchange, 500, e.getMessage());
        }
    }

    /** v2：POST /v1/select-slot {"slot":0..8} 切换主手快捷栏槽位。 */
    private static void handleSelectSlot(HttpExchange exchange) throws IOException {
        requirePostWrite(exchange);
        ClientPlayerEntity p = MinecraftClient.getInstance().player;
        if (p == null) {
            writeError(exchange, 503, "玩家尚未进入世界");
            return;
        }
        JsonObject body = readJsonBody(exchange);
        if (!body.has("slot")) {
            writeError(exchange, 400, "需要 slot 字段（0..8）");
            return;
        }
        int slot = body.get("slot").getAsInt();
        if (slot < 0 || slot > 8) {
            writeError(exchange, 400, "slot 必须在 0..8 之间");
            return;
        }
        try {
            onClient(() -> {
                p.getInventory().selectedSlot = slot;
                return null;
            });
        } catch (Exception e) {
            writeError(exchange, 500, "快捷栏切换失败：" + e.getMessage());
            return;
        }
        JsonObject ok = new JsonObject();
        ok.addProperty("ok", true);
        ok.addProperty("selectedSlot", slot);
        writeJson(exchange, 200, ok.toString());
    }

    // ------------------------------------------------------------------
    // 输入注入反射：Yarn 1.20.1 的 Keyboard.onChar / Mouse.onMouseButton /
    // onMouseScroll 均为 private（经 mapped jar javap 核实），只能反射触达。
    // dev 客户端运行时为 named 映射，方法名可直接命中；onKey 是 public 无需反射。
    // ------------------------------------------------------------------
    private static final Method KB_ON_CHAR =
            inputMethod(net.minecraft.client.Keyboard.class, "onChar", long.class, int.class, int.class);
    private static final Method MS_ON_BUTTON =
            inputMethod(net.minecraft.client.Mouse.class, "onMouseButton", long.class, int.class, int.class, int.class);
    private static final Method MS_ON_SCROLL =
            inputMethod(net.minecraft.client.Mouse.class, "onMouseScroll", long.class, double.class, double.class);

    private static Method inputMethod(Class<?> cls, String name, Class<?>... params) {
        try {
            Method m = cls.getDeclaredMethod(name, params);
            m.setAccessible(true);
            return m;
        } catch (ReflectiveOperationException e) {
            KunyuObserverClient.LOGGER.warn("[kunyu-observer] 输入注入方法不可达：{}#{}", cls.getSimpleName(), name);
            return null;
        }
    }

    private static void invokeInput(Method m, Object target, Object... args) throws Exception {
        if (m == null) {
            throw new IllegalStateException("当前运行环境不支持该输入注入（目标方法不可达）");
        }
        try {
            m.invoke(target, args);
        } catch (InvocationTargetException e) {
            if (e.getCause() instanceof Exception cause) {
                throw cause;
            }
            throw e;
        }
    }

    private static void handleInput(HttpExchange exchange) throws IOException {
        requirePostWrite(exchange);
        MinecraftClient mc = MinecraftClient.getInstance();
        // 标题界面同样允许注入（GUI 导航建世界等场景）；InputGuard 限流不变
        if (!InputGuard.tryAcquire()) {
            writeError(exchange, 429, "输入护栏熔断：窗口内注入事件过多（或注入已被 -Dkunyu.observer.inputEnabled=false 关闭）");
            return;
        }
        JsonObject body = readJsonBody(exchange);
        String type = body.has("type") ? body.get("type").getAsString() : "";
        try {
            long window = mc.getWindow().getHandle();
            onClient(() -> {
                switch (type) {
                    case "key" -> mc.keyboard.onKey(window,
                            body.get("key").getAsInt(),
                            body.has("scancode") ? body.get("scancode").getAsInt() : 0,
                            body.has("action") ? body.get("action").getAsInt() : 1,
                            body.has("mods") ? body.get("mods").getAsInt() : 0);
                    case "char" -> invokeInput(KB_ON_CHAR, mc.keyboard, window,
                            body.get("codePoint").getAsInt(),
                            body.has("mods") ? body.get("mods").getAsInt() : 0);
                    case "mouse" -> invokeInput(MS_ON_BUTTON, mc.mouse, window,
                            body.get("button").getAsInt(),
                            body.has("action") ? body.get("action").getAsInt() : 1,
                            body.has("mods") ? body.get("mods").getAsInt() : 0);
                    // 光标定位（GUI 点击前置）：入参为 /v1/screen 同款缩放坐标，
                    // 内部乘 scaleFactor 转窗口物理像素；glfw 回调会同步 Mouse 内部坐标
                    case "mouse-move" -> org.lwjgl.glfw.GLFW.glfwSetCursorPos(window,
                            body.get("x").getAsDouble() * mc.getWindow().getScaleFactor(),
                            body.get("y").getAsDouble() * mc.getWindow().getScaleFactor());
                    // v2：滚轮注入（vertical：1=向上一格，-1=向下一格；horizontal 一般为 0）
                    case "scroll" -> invokeInput(MS_ON_SCROLL, mc.mouse, window,
                            body.has("horizontal") ? body.get("horizontal").getAsDouble() : 0.0,
                            body.has("vertical") ? body.get("vertical").getAsDouble() : 0.0);
                    default -> throw new IllegalArgumentException(
                            "未知 type：" + type + "（支持 key / char / mouse / mouse-move / scroll）");
                }
                return null;
            });
            JsonObject ok = new JsonObject();
            ok.addProperty("ok", true);
            writeJson(exchange, 200, ok.toString());
        } catch (Exception e) {
            writeError(exchange, 400, e.getMessage());
        }
    }

    // ------------------------------------------------------------------
    // 基础设施
    // ------------------------------------------------------------------

    static {
        // /v1/chat 同时支持 GET 读取与 POST 发送，按方法分发
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            if (server != null) {
                server.stop(0);
            }
        }));
    }

    /** 在客户端线程同步执行（最多等 3 秒），读取/修改游戏状态必须走这里。 */
    private static <T> T onClient(Callable<T> task) throws Exception {
        CompletableFuture<T> future = new CompletableFuture<>();
        MinecraftClient.getInstance().execute(() -> {
            try {
                future.complete(task.call());
            } catch (Throwable t) {
                future.completeExceptionally(t);
            }
        });
        return future.get(3, TimeUnit.SECONDS);
    }

    private static void requireGet(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            writeError(exchange, 405, "仅支持 GET");
            throw new IOException("method not allowed");
        }
    }

    private static void requirePost(HttpExchange exchange) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            writeError(exchange, 405, "仅支持 POST");
            throw new IOException("method not allowed");
        }
    }

    /**
     * S-05：令牌校验。AUTH_TOKEN 非空时，请求头 X-Observer-Token 必须匹配。
     * 防止本机其他进程（浏览器、第三方应用）在用户未授权时调用写操作端点。
     */
    private static void requireAuth(HttpExchange exchange) throws IOException {
        if (AUTH_TOKEN.isEmpty()) {
            return;
        }
        String token = exchange.getRequestHeaders().getFirst("X-Observer-Token");
        if (token == null || !AUTH_TOKEN.equals(token)) {
            writeError(exchange, 401, "未授权：缺少或无效的 X-Observer-Token");
            throw new IOException("unauthorized");
        }
    }

    /**
     * S-05：Host / Origin 校验。服务绑定 127.0.0.1，但 Host 头可被伪造（DNS rebinding），
     * Origin 头可由浏览器自动携带。只允许 127.0.0.1 / localhost，拒绝其他来源。
     */
    private static void requireLocalHost(HttpExchange exchange) throws IOException {
        String host = exchange.getRequestHeaders().getFirst("Host");
        if (host != null) {
            String h = host.toLowerCase();
            if (!h.startsWith("127.0.0.1") && !h.startsWith("localhost") && !h.startsWith("[::1]")) {
                writeError(exchange, 403, "拒绝非本地 Host");
                throw new IOException("forbidden host");
            }
        }
        String origin = exchange.getRequestHeaders().getFirst("Origin");
        if (origin != null && !origin.isEmpty()) {
            String o = origin.toLowerCase();
            if (!o.contains("127.0.0.1") && !o.contains("localhost") && !o.contains("[::1]")) {
                writeError(exchange, 403, "拒绝非本地 Origin");
                throw new IOException("forbidden origin");
            }
        }
    }

    /**
     * S-05：POST 端点必须声明 application/json，拒绝 text/plain（浏览器表单可免预检发送，
     * 是 CSRF 常见向量）。
     */
    private static void requireJsonContentType(HttpExchange exchange) throws IOException {
        String ct = exchange.getRequestHeaders().getFirst("Content-Type");
        if (ct == null || !ct.toLowerCase().contains("application/json")) {
            writeError(exchange, 415, "仅支持 application/json");
            throw new IOException("unsupported media type");
        }
    }

    /** POST 写操作端点统一校验：方法 + 本地来源 + 令牌 + JSON 内容类型。 */
    private static void requirePostWrite(HttpExchange exchange) throws IOException {
        requirePost(exchange);
        requireLocalHost(exchange);
        requireAuth(exchange);
        requireJsonContentType(exchange);
    }

    private static Map<String, String> queryParams(HttpExchange exchange) {
        var map = new java.util.HashMap<String, String>();
        String query = exchange.getRequestURI().getQuery();
        if (query == null) {
            return map;
        }
        for (String pair : query.split("&")) {
            int idx = pair.indexOf('=');
            String key = idx >= 0 ? pair.substring(0, idx) : pair;
            String value = idx >= 0 ? pair.substring(idx + 1) : "";
            map.put(java.net.URLDecoder.decode(key, StandardCharsets.UTF_8),
                    java.net.URLDecoder.decode(value, StandardCharsets.UTF_8));
        }
        return map;
    }

    private static int parseInt(String value, int fallback) {
        try {
            return value == null ? fallback : Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static double parseDouble(String value, double fallback) {
        try {
            return value == null ? fallback : Double.parseDouble(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static JsonObject readJsonBody(HttpExchange exchange) throws IOException {
        try (InputStream is = exchange.getRequestBody()) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            is.transferTo(buffer);
            String raw = buffer.toString(StandardCharsets.UTF_8);
            if (raw.isBlank()) {
                return new JsonObject();
            }
            return JsonParser.parseString(raw).getAsJsonObject();
        }
    }

    private static JsonObject gsonTree(Map<String, Object> map) {
        JsonObject json = new JsonObject();
        map.forEach((k, v) -> {
            if (v instanceof Boolean b) {
                json.addProperty(k, b);
            } else if (v instanceof Number n) {
                json.addProperty(k, n);
            } else {
                json.addProperty(k, String.valueOf(v));
            }
        });
        return json;
    }

    private static String gsonFrom(Map<String, Object> map) {
        return gsonTree(map).toString();
    }

    private static void writeJson(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static void writeError(HttpExchange exchange, int status, String message) throws IOException {
        JsonObject json = new JsonObject();
        json.addProperty("ok", false);
        json.addProperty("error", message);
        writeJson(exchange, status, json.toString());
    }
}
