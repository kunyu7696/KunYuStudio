package kunyu.observer;

import java.lang.instrument.Instrumentation;

/**
 * KunYu Observer Agent 入口：以 {@code -javaagent} 注入任意 Minecraft 客户端 JVM。
 *
 * <p>定位：替代旧 Fabric mod（resources/observer-mod）的跨加载器观察能力——
 * JVM 级 javaagent 天然与 Fabric / Forge / NeoForge 及 MC 全版本无关，
 * 不再锁死在 Fabric 1.20.1 Yarn，也不再是一个 mod。</p>
 *
 * <p>启动方式（由 KunYu 主进程 mcLaunchService 拼装 JVM 参数注入）：</p>
 * <pre>
 *   java -javaagent:&lt;agent.jar&gt;=port=9876,token=&lt;随机令牌&gt; ...
 * </pre>
 *
 * <p>premain 远早于 MC 主类加载，此时游戏类尚未链接：本入口只启动 HTTP 服务
 * 并保存 {@link Instrumentation} 句柄，所有游戏类访问都在首次请求时经
 * {@link GameResolver} 惰性反射解析并缓存。</p>
 */
public final class Agent {
    /** 服务标识：与旧 mod 保持一致，主进程 probeObserver 按此值识别。 */
    public static final String ID = "kunyu_observer";
    public static final String VERSION = "2.1.0-agent";
    /** 协议版本沿用旧 mod 的 v3（能力面由 health.capabilities 动态声明）。 */
    public static final int PROTOCOL = 3;

    private static volatile boolean started = false;

    private Agent() {
    }

    public static void premain(String args, Instrumentation inst) {
        boot(args, inst);
    }

    public static void agentmain(String args, Instrumentation inst) {
        boot(args, inst);
    }

    private static synchronized void boot(String args, Instrumentation inst) {
        if (started) {
            return;
        }
        started = true;
        try {
            GameResolver.init(inst);
            AgentArgs parsed = AgentArgs.parse(args);
            Httpd.start(parsed);
            log("观察服务已启动：http://127.0.0.1:" + Httpd.port() + "/（agent 模式，协议 v" + PROTOCOL + "）");
        } catch (Throwable t) {
            // agent 失败绝不能拖垮游戏 JVM：只记录，不重抛
            log("观察服务启动失败：" + t);
        }
    }

    static void log(String msg) {
        System.out.println("[kunyu-observer-agent] " + msg);
    }
}
