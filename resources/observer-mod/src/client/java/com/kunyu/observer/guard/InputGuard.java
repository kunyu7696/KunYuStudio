package com.kunyu.observer.guard;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;

/**
 * 输入注入护栏（进程内）：
 * <ul>
 *   <li>服务只绑定 loopback，外部网络无法访问；</li>
 *   <li>滑动窗口限流：{@link #WINDOW_MS} 毫秒内最多 {@link #MAX_EVENTS} 个注入事件，
 *       超限直接拒绝（熔断），防止 AI 失控时键鼠狂轰滥炸；</li>
 *   <li>可用 {@code -Dkunyu.observer.inputEnabled=false} 彻底关闭注入能力。</li>
 * </ul>
 */
public final class InputGuard {
    /** 滑动窗口长度（毫秒）。 */
    public static final long WINDOW_MS = 30_000L;
    /** 窗口内允许的最大注入事件数。 */
    public static final int MAX_EVENTS = 60;

    private static final Deque<Long> EVENTS = new ArrayDeque<>();
    private static long rejected = 0;

    private InputGuard() {
    }

    /** 注入能力是否被启动参数彻底关闭。 */
    public static boolean inputEnabled() {
        return Boolean.parseBoolean(System.getProperty("kunyu.observer.inputEnabled", "true"));
    }

    /**
     * 尝试登记一次注入事件。
     *
     * @return true 放行；false 表示已熔断（窗口内事件超限或功能被关闭）
     */
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

    /** 当前护栏状态（供 /v1/guard 查询）。 */
    public static synchronized Map<String, Object> stats() {
        long now = System.currentTimeMillis();
        while (!EVENTS.isEmpty() && now - EVENTS.peekFirst() > WINDOW_MS) {
            EVENTS.pollFirst();
        }
        return Map.of(
                "enabled", inputEnabled(),
                "windowMs", WINDOW_MS,
                "maxEvents", MAX_EVENTS,
                "used", EVENTS.size(),
                "remaining", MAX_EVENTS - EVENTS.size(),
                "rejectedTotal", rejected
        );
    }
}
