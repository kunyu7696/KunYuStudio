package kunyu.observer.probe;

import kunyu.observer.GameResolver;
import kunyu.observer.Json;
import kunyu.observer.Reflect;
import kunyu.observer.Router;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 集成服务器命令执行探针（带输出捕获）：替代旧第三方桥接通道的
 * 脚本命令执行能力，当前用于 spark 报告的在线触发与取回。
 *
 * <p>做法：在集成服务器上定位命令管理器（Mojmap Commands.performPrefixedCommand /
 * Yarn CommandManager.executeWithPrefix，签名同为 (命令源, String)→int），
 * 用动态代理构造捕获型命令源（CommandOutput 接口的 boolean 方法一律返回 true
 * 以打开反馈开关，其余方法的文本参数全部落进 lines）。全程按签名定位，
 * 不依赖任何映射成员名。</p>
 *
 * <p>命令经服务器的 execute(Runnable)（JDK Executor 方法名，跨映射稳定）投递到
 * 服务器线程执行，避免跨线程触碰命令分发器；找不到 execute 时退化为直接调用。</p>
 *
 * <p>不做任意脚本引擎：端点只接受「单行命令」语义，能力面与原版指令一致，
 * 无 JVM 内任意代码执行风险。</p>
 */
public final class CommandProbe {
    /** 命令执行最长等待（spark profiler stop 落盘可能耗时数秒）。 */
    private static final long COMMAND_TIMEOUT_MS = 60_000L;

    private CommandProbe() {
    }

    /** POST /v1/server-command：{"command":"spark profiler stop"}（斜杠可带可不带）。 */
    public static Router.Response serverCommand(Router.Request req) {
        Map<String, Object> body = Json.parseObject(req.bodyText());
        Object raw = body.get("command");
        String command = raw != null ? String.valueOf(raw).trim() : "";
        if (command.isEmpty()) {
            return Router.Response.error(400, "需要 command 字段");
        }
        if (command.startsWith("/")) {
            command = command.substring(1);
        }

        GameResolver.Game g = GameResolver.probe();
        if (g == null || g.minecraft == null) {
            return Router.Response.error(503, "游戏尚未启动或客户端类未解析");
        }
        Object server = integratedServer(g);
        if (server == null) {
            return Router.Response.error(503, "无集成服务器（未进入单人世界，或当前为联机/专用服务器会话）");
        }

        try {
            ExecResult r = execute(server, command);
            List<Object> lines = new ArrayList<>(r.lines);
            return Router.Response.json(200, Json.obj(
                    "ok", true,
                    "command", command,
                    "result", r.result,
                    "lines", lines,
                    "output", join(r.lines)));
        } catch (UnsupportedOperationException e) {
            return Router.Response.error(501, e.getMessage());
        } catch (IllegalStateException e) {
            return Router.Response.error(500, e.getMessage());
        }
    }

    // ------------------------------------------------------------------
    // 反射定位
    // ------------------------------------------------------------------

    /** 集成服务器实例：Minecraft 类上返回 IntegratedServer 类型的无参方法。 */
    static Object integratedServer(GameResolver.Game g) {
        Method m = Reflect.findNoArgByReturnTypeName(g.minecraft.getClass(),
                "net.minecraft.client.server.IntegratedServer",
                "net.minecraft.server.integrated.IntegratedServer",
                "net.minecraft.class_1132");
        if (m == null) {
            return null;
        }
        try {
            return m.invoke(g.minecraft);
        } catch (Exception e) {
            return null;
        }
    }

    private static final class ExecResult {
        int result;
        List<String> lines = new ArrayList<>();
    }

    private static ExecResult execute(Object server, String command) {
        // 1. 命令管理器与执行方法：server 的无参方法里，返回类型声明了 (X, String)→int 的那个
        Object commands = null;
        Method exec = null;
        Class<?> sourceType = null;
        for (Method m : server.getClass().getMethods()) {
            if (m.getParameterCount() != 0) {
                continue;
            }
            Method candidate = findExecMethod(m.getReturnType());
            if (candidate != null) {
                try {
                    commands = m.invoke(server);
                } catch (Exception e) {
                    continue;
                }
                if (commands != null) {
                    exec = candidate;
                    sourceType = candidate.getParameterTypes()[0];
                    break;
                }
            }
        }
        if (exec == null || commands == null || sourceType == null) {
            throw new UnsupportedOperationException("未定位命令执行入口（Commands/CommandManager）");
        }

        // 2. 捕获型命令源
        List<String> lines = Collections.synchronizedList(new ArrayList<String>());
        Object source = buildCommandSource(sourceType, server, lines);

        // 3. 服务器线程执行
        ExecResult out = new ExecResult();
        out.lines = lines;
        out.result = invokeOnServerThread(server, commands, exec, source, command);
        return out;
    }

    /** 在返回类型上找 (命令源类, String)→int 的执行方法。 */
    private static Method findExecMethod(Class<?> managerType) {
        if (managerType == null || managerType.isInterface() || managerType.isPrimitive()) {
            return null;
        }
        for (Method m : managerType.getMethods()) {
            if (m.getParameterCount() != 2 || m.getReturnType() != int.class) {
                continue;
            }
            Class<?> p0 = m.getParameterTypes()[0];
            if (!p0.isPrimitive() && !p0.isInterface() && m.getParameterTypes()[1] == String.class) {
                return m;
            }
        }
        return null;
    }

    /**
     * 构造捕获型命令源。命令源构造器在三套映射下形态一致（9 参）：
     * (CommandOutput, 位置向量, 朝向向量, 服务器世界, int 权限, String 名字, 文本组件, MinecraftServer, Entity)。
     */
    private static Object buildCommandSource(Class<?> sourceType, Object server, List<String> lines) {
        Constructor<?> ctor = Reflect.findCtorByArity(sourceType, 9);
        if (ctor == null) {
            throw new UnsupportedOperationException("未找到 9 参命令源构造器（当前 MC 版本形态不支持）");
        }
        Class<?>[] p = ctor.getParameterTypes();
        Object[] args = new Object[9];

        // [0] CommandOutput：动态代理，boolean 方法返回 true 打开反馈，文本参数全部捕获
        InvocationHandler capture = (proxy, method, callArgs) -> {
            if (callArgs != null) {
                for (Object a : callArgs) {
                    String s = stringifyMessage(a);
                    if (s != null && !s.isEmpty()) {
                        lines.add(s);
                    }
                }
            }
            Class<?> rt = method.getReturnType();
            if (rt == boolean.class) {
                return Boolean.TRUE;
            }
            if (rt == int.class || rt == long.class || rt == short.class || rt == byte.class) {
                return 0;
            }
            if (rt == float.class || rt == double.class) {
                return 0.0;
            }
            return null;
        };
        args[0] = Proxy.newProxyInstance(p[0].getClassLoader(), new Class<?>[] { p[0] }, capture);
        args[1] = Reflect.zeroInstance(p[1]);
        args[2] = Reflect.zeroInstance(p[2]);
        args[3] = serverWorld(p[3], server);
        args[4] = 4; // 权限等级 4：等价于服务器控制台，spark 等指令可用
        args[5] = "KunYuObserver";
        args[6] = literalText(p[6]);
        args[7] = server;
        args[8] = null; // Entity 可空（控制台语义）
        try {
            return ctor.newInstance(args);
        } catch (Exception e) {
            throw new UnsupportedOperationException("命令源构造失败：" + Reflect.rootMsg(e));
        }
    }

    /** 服务器主世界：server 上返回目标世界类型的无参方法（overworld/getOverworld 等，签名定位）。 */
    private static Object serverWorld(Class<?> worldType, Object server) {
        Method m = Reflect.findNoArgByReturnType(server.getClass(), worldType);
        if (m == null) {
            throw new UnsupportedOperationException("未定位服务器主世界（overworld）");
        }
        Object world = Reflect.invoke(m, server);
        if (world == null) {
            throw new UnsupportedOperationException("服务器主世界为空（维度未加载）");
        }
        return world;
    }

    /** 文本组件字面量：static (String)→文本类型（Mojmap Component.literal / Yarn Text.literal，接口静态方法）。 */
    private static Object literalText(Class<?> textType) {
        for (Method m : textType.getDeclaredMethods()) {
            if (java.lang.reflect.Modifier.isStatic(m.getModifiers())
                    && m.getParameterCount() == 1
                    && m.getParameterTypes()[0] == String.class
                    && textType.isAssignableFrom(m.getReturnType())) {
                return Reflect.invoke(m, null, "KunYu Observer");
            }
        }
        throw new UnsupportedOperationException("未定位文本组件 literal 工厂");
    }

    /** 消息对象 → 纯文本（文本组件走 getString，其余 toString；null 跳过）。 */
    private static String stringifyMessage(Object a) {
        if (a == null) {
            return null;
        }
        if (a instanceof String) {
            return (String) a;
        }
        return Reflect.textOf(a);
    }

    /** 经 execute(Runnable) 投递到服务器线程执行；无 execute 时退化为当前线程直接调用。 */
    private static int invokeOnServerThread(Object server, Object commands, Method exec, Object source, String command) {
        Method execute = Reflect.findMethod(server.getClass(), "execute", Runnable.class);
        if (execute == null) {
            Object r = Reflect.invoke(exec, commands, source, command);
            return r instanceof Number ? ((Number) r).intValue() : 0;
        }
        final int[] result = { 0 };
        final Throwable[] error = { null };
        CountDownLatch latch = new CountDownLatch(1);
        Runnable task = () -> {
            try {
                Object r = exec.invoke(commands, source, command);
                if (r instanceof Number) {
                    result[0] = ((Number) r).intValue();
                }
            } catch (Throwable t) {
                error[0] = t;
            } finally {
                latch.countDown();
            }
        };
        try {
            execute.invoke(server, task);
        } catch (Exception e) {
            throw new IllegalStateException("投递命令到服务器线程失败：" + Reflect.rootMsg(e));
        }
        try {
            if (!latch.await(COMMAND_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                throw new IllegalStateException("命令执行超时（" + COMMAND_TIMEOUT_MS + "ms）");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("命令执行被中断");
        }
        if (error[0] != null) {
            throw new IllegalStateException("命令执行异常：" + Reflect.rootMsg(error[0]));
        }
        return result[0];
    }

    private static String join(List<String> lines) {
        StringBuilder sb = new StringBuilder();
        for (String s : lines) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(s);
        }
        return sb.toString();
    }
}
