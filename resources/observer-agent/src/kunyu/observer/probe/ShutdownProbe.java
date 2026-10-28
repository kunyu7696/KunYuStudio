package kunyu.observer.probe;

import kunyu.observer.GameResolver;
import kunyu.observer.Json;
import kunyu.observer.Reflect;
import kunyu.observer.Router;

import java.lang.reflect.Method;

/**
 * 优雅退出探针：替代旧第三方桥接通道的 mc.stop() 能力（沙箱 shutdown 阶段）。
 *
 * <p>定位 Minecraft 客户端的 stop()/close()（Mojmap/Yarn 命名映射），经客户端
 * 主循环的 execute(Runnable) 投递执行；响应先于退出动作返回（延迟 400ms），
 * 保证主进程能收到 200 再看到游戏进程退出。</p>
 *
 * <p>混淆环境（intermediary/官方混淆）方法名不可达时返回 501，
 * 主进程按既有行为退化为进程树终止，语义与旧 observer 通道一致。</p>
 */
public final class ShutdownProbe {
    /** 响应写出后到触发退出的延迟。 */
    private static final long STOP_DELAY_MS = 400L;

    private ShutdownProbe() {
    }

    /** POST /v1/shutdown：请求客户端优雅退出（立即返回，退出动作异步发生）。 */
    public static Router.Response shutdown(Router.Request req) {
        GameResolver.Game g = GameResolver.probe();
        if (g == null || g.minecraft == null) {
            return Router.Response.error(503, "游戏尚未启动或客户端类未解析");
        }
        Method stop = Reflect.findNoArg(g.minecraft.getClass(), "stop", "close", "shutdown");
        if (stop == null) {
            return Router.Response.error(501, "当前映射环境未定位优雅退出方法（stop/close），请走进程终止兜底");
        }
        Method execute = Reflect.findMethod(g.minecraft.getClass(), "execute", Runnable.class);
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(STOP_DELAY_MS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            Runnable task = () -> {
                try {
                    stop.invoke(g.minecraft);
                } catch (Throwable ignored) {
                    // 退出过程中的异常不影响 JVM 关停
                }
            };
            if (execute != null) {
                try {
                    execute.invoke(g.minecraft, task);
                    return;
                } catch (Throwable ignored) {
                    // 退化为直接调用
                }
            }
            task.run();
        }, "kunyu-observer-shutdown");
        t.setDaemon(true);
        t.start();
        return Router.Response.json(200, Json.obj(
                "ok", true,
                "detail", "已请求客户端优雅退出（" + STOP_DELAY_MS + "ms 后执行）"));
    }
}
