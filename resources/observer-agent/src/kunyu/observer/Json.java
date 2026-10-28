package kunyu.observer;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 零依赖微 JSON：写端（obj/arr/quote）+ 读端（parse/parseObject，供 POST 端点用）。
 *
 * <p>不用 Gson / Jackson：agent 必须零外部依赖，游戏 JVM 的 classpath 里
 * 不保证有这些库（且各加载器 shaded 版本不同，冲突风险高）。</p>
 */
public final class Json {
    private Json() {
    }

    /** 原始 JSON 片段（调用方保证内容合法），用于嵌入已序列化的子树。 */
    public static final class Raw {
        final String text;

        Raw(String text) {
            this.text = text;
        }
    }

    public static Raw raw(String text) {
        return new Raw(text);
    }

    /** 交替 key/value 组装对象：{@code obj("a", 1, "b", "x")} → {@code {"a":1,"b":"x"}}。 */
    public static String obj(Object... kv) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i + 1 < kv.length; i += 2) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(quote(String.valueOf(kv[i]))).append(':');
            sb.append(value(kv[i + 1]));
        }
        return sb.append('}').toString();
    }

    public static String arr(Iterable<?> values) {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        for (Object v : values) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append(value(v));
        }
        return sb.append(']').toString();
    }

    private static String value(Object v) {
        if (v == null) {
            return "null";
        }
        if (v instanceof Raw) {
            return ((Raw) v).text;
        }
        if (v instanceof String) {
            return quote((String) v);
        }
        if (v instanceof Boolean || v instanceof Number) {
            return v.toString();
        }
        if (v instanceof Map) {
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                if (!first) {
                    sb.append(',');
                }
                first = false;
                sb.append(quote(String.valueOf(e.getKey()))).append(':').append(value(e.getValue()));
            }
            return sb.append('}').toString();
        }
        if (v instanceof Iterable) {
            return arr((Iterable<?>) v);
        }
        return quote(String.valueOf(v));
    }

    public static String quote(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }

    // ------------------------------------------------------------------
    // 解析（批 3 的 POST 端点读取请求体用）
    // ------------------------------------------------------------------

    public static Object parse(String text) {
        return new Parser(text).parse();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String text) {
        if (text == null || text.trim().isEmpty()) {
            return new LinkedHashMap<>();
        }
        Object v = parse(text);
        return v instanceof Map ? (Map<String, Object>) v : new LinkedHashMap<>();
    }

    private static final class Parser {
        private final String s;
        private int i;

        Parser(String s) {
            this.s = s;
        }

        Object parse() {
            Object v = value();
            ws();
            return v;
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) {
                i++;
            }
        }

        private boolean peek(char c) {
            return i < s.length() && s.charAt(i) == c;
        }

        private Object value() {
            ws();
            if (i >= s.length()) {
                return null;
            }
            char c = s.charAt(i);
            switch (c) {
                case '{':
                    return object();
                case '[':
                    return array();
                case '"':
                    return string();
                case 't':
                    expect("true");
                    return Boolean.TRUE;
                case 'f':
                    expect("false");
                    return Boolean.FALSE;
                case 'n':
                    expect("null");
                    return null;
                default:
                    return number();
            }
        }

        private Map<String, Object> object() {
            Map<String, Object> map = new LinkedHashMap<>();
            i++; // {
            ws();
            if (peek('}')) {
                i++;
                return map;
            }
            while (i < s.length()) {
                ws();
                String key = string();
                ws();
                if (peek(':')) {
                    i++;
                }
                map.put(key, value());
                ws();
                if (peek(',')) {
                    i++;
                    continue;
                }
                if (peek('}')) {
                    i++;
                }
                break;
            }
            return map;
        }

        private List<Object> array() {
            List<Object> list = new ArrayList<>();
            i++; // [
            ws();
            if (peek(']')) {
                i++;
                return list;
            }
            while (i < s.length()) {
                list.add(value());
                ws();
                if (peek(',')) {
                    i++;
                    continue;
                }
                if (peek(']')) {
                    i++;
                }
                break;
            }
            return list;
        }

        private String string() {
            if (!peek('"')) {
                return "";
            }
            i++;
            StringBuilder sb = new StringBuilder();
            while (i < s.length()) {
                char c = s.charAt(i++);
                if (c == '"') {
                    break;
                }
                if (c == '\\' && i < s.length()) {
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n':
                            sb.append('\n');
                            break;
                        case 't':
                            sb.append('\t');
                            break;
                        case 'r':
                            sb.append('\r');
                            break;
                        case 'b':
                            sb.append('\b');
                            break;
                        case 'f':
                            sb.append('\f');
                            break;
                        case 'u':
                            if (i + 4 <= s.length()) {
                                try {
                                    sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                                } catch (NumberFormatException ignored) {
                                    // 非法 unicode 转义按原文跳过
                                }
                                i += 4;
                            }
                            break;
                        default:
                            sb.append(e);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        private Object number() {
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) {
                i++;
            }
            String text = s.substring(start, i);
            if (text.isEmpty()) {
                return null;
            }
            try {
                if (text.indexOf('.') < 0 && text.indexOf('e') < 0 && text.indexOf('E') < 0) {
                    return Long.valueOf(text);
                }
                return Double.valueOf(text);
            } catch (NumberFormatException e) {
                return null;
            }
        }

        private void expect(String literal) {
            if (s.regionMatches(i, literal, 0, literal.length())) {
                i += literal.length();
            }
        }
    }
}
