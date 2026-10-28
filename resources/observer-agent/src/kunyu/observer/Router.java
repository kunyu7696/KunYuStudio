package kunyu.observer;

import kunyu.observer.probe.CommandProbe;
import kunyu.observer.probe.GameProbes;
import kunyu.observer.probe.RegistryProbe;
import kunyu.observer.probe.ScreenshotProbe;
import kunyu.observer.probe.ShutdownProbe;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 端点路由与安全校验（与旧 mod 的 ObserverHttpServer 语义对齐）。
 *
 * <p>已实现：GET /v1/health、GET /v1/screenshot、GET /v1/guard、
 * GET /v1/player、GET /v1/world（环境）、GET /v1/snapshot、GET /v1/registry、
 * POST /v1/server-command、POST /v1/shutdown；
 * 其中 registry / server-command / shutdown 是替代旧第三方桥接通道
 * （注册表计数 / 命令内省 / 优雅退出）的自研端点，不做任意脚本引擎。
 * 旧 mod 的其余端点后续逐条翻译，期间对已知端点显式返回 501，
 * 主进程按 capabilities 声明挑选能力，不会误调。</p>
 */
public final class Router {
    private Router() {
    }

    /** 旧 mod 已定义、agent 待翻译的端点。 */
    private static final Set<String> KNOWN_BUT_PENDING = new HashSet<>(Arrays.asList(
            "/v1/state", "/v1/chat", "/v1/nearby",
            "/v1/inventory", "/v1/screen", "/v1/look",
            "/v1/select-slot", "/v1/command", "/v1/input"));

    /** 单条 HTTP 请求（由 Httpd 解析填充）。 */
    public static final class Request {
        public String method = "GET";
        public String path = "/";
        public final Map<String, String> query = new HashMap<>();
        /** 头字段名一律小写。 */
        public final Map<String, String> headers = new HashMap<>();
        public byte[] body = new byte[0];

        public String header(String name) {
            return headers.get(name.toLowerCase(java.util.Locale.ROOT));
        }

        public String bodyText() {
            return new String(body, StandardCharsets.UTF_8);
        }
    }

    /** 单条 HTTP 响应。 */
    public static final class Response {
        public final int status;
        public final String contentType;
        public final byte[] body;

        public Response(int status, String contentType, byte[] body) {
            this.status = status;
            this.contentType = contentType;
            this.body = body;
        }

        public static Response json(int status, String body) {
            return new Response(status, "application/json; charset=utf-8",
                    body.getBytes(StandardCharsets.UTF_8));
        }

        public static Response error(int status, String message) {
            return json(status, Json.obj("ok", false, "error", message));
        }
    }

    private interface GetHandler {
        Response handle(Request req) throws Exception;
    }

    public static Response dispatch(Request req) {
        try {
            // S-05：Host / Origin 本地校验（防 DNS rebinding / 浏览器 CSRF），全端点生效
            Response forbidden = checkLocal(req);
            if (forbidden != null) {
                return forbidden;
            }
            switch (req.path) {
                case "/v1/health":
                    return get(req, Router::health);
                case "/v1/screenshot":
                    return get(req, Router::screenshot);
                case "/v1/guard":
                    return get(req, Router::guard);
                case "/v1/player":
                    return get(req, GameProbes::player);
                case "/v1/world":
                    return get(req, GameProbes::world);
                case "/v1/snapshot":
                    return get(req, GameProbes::snapshot);
                case "/v1/registry":
                    return get(req, RegistryProbe::registry);
                case "/v1/server-command":
                    return post(req, CommandProbe::serverCommand);
                case "/v1/shutdown":
                    return post(req, ShutdownProbe::shutdown);
                default:
                    if (KNOWN_BUT_PENDING.contains(req.path)) {
                        return Response.error(501, "该端点尚未在 agent 版本实现：" + req.path);
                    }
                    return Response.error(404, "未知端点：" + req.path);
            }
        } catch (Throwable t) {
            String msg = t.getMessage() != null ? t.getMessage() : String.valueOf(t);
            return Response.error(500, msg);
        }
    }

    // ------------------------------------------------------------------
    // 端点实现
    // ------------------------------------------------------------------

    private static Response health(Request req) {
        GameResolver.Game g = GameResolver.probe();
        List<Object> caps = new ArrayList<>();
        // 截图经 java.awt.Robot 主屏兜底；其余能力按本类端点实现情况声明。
        // 注意：聊天/屏幕控件树/输入注入依赖 Mixin 捕获，javaagent 形态不提供，故不声明。
        caps.add("screenshot");
        caps.add("player");
        caps.add("world-env");
        caps.add("snapshot");
        caps.add("registry");
        caps.add("server-command");
        caps.add("shutdown");
        return Response.json(200, Json.obj(
                "ok", true,
                "mod", Agent.ID,
                "version", Agent.VERSION,
                "minecraft", g != null ? g.version : "unknown",
                "protocol", Agent.PROTOCOL,
                "capabilities", caps,
                "inGame", g != null && g.inGame(),
                "now", System.currentTimeMillis(),
                "agent", "javaagent",
                "java", System.getProperty("java.version", "unknown")));
    }

    private static Response screenshot(Request req) throws Exception {
        byte[] png;
        try {
            png = ScreenshotProbe.capturePng();
        } catch (Exception e) {
            // 与旧 mod 一致的错误措辞，harness 按三态契约转 inconclusive
            throw new IllegalStateException("截图失败：" + e.getMessage());
        }
        if ("raw".equals(req.query.get("format"))) {
            return new Response(200, "image/png", png);
        }
        return Response.json(200, Json.obj(
                "mime", "image/png",
                "dataUrl", "data:image/png;base64," + java.util.Base64.getEncoder().encodeToString(png),
                "bytes", png.length));
    }

    private static Response guard(Request req) {
        return Response.json(200, map(Guard.stats()));
    }

    private static String map(Map<String, Object> m) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Object> e : m.entrySet()) {
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
    // 安全校验（与旧 mod requireLocalHost / requireAuth / requireJsonContentType 对齐）
    // ------------------------------------------------------------------

    private static Response checkLocal(Request req) {
        String host = req.header("host");
        if (host != null) {
            String h = host.toLowerCase(java.util.Locale.ROOT);
            if (!h.startsWith("127.0.0.1") && !h.startsWith("localhost") && !h.startsWith("[::1]")) {
                return Response.error(403, "拒绝非本地 Host");
            }
        }
        String origin = req.header("origin");
        if (origin != null && !origin.isEmpty()) {
            String o = origin.toLowerCase(java.util.Locale.ROOT);
            if (!o.contains("127.0.0.1") && !o.contains("localhost") && !o.contains("[::1]")) {
                return Response.error(403, "拒绝非本地 Origin");
            }
        }
        return null;
    }

    /** 仅允许 GET；否则 405。 */
    private static Response get(Request req, GetHandler handler) throws Exception {
        if (!"GET".equals(req.method)) {
            return Response.error(405, "仅支持 GET");
        }
        try {
            return handler.handle(req);
        } catch (IllegalStateException e) {
            return Response.error(500, e.getMessage());
        }
    }

    /** POST 写操作统一入口：方法 + 令牌 + JSON 内容类型校验后再交给端点。 */
    private static Response post(Request req, GetHandler handler) throws Exception {
        Response rejected = requirePostWrite(req);
        if (rejected != null) {
            return rejected;
        }
        try {
            return handler.handle(req);
        } catch (IllegalStateException e) {
            return Response.error(500, e.getMessage());
        }
    }

    /**
     * POST 写操作统一校验（批 3 端点用）：方法 + 令牌 + JSON 内容类型。
     * 通过返回 null，否则为可直接返回的错误响应。
     */
    static Response requirePostWrite(Request req) {
        if (!"POST".equals(req.method)) {
            return Response.error(405, "仅支持 POST");
        }
        String token = Httpd.args() != null ? Httpd.args().token() : "";
        if (!token.isEmpty()) {
            String got = req.header("x-observer-token");
            if (!token.equals(got)) {
                return Response.error(401, "未授权：缺少或无效的 X-Observer-Token");
            }
        }
        String ct = req.header("content-type");
        if (ct == null || !ct.toLowerCase(java.util.Locale.ROOT).contains("application/json")) {
            return Response.error(415, "仅支持 application/json");
        }
        return null;
    }
}
