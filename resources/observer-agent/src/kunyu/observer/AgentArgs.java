package kunyu.observer;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * agent 参数解析：{@code -javaagent:xx.jar=port=9876,token=abc,inputEnabled=true}。
 *
 * <p>token 与 inputEnabled 同时支持旧版 {@code -Dkunyu.observer.*} 系统属性回退，
 * 便于过渡期与旧启动链路共存。</p>
 */
public final class AgentArgs {
    public static final int DEFAULT_PORT = 9876;
    /** 与旧 mod / 主进程端口扫描段一致：9876..9886。 */
    public static final int PORT_COUNT = 11;

    private final int basePort;
    private final int portCount;
    private final String token;
    private final boolean inputEnabled;

    private AgentArgs(int basePort, int portCount, String token, boolean inputEnabled) {
        this.basePort = basePort;
        this.portCount = portCount;
        this.token = token;
        this.inputEnabled = inputEnabled;
    }

    public int basePort() {
        return basePort;
    }

    public int portCount() {
        return portCount;
    }

    /** 写操作端点访问令牌；空串表示不校验（与旧 mod 行为一致）。 */
    public String token() {
        return token;
    }

    public boolean inputEnabled() {
        return inputEnabled;
    }

    public static AgentArgs parse(String raw) {
        Map<String, String> kv = new LinkedHashMap<>();
        if (raw != null) {
            for (String pair : raw.split(",")) {
                int idx = pair.indexOf('=');
                if (idx > 0) {
                    kv.put(pair.substring(0, idx).trim(), pair.substring(idx + 1).trim());
                }
            }
        }
        int port = parseInt(kv.get("port"), DEFAULT_PORT);
        int count = parseInt(kv.get("portCount"), PORT_COUNT);
        String token = kv.get("token");
        if (token == null || token.isEmpty()) {
            token = System.getProperty("kunyu.observer.token", "");
        }
        boolean input = kv.containsKey("inputEnabled")
                ? Boolean.parseBoolean(kv.get("inputEnabled"))
                : Boolean.parseBoolean(System.getProperty("kunyu.observer.inputEnabled", "true"));
        return new AgentArgs(port, count, token, input);
    }

    private static int parseInt(String value, int fallback) {
        try {
            return value == null ? fallback : Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
