/**
 * lintJavaOwnership 单测（P8：资源所有权 + optional 缺载保护）。
 * warn 级启发式：命中返回中文警告，未命中返回空数组；重点覆盖误报控制。
 */
import { describe, expect, it } from 'vitest'
import { lintJavaOwnership } from '../projectFilePolicy'

describe('lintJavaOwnership：资源所有权', () => {
  it('无界静态缓存：static Map 无 clear/remove → 警告', () => {
    const src = `
public class Cache {
  private static final Map<UUID, Data> CACHE = new HashMap<>();
  public static void put(UUID id, Data d) { CACHE.put(id, d); }
}`
    const warnings = lintJavaOwnership(src)
    expect(warnings.some((w) => w.includes('static 容器字段'))).toBe(true)
  })

  it('有清理路径的静态缓存不报（clear 在场）', () => {
    const src = `
public class Cache {
  private static final Map<UUID, Data> CACHE = new HashMap<>();
  public static void onWorldUnload() { CACHE.clear(); }
}`
    const warnings = lintJavaOwnership(src)
    expect(warnings.some((w) => w.includes('static 容器字段'))).toBe(false)
  })

  it('remove 也算清理路径（逐条淘汰式有界缓存）', () => {
    const src = `
public class Cache {
  private static final Set<String> SEEN = new HashSet<>();
  public static void evict(String k) { SEEN.remove(k); }
}`
    expect(lintJavaOwnership(src).some((w) => w.includes('static 容器字段'))).toBe(false)
  })

  it('Executor 无 shutdown → 警告', () => {
    const src = `
public class Worker {
  private final ExecutorService pool = Executors.newFixedThreadPool(2);
  public void submit(Runnable r) { pool.submit(r); }
}`
    expect(lintJavaOwnership(src).some((w) => w.includes('shutdown'))).toBe(true)
  })

  it('Executor 有 shutdown 收口不报', () => {
    const src = `
public class Worker {
  private final ExecutorService pool = Executors.newFixedThreadPool(2);
  public void close() { pool.shutdown(); }
}`
    expect(lintJavaOwnership(src).some((w) => w.includes('shutdown'))).toBe(false)
  })

  it('普通业务类（无静态缓存/线程）→ 空警告', () => {
    const src = `
public class Sword extends Item {
  public Sword(Settings s) { super(s); }
  public int getBonus() { return 3; }
}`
    expect(lintJavaOwnership(src)).toEqual([])
  })
})

describe('lintJavaOwnership：optional 缺载保护', () => {
  it('Mixin 引用第三方类 → 警告', () => {
    const src = `
import com.somek1ng.betternether.BNBlocks;
import net.minecraft.block.Block;
import org.spongepowered.asm.mixin.Mixin;
@Mixin(BNBlocks.class)
public class BNMixin {}`
    expect(lintJavaOwnership(src).some((w) => w.includes('@Mixin'))).toBe(true)
  })

  it('Mixin 只注入原版类不报', () => {
    const src = `
import net.minecraft.block.Block;
import org.spongepowered.asm.mixin.Mixin;
@Mixin(Block.class)
public class BlockMixin {}`
    expect(lintJavaOwnership(src).some((w) => w.includes('@Mixin'))).toBe(false)
  })

  it('static 字段类型为第三方类 → 警告（类加载期即解析）', () => {
    const src = `
import com.somek1ng.api.CompatApi;
public class Entry {
  private static CompatApi api;
  public static void init() { api = null; }
}`
    expect(lintJavaOwnership(src).some((w) => w.includes('static 字段类型'))).toBe(true)
  })

  it('第三方类仅作局部变量/参数（非 static 字段）不报', () => {
    const src = `
import com.somek1ng.api.CompatApi;
public class Entry {
  public void hook(CompatApi api) { api.run(); }
}`
    expect(lintJavaOwnership(src).some((w) => w.includes('static 字段类型'))).toBe(false)
  })

  it('白名单包不算第三方（com.mojang / com.google / net.fabricmc）', () => {
    const src = `
import com.mojang.brigadier.Command;
import com.google.gson.JsonObject;
import net.fabricmc.api.ModInitializer;
public class Main implements ModInitializer {
  public void onInitialize() {}
}`
    expect(lintJavaOwnership(src)).toEqual([])
  })

  it('通配第三方 import 跳过（误报控制）', () => {
    const src = `
import com.somek1ng.api.*;
public class Entry {
  public void noop() {}
}`
    expect(lintJavaOwnership(src).some((w) => w.includes('optional'))).toBe(false)
  })
})
