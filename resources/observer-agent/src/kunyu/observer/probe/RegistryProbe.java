package kunyu.observer.probe;

import kunyu.observer.Json;
import kunyu.observer.Reflect;
import kunyu.observer.Router;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 注册表计数探针：替代旧第三方桥接通道的脚本反射建图能力。
 *
 * <p>定位内置注册表持有类（Mojmap BuiltInRegistries / Yarn Registries / intermediary
 * class_7923），遍历其 public static 字段：值 instanceof Iterable 即为一个注册表
 * （MC 的 Registry 在三套映射下都实现 java.lang.Iterable，该 JDK 接口名不被混淆），
 * 逐条迭代计数得到注册条目数。</p>
 *
 * <p>命名映射下键名为字段名（BLOCK / ITEM / ENTITY_TYPE …，Yarn 与 Mojmap 相同）；
 * 混淆环境字段名为乱码，键名原样保留并在 mapping 字段标注，计数仍然可用。</p>
 */
public final class RegistryProbe {
    private RegistryProbe() {
    }

    /** GET /v1/registry：各内置注册表条目计数。 */
    public static Router.Response registry(Router.Request req) {
        Class<?> holder = Reflect.findClass(
                "net.minecraft.core.registries.BuiltInRegistries",
                "net.minecraft.registry.Registries",
                "net.minecraft.class_7923");
        if (holder == null) {
            return Router.Response.error(503, "注册表持有类未加载（游戏尚未就绪）");
        }
        Map<String, Object> counts = new LinkedHashMap<>();
        boolean named = false;
        int failed = 0;
        for (Field f : holder.getFields()) {
            if (!Modifier.isStatic(f.getModifiers())) {
                continue;
            }
            Object value;
            try {
                value = f.get(null);
            } catch (Exception e) {
                failed++;
                continue;
            }
            if (!(value instanceof Iterable)) {
                continue;
            }
            int n = 0;
            try {
                for (Object ignored : (Iterable<?>) value) {
                    n++;
                }
            } catch (Throwable t) {
                failed++;
                continue;
            }
            String key = f.getName();
            if ("BLOCK".equals(key) || "ITEM".equals(key)) {
                named = true;
            }
            counts.put(key, n);
        }
        if (counts.isEmpty()) {
            return Router.Response.error(503, "注册表不可迭代（当前映射/版本不支持计数）");
        }
        return Router.Response.json(200, Json.obj(
                "ok", true,
                "holder", holder.getName(),
                "mapping", named ? "named" : "obfuscated",
                "totalRegistries", counts.size(),
                "failedFields", failed,
                "counts", counts));
    }
}
