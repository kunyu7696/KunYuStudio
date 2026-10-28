package kunyu.observer.probe;

import kunyu.observer.GameResolver;
import kunyu.observer.Guard;
import kunyu.observer.Json;
import kunyu.observer.Reflect;
import kunyu.observer.Router;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 游戏状态探针：玩家状态 / 世界环境 / 附近实体 / 聚合快照。
 *
 * <p>全部走签名驱动反射（见 {@link Reflect}），命名映射（Mojmap/Yarn）下能力完整；
 * intermediary / 官方混淆环境逐项降级（坐标仍可靠，血量/饥饿等字段退为 0），
 * 任一子项失败只影响该子项，不拖垮整个端点。</p>
 *
 * <p>聊天与屏幕控件树在旧 mod 里靠 Mixin 捕获，javaagent 无织入能力，
 * 快照中对应字段按空值降级（chat.messages=[]、screen.open=false），
 * 由 health.capabilities 如实声明，主进程按能力挑选。</p>
 */
public final class GameProbes {
    private GameProbes() {
    }

    /** GET /v1/player：玩家状态；未进入世界 503（主进程据此轮询进世界）。 */
    public static Router.Response player(Router.Request req) {
        GameResolver.Game g = GameResolver.probe();
        if (g == null || g.minecraft == null) {
            return Router.Response.error(503, "游戏尚未启动或客户端类未解析");
        }
        if (g.player == null) {
            return Router.Response.error(503, "尚未进入世界（玩家对象为空）");
        }
        return Router.Response.json(200, playerJson(g));
    }

    /** GET /v1/world：世界环境（时间/维度/天气）；坐标查询（方块读取）尚未实现 → 501。 */
    public static Router.Response world(Router.Request req) {
        if (req.query.containsKey("x") || req.query.containsKey("y") || req.query.containsKey("z")) {
            return Router.Response.error(501, "按坐标读取方块尚未在 agent 版本实现");
        }
        GameResolver.Game g = GameResolver.probe();
        if (g == null || g.minecraft == null) {
            return Router.Response.error(503, "游戏尚未启动或客户端类未解析");
        }
        if (g.world == null) {
            return Router.Response.error(503, "尚未进入世界（世界对象为空）");
        }
        return Router.Response.json(200, worldJson(g));
    }

    /** GET /v1/snapshot：玩家 + 世界 + 附近实体 + 护栏的聚合快照（聊天/屏幕降级为空值）。 */
    public static Router.Response snapshot(Router.Request req) {
        GameResolver.Game g = GameResolver.probe();
        if (g == null || g.minecraft == null) {
            return Router.Response.error(503, "游戏尚未启动或客户端类未解析");
        }
        if (g.player == null) {
            return Router.Response.error(503, "尚未进入世界（玩家对象为空）");
        }
        int radius = parseInt(req.query.get("radius"), 24);
        int entityLimit = parseInt(req.query.get("entityLimit"), 16);
        int chatLimit = parseInt(req.query.get("chatLimit"), 20);
        String typeFilter = req.query.get("type");

        StringBuilder sb = new StringBuilder(512);
        sb.append('{');
        sb.append("\"now\":").append(System.currentTimeMillis()).append(',');
        sb.append("\"player\":").append(playerJson(g)).append(',');
        sb.append("\"world\":").append(g.world != null ? worldJson(g) : "{\"time\":0,\"timeOfDay\":0,\"dimension\":\"unknown\",\"raining\":false}").append(',');
        sb.append("\"nearby\":").append(nearbyJson(g, radius, entityLimit, typeFilter)).append(',');
        // javaagent 无 Mixin 捕获能力：聊天与屏幕按空值降级，chatLimit 保留以维持旧协议形状
        sb.append("\"chat\":{\"messages\":[],\"degraded\":true,\"chatLimit\":").append(chatLimit).append("},");
        sb.append("\"screen\":{\"open\":false,\"degraded\":true},");
        sb.append("\"guard\":").append(guardJson());
        sb.append('}');
        return Router.Response.json(200, sb.toString());
    }

    // ------------------------------------------------------------------
    // 子项序列化
    // ------------------------------------------------------------------

    static String playerJson(GameResolver.Game g) {
        Object player = g.player;
        double[] pos = Reflect.entityPos(player);

        String name = "";
        String uuid = "";
        // GameProfile 来自 Mojang authlib（不被任何 MC 映射重命名），跨映射最可靠
        Method profile = Reflect.findNoArgByReturnTypeName(player.getClass(), "com.mojang.authlib.GameProfile");
        if (profile != null) {
            Object gp = Reflect.invoke(profile, player);
            if (gp != null) {
                Method getName = Reflect.findNoArg(gp.getClass(), "getName");
                Method getId = Reflect.findNoArg(gp.getClass(), "getId");
                if (getName != null) {
                    name = String.valueOf(Reflect.invoke(getName, gp));
                }
                if (getId != null) {
                    Object id = Reflect.invoke(getId, gp);
                    uuid = id != null ? String.valueOf(id) : "";
                }
            }
        }
        if (name.isEmpty()) {
            Method getName = Reflect.findNoArg(player.getClass(), "getName");
            name = getName != null ? Reflect.textOf(Reflect.invoke(getName, player)) : "unknown";
        }
        if (uuid.isEmpty()) {
            Method stringUuid = Reflect.findNoArg(player.getClass(), "getStringUUID", "getUuidAsString");
            if (stringUuid != null) {
                uuid = String.valueOf(Reflect.invoke(stringUuid, player));
            }
        }

        float yaw = numberOrZero(Reflect.findNoArg(player.getClass(), "getYaw", "getYRot"), player);
        float pitch = numberOrZero(Reflect.findNoArg(player.getClass(), "getPitch", "getXRot"), player);
        float health = numberOrZero(Reflect.findNoArg(player.getClass(), "getHealth"), player);
        int food = foodLevel(player);
        boolean onGround = boolOrTrue(Reflect.findNoArg(player.getClass(), "onGround", "isOnGround"), player);
        int selectedSlot = selectedSlot(player);
        String gameMode = gameMode(g);

        return Json.obj(
                "name", name,
                "uuid", uuid,
                "x", pos[0],
                "y", pos[1],
                "z", pos[2],
                "yaw", yaw,
                "pitch", pitch,
                "health", health,
                "food", food,
                "onGround", onGround,
                "selectedSlot", selectedSlot,
                "gameMode", gameMode);
    }

    static String worldJson(GameResolver.Game g) {
        Object world = g.world;
        long time = longOrZero(Reflect.findNoArg(world.getClass(), "getTime", "getDayTime"), world);
        long timeOfDay = longOrZero(Reflect.findNoArg(world.getClass(), "getTimeOfDay", "getDayTime"), world);
        boolean raining = boolOrFalse(Reflect.findNoArg(world.getClass(), "isRaining"), world);
        boolean thundering = boolOrFalse(Reflect.findNoArg(world.getClass(), "isThundering"), world);
        return Json.obj(
                "time", time,
                "timeOfDay", timeOfDay,
                "dimension", dimension(world),
                "raining", raining,
                "thundering", thundering);
    }

    static String nearbyJson(GameResolver.Game g, int radius, int limit, String typeFilter) {
        double[] origin = Reflect.entityPos(g.player);
        List<String[]> rows = new ArrayList<>(); // [type,name,uuid,x,y,z,distance]
        if (g.world != null) {
            Method entitiesAccessor = findEntitiesAccessor(g.world.getClass());
            if (entitiesAccessor != null) {
                Object iterable = Reflect.invoke(entitiesAccessor, g.world);
                if (iterable instanceof Iterable) {
                    for (Object entity : (Iterable<?>) iterable) {
                        if (entity == null || entity == g.player) {
                            continue;
                        }
                        double[] pos;
                        try {
                            pos = Reflect.entityPos(entity);
                        } catch (IllegalStateException e) {
                            continue;
                        }
                        double dx = pos[0] - origin[0];
                        double dy = pos[1] - origin[1];
                        double dz = pos[2] - origin[2];
                        double dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                        if (dist > radius) {
                            continue;
                        }
                        String type = entityTypeId(entity);
                        if (typeFilter != null && !typeFilter.isEmpty()) {
                            String want = typeFilter.contains(":") ? typeFilter : "minecraft:" + typeFilter;
                            if (!type.equals(want) && !type.endsWith(":" + typeFilter)) {
                                continue;
                            }
                        }
                        rows.add(new String[] {
                                type,
                                entityName(entity),
                                entityUuid(entity),
                                String.valueOf(pos[0]),
                                String.valueOf(pos[1]),
                                String.valueOf(pos[2]),
                                String.valueOf(dist)
                        });
                    }
                }
            }
        }
        rows.sort(Comparator.comparingDouble(r -> Double.parseDouble(r[6])));
        StringBuilder sb = new StringBuilder(256);
        sb.append("{\"radius\":").append(radius);
        if (typeFilter != null && !typeFilter.isEmpty()) {
            sb.append(",\"type\":").append(Json.quote(typeFilter));
        }
        sb.append(",\"entities\":[");
        int n = Math.min(rows.size(), Math.max(1, limit));
        for (int i = 0; i < n; i++) {
            String[] r = rows.get(i);
            if (i > 0) {
                sb.append(',');
            }
            sb.append(Json.obj(
                    "type", r[0],
                    "name", r[1],
                    "uuid", r[2],
                    "x", Json.raw(r[3]),
                    "y", Json.raw(r[4]),
                    "z", Json.raw(r[5]),
                    "distance", Json.raw(r[6])));
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String guardJson() {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : Guard.stats().entrySet()) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append(Json.quote(e.getKey())).append(':');
            Object v = e.getValue();
            if (v instanceof Boolean || v instanceof Number) {
                sb.append(v);
            } else {
                sb.append(Json.quote(String.valueOf(v)));
            }
        }
        return sb.append('}').toString();
    }

    // ------------------------------------------------------------------
    // 字段级辅助
    // ------------------------------------------------------------------

    /** 维度 id：world.dimension()/getRegistryKey() → location()/getValue() → toString。 */
    private static String dimension(Object world) {
        Method keyAccessor = Reflect.findNoArg(world.getClass(), "dimension", "getRegistryKey");
        if (keyAccessor == null) {
            keyAccessor = Reflect.findNoArgByReturnTypeName(world.getClass(), "ResourceKey", "RegistryKey", "class_5321");
        }
        if (keyAccessor == null) {
            return "unknown";
        }
        Object key = Reflect.invoke(keyAccessor, world);
        if (key == null) {
            return "unknown";
        }
        Method idAccessor = Reflect.findNoArg(key.getClass(), "location", "getValue");
        if (idAccessor == null) {
            idAccessor = Reflect.findNoArgByReturnTypeName(key.getClass(), "ResourceLocation", "Identifier", "class_2960");
        }
        if (idAccessor == null) {
            return String.valueOf(key);
        }
        Object id = Reflect.invoke(idAccessor, key);
        return id != null ? String.valueOf(id) : "unknown";
    }

    /** 世界实体迭代器：Yarn getEntities / Mojmap entitiesForRendering；兜底任意返回 Iterable 的无参方法。 */
    private static Method findEntitiesAccessor(Class<?> worldClass) {
        Method named = Reflect.findNoArg(worldClass, "getEntities", "entitiesForRendering", "getEntitiesForRendering");
        if (named != null && Iterable.class.isAssignableFrom(named.getReturnType())) {
            return named;
        }
        for (Class<?> c = worldClass; c != null && c != Object.class; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (m.getParameterCount() == 0 && Iterable.class.isAssignableFrom(m.getReturnType())) {
                    if (Reflect.tryAccessible(m)) {
                        return m;
                    }
                }
            }
        }
        return null;
    }

    /** 实体类型 id（如 minecraft:cow）：注册表反查优先，退化到类型对象 toString。 */
    private static String entityTypeId(Object entity) {
        Object typeObj = null;
        Method getType = Reflect.findNoArg(entity.getClass(), "getType");
        if (getType != null) {
            typeObj = Reflect.invoke(getType, entity);
        }
        if (typeObj != null) {
            String viaRegistry = registryIdOf("ENTITY_TYPE", typeObj);
            if (viaRegistry != null) {
                return viaRegistry;
            }
            String s = String.valueOf(typeObj);
            if (!s.isEmpty()) {
                return s;
            }
        }
        return entity.getClass().getSimpleName();
    }

    /**
     * 经内置注册表反查值 id：holder（BuiltInRegistries/Registries/class_7923）的
     * 指定静态字段 → registry.getKey/getId(value) → toString。命名映射可用，混淆环境返回 null。
     */
    static String registryIdOf(String fieldName, Object value) {
        Class<?> holder = Reflect.findClass(
                "net.minecraft.core.registries.BuiltInRegistries",
                "net.minecraft.registry.Registries",
                "net.minecraft.class_7923");
        if (holder == null) {
            return null;
        }
        Object registry = null;
        try {
            Field f = holder.getField(fieldName);
            registry = f.get(null);
        } catch (Exception e) {
            return null;
        }
        if (registry == null) {
            return null;
        }
        for (String name : new String[] { "getKey", "getId" }) {
            for (Method m : registry.getClass().getMethods()) {
                if (m.getName().equals(name) && m.getParameterCount() == 1) {
                    try {
                        Object id = m.invoke(registry, value);
                        if (id != null) {
                            String s = String.valueOf(id);
                            if (!s.isEmpty() && !s.equals("null")) {
                                return s;
                            }
                        }
                    } catch (Exception ignored) {
                        // 换下一个候选方法
                    }
                }
            }
        }
        return null;
    }

    private static String entityName(Object entity) {
        Method getName = Reflect.findNoArg(entity.getClass(), "getName");
        if (getName != null) {
            return Reflect.textOf(Reflect.invoke(getName, entity));
        }
        return entityTypeId(entity);
    }

    private static String entityUuid(Object entity) {
        Method stringUuid = Reflect.findNoArg(entity.getClass(), "getStringUUID", "getUuidAsString");
        if (stringUuid != null) {
            return String.valueOf(Reflect.invoke(stringUuid, entity));
        }
        Method uuidAccessor = Reflect.findNoArg(entity.getClass(), "getUUID", "getUuid");
        if (uuidAccessor != null) {
            Object id = Reflect.invoke(uuidAccessor, entity);
            return id != null ? String.valueOf(id) : "";
        }
        return "";
    }

    private static int foodLevel(Object player) {
        Method accessor = Reflect.findNoArg(player.getClass(), "getFoodData", "getHungerManager");
        if (accessor == null) {
            return 0;
        }
        Object foodData = Reflect.invoke(accessor, player);
        if (foodData == null) {
            return 0;
        }
        Method level = Reflect.findNoArg(foodData.getClass(), "getFoodLevel");
        if (level == null) {
            return 0;
        }
        Object v = Reflect.invoke(level, foodData);
        return v instanceof Number ? ((Number) v).intValue() : 0;
    }

    /** 快捷栏槽位：getInventory() → public int 字段 selected/selectedSlot。 */
    private static int selectedSlot(Object player) {
        Method inv = Reflect.findNoArg(player.getClass(), "getInventory");
        if (inv == null) {
            return 0;
        }
        Object inventory = Reflect.invoke(inv, player);
        if (inventory == null) {
            return 0;
        }
        for (String name : new String[] { "selected", "selectedSlot" }) {
            try {
                Field f = inventory.getClass().getField(name);
                if (f.getType() == int.class) {
                    return f.getInt(inventory);
                }
            } catch (Exception ignored) {
                // 换下一个字段名
            }
        }
        return 0;
    }

    /** 游戏模式：Minecraft 的交互管理器（返回枚举的无参方法）→ 枚举 name() 小写。 */
    private static String gameMode(GameResolver.Game g) {
        Method manager = Reflect.findNoArgByReturnTypeName(g.minecraft.getClass(),
                "MultiPlayerGameMode", "ClientPlayerInteractionManager", "class_636");
        if (manager == null) {
            return "unknown";
        }
        Object gm = Reflect.invoke(manager, g.minecraft);
        if (gm == null) {
            return "unknown";
        }
        for (Class<?> c = gm.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (m.getParameterCount() == 0 && m.getReturnType().isEnum()) {
                    try {
                        Object mode = m.invoke(gm);
                        if (mode instanceof Enum) {
                            return ((Enum<?>) mode).name().toLowerCase(java.util.Locale.ROOT);
                        }
                    } catch (Exception ignored) {
                        // 换下一个枚举方法
                    }
                }
            }
        }
        return "unknown";
    }

    // ------------------------------------------------------------------
    // 小工具
    // ------------------------------------------------------------------

    private static float numberOrZero(Method m, Object target) {
        if (m == null) {
            return 0f;
        }
        Object v = Reflect.invoke(m, target);
        return v instanceof Number ? ((Number) v).floatValue() : 0f;
    }

    private static long longOrZero(Method m, Object target) {
        if (m == null) {
            return 0L;
        }
        Object v = Reflect.invoke(m, target);
        return v instanceof Number ? ((Number) v).longValue() : 0L;
    }

    private static boolean boolOrTrue(Method m, Object target) {
        if (m == null) {
            return true;
        }
        Object v = Reflect.invoke(m, target);
        return !(v instanceof Boolean) || (Boolean) v;
    }

    private static boolean boolOrFalse(Method m, Object target) {
        if (m == null) {
            return false;
        }
        Object v = Reflect.invoke(m, target);
        return v instanceof Boolean && (Boolean) v;
    }

    private static int parseInt(String raw, int fallback) {
        try {
            return raw == null ? fallback : Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /** 供 CommandProbe 复用：Minecraft 类上的单例/字段访问已在 GameResolver 缓存。 */
    static Class<?> minecraftClassOf(GameResolver.Game g) {
        return g.minecraft.getClass();
    }
}
