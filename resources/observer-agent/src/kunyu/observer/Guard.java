package kunyu.observer;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 输入注入护栏（与旧 mod InputGuard 语义一致）：
 * 滑动窗口 {@value #WINDOW_MS}ms 内最多 {@value #MAX_EVENTS} 个注入事件，超限熔断。
 * 批 1 仅暴露状态查询；批 3 的 /v1/input 端点复用 {@link #tryAcquire()}。
 */
public final class Guard {
    public static final long WINDOW_MS = 30_000L;
    public static final int MAX_EVENTS = 60;

    private static final Deque<Long> EVENTS = new ArrayDeque<>();
    private static long rejected = 0;

    private Guard() {
    }

    public static boolean inputEnabled() {
        return Httpd.args() == null || Httpd.args().inputEnabled();
    }

    /** 尝试登记一次注入事件；false = 已熔断或功能被关闭。 */
    public static synchronized boolean tryAcquire() {
        if (!inputEnabled()) {
            rejected++;
            return false;
        }
        long now = System.currentTimeMillis();
        while (!EVENTS.isEmpty() && now - EVENTS.peekFirst() > WINDOW_MS) {
            EVENTS.pollFirst();
        }
        if (EVENTS.size() >= MAX_EVENTS) {
            rejected++;
            return false;
        }
        EVENTS.addLast(now);
        return true;
    }

    /** 当前护栏状态（/v1/guard）。 */
    public static synchronized Map<String, Object> stats() {
        long now = System.currentTimeMillis();
        while (!EVENTS.isEmpty() && now - EVENTS.peekFirst() > WINDOW_MS) {
            EVENTS.pollFirst();
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", inputEnabled());
        m.put("windowMs", WINDOW_MS);
        m.put("maxEvents", MAX_EVENTS);
        m.put("used", EVENTS.size());
        m.put("remaining", MAX_EVENTS - EVENTS.size());
        m.put("rejectedTotal", rejected);
        return m;
    }
}
