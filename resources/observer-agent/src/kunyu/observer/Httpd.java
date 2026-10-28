package kunyu.observer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * 零依赖微 HTTP 服务（ServerSocket 手写，仅绑定 127.0.0.1）。
 *
 * <p>为什么不用 {@code com.sun.net.httpserver.HttpServer}：Java 9+ 把它拆到
 * 模块 {@code jdk.httpserver}，该模块不在 java.se 默认解析集——游戏以 classpath
 * 模式运行时（Fabric/旧 Forge 常见）根模块集合里没有它，会抛
 * ClassNotFoundException。手写 ServerSocket 百行级，无任何模块依赖。</p>
 *
 * <p>端口策略与旧 mod 一致：从基准端口（默认 9876）起向后探测 11 个，
 * 主进程 probeObserver 按同一段扫描。</p>
 */
public final class Httpd {
    private static final int MAX_HEADER_BYTES = 64 * 1024;
    private static final int MAX_BODY_BYTES = 1024 * 1024;

    private static volatile ServerSocket server;
    private static volatile int boundPort = -1;
    private static AgentArgs args;

    private Httpd() {
    }

    /** 启动服务（重复调用安全）；端口段全被占用时抛 IOException。 */
    public static synchronized void start(AgentArgs a) throws IOException {
        if (server != null) {
            return;
        }
        args = a;
        IOException last = null;
        for (int port = a.basePort(); port < a.basePort() + a.portCount(); port++) {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 16);
                server = ss;
                boundPort = port;
                break;
            } catch (IOException e) {
                last = e;
            }
        }
        if (server == null) {
            throw new IOException(
                    "端口段 " + a.basePort() + ".." + (a.basePort() + a.portCount() - 1) + " 全部被占用", last);
        }
        Thread t = new Thread(Httpd::acceptLoop, "kunyu-observer-http");
        t.setDaemon(true);
        t.start();
        Runtime.getRuntime().addShutdownHook(new Thread(Httpd::closeQuietly, "kunyu-observer-http-stop"));
    }

    public static int port() {
        return boundPort;
    }

    public static AgentArgs args() {
        return args;
    }

    private static void acceptLoop() {
        ServerSocket ss = server;
        while (ss != null && !ss.isClosed()) {
            try {
                final Socket s = ss.accept();
                Thread t = new Thread(() -> handleQuietly(s), "kunyu-observer-req");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (ss.isClosed()) {
                    return;
                }
            }
        }
    }

    private static void closeQuietly() {
        ServerSocket ss = server;
        if (ss != null) {
            try {
                ss.close();
            } catch (IOException ignored) {
                // 关闭失败不影响 JVM 退出
            }
        }
    }

    private static void handleQuietly(Socket s) {
        try (Socket socket = s) {
            socket.setSoTimeout(5000);
            socket.setTcpNoDelay(true);
            Router.Request req = readRequest(socket.getInputStream());
            if (req == null) {
                return;
            }
            Router.Response res = Router.dispatch(req);
            writeResponse(socket.getOutputStream(), res);
        } catch (Throwable ignored) {
            // 单连接失败不影响服务：坏请求 / 对端中断直接丢弃
        }
    }

    // ------------------------------------------------------------------
    // 请求解析 / 响应写出
    // ------------------------------------------------------------------

    private static Router.Request readRequest(InputStream in) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream(4096);
        byte[] end = {'\r', '\n', '\r', '\n'};
        int matched = 0;
        int b;
        while ((b = in.read()) >= 0) {
            head.write(b);
            matched = (b == end[matched]) ? matched + 1 : (b == '\r' ? 1 : 0);
            if (matched == 4) {
                break;
            }
            if (head.size() > MAX_HEADER_BYTES) {
                throw new IOException("请求头过大");
            }
        }
        if (matched < 4) {
            return null;
        }
        // 请求行与头字段都是 ASCII，ISO-8859-1 解码安全
        String headText = new String(head.toByteArray(), StandardCharsets.ISO_8859_1);
        String[] lines = headText.split("\r\n");
        String[] requestLine = lines[0].split(" ", 3);
        if (requestLine.length < 2) {
            return null;
        }
        Router.Request req = new Router.Request();
        req.method = requestLine[0].toUpperCase(Locale.ROOT);
        String target = requestLine[1];
        int qi = target.indexOf('?');
        req.path = qi >= 0 ? target.substring(0, qi) : target;
        String query = qi >= 0 ? target.substring(qi + 1) : "";
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int eq = pair.indexOf('=');
            String k = eq >= 0 ? pair.substring(0, eq) : pair;
            String v = eq >= 0 ? pair.substring(eq + 1) : "";
            req.query.put(URLDecoder.decode(k, "UTF-8"), URLDecoder.decode(v, "UTF-8"));
        }
        for (int i = 1; i < lines.length; i++) {
            int colon = lines[i].indexOf(':');
            if (colon > 0) {
                req.headers.put(lines[i].substring(0, colon).trim().toLowerCase(Locale.ROOT),
                        lines[i].substring(colon + 1).trim());
            }
        }
        int len = 0;
        String contentLength = req.headers.get("content-length");
        if (contentLength != null) {
            try {
                len = Math.min(Integer.parseInt(contentLength), MAX_BODY_BYTES);
            } catch (NumberFormatException ignored) {
                // 非法 Content-Length 按 0 处理
            }
        }
        ByteArrayOutputStream body = new ByteArrayOutputStream(Math.max(0, Math.min(len, 8192)));
        for (int i = 0; i < len; i++) {
            int c = in.read();
            if (c < 0) {
                break;
            }
            body.write(c);
        }
        req.body = body.toByteArray();
        return req;
    }

    private static void writeResponse(OutputStream out, Router.Response res) throws IOException {
        String head = "HTTP/1.1 " + res.status + " " + reason(res.status) + "\r\n"
                + "Content-Type: " + res.contentType + "\r\n"
                + "Content-Length: " + res.body.length + "\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.ISO_8859_1));
        out.write(res.body);
        out.flush();
    }

    private static String reason(int status) {
        switch (status) {
            case 200:
                return "OK";
            case 400:
                return "Bad Request";
            case 401:
                return "Unauthorized";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 405:
                return "Method Not Allowed";
            case 415:
                return "Unsupported Media Type";
            case 429:
                return "Too Many Requests";
            case 501:
                return "Not Implemented";
            case 503:
                return "Service Unavailable";
            default:
                return "Internal Server Error";
        }
    }
}
