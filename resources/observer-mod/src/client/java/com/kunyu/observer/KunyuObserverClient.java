package com.kunyu.observer;

import com.kunyu.observer.http.ObserverHttpServer;
import net.fabricmc.api.ClientModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * KunYu Observer 客户端入口。
 *
 * <p>启动一个仅绑定 127.0.0.1 的内置 HTTP 服务，向 KunYuEcosystem 工作台
 * 提供截图、玩家/世界状态查询和受限输入注入，用于 AI 生成结果的真机闭环验证。</p>
 *
 * <p>端口可用 JVM 参数覆盖：{@code -Dkunyu.observer.port=9877}（默认 9876）。</p>
 */
public class KunyuObserverClient implements ClientModInitializer {
    public static final String MOD_ID = "kunyu_observer";
    public static final String MOD_VERSION = "1.0.0";
    public static final int DEFAULT_PORT = 9876;
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitializeClient() {
        int port = Integer.getInteger("kunyu.observer.port", DEFAULT_PORT);
        try {
            ObserverHttpServer.start(port);
            LOGGER.info("[kunyu-observer] 观察服务已启动：http://127.0.0.1:{}/", port);
        } catch (Exception e) {
            LOGGER.error("[kunyu-observer] 观察服务启动失败（端口 {} 被占用？）", port, e);
        }
    }
}
