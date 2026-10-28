package com.kunyu.observer.state;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 最近聊天消息环形缓冲（由 {@link com.kunyu.observer.mixin.ChatHudMixin} 写入）。
 * 只保留最近 {@value #MAX} 条纯文本，避免持有游戏对象。
 */
public final class ChatRing {
    public static final int MAX = 100;
    private static final List<String> MESSAGES =
            Collections.synchronizedList(new ArrayList<>(MAX));

    private ChatRing() {
    }

    public static void add(String message) {
        if (message == null || message.isEmpty()) {
            return;
        }
        synchronized (MESSAGES) {
            if (MESSAGES.size() >= MAX) {
                MESSAGES.remove(0);
            }
            MESSAGES.add(message);
        }
    }

    /** 返回最近 n 条（按时间正序）。 */
    public static List<String> recent(int n) {
        synchronized (MESSAGES) {
            int from = Math.max(0, MESSAGES.size() - Math.max(1, Math.min(n, MAX)));
            return new ArrayList<>(MESSAGES.subList(from, MESSAGES.size()));
        }
    }
}
