package kunyu.observer;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;

/**
 * 探针共用的签名驱动反射工具。
 *
 * <p>原则：跨映射（Mojmap / Yarn / intermediary）不依赖成员名，优先按「类型 + 签名」
 * 定位；命中不了再退到候选名列表；都失败则抛出带中文定位信息的异常，由端点
 * 翻译成 501/503，绝不让单个能力失败拖垮整个 agent。</p>
 */
public final class Reflect {
    private Reflect() {
    }

    /** 按候选类名定位已加载类（委托 GameResolver 的加载器扫描）。 */
    public static Class<?> findClass(String... candidates) {
        return GameResolver.findLoadedClass(candidates);
    }

    /** 按候选名找无参方法（含继承的 public 方法）；找不到返回 null。 */
    public static Method findNoArg(Class<?> owner, String... names) {
        for (String name : names) {
            try {
                Method m = owner.getMethod(name);
                if (m.getParameterCount() == 0) {
                    return m;
                }
            } catch (NoSuchMethodException ignored) {
                // 换下一个候选名
            }
        }
        return null;
    }

    /** 在类层次（含父类）里找「无参且返回类型满足条件」的方法。 */
    public static Method findNoArgByReturnType(Class<?> owner, Class<?> returnType) {
        for (Class<?> c = owner; c != null && c != Object.class; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (m.getParameterCount() == 0 && returnType.isAssignableFrom(m.getReturnType())) {
                    if (tryAccessible(m)) {
                        return m;
                    }
                }
            }
        }
        return null;
    }

    /** 在类层次里找「无参且返回类型名命中任一候选」的方法（映射名无关，按类名后缀/全名匹配）。 */
    public static Method findNoArgByReturnTypeName(Class<?> owner, String... returnTypeNames) {
        for (Class<?> c = owner; c != null && c != Object.class; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (m.getParameterCount() != 0) {
                    continue;
                }
                String rn = m.getReturnType().getName();
                for (String want : returnTypeNames) {
                    if (rn.equals(want) || rn.endsWith(want)) {
                        if (tryAccessible(m)) {
                            return m;
                        }
                    }
                }
            }
        }
        return null;
    }

    /** 在类层次里找指定名字 + 参数形态的方法。 */
    public static Method findMethod(Class<?> owner, String name, Class<?>... params) {
        for (Class<?> c = owner; c != null && c != Object.class; c = c.getSuperclass()) {
            try {
                Method m = c.getDeclaredMethod(name, params);
                if (tryAccessible(m)) {
                    return m;
                }
            } catch (NoSuchMethodException ignored) {
                // 继续向父类找
            }
        }
        return null;
    }

    /** 调用方法，异常包装为带定位信息的 IllegalStateException。 */
    public static Object invoke(Method m, Object target, Object... args) {
        try {
            return m.invoke(target, args);
        } catch (Exception e) {
            throw new IllegalStateException(
                    "调用 " + m.getDeclaringClass().getSimpleName() + "." + m.getName() + " 失败：" + rootMsg(e), e);
        }
    }

    /** 读取文本组件的纯文本：优先 getString()（Mojmap/Yarn 同名），退而求其次任意无参 String 方法。 */
    public static String textOf(Object textComponent) {
        if (textComponent == null) {
            return "";
        }
        if (textComponent instanceof String) {
            return (String) textComponent;
        }
        Method getString = findNoArg(textComponent.getClass(), "getString");
        if (getString != null) {
            Object v = invoke(getString, textComponent);
            if (v != null) {
                return String.valueOf(v);
            }
        }
        return String.valueOf(textComponent);
    }

    /**
     * 读取实体坐标：优先 getX/getY/getZ（Mojmap/Yarn 同名）；
     * intermediary 下退到「返回向量类型的无参方法 + 向量类的 3 个 public final double 字段（声明序即 x,y,z）」。
     */
    public static double[] entityPos(Object entity) {
        Class<?> cls = entity.getClass();
        Method gx = findNoArg(cls, "getX");
        Method gy = findNoArg(cls, "getY");
        Method gz = findNoArg(cls, "getZ");
        if (gx != null && gy != null && gz != null) {
            return new double[] {
                    ((Number) invoke(gx, entity)).doubleValue(),
                    ((Number) invoke(gy, entity)).doubleValue(),
                    ((Number) invoke(gz, entity)).doubleValue()
            };
        }
        // 退到位置向量：找一个无参方法，其返回类型恰有 3 个 public final double 字段
        for (Class<?> c = cls; c != null && c != Object.class; c = c.getSuperclass()) {
            for (Method m : c.getDeclaredMethods()) {
                if (m.getParameterCount() != 0) {
                    continue;
                }
                double[] fields = readVector3(m.getReturnType(), m, entity);
                if (fields != null) {
                    return fields;
                }
            }
        }
        throw new IllegalStateException("未能定位实体坐标（getX/getY/getZ 与位置向量均不可达）");
    }

    private static double[] readVector3(Class<?> vecType, Method accessor, Object entity) {
        List<Field> doubles = new ArrayList<>();
        for (Field f : vecType.getFields()) {
            if (f.getType() == double.class && Modifier.isFinal(f.getModifiers())) {
                doubles.add(f);
            }
        }
        if (doubles.size() != 3) {
            return null;
        }
        try {
            Object vec = accessor.invoke(entity);
            if (vec == null) {
                return null;
            }
            return new double[] {
                    doubles.get(0).getDouble(vec),
                    doubles.get(1).getDouble(vec),
                    doubles.get(2).getDouble(vec)
            };
        } catch (Exception e) {
            return null;
        }
    }

    /** 找「恰有 N 个参数」的构造器（按参数形态再过滤由调用方负责）。 */
    public static Constructor<?> findCtorByArity(Class<?> type, int arity) {
        for (Constructor<?> c : type.getDeclaredConstructors()) {
            if (c.getParameterCount() == arity) {
                if (tryAccessible(c)) {
                    return c;
                }
            }
        }
        return null;
    }

    /** 构造某向量类型的零值实例：优先自身类型的 public static 字段（ZERO），再试 (double×3)/(float×2) 构造器。 */
    public static Object zeroInstance(Class<?> vecType) {
        for (Field f : vecType.getFields()) {
            if (Modifier.isStatic(f.getModifiers()) && f.getType() == vecType) {
                try {
                    Object v = f.get(null);
                    if (v != null) {
                        return v;
                    }
                } catch (Exception ignored) {
                    // 继续尝试构造器
                }
            }
        }
        try {
            Constructor<?> c = vecType.getDeclaredConstructor(double.class, double.class, double.class);
            if (tryAccessible(c)) {
                return c.newInstance(0d, 0d, 0d);
            }
        } catch (Exception ignored) {
            // 继续
        }
        try {
            Constructor<?> c = vecType.getDeclaredConstructor(float.class, float.class);
            if (tryAccessible(c)) {
                return c.newInstance(0f, 0f);
            }
        } catch (Exception ignored) {
            // 继续
        }
        throw new IllegalStateException("无法构造 " + vecType.getName() + " 的零值实例");
    }

    public static boolean tryAccessible(java.lang.reflect.AccessibleObject o) {
        try {
            o.setAccessible(true);
            return true;
        } catch (Throwable t) {
            // public 成员即使 setAccessible 失败也可调用
            return true;
        }
    }

    public static String rootMsg(Throwable t) {
        Throwable cur = t;
        while (cur.getCause() != null && cur.getCause() != cur) {
            cur = cur.getCause();
        }
        return cur.getMessage() != null ? cur.getMessage() : String.valueOf(cur);
    }
}
