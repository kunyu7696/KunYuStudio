package kunyu.observer;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.instrument.Instrumentation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * 跨加载器 / 跨版本 Minecraft 客户端解析器（反射 + 候选名与类型双重探测）。
 *
 * <p>同一个逻辑类在不同映射环境下的名字不同：</p>
 * <ul>
 *   <li>Mojmap（Forge / NeoForge 生产）：net.minecraft.client.Minecraft</li>
 *   <li>Yarn（Fabric 开发）：net.minecraft.client.MinecraftClient</li>
 *   <li>intermediary（Fabric 生产）：net.minecraft.class_310</li>
 *   <li>官方混淆（无加载器）：无法可靠解析，按不可用处理（health 仍在线）</li>
 * </ul>
 *
 * <p>类定位优先走 {@link Instrumentation#getAllLoadedClasses()}——agent 类在系统
 * 类加载器里，而 MC 类常在子加载器（Fabric Knot / Forge TransformingClassLoader），
 * Class.forName 从父加载器看不到子加载器的类，必须靠 instrumentation 全量扫描。</p>
 *
 * <p>方法 / 字段定位不依赖映射名：单例用「返回自身类型的 public static 无参方法」，
 * 玩家 / 世界用「Minecraft 类里类型匹配的实例字段」，从而天然兼容三套映射。</p>
 */
public final class GameResolver {
    /** Minecraft 主类候选名：Mojmap → Yarn → intermediary。 */
    private static final String[] MINECRAFT = {
            "net.minecraft.client.Minecraft",
            "net.minecraft.client.MinecraftClient",
            "net.minecraft.class_310"
    };
    /** 客户端玩家类候选名。 */
    private static final String[] PLAYER = {
            "net.minecraft.client.player.LocalPlayer",
            "net.minecraft.client.network.ClientPlayerEntity",
            "net.minecraft.class_746"
    };
    /** 客户端世界类候选名。 */
    private static final String[] WORLD = {
            "net.minecraft.client.multiplayer.ClientLevel",
            "net.minecraft.client.world.ClientWorld",
            "net.minecraft.class_638"
    };

    /** 解析重试节流：游戏启动早期 MC 类未加载，每次全量扫描有开销。 */
    private static final long RETRY_INTERVAL_MS = 1000L;

    private static Instrumentation inst;

    private static long lastAttempt;
    private static Class<?> minecraftClass;
    private static Method getInstance;
    private static Field playerField;
    private static Field worldField;
    private static String version = "unknown";

    private GameResolver() {
    }

    public static void init(Instrumentation instrumentation) {
        inst = instrumentation;
    }

    /** 一次探测得到的游戏状态快照（MC 不可解析时为 null）。 */
    public static final class Game {
        public final Object minecraft;
        public final Object player;
        public final Object world;
        public final String version;

        Game(Object minecraft, Object player, Object world, String version) {
            this.minecraft = minecraft;
            this.player = player;
            this.world = world;
            this.version = version;
        }

        public boolean inGame() {
            return player != null;
        }
    }

    /** 探测当前游戏状态；MC 类未加载 / 不可解析时返回 null。 */
    public static Game probe() {
        if (!ensureResolved()) {
            return null;
        }
        try {
            Object mc = getInstance.invoke(null);
            if (mc == null) {
                return new Game(null, null, null, version);
            }
            Object player = playerField != null ? playerField.get(mc) : null;
            Object world = worldField != null ? worldField.get(mc) : null;
            return new Game(mc, player, world, version);
        } catch (Throwable t) {
            return null;
        }
    }

    private static synchronized boolean ensureResolved() {
        if (minecraftClass != null) {
            return true;
        }
        long now = System.currentTimeMillis();
        if (now - lastAttempt < RETRY_INTERVAL_MS) {
            return false;
        }
        lastAttempt = now;

        Class<?> mc = findClass(MINECRAFT);
        if (mc == null) {
            return false;
        }
        Method singleton = findSingletonMethod(mc);
        if (singleton == null) {
            return false;
        }
        Class<?> player = findClass(PLAYER);
        Class<?> world = findClass(WORLD);
        minecraftClass = mc;
        getInstance = singleton;
        playerField = player != null ? findFieldByType(mc, player) : null;
        worldField = world != null ? findFieldByType(mc, world) : null;
        version = detectVersion(mc);
        Agent.log("MC 客户端已解析：" + mc.getName() + "（版本 " + version + "）");
        return true;
    }

    /** 探针共用：按候选类名定位已加载类（Mojmap → Yarn → intermediary 顺序传入）。 */
    public static Class<?> findLoadedClass(String... candidates) {
        return findClass(candidates);
    }

    // ------------------------------------------------------------------
    // 类 / 成员定位
    // ------------------------------------------------------------------

    private static Class<?> findClass(String[] candidates) {
        for (String name : candidates) {
            Class<?> c = findLoaded(name);
            if (c != null) {
                return c;
            }
        }
        return null;
    }

    private static Class<?> findLoaded(String name) {
        if (inst != null) {
            for (Class<?> c : inst.getAllLoadedClasses()) {
                if (c.getName().equals(name)) {
                    return c;
                }
            }
        }
        // 兜底：系统类加载器与线程上下文类加载器
        ClassLoader[] loaders = {
                ClassLoader.getSystemClassLoader(),
                Thread.currentThread().getContextClassLoader()
        };
        for (ClassLoader cl : loaders) {
            if (cl == null) {
                continue;
            }
            try {
                return Class.forName(name, false, cl);
            } catch (Throwable ignored) {
                // 换下一个
            }
        }
        return null;
    }

    /** 单例方法：public static 无参且返回自身类型（getInstance，任意映射名通用）。 */
    private static Method findSingletonMethod(Class<?> cls) {
        for (Method m : cls.getDeclaredMethods()) {
            if (Modifier.isStatic(m.getModifiers()) && m.getParameterCount() == 0 && m.getReturnType() == cls) {
                try {
                    m.setAccessible(true);
                } catch (Throwable ignored) {
                    // public 方法本身可调用，setAccessible 失败不致命
                }
                return m;
            }
        }
        return null;
    }

    /** 实例字段按类型匹配：player / world 字段名随映射变化，类型不变。 */
    private static Field findFieldByType(Class<?> owner, Class<?> type) {
        for (Field f : owner.getDeclaredFields()) {
            if (!Modifier.isStatic(f.getModifiers()) && f.getType() == type) {
                try {
                    f.setAccessible(true);
                    return f;
                } catch (Throwable t) {
                    // 强封装模块下私有字段不可达：放弃该字段（对应能力降级，不影响其它）
                    return null;
                }
            }
        }
        return null;
    }

    /**
     * 版本检测：读 MC 客户端 jar 内的 version.json（{"id":"1.20.1","name":"1.20.1",...}）。
     * 三种映射的生产 / 开发环境 jar 都带这个资源，比反射版本方法（名字随映射变化）可靠。
     */
    private static String detectVersion(Class<?> mcClass) {
        ClassLoader cl = mcClass.getClassLoader();
        try (InputStream in = cl != null
                ? cl.getResourceAsStream("version.json")
                : ClassLoader.getSystemResourceAsStream("version.json")) {
            if (in == null) {
                return "unknown";
            }
            String text = new String(readAll(in), StandardCharsets.UTF_8);
            Map<String, Object> json = Json.parseObject(text);
            Object name = json.get("name");
            Object id = json.get("id");
            return name != null ? String.valueOf(name) : id != null ? String.valueOf(id) : "unknown";
        } catch (Throwable t) {
            return "unknown";
        }
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(4096);
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) >= 0) {
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }
}
